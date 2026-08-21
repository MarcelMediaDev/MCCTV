package com.mcctv.mesh;

import java.awt.image.BufferedImage;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import javax.imageio.ImageIO;

import com.mcctv.McCctv;

final class VanillaPack {
	private VanillaPack() {
	}

	static int loadIndexed(String indexResource, String folderResource, Map<String, BufferedImage> cache) {
		int loaded = 0;
		try (InputStream index = VanillaPack.class.getResourceAsStream(indexResource)) {
			if (index == null) {
				return 0;
			}
			BufferedReader reader = new BufferedReader(new InputStreamReader(index, StandardCharsets.UTF_8));
			String line;
			while ((line = reader.readLine()) != null) {
				line = line.trim();
				if (line.isEmpty() || cache.containsKey(line)) {
					continue;
				}
				try (InputStream png = VanillaPack.class.getResourceAsStream(folderResource + line + ".png")) {
					if (png == null) {
						continue;
					}
					BufferedImage image = ImageIO.read(png);
					if (image != null) {
						cache.put(line, image);
						loaded++;
					}
				} catch (IOException ignored) {
				}
			}
		} catch (IOException e) {
			McCctv.LOGGER.warn("Could not read {}", indexResource, e);
		}
		return loaded;
	}
}
