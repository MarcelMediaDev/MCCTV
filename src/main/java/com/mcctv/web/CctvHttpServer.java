package com.mcctv.web;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mcctv.CctvConfig;
import com.mcctv.McCctv;
import com.mcctv.camera.CameraIds;
import com.mcctv.camera.CameraRecord;
import com.mcctv.camera.CameraRegistry;
import com.mcctv.camera.PlayerAuth;
import com.mcctv.mesh.BlockTextures;
import com.mcctv.mesh.EquipmentTextures;
import com.mcctv.mesh.ItemTextures;
import com.mcctv.mesh.MobTextures;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.buffer.Unpooled;
import io.netty.channel.Channel;
import io.netty.channel.ChannelFutureListener;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelPipeline;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.DefaultFullHttpResponse;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.FullHttpResponse;
import io.netty.handler.codec.http.HttpHeaderNames;
import io.netty.handler.codec.http.HttpMethod;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.HttpUtil;
import io.netty.handler.codec.http.HttpVersion;
import io.netty.handler.codec.http.QueryStringDecoder;
import io.netty.handler.codec.http.websocketx.CloseWebSocketFrame;
import io.netty.handler.codec.http.websocketx.PingWebSocketFrame;
import io.netty.handler.codec.http.websocketx.PongWebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketServerHandshaker;
import io.netty.handler.codec.http.websocketx.WebSocketServerHandshakerFactory;
import net.minecraft.network.packet.s2c.common.ResourcePackSendS2CPacket;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.Text;

import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;

public class CctvHttpServer {
	private final CctvConfig config;
	private final CameraRegistry cameras;
	private final CctvSessions sessions;
	private final byte[] packBytes;
	private final String packHash;
	private EventLoopGroup boss;
	private EventLoopGroup worker;
	private Channel channel;
	private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
	private final ConcurrentHashMap<String, byte[]> skinCache = new ConcurrentHashMap<>();
	private final byte[] defaultSteve = firstNonEmpty(
			loadClasspath("/assets/mcctv/vanilla/steve.png"),
			loadVanillaTexture(
					"assets/minecraft/textures/entity/player/wide/steve.png",
					"assets/minecraft/textures/entity/steve.png"
			)
	);
	private final byte[] destroyAtlas;
	private final byte[] asciiFont = firstNonEmpty(
			loadClasspath("/assets/mcctv/vanilla/font/ascii.png"),
			loadVanillaTexture("assets/minecraft/textures/font/ascii.png")
	);

	public CctvHttpServer(CctvConfig config, CameraRegistry cameras, CctvSessions sessions) {
		this.config = config;
		this.cameras = cameras;
		this.sessions = sessions;
		this.packBytes = ResourcePackBuilder.build();
		this.packHash = ResourcePackBuilder.sha1(this.packBytes);
		this.destroyAtlas = BlockTextures.destroyAtlas();
	}

	public void start() throws InterruptedException {
		this.boss = new NioEventLoopGroup(1);
		this.worker = new NioEventLoopGroup();
		ServerBootstrap bootstrap = new ServerBootstrap();
		bootstrap.group(this.boss, this.worker)
				.channel(NioServerSocketChannel.class)
				.childHandler(new ChannelInitializer<SocketChannel>() {
					@Override
					protected void initChannel(SocketChannel ch) {
						ChannelPipeline pipeline = ch.pipeline();
						pipeline.addLast(new HttpServerCodec());
						pipeline.addLast(new HttpObjectAggregator(8 * 1024 * 1024));
						pipeline.addLast(new HttpHandler());
					}
				});
		this.channel = bootstrap.bind(new InetSocketAddress(this.config.bindAddress, this.config.httpPort)).sync().channel();
	}

	public void stop() {
		if (this.channel != null) {
			this.channel.close();
		}
		if (this.boss != null) {
			this.boss.shutdownGracefully();
		}
		if (this.worker != null) {
			this.worker.shutdownGracefully();
		}
	}

