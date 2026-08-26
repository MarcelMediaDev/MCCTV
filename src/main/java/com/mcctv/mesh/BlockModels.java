package com.mcctv.mesh;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.random.Random;

public final class BlockModels {
	public record BakedQuad(float[][] corners, float[][] uvs, String texture, int tint, String cull, boolean shade) {
	}

	private static final Map<String, JsonObject> BLOCKSTATES = new HashMap<>();
	private static final Map<String, JsonObject> MODELS = new HashMap<>();
	private static final Map<String, List<BakedQuad>> BAKE = new ConcurrentHashMap<>();
	private static final ThreadLocal<Random> VARIANT_RANDOM = ThreadLocal.withInitial(() -> Random.create(0L));
	private static boolean loaded;

	private BlockModels() {
	}

	public static List<BakedQuad> bake(String id, String props) {
		return bake(id, props, 0, 0, 0);
	}

	public static List<BakedQuad> bake(String id, String props, int wx, int wy, int wz) {
		ensureLoaded();
		if (id == null || id.isEmpty() || id.equals("air")) {
			return List.of();
		}
		Map<String, String> parsed = parseProps(props);
		int slots = variantSlots(id, parsed);
		int pick = variantPick(wx, wy, wz, slots);
		return BAKE.computeIfAbsent(id + "|" + props + "|" + pick, ignored -> bakeUncached(id, parsed, pick));
	}

	public static String particleTexture(String id) {
		ensureLoaded();
		if (id == null || id.isEmpty() || id.equals("air")) {
			return null;
		}
		ResolvedModel model = resolveModel(id);
		String ref = model.textures.get("particle");
		if (ref == null) {
			return null;
		}
		String tex = resolveTexture(model.textures, ref);
		return tex.isEmpty() ? null : tex;
	}

	private static void ensureLoaded() {
		if (loaded) {
			return;
		}
		loaded = true;
		loadFolder("blockstates", BLOCKSTATES);
		loadFolder("models", MODELS);
		com.mcctv.McCctv.LOGGER.info("MCCTV block models: {} blockstates, {} models", BLOCKSTATES.size(), MODELS.size());
	}

	private static void loadFolder(String folder, Map<String, JsonObject> dest) {
		try (InputStream in = BlockModels.class.getResourceAsStream("/assets/mcctv/vanilla/" + folder + "-index.txt")) {
			if (in == null) {
				return;
			}
			var reader = new java.io.BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
			String line;
			while ((line = reader.readLine()) != null) {
				line = line.trim();
				if (line.isEmpty()) {
					continue;
				}
				try (InputStream json = BlockModels.class.getResourceAsStream("/assets/mcctv/vanilla/" + folder + "/" + line + ".json")) {
					if (json == null) {
						continue;
					}
					dest.put(line, JsonParser.parseReader(new InputStreamReader(json, StandardCharsets.UTF_8)).getAsJsonObject());
				} catch (Exception ignored) {
				}
			}
		} catch (Exception ignored) {
		}
	}

	private static Map<String, String> parseProps(String props) {
		Map<String, String> map = new LinkedHashMap<>();
		if (props == null || props.isEmpty()) {
			return map;
		}
		for (String part : props.split(",")) {
			int eq = part.indexOf('=');
			if (eq > 0) {
				map.put(part.substring(0, eq), part.substring(eq + 1));
			}
		}
		return map;
	}

