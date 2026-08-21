package com.mcctv.web;

import com.mcctv.McCctv;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public final class ResourcePackBuilder {
	private ResourcePackBuilder() {
	}

	public static byte[] build() {
		try (ByteArrayOutputStream bytes = new ByteArrayOutputStream(); ZipOutputStream zip = new ZipOutputStream(bytes)) {
			zip.putNextEntry(new ZipEntry("pack.mcmeta"));
			zip.write("""
					{
					  "pack": {
					    "pack_format": 75,
					    "description": "MCCTV camera skin"
					  }
					}
					""".getBytes(StandardCharsets.UTF_8));
			zip.closeEntry();
			byte[] png = readPng();
			if (png.length > 0) {
				zip.putNextEntry(new ZipEntry("assets/mcctv/textures/entity/camera.png"));
				zip.write(png);
				zip.closeEntry();
			}
			zip.finish();
			return bytes.toByteArray();
		} catch (IOException e) {
			McCctv.LOGGER.warn("Failed to build camera resource pack", e);
			return new byte[0];
		}
	}

	public static String sha1(byte[] data) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-1").digest(data);
			return HexFormat.of().formatHex(digest);
		} catch (Exception e) {
			return "";
		}
	}

	private static byte[] readPng() throws IOException {
		try (InputStream in = ResourcePackBuilder.class.getResourceAsStream("/assets/mcctv/textures/entity/camera.png")) {
			if (in == null) {
				return new byte[0];
			}
			return in.readAllBytes();
		}
	}
}