	public void sendResourcePack(ServerPlayerEntity player) {
		if (!this.config.sendResourcePack || this.packBytes.length == 0 || this.packHash.isEmpty()) {
			return;
		}
		player.networkHandler.sendPacket(new ResourcePackSendS2CPacket(
				CameraIds.PACK_UUID,
				this.config.publicBaseUrl + "/pack.zip",
				this.packHash,
				false,
				Optional.of(Text.literal("MCCTV camera texture"))
		));
	}

	private class HttpHandler extends SimpleChannelInboundHandler<Object> {
		private WebSocketServerHandshaker handshaker;
		private UUID cameraId;

		@Override
		protected void channelRead0(ChannelHandlerContext ctx, Object msg) {
			if (msg instanceof FullHttpRequest request) {
				this.handleHttp(ctx, request);
			} else if (msg instanceof WebSocketFrame frame) {
				this.handleWs(ctx, frame);
			}
		}

		private void handleHttp(ChannelHandlerContext ctx, FullHttpRequest request) {
			QueryStringDecoder decoder = new QueryStringDecoder(request.uri());
			String path = decoder.path();
			if ("websocket".equalsIgnoreCase(request.headers().get(HttpHeaderNames.UPGRADE)) || path.startsWith("/ws")) {
				this.handshake(ctx, request, decoder);
				return;
			}
			if (path.startsWith("/api/cameras/") && (request.method() == HttpMethod.DELETE || request.method() == HttpMethod.POST)) {
				this.apiDeleteCamera(ctx, request, decoder, path);
				return;
			}
			if (request.method() != HttpMethod.GET) {
				send(ctx, request, HttpResponseStatus.METHOD_NOT_ALLOWED, "text/plain", "Method not allowed");
				return;
			}
			if ("/".equals(path) || "/index.html".equals(path)) {
				sendResource(ctx, request, "/assets/mcctv/web/index.html", "text/html; charset=utf-8");
				return;
			}
			if ("/app.js".equals(path)) {
				sendResource(ctx, request, "/assets/mcctv/web/app.js", "text/javascript; charset=utf-8");
				return;
			}
			if ("/style.css".equals(path)) {
				sendResource(ctx, request, "/assets/mcctv/web/style.css", "text/css; charset=utf-8");
				return;
			}
			if ("/pack.zip".equals(path)) {
				sendBytes(ctx, request, HttpResponseStatus.OK, "application/zip", CctvHttpServer.this.packBytes);
				return;
			}
			if ("/api/destroy.png".equals(path)) {
				sendBytes(ctx, request, HttpResponseStatus.OK, "image/png", CctvHttpServer.this.destroyAtlas);
				return;
			}
			if ("/api/cameras".equals(path)) {
				this.apiCameras(ctx, request, decoder);
				return;
			}
			if (path.startsWith("/api/skin/")) {
				this.apiSkin(ctx, request, path.substring("/api/skin/".length()));
				return;
			}
			if ("/api/font/ascii.png".equals(path)) {
				if (CctvHttpServer.this.asciiFont.length == 0) {
					send(ctx, request, HttpResponseStatus.NOT_FOUND, "text/plain", "No font");
					return;
				}
				sendBytes(ctx, request, HttpResponseStatus.OK, "image/png", CctvHttpServer.this.asciiFont);
				return;
			}
			if (path.startsWith("/api/mob/")) {
				this.apiMob(ctx, request, path.substring("/api/mob/".length()));
				return;
			}
			if (path.startsWith("/api/item/")) {
				this.apiItem(ctx, request, path.substring("/api/item/".length()));
				return;
			}
			if (path.startsWith("/api/armor/")) {
				this.apiArmor(ctx, request, path.substring("/api/armor/".length()));
				return;
			}
			send(ctx, request, HttpResponseStatus.NOT_FOUND, "text/plain", "Not found");
		}

