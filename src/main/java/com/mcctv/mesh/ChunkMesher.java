package com.mcctv.mesh;

import net.minecraft.block.RedstoneWireBlock;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.MathHelper;

import java.awt.AlphaComposite;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class ChunkMesher {
	public static final int VERT_FLOATS = 12;
	private static final Direction[] FACES = Direction.values();
	private static final float[] SHADE = new float[6];

	static {
		SHADE[Direction.DOWN.getIndex()] = 0.45f;
		SHADE[Direction.UP.getIndex()] = 1.0f;
		SHADE[Direction.NORTH.getIndex()] = 0.72f;
		SHADE[Direction.SOUTH.getIndex()] = 0.8f;
		SHADE[Direction.WEST.getIndex()] = 0.55f;
		SHADE[Direction.EAST.getIndex()] = 0.62f;
	}

	private ChunkMesher() {
	}

	public static MeshResult build(WorldSnapshot snapshot) {
		return build(snapshot, new AtlasBook());
	}

	public static MeshResult build(WorldSnapshot snapshot, AtlasBook book) {
		synchronized (book) {
			List<float[]> verts = new ArrayList<>();
			if (!snapshot.loaded) {
				book.frozen = true;
				return MeshResult.empty(snapshot);
			}
			seedAll(book);
			emitRange(snapshot, book, verts, 0, 0, 0, snapshot.sizeX - 1, snapshot.sizeY - 1, snapshot.sizeZ - 1);
			Atlas atlas = packAtlas(book.keys);
			book.png = atlas.png;
			book.tiles = atlas.tiles;
			book.frozen = true;
			return toBinary(snapshot, verts, atlas);
		}
	}

	public static List<float[]> emitRange(WorldSnapshot snapshot, AtlasBook book, List<float[]> verts,
			int x0, int y0, int z0, int x1, int y1, int z1) {
		x0 = Math.max(0, x0);
		y0 = Math.max(0, y0);
		z0 = Math.max(0, z0);
		x1 = Math.min(snapshot.sizeX - 1, x1);
		y1 = Math.min(snapshot.sizeY - 1, y1);
		z1 = Math.min(snapshot.sizeZ - 1, z1);
		for (int y = y0; y <= y1; y++) {
			for (int z = z0; z <= z1; z++) {
				for (int x = x0; x <= x1; x++) {
					emitCell(snapshot, book, verts, x, y, z);
				}
			}
		}
		return verts;
	}

	public static void emitWorldCells(WorldSnapshot snapshot, AtlasBook book, List<float[]> verts,
			Collection<BlockPos> positions) {
		for (BlockPos pos : positions) {
			emitCell(snapshot, book, verts, pos.getX() - snapshot.minX, pos.getY() - snapshot.minY, pos.getZ() - snapshot.minZ);
		}
	}

	public static int tileOf(AtlasBook book, String texture, int mapColor) {
		return lookupTile(book, texture);
	}

	public static int lookupTile(AtlasBook book, String texture) {
		if (book == null || texture == null || texture.isEmpty()) {
			return -1;
		}
		synchronized (book) {
			String[] names = {
					texture,
					texture + "_side",
					texture + "_top",
					texture + "_bottom",
					texture.endsWith("_block") ? texture.substring(0, texture.length() - 6) : texture + "_block"
			};
			for (String name : names) {
				int tile = existingTile(book, name);
				if (tile >= 0) {
					return tile;
				}
			}
			return -1;
		}
	}

	private static void seedAll(AtlasBook book) {
		for (String name : BlockTextures.names()) {
			if (name.startsWith("destroy_stage_")) {
				continue;
			}
			if (name.startsWith("entity_")) {
				if (name.startsWith("entity_bed_")) {
					String[] crops = {
							"6,6,16,16", "28,6,16,16", "6,0,16,6", "22,0,16,6", "0,6,6,16,r", "22,6,6,16,r",
							"6,28,16,16", "28,28,16,16", "22,22,16,6", "6,22,16,6", "0,28,6,16,r", "22,28,6,16,r"
					};
					for (String crop : crops) {
						tileIndex(book, new BlockAppearance.Face(name + "@" + crop, 0xFFFFFF, false), 0x7F7F7F);
					}
					seedCuboidTiles(book, name, 50, 0, 3, 3, 3);
					seedCuboidTiles(book, name, 50, 6, 3, 3, 3);
					seedCuboidTiles(book, name, 50, 12, 3, 3, 3);
					seedCuboidTiles(book, name, 50, 18, 3, 3, 3);
				} else if (name.startsWith("entity_chest_")) {
					seedCuboidTiles(book, name, 0, 19, 14, 10, 14);
					seedCuboidTiles(book, name, 0, 0, 14, 5, 14);
					seedCuboidTiles(book, name, 0, 0, 2, 4, 1);
					seedCuboidTiles(book, name, 0, 19, 15, 10, 14);
					seedCuboidTiles(book, name, 0, 0, 15, 5, 14);
					seedCuboidTiles(book, name, 0, 0, 1, 4, 1);
				} else if (name.startsWith("entity_sign_hanging_")) {
					seedCuboidTiles(book, name, 0, 12, 14, 10, 2);
				} else if (name.startsWith("entity_sign_")) {
					seedSignBoardTiles(book, name);
				} else if (name.startsWith("entity_banner_") && !name.startsWith("entity_banner_pattern_")
						&& !name.equals("entity_banner_sheet")) {
					seedCuboidTiles(book, name, 0, 0, 20, 40, 1);
					seedCuboidTiles(book, name, 44, 0, 2, 42, 2);
					seedCuboidTiles(book, name, 0, 42, 20, 2, 2);
				}
				continue;
			}
			tileIndex(book, new BlockAppearance.Face(name, 0xFFFFFF, false), 0x7F7F7F);
		}
	}

	private static void seedSignBoardTiles(AtlasBook book, String name) {
		String[] crops = {
				"2,2,16,12", "18,2,8,12", "28,2,8,12", "36,2,16,12",
				"2,0,16,2", "18,0,8,2", "26,0,16,2", "42,0,8,2",
				"0,2,2,12", "26,2,2,12", "2,14,2,2",
				"0,16,2,7", "2,16,2,7", "4,16,2,7", "6,16,2,7"
		};
		for (String crop : crops) {
			tileIndex(book, new BlockAppearance.Face(name + "@" + crop, 0xFFFFFF, false), 0x7F7F7F);
		}
	}

	private static void seedCuboidTiles(AtlasBook book, String name, int u, int v, int dx, int dy, int dz) {
		int[][] faces = {
				{u + dz, v, dx, dz},
				{u + dz + dx, v, dx, dz},
				{u, v + dz, dz, dy},
				{u + dz, v + dz, dx, dy},
				{u + dz + dx, v + dz, dz, dy},
				{u + dz + dx + dz, v + dz, dx, dy}
		};
		for (int[] c : faces) {
			seedUvGrid(book, name, c[0], c[1], Math.max(1, c[2]), Math.max(1, c[3]));
		}
	}

	private static void seedUvGrid(AtlasBook book, String name, int u, int v, int w, int h) {
		for (int ou = 0; ou < w; ou += 16) {
			int cw = Math.min(16, w - ou);
			for (int ov = 0; ov < h; ov += 16) {
				int ch = Math.min(16, h - ov);
				tileIndex(book, new BlockAppearance.Face(
						name + "@" + (u + ou) + "," + (v + ov) + "," + cw + "," + ch, 0xFFFFFF, false), 0x7F7F7F);
			}
		}
	}

	private static void emitCell(WorldSnapshot snapshot, AtlasBook book, List<float[]> verts, int x, int y, int z) {
		WorldSnapshot.Voxel voxel = snapshot.voxel(x, y, z);
		if (voxel.air()) {
			return;
		}
		List<BlockModels.BakedQuad> quads = BlockModels.bake(
				voxel.id(), voxel.props(), snapshot.minX + x, snapshot.minY + y, snapshot.minZ + z);
		if (!quads.isEmpty()) {
			emitModel(snapshot, book, verts, x, y, z, voxel, quads);
			return;
		}
		if (voxel.torch()) {
			BlockAppearance.Face face = new BlockAppearance.Face(BlockAppearance.torchTexture(voxel.id()), 0xFFFFFF, false);
			int tile = tileIndex(book, face, voxel.mapColor());
			float light = lightmap(voxel.blockLight(), voxel.skyLight(), snapshot.sky.skyBrightness(), 1f);
			emitTorch(verts, snapshot.minX + x, snapshot.minY + y, snapshot.minZ + z, voxel.facing(), tile, light);
			return;
		}
		if (voxel.cross()) {
			BlockAppearance.Face face = BlockAppearance.face(voxel, Direction.UP);
			int tile = tileIndex(book, face, voxel.mapColor());
			float light = lightmap(voxel.blockLight(), voxel.skyLight(), snapshot.sky.skyBrightness(), 1f);
			emitCross(verts, snapshot.minX + x, snapshot.minY + y, snapshot.minZ + z, tile, light, face.multiply());
			return;
		}
		for (Direction faceDir : FACES) {
			WorldSnapshot.Voxel neighbor = snapshot.neighbor(x, y, z, faceDir);
			if (occludes(voxel, neighbor)) {
				continue;
			}
			BlockAppearance.Face face = BlockAppearance.face(voxel, faceDir);
			int tile = tileIndex(book, face, voxel.mapColor());
			float light = faceLight(snapshot, x, y, z, faceDir, SHADE[faceDir.getIndex()]);
			int tint = face.bakedGrassSide() ? 0xFFFFFF : face.multiply();
			emitFace(verts, snapshot, x, y, z, faceDir, tile, light, tint);
		}
	}

	private static void emitModel(WorldSnapshot snapshot, AtlasBook book, List<float[]> verts, int x, int y, int z,
			WorldSnapshot.Voxel voxel, List<BlockModels.BakedQuad> quads) {
		int wx = snapshot.minX + x;
		int wy = snapshot.minY + y;
		int wz = snapshot.minZ + z;
		int[] order = {0, 1, 2, 0, 2, 3};
		for (BlockModels.BakedQuad quad : quads) {
			if (!quad.cull().isEmpty()) {
				Direction cull = direction(quad.cull());
				if (cull != null && occludes(voxel, snapshot.neighbor(x, y, z, cull))) {
					continue;
				}
			}
			int tintColor = quad.tint() >= 0 ? tintOf(voxel, quad.texture()) : 0xFFFFFF;
			BlockAppearance.Face face = new BlockAppearance.Face(quad.texture(), tintColor, false);
			int tile = tileIndex(book, face, voxel.mapColor());
			float shade = modelShade(quad.shade(), quad.corners());
			Direction lightDir = direction(quad.cull());
			float light;
			if (lightDir != null) {
				shade = SHADE[lightDir.getIndex()];
				light = faceLight(snapshot, x, y, z, lightDir, shade);
			} else {
				light = lightmap(voxel.blockLight(), voxel.skyLight(), snapshot.sky.skyBrightness(), shade);
			}
			float r = ((tintColor >> 16) & 0xFF) / 255f * light;
			float g = ((tintColor >> 8) & 0xFF) / 255f * light;
			float b = (tintColor & 0xFF) / 255f * light;
			for (int i : order) {
				float[] c = quad.corners()[i];
				float[] uv = quad.uvs()[i];
				vert(verts, wx + c[0], wy + c[1], wz + c[2], uv[0], uv[1], r, g, b, tile, wx, wy, wz);
			}
		}
	}

	private static boolean occludes(WorldSnapshot.Voxel self, WorldSnapshot.Voxel neighbor) {
		if (neighbor.air()) {
			return false;
		}
		if (neighbor.opaque()) {
			return true;
		}
		if (thinConnect(self.id()) && thinConnect(neighbor.id())) {
			return true;
		}
		return translucent(self.id()) && translucent(neighbor.id())
				&& !thinConnect(neighbor.id());
	}

	private static boolean thinConnect(String id) {
		return id.contains("pane") || id.contains("bars");
	}

	private static boolean translucent(String id) {
		return id.contains("glass") || id.equals("ice") || id.equals("slime_block")
				|| id.equals("honey_block") || id.equals("water") || id.equals("bubble_column")
				|| id.equals("nether_portal");
	}

	private static int tintOf(WorldSnapshot.Voxel voxel, String texture) {
		if (voxel.id().equals("redstone_wire") || texture.contains("redstone_dust")) {
			return RedstoneWireBlock.getWireColor(redstonePower(voxel.props()));
		}
		if (texture.contains("leaf") || texture.contains("vine") || texture.contains("lily")) {
			return voxel.foliage();
		}
		if (texture.contains("water")) {
			return voxel.water();
		}
		return voxel.grass();
	}

	private static int redstonePower(String props) {
		if (props == null) {
			return 0;
		}
		int i = props.indexOf("power=");
		if (i < 0) {
			return 0;
		}
		int start = i + 6;
		int end = start;
		while (end < props.length()) {
			char c = props.charAt(end);
			if (c < '0' || c > '9') {
				break;
			}
			end++;
		}
		if (end == start) {
			return 0;
		}
		try {
			return MathHelper.clamp(Integer.parseInt(props.substring(start, end)), 0, 15);
		} catch (NumberFormatException e) {
			return 0;
		}
	}

	private static float modelShade(boolean shade, float[][] corners) {
		if (!shade) {
			return 1f;
		}
		float ax = corners[1][0] - corners[0][0];
		float ay = corners[1][1] - corners[0][1];
		float az = corners[1][2] - corners[0][2];
		float bx = corners[2][0] - corners[0][0];
		float by = corners[2][1] - corners[0][1];
		float bz = corners[2][2] - corners[0][2];
		float nx = ay * bz - az * by;
		float ny = az * bx - ax * bz;
		float nz = ax * by - ay * bx;
		float axn = Math.abs(nx);
		float ayn = Math.abs(ny);
		float azn = Math.abs(nz);
		if (ayn >= axn && ayn >= azn) {
			return ny >= 0 ? 1f : 0.5f;
		}
		if (azn >= axn) {
			return nz >= 0 ? 0.8f : 0.72f;
		}
		return nx >= 0 ? 0.62f : 0.55f;
	}

	private static Direction direction(String name) {
		return switch (name) {
			case "up" -> Direction.UP;
			case "down" -> Direction.DOWN;
			case "north" -> Direction.NORTH;
			case "south" -> Direction.SOUTH;
			case "west" -> Direction.WEST;
			case "east" -> Direction.EAST;
			default -> null;
		};
	}

	private static void emitTorch(List<float[]> verts, int x, int y, int z, byte facing, int tile, float light) {
		float u0 = 7f / 16f, u1 = 9f / 16f, v0 = 6f / 16f, v1 = 1f;
		float x0;
		float y0 = y;
		float y1 = y + 10f / 16f;
		float z0;
		float x1;
		float z1;
		if (facing == Direction.NORTH.getIndex()) {
			x0 = x + 7f / 16f;
			x1 = x + 9f / 16f;
			z0 = z + 11f / 16f;
			z1 = z + 13f / 16f;
		} else if (facing == Direction.SOUTH.getIndex()) {
			x0 = x + 7f / 16f;
			x1 = x + 9f / 16f;
			z0 = z + 3f / 16f;
			z1 = z + 5f / 16f;
		} else if (facing == Direction.WEST.getIndex()) {
			x0 = x + 11f / 16f;
			x1 = x + 13f / 16f;
			z0 = z + 7f / 16f;
			z1 = z + 9f / 16f;
		} else if (facing == Direction.EAST.getIndex()) {
			x0 = x + 3f / 16f;
			x1 = x + 5f / 16f;
			z0 = z + 7f / 16f;
			z1 = z + 9f / 16f;
		} else {
			x0 = x + 7f / 16f;
			x1 = x + 9f / 16f;
			z0 = z + 7f / 16f;
			z1 = z + 9f / 16f;
		}
		emitBox(verts, x0, y0, z0, x1, y1, z1, tile, light, u0, v0, u1, v1, x, y, z);
	}

	private static void emitBox(List<float[]> verts, float x0, float y0, float z0, float x1, float y1, float z1,
			int tile, float light, float u0, float v0, float u1, float v1, int bx, int by, int bz) {
		float r = light, g = light, b = light;
		float[][][] faces = {
				{{x0, y0, z1}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1}},
				{{x1, y0, z0}, {x0, y0, z0}, {x0, y1, z0}, {x1, y1, z0}},
				{{x0, y0, z0}, {x0, y0, z1}, {x0, y1, z1}, {x0, y1, z0}},
				{{x1, y0, z1}, {x1, y0, z0}, {x1, y1, z0}, {x1, y1, z1}},
				{{x0, y1, z1}, {x1, y1, z1}, {x1, y1, z0}, {x0, y1, z0}},
				{{x0, y0, z0}, {x1, y0, z0}, {x1, y0, z1}, {x0, y0, z1}}
		};
		float[][] uvs = {{u0, v1}, {u1, v1}, {u1, v0}, {u0, v0}};
		int[] order = {0, 1, 2, 0, 2, 3};
		for (float[][] face : faces) {
			for (int i : order) {
				float[] p = face[i];
				float[] uv = uvs[i];
				vert(verts, p[0], p[1], p[2], uv[0], uv[1], r, g, b, tile, bx, by, bz);
			}
		}
	}

	private static void vert(List<float[]> verts, float x, float y, float z, float u, float v,
			float r, float g, float b, float tile, int bx, int by, int bz) {
		verts.add(new float[] {x, y, z, u, v, r, g, b, tile, bx, by, bz});
	}

	private static final String[] BANNER_DYES = {
			"light_blue", "light_gray", "magenta", "orange", "purple", "yellow",
			"black", "brown", "green", "white", "cyan", "gray", "lime", "pink", "blue", "red"
	};

	private static String bannerAtlasFallback(String texture) {
		if (texture == null || !texture.startsWith("entity_banner_")) {
			return "";
		}
		int at = texture.indexOf('@');
		String name = at > 0 ? texture.substring(0, at) : texture;
		String spec = at > 0 ? texture.substring(at) : "";
		for (String dye : BANNER_DYES) {
			String prefix = "entity_banner_" + dye;
			if (name.equals(prefix) || name.startsWith(prefix + "_")) {
				return prefix + spec;
			}
		}
		return "entity_banner_white" + spec;
	}

	private static int existingTile(AtlasBook book, String texture) {
		if (texture == null || texture.isEmpty()) {
			return -1;
		}
		int white = quantize(0xFFFFFF);
		String hex = Integer.toHexString(white);
		Integer exact = book.index.get(texture + "#" + hex);
		if (exact != null) {
			return exact;
		}
		Integer grass = book.index.get(texture + "|g#" + hex);
		if (grass != null) {
			return grass;
		}
		String prefix = texture + "#";
		String gprefix = texture + "|g#";
		for (var entry : book.index.entrySet()) {
			String key = entry.getKey();
			if (key.startsWith(prefix) || key.startsWith(gprefix)) {
				return entry.getValue();
			}
		}
		return -1;
	}

	private static int tileIndex(AtlasBook book, BlockAppearance.Face face, int mapColor) {
		int tint = quantize(face.multiply());
		String key = face.texture() + (face.bakedGrassSide() ? "|g#" : "#") + Integer.toHexString(tint);
		Integer existing = book.index.get(key);
		if (existing != null) {
			return existing;
		}
		if (book.frozen) {
			int fallback = existingTile(book, face.texture());
			if (fallback < 0) {
				fallback = existingTile(book, bannerAtlasFallback(face.texture()));
			}
			return fallback >= 0 ? fallback : 0;
		}
		book.keys.add(new AtlasTile(face.texture(), tint, face.bakedGrassSide(), mapColor));
		int index = book.keys.size() - 1;
		book.index.put(key, index);
		return index;
	}

	private static int quantize(int rgb) {
		int r = ((rgb >> 16) & 0xFF) & ~15;
		int g = ((rgb >> 8) & 0xFF) & ~15;
		int b = (rgb & 0xFF) & ~15;
		return (r << 16) | (g << 8) | b;
	}

	private static float faceLight(WorldSnapshot snapshot, int x, int y, int z, Direction dir, float shade) {
		int nx = x + dir.getOffsetX();
		int ny = y + dir.getOffsetY();
		int nz = z + dir.getOffsetZ();
		int block = snapshot.voxel(nx, ny, nz).blockLight() & 0xFF;
		int sky = snapshot.voxel(nx, ny, nz).skyLight() & 0xFF;
		if (block == 0 && sky == 0) {
			for (Direction around : Direction.values()) {
				WorldSnapshot.Voxel v = snapshot.voxel(nx + around.getOffsetX(), ny + around.getOffsetY(), nz + around.getOffsetZ());
				block = Math.max(block, v.blockLight() & 0xFF);
				sky = Math.max(sky, v.skyLight() & 0xFF);
			}
		}
		return lightmap((byte) block, (byte) sky, snapshot.sky.skyBrightness(), shade);
	}

	private static float lightmap(byte block, byte sky, float skyBrightness, float faceShade) {
		float torch = vanillaBright(block & 0xFF);
		float sun = vanillaBright(sky & 0xFF) * skyBrightness;
		float combined = 1f - (1f - torch) * (1f - sun);
		combined = gammaCorrect(combined, 0.52f);
		return MathHelper.clamp((0.12f + 0.88f * combined) * faceShade, 0.08f, 1f);
	}

	private static float vanillaBright(int level) {
		float f = MathHelper.clamp(level, 0, 15) / 15f;
		return f / (4f - 3f * f);
	}

	private static float gammaCorrect(float value, float gamma) {
		float n = MathHelper.clamp(value, 0f, 1f);
		float q = 1f - n;
		float q2 = q * q;
		return n * (1f - gamma) + (1f - q2 * q2) * gamma;
	}

	private static void emitFace(List<float[]> verts, WorldSnapshot snapshot, int x, int y, int z, Direction face, int tile, float light, int color) {
		float r = ((color >> 16) & 0xFF) / 255f * light;
		float g = ((color >> 8) & 0xFF) / 255f * light;
		float b = (color & 0xFF) / 255f * light;
		int wx = snapshot.minX + x;
		int wy = snapshot.minY + y;
		int wz = snapshot.minZ + z;
		float[][] corners = corners(wx, wy, wz, face);
		float[][] uvs = new float[][] {{0, 1}, {1, 1}, {1, 0}, {0, 0}};
		int[] order = {0, 1, 2, 0, 2, 3};
		for (int i : order) {
			float[] c = corners[i];
			float[] uv = uvs[i];
			float ao = vertexAo(snapshot, x, y, z, face, i);
			vert(verts, c[0], c[1], c[2], uv[0], uv[1], r * ao, g * ao, b * ao, tile, wx, wy, wz);
		}
	}

	private static float vertexAo(WorldSnapshot snapshot, int x, int y, int z, Direction face, int corner) {
		int ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
		switch (face) {
			case DOWN -> {
				ax = (corner == 1 || corner == 2) ? 1 : -1;
				bz = (corner <= 1) ? 1 : -1;
			}
			case UP -> {
				ax = (corner == 1 || corner == 2) ? 1 : -1;
				bz = (corner >= 2) ? 1 : -1;
			}
			case NORTH -> {
				ax = (corner == 0 || corner == 3) ? 1 : -1;
				by = (corner >= 2) ? 1 : -1;
			}
			case SOUTH -> {
				ax = (corner == 1 || corner == 2) ? 1 : -1;
				by = (corner >= 2) ? 1 : -1;
			}
			case WEST -> {
				bz = (corner == 1 || corner == 2) ? 1 : -1;
				by = (corner >= 2) ? 1 : -1;
			}
			case EAST -> {
				bz = (corner == 0 || corner == 3) ? 1 : -1;
				by = (corner >= 2) ? 1 : -1;
			}
		}
		boolean s1 = snapshot.voxel(x + ax, y + ay, z + az).opaque();
		boolean s2 = snapshot.voxel(x + bx, y + by, z + bz).opaque();
		boolean cr = snapshot.voxel(x + ax + bx, y + ay + by, z + az + bz).opaque();
		int occ = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (cr ? 1 : 0);
		if (s1 && s2) {
			occ = 3;
		}
		return 1f - occ * 0.2f;
	}

	private static void emitCross(List<float[]> verts, int x, int y, int z, int tile, float light, int color) {
		float r = ((color >> 16) & 0xFF) / 255f * light;
		float g = ((color >> 8) & 0xFF) / 255f * light;
		float b = (color & 0xFF) / 255f * light;
		float x0 = x, y0 = y, z0 = z, x1 = x + 1, y1 = y + 1, z1 = z + 1;
		float[][] a = {{x0, y0, z0}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z0}};
		float[][] bQuad = {{x1, y0, z0}, {x0, y0, z1}, {x0, y1, z1}, {x1, y1, z0}};
		emitQuad(verts, a, tile, r, g, b, x, y, z);
		emitQuad(verts, new float[][] {a[1], a[0], a[3], a[2]}, tile, r, g, b, x, y, z);
		emitQuad(verts, bQuad, tile, r, g, b, x, y, z);
		emitQuad(verts, new float[][] {bQuad[1], bQuad[0], bQuad[3], bQuad[2]}, tile, r, g, b, x, y, z);
	}

	private static void emitQuad(List<float[]> verts, float[][] corners, int tile, float r, float g, float b,
			int bx, int by, int bz) {
		float[][] uvs = new float[][] {{0, 1}, {1, 1}, {1, 0}, {0, 0}};
		int[] order = {0, 1, 2, 0, 2, 3};
		for (int i : order) {
			float[] c = corners[i];
			float[] uv = uvs[i];
			vert(verts, c[0], c[1], c[2], uv[0], uv[1], r, g, b, tile, bx, by, bz);
		}
	}

	private static float[][] corners(int x, int y, int z, Direction face) {
		float x0 = x;
		float y0 = y;
		float z0 = z;
		float x1 = x + 1;
		float y1 = y + 1;
		float z1 = z + 1;
		return switch (face) {
			case DOWN -> new float[][] {{x0, y0, z1}, {x1, y0, z1}, {x1, y0, z0}, {x0, y0, z0}};
			case UP -> new float[][] {{x0, y1, z0}, {x1, y1, z0}, {x1, y1, z1}, {x0, y1, z1}};
			case NORTH -> new float[][] {{x1, y0, z0}, {x0, y0, z0}, {x0, y1, z0}, {x1, y1, z0}};
			case SOUTH -> new float[][] {{x0, y0, z1}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1}};
			case WEST -> new float[][] {{x0, y0, z0}, {x0, y0, z1}, {x0, y1, z1}, {x0, y1, z0}};
			case EAST -> new float[][] {{x1, y0, z1}, {x1, y0, z0}, {x1, y1, z0}, {x1, y1, z1}};
		};
	}

	private static Atlas packAtlas(List<AtlasTile> keys) {
		int count = Math.max(1, keys.size());
		int tiles = 1;
		while (tiles * tiles < count) {
			tiles++;
		}
		int size = tiles * 16;
		BufferedImage image = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
		Graphics2D g = image.createGraphics();
		g.setComposite(AlphaComposite.Src);
		for (int i = 0; i < keys.size(); i++) {
			int tx = i % tiles;
			int ty = i / tiles;
			AtlasTile tile = keys.get(i);
			BufferedImage src = tile.bakedGrassSide
					? BlockTextures.grassSide(tile.tint)
					: BlockTextures.get(tile.texture, tile.mapColor);
			int dx = tx * 16;
			int dy = ty * 16;
			g.setClip(dx, dy, 16, 16);
			g.drawImage(src, dx, dy, null);
			g.setClip(null);
		}
		g.dispose();
		byte[] png;
		try {
			png = BlockTextures.png(image);
		} catch (IOException e) {
			png = new byte[0];
		}
		return new Atlas(png, tiles);
	}

	private static MeshResult toBinary(WorldSnapshot snapshot, List<float[]> verts, Atlas atlas) {
		int vertexCount = verts.size();
		ByteBuffer buffer = ByteBuffer.allocate(36 + vertexCount * VERT_FLOATS * 4);
		buffer.order(ByteOrder.LITTLE_ENDIAN);
		buffer.put((byte) 'M').put((byte) 'C').put((byte) 'C').put((byte) 'T');
		buffer.putInt(2);
		buffer.putFloat(snapshot.eyeX);
		buffer.putFloat(snapshot.eyeY);
		buffer.putFloat(snapshot.eyeZ);
		buffer.putFloat(snapshot.yaw);
		buffer.putFloat(snapshot.pitch);
		buffer.putInt(atlas.tiles);
		buffer.putInt(vertexCount);
		for (float[] v : verts) {
			for (int i = 0; i < VERT_FLOATS; i++) {
				buffer.putFloat(v[i]);
			}
		}
		return new MeshResult(buffer.array(), atlas.png, snapshot.loaded, snapshot.eyeX, snapshot.eyeY, snapshot.eyeZ, snapshot.yaw, snapshot.pitch, snapshot.sky);
	}

	private record Atlas(byte[] png, int tiles) {
	}

	private record AtlasTile(String texture, int tint, boolean bakedGrassSide, int mapColor) {
	}

	public static final class AtlasBook {
		public final Map<String, Integer> index = new HashMap<>();
		public final List<AtlasTile> keys = new ArrayList<>();
		public byte[] png = new byte[0];
		public int tiles = 1;
		public boolean frozen;
	}
}
