package com.mcctv;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;

public class CctvConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

	public int httpPort = 8088;
	public String bindAddress = "0.0.0.0";
	public String publicBaseUrl = "http://localhost:8088";
	public int viewDistance = 48;
	public int maxCamerasPerPlayer = 8;
	public int entityHz = 10;
	public boolean forceLoadWhileViewing = true;
	public boolean sendResourcePack = true;
	public int ticketRadius = 4;

	public static CctvConfig load() {
		Path path = FabricLoader.getInstance().getConfigDir().resolve("mcctv.json");
		CctvConfig config = new CctvConfig();
		if (Files.exists(path)) {
			try (Reader reader = Files.newBufferedReader(path)) {
				CctvConfig loaded = GSON.fromJson(reader, CctvConfig.class);
				if (loaded != null) {
					config = loaded;
				}
			} catch (IOException e) {
				McCctv.LOGGER.warn("Could not read mcctv.json, using defaults", e);
			}
		}
		try {
			Files.createDirectories(path.getParent());
			try (Writer writer = Files.newBufferedWriter(path)) {
				GSON.toJson(config, writer);
			}
		} catch (IOException e) {
			McCctv.LOGGER.warn("Could not write mcctv.json", e);
		}
		return config;
	}
}
