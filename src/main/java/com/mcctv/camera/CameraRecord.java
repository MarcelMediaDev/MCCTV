package com.mcctv.camera;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.util.math.Vec3d;

import java.util.UUID;

public record CameraRecord(
		UUID id,
		String dimension,
		int x,
		int y,
		int z,
		float yaw,
		float pitch,
		UUID ownerUuid,
		String name
) {
	public static final Codec<UUID> UUID_CODEC = Codec.STRING.xmap(UUID::fromString, UUID::toString);

	public static final Codec<CameraRecord> CODEC = RecordCodecBuilder.create(instance -> instance.group(
			UUID_CODEC.fieldOf("id").forGetter(CameraRecord::id),
			Codec.STRING.fieldOf("dimension").forGetter(CameraRecord::dimension),
			Codec.INT.fieldOf("x").forGetter(CameraRecord::x),
			Codec.INT.fieldOf("y").forGetter(CameraRecord::y),
			Codec.INT.fieldOf("z").forGetter(CameraRecord::z),
			Codec.FLOAT.fieldOf("yaw").forGetter(CameraRecord::yaw),
			Codec.FLOAT.fieldOf("pitch").forGetter(CameraRecord::pitch),
			UUID_CODEC.fieldOf("ownerUuid").forGetter(CameraRecord::ownerUuid),
			Codec.STRING.fieldOf("name").forGetter(CameraRecord::name)
	).apply(instance, CameraRecord::new));

	public CameraRecord withName(String newName) {
		return new CameraRecord(this.id, this.dimension, this.x, this.y, this.z, this.yaw, this.pitch, this.ownerUuid, newName);
	}

	public boolean isAt(String dimensionId, int bx, int by, int bz) {
		return this.dimension.equals(dimensionId) && this.x == bx && this.y == by && this.z == bz;
	}

	public Vec3d look() {
		return Vec3d.fromPolar(this.pitch, this.yaw);
	}

	public Vec3d eye() {
		Vec3d look = this.look();
		return new Vec3d(
				this.x + 0.5 + look.x * 0.2,
				this.y + 0.5 + look.y * 0.2,
				this.z + 0.5 + look.z * 0.2
		);
	}
}
