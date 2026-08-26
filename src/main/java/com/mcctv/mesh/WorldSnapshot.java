package com.mcctv.mesh;

import com.mcctv.CctvConfig;
import com.mcctv.camera.CameraRecord;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.MapColor;
import net.minecraft.block.entity.BannerBlockEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.LightType;
import net.minecraft.world.biome.Biome;

public final class WorldSnapshot {
	public final int minX;
	public final int minY;
	public final int minZ;
	public final int sizeX;
	public final int sizeY;
	public final int sizeZ;
	public final float eyeX;
	public final float eyeY;
	public final float eyeZ;
	public final float yaw;
	public final float pitch;
	public final Voxel[] voxels;
	public final boolean loaded;
	public final SkyAppearance sky;
	private final int cameraX;
	private final int cameraY;
	private final int cameraZ;

	public record Voxel(
			boolean air,
			boolean opaque,
			boolean cross,
			boolean torch,
			byte blockLight,
			byte skyLight,
			String id,
			int grass,
			int foliage,
			int water,
			int mapColor,
			byte axis,
			boolean snowy,
			byte facing,
			String props
	) {
	}

	private static final Voxel EMPTY = new Voxel(true, false, false, false, (byte) 0, (byte) 15, "air", 0x91BD59, 0x77AB2F, 0x3F76E4, 0, (byte) -1, false, (byte) -1, "");

	private WorldSnapshot(int minX, int minY, int minZ, int sizeX, int sizeY, int sizeZ,
			float eyeX, float eyeY, float eyeZ, float yaw, float pitch, Voxel[] voxels, boolean loaded, SkyAppearance sky,
			int cameraX, int cameraY, int cameraZ) {
		this.minX = minX;
		this.minY = minY;
		this.minZ = minZ;
		this.sizeX = sizeX;
		this.sizeY = sizeY;
		this.sizeZ = sizeZ;
		this.eyeX = eyeX;
		this.eyeY = eyeY;
		this.eyeZ = eyeZ;
		this.yaw = yaw;
		this.pitch = pitch;
		this.voxels = voxels;
		this.loaded = loaded;
		this.sky = sky;
		this.cameraX = cameraX;
		this.cameraY = cameraY;
		this.cameraZ = cameraZ;
	}

	public static WorldSnapshot capture(ServerWorld world, CameraRecord camera, CctvConfig config) {
		Colormaps.ensureLoaded();
		Vec3d look = camera.look();
		Vec3d eye = camera.eye();
		double eyeX = eye.x;
		double eyeY = eye.y;
		double eyeZ = eye.z;
		SkyAppearance sky = SkyAppearance.capture(world, eyeX, eyeY, eyeZ, config.viewDistance);
		int range = Math.max(8, config.viewDistance);
		int pad = Math.max(16, range);
		double aheadX = eyeX + look.x * range;
		double aheadY = eyeY + look.y * range;
		double aheadZ = eyeZ + look.z * range;
		int minX = MathHelper.floor(Math.min(eyeX, aheadX) - pad);
		int maxX = MathHelper.floor(Math.max(eyeX, aheadX) + pad);
		int minY = MathHelper.floor(Math.min(eyeY, aheadY) - pad);
		int maxY = MathHelper.floor(Math.max(eyeY, aheadY) + pad);
		int minZ = MathHelper.floor(Math.min(eyeZ, aheadZ) - pad);
		int maxZ = MathHelper.floor(Math.max(eyeZ, aheadZ) + pad);
		minY = Math.max(world.getBottomY(), minY);
		maxY = Math.min(world.getTopYInclusive(), maxY);
		int sizeX = maxX - minX + 1;
		int sizeY = maxY - minY + 1;
		int sizeZ = maxZ - minZ + 1;
		Voxel[] voxels = new Voxel[sizeX * sizeY * sizeZ];
		BlockPos.Mutable pos = new BlockPos.Mutable();
		boolean anyLoaded = false;
		for (int y = 0; y < sizeY; y++) {
			for (int z = 0; z < sizeZ; z++) {
				for (int x = 0; x < sizeX; x++) {
					pos.set(minX + x, minY + y, minZ + z);
					int index = x + sizeX * (z + sizeZ * y);
					Voxel voxel = read(world, pos, pos.getX() == camera.x() && pos.getY() == camera.y() && pos.getZ() == camera.z());
					voxels[index] = voxel;
					if (!voxel.air() || world.isChunkLoaded(pos)) {
						anyLoaded = true;
					}
				}
			}
		}
		return new WorldSnapshot(minX, minY, minZ, sizeX, sizeY, sizeZ,
				(float) eyeX, (float) eyeY, (float) eyeZ, camera.yaw(), camera.pitch(), voxels, anyLoaded, sky,
				camera.x(), camera.y(), camera.z());
	}

