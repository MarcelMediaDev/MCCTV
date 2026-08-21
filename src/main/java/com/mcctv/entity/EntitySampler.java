package com.mcctv.entity;

import com.mcctv.CctvConfig;
import com.mcctv.camera.CameraRecord;
import com.mcctv.mesh.SkyAppearance;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.BlockItem;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Arm;
import net.minecraft.util.Hand;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class EntitySampler {
	private static final Map<UUID, Vec3d> LAST_POS = new HashMap<>();

	private EntitySampler() {
	}

	public static JsonObject sample(ServerWorld world, CameraRecord camera, CctvConfig config) {
		Vec3d look = Vec3d.fromPolar(camera.pitch(), camera.yaw());
		Vec3d eye = new Vec3d(camera.x() + 0.5 + look.x * 0.55, camera.y() + 0.5, camera.z() + 0.5 + look.z * 0.55);
		double range = config.viewDistance;
		Box box = new Box(eye, eye).expand(range);
		List<LivingEntity> entities = world.getEntitiesByClass(LivingEntity.class, box, entity -> visible(world, camera, eye, look, entity, range));
		JsonArray players = new JsonArray();
		JsonArray mobs = new JsonArray();
		for (LivingEntity entity : entities) {
			JsonObject json = new JsonObject();
			json.addProperty("x", entity.getX());
			json.addProperty("y", entity.getY());
			json.addProperty("z", entity.getZ());
			json.addProperty("yaw", entity.getYaw());
			json.addProperty("pitch", entity.getPitch());
			json.addProperty("bodyYaw", entity.getBodyYaw());
			json.addProperty("sneaking", entity.isInSneakingPose());
			json.addProperty("pose", entity.getPose().asString());
			json.addProperty("limb", entity.limbAnimator.getAnimationProgress());
			json.addProperty("limbAmount", entity.limbAnimator.getAmplitude(1f));
			float swing = entity.getHandSwingProgress(1f);
			json.addProperty("swing", swing);
			json.addProperty("swinging", entity.handSwinging || swing > 0.02f);
			boolean leftMain = entity.getMainArm() == Arm.LEFT;
			boolean offHand = entity.preferredHand == Hand.OFF_HAND;
			json.addProperty("swingLeft", leftMain ^ offHand);
			Vec3d pos = new Vec3d(entity.getX(), entity.getY(), entity.getZ());
			Vec3d last = LAST_POS.put(entity.getUuid(), pos);
			double speed = 0;
			double vx = 0;
			double vz = 0;
			if (last != null) {
				vx = (pos.x - last.x) * Math.max(1, config.entityHz);
				vz = (pos.z - last.z) * Math.max(1, config.entityHz);
				speed = Math.sqrt(vx * vx + vz * vz);
			}
			json.addProperty("vx", vx);
			json.addProperty("vz", vz);
			json.addProperty("speed", speed);
			if (entity instanceof PlayerEntity player) {
				json.addProperty("uuid", player.getUuidAsString());
				json.addProperty("name", player.getName().getString());
				json.addProperty("slim", (player.getUuid().hashCode() & 1) == 1);
				json.addProperty("leftMain", player.getMainArm() == Arm.LEFT);
				json.add("mainHand", stackJson(world, player.getMainHandStack()));
				json.add("offHand", stackJson(world, player.getOffHandStack()));
				json.add("armor", armorJson(player));
				players.add(json);
			} else {
				json.addProperty("type", entity.getType().getTranslationKey());
				json.addProperty("name", entity.getName().getString());
				mobs.add(json);
			}
		}
		JsonObject root = new JsonObject();
		root.addProperty("type", "entities");
		root.add("players", players);
		root.add("mobs", mobs);
		root.add("items", sampleItems(world, camera, eye, look, range));
		root.addProperty("count", entities.size());
		SkyAppearance.capture(world, eye.x, eye.y, eye.z, config.viewDistance).writeJson(root);
		return root;
	}

	private static JsonArray sampleItems(ServerWorld world, CameraRecord camera, Vec3d eye, Vec3d look, double range) {
		JsonArray items = new JsonArray();
		Box box = new Box(eye, eye).expand(range);
		List<ItemEntity> drops = world.getEntitiesByClass(ItemEntity.class, box, entity -> {
			double dx = entity.getX() - eye.x;
			double dy = entity.getY() - eye.y;
			double dz = entity.getZ() - eye.z;
			double dist2 = dx * dx + dy * dy + dz * dz;
			if (dist2 > range * range) {
				return false;
			}
			if (dist2 < 4) {
				return true;
			}
			double inv = 1.0 / Math.sqrt(dist2);
			return dx * inv * look.x + dy * inv * look.y + dz * inv * look.z > 0.05;
		});
		for (ItemEntity entity : drops) {
			JsonObject json = new JsonObject();
			json.addProperty("uuid", entity.getUuidAsString());
			json.addProperty("x", entity.getX());
			json.addProperty("y", entity.getY());
			json.addProperty("z", entity.getZ());
			json.addProperty("age", entity.getItemAge());
			json.addProperty("uniqueOffset", entity.uniqueOffset);
			ItemStack stack = entity.getStack();
			JsonObject held = stackJson(world, stack);
			for (var entry : held.entrySet()) {
				json.add(entry.getKey(), entry.getValue());
			}
			json.addProperty("name", stack.getName().getString());
			items.add(json);
		}
		return items;
	}

	private static JsonObject stackJson(ServerWorld world, ItemStack stack) {
		JsonObject json = new JsonObject();
		if (stack == null || stack.isEmpty()) {
			json.addProperty("item", "");
			json.addProperty("block", "");
			json.addProperty("cube", false);
			json.addProperty("color", 0xC8C8C8);
			return json;
		}
		int color = 0xC8C8C8;
		String blockId = "";
		boolean cube = false;
		if (stack.getItem() instanceof BlockItem blockItem) {
			BlockState def = blockItem.getBlock().getDefaultState();
			blockId = Registries.BLOCK.getId(blockItem.getBlock()).getPath();
			cube = Block.isShapeFullCube(def.getCollisionShape(world, BlockPos.ORIGIN));
			var mapColor = def.getMapColor(world, BlockPos.ORIGIN);
			if (mapColor != null) {
				color = mapColor.color;
			}
		}
		json.addProperty("block", blockId);
		json.addProperty("cube", cube);
		json.addProperty("item", Registries.ITEM.getId(stack.getItem()).getPath());
		json.addProperty("color", color);
		return json;
	}

	private static JsonObject armorJson(LivingEntity entity) {
		JsonObject json = new JsonObject();
		json.addProperty("head", armorMaterial(entity.getEquippedStack(EquipmentSlot.HEAD)));
		json.addProperty("chest", armorMaterial(entity.getEquippedStack(EquipmentSlot.CHEST)));
		json.addProperty("legs", armorMaterial(entity.getEquippedStack(EquipmentSlot.LEGS)));
		json.addProperty("feet", armorMaterial(entity.getEquippedStack(EquipmentSlot.FEET)));
		return json;
	}

	private static String armorMaterial(ItemStack stack) {
		if (stack == null || stack.isEmpty()) {
			return "";
		}
		String id = Registries.ITEM.getId(stack.getItem()).getPath();
		String[] suffixes = {"_helmet", "_chestplate", "_leggings", "_boots"};
		for (String suffix : suffixes) {
			if (id.endsWith(suffix)) {
				String mat = id.substring(0, id.length() - suffix.length());
				if (mat.equals("golden")) {
					return "gold";
				}
				if (mat.equals("turtle")) {
					return "turtle_scute";
				}
				return mat;
			}
		}
		if (id.equals("turtle_helmet")) {
			return "turtle_scute";
		}
		return "";
	}

	private static boolean visible(ServerWorld world, CameraRecord camera, Vec3d eye, Vec3d look, LivingEntity entity, double range) {
		if (entity instanceof ServerPlayerEntity player && player.isSpectator()) {
			return false;
		}
		if (entity.isInvisible()) {
			return false;
		}
		Vec3d target = entity.getEyePos();
		Vec3d delta = target.subtract(eye);
		if (delta.lengthSquared() > range * range) {
			return false;
		}
		if (delta.normalize().dotProduct(look.normalize()) < 0.15) {
			return false;
		}
		return true;
	}

	public static boolean inViewBox(CameraRecord camera, int x, int y, int z, int range) {
		int dx = x - camera.x();
		int dy = y - camera.y();
		int dz = z - camera.z();
		return dx * dx + dy * dy + dz * dz <= (range + 8) * (range + 8);
	}
}
