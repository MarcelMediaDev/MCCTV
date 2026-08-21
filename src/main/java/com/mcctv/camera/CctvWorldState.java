package com.mcctv.camera;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.world.PersistentState;
import net.minecraft.world.PersistentStateType;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class CctvWorldState extends PersistentState {
	public static final Codec<CctvWorldState> CODEC = RecordCodecBuilder.create(instance -> instance.group(
			CameraRecord.CODEC.listOf().fieldOf("cameras").forGetter(state -> state.cameras),
			PlayerAuth.CODEC.listOf().fieldOf("tokens").forGetter(state -> new ArrayList<>(state.tokens.values()))
	).apply(instance, CctvWorldState::new));

	public static final PersistentStateType<CctvWorldState> TYPE = new PersistentStateType<>(
			"mcctv",
			CctvWorldState::new,
			CODEC,
			null
	);

	public final List<CameraRecord> cameras;
	public final Map<UUID, PlayerAuth> tokens;

	public CctvWorldState() {
		this(List.of(), List.of());
	}

	public CctvWorldState(List<CameraRecord> cameras, List<PlayerAuth> auths) {
		this.cameras = new ArrayList<>(cameras);
		this.tokens = new HashMap<>();
		for (PlayerAuth auth : auths) {
			this.tokens.put(auth.playerUuid(), auth);
		}
	}
}
