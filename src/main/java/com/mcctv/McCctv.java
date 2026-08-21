package com.mcctv;

import com.mcctv.camera.CameraRegistry;
import com.mcctv.command.CctvCommand;
import com.mcctv.mesh.Colormaps;
import com.mcctv.web.CctvHttpServer;
import com.mcctv.web.CctvSessions;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class McCctv implements ModInitializer {
	public static final String MOD_ID = "mcctv";
	public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

	private static McCctv instance;

	private CctvConfig config;
	private CameraRegistry cameras;
	private CctvSessions sessions;
	private CctvHttpServer httpServer;
	private MinecraftServer server;

	public static McCctv get() {
		return instance;
	}

	public static Identifier id(String path) {
		return Identifier.of(MOD_ID, path);
	}

	@Override
	public void onInitialize() {
		instance = this;
		Colormaps.ensureLoaded();
		this.config = CctvConfig.load();

		ServerLifecycleEvents.SERVER_STARTED.register(this::onServerStarted);
		ServerLifecycleEvents.SERVER_STOPPING.register(this::onServerStopping);
		ServerTickEvents.END_SERVER_TICK.register(this::onServerTick);
		CctvCommand.register();

		PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, entity) -> {
			if (this.sessions != null && this.cameras != null && !world.isClient()) {
				for (var gone : this.cameras.removeAt(world, pos)) {
					this.sessions.dropCamera(gone);
				}
			}
		});

		ServerPlayConnectionEvents.JOIN.register((handler, sender, minecraftServer) -> {
			if (this.httpServer != null) {
				this.httpServer.sendResourcePack(handler.player);
			}
		});

		LOGGER.info("MCCTV initialized");
	}

	private void onServerStarted(MinecraftServer started) {
		this.server = started;
		this.cameras = new CameraRegistry(started, this.config);
		this.sessions = new CctvSessions(started, this.config, this.cameras);
		this.httpServer = new CctvHttpServer(this.config, this.cameras, this.sessions);
		try {
			this.httpServer.start();
			LOGGER.info("MCCTV web UI at {} (port {})", this.config.publicBaseUrl, this.config.httpPort);
		} catch (Exception e) {
			LOGGER.error("Failed to start MCCTV HTTP server", e);
		}
	}

	private void onServerStopping(MinecraftServer stopping) {
		if (this.sessions != null) {
			this.sessions.shutdown();
		}
		if (this.httpServer != null) {
			this.httpServer.stop();
		}
		this.server = null;
		this.cameras = null;
		this.sessions = null;
		this.httpServer = null;
	}

	private void onServerTick(MinecraftServer ticking) {
		if (this.sessions != null) {
			this.sessions.tick();
		}
	}

	public CctvConfig config() {
		return this.config;
	}

	public CameraRegistry cameras() {
		return this.cameras;
	}

	public CctvSessions sessions() {
		return this.sessions;
	}

	public MinecraftServer server() {
		return this.server;
	}
}
