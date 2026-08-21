package com.mcctv.mesh;

public record MeshResult(byte[] vertices, byte[] atlasPng, boolean loaded, float eyeX, float eyeY, float eyeZ, float yaw, float pitch, SkyAppearance sky) {
	public static MeshResult empty(WorldSnapshot snapshot) {
		return new MeshResult(new byte[0], new byte[0], false, snapshot.eyeX, snapshot.eyeY, snapshot.eyeZ, snapshot.yaw, snapshot.pitch, snapshot.sky);
	}
}