	private static List<BakedQuad> bakeUncached(String id, Map<String, String> props, int pick) {
		JsonObject blockstate = BLOCKSTATES.get(id);
		if (blockstate == null) {
			return List.of();
		}
		List<ModelPose> poses = new ArrayList<>();
		if (blockstate.has("multipart")) {
			for (JsonElement el : blockstate.getAsJsonArray("multipart")) {
				JsonObject part = el.getAsJsonObject();
				if (part.has("when") && !whenMatches(part.get("when"), props)) {
					continue;
				}
				addApply(poses, part.get("apply"), pick);
			}
		} else if (blockstate.has("variants")) {
			JsonObject variants = blockstate.getAsJsonObject("variants");
			JsonElement best = variants.get("");
			int bestScore = -1;
			for (var entry : variants.entrySet()) {
				int score = variantScore(entry.getKey(), props);
				if (score > bestScore) {
					bestScore = score;
					best = entry.getValue();
				}
			}
			if (best != null) {
				addApply(poses, best, pick);
			}
		}
		List<BakedQuad> quads = new ArrayList<>();
		for (ModelPose pose : poses) {
			ResolvedModel model = resolveModel(pose.model);
			if (model.elements.isEmpty()) {
				quads.addAll(EntityBlockMeshes.quads(id, props, pose.y));
				continue;
			}
			for (JsonObject element : model.elements) {
				quads.addAll(bakeElement(element, model.textures, pose.x, pose.y, pose.uvlock));
			}
		}
		if (quads.isEmpty()) {
			quads.addAll(EntityBlockMeshes.quads(id, props, 0));
		}
		return quads;
	}

	private static int variantScore(String key, Map<String, String> props) {
		if (key.isEmpty()) {
			return 0;
		}
		int score = 0;
		for (String part : key.split(",")) {
			int eq = part.indexOf('=');
			if (eq <= 0) {
				return -1;
			}
			String want = part.substring(eq + 1);
			String have = props.get(part.substring(0, eq));
			if (!want.equals(have)) {
				return -1;
			}
			score++;
		}
		return score;
	}

	private static boolean whenMatches(JsonElement when, Map<String, String> props) {
		if (!when.isJsonObject()) {
			return true;
		}
		JsonObject obj = when.getAsJsonObject();
		if (obj.has("OR")) {
			for (JsonElement el : obj.getAsJsonArray("OR")) {
				if (whenMatches(el, props)) {
					return true;
				}
			}
			return false;
		}
		if (obj.has("AND")) {
			for (JsonElement el : obj.getAsJsonArray("AND")) {
				if (!whenMatches(el, props)) {
					return false;
				}
			}
			return true;
		}
		for (var entry : obj.entrySet()) {
			if (entry.getKey().equals("OR") || entry.getKey().equals("AND")) {
				continue;
			}
			String have = props.getOrDefault(entry.getKey(), "");
			String want = primitiveString(entry.getValue());
			if (have.isEmpty() && (want.equals("true") || want.equals("false"))) {
				have = "false";
			}
			boolean ok = false;
			for (String option : want.split("\\|")) {
				if (option.equals(have)) {
					ok = true;
					break;
				}
			}
			if (!ok) {
				return false;
			}
		}
		return true;
	}

	private static int variantSlots(String id, Map<String, String> props) {
		JsonObject blockstate = BLOCKSTATES.get(id);
		if (blockstate == null || !blockstate.has("variants")) {
			return 1;
		}
		JsonObject variants = blockstate.getAsJsonObject("variants");
		JsonElement best = variants.get("");
		int bestScore = -1;
		for (var entry : variants.entrySet()) {
			int score = variantScore(entry.getKey(), props);
			if (score > bestScore) {
				bestScore = score;
				best = entry.getValue();
			}
		}
		if (best == null || !best.isJsonArray()) {
			return 1;
		}
		int total = 0;
		for (JsonElement el : best.getAsJsonArray()) {
			total += weightOf(el);
		}
		return Math.max(1, total);
	}

	private static int variantPick(int x, int y, int z, int slots) {
		if (slots <= 1) {
			return 0;
		}
		Random random = VARIANT_RANDOM.get();
		random.setSeed(MathHelper.hashCode(x, y, z));
		return random.nextInt(slots);
	}

	private static JsonElement pickWeighted(JsonArray array, int pick) {
		int total = 0;
		for (JsonElement el : array) {
			total += weightOf(el);
		}
		if (total <= 0) {
			return array.get(0);
		}
		int i = Math.floorMod(pick, total);
		for (JsonElement el : array) {
			i -= weightOf(el);
			if (i < 0) {
				return el;
			}
		}
		return array.get(0);
	}

	private static int weightOf(JsonElement el) {
		if (el != null && el.isJsonObject() && el.getAsJsonObject().has("weight")) {
			return Math.max(1, el.getAsJsonObject().get("weight").getAsInt());
		}
		return 1;
	}

