package com.mcctv.mesh;

import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.ChestBlockEntity;
import net.minecraft.block.entity.EnderChestBlockEntity;
import net.minecraft.block.entity.LidOpenable;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.chunk.WorldChunk;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public final class ChestLids {
	private static final Map<String, Integer> PROGRESS = new ConcurrentHashMap<>();
	private static final Set<String> STEPPED = new HashSet<>();
	private static final Set<String> CHANGED = new HashSet<>();

	private ChestLids() {
	}

	public static void beginTick() {
		STEPPED.clear();
		CHANGED.clear();
	}

	static boolean tracks(String id) {
		return id.contains("chest") && !id.contains("boat") && !id.contains("minecart") && !id.contains("cart");
	}

	static int progress(ServerWorld world, BlockPos pos) {
		return PROGRESS.getOrDefault(key(world, pos), 0);
	}

	public static List<BlockPos> tickNear(ServerWorld world, int x, int y, int z, int range) {
		List<BlockPos> changed = new ArrayList<>();
		int limit = (range + 8) * (range + 8);
		int minCx = (x - range - 8) >> 4;
		int maxCx = (x + range + 8) >> 4;
		int minCz = (z - range - 8) >> 4;
		int maxCz = (z + range + 8) >> 4;
		for (int cx = minCx; cx <= maxCx; cx++) {
			for (int cz = minCz; cz <= maxCz; cz++) {
				if (!world.isChunkLoaded(cx, cz)) {
					continue;
				}
				WorldChunk chunk = world.getChunk(cx, cz);
				for (BlockEntity be : chunk.getBlockEntities().values()) {
					if (!(be instanceof LidOpenable)) {
						continue;
					}
					BlockPos pos = be.getPos();
					int dx = pos.getX() - x;
					int dy = pos.getY() - y;
					int dz = pos.getZ() - z;
					if (dx * dx + dy * dy + dz * dz > limit) {
						continue;
					}
					if (step(world, pos, be)) {
						changed.add(pos.toImmutable());
					}
				}
			}
		}
		return changed;
	}

	private static boolean step(ServerWorld world, BlockPos pos, BlockEntity be) {
		String k = key(world, pos);
		if (STEPPED.add(k)) {
			boolean open = isViewed(world, be);
			int cur = PROGRESS.getOrDefault(k, 0);
			int next = open ? Math.min(10, cur + 1) : Math.max(0, cur - 1);
			if (next == 0) {
				PROGRESS.remove(k);
			} else {
				PROGRESS.put(k, next);
			}
			if (next != cur) {
				CHANGED.add(k);
			}
		}
		return CHANGED.contains(k);
	}

	private static boolean isViewed(ServerWorld world, BlockEntity be) {
		if (be instanceof ChestBlockEntity) {
			return ChestBlockEntity.getPlayersLookingInChestCount(world, be.getPos()) > 0;
		}
		if (be instanceof EnderChestBlockEntity ender) {
			for (ServerPlayerEntity player : world.getPlayers()) {
				if (player.getEnderChestInventory().isActiveBlockEntity(ender)) {
					return true;
				}
			}
		}
		return false;
	}

	private static String key(ServerWorld world, BlockPos pos) {
		return world.getRegistryKey().getValue() + ":" + pos.asLong();
	}
}