		private void handshake(ChannelHandlerContext ctx, FullHttpRequest request, QueryStringDecoder decoder) {
			String token = first(decoder, "token");
			String camera = first(decoder, "camera");
			Optional<PlayerAuth> auth = CctvHttpServer.this.cameras.authByToken(token);
			UUID id;
			try {
				id = UUID.fromString(camera == null ? "" : camera);
			} catch (Exception e) {
				send(ctx, request, HttpResponseStatus.BAD_REQUEST, "text/plain", "Bad camera");
				return;
			}
			if (auth.isEmpty() || !CctvHttpServer.this.cameras.canView(auth.get(), id)) {
				send(ctx, request, HttpResponseStatus.UNAUTHORIZED, "text/plain", "Unauthorized");
				return;
			}
			WebSocketServerHandshakerFactory factory = new WebSocketServerHandshakerFactory(wsUrl(request), null, true, 8 * 1024 * 1024);
			this.handshaker = factory.newHandshaker(request);
			if (this.handshaker == null) {
				WebSocketServerHandshakerFactory.sendUnsupportedVersionResponse(ctx.channel());
				return;
			}
			this.cameraId = id;
			this.handshaker.handshake(ctx.channel(), request).addListener(future -> {
				if (future.isSuccess()) {
					CctvHttpServer.this.sessions.addViewer(id, ctx.channel());
				}
			});
		}

		private void handleWs(ChannelHandlerContext ctx, WebSocketFrame frame) {
			if (frame instanceof CloseWebSocketFrame close) {
				if (this.handshaker != null) {
					this.handshaker.close(ctx.channel(), close.retain());
				}
				return;
			}
			if (frame instanceof PingWebSocketFrame ping) {
				ctx.writeAndFlush(new PongWebSocketFrame(ping.content().retain()));
			}
		}

		@Override
		public void channelInactive(ChannelHandlerContext ctx) {
			if (this.cameraId != null) {
				CctvHttpServer.this.sessions.removeViewer(this.cameraId, ctx.channel());
			}
		}

		@Override
		public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
			McCctv.LOGGER.debug("HTTP/WS error", cause);
			ctx.close();
		}

		private void apiCameras(ChannelHandlerContext ctx, FullHttpRequest request, QueryStringDecoder decoder) {
			Optional<PlayerAuth> auth = CctvHttpServer.this.cameras.authByToken(first(decoder, "token"));
			if (auth.isEmpty()) {
				send(ctx, request, HttpResponseStatus.UNAUTHORIZED, "application/json", "{\"error\":\"unauthorized\"}");
				return;
			}
			JsonArray array = new JsonArray();
			for (CameraRecord camera : CctvHttpServer.this.cameras.visibleTo(auth.get())) {
				JsonObject obj = new JsonObject();
				obj.addProperty("id", camera.id().toString());
				obj.addProperty("name", camera.name());
				obj.addProperty("dimension", camera.dimension());
				obj.addProperty("x", camera.x());
				obj.addProperty("y", camera.y());
				obj.addProperty("z", camera.z());
				obj.addProperty("yaw", camera.yaw());
				obj.addProperty("pitch", camera.pitch());
				array.add(obj);
			}
			JsonObject root = new JsonObject();
			root.add("cameras", array);
			root.addProperty("op", auth.get().op());
			send(ctx, request, HttpResponseStatus.OK, "application/json", root.toString());
		}

		private void apiDeleteCamera(ChannelHandlerContext ctx, FullHttpRequest request, QueryStringDecoder decoder, String path) {
			Optional<PlayerAuth> auth = CctvHttpServer.this.cameras.authByToken(first(decoder, "token"));
			if (auth.isEmpty()) {
				send(ctx, request, HttpResponseStatus.UNAUTHORIZED, "application/json", "{\"error\":\"unauthorized\"}");
				return;
			}
			String rest = path.substring("/api/cameras/".length());
			if (rest.endsWith("/delete")) {
				rest = rest.substring(0, rest.length() - "/delete".length());
			}
			UUID id;
			try {
				id = UUID.fromString(rest);
			} catch (Exception e) {
				send(ctx, request, HttpResponseStatus.BAD_REQUEST, "application/json", "{\"error\":\"bad id\"}");
				return;
			}
			if (!CctvHttpServer.this.cameras.canView(auth.get(), id)) {
				send(ctx, request, HttpResponseStatus.UNAUTHORIZED, "application/json", "{\"error\":\"unauthorized\"}");
				return;
			}
			Optional<CameraRecord> gone = CctvHttpServer.this.cameras.remove(id);
			if (gone.isEmpty()) {
				send(ctx, request, HttpResponseStatus.NOT_FOUND, "application/json", "{\"error\":\"missing\"}");
				return;
			}
			CctvHttpServer.this.sessions.dropCamera(gone.get());
			send(ctx, request, HttpResponseStatus.OK, "application/json", "{\"ok\":true}");
		}