	private static void addApply(List<ModelPose> poses, JsonElement apply, int pick) {
		if (apply == null) {
			return;
		}
		if (apply.isJsonArray()) {
			JsonArray array = apply.getAsJsonArray();
			if (!array.isEmpty()) {
				addApply(poses, pickWeighted(array, pick), pick);
			}
			return;
		}
		JsonObject obj = apply.getAsJsonObject();
		if (!obj.has("model")) {
			return;
		}
		poses.add(new ModelPose(
				obj.get("model").getAsString(),
				obj.has("x") ? obj.get("x").getAsInt() : 0,
				obj.has("y") ? obj.get("y").getAsInt() : 0,
				obj.has("uvlock") && obj.get("uvlock").getAsBoolean()
		));
	}

	private static ResolvedModel resolveModel(String name) {
		Map<String, String> textures = new HashMap<>();
		List<JsonObject> elements = new ArrayList<>();
		String current = modelKey(name);
		int guard = 0;
		while (current != null && guard++ < 16) {
			JsonObject json = MODELS.get(current);
			if (json == null) {
				break;
			}
			if (json.has("textures")) {
				for (var entry : json.getAsJsonObject("textures").entrySet()) {
					textures.putIfAbsent(entry.getKey(), entry.getValue().getAsString());
				}
			}
			if (elements.isEmpty() && json.has("elements")) {
				for (JsonElement el : json.getAsJsonArray("elements")) {
					elements.add(el.getAsJsonObject());
				}
			}
			current = json.has("parent") ? modelKey(json.get("parent").getAsString()) : null;
		}
		return new ResolvedModel(textures, elements);
	}

	private static String modelKey(String name) {
		name = name.replace("minecraft:", "");
		if (name.startsWith("block/")) {
			name = name.substring(6);
		}
		return name;
	}

	private static String resolveTexture(Map<String, String> textures, String ref) {
		String cur = ref;
		for (int i = 0; i < 8; i++) {
			if (cur == null) {
				return "";
			}
			if (cur.startsWith("#")) {
				cur = textures.get(cur.substring(1));
				continue;
			}
			cur = cur.replace("minecraft:", "");
			if (cur.startsWith("block/")) {
				cur = cur.substring(6);
			}
			return cur;
		}
		return "";
	}

	private static String primitiveString(JsonElement value) {
		if (value == null || !value.isJsonPrimitive()) {
			return "";
		}
		return value.getAsString();
	}

