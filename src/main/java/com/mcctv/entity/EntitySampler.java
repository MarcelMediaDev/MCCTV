package com.mcctv.entity;

import com.mcctv.CctvConfig;
import com.mcctv.camera.CameraRecord;
import com.mcctv.mesh.SkyAppearance;
import com.mcctv.mesh.MobTextures;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.block.entity.SignText;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.TntEntity;
import net.minecraft.entity.decoration.ArmorStandEntity;
import net.minecraft.entity.decoration.ItemFrameEntity;
import net.minecraft.block.Oxidizable;
import net.minecraft.entity.mob.BoggedEntity;
import net.minecraft.entity.mob.ShulkerEntity;
import net.minecraft.entity.mob.ZombieVillagerEntity;
import net.minecraft.entity.passive.StriderEntity;
import net.minecraft.entity.passive.AxolotlEntity;
import net.minecraft.entity.passive.BatEntity;
import net.minecraft.entity.passive.BeeEntity;
import net.minecraft.entity.passive.CatEntity;
import net.minecraft.entity.passive.ChickenEntity;
import net.minecraft.entity.passive.CopperGolemEntity;
import net.minecraft.entity.passive.FoxEntity;
import net.minecraft.entity.passive.FrogEntity;
import net.minecraft.entity.passive.IronGolemEntity;
import net.minecraft.entity.passive.LlamaEntity;
import net.minecraft.entity.passive.MooshroomEntity;
import net.minecraft.entity.passive.PandaEntity;
import net.minecraft.entity.passive.ParrotEntity;
import net.minecraft.entity.passive.PufferfishEntity;
import net.minecraft.entity.passive.RabbitEntity;
import net.minecraft.entity.passive.SalmonEntity;
import net.minecraft.entity.passive.SheepEntity;
import net.minecraft.entity.passive.TropicalFishEntity;
import net.minecraft.entity.passive.TurtleEntity;
import net.minecraft.entity.passive.SnowGolemEntity;
import net.minecraft.entity.passive.VillagerEntity;
import net.minecraft.entity.passive.WanderingTraderEntity;
import net.minecraft.registry.entry.RegistryEntry;
import net.minecraft.village.VillagerData;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.BlockItem;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.state.property.Properties;
import net.minecraft.util.Arm;
import net.minecraft.util.Hand;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.DyeColor;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.EulerAngle;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.chunk.WorldChunk;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class EntitySampler {
	private static final Map<UUID, Vec3d> LAST_POS = new HashMap<>();

	private EntitySampler() {
	}

	public static JsonObject sample(ServerWorld world, CameraRecord camera, CctvConfig config) {
		Vec3d look = camera.look();
		Vec3d eye = camera.eye();
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
			json.addProperty("headYaw", entity.getHeadYaw());
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
				String type = Registries.ENTITY_TYPE.getId(entity.getType()).getPath();
				json.addProperty("uuid", entity.getUuidAsString());
				json.addProperty("type", type);
				json.addProperty("tex", skinOf(entity, type));
				json.addProperty("name", entity.getName().getString());
				json.addProperty("baby", entity.isBaby());
				json.addProperty("w", entity.getWidth());
				json.addProperty("h", entity.getHeight());
				if (entity instanceof SheepEntity sheep) {
					json.addProperty("sheared", sheep.isSheared());
					json.addProperty("wool", woolHex(sheep.getColor()));
				}
				if (entity instanceof BoggedEntity bogged) {
					json.addProperty("sheared", bogged.isSheared());
				}
				if (entity instanceof ChickenEntity chicken) {
					json.addProperty("flap", chicken.flapProgress);
					json.addProperty("wing", chicken.maxWingDeviation);
					json.addProperty("air", !chicken.isOnGround());
				}
				if (entity instanceof ParrotEntity parrot) {
					json.addProperty("flap", parrot.flapProgress);
					json.addProperty("wing", parrot.maxWingDeviation);
					json.addProperty("air", parrot.isInAir() && !parrot.hasVehicle());
				}
				if (entity instanceof BatEntity bat) {
					json.addProperty("roost", bat.isRoosting());
					json.addProperty("air", !bat.isRoosting());
				}
				if (entity instanceof BeeEntity bee) {
					json.addProperty("air", !bee.isOnGround());
				}
				if (entity instanceof VillagerEntity villager) {
					putVillager(json, villager.getVillagerData());
				}
				if (entity instanceof ZombieVillagerEntity zombieVillager) {
					putVillager(json, zombieVillager.getVillagerData());
				}
				if (entity instanceof IronGolemEntity golem) {
					String crack = golem.getCrackLevel().name().toLowerCase();
					if (!crack.isEmpty() && !"none".equals(crack)) {
						json.addProperty("crack", crack);
					}
				}
				if (entity instanceof SnowGolemEntity snow) {
					json.addProperty("pumpkin", snow.hasPumpkin());
				}
				if (entity instanceof PufferfishEntity puffer) {
					json.addProperty("puff", puffer.getPuffState());
				}
				if (entity instanceof SalmonEntity salmon) {
					json.addProperty("scale", salmon.getVariantScale());
				}
				if (entity instanceof TropicalFishEntity fish) {
					boolean large = fish.getVariety().getSize() == TropicalFishEntity.Size.LARGE;
					json.addProperty("fishSize", large ? "large" : "small");
					json.addProperty("fishPat", fish.getVariety().getIndex());
					json.addProperty("baseCol", dyeHex(fish.getBaseColor()));
					json.addProperty("patCol", dyeHex(fish.getPatternColor()));
				}
				if (entity instanceof TurtleEntity turtle) {
					json.addProperty("egg", turtle.hasEgg());
				}
				if (entity instanceof ArmorStandEntity stand) {
					json.add("armor", armorJson(stand));
					json.addProperty("arms", stand.shouldShowArms());
					json.addProperty("base", stand.shouldShowBasePlate());
					json.addProperty("invis", stand.isInvisible());
					json.add("hp", eulerJson(stand.getHeadRotation()));
					json.add("bp", eulerJson(stand.getBodyRotation()));
					json.add("la", eulerJson(stand.getLeftArmRotation()));
					json.add("ra", eulerJson(stand.getRightArmRotation()));
					json.add("ll", eulerJson(stand.getLeftLegRotation()));
					json.add("rl", eulerJson(stand.getRightLegRotation()));
				}
				ItemStack held = ItemStack.EMPTY;
				if (entity instanceof WanderingTraderEntity || entity.isUsingItem()) {
					held = entity.getActiveItem();
				}
				if (held.isEmpty()) {
					held = entity.getEquippedStack(EquipmentSlot.MAINHAND);
				}
				if (!held.isEmpty()) {
					json.add("hand", stackJson(world, held));
					json.addProperty("using", entity.isUsingItem());
				}
				mobs.add(json);
			}
		}
		JsonObject root = new JsonObject();
		root.addProperty("type", "entities");
		root.add("players", players);
		root.add("mobs", mobs);
		root.add("items", sampleItems(world, camera, eye, look, range));
		root.add("tnt", sampleTnt(world, camera, eye, look, range));
		root.add("frames", sampleFrames(world, camera, eye, look, range));
		root.add("signs", sampleSigns(world, camera, eye, look, range));
		root.addProperty("count", entities.size());
		SkyAppearance.capture(world, eye.x, eye.y, eye.z, config.viewDistance).writeJson(root);
		return root;
	}

	private static String skinOf(LivingEntity entity, String type) {
		if (entity instanceof CatEntity cat) {
			String key = assetTex(cat.getVariant().value().assetInfo().id());
			if (!key.isEmpty()) {
				return MobTextures.guess(key);
			}
		}
		if (entity instanceof ParrotEntity parrot) {
			String id = parrot.getVariant().asString();
			if ("gray".equals(id)) {
				id = "grey";
			}
			return MobTextures.guess("parrot/parrot_" + id);
		}
		if (entity instanceof FoxEntity fox) {
			String base = "snow".equals(fox.getVariant().asString()) ? "fox/snow_fox" : "fox/fox";
			if (fox.isSleeping()) {
				base += "_sleep";
			}
			return MobTextures.guess(base);
		}
		if (entity instanceof LlamaEntity llama) {
			return MobTextures.guess("llama/" + llama.getVariant().asString());
		}
		if (entity instanceof PandaEntity panda) {
			String gene = panda.getProductGene().asString();
			if ("normal".equals(gene)) {
				return MobTextures.guess("panda/panda");
			}
			return MobTextures.guess("panda/" + gene + "_panda");
		}
		if (entity instanceof BeeEntity bee) {
			boolean angry = bee.hasAngerTime();
			boolean nectar = bee.hasNectar();
			if (angry && nectar) {
				return MobTextures.guess("bee/bee_angry_nectar");
			}
			if (angry) {
				return MobTextures.guess("bee/bee_angry");
			}
			if (nectar) {
				return MobTextures.guess("bee/bee_nectar");
			}
			return MobTextures.guess("bee/bee");
		}
		if (entity instanceof RabbitEntity rabbit) {
			net.minecraft.text.Text named = rabbit.getCustomName();
			if (named != null && "Toast".equals(named.getString())) {
				return MobTextures.guess("rabbit/toast");
			}
			String id = rabbit.getVariant().asString();
			if ("evil".equals(id)) {
				return MobTextures.guess("rabbit/caerbannog");
			}
			return MobTextures.guess("rabbit/" + id);
		}
		if (entity instanceof MooshroomEntity mooshroom) {
			String id = mooshroom.getVariant().asString();
			if ("brown".equals(id)) {
				return MobTextures.guess("cow/brown_mooshroom");
			}
			return MobTextures.guess("cow/red_mooshroom");
		}
		if (entity instanceof CopperGolemEntity copper) {
			Oxidizable.OxidationLevel ox = copper.getOxidationLevel();
			if (ox == Oxidizable.OxidationLevel.EXPOSED) {
				return MobTextures.guess("copper_golem/exposed_copper_golem");
			}
			if (ox == Oxidizable.OxidationLevel.WEATHERED) {
				return MobTextures.guess("copper_golem/weathered_copper_golem");
			}
			if (ox == Oxidizable.OxidationLevel.OXIDIZED) {
				return MobTextures.guess("copper_golem/oxidized_copper_golem");
			}
			return MobTextures.guess("copper_golem/copper_golem");
		}
		if (entity instanceof ShulkerEntity shulker) {
			DyeColor color = shulker.getColor();
			if (color != null) {
				return MobTextures.guess("shulker/shulker_" + color.asString());
			}
			return MobTextures.guess("shulker/shulker");
		}
		if (entity instanceof StriderEntity strider) {
			return MobTextures.guess(strider.isCold() ? "strider/strider_cold" : "strider/strider");
		}
		if (entity instanceof AxolotlEntity axolotl) {
			return MobTextures.guess("axolotl/axolotl_" + axolotl.getVariant().asString());
		}
		if (entity instanceof FrogEntity frog) {
			return MobTextures.guess("frog/" + entryPath(frog.getVariant(), "temperate") + "_frog");
		}
		if (entity instanceof TropicalFishEntity fish) {
			boolean large = fish.getVariety().getSize() == TropicalFishEntity.Size.LARGE;
			return MobTextures.guess(large ? "fish/tropical_b" : "fish/tropical_a");
		}
		return MobTextures.guess(type);
	}

	private static void putVillager(JsonObject json, VillagerData data) {
		json.addProperty("vType", entryPath(data.type(), "plains"));
		json.addProperty("vJob", entryPath(data.profession(), "none"));
		int level = data.level();
		if (level >= 2 && level <= 6) {
			String[] badges = { "", "stone", "iron", "gold", "emerald", "diamond" };
			json.addProperty("vLevel", badges[Math.min(level, 5)]);
		}
	}

	private static String entryPath(RegistryEntry<?> entry, String fallback) {
		if (entry == null) {
			return fallback;
		}
		return entry.getKey().map(key -> key.getValue().getPath()).orElse(fallback);
	}

	private static String assetTex(Identifier id) {
		if (id == null) {
			return "";
		}
		String path = id.getPath();
		if (path.startsWith("textures/entity/")) {
			path = path.substring("textures/entity/".length());
		} else if (path.startsWith("entity/")) {
			path = path.substring("entity/".length());
		}
		if (path.endsWith(".png")) {
			path = path.substring(0, path.length() - 4);
		}
		return path;
	}

	private static String dyeHex(DyeColor dye) {
		if (dye == null) {
			return "FFFFFF";
		}
		int rgb = dye.getEntityColor();
		return String.format("%06X", rgb & 0xFFFFFF);
	}

	private static String woolHex(DyeColor dye) {
		if (dye == null || dye == DyeColor.WHITE) {
			return "E6E6E6";
		}
		int rgb = dye.getEntityColor();
		int r = (int) (((rgb >> 16) & 255) * 0.75f);
		int g = (int) (((rgb >> 8) & 255) * 0.75f);
		int b = (int) ((rgb & 255) * 0.75f);
		return String.format("%06X", (r << 16) | (g << 8) | b);
	}

	private static JsonArray sampleFrames(ServerWorld world, CameraRecord camera, Vec3d eye, Vec3d look, double range) {
		JsonArray frames = new JsonArray();
		Box box = new Box(eye, eye).expand(range);
		List<ItemFrameEntity> found = world.getEntitiesByClass(ItemFrameEntity.class, box,
				entity -> inView(eye, look, entity.getX(), entity.getY(), entity.getZ(), range));
		for (ItemFrameEntity entity : found) {
			JsonObject json = new JsonObject();
			json.addProperty("uuid", entity.getUuidAsString());
			json.addProperty("x", entity.getX());
			json.addProperty("y", entity.getY());
			json.addProperty("z", entity.getZ());
			Direction facing = entity.getHorizontalFacing();
			json.addProperty("facing", facing.getId());
			json.addProperty("rotation", entity.getRotation());
			String type = Registries.ENTITY_TYPE.getId(entity.getType()).getPath();
			json.addProperty("glow", type.contains("glow"));
			json.addProperty("frame", type.contains("glow") ? "glow_item_frame" : "item_frame");
			ItemStack stack = entity.getHeldItemStack();
			JsonObject held = stackJson(world, stack);
			for (var entry : held.entrySet()) {
				json.add(entry.getKey(), entry.getValue());
			}
			frames.add(json);
		}
		return frames;
	}

	private static JsonArray sampleSigns(ServerWorld world, CameraRecord camera, Vec3d eye, Vec3d look, double range) {
		JsonArray signs = new JsonArray();
		int minCx = MathHelper.floor(eye.x - range) >> 4;
		int maxCx = MathHelper.floor(eye.x + range) >> 4;
		int minCz = MathHelper.floor(eye.z - range) >> 4;
		int maxCz = MathHelper.floor(eye.z + range) >> 4;
		for (int cx = minCx; cx <= maxCx; cx++) {
			for (int cz = minCz; cz <= maxCz; cz++) {
				WorldChunk chunk = world.getChunk(cx, cz);
				for (BlockEntity be : chunk.getBlockEntities().values()) {
					if (!(be instanceof SignBlockEntity sign)) {
						continue;
					}
					BlockPos pos = sign.getPos();
					if (!inView(eye, look, pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5, range)) {
						continue;
					}
					BlockState state = sign.getCachedState();
					String id = Registries.BLOCK.getId(state.getBlock()).getPath();
					JsonObject json = new JsonObject();
					json.addProperty("uuid", "sign:" + pos.getX() + "," + pos.getY() + "," + pos.getZ());
					json.addProperty("x", pos.getX());
					json.addProperty("y", pos.getY());
					json.addProperty("z", pos.getZ());
					json.addProperty("hanging", id.contains("hanging"));
					json.addProperty("wall", id.contains("wall"));
					int rotation = 0;
					if (state.contains(Properties.ROTATION)) {
						rotation = state.get(Properties.ROTATION);
					}
					json.addProperty("rotation", rotation);
					Direction facing = Direction.SOUTH;
					if (state.contains(Properties.HORIZONTAL_FACING)) {
						facing = state.get(Properties.HORIZONTAL_FACING);
					}
					json.addProperty("facing", facing.getId());
					json.add("front", signSideJson(sign.getFrontText()));
					json.add("back", signSideJson(sign.getBackText()));
					signs.add(json);
				}
			}
		}
		return signs;
	}

	private static JsonObject signSideJson(SignText text) {
		JsonObject json = new JsonObject();
		JsonArray lines = new JsonArray();
		for (int i = 0; i < 4; i++) {
			lines.add(text.getMessage(i, false).getString());
		}
		json.add("lines", lines);
		DyeColor dye = text.getColor();
		int rgb = dye != null ? dye.getSignColor() : 0;
		json.addProperty("color", String.format("#%06X", rgb & 0xFFFFFF));
		json.addProperty("glow", text.isGlowing());
		return json;
	}

	private static JsonArray sampleTnt(ServerWorld world, CameraRecord camera, Vec3d eye, Vec3d look, double range) {
		JsonArray tnt = new JsonArray();
		Box box = new Box(eye, eye).expand(range);
		List<TntEntity> primed = world.getEntitiesByClass(TntEntity.class, box, entity -> inView(eye, look, entity.getX(), entity.getY() + 0.49, entity.getZ(), range));
		for (TntEntity entity : primed) {
			JsonObject json = new JsonObject();
			json.addProperty("uuid", entity.getUuidAsString());
			json.addProperty("x", entity.getX());
			json.addProperty("y", entity.getY());
			json.addProperty("z", entity.getZ());
			json.addProperty("fuse", entity.getFuse());
			tnt.add(json);
		}
		return tnt;
	}

	private static boolean inView(Vec3d eye, Vec3d look, double x, double y, double z, double range) {
		double dx = x - eye.x;
		double dy = y - eye.y;
		double dz = z - eye.z;
		double dist2 = dx * dx + dy * dy + dz * dz;
		if (dist2 > range * range) {
			return false;
		}
		if (dist2 < 4) {
			return true;
		}
		double inv = 1.0 / Math.sqrt(dist2);
		return dx * inv * look.x + dy * inv * look.y + dz * inv * look.z > 0.05;
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

	private static JsonArray eulerJson(EulerAngle angle) {
		JsonArray json = new JsonArray();
		if (angle == null) {
			json.add(0);
			json.add(0);
			json.add(0);
			return json;
		}
		json.add(angle.pitch());
		json.add(angle.yaw());
		json.add(angle.roll());
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
		if (entity instanceof ArmorStandEntity stand) {
			if (stand.isMarker()) {
				return false;
			}
		} else if (entity.isInvisible()) {
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
