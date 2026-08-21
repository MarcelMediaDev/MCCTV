package com.mcctv.camera;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mcctv.McCctv;
import com.mojang.serialization.JsonOps;
import net.minecraft.component.DataComponentTypes;
import net.minecraft.component.type.ProfileComponent;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.text.Text;

import java.util.UUID;

public final class CameraItemFactory {
	private CameraItemFactory() {
	}

	public static ItemStack create() {
		ItemStack stack = new ItemStack(Items.PLAYER_HEAD);
		stack.set(DataComponentTypes.ITEM_NAME, Text.literal("CCTV Camera"));
		stack.set(DataComponentTypes.PROFILE, profile());
		return stack;
	}

	public static ProfileComponent profile() {
		JsonObject json = new JsonObject();
		json.addProperty("name", CameraIds.PROFILE_NAME);
		json.add("id", uuidInts(CameraIds.PROFILE_UUID));
		json.addProperty("texture", "mcctv:entity/camera");
		json.addProperty("model", "wide");
		return ProfileComponent.CODEC.parse(JsonOps.INSTANCE, json)
				.resultOrPartial(msg -> McCctv.LOGGER.error("Invalid CCTV profile: {}", msg))
				.orElseThrow(() -> new IllegalStateException("Could not create CCTV camera profile"));
	}

	private static JsonArray uuidInts(UUID uuid) {
		JsonArray array = new JsonArray();
		long msb = uuid.getMostSignificantBits();
		long lsb = uuid.getLeastSignificantBits();
		array.add((int) (msb >> 32));
		array.add((int) msb);
		array.add((int) (lsb >> 32));
		array.add((int) lsb);
		return array;
	}

	public static boolean isCamera(ItemStack stack) {
		if (stack == null || stack.isEmpty() || !stack.isOf(Items.PLAYER_HEAD)) {
			return false;
		}
		return isCamera(stack.get(DataComponentTypes.PROFILE));
	}

	public static boolean isCamera(ProfileComponent profile) {
		if (profile == null) {
			return false;
		}
		if (profile.getName().filter(CameraIds.PROFILE_NAME::equals).isPresent()) {
			return true;
		}
		try {
			return CameraIds.PROFILE_UUID.equals(profile.getGameProfile().id());
		} catch (Exception ignored) {
			return false;
		}
	}
}