	private static List<BakedQuad> bakeElement(JsonObject element, Map<String, String> textures, int rotX, int rotY, boolean ignoredUvlock) {
		JsonArray from = element.getAsJsonArray("from");
		JsonArray to = element.getAsJsonArray("to");
		float x0 = from.get(0).getAsFloat();
		float y0 = from.get(1).getAsFloat();
		float z0 = from.get(2).getAsFloat();
		float x1 = to.get(0).getAsFloat();
		float y1 = to.get(1).getAsFloat();
		float z1 = to.get(2).getAsFloat();
		if (x1 < x0) {
			float t = x0;
			x0 = x1;
			x1 = t;
		}
		if (y1 < y0) {
			float t = y0;
			y0 = y1;
			y1 = t;
		}
		if (z1 < z0) {
			float t = z0;
			z0 = z1;
			z1 = t;
		}
		boolean shade = !element.has("shade") || element.get("shade").getAsBoolean();
		JsonObject rotation = element.has("rotation") ? element.getAsJsonObject("rotation") : null;
		JsonObject faces = element.getAsJsonObject("faces");
		if (faces == null) {
			return List.of();
		}
		List<BakedQuad> quads = new ArrayList<>();
		for (var entry : faces.entrySet()) {
			String dir = entry.getKey();
			JsonObject face = entry.getValue().getAsJsonObject();
			String texture = resolveTexture(textures, face.get("texture").getAsString());
			if (texture.isEmpty()) {
				continue;
			}
			if (degenerateFace(dir, x0, y0, z0, x1, y1, z1)) {
				continue;
			}
			if ("down".equals(dir) && Math.abs(y1 - y0) < 0.01f) {
				continue;
			}
			float[][] corners = faceCorners(x0, y0, z0, x1, y1, z1, dir);
			if (corners == null) {
				continue;
			}
			float[] uv = face.has("uv")
					? jsonUv(face.getAsJsonArray("uv"))
					: defaultUv(dir, x0, y0, z0, x1, y1, z1);
			int faceRot = face.has("rotation") ? face.get("rotation").getAsInt() : 0;
			float[][] uvs;
			if ("up".equals(dir) || "down".equals(dir)) {
				uvs = cubeFaceUvs(uv, faceRot);
			} else {
				if (faceRot != 0) {
					uv = rotateUv(uv, faceRot);
				}
				uvs = new float[][] {
						{uv[0] / 16f, uv[3] / 16f},
						{uv[2] / 16f, uv[3] / 16f},
						{uv[2] / 16f, uv[1] / 16f},
						{uv[0] / 16f, uv[1] / 16f}
				};
			}
			if (rotation != null) {
				rotateElement(corners, rotation);
			}
			for (float[] c : corners) {
				rotateModel(c, rotX, rotY);
				c[0] /= 16f;
				c[1] /= 16f;
				c[2] /= 16f;
			}
			int tint = face.has("tintindex") ? face.get("tintindex").getAsInt() : -1;
			String cull = face.has("cullface") ? face.get("cullface").getAsString() : "";
			if (!cull.isEmpty() && (rotY != 0 || rotX != 0)) {
				cull = rotateDir(cull, rotX, rotY);
			}
			quads.add(new BakedQuad(corners, uvs, texture, tint, cull, shade));
		}
		return quads;
	}

	private static float[] jsonUv(JsonArray uv) {
		return new float[] {uv.get(0).getAsFloat(), uv.get(1).getAsFloat(), uv.get(2).getAsFloat(), uv.get(3).getAsFloat()};
	}

	private static float[][] cubeFaceUvs(float[] uv, int faceRot) {
		float minU = uv[0] / 16f;
		float minV = uv[1] / 16f;
		float maxU = uv[2] / 16f;
		float maxV = uv[3] / 16f;
		float[][] uvs = {
				{minU, minV},
				{minU, maxV},
				{maxU, maxV},
				{maxU, minV}
		};
		int turns = Math.floorMod(faceRot / 90, 4);
		if (turns == 0) {
			return uvs;
		}
		float[][] out = new float[4][];
		for (int i = 0; i < 4; i++) {
			out[i] = uvs[(i + turns) % 4];
		}
		return out;
	}

	private static float[] defaultUv(String face, float x0, float y0, float z0, float x1, float y1, float z1) {
		return switch (face) {
			case "up" -> new float[] {x0, z0, x1, z1};
			case "down" -> new float[] {x0, 16 - z1, x1, 16 - z0};
			case "north" -> new float[] {16 - x1, 16 - y1, 16 - x0, 16 - y0};
			case "south" -> new float[] {x0, 16 - y1, x1, 16 - y0};
			case "west" -> new float[] {z0, 16 - y1, z1, 16 - y0};
			case "east" -> new float[] {16 - z1, 16 - y1, 16 - z0, 16 - y0};
			default -> new float[] {0, 0, 16, 16};
		};
	}

	private static float[] rotateUv(float[] uv, int rot) {
		rot = Math.floorMod(rot / 90, 4) * 90;
		float u0 = uv[0], v0 = uv[1], u1 = uv[2], v1 = uv[3];
		return switch (rot) {
			case 90 -> new float[] {u0, v1, u1, v0};
			case 180 -> new float[] {u1, v1, u0, v0};
			case 270 -> new float[] {u1, v0, u0, v1};
			default -> uv;
		};
	}

	private static boolean degenerateFace(String face, float x0, float y0, float z0, float x1, float y1, float z1) {
		float dx = Math.abs(x1 - x0);
		float dy = Math.abs(y1 - y0);
		float dz = Math.abs(z1 - z0);
		return switch (face) {
			case "up", "down" -> dx < 0.01f || dz < 0.01f;
			case "north", "south" -> dx < 0.01f || dy < 0.01f;
			case "west", "east" -> dz < 0.01f || dy < 0.01f;
			default -> true;
		};
	}

