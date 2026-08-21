package com.mcctv.camera;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;

import java.util.UUID;

public record PlayerAuth(UUID playerUuid, String token, boolean op) {
	public static final Codec<PlayerAuth> CODEC = RecordCodecBuilder.create(instance -> instance.group(
			CameraRecord.UUID_CODEC.fieldOf("playerUuid").forGetter(PlayerAuth::playerUuid),
			Codec.STRING.fieldOf("token").forGetter(PlayerAuth::token),
			Codec.BOOL.fieldOf("op").forGetter(PlayerAuth::op)
	).apply(instance, PlayerAuth::new));

	public PlayerAuth withOp(boolean operator) {
		return new PlayerAuth(this.playerUuid, this.token, operator);
	}

	public PlayerAuth withToken(String newToken) {
		return new PlayerAuth(this.playerUuid, newToken, this.op);
	}
}
