package com.mcctv.camera;

import java.util.UUID;

public final class CameraIds {
	public static final UUID PROFILE_UUID = UUID.fromString("c7c7c7c7-ca3e-4a00-8000-00000000c7c1");
	public static final String PROFILE_NAME = "MCCTV";
	public static final UUID PACK_UUID = UUID.fromString("c7c7c7c7-0000-4000-8000-00000000c7c1");

	private CameraIds() {
	}

	public static boolean matches(UUID uuid) {
		return PROFILE_UUID.equals(uuid);
	}
}