	private static float[][] faceCorners(float x0, float y0, float z0, float x1, float y1, float z1, String face) {
		return switch (face) {
			case "down" -> new float[][] {{x0, y0, z1}, {x0, y0, z0}, {x1, y0, z0}, {x1, y0, z1}};
			case "up" -> new float[][] {{x0, y1, z0}, {x0, y1, z1}, {x1, y1, z1}, {x1, y1, z0}};
			case "north" -> new float[][] {{x1, y0, z0}, {x0, y0, z0}, {x0, y1, z0}, {x1, y1, z0}};
			case "south" -> new float[][] {{x0, y0, z1}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1}};
			case "west" -> new float[][] {{x0, y0, z0}, {x0, y0, z1}, {x0, y1, z1}, {x0, y1, z0}};
			case "east" -> new float[][] {{x1, y0, z1}, {x1, y0, z0}, {x1, y1, z0}, {x1, y1, z1}};
			default -> null;
		};
	}

	private static void rotateElement(float[][] corners, JsonObject rotation) {
		JsonArray origin = rotation.getAsJsonArray("origin");
		float ox = origin.get(0).getAsFloat();
		float oy = origin.get(1).getAsFloat();
		float oz = origin.get(2).getAsFloat();
		float angle = (float) Math.toRadians(rotation.get("angle").getAsFloat());
		String axis = rotation.get("axis").getAsString();
		boolean rescale = rotation.has("rescale") && rotation.get("rescale").getAsBoolean();
		float scale = rescale ? (float) (1.0 / Math.cos(angle)) : 1f;
		float c = (float) Math.cos(angle);
		float s = (float) Math.sin(angle);
		for (float[] p : corners) {
			float x = p[0] - ox, y = p[1] - oy, z = p[2] - oz;
			float nx = x, ny = y, nz = z;
			switch (axis) {
				case "x" -> {
					ny = y * c - z * s;
					nz = y * s + z * c;
					if (rescale) {
						ny *= scale;
						nz *= scale;
					}
				}
				case "y" -> {
					nx = x * c + z * s;
					nz = -x * s + z * c;
					if (rescale) {
						nx *= scale;
						nz *= scale;
					}
				}
				case "z" -> {
					nx = x * c - y * s;
					ny = x * s + y * c;
					if (rescale) {
						nx *= scale;
						ny *= scale;
					}
				}
			}
			p[0] = nx + ox;
			p[1] = ny + oy;
			p[2] = nz + oz;
		}
	}

	private static void rotateModel(float[] p, int rotX, int rotY) {
		float x = p[0] - 8, y = p[1] - 8, z = p[2] - 8;
		int rx = Math.floorMod(rotX / 90, 4);
		int ry = Math.floorMod(rotY / 90, 4);
		// Vanilla blockstate x/y are -X then -Y around the block center.
		for (int i = 0; i < rx; i++) {
			float ny = z, nz = -y;
			y = ny;
			z = nz;
		}
		for (int i = 0; i < ry; i++) {
			float nx = -z, nz = x;
			x = nx;
			z = nz;
		}
		p[0] = x + 8;
		p[1] = y + 8;
		p[2] = z + 8;
	}

	private static String rotateDir(String dir, int rotX, int rotY) {
		String d = dir;
		int rx = Math.floorMod(rotX / 90, 4);
		int ry = Math.floorMod(rotY / 90, 4);
		for (int i = 0; i < rx; i++) {
			d = switch (d) {
				case "up" -> "north";
				case "north" -> "down";
				case "down" -> "south";
				case "south" -> "up";
				default -> d;
			};
		}
		for (int i = 0; i < ry; i++) {
			d = switch (d) {
				case "north" -> "east";
				case "east" -> "south";
				case "south" -> "west";
				case "west" -> "north";
				default -> d;
			};
		}
		return d;
	}

	private record ModelPose(String model, int x, int y, boolean uvlock) {
	}

	private record ResolvedModel(Map<String, String> textures, List<JsonObject> elements) {
	}
}
