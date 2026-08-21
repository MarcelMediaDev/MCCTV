package com.mcctv.command;

import com.mcctv.McCctv;
import com.mcctv.camera.CameraItemFactory;
import com.mcctv.camera.CameraRecord;
import com.mcctv.camera.PlayerAuth;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.command.argument.EntityArgumentType;
import net.minecraft.server.command.CommandManager;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.ClickEvent;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

import java.net.URI;
import java.util.List;

public final class CctvCommand {
	private CctvCommand() {
	}

	public static void register() {
		CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> register(dispatcher));
	}

	private static void register(CommandDispatcher<ServerCommandSource> dispatcher) {
		dispatcher.register(CommandManager.literal("cctv")
				.executes(ctx -> info(ctx.getSource()))
				.then(CommandManager.literal("give")
						.executes(ctx -> give(ctx.getSource(), ctx.getSource().getPlayerOrThrow()))
						.then(CommandManager.argument("player", EntityArgumentType.player())
								.executes(ctx -> give(ctx.getSource(), EntityArgumentType.getPlayer(ctx, "player")))))
				.then(CommandManager.literal("remove")
						.executes(ctx -> removeNearest(ctx.getSource())))
				.then(CommandManager.literal("name")
						.then(CommandManager.argument("name", StringArgumentType.greedyString())
								.executes(ctx -> rename(ctx.getSource(), StringArgumentType.getString(ctx, "name")))))
				.then(CommandManager.literal("token")
						.then(CommandManager.literal("reset")
								.executes(ctx -> resetToken(ctx.getSource())))));
	}

	private static int info(ServerCommandSource source) throws CommandSyntaxException {
		ServerPlayerEntity player = source.getPlayerOrThrow();
		PlayerAuth auth = McCctv.get().cameras().tokenFor(player);
		String url = McCctv.get().config().publicBaseUrl + "/?token=" + auth.token();
		Text link = Text.literal(url).setStyle(Style.EMPTY
				.withColor(Formatting.AQUA)
				.withUnderline(true)
				.withClickEvent(new ClickEvent.OpenUrl(URI.create(url))));
		source.sendFeedback(() -> Text.literal("MCCTV dashboard: ").formatted(Formatting.GRAY).append(link), false);
		int claimed = McCctv.get().cameras().claimNearby(player, 16);
		if (claimed > 0) {
			source.sendFeedback(() -> Text.literal("Linked " + claimed + " nearby CCTV head(s).").formatted(Formatting.GREEN), false);
		}
		List<CameraRecord> cameras = McCctv.get().cameras().visibleTo(auth);
		if (cameras.isEmpty()) {
			source.sendFeedback(() -> Text.literal("No cameras placed. Put the CCTV head on a wall, then run /cctv again.").formatted(Formatting.YELLOW), false);
		} else {
			source.sendFeedback(() -> Text.literal((auth.op() ? "All cameras (" : "Your cameras (") + cameras.size() + "):").formatted(Formatting.GOLD), false);
			for (CameraRecord camera : cameras) {
				source.sendFeedback(() -> Text.literal(" - " + camera.name() + " @ "
						+ camera.dimension() + " " + camera.x() + " " + camera.y() + " " + camera.z()).formatted(Formatting.GRAY), false);
			}
		}
		return cameras.size();
	}

	private static int give(ServerCommandSource source, ServerPlayerEntity target) {
		target.giveOrDropStack(CameraItemFactory.create());
		source.sendFeedback(() -> Text.literal("Gave a CCTV Camera to " + target.getName().getString()).formatted(Formatting.GREEN), true);
		return 1;
	}

	private static int removeNearest(ServerCommandSource source) throws CommandSyntaxException {
		ServerPlayerEntity player = source.getPlayerOrThrow();
		return McCctv.get().cameras().nearestOwned(player, 6).map(camera -> {
			McCctv.get().cameras().remove(camera.id()).ifPresent(gone -> McCctv.get().sessions().dropCamera(gone));
			source.sendFeedback(() -> Text.literal("Removed " + camera.name()).formatted(Formatting.GREEN), false);
			return 1;
		}).orElseGet(() -> {
			source.sendError(Text.literal("Stand within 6 blocks of a camera you own."));
			return 0;
		});
	}

	private static int rename(ServerCommandSource source, String name) throws CommandSyntaxException {
		ServerPlayerEntity player = source.getPlayerOrThrow();
		return McCctv.get().cameras().nearestOwned(player, 6).map(camera -> {
			McCctv.get().cameras().rename(camera, name);
			source.sendFeedback(() -> Text.literal("Renamed camera to " + name).formatted(Formatting.GREEN), false);
			return 1;
		}).orElseGet(() -> {
			source.sendError(Text.literal("Stand within 6 blocks of a camera you own."));
			return 0;
		});
	}

	private static int resetToken(ServerCommandSource source) throws CommandSyntaxException {
		ServerPlayerEntity player = source.getPlayerOrThrow();
		PlayerAuth auth = McCctv.get().cameras().resetToken(player);
		String url = McCctv.get().config().publicBaseUrl + "/?token=" + auth.token();
		source.sendFeedback(() -> Text.literal("New dashboard link: ").formatted(Formatting.GRAY)
				.append(Text.literal(url).formatted(Formatting.AQUA)), false);
		return 1;
	}
}
