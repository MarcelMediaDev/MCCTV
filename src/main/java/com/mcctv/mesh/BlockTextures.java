package com.mcctv.mesh;

import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import javax.imageio.ImageIO;

import com.mcctv.McCctv;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;

public final class BlockTextures {
	private static final Map<String, BufferedImage> CACHE = new HashMap<>();
	private static boolean loaded;

	private BlockTextures() {
	}

	public static synchronized boolean has(String name) {
		ensureLoaded();
		return CACHE.containsKey(name);
	}

	public static synchronized Set<String> names() {
		ensureLoaded();
		return Set.copyOf(CACHE.keySet());
	}

	public static synchronized BufferedImage getRaw(String name) {
		ensureLoaded();
		return crop(CACHE.get(name), name);
	}

	public static synchronized BufferedImage get(String name, int fallbackColor) {
		ensureLoaded();
		int at = name.indexOf('@');
		if (at > 0) {
			BufferedImage region = cropRegion(CACHE.get(name.substring(0, at)), name.substring(at + 1));
			if (region != null) {
				return region;
			}
			name = name.substring(0, at);
		}
		BufferedImage image = crop(CACHE.get(name), name);
		if (image != null) {
			return image;
		}
		if (name.endsWith("_block")) {
			image = crop(CACHE.get(name.substring(0, name.length() - 6)), name);
			if (image != null) {
				return image;
			}
		}
		image = crop(CACHE.get(name + "_top"), name + "_top");
		if (image != null) {
			return image;
		}
		image = crop(CACHE.get(name + "_side"), name + "_side");
		if (image != null) {
			return image;
		}
		return solid(fallbackColor);
	}

	public static BufferedImage grassSide(int grassRgb) {
		BufferedImage side = copy(get("grass_block_side", 0x866043));
		BufferedImage overlay = getRaw("grass_block_side_overlay");
		if (overlay == null) {
			return side;
		}
		BufferedImage tinted = multiplyTint(overlay, grassRgb);
		int w = Math.min(side.getWidth(), tinted.getWidth());
		int h = Math.min(side.getHeight(), tinted.getHeight());
		for (int y = 0; y < h; y++) {
			for (int x = 0; x < w; x++) {
				int src = tinted.getRGB(x, y);
				int a = (src >>> 24) & 0xFF;
				if (a == 0) {
					continue;
				}
				int dst = side.getRGB(x, y);
				int dr = (dst >> 16) & 0xFF;
				int dg = (dst >> 8) & 0xFF;
				int db = dst & 0xFF;
				int sr = (src >> 16) & 0xFF;
				int sg = (src >> 8) & 0xFF;
				int sb = src & 0xFF;
				int r = (sr * a + dr * (255 - a)) / 255;
				int g = (sg * a + dg * (255 - a)) / 255;
				int b = (sb * a + db * (255 - a)) / 255;
				side.setRGB(x, y, 0xFF000000 | (r << 16) | (g << 8) | b);
			}
		}
		return side;
	}

