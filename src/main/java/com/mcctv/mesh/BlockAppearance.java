package com.mcctv.mesh;

import net.minecraft.block.BlockState;
import net.minecraft.registry.Registries;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.state.property.Properties;
import net.minecraft.util.math.Direction;

public final class BlockAppearance {
	public record Face(String texture, int multiply, boolean bakedGrassSide) {
	}

	private BlockAppearance() {
	}

	public static boolean isCross(String id, BlockState state) {
		if (id.equals("short_grass") || id.equals("fern") || id.equals("dead_bush")
				|| id.equals("crimson_roots") || id.equals("warped_roots")
				|| id.equals("nether_sprouts") || id.equals("hanging_roots")
				|| id.equals("bush") || id.equals("firefly_bush")
				|| id.equals("oak_sapling") || id.endsWith("_sapling")
				|| id.endsWith("_fungus") || id.equals("dandelion") || id.equals("poppy")
				|| id.equals("blue_orchid") || id.equals("allium") || id.equals("azure_bluet")
				|| id.equals("oxeye_daisy") || id.equals("cornflower") || id.equals("lily_of_the_valley")
				|| id.equals("wither_rose") || id.equals("torchflower") || id.equals("closed_eyeblossom")
				|| id.equals("open_eyeblossom") || id.endsWith("_tulip") || id.equals("pink_petals")) {
			return true;
		}
		return state.isIn(BlockTags.SMALL_FLOWERS) || state.isIn(BlockTags.SAPLINGS);
	}

	public static boolean isTorch(String id) {
		return id.equals("torch") || id.equals("soul_torch") || id.equals("redstone_torch")
				|| id.equals("wall_torch") || id.equals("soul_wall_torch") || id.equals("redstone_wall_torch");
	}

	public static String torchTexture(String id) {
		if (id.startsWith("redstone")) {
			return "redstone_torch";
		}
		if (id.startsWith("soul")) {
			return "soul_torch";
		}
		return "torch";
	}

	public static byte facingOf(BlockState state) {
		if (state.contains(Properties.HORIZONTAL_FACING)) {
			return (byte) state.get(Properties.HORIZONTAL_FACING).getIndex();
		}
		if (state.contains(Properties.FACING)) {
			return (byte) state.get(Properties.FACING).getIndex();
		}
		return -1;
	}

	public static String propsOf(BlockState state) {
		StringBuilder out = new StringBuilder();
		for (net.minecraft.state.property.Property<?> property : state.getProperties()) {
			if (!out.isEmpty()) {
				out.append(',');
			}
			out.append(property.getName()).append('=').append(valueName(state, property));
		}
		return out.toString();
	}

	private static <T extends Comparable<T>> String valueName(BlockState state, net.minecraft.state.property.Property<T> property) {
		return property.name(state.get(property));
	}

	public static String idOf(BlockState state) {
		return Registries.BLOCK.getId(state.getBlock()).getPath();
	}

	public static byte axisOf(BlockState state) {
		if (state.contains(Properties.AXIS)) {
			return (byte) state.get(Properties.AXIS).ordinal();
		}
		return -1;
	}

	public static boolean snowyOf(BlockState state) {
		return state.contains(Properties.SNOWY) && Boolean.TRUE.equals(state.get(Properties.SNOWY));
	}

	public static Face face(WorldSnapshot.Voxel voxel, Direction direction) {
		String id = voxel.id();
		int white = 0xFFFFFF;
		if (id.equals("grass_block")) {
			if (direction == Direction.UP) {
				return new Face("grass_block_top", voxel.grass(), false);
			}
			if (direction == Direction.DOWN) {
				return new Face("dirt", white, false);
			}
			if (voxel.snowy()) {
				return new Face("grass_block_snow", white, false);
			}
			return new Face("grass_block_side", voxel.grass(), true);
		}
		if (id.equals("dirt_path") || id.equals("farmland") || id.equals("podzol") || id.equals("mycelium")) {
			if (direction == Direction.UP) {
				return new Face(id + "_top", white, false);
			}
			if (direction == Direction.DOWN) {
				return new Face(id.equals("dirt_path") ? "dirt" : id + "_side", white, false);
			}
			return new Face(id + "_side", white, false);
		}
		if (id.endsWith("_leaves")) {
			int tint = id.startsWith("cherry") || id.startsWith("pale") ? white : voxel.foliage();
			return new Face(id, tint, false);
		}
		if (id.equals("short_grass") || id.equals("tall_grass") || id.equals("fern") || id.equals("large_fern")
				|| id.equals("grass") || id.equals("bush")) {
			return new Face(id.equals("grass") ? "short_grass" : id, voxel.grass(), false);
		}
		if (id.equals("vine") || id.equals("lily_pad")) {
			return new Face(id, voxel.foliage(), false);
		}
		if (id.equals("water") || id.equals("bubble_column")) {
			return new Face("water_still", voxel.water(), false);
		}
		if (id.equals("lava")) {
			return new Face("lava_still", white, false);
		}
		if (isPillar(id)) {
			boolean end = isAxisEnd(voxel.axis(), direction);
			String top = BlockTextures.has(id + "_top") ? id + "_top" : id;
			String side = BlockTextures.has(id) ? id : top;
			return new Face(end ? top : side, white, false);
		}
		if (direction == Direction.UP && BlockTextures.has(id + "_top")) {
			return new Face(id + "_top", white, false);
		}
		if (direction == Direction.DOWN) {
			if (BlockTextures.has(id + "_bottom")) {
				return new Face(id + "_bottom", white, false);
			}
			if (BlockTextures.has(id + "_top")) {
				return new Face(id + "_top", white, false);
			}
		}
		if (direction.getAxis().isHorizontal() && voxel.facing() >= 0) {
			boolean front = direction.getIndex() == voxel.facing();
			boolean lit = voxel.props() != null && voxel.props().contains("lit=true");
			if (front && lit && BlockTextures.has(id + "_front_on")) {
				return new Face(id + "_front_on", white, false);
			}
			if (front && BlockTextures.has(id + "_front")) {
				return new Face(id + "_front", white, false);
			}
		}
		if (direction.getAxis().isHorizontal() && BlockTextures.has(id + "_side")) {
			return new Face(id + "_side", white, false);
		}
		return new Face(id, white, false);
	}

	private static boolean isPillar(String id) {
		return id.endsWith("_log") || id.endsWith("_wood") || id.endsWith("_stem") || id.endsWith("_hyphae")
				|| id.equals("hay_block") || id.equals("bone_block") || id.equals("purpur_pillar")
				|| id.equals("quartz_pillar") || id.equals("ochre_froglight") || id.equals("pearlescent_froglight")
				|| id.equals("verdant_froglight") || id.equals("basalt") || id.equals("polished_basalt")
				|| id.equals("muddy_mangrove_roots");
	}

	private static boolean isAxisEnd(byte axis, Direction direction) {
		if (axis < 0) {
			return direction.getAxis() == Direction.Axis.Y;
		}
		return direction.getAxis().ordinal() == axis;
	}
}
