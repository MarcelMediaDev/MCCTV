# MCCTV

Fabric 1.21.11 server mod: place a player-head CCTV camera and watch a live first-person feed of that area in a browser. Joining players do not need the mod.

## Requirements

- Java 21
- Minecraft 1.21.11
- Fabric Loader 0.19.3
- Fabric API 0.141.6+1.21.11

## Use

1. Put the mod jar and Fabric API in the server `mods` folder (or run `gradlew.bat runClient` for singleplayer).
2. Craft a CCTV Camera (iron + glass pane + redstone) or run `/cctv give`.
3. Place the head on a wall facing the area you want to watch.
4. Run `/cctv` and open the clickable link.
5. Walk in front of the camera. You should appear on the webpage.

`/cctv name <name>` renames the nearest camera you own. `/cctv token reset` invalidates the old link. Operators can see every camera.

## Config

Written to `config/mcctv.json` on first boot:

- `httpPort` (default 8088)
- `bindAddress` (default `0.0.0.0`)
- `publicBaseUrl` (default `http://localhost:8088`) — must be reachable from the browser
- `viewDistance`, `maxCamerasPerPlayer`, `entityHz`
- `forceLoadWhileViewing` — loads a small radius around a camera while someone is watching
- `sendResourcePack` — offers the camera skin to vanilla clients

This binds an HTTP port. Do not expose it to the public internet without a reverse proxy and TLS.

## Build

```
gradlew.bat build
```

The jar is in `build/libs`.
