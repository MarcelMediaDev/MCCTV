package com.mcctv.mesh;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import javax.imageio.ImageIO;

import com.mcctv.McCctv;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;

public final class ItemTextures {
	private static final Map<String, BufferedImage> CACHE = new HashMap<>();
	private static final Map<String, byte[]> PNG = new HashMap<>();
	private static boolean loaded;

	private ItemTextures() {
	}

	public static synchronized byte[] png(String rawName) {
		ensureLoaded();
		String name = sanitize(rawName);
		if (name.isEmpty()) {
			return new byte[0];
		}
		byte[] cached = PNG.get(name);
		if (cached != null) {
			return cached;
		}
		BufferedImage image = crop(CACHE.get(name));
		if (image == null) {
			image = BlockTextures.getRaw(name);
		}
		if (image == null) {
			image = BlockTextures.get(name, 0xC8C8C8);
		}
		try {
			byte[] png = BlockTextures.png(image);
			PNG.put(name, png);
			return png;
		} catch (IOException e) {
			return new byte[0];
		}
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

	private static BufferedImage crop(BufferedImage image) {
		if (image == null) {
			return null;
		}
		if (image.getWidth() >= 16 && image.getHeight() > 16) {
			return image.getSubimage(0, 0, 16, Math.min(16, image.getHeight()));
		}
		return image;
	}

	private static void ensureLoaded() {
		if (loaded) {
			return;
		}
		loaded = true;
		int bundled = VanillaPack.loadIndexed(
				"/assets/mcctv/vanilla/item-index.txt",
				"/assets/mcctv/vanilla/item/",
				CACHE);
		try {
			ModContainer container = FabricLoader.getInstance().getModContainer("minecraft").orElse(null);
			if (container != null) {
				for (Path path : container.getRootPaths()) {
					loadFromPath(path);
				}
			}
		} catch (Exception e) {
			McCctv.LOGGER.warn("Could not index vanilla item textures from Minecraft jar", e);
		}
		McCctv.LOGGER.info("MCCTV item textures: {} bundled, {} total", bundled, CACHE.size());
	}

	private static void loadFromPath(Path root) throws IOException {
		if (Files.isDirectory(root)) {
			Path textures = root.resolve("assets/minecraft/textures/item");
			if (Files.isDirectory(textures)) {
				try (var stream = Files.list(textures)) {
					stream.filter(p -> p.getFileName().toString().endsWith(".png")).forEach(ItemTextures::readFile);
				}
			}
			return;
		}
		String name = root.toString();
		if (name.endsWith(".jar") || name.endsWith(".zip")) {
			try (ZipFile zip = new ZipFile(root.toFile())) {
				var entries = zip.entries();
				while (entries.hasMoreElements()) {
					ZipEntry entry = entries.nextElement();
					String path = entry.getName();
					if (path.startsWith("assets/minecraft/textures/item/") && path.endsWith(".png")) {
						String key = path.substring("assets/minecraft/textures/item/".length(), path.length() - 4);
						if (key.contains("/")) {
							continue;
						}
						try (InputStream in = zip.getInputStream(entry)) {
							BufferedImage image = ImageIO.read(in);
							if (image != null) {
								CACHE.put(key, image);
							}
						} catch (IOException ignored) {
						}
					}
				}
			}
			return;
		}
		try (FileSystem fs = FileSystems.newFileSystem(root)) {
			loadFromPath(fs.getPath("/"));
		} catch (Exception ignored) {
		}
	}

	private static void readFile(Path path) {
		try (InputStream in = Files.newInputStream(path)) {
			BufferedImage image = ImageIO.read(in);
			if (image != null) {
				String filename = path.getFileName().toString();
				CACHE.put(filename.substring(0, filename.length() - 4), image);
			}
		} catch (IOException ignored) {
		}
	}
}
