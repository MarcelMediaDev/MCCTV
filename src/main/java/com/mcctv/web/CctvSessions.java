package com.mcctv.web;

import com.mcctv.CctvConfig;
import com.mcctv.McCctv;
import com.mcctv.camera.CameraRecord;
import com.mcctv.camera.CameraRegistry;
import com.mcctv.entity.EntitySampler;
import com.mcctv.mesh.ChestLids;
import com.mcctv.mesh.ChunkMesher;
import com.mcctv.mesh.MeshResult;
import com.mcctv.mesh.WorldSnapshot;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import io.netty.buffer.Unpooled;
import io.netty.channel.Channel;
import io.netty.handler.codec.http.websocketx.BinaryWebSocketFrame;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import net.minecraft.block.BlockState;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ChunkTicketType;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.ChunkPos;
import net.minecraft.util.math.Direction;
import net.minecraft.world.World;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class CctvSessions {
	private final MinecraftServer server;
	private final CctvConfig config;
	private final CameraRegistry cameras;
	private final Map<UUID, Set<Channel>> viewers = new ConcurrentHashMap<>();
	private final Map<UUID, ChunkPos> tickets = new ConcurrentHashMap<>();
	private final Map<String, ConcurrentHashMap<Long, Integer>> breaking = new ConcurrentHashMap<>();
	private final Map<UUID, WorldSnapshot> snapshots = new ConcurrentHashMap<>();
	private final Map<UUID, ChunkMesher.AtlasBook> atlases = new ConcurrentHashMap<>();
	private final Map<UUID, Set<BlockPos>> dirtyBlocks = new ConcurrentHashMap<>();
	private final Map<UUID, Set<BlockPos>> relightBlocks = new ConcurrentHashMap<>();
	private final Map<UUID, Integer> relightAt = new ConcurrentHashMap<>();
	private final Map<UUID, ConcurrentHashMap<BlockPos, Integer>> lightPulses = new ConcurrentHashMap<>();
	private final Set<UUID> patchBusy = ConcurrentHashMap.newKeySet();
	private final Map<UUID, Integer> meshEpoch = new ConcurrentHashMap<>();
	private final ExecutorService meshExecutor = Executors.newSingleThreadExecutor(r -> {
		Thread thread = new Thread(r, "mcctv-mesh");
		thread.setDaemon(true);
		return thread;
	});
	private int tick;

	public CctvSessions(MinecraftServer server, CctvConfig config, CameraRegistry cameras) {
		this.server = server;
		this.config = config;
		this.cameras = cameras;
	}

	public void addViewer(UUID cameraId, Channel channel) {
		this.viewers.computeIfAbsent(cameraId, id -> new CopyOnWriteArraySet<>()).add(channel);
		this.server.execute(() -> {
			this.ensureTicket(cameraId);
			this.rebuild(cameraId);
		});
	}

	public void dropCamera(CameraRecord camera) {
		UUID cameraId = camera.id();
		Set<Channel> channels = this.viewers.remove(cameraId);
		this.snapshots.remove(cameraId);
		this.atlases.remove(cameraId);
		this.dirtyBlocks.remove(cameraId);
		this.relightBlocks.remove(cameraId);
		this.relightAt.remove(cameraId);
		this.lightPulses.remove(cameraId);
		this.patchBusy.remove(cameraId);
		this.meshEpoch.remove(cameraId);
		this.server.execute(() -> this.dropTicket(cameraId, camera));
		if (channels == null || channels.isEmpty()) {
			return;
		}
		String json = "{\"type\":\"removed\",\"id\":\"" + cameraId + "\"}";
		for (Channel channel : channels) {
			if (channel.isActive()) {
				channel.writeAndFlush(new TextWebSocketFrame(json));
				channel.close();
			}
		}
	}

	public void removeViewer(UUID cameraId, Channel channel) {
		Set<Channel> set = this.viewers.get(cameraId);
		if (set != null) {
			set.remove(channel);
			if (set.isEmpty()) {
				this.viewers.remove(cameraId);
				this.snapshots.remove(cameraId);
				this.atlases.remove(cameraId);
				this.dirtyBlocks.remove(cameraId);
				this.relightBlocks.remove(cameraId);
				this.relightAt.remove(cameraId);
				this.lightPulses.remove(cameraId);
				this.patchBusy.remove(cameraId);
				this.meshEpoch.remove(cameraId);
				this.server.execute(() -> this.dropTicket(cameraId));
			}
		}
	}

	public void onBlockChanged(World world, BlockPos pos, BlockState oldState, BlockState newState) {
		boolean broke = oldState != null && !oldState.isAir() && (newState == null || newState.isAir());
		if (broke) {
			for (CameraRecord gone : this.cameras.removeAt(world, pos)) {
				this.dropCamera(gone);
			}
		}
		if (this.viewers.isEmpty()) {
			return;
		}
		String dimension = world.getRegistryKey().getValue().toString();
		ConcurrentHashMap<Long, Integer> stages = this.breaking.get(dimension);
		if (stages != null) {
			stages.remove(pos.asLong());
		}
		for (UUID cameraId : this.viewers.keySet()) {
			this.cameras.get(cameraId).ifPresent(camera -> {
				if (!camera.dimension().equals(dimension)
						|| !EntitySampler.inViewBox(camera, pos.getX(), pos.getY(), pos.getZ(), this.config.viewDistance)) {
					return;
				}
				this.dirtyBlocks.computeIfAbsent(cameraId, ignored -> ConcurrentHashMap.newKeySet()).add(pos.toImmutable());
				int emit = Math.max(luminance(oldState), luminance(newState));
				if (emit > 0) {
					this.lightPulses.computeIfAbsent(cameraId, ignored -> new ConcurrentHashMap<>())
							.merge(pos.toImmutable(), emit, Math::max);
				}
				if (broke && world instanceof ServerWorld serverWorld) {
					this.sendBurst(cameraId, serverWorld, pos, oldState);
				}
			});
		}
	}

	public void onBlockBreaking(World world, BlockPos pos, int progress) {
		String dimension = world.getRegistryKey().getValue().toString();
		ConcurrentHashMap<Long, Integer> stages = this.breaking.computeIfAbsent(dimension, ignored -> new ConcurrentHashMap<>());
		if (progress < 0 || progress >= 10) {
			stages.remove(pos.asLong());
		} else {
			stages.put(pos.asLong(), progress);
		}
	}

	public void tick() {
		this.tick++;
		ChestLids.beginTick();
		for (UUID cameraId : this.viewers.keySet()) {
			this.tickChests(cameraId);
		}
		for (UUID cameraId : Set.copyOf(this.dirtyBlocks.keySet())) {
			this.flushPatch(cameraId, false);
		}
		for (UUID cameraId : Set.copyOf(this.relightAt.keySet())) {
			Integer due = this.relightAt.get(cameraId);
			if (due == null || this.tick < due) {
				continue;
			}
			if (this.flushPatch(cameraId, true) && this.relightAt.getOrDefault(cameraId, 0) <= this.tick) {
				this.relightAt.remove(cameraId);
			}
		}
		int interval = Math.max(1, 20 / Math.max(1, this.config.entityHz));
		if (this.tick % interval == 0) {
			for (UUID cameraId : this.viewers.keySet()) {
				this.sendEntities(cameraId);
			}
		}
		if (this.tick % 40 == 0) {
			for (CameraRecord gone : this.cameras.pruneMissing()) {
				this.dropCamera(gone);
			}
		}
	}

	private void tickChests(UUID cameraId) {
		CameraRecord camera = this.cameras.get(cameraId).orElse(null);
		if (camera == null) {
			return;
		}
		ServerWorld world = this.cameras.worldOf(camera);
		if (world == null) {
			return;
		}
		for (BlockPos pos : ChestLids.tickNear(world, camera.x(), camera.y(), camera.z(), this.config.viewDistance)) {
			this.dirtyBlocks.computeIfAbsent(cameraId, ignored -> ConcurrentHashMap.newKeySet()).add(pos.toImmutable());
		}
	}

	public void rebuild(UUID cameraId) {
		CameraRecord camera = this.cameras.get(cameraId).orElse(null);
		if (camera == null) {
			return;
		}
		ServerWorld world = this.cameras.worldOf(camera);
		if (world == null) {
			this.broadcastStatus(cameraId, "missing-world");
			return;
		}
		this.patchBusy.add(cameraId);
		int epoch = this.meshEpoch.merge(cameraId, 1, Integer::sum);
		WorldSnapshot snapshot = WorldSnapshot.capture(world, camera, this.config);
		this.snapshots.put(cameraId, snapshot);
		ChunkMesher.AtlasBook book = new ChunkMesher.AtlasBook();
		this.lightPulses.remove(cameraId);
		this.meshExecutor.submit(() -> {
			MeshResult mesh = ChunkMesher.build(snapshot, book);
			this.server.execute(() -> {
				if (this.meshEpoch.getOrDefault(cameraId, 0) != epoch) {
					this.patchBusy.remove(cameraId);
					return;
				}
				this.atlases.put(cameraId, book);
				this.sendMesh(cameraId, camera, mesh);
				this.patchBusy.remove(cameraId);
				this.flushPatch(cameraId, false);
			});
		});
	}

	private static final int PATCH_ORIGINS = 48;
	private static final int LIGHT_CHANGE_CAP = 128;

	private boolean flushPatch(UUID cameraId, boolean relight) {
		if (this.patchBusy.contains(cameraId)) {
			return false;
		}
		Set<BlockPos> source = relight
				? this.relightBlocks.get(cameraId)
				: this.dirtyBlocks.get(cameraId);
		ConcurrentHashMap<BlockPos, Integer> pulses = this.lightPulses.get(cameraId);
		boolean hasPulse = pulses != null && !pulses.isEmpty();
		if ((source == null || source.isEmpty()) && !(relight && hasPulse)) {
			return true;
		}
		Set<BlockPos> batch = source == null || source.isEmpty()
				? new HashSet<>()
				: takeBatch(source, PATCH_ORIGINS);
		if (source != null && source.isEmpty()) {
			if (relight) {
				this.relightBlocks.remove(cameraId);
			} else {
				this.dirtyBlocks.remove(cameraId);
			}
		}
		WorldSnapshot snapshot = this.snapshots.get(cameraId);
		ChunkMesher.AtlasBook book = this.atlases.get(cameraId);
		CameraRecord camera = this.cameras.get(cameraId).orElse(null);
		if (snapshot == null || book == null || camera == null) {
			this.rebuild(cameraId);
			return true;
		}
		if (!book.frozen) {
			this.dirtyBlocks.computeIfAbsent(cameraId, ignored -> ConcurrentHashMap.newKeySet()).addAll(batch);
			return true;
		}
		ServerWorld world = this.cameras.worldOf(camera);
		if (world == null) {
			return true;
		}
		Set<BlockPos> expanded = new HashSet<>(Math.max(16, batch.size() * 8));
		if (relight) {
			expanded.addAll(batch);
			if (hasPulse) {
				this.collectLightChanges(world, snapshot, pulses, expanded);
				this.lightPulses.remove(cameraId);
			}
		} else {
			for (BlockPos pos : batch) {
				expanded.add(pos.toImmutable());
				for (Direction dir : Direction.values()) {
					expanded.add(pos.offset(dir));
				}
			}
		}
		this.patchBusy.add(cameraId);
		int epoch = this.meshEpoch.getOrDefault(cameraId, 0);
		List<int[]> punch = new ArrayList<>(expanded.size());
		for (BlockPos pos : expanded) {
			snapshot.update(world, pos.getX(), pos.getY(), pos.getZ());
			punch.add(new int[] {pos.getX(), pos.getY(), pos.getZ()});
		}
		List<BlockPos> cells = List.copyOf(expanded);
		this.meshExecutor.submit(() -> {
			List<float[]> verts = new ArrayList<>();
			synchronized (book) {
				if (book.frozen) {
					ChunkMesher.emitWorldCells(snapshot, book, verts, cells);
				}
			}
			this.server.execute(() -> {
				if (this.meshEpoch.getOrDefault(cameraId, 0) == epoch && this.atlases.get(cameraId) == book) {
					this.sendPatch(cameraId, punch, verts);
				}
				this.patchBusy.remove(cameraId);
				this.flushPatch(cameraId, false);
			});
		});
		if (!relight && !batch.isEmpty()) {
			this.relightBlocks.computeIfAbsent(cameraId, ignored -> ConcurrentHashMap.newKeySet()).addAll(batch);
			this.relightAt.putIfAbsent(cameraId, this.tick + 4);
		} else if (relight && source != null && !source.isEmpty()) {
			this.relightAt.put(cameraId, this.tick + 1);
		}
		return true;
	}

	private static Set<BlockPos> takeBatch(Set<BlockPos> source, int limit) {
		Set<BlockPos> batch = new HashSet<>(Math.min(limit, source.size()));
		var iterator = source.iterator();
		while (iterator.hasNext() && batch.size() < limit) {
			batch.add(iterator.next());
			iterator.remove();
		}
		return batch;
	}

	private void collectLightChanges(ServerWorld world, WorldSnapshot snapshot,
			Map<BlockPos, Integer> pulses, Set<BlockPos> expanded) {
		BlockPos.Mutable cursor = new BlockPos.Mutable();
		int added = 0;
		for (Map.Entry<BlockPos, Integer> pulse : pulses.entrySet()) {
			if (added >= LIGHT_CHANGE_CAP) {
				break;
			}
			BlockPos origin = pulse.getKey();
			int radius = Math.min(8, Math.max(1, pulse.getValue()));
			int r2 = radius * radius;
			for (int dy = -radius; dy <= radius && added < LIGHT_CHANGE_CAP; dy++) {
				for (int dx = -radius; dx <= radius && added < LIGHT_CHANGE_CAP; dx++) {
					for (int dz = -radius; dz <= radius; dz++) {
						if (dx * dx + dy * dy + dz * dz > r2) {
							continue;
						}
						cursor.set(origin.getX() + dx, origin.getY() + dy, origin.getZ() + dz);
						if (!snapshot.containsWorld(cursor.getX(), cursor.getY(), cursor.getZ())) {
							continue;
						}
						if (!snapshot.lightMatches(world, cursor) && expanded.add(cursor.toImmutable())) {
							added++;
							if (added >= LIGHT_CHANGE_CAP) {
								return;
							}
						}
					}
				}
			}
		}
	}

	private static int luminance(BlockState state) {
		return state == null ? 0 : state.getLuminance();
	}

	private void sendBurst(UUID cameraId, ServerWorld world, BlockPos pos, BlockState oldState) {
		Set<Channel> channels = this.viewers.get(cameraId);
		ChunkMesher.AtlasBook book = this.atlases.get(cameraId);
		if (channels == null || book == null) {
			return;
		}
		int color = WorldSnapshot.burstColor(world, pos, oldState);
		String texture = WorldSnapshot.burstTexture(oldState);
		int tile = Math.max(0, ChunkMesher.lookupTile(book, texture));
		JsonObject json = new JsonObject();
		json.addProperty("type", "burst");
		json.addProperty("x", pos.getX());
		json.addProperty("y", pos.getY());
		json.addProperty("z", pos.getZ());
		json.addProperty("tile", tile);
		json.addProperty("r", ((color >> 16) & 0xFF) / 255f);
		json.addProperty("g", ((color >> 8) & 0xFF) / 255f);
		json.addProperty("b", (color & 0xFF) / 255f);
		String text = json.toString();
		for (Channel channel : channels) {
			if (channel.isActive()) {
				channel.writeAndFlush(new TextWebSocketFrame(text));
			}
		}
	}

	private void sendPatch(UUID cameraId, List<int[]> punch, List<float[]> verts) {
		Set<Channel> channels = this.viewers.get(cameraId);
		if (channels == null) {
			return;
		}
		ByteBuffer buffer = ByteBuffer.allocate(4 + punch.size() * 12 + 4 + verts.size() * ChunkMesher.VERT_FLOATS * 4);
		buffer.order(ByteOrder.LITTLE_ENDIAN);
		buffer.putInt(punch.size());
		for (int[] p : punch) {
			buffer.putInt(p[0]);
			buffer.putInt(p[1]);
			buffer.putInt(p[2]);
		}
		buffer.putInt(verts.size());
		for (float[] v : verts) {
			for (int i = 0; i < ChunkMesher.VERT_FLOATS; i++) {
				buffer.putFloat(v[i]);
			}
		}
		byte[] payload = new byte[1 + buffer.position()];
		payload[0] = 3;
		System.arraycopy(buffer.array(), 0, payload, 1, buffer.position());
		for (Channel channel : channels) {
			if (channel.isActive()) {
				channel.writeAndFlush(new BinaryWebSocketFrame(Unpooled.wrappedBuffer(payload)));
			}
		}
	}

	private void sendMesh(UUID cameraId, CameraRecord camera, MeshResult mesh) {
		Set<Channel> channels = this.viewers.get(cameraId);
		if (channels == null) {
			return;
		}
		JsonObject hello = new JsonObject();
		hello.addProperty("type", "hello");
		hello.addProperty("id", camera.id().toString());
		hello.addProperty("name", camera.name());
		hello.addProperty("loaded", mesh.loaded());
		hello.addProperty("eyeX", mesh.eyeX());
		hello.addProperty("eyeY", mesh.eyeY());
		hello.addProperty("eyeZ", mesh.eyeZ());
		hello.addProperty("yaw", mesh.yaw());
		hello.addProperty("pitch", mesh.pitch());
		mesh.sky().writeJson(hello);
		String helloJson = hello.toString();
		for (Channel channel : channels) {
			if (!channel.isActive()) {
				continue;
			}
			channel.write(new TextWebSocketFrame(helloJson));
			if (mesh.atlasPng().length > 0) {
				byte[] atlas = new byte[1 + mesh.atlasPng().length];
				atlas[0] = 2;
				System.arraycopy(mesh.atlasPng(), 0, atlas, 1, mesh.atlasPng().length);
				channel.write(new BinaryWebSocketFrame(Unpooled.wrappedBuffer(atlas)));
			}
			if (mesh.vertices().length > 0) {
				byte[] verts = new byte[1 + mesh.vertices().length];
				verts[0] = 1;
				System.arraycopy(mesh.vertices(), 0, verts, 1, mesh.vertices().length);
				channel.write(new BinaryWebSocketFrame(Unpooled.wrappedBuffer(verts)));
			}
			channel.flush();
		}
	}

	private void sendEntities(UUID cameraId) {
		CameraRecord camera = this.cameras.get(cameraId).orElse(null);
		Set<Channel> channels = this.viewers.get(cameraId);
		if (camera == null || channels == null || channels.isEmpty()) {
			return;
		}
		ServerWorld world = this.cameras.worldOf(camera);
		if (world == null) {
			return;
		}
		JsonObject payload = EntitySampler.sample(world, camera, this.config);
		payload.add("breaking", this.breakingJson(camera));
		ChunkMesher.AtlasBook book = this.atlases.get(cameraId);
		if (book != null && book.frozen) {
			if (payload.has("items")) {
				for (var el : payload.getAsJsonArray("items")) {
					assignTile(book, el.getAsJsonObject());
				}
			}
			if (payload.has("tnt")) {
				for (var el : payload.getAsJsonArray("tnt")) {
					assignTntTiles(book, el.getAsJsonObject());
				}
			}
			if (payload.has("frames")) {
				for (var el : payload.getAsJsonArray("frames")) {
					JsonObject frame = el.getAsJsonObject();
					assignTile(book, frame);
					int frameTile = ChunkMesher.lookupTile(book, frame.has("frame") ? frame.get("frame").getAsString() : "item_frame");
					if (frameTile >= 0) {
						frame.addProperty("frameTile", frameTile);
					}
					int woodTile = ChunkMesher.lookupTile(book, "birch_planks");
					if (woodTile >= 0) {
						frame.addProperty("woodTile", woodTile);
					}
				}
			}
			if (payload.has("players")) {
				for (var el : payload.getAsJsonArray("players")) {
					JsonObject player = el.getAsJsonObject();
					if (player.has("mainHand")) {
						assignTile(book, player.getAsJsonObject("mainHand"));
					}
					if (player.has("offHand")) {
						assignTile(book, player.getAsJsonObject("offHand"));
					}
				}
			}
			if (payload.has("mobs")) {
				for (var el : payload.getAsJsonArray("mobs")) {
					JsonObject mob = el.getAsJsonObject();
					if (mob.has("hand")) {
						assignTile(book, mob.getAsJsonObject("hand"));
					}
				}
			}
		}
		String json = payload.toString();
		for (Channel channel : channels) {
			if (channel.isActive()) {
				channel.writeAndFlush(new TextWebSocketFrame(json));
			}
		}
	}

	private JsonArray breakingJson(CameraRecord camera) {
		JsonArray array = new JsonArray();
		ConcurrentHashMap<Long, Integer> stages = this.breaking.get(camera.dimension());
		if (stages == null || stages.isEmpty()) {
			return array;
		}
		for (Map.Entry<Long, Integer> entry : stages.entrySet()) {
			BlockPos pos = BlockPos.fromLong(entry.getKey());
			if (!EntitySampler.inViewBox(camera, pos.getX(), pos.getY(), pos.getZ(), this.config.viewDistance)) {
				continue;
			}
			JsonObject obj = new JsonObject();
			obj.addProperty("x", pos.getX());
			obj.addProperty("y", pos.getY());
			obj.addProperty("z", pos.getZ());
			obj.addProperty("stage", entry.getValue());
			array.add(obj);
		}
		return array;
	}

	private static void assignTntTiles(ChunkMesher.AtlasBook book, JsonObject obj) {
		int side = ChunkMesher.lookupTile(book, "tnt_side");
		int top = ChunkMesher.lookupTile(book, "tnt_top");
		int bottom = ChunkMesher.lookupTile(book, "tnt_bottom");
		int any = ChunkMesher.lookupTile(book, "tnt");
		if (side < 0) {
			side = any;
		}
		if (top < 0) {
			top = any;
		}
		if (bottom < 0) {
			bottom = any;
		}
		if (side >= 0) {
			obj.addProperty("tileSide", side);
		}
		if (top >= 0) {
			obj.addProperty("tileTop", top);
		}
		if (bottom >= 0) {
			obj.addProperty("tileBottom", bottom);
		}
	}

	private static void assignTile(ChunkMesher.AtlasBook book, JsonObject obj) {
		String block = obj.has("block") ? obj.get("block").getAsString() : "";
		if (block.isEmpty()) {
			return;
		}
		int tile = ChunkMesher.lookupTile(book, block);
		if (tile >= 0) {
			obj.addProperty("tile", tile);
		}
	}

	private void broadcastStatus(UUID cameraId, String status) {
		Set<Channel> channels = this.viewers.get(cameraId);
		if (channels == null) {
			return;
		}
		JsonObject json = new JsonObject();
		json.addProperty("type", "status");
		json.addProperty("status", status);
		String text = json.toString();
		for (Channel channel : channels) {
			if (channel.isActive()) {
				channel.writeAndFlush(new TextWebSocketFrame(text));
			}
		}
	}

	private int loadRadius() {
		int fromView = Math.max(8, this.config.viewDistance) / 16 + 2;
		return Math.max(this.config.ticketRadius, fromView);
	}

	private void ensureTicket(UUID cameraId) {
		if (!this.config.forceLoadWhileViewing) {
			return;
		}
		CameraRecord camera = this.cameras.get(cameraId).orElse(null);
		if (camera == null) {
			return;
		}
		ServerWorld world = this.cameras.worldOf(camera);
		if (world == null) {
			return;
		}
		ChunkPos pos = new ChunkPos(camera.x() >> 4, camera.z() >> 4);
		this.tickets.put(cameraId, pos);
		try {
			world.getChunkManager().addTicket(ChunkTicketType.FORCED, pos, this.loadRadius());
		} catch (Throwable t) {
			McCctv.LOGGER.debug("Could not add chunk ticket", t);
		}
	}

	private void dropTicket(UUID cameraId) {
		this.dropTicket(cameraId, this.cameras.get(cameraId).orElse(null));
	}

	private void dropTicket(UUID cameraId, CameraRecord camera) {
		ChunkPos pos = this.tickets.remove(cameraId);
		if (pos == null || !this.config.forceLoadWhileViewing || camera == null) {
			return;
		}
		ServerWorld world = this.cameras.worldOf(camera);
		if (world == null) {
			return;
		}
		try {
			world.getChunkManager().removeTicket(ChunkTicketType.FORCED, pos, this.loadRadius());
		} catch (Throwable t) {
			McCctv.LOGGER.debug("Could not remove chunk ticket", t);
		}
	}

	public void shutdown() {
		for (UUID cameraId : Set.copyOf(this.tickets.keySet())) {
			this.dropTicket(cameraId);
		}
		this.viewers.clear();
		this.meshExecutor.shutdownNow();
	}
}
