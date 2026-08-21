package com.mcctv.mesh;

import com.mcctv.McCctv;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.minecraft.world.biome.FoliageColors;
import net.minecraft.world.biome.GrassColors;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.InputStream;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

public final class Colormaps {
	private static boolean loaded;

	private Colormaps() {
	}

	public static synchronized void ensureLoaded() {
		if (loaded) {
			return;
		}
		loaded = true;
		int[] grass = read("assets/minecraft/textures/colormap/grass.png");
		int[] foliage = read("assets/minecraft/textures/colormap/foliage.png");
		if (grass.length > 0) {
			GrassColors.setColorMap(grass);
		}
		if (foliage.length > 0) {
			FoliageColors.setColorMap(foliage);
		}
	}

	public static int safe(int color, int fallback) {
		if ((color & 0xFFFFFF) == 0) {
			return fallback;
		}
		return color & 0xFFFFFF;
	}

	private static int[] read(String path) {
		try {
			ModContainer container = FabricLoader.getInstance().getModContainer("minecraft").orElse(null);
			if (container == null) {
				return new int[0];
			}
			for (Path root : container.getRootPaths()) {
				BufferedImage image = imageAt(root, path);
				if (image != null) {
					int w = image.getWidth();
					int h = image.getHeight();
					int[] pixels = new int[w * h];
					image.getRGB(0, 0, w, h, pixels, 0, w);
					return pixels;
				}
			}
		} catch (Exception e) {
			McCctv.LOGGER.warn("Could not load {}", path, e);
		}
		return new int[0];
	}

	private static BufferedImage imageAt(Path root, String path) {
		try {
			if (Files.isDirectory(root)) {
				Path file = root.resolve(path);
				if (Files.isRegularFile(file)) {
					try (InputStream in = Files.newInputStream(file)) {
						return ImageIO.read(in);
					}
				}
				return null;
			}
			String name = root.toString();
			if (name.endsWith(".jar") || name.endsWith(".zip")) {
				try (ZipFile zip = new ZipFile(root.toFile())) {
					ZipEntry entry = zip.getEntry(path);
					if (entry != null) {
						try (InputStream in = zip.getInputStream(entry)) {
							return ImageIO.read(in);
						}
					}
				}
				return null;
			}
			try (FileSystem fs = FileSystems.newFileSystem(root)) {
				return imageAt(fs.getPath("/"), path);
			}
		} catch (Exception ignored) {
			return null;
		}
	}
}