		private void apiMob(ChannelHandlerContext ctx, FullHttpRequest request, String name) {
			byte[] png = MobTextures.png(name);
			if (png.length == 0) {
				send(ctx, request, HttpResponseStatus.NOT_FOUND, "text/plain", "No mob");
				return;
			}
			sendBytes(ctx, request, HttpResponseStatus.OK, "image/png", png);
		}

		private void apiItem(ChannelHandlerContext ctx, FullHttpRequest request, String name) {
			byte[] png = ItemTextures.png(name);
			if (png.length == 0) {
				send(ctx, request, HttpResponseStatus.NOT_FOUND, "text/plain", "No item");
				return;
			}
			sendBytes(ctx, request, HttpResponseStatus.OK, "image/png", png);
		}

		private void apiArmor(ChannelHandlerContext ctx, FullHttpRequest request, String path) {
			int slash = path.indexOf('/');
			if (slash <= 0 || slash >= path.length() - 1) {
				send(ctx, request, HttpResponseStatus.NOT_FOUND, "text/plain", "No armor");
				return;
			}
			String layer = path.substring(0, slash);
			String material = path.substring(slash + 1);
			if (!layer.equals("humanoid") && !layer.equals("humanoid_leggings")) {
				send(ctx, request, HttpResponseStatus.NOT_FOUND, "text/plain", "No armor");
				return;
			}
			byte[] png = EquipmentTextures.png(layer, material);
			if (png.length == 0) {
				send(ctx, request, HttpResponseStatus.NOT_FOUND, "text/plain", "No armor");
				return;
			}
			sendBytes(ctx, request, HttpResponseStatus.OK, "image/png", png);
		}

