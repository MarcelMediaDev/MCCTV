package com.mcctv.mixin;

import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.mcctv.McCctv;
import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.DecoderException;
import net.minecraft.network.handler.DecoderHandler;
import org.spongepowered.asm.mixin.Mixin;

import java.util.List;

@Mixin(DecoderHandler.class)
public class DecoderHandlerMixin {
	@WrapMethod(method = "decode")
	private void mcctv$dropUnknownPackets(ChannelHandlerContext context, ByteBuf buf, List<Object> objects, Operation<Void> original) {
		try {
			original.call(context, buf, objects);
		} catch (DecoderException e) {
			String message = String.valueOf(e.getMessage());
			if (message.contains("unknown packet id") && buf != null) {
				if (buf.isReadable()) {
					buf.skipBytes(buf.readableBytes());
				}
				McCctv.LOGGER.warn("Ignored inbound {}", message);
				return;
			}
			throw e;
		}
	}
}
