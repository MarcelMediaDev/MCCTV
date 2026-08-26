package com.mcctv.mesh;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.block.BlockState;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.ChestBlockEntity;
import net.minecraft.block.entity.EnderChestBlockEntity;
import net.minecraft.block.entity.LidOpenable;
import net.minecraft.registry.Registries;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.state.property.Properties;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.chunk.WorldChunk;

public final class ChestLids {
	private ChestLids() {
	}

	static boolean tracks(String id) {
		return id.contains("chest") && !id.contains("boat") && !id.contains("minecart") && !id.contains("cart");
	}

	public static JsonArray sampleNear(ServerWorld world, int x, int y, int z, int range) {
		JsonArray chests = new JsonArray();
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
					BlockState state = be.getCachedState();
					String id = Registries.BLOCK.getId(state.getBlock()).getPath();
					if (!tracks(id)) {
						continue;
					}
					String facing = "south";
					if (state.contains(Properties.HORIZONTAL_FACING)) {
						facing = state.get(Properties.HORIZONTAL_FACING).asString();
					}
					JsonObject json = new JsonObject();
					json.addProperty("uuid", "chest:" + pos.getX() + "," + pos.getY() + "," + pos.getZ());
					json.addProperty("x", pos.getX());
					json.addProperty("y", pos.getY());
					json.addProperty("z", pos.getZ());
					json.addProperty("open", isViewed(world, be));
					json.addProperty("facing", facing);
					json.addProperty("rotY", EntityBlockMeshes.facingYaw(facing));
					chests.add(json);
				}
			}
		}
		return chests;
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
}
