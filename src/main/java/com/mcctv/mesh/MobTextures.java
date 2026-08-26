package com.mcctv.mesh;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import com.mcctv.McCctv;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;

public final class MobTextures {
	private static final Map<String, byte[]> PNG = new HashMap<>();
	private static final Map<String, String> GUESS = new HashMap<>();
	private static final List<String> KEYS = new ArrayList<>();
	private static final Set<String> KEY_SET = new HashSet<>();
	private static Path jarRoot;
	private static boolean loaded;

	private MobTextures() {
	}

	public static synchronized byte[] png(String raw) {
		ensureLoaded();
		String key = resolve(sanitize(raw));
		if (key.isEmpty()) {
			return new byte[0];
		}
		return load(key);
	}

	public static synchronized String guess(String type) {
		ensureLoaded();
		String name = sanitize(type);
		if (name.isEmpty()) {
			return "";
		}
		String cached = GUESS.get(name);
		if (cached != null) {
			return cached;
		}
		String key = resolve(name);
		GUESS.put(name, key);
		return key;
	}

	private static String resolve(String name) {
		if (name.isEmpty()) {
			return "";
		}
		if (has(name)) {
			return name;
		}
		String[] tries = {
				name + "/" + name,
				name + "/temperate_" + name,
				name + "/" + name + "_temperate",
				name + "/" + name + "_normal",
				name.equals("donkey") ? "horse/donkey" : "",
				name.equals("mule") ? "horse/mule" : "",
				name.equals("horse") ? "horse/horse_brown" : "",
				name.equals("horse") ? "horse/horse_chestnut" : "",
				name.equals("horse") ? "horse/horse_creamy" : "",
				name.equals("camel") ? "camel/camel" : "",
				name.equals("cat") ? "cat/tabby" : "",
				name.equals("ocelot") ? "cat/ocelot" : "",
				name.equals("wolf") ? "wolf/wolf" : "",
				name.equals("parrot") ? "parrot/parrot_red_blue" : "",
				name.equals("armor_stand") ? "armorstand/wood" : "",
				name.equals("armadillo") ? "armadillo" : "",
				name.equals("bat") ? "bat" : "",
				name.equals("bee") ? "bee/bee" : "",
				name.equals("fox") ? "fox/fox" : "",
				name.equals("goat") ? "goat/goat" : "",
				name.equals("llama") || name.equals("trader_llama") ? "llama/creamy" : "",
				name.equals("panda") ? "panda/panda" : "",
				name.equals("polar_bear") ? "bear/polarbear" : "",
				name.equals("rabbit") ? "rabbit/brown" : "",
				name.equals("mooshroom") ? "cow/red_mooshroom" : "",
				name.equals("iron_golem") ? "iron_golem/iron_golem" : "",
				name.equals("snow_golem") ? "snow_golem" : "",
				name.equals("copper_golem") ? "copper_golem/copper_golem" : "",
				name.equals("sniffer") ? "sniffer/sniffer" : "",
				name.equals("villager") ? "villager/villager" : "",
				name.equals("wandering_trader") ? "wandering_trader" : "",
				name.equals("zombie") ? "zombie/zombie" : "",
				name.equals("husk") ? "zombie/husk" : "",
				name.equals("drowned") ? "zombie/drowned" : "",
				name.equals("zombie_villager") ? "zombie_villager/zombie_villager" : "",
				name.equals("skeleton") ? "skeleton/skeleton" : "",
				name.equals("stray") ? "skeleton/stray" : "",
				name.equals("bogged") ? "skeleton/bogged" : "",
				name.equals("parched") ? "skeleton/parched" : "",
				name.equals("skeleton_horse") ? "horse/horse_skeleton" : "",
				name.equals("zombie_horse") ? "horse/horse_zombie" : "",
				name.equals("spider") ? "spider/spider" : "",
				name.equals("cave_spider") ? "spider/cave_spider" : "",
				name.equals("breeze") ? "breeze/breeze" : "",
				name.equals("creaking") ? "creaking/creaking" : "",
				name.equals("cod") ? "fish/cod" : "",
				name.equals("salmon") ? "fish/salmon" : "",
				name.equals("pufferfish") ? "fish/pufferfish" : "",
				name.equals("tropical_fish") ? "fish/tropical_a" : "",
				name.equals("tadpole") ? "tadpole/tadpole" : "",
				name.equals("turtle") ? "turtle/big_sea_turtle" : "",
				name.equals("allay") ? "allay/allay" : "",
				name.equals("dolphin") ? "dolphin" : "",
				name.equals("squid") ? "squid/squid" : "",
				name.equals("glow_squid") ? "squid/glow_squid" : "",
				name.equals("axolotl") ? "axolotl/axolotl_lucy" : "",
				name.equals("frog") ? "frog/temperate_frog" : "",
				name.equals("zombie_nautilus") ? "nautilus/zombie_nautilus" : "",
				name.equals("camel_husk") ? "camel/camel_husk" : "",
				name.equals("guardian") ? "guardian" : "",
				name.equals("elder_guardian") ? "guardian_elder" : "",
				name.equals("phantom") ? "phantom" : "",
				name.equals("silverfish") ? "silverfish" : "",
				name.equals("warden") ? "warden/warden" : "",
				name.equals("witch") ? "witch" : "",
				name.equals("evoker") ? "illager/evoker" : "",
				name.equals("pillager") ? "illager/pillager" : "",
				name.equals("vindicator") ? "illager/vindicator" : "",
				name.equals("illusioner") ? "illager/illusioner" : "",
				name.equals("ravager") ? "illager/ravager" : "",
				name.equals("ravager") ? "ravager" : "",
				name.equals("vex") ? "illager/vex" : "",
				name.equals("blaze") ? "blaze" : "",
				name.equals("ghast") ? "ghast/ghast" : "",
				name.equals("happy_ghast") ? "ghast/happy_ghast" : "",
				name.equals("hoglin") ? "hoglin/hoglin" : "",
				name.equals("zoglin") ? "hoglin/zoglin" : "",
				name.equals("magma_cube") ? "slime/magmacube" : "",
				name.equals("magma_cube") ? "magma_cube" : "",
				name.equals("piglin") ? "piglin/piglin" : "",
				name.equals("piglin_brute") ? "piglin/piglin_brute" : "",
				name.equals("zombified_piglin") ? "piglin/zombified_piglin" : "",
				name.equals("wither_skeleton") ? "skeleton/wither_skeleton" : "",
				name.equals("enderman") ? "enderman/enderman" : "",
				name.equals("endermite") ? "endermite" : "",
				name.equals("strider") ? "strider/strider" : "",
				name.equals("shulker") ? "shulker/shulker" : ""
		};
		for (String tryKey : tries) {
			if (tryKey.isEmpty() || !has(tryKey)) {
				continue;
			}
			return tryKey;
		}
		String prefix = name + "/";
		String found = "";
		for (String key : KEYS) {
			if (!key.startsWith(prefix) || skipLayer(key)) {
				continue;
			}
			if (name.equals("horse") && (key.contains("donkey") || key.contains("mule") || key.contains("marking"))) {
				continue;
			}
			if (found.isEmpty() || key.length() < found.length()) {
				found = key;
			}
		}
		return found;
	}