	public static BufferedImage multiplyTint(BufferedImage src, int rgb) {
		BufferedImage out = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB);
		int tr = (rgb >> 16) & 0xFF;
		int tg = (rgb >> 8) & 0xFF;
		int tb = rgb & 0xFF;
		for (int y = 0; y < src.getHeight(); y++) {
			for (int x = 0; x < src.getWidth(); x++) {
				int p = src.getRGB(x, y);
				int a = (p >>> 24) & 0xFF;
				int r = ((p >> 16) & 0xFF) * tr / 255;
				int g = ((p >> 8) & 0xFF) * tg / 255;
				int b = (p & 0xFF) * tb / 255;
				out.setRGB(x, y, (a << 24) | (r << 16) | (g << 8) | b);
			}
		}
		return out;
	}

	private static BufferedImage cropRegion(BufferedImage src, String spec) {
		if (src == null || spec == null) {
			return null;
		}
		String[] parts = spec.split(",");
		if (parts.length < 4) {
			return null;
		}
		try {
			int u = Integer.parseInt(parts[0].trim());
			int v = Integer.parseInt(parts[1].trim());
			int w = Integer.parseInt(parts[2].trim());
			int h = Integer.parseInt(parts[3].trim());
			boolean rotate = parts.length >= 5 && parts[4].toLowerCase().contains("r");
			boolean scale = parts.length >= 5 && parts[4].toLowerCase().contains("s");
			if (w < 0) {
				u += w;
				w = -w;
			}
			if (h < 0) {
				v += h;
				h = -h;
			}
			u = Math.max(0, Math.min(src.getWidth() - 1, u));
			v = Math.max(0, Math.min(src.getHeight() - 1, v));
			w = Math.max(1, Math.min(src.getWidth() - u, w));
			h = Math.max(1, Math.min(src.getHeight() - v, h));
			BufferedImage part = src.getSubimage(u, v, w, h);
			if (rotate) {
				BufferedImage rotated = new BufferedImage(h, w, BufferedImage.TYPE_INT_ARGB);
				for (int yy = 0; yy < h; yy++) {
					for (int xx = 0; xx < w; xx++) {
						rotated.setRGB(yy, w - 1 - xx, part.getRGB(xx, yy));
					}
				}
				part = rotated;
				int tmp = w;
				w = h;
				h = tmp;
			}
			if (w == 16 && h == 16) {
				return copy(part);
			}
			BufferedImage out = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
			Graphics2D g = out.createGraphics();
			g.setComposite(java.awt.AlphaComposite.Src);
			if (scale || w > 16 || h > 16) {
				g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
				g.drawImage(part, 0, 0, 16, 16, null);
				g.dispose();
				return out;
			}
			g.drawImage(part, 0, 0, null);
			g.dispose();
			clampPad(out, w, h);
			return out;
		} catch (Exception e) {
			return null;
		}
	}

	static boolean regionEmpty(String name, String spec) {
		ensureLoaded();
		int at = name.indexOf('@');
		if (at > 0) {
			spec = name.substring(at + 1);
			name = name.substring(0, at);
		}
		BufferedImage src = CACHE.get(name);
		if (src == null || spec == null) {
			return true;
		}
		String[] parts = spec.split(",");
		if (parts.length < 4) {
			return true;
		}
		try {
			int u = Integer.parseInt(parts[0].trim());
			int v = Integer.parseInt(parts[1].trim());
			int w = Integer.parseInt(parts[2].trim());
			int h = Integer.parseInt(parts[3].trim());
			if (w < 0) {
				u += w;
				w = -w;
			}
			if (h < 0) {
				v += h;
				h = -h;
			}
			u = Math.max(0, Math.min(src.getWidth() - 1, u));
			v = Math.max(0, Math.min(src.getHeight() - 1, v));
			w = Math.max(1, Math.min(src.getWidth() - u, w));
			h = Math.max(1, Math.min(src.getHeight() - v, h));
			for (int yy = 0; yy < h; yy++) {
				for (int xx = 0; xx < w; xx++) {
					if (((src.getRGB(u + xx, v + yy) >>> 24) & 0xFF) > 16) {
						return false;
					}
				}
			}
			return true;
		} catch (Exception e) {
			return true;
		}
	}

	private static void clampPad(BufferedImage tile, int w, int h) {
		w = Math.max(1, Math.min(16, w));
		h = Math.max(1, Math.min(16, h));
		for (int y = 0; y < 16; y++) {
			int sy = Math.min(y, h - 1);
			for (int x = 0; x < 16; x++) {
				if (x < w && y < h) {
					continue;
				}
				tile.setRGB(x, y, tile.getRGB(Math.min(x, w - 1), sy));
			}
		}
	}

	private static BufferedImage crop(BufferedImage image, String name) {
		if (image == null) {
			return null;
		}
		if (name != null && name.startsWith("entity_")) {
			return image;
		}
		if (image.getWidth() >= 16 && image.getHeight() > 16) {
			return image.getSubimage(0, 0, 16, Math.min(16, image.getHeight()));
		}
		return image;
	}

	private static BufferedImage copy(BufferedImage src) {
		BufferedImage out = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB);
		Graphics2D g = out.createGraphics();
		g.drawImage(src, 0, 0, null);
		g.dispose();
		return out;
	}

	private static BufferedImage solid(int rgb) {
		BufferedImage image = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
		int color = 0xFF000000 | (rgb & 0xFFFFFF);
		for (int y = 0; y < 16; y++) {
			for (int x = 0; x < 16; x++) {
				image.setRGB(x, y, color);
			}
		}
		return image;
	}

	private static void ensureLoaded() {
		if (loaded) {
			return;
		}
		loaded = true;
		int bundled = VanillaPack.loadIndexed(
				"/assets/mcctv/vanilla/block-index.txt",
				"/assets/mcctv/vanilla/block/",
				CACHE);
		bundled += loadPrefixed(
				"/assets/mcctv/vanilla/entity-bed-index.txt",
				"/assets/mcctv/vanilla/entity/bed/",
				"entity_bed_");
		bundled += loadPrefixed(
				"/assets/mcctv/vanilla/entity-chest-index.txt",
				"/assets/mcctv/vanilla/entity/chest/",
				"entity_chest_");
		bundled += loadPrefixed(
				"/assets/mcctv/vanilla/entity-sign-index.txt",
				"/assets/mcctv/vanilla/entity/signs/",
				"entity_sign_");
		bundled += loadPrefixed(
				"/assets/mcctv/vanilla/entity-sign-hanging-index.txt",
				"/assets/mcctv/vanilla/entity/signs/hanging/",
				"entity_sign_hanging_");
		try {
			ModContainer container = FabricLoader.getInstance().getModContainer("minecraft").orElse(null);
			if (container != null) {
				for (Path path : container.getRootPaths()) {
					loadFromPath(path);
				}
			}
		} catch (Exception e) {
			McCctv.LOGGER.warn("Could not index vanilla block textures from Minecraft jar", e);
		}
		McCctv.LOGGER.info("MCCTV block textures: {} bundled, {} total", bundled, CACHE.size());
	}

	private static int loadPrefixed(String index, String folder, String prefix) {
		Map<String, BufferedImage> extra = new HashMap<>();
		int loaded = VanillaPack.loadIndexed(index, folder, extra);
		for (var entry : extra.entrySet()) {
			CACHE.put(prefix + entry.getKey(), entry.getValue());
		}
		return loaded;
	}

	private static void loadFromPath(Path root) throws IOException {
		if (Files.isDirectory(root)) {
			Path textures = root.resolve("assets/minecraft/textures/block");
			if (Files.isDirectory(textures)) {
				try (var stream = Files.list(textures)) {
					stream.filter(p -> p.getFileName().toString().endsWith(".png")).forEach(BlockTextures::readFile);
				}
			}
			loadSignDir(root.resolve("assets/minecraft/textures/entity/signs"), "entity_sign_");
			loadSignDir(root.resolve("assets/minecraft/textures/entity/signs/hanging"), "entity_sign_hanging_");
			return;
		}
		String name = root.toString();
		if (name.endsWith(".jar") || name.endsWith(".zip")) {
			try (ZipFile zip = new ZipFile(root.toFile())) {
				var entries = zip.entries();
				while (entries.hasMoreElements()) {
					ZipEntry entry = entries.nextElement();
					String path = entry.getName();
					if (path.startsWith("assets/minecraft/textures/block/") && path.endsWith(".png") && !path.contains("/")) {
						continue;
					}
					if (path.startsWith("assets/minecraft/textures/block/") && path.endsWith(".png")) {
						String key = path.substring("assets/minecraft/textures/block/".length(), path.length() - 4);
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
					} else if (path.startsWith("assets/minecraft/textures/entity/signs/") && path.endsWith(".png")) {
						String rest = path.substring("assets/minecraft/textures/entity/signs/".length(), path.length() - 4);
						String key;
						if (rest.startsWith("hanging/") && !rest.substring(8).contains("/")) {
							key = "entity_sign_hanging_" + rest.substring(8);
						} else if (!rest.contains("/")) {
							key = "entity_sign_" + rest;
						} else {
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

	private static void loadSignDir(Path dir, String prefix) throws IOException {
		if (!Files.isDirectory(dir)) {
			return;
		}
		try (var stream = Files.list(dir)) {
			stream.filter(p -> Files.isRegularFile(p) && p.getFileName().toString().endsWith(".png")).forEach(p -> {
				try (InputStream in = Files.newInputStream(p)) {
					BufferedImage image = ImageIO.read(in);
					if (image != null) {
						String filename = p.getFileName().toString();
						CACHE.put(prefix + filename.substring(0, filename.length() - 4), image);
					}
				} catch (IOException ignored) {
				}
			});
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

	public static byte[] png(BufferedImage image) throws IOException {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		ImageIO.write(image, "png", out);
		return out.toByteArray();
	}

	public static synchronized byte[] destroyAtlas() {
		ensureLoaded();
		BufferedImage image = new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB);
		Graphics2D g = image.createGraphics();
		for (int i = 0; i < 10; i++) {
			BufferedImage src = crop(CACHE.get("destroy_stage_" + i), "destroy_stage_" + i);
			if (src == null) {
				src = fakeCrack(i);
			}
			g.drawImage(src, (i % 4) * 16, (i / 4) * 16, 16, 16, null);
		}
		g.dispose();
		try {
			return png(image);
		} catch (IOException e) {
			return new byte[0];
		}
	}

	private static BufferedImage fakeCrack(int stage) {
		BufferedImage image = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
		int lines = 2 + stage;
		for (int i = 0; i < lines; i++) {
			int seed = stage * 31 + i * 17;
			int x0 = Math.floorMod(seed * 3, 16);
			int y0 = Math.floorMod(seed * 7, 16);
			int x1 = Math.floorMod(seed * 11 + 5, 16);
			int y1 = Math.floorMod(seed * 13 + 3, 16);
			int steps = 16;
			for (int t = 0; t <= steps; t++) {
				int x = x0 + (x1 - x0) * t / steps;
				int y = y0 + (y1 - y0) * t / steps;
				if (x >= 0 && x < 16 && y >= 0 && y < 16) {
					image.setRGB(x, y, 0xE0101010);
					if (x + 1 < 16) {
						image.setRGB(x + 1, y, 0x90080808);
					}
				}
			}
		}
		return image;
	}
}
