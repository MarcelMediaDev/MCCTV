package com.mcctv.mixin;

import com.mcctv.McCctv;
import net.minecraft.block.BlockState;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerWorld.class)
public class ServerWorldMixin {
	@Inject(method = "updateListeners", at = @At("HEAD"))
	private void mcctv$onBlockUpdate(BlockPos pos, BlockState oldState, BlockState newState, int flags, CallbackInfo ci) {
		try {
			if (McCctv.get() == null || McCctv.get().sessions() == null) {
				return;
			}
			McCctv.get().sessions().onBlockChanged((ServerWorld) (Object) this, pos, oldState, newState);
		} catch (Throwable ignored) {
		}
	}

	@Inject(method = "setBlockBreakingInfo", at = @At("HEAD"))
	private void mcctv$onBlockBreaking(int entityId, BlockPos pos, int progress, CallbackInfo ci) {
		try {
			if (McCctv.get() == null || McCctv.get().sessions() == null) {
				return;
			}
			McCctv.get().sessions().onBlockBreaking((ServerWorld) (Object) this, pos, progress);
		} catch (Throwable ignored) {
		}
	}
}
