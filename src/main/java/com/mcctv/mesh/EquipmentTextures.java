package com.mcctv.mesh;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import com.mcctv.McCctv;

public final class EquipmentTextures {
	private static final Map<String, byte[]> PNG = new HashMap<>();
	private static final Map<String, BufferedImage> HUMANOID = new HashMap<>();
	private static final Map<String, BufferedImage> LEGGINGS = new HashMap<>();
	private static boolean loaded;

	private EquipmentTextures() {
	}

	public static synchronized byte[] png(String layer, String material) {
		ensureLoaded();
		String key = sanitize(layer) + "/" + sanitize(material);
		if (key.length() < 3) {
			return new byte[0];
		}
		byte[] cached = PNG.get(key);
		if (cached != null) {
			return cached;
		}
		BufferedImage image = "humanoid_leggings".equals(sanitize(layer))
				? lookup(LEGGINGS, material)
				: lookup(HUMANOID, material);
		if (image == null) {
			return new byte[0];
		}
		try {
			byte[] png = BlockTextures.png(image);
			PNG.put(key, png);
			return png;
		} catch (IOException e) {
			return new byte[0];
		}
	}

	private static BufferedImage lookup(Map<String, BufferedImage> cache, String material) {
		String name = sanitize(material);
		BufferedImage image = cache.get(name);
		if (image != null) {
			return image;
		}
		if (name.equals("golden")) {
			return cache.get("gold");
		}
		if (name.equals("turtle")) {
			return cache.get("turtle_scute");
		}
		return cache.get(name.replace("_scute", ""));
	}

	private static String sanitize(String name) {
		if (name == null) {
			return "";
		}
		int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
		if (slash >= 0) {
			name = name.substring(slash + 1);
		}
		if (name.endsWith(".png") || name.endsWith(".PNG")) {
			name = name.substring(0, name.length() - 4);
		}
		StringBuilder out = new StringBuilder(name.length());
		for (int i = 0; i < name.length(); i++) {
			char c = Character.toLowerCase(name.charAt(i));
			if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
				out.append(c);
			}
		}
		return out.toString();
	}

	private static void ensureLoaded() {
		if (loaded) {
			return;
		}
		loaded = true;
		int humanoid = VanillaPack.loadIndexed(
				"/assets/mcctv/vanilla/humanoid-index.txt",
				"/assets/mcctv/vanilla/entity/equipment/humanoid/",
				HUMANOID);
		int leggings = VanillaPack.loadIndexed(
				"/assets/mcctv/vanilla/humanoid-leggings-index.txt",
				"/assets/mcctv/vanilla/entity/equipment/humanoid_leggings/",
				LEGGINGS);
		McCctv.LOGGER.info("MCCTV armor textures: {} humanoid, {} leggings", humanoid, leggings);
	}
}