		private void apiSkin(ChannelHandlerContext ctx, FullHttpRequest request, String uuid) {
			if ("steve".equalsIgnoreCase(uuid) && CctvHttpServer.this.defaultSteve.length > 0) {
				sendBytes(ctx, request, HttpResponseStatus.OK, "image/png", CctvHttpServer.this.defaultSteve);
				return;
			}
			byte[] cached = CctvHttpServer.this.skinCache.get(uuid);
			if (cached != null) {
				sendBytes(ctx, request, HttpResponseStatus.OK, "image/png", cached);
				return;
			}
			try {
				HttpRequest skinRequest = HttpRequest.newBuilder(URI.create("https://crafatar.com/skins/" + uuid)).timeout(Duration.ofSeconds(8)).GET().build();
				HttpResponse<byte[]> response = CctvHttpServer.this.httpClient.send(skinRequest, HttpResponse.BodyHandlers.ofByteArray());
				if (response.statusCode() >= 200 && response.statusCode() < 300 && response.body().length > 0) {
					CctvHttpServer.this.skinCache.put(uuid, response.body());
					sendBytes(ctx, request, HttpResponseStatus.OK, "image/png", response.body());
					return;
				}
			} catch (Exception e) {
				McCctv.LOGGER.debug("Skin fetch failed for {}", uuid, e);
			}
			if (CctvHttpServer.this.defaultSteve.length > 0) {
				sendBytes(ctx, request, HttpResponseStatus.OK, "image/png", CctvHttpServer.this.defaultSteve);
				return;
			}
			send(ctx, request, HttpResponseStatus.NOT_FOUND, "text/plain", "No skin");
		}
	}

	private static byte[] firstNonEmpty(byte[]... candidates) {
		for (byte[] candidate : candidates) {
			if (candidate != null && candidate.length > 0) {
				return candidate;
			}
		}
		return new byte[0];
	}

	private static byte[] loadClasspath(String path) {
		try (InputStream in = CctvHttpServer.class.getResourceAsStream(path)) {
			return in == null ? new byte[0] : in.readAllBytes();
		} catch (Exception e) {
			return new byte[0];
		}
	}

	private static byte[] loadVanillaTexture(String... paths) {
		try {
			ModContainer container = FabricLoader.getInstance().getModContainer("minecraft").orElse(null);
			if (container == null) {
				return new byte[0];
			}
			for (Path root : container.getRootPaths()) {
				byte[] found = readTexture(root, paths);
				if (found.length > 0) {
					return found;
				}
			}
		} catch (Exception e) {
			McCctv.LOGGER.debug("Could not load vanilla player skin", e);
		}
		return new byte[0];
	}

	private static byte[] readTexture(Path root, String[] paths) {
		if (Files.isDirectory(root)) {
			for (String path : paths) {
				Path file = root.resolve(path);
				if (Files.isRegularFile(file)) {
					try {
						return Files.readAllBytes(file);
					} catch (Exception ignored) {
					}
				}
			}
			return new byte[0];
		}
		String name = root.toString();
		if (name.endsWith(".jar") || name.endsWith(".zip")) {
			try (ZipFile zip = new ZipFile(root.toFile())) {
				for (String path : paths) {
					ZipEntry entry = zip.getEntry(path);
					if (entry != null) {
						try (InputStream in = zip.getInputStream(entry)) {
							return in.readAllBytes();
						}
					}
				}
			} catch (Exception ignored) {
			}
			return new byte[0];
		}
		try (FileSystem fs = FileSystems.newFileSystem(root)) {
			return readTexture(fs.getPath("/"), paths);
		} catch (Exception ignored) {
			return new byte[0];
		}
	}

	private static String first(QueryStringDecoder decoder, String key) {
		List<String> values = decoder.parameters().get(key);
		return values == null || values.isEmpty() ? null : values.getFirst();
	}

	private static String wsUrl(FullHttpRequest request) {
		String host = request.headers().get(HttpHeaderNames.HOST);
		boolean ssl = false;
		return (ssl ? "wss" : "ws") + "://" + host + request.uri();
	}

	private static void sendResource(ChannelHandlerContext ctx, FullHttpRequest request, String classpath, String type) {
		try (InputStream in = CctvHttpServer.class.getResourceAsStream(classpath)) {
			if (in == null) {
				send(ctx, request, HttpResponseStatus.NOT_FOUND, "text/plain", "Missing " + classpath);
				return;
			}
			sendBytes(ctx, request, HttpResponseStatus.OK, type, in.readAllBytes());
		} catch (Exception e) {
			send(ctx, request, HttpResponseStatus.INTERNAL_SERVER_ERROR, "text/plain", "Error");
		}
	}

	private static void send(ChannelHandlerContext ctx, FullHttpRequest request, HttpResponseStatus status, String type, String body) {
		sendBytes(ctx, request, status, type, body.getBytes(StandardCharsets.UTF_8));
	}

	private static void sendBytes(ChannelHandlerContext ctx, FullHttpRequest request, HttpResponseStatus status, String type, byte[] body) {
		FullHttpResponse response = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, status, Unpooled.wrappedBuffer(body));
		response.headers().set(HttpHeaderNames.CONTENT_TYPE, type);
		HttpUtil.setContentLength(response, body.length);
		if (!HttpUtil.isKeepAlive(request)) {
			ctx.writeAndFlush(response).addListener(ChannelFutureListener.CLOSE);
		} else {
			response.headers().set(HttpHeaderNames.CONNECTION, "keep-alive");
			ctx.writeAndFlush(response);
		}
	}
}
