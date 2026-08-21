package com.mcctv.mesh;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

final class EntityBlockMeshes {
	private EntityBlockMeshes() {
	}

	static List<BlockModels.BakedQuad> quads(String id, Map<String, String> props, int extraY) {
		if (id.endsWith("_bed")) {
			return bed(id, props, extraY);
		}
		if (isChest(id)) {
			return chest(id, props, extraY);
		}
		return List.of();
	}

	private static boolean isChest(String id) {
		return id.contains("chest") && !id.contains("boat") && !id.contains("minecart") && !id.contains("cart");
	}

	private static List<BlockModels.BakedQuad> bed(String id, Map<String, String> props, int extraY) {
		String color = id.substring(0, id.length() - 4);
		if (color.isEmpty()) {
			color = "red";
		}
		String tex = "entity_bed_" + color;
		boolean head = "head".equals(props.get("part"));
		int y = yaw(extraY, props.get("facing"), true);
		List<BlockModels.BakedQuad> list = new ArrayList<>();
		float y0 = 3, y1 = 9;
		if (head) {
			list.add(face("up", 0, y0, 0, 16, y1, 16, tex, "6,6,16,16", y));
			list.add(face("down", 0, y0, 0, 16, y1, 16, tex, "28,6,16,16", y));
			list.add(face("north", 0, y0, 0, 16, y1, 16, tex, "22,0,16,6", y));
			list.add(face("south", 0, y0, 0, 16, y1, 16, tex, "6,0,16,6", y));
			list.add(face("west", 0, y0, 0, 16, y1, 16, tex, "0,6,6,16,r", y));
			list.add(face("east", 0, y0, 0, 16, y1, 16, tex, "22,6,6,16,r", y));
			addCuboid(list, 0, 0, 13, 3, 3, 3, tex, 50, 6, y);
			addCuboid(list, 13, 0, 13, 3, 3, 3, tex, 50, 18, y);
		} else {
			list.add(face("up", 0, y0, 0, 16, y1, 16, tex, "6,28,16,16", y));
			list.add(face("down", 0, y0, 0, 16, y1, 16, tex, "28,28,16,16", y));
			list.add(face("north", 0, y0, 0, 16, y1, 16, tex, "6,22,16,6", y));
			list.add(face("south", 0, y0, 0, 16, y1, 16, tex, "22,22,16,6", y));
			list.add(face("west", 0, y0, 0, 16, y1, 16, tex, "0,28,6,16,r", y));
			list.add(face("east", 0, y0, 0, 16, y1, 16, tex, "22,28,6,16,r", y));
			addCuboid(list, 0, 0, 0, 3, 3, 3, tex, 50, 0, y);
			addCuboid(list, 13, 0, 0, 3, 3, 3, tex, 50, 12, y);
		}
		return list;
	}

	private static List<BlockModels.BakedQuad> chest(String id, Map<String, String> props, int extraY) {
		String type = props.getOrDefault("type", "single");
		String tex = chestTexture(id, type);
		int y = yaw(extraY, props.get("facing"), false);
		float pitch = lidPitch(props);
		List<BlockModels.BakedQuad> list = new ArrayList<>();
		if ("left".equals(type)) {
			addCuboid(list, 0, 0, 1, 15, 10, 14, tex, 0, 19, y);
			addCuboid(list, 0, 9, 1, 15, 5, 14, tex, 0, 0, y, pitch);
			addCuboid(list, 0, 7, 15, 1, 4, 1, tex, 0, 0, y, pitch);
		} else if ("right".equals(type)) {
			addCuboid(list, 1, 0, 1, 15, 10, 14, tex, 0, 19, y);
			addCuboid(list, 1, 9, 1, 15, 5, 14, tex, 0, 0, y, pitch);
			addCuboid(list, 15, 7, 15, 1, 4, 1, tex, 0, 0, y, pitch);
		} else {
			addCuboid(list, 1, 0, 1, 14, 10, 14, tex, 0, 19, y);
			addCuboid(list, 1, 9, 1, 14, 5, 14, tex, 0, 0, y, pitch);
			addCuboid(list, 7, 7, 15, 2, 4, 1, tex, 0, 0, y, pitch);
		}
		return list;
	}

	private static float lidPitch(Map<String, String> props) {
		float p = 0f;
		try {
			p = Float.parseFloat(props.getOrDefault("lid", "0")) / 10f;
		} catch (NumberFormatException ignored) {
			return 0f;
		}
		p = Math.max(0f, Math.min(1f, p));
		float g = 1f - p;
		g = 1f - g * g * g;
		return -g * ((float) Math.PI / 2f);
	}

	private static String chestTexture(String id, String type) {
		String base = switch (id) {
			case "ender_chest" -> "ender";
			case "trapped_chest" -> "trapped";
			case "copper_chest", "waxed_copper_chest" -> "copper";
			case "exposed_copper_chest", "waxed_exposed_copper_chest" -> "copper_exposed";
			case "weathered_copper_chest", "waxed_weathered_copper_chest" -> "copper_weathered";
			case "oxidized_copper_chest", "waxed_oxidized_copper_chest" -> "copper_oxidized";
			default -> "normal";
		};
		if ("left".equals(type) || "right".equals(type)) {
			if (base.equals("ender")) {
				return "entity_chest_ender";
			}
			String key = "entity_chest_" + base + "_" + type;
			if (BlockTextures.has(key)) {
				return key;
			}
		}
		return "entity_chest_" + base;
	}

	private static void addCuboid(List<BlockModels.BakedQuad> list, float x, float y, float z,
			float dx, float dy, float dz, String tex, int u, int v, int rotY) {
		addCuboid(list, x, y, z, dx, dy, dz, tex, u, v, rotY, 0f);
	}

