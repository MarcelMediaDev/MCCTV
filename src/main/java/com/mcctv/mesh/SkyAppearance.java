package com.mcctv.mesh;

import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.MathHelper;
import net.minecraft.world.World;
import net.minecraft.world.biome.Biome;

public record SkyAppearance(
		float timeOfDay,
		float skyAngle,
		float skyBrightness,
		float skyR,
		float skyG,
		float skyB,
		float fogR,
		float fogG,
		float fogB,
		float fogNear,
		float fogFar
) {
	public static SkyAppearance capture(ServerWorld world, double x, double y, double z, int viewDistance) {
		float range = Math.max(16f, viewDistance);
		float fogNear = range * 0.72f;
		float fogFar = range * 1.08f;
		float angle = skyAngle(world.getTimeOfDay());
		if (world.getRegistryKey() == World.NETHER) {
			return new SkyAppearance(world.getTimeOfDay() % 24000, angle, 1f, 0.22f, 0.04f, 0.04f, 0.32f, 0.1f, 0.08f, 2f, 28f);
		}
		if (world.getRegistryKey() == World.END) {
			return new SkyAppearance(world.getTimeOfDay() % 24000, angle, 0.9f, 0.16f, 0.12f, 0.2f, 0.18f, 0.14f, 0.22f, 24f, 96f);
		}
		Biome biome = world.getBiome(BlockPos.ofFloored(x, y, z)).value();
		int skyRgb = MathHelper.hsvToRgb(0.6222222f - MathHelper.clamp(biome.getTemperature() / 3f, -1f, 1f) * 0.05f, 0.5f, 1f);
		float cos = MathHelper.cos(angle * ((float) Math.PI * 2f));
		float celestial = MathHelper.clamp(cos * 2f + 0.5f, 0f, 1f);
		float moon = MathHelper.clamp(-cos * 2f + 0.5f, 0f, 1f);
		float skyBrightness = celestial * 0.7f + 0.24f + moon * 0.08f;
		float dayR = ((skyRgb >> 16) & 0xFF) / 255f;
		float dayG = ((skyRgb >> 8) & 0xFF) / 255f;
		float dayB = (skyRgb & 0xFF) / 255f;
		float sr = MathHelper.lerp(celestial, 0.04f + moon * 0.03f, dayR);
		float sg = MathHelper.lerp(celestial, 0.05f + moon * 0.04f, dayG);
		float sb = MathHelper.lerp(celestial, 0.11f + moon * 0.06f, dayB);
		float dusk = Math.abs(cos) <= 0.45f ? MathHelper.clamp(1f - Math.abs(cos) / 0.45f, 0f, 1f) : 0f;
		float haze = 0.1f + 0.06f * celestial;
		float fogR = MathHelper.clamp(sr * (1f - haze) + haze * sr * 1.08f, 0f, 1f);
		float fogG = MathHelper.clamp(sg * (1f - haze) + haze * sg * 1.04f, 0f, 1f);
		float fogB = MathHelper.clamp(sb * (1f - haze) + haze * sb * 1.02f, 0f, 1f);
		fogR = MathHelper.lerp(dusk * 0.28f, fogR, 1f);
		fogG = MathHelper.lerp(dusk * 0.28f, fogG, 0.58f);
		fogB = MathHelper.lerp(dusk * 0.28f, fogB, 0.32f);
		float rain = world.getRainGradient(1f);
		if (rain > 0f) {
			float gray = sr * 0.3f + sg * 0.5f + sb * 0.2f;
			fogR = MathHelper.lerp(rain * 0.4f, fogR, gray);
			fogG = MathHelper.lerp(rain * 0.4f, fogG, gray);
			fogB = MathHelper.lerp(rain * 0.4f, fogB, gray);
			skyBrightness *= 1f - rain * 0.18f;
			fogNear *= 1f - rain * 0.2f;
			fogFar *= 1f - rain * 0.12f;
		}
		return new SkyAppearance(world.getTimeOfDay() % 24000, angle, skyBrightness, sr, sg, sb, fogR, fogG, fogB, fogNear, fogFar);
	}

	private static float skyAngle(long timeOfDay) {
		double d = MathHelper.fractionalPart(timeOfDay / 24000.0 - 0.25);
		double e = 0.5 - Math.cos(d * Math.PI) / 2.0;
		return (float) ((d * 2.0 + e) / 3.0);
	}

	public void writeJson(com.google.gson.JsonObject json) {
		json.addProperty("timeOfDay", this.timeOfDay);
		json.addProperty("skyAngle", this.skyAngle);
		json.addProperty("skyBrightness", this.skyBrightness);
		json.addProperty("skyR", this.skyR);
		json.addProperty("skyG", this.skyG);
		json.addProperty("skyB", this.skyB);
		json.addProperty("fogR", this.fogR);
		json.addProperty("fogG", this.fogG);
		json.addProperty("fogB", this.fogB);
		json.addProperty("fogNear", this.fogNear);
		json.addProperty("fogFar", this.fogFar);
	}
}
