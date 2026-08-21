package com.mcctv.camera;

import com.mcctv.CctvConfig;
import com.mcctv.McCctv;
import net.minecraft.block.BlockState;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.SkullBlockEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.command.permission.LeveledPermissionPredicate;
import net.minecraft.command.permission.PermissionLevel;
import net.minecraft.command.permission.PermissionPredicate;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public class CameraRegistry {
	private final MinecraftServer server;
	private final CctvConfig config;
	private final SecureRandom random = new SecureRandom();

	public CameraRegistry(MinecraftServer server, CctvConfig config) {
		this.server = server;
		this.config = config;
	}

	public CctvWorldState state() {
		return this.server.getOverworld().getPersistentStateManager().getOrCreate(CctvWorldState.TYPE);
	}

	public List<CameraRecord> all() {
		return List.copyOf(this.state().cameras);
	}

	public List<CameraRecord> visibleTo(PlayerAuth auth) {
		if (auth.op()) {
			return this.all();
		}
		return this.state().cameras.stream()
				.filter(camera -> camera.ownerUuid().equals(auth.playerUuid()))
				.toList();
	}

	public Optional<CameraRecord> get(UUID id) {
		return this.state().cameras.stream().filter(camera -> camera.id().equals(id)).findFirst();
	}

	public boolean canView(PlayerAuth auth, UUID cameraId) {
		return this.get(cameraId).filter(camera -> auth.op() || camera.ownerUuid().equals(auth.playerUuid())).isPresent();
	}

	public void onPlaced(World world, BlockPos pos, PlayerEntity player, ItemStack stack) {
		if (world.isClient() || !(player instanceof ServerPlayerEntity serverPlayer)) {
			return;
		}
		if (!CameraItemFactory.isCamera(stack) && !isCameraSkull(world, pos)) {
			return;
		}
		this.register(world, pos, serverPlayer);
	}

	public Optional<CameraRecord> register(World world, BlockPos pos, ServerPlayerEntity owner) {
		if (world.isClient()) {
			return Optional.empty();
		}
		pos = pos.toImmutable();
		String dimension = world.getRegistryKey().getValue().toString();
		CctvWorldState state = this.state();
		for (CameraRecord existing : state.cameras) {
			if (existing.isAt(dimension, pos.getX(), pos.getY(), pos.getZ())) {
				return Optional.of(existing);
			}
		}
		long owned = state.cameras.stream().filter(camera -> camera.ownerUuid().equals(owner.getUuid())).count();
		if (owned >= this.config.maxCamerasPerPlayer && !isOp(owner)) {
			McCctv.LOGGER.info("Player {} hit CCTV camera cap", owner.getName().getString());
			return Optional.empty();
		}
		BlockState blockState = world.getBlockState(pos);
		CameraRecord record = new CameraRecord(
				UUID.randomUUID(),
				dimension,
				pos.getX(),
				pos.getY(),
				pos.getZ(),
				CameraAngles.yaw(blockState),
				CameraAngles.pitch(blockState),
				owner.getUuid(),
				"Camera " + (owned + 1)
		);
		state.cameras.add(record);
		state.markDirty();
		McCctv.LOGGER.info("Registered CCTV camera {} at {} {} {} {}", record.name(), dimension, pos.getX(), pos.getY(), pos.getZ());
		return Optional.of(record);
	}

	public int claimNearby(ServerPlayerEntity player, int radius) {
		World world = player.getEntityWorld();
		BlockPos center = player.getBlockPos();
		String dimension = world.getRegistryKey().getValue().toString();
		int claimed = 0;
		for (BlockPos pos : BlockPos.iterate(center.add(-radius, -radius, -radius), center.add(radius, radius, radius))) {
			if (!isCameraSkull(world, pos)) {
				continue;
			}
			BlockPos immutable = pos.toImmutable();
			boolean already = this.state().cameras.stream()
					.anyMatch(camera -> camera.isAt(dimension, immutable.getX(), immutable.getY(), immutable.getZ()));
			if (already) {
				continue;
			}
			if (this.register(world, immutable, player).isPresent()) {
				claimed++;
			}
		}
		return claimed;
	}

	public List<CameraRecord> removeAt(World world, BlockPos pos) {
		if (world.isClient()) {
			return List.of();
		}
		String dimension = world.getRegistryKey().getValue().toString();
		CctvWorldState state = this.state();
		List<CameraRecord> removed = state.cameras.stream()
				.filter(camera -> camera.isAt(dimension, pos.getX(), pos.getY(), pos.getZ()))
				.toList();
		if (removed.isEmpty()) {
			return List.of();
		}
		state.cameras.removeIf(camera -> camera.isAt(dimension, pos.getX(), pos.getY(), pos.getZ()));
		state.markDirty();
		McCctv.LOGGER.info("Removed {} CCTV camera(s) at {} {} {} {}", removed.size(), dimension, pos.getX(), pos.getY(), pos.getZ());
		return removed;
	}

	public Optional<CameraRecord> remove(UUID id) {
		CctvWorldState state = this.state();
		Optional<CameraRecord> found = state.cameras.stream().filter(camera -> camera.id().equals(id)).findFirst();
		if (found.isEmpty()) {
			return Optional.empty();
		}
		CameraRecord camera = found.get();
		state.cameras.removeIf(entry -> entry.id().equals(id));
		state.markDirty();
		ServerWorld world = this.worldOf(camera);
		if (world != null) {
			BlockPos pos = new BlockPos(camera.x(), camera.y(), camera.z());
			if (isCameraSkull(world, pos)) {
				world.breakBlock(pos, true);
			}
		}
		McCctv.LOGGER.info("Removed CCTV camera {}", camera.name());
		return found;
	}

	public List<CameraRecord> pruneMissing() {
		CctvWorldState state = this.state();
		List<CameraRecord> gone = new java.util.ArrayList<>();
		for (CameraRecord camera : List.copyOf(state.cameras)) {
			ServerWorld world = this.worldOf(camera);
			if (world == null) {
				continue;
			}
			BlockPos pos = new BlockPos(camera.x(), camera.y(), camera.z());
			if (!world.isChunkLoaded(pos)) {
				continue;
			}
			if (!isCameraSkull(world, pos)) {
				gone.add(camera);
			}
		}
		if (!gone.isEmpty()) {
			state.cameras.removeIf(camera -> gone.stream().anyMatch(entry -> entry.id().equals(camera.id())));
			state.markDirty();
		}
		return gone;
	}

	public static boolean isCameraSkull(World world, BlockPos pos) {
		BlockEntity entity = world.getBlockEntity(pos);
		if (entity instanceof SkullBlockEntity skull) {
			return CameraItemFactory.isCamera(skull.getOwner());
		}
		return false;
	}

	public Optional<CameraRecord> nearestOwned(ServerPlayerEntity player, double maxDistance) {
		String dimension = player.getEntityWorld().getRegistryKey().getValue().toString();
		CameraRecord best = null;
		double bestDist = maxDistance * maxDistance;
		for (CameraRecord camera : this.state().cameras) {
			if (!camera.dimension().equals(dimension) || (!camera.ownerUuid().equals(player.getUuid()) && !isOp(player))) {
				continue;
			}
			double dx = camera.x() + 0.5 - player.getX();
			double dy = camera.y() + 0.5 - player.getY();
			double dz = camera.z() + 0.5 - player.getZ();
			double dist = dx * dx + dy * dy + dz * dz;
			if (dist < bestDist) {
				bestDist = dist;
				best = camera;
			}
		}
		return Optional.ofNullable(best);
	}

	public boolean rename(CameraRecord camera, String name) {
		CctvWorldState state = this.state();
		for (int i = 0; i < state.cameras.size(); i++) {
			if (state.cameras.get(i).id().equals(camera.id())) {
				state.cameras.set(i, camera.withName(name));
				state.markDirty();
				return true;
			}
		}
		return false;
	}

	public PlayerAuth tokenFor(ServerPlayerEntity player) {
		CctvWorldState state = this.state();
		PlayerAuth existing = state.tokens.get(player.getUuid());
		boolean op = isOp(player);
		if (existing == null) {
			PlayerAuth created = new PlayerAuth(player.getUuid(), newToken(), op);
			state.tokens.put(player.getUuid(), created);
			state.markDirty();
			return created;
		}
		if (existing.op() != op) {
			PlayerAuth updated = existing.withOp(op);
			state.tokens.put(player.getUuid(), updated);
			state.markDirty();
			return updated;
		}
		return existing;
	}

	public PlayerAuth resetToken(ServerPlayerEntity player) {
		CctvWorldState state = this.state();
		PlayerAuth updated = new PlayerAuth(player.getUuid(), newToken(), isOp(player));
		state.tokens.put(player.getUuid(), updated);
		state.markDirty();
		return updated;
	}

	public Optional<PlayerAuth> authByToken(String token) {
		if (token == null || token.isBlank()) {
			return Optional.empty();
		}
		return this.state().tokens.values().stream().filter(auth -> auth.token().equals(token)).findFirst();
	}

	public ServerWorld worldOf(CameraRecord camera) {
		Identifier id = Identifier.of(camera.dimension());
		RegistryKey<World> key = RegistryKey.of(RegistryKeys.WORLD, id);
		return this.server.getWorld(key);
	}

	private String newToken() {
		byte[] bytes = new byte[16];
		this.random.nextBytes(bytes);
		return HexFormat.of().formatHex(bytes);
	}

	public static boolean isOp(ServerPlayerEntity player) {
		PermissionPredicate permissions = player.getPermissions();
		if (permissions instanceof LeveledPermissionPredicate leveled) {
			return leveled.getLevel().isAtLeast(PermissionLevel.GAMEMASTERS);
		}
		return false;
	}
}