	private static void addCuboid(List<BlockModels.BakedQuad> list, float x, float y, float z,
			float dx, float dy, float dz, String tex, int u, int v, int rotY, float pitch) {
		int iu = Math.max(1, Math.round(dx));
		int iv = Math.max(1, Math.round(dy));
		int iz = Math.max(1, Math.round(dz));
		float x1 = x + dx, y1 = y + dy, z1 = z + dz;
		boolean chest = tex.startsWith("entity_chest_");
		addFace(list, "down", x, y, z, x1, y1, z1, tex, uv(u + iz, v, iu, iz), rotY, pitch, !chest);
		addFace(list, "up", x, y, z, x1, y1, z1, tex, uv(u + iz + iu, v, iu, iz), rotY, pitch, !chest);
		addFace(list, "west", x, y, z, x1, y1, z1, tex, uv(u, v + iz, iz, iv), rotY, pitch, !chest);
		addFace(list, "south", x, y, z, x1, y1, z1, tex, uv(u + iz, v + iz, iu, iv), rotY, pitch, !chest);
		addFace(list, "east", x, y, z, x1, y1, z1, tex, uv(u + iz + iu, v + iz, iz, iv), rotY, pitch, !chest);
		addFace(list, "north", x, y, z, x1, y1, z1, tex, uv(u + iz + iu + iz, v + iz, iu, iv), rotY, pitch, !chest);
	}

	private static void addFace(List<BlockModels.BakedQuad> list, String dir, float x0, float y0, float z0,
			float x1, float y1, float z1, String tex, String spec, int rotY, float pitch, boolean shade) {
		if (BlockTextures.regionEmpty(tex, spec)) {
			return;
		}
		list.add(face(dir, x0, y0, z0, x1, y1, z1, tex, spec, rotY, pitch, shade, chestYaw(tex)));
	}

	private static boolean chestYaw(String tex) {
		return tex.startsWith("entity_chest_");
	}

	private static String uv(int u, int v, int w, int h) {
		return u + "," + v + "," + Math.max(1, w) + "," + Math.max(1, h);
	}

	private static float[][] cropUvs(String spec) {
		int w = 16;
		int h = 16;
		boolean rotate = false;
		if (spec != null) {
			String[] parts = spec.split(",");
			if (parts.length >= 4) {
				try {
					w = Math.abs(Integer.parseInt(parts[2].trim()));
					h = Math.abs(Integer.parseInt(parts[3].trim()));
					rotate = parts.length >= 5 && parts[4].toLowerCase().contains("r");
				} catch (NumberFormatException ignored) {
				}
			}
		}
		if (rotate) {
			int tmp = w;
			w = h;
			h = tmp;
		}
		w = Math.max(1, Math.min(16, w));
		h = Math.max(1, Math.min(16, h));
		float u1 = w / 16f;
		float v1 = h / 16f;
		return new float[][] {{0, v1}, {u1, v1}, {u1, 0}, {0, 0}};
	}

	private static int yaw(int extraY, String facing, boolean bed) {
		if (extraY != 0) {
			return extraY;
		}
		if (bed) {
			return switch (facing == null ? "north" : facing) {
				case "east" -> 90;
				case "south" -> 180;
				case "west" -> 270;
				default -> 0;
			};
		}
		return switch (facing == null ? "north" : facing) {
			case "north" -> 180;
			case "west" -> 90;
			case "east" -> 270;
			default -> 0;
		};
	}

	private static BlockModels.BakedQuad face(String dir, float x0, float y0, float z0, float x1, float y1, float z1,
			String tex, String spec, int rotY) {
		return face(dir, x0, y0, z0, x1, y1, z1, tex, spec, rotY, 0f, true, false);
	}

	private static BlockModels.BakedQuad face(String dir, float x0, float y0, float z0, float x1, float y1, float z1,
			String tex, String spec, int rotY, float pitch, boolean shade, boolean minusY) {
		String texture = tex + "@" + spec;
		float[][] corners = switch (dir) {
			case "down" -> new float[][] {{x0, y0, z1}, {x1, y0, z1}, {x1, y0, z0}, {x0, y0, z0}};
			case "up" -> new float[][] {{x0, y1, z0}, {x1, y1, z0}, {x1, y1, z1}, {x0, y1, z1}};
			case "north" -> new float[][] {{x1, y0, z0}, {x0, y0, z0}, {x0, y1, z0}, {x1, y1, z0}};
			case "south" -> new float[][] {{x0, y0, z1}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1}};
			case "west" -> new float[][] {{x0, y0, z0}, {x0, y0, z1}, {x0, y1, z1}, {x0, y1, z0}};
			default -> new float[][] {{x1, y0, z1}, {x1, y0, z0}, {x1, y1, z0}, {x1, y1, z1}};
		};
		float[][] uvs = cropUvs(spec);
		int turns = Math.floorMod(rotY / 90, 4);
		for (float[] c : corners) {
			if (pitch != 0f) {
				float ly = c[1] - 9f;
				float lz = c[2] - 1f;
				float cos = (float) Math.cos(pitch);
				float sin = (float) Math.sin(pitch);
				c[1] = ly * cos - lz * sin + 9f;
				c[2] = ly * sin + lz * cos + 1f;
			}
			float x = c[0] - 8, z = c[2] - 8;
			for (int i = 0; i < turns; i++) {
				float nx;
				float nz;
				if (minusY) {
					nx = -z;
					nz = x;
				} else {
					nx = z;
					nz = -x;
				}
				x = nx;
				z = nz;
			}
			c[0] = (x + 8) / 16f;
			c[1] /= 16f;
			c[2] = (z + 8) / 16f;
		}
		return new BlockModels.BakedQuad(corners, uvs, texture, -1, "", shade);
	}
}