	private static boolean has(String key) {
		return PNG.containsKey(key) || KEY_SET.contains(key);
	}

	private static boolean skipLayer(String key) {
		return key.contains("saddle") || key.contains("_eyes") || key.contains("overlay")
				|| (key.contains("armor") && !key.startsWith("armorstand")) || key.contains("collar") || key.contains("wool")
				|| key.contains("spit") || key.contains("stinger") || key.contains("decor")
				|| key.contains("crackiness") || key.contains("profession") || key.endsWith("_baby")
				|| key.contains("bioluminescent") || key.contains("pulsating") || key.contains("warden_heart")
				|| key.contains("guardian_beam") || key.contains("evoker_fangs")
				|| key.contains("shooting") || key.contains("harness") || key.contains("ropes")
				|| key.contains("goggles");
	}

	private static String sanitize(String name) {
		if (name == null) {
			return "";
		}
		if (name.endsWith(".png") || name.endsWith(".PNG")) {
			name = name.substring(0, name.length() - 4);
		}
		StringBuilder out = new StringBuilder(name.length());
		for (int i = 0; i < name.length(); i++) {
			char c = Character.toLowerCase(name.charAt(i));
			if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '/') {
				out.append(c);
			}
		}
		String clean = out.toString();
		if (clean.contains("..") || clean.startsWith("/") || clean.endsWith("/")) {
			return "";
		}
		return clean;
	}

	private static byte[] load(String key) {
		byte[] cached = PNG.get(key);
		if (cached != null) {
			return cached;
		}
		if (jarRoot == null) {
			return new byte[0];
		}
		String path = "assets/minecraft/textures/entity/" + key + ".png";
		byte[] data = read(jarRoot, path);
		if (data.length > 0) {
			PNG.put(key, data);
		}
		return data;
	}

	private static void ensureLoaded() {
		if (loaded) {
			return;
		}
		loaded = true;
		try {
			ModContainer container = FabricLoader.getInstance().getModContainer("minecraft").orElse(null);
			if (container != null) {
				for (Path path : container.getRootPaths()) {
					index(path);
					if (!KEYS.isEmpty()) {
						jarRoot = path;
						break;
					}
				}
			}
		} catch (Exception e) {
			McCctv.LOGGER.warn("Could not index vanilla mob textures from Minecraft jar", e);
		}
		McCctv.LOGGER.info("MCCTV mob textures: {} skins", KEYS.size());
	}

	private static void index(Path root) throws IOException {
		if (Files.isDirectory(root)) {
			Path dir = root.resolve("assets/minecraft/textures/entity");
			if (!Files.isDirectory(dir)) {
				return;
			}
			try (var stream = Files.walk(dir)) {
				stream.filter(p -> p.getFileName().toString().endsWith(".png")).forEach(file -> {
					String full = file.toString().replace('\\', '/');
					int at = full.indexOf("/textures/entity/");
					if (at < 0) {
						return;
					}
					addKey(full.substring(at + "/textures/entity/".length(), full.length() - 4));
				});
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
					if (!path.startsWith("assets/minecraft/textures/entity/") || !path.endsWith(".png")) {
						continue;
					}
					addKey(path.substring("assets/minecraft/textures/entity/".length(), path.length() - 4));
				}
			}
			return;
		}
		try (FileSystem fs = FileSystems.newFileSystem(root)) {
			index(fs.getPath("/"));
		} catch (Exception ignored) {
		}
	}

	private static void addKey(String key) {
		if (key.startsWith("player/") || key.startsWith("signs/") || key.startsWith("chest/")
				|| key.startsWith("bed/") || key.startsWith("equipment/") || key.contains("..")) {
			return;
		}
		if (KEY_SET.add(key)) {
			KEYS.add(key);
		}
	}

	private static byte[] read(Path root, String path) {
		if (Files.isDirectory(root)) {
			Path file = root.resolve(path);
			if (Files.isRegularFile(file)) {
				try {
					return Files.readAllBytes(file);
				} catch (Exception ignored) {
				}
			}
			return new byte[0];
		}
		String name = root.toString();
		if (name.endsWith(".jar") || name.endsWith(".zip")) {
			try (ZipFile zip = new ZipFile(root.toFile())) {
				ZipEntry entry = zip.getEntry(path);
				if (entry != null) {
					try (InputStream in = zip.getInputStream(entry)) {
						return in.readAllBytes();
					}
				}
			} catch (Exception ignored) {
			}
			return new byte[0];
		}
		try (FileSystem fs = FileSystems.newFileSystem(root)) {
			return read(fs.getPath("/"), path);
		} catch (Exception ignored) {
			return new byte[0];
		}
	}
}
