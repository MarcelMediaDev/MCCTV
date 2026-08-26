package com.mcctv.camera;

import net.minecraft.block.BlockState;
import net.minecraft.state.property.Properties;
import net.minecraft.util.math.Direction;

public final class CameraAngles {
	private CameraAngles() {
	}

	public static float yaw(BlockState state) {
		if (state.contains(Properties.HORIZONTAL_FACING)) {
			return yaw(state.get(Properties.HORIZONTAL_FACING));
		}
		if (state.contains(Properties.FACING)) {
			Direction facing = state.get(Properties.FACING);
			if (facing.getAxis().isHorizontal()) {
				return yaw(facing);
			}
		}
		if (state.contains(Properties.ROTATION)) {
			return state.get(Properties.ROTATION) * 22.5f;
		}
		return 0f;
	}

	public static float yaw(Direction facing) {
		return switch (facing) {
			case SOUTH -> 0f;
			case WEST -> 90f;
			case NORTH -> 180f;
			case EAST -> 270f;
			default -> 0f;
		};
	}

	public static float pitch(BlockState state) {
		if (state.contains(Properties.HORIZONTAL_FACING)) {
			return 0f;
		}
		if (state.contains(Properties.FACING)) {
			Direction facing = state.get(Properties.FACING);
			if (facing == Direction.DOWN) {
				return 90f;
			}
			if (facing == Direction.UP) {
				return -90f;
			}
			return 0f;
		}
		return 15f;
	}
}