	public boolean update(ServerWorld world, int worldX, int worldY, int worldZ) {
		int x = worldX - this.minX;
		int y = worldY - this.minY;
		int z = worldZ - this.minZ;
		if (x < 0 || y < 0 || z < 0 || x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) {
			return false;
		}
		this.voxels[x + this.sizeX * (z + this.sizeZ * y)] = read(world, new BlockPos(worldX, worldY, worldZ),
				worldX == this.cameraX && worldY == this.cameraY && worldZ == this.cameraZ);
		return true;
	}

	public boolean containsWorld(int worldX, int worldY, int worldZ) {
		int x = worldX - this.minX;
		int y = worldY - this.minY;
		int z = worldZ - this.minZ;
		return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
	}

	public boolean lightMatches(ServerWorld world, BlockPos pos) {
		int x = pos.getX() - this.minX;
		int y = pos.getY() - this.minY;
		int z = pos.getZ() - this.minZ;
		if (x < 0 || y < 0 || z < 0 || x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) {
			return true;
		}
		Voxel voxel = this.voxels[x + this.sizeX * (z + this.sizeZ * y)];
		return (voxel.blockLight() & 0xFF) == world.getLightLevel(LightType.BLOCK, pos)
				&& (voxel.skyLight() & 0xFF) == world.getLightLevel(LightType.SKY, pos);
	}

	public static String burstTexture(BlockState state) {
		if (state == null || state.isAir()) {
			return "stone";
		}
		String id = BlockAppearance.idOf(state);
		String particle = BlockModels.particleTexture(id);
		if (particle != null) {
			return particle;
		}
		if (id.equals("grass_block")) {
			return "dirt";
		}
		return id;
	}

	public static int burstColor(ServerWorld world, BlockPos pos, BlockState state) {
		if (state == null || state.isAir()) {
			return 0xFFFFFF;
		}
		String id = BlockAppearance.idOf(state);
		Biome biome = world.getBiome(pos).value();
		if (id.contains("leaves") || id.contains("vine") || id.contains("lily")) {
			return Colormaps.safe(biome.getFoliageColor(), 0x77AB2F);
		}
		if ((id.contains("grass") && !id.equals("grass_block")) || id.contains("fern")
				|| id.equals("sugar_cane") || id.equals("tall_grass") || id.equals("short_grass")) {
			return Colormaps.safe(biome.getGrassColorAt(pos.getX(), pos.getZ()), 0x91BD59);
		}
		return 0xFFFFFF;
	}

	private static Voxel read(ServerWorld world, BlockPos pos, boolean hide) {
		if (!world.isChunkLoaded(pos)) {
			return EMPTY;
		}
		Biome biome = world.getBiome(pos).value();
		int grass = Colormaps.safe(biome.getGrassColorAt(pos.getX(), pos.getZ()), 0x91BD59);
		int foliage = Colormaps.safe(biome.getFoliageColor(), 0x77AB2F);
		int water = Colormaps.safe(biome.getWaterColor(), 0x3F76E4);
		byte blockLight = (byte) world.getLightLevel(LightType.BLOCK, pos);
		byte skyLight = (byte) world.getLightLevel(LightType.SKY, pos);
		if (hide) {
			return new Voxel(true, false, false, false, blockLight, skyLight, "air", grass, foliage, water, 0, (byte) -1, false, (byte) -1, "");
		}
		BlockState state = world.getBlockState(pos);
		if (state.isAir()) {
			return new Voxel(true, false, false, false, blockLight, skyLight, "air", grass, foliage, water, 0, (byte) -1, false, (byte) -1, "");
		}
		String id = BlockAppearance.idOf(state);
		MapColor mapColor = state.getMapColor(world, pos);
		int color = mapColor != null ? mapColor.color : 0x7f7f7f;
		String props = BlockAppearance.propsOf(state);
		if (ChestLids.tracks(id)) {
			String lid = "lid=" + ChestLids.progress(world, pos);
			props = props.isEmpty() ? lid : props + "," + lid;
		}
		if (world.getBlockEntity(pos) instanceof BannerBlockEntity banner) {
			String layers = BlockTextures.bannerLayers(banner);
			if (!layers.isEmpty()) {
				String extra = "layers=" + layers;
				props = props.isEmpty() ? extra : props + "," + extra;
			}
		}
		return new Voxel(
				false,
				state.isOpaque() && Block.isShapeFullCube(state.getCollisionShape(world, pos)),
				BlockAppearance.isCross(id, state) && !BlockAppearance.isTorch(id),
				BlockAppearance.isTorch(id),
				blockLight,
				skyLight,
				id,
				grass,
				foliage,
				water,
				color,
				BlockAppearance.axisOf(state),
				BlockAppearance.snowyOf(state),
				BlockAppearance.facingOf(state),
				props
		);
	}

	public Voxel voxel(int x, int y, int z) {
		if (x < 0 || y < 0 || z < 0 || x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) {
			return EMPTY;
		}
		return this.voxels[x + this.sizeX * (z + this.sizeZ * y)];
	}

	public Voxel neighbor(int x, int y, int z, Direction direction) {
		return voxel(x + direction.getOffsetX(), y + direction.getOffsetY(), z + direction.getOffsetZ());
	}
}
