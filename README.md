<div align="center">

# MCCTV

Live CCTV for a Minecraft server. Place cameras, open a browser, watch the room.

[![Minecraft](https://img.shields.io/badge/Minecraft-1.21.11-52a535)](https://fabricmc.net/)
[![Fabric Loader](https://img.shields.io/badge/Fabric%20Loader-0.19.3-dbb69b)](https://fabricmc.net/use/server/)
[![Fabric API](https://img.shields.io/badge/Fabric%20API-0.141.6-dbb69b)](https://modrinth.com/mod/fabric-api)
[![Java](https://img.shields.io/badge/Java-21-007396)](https://adoptium.net/)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/MarcelMediaDev/MCCTV/build.yml?branch=main&label=Build)](https://github.com/MarcelMediaDev/MCCTV/actions/workflows/build.yml)

</div>

MCCTV is a **Fabric 1.21.11** server mod. Each camera has a first-person view of the blocks in front of it. The feed is a webpage: channel list, REC, scanlines, camera name, coordinates. You can switch cameras the same way you would on a cheap DVR.

Nobody joining the server installs the mod. The reconstruction happens on the server and draws in WebGL. It is not a recording, not a map, and not a screenshot from someone's client.

---

## Screenshots


<table align="center" width="100%">
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/feed.png" width="95%" alt="Live feed" />
      <br />
      <b>Live Feed</b>
      <p>Live view from a camera. Not a video file, not a client screenshot.</p>
    </td>
    <td align="center" width="50%">
      <img src="docs/images/placed-camera.png" width="95%" alt="Placed camera" />
      <br />
      <b>Placed Camera</b>
      <p>A placed camera in the world. Vanilla clients do not need the mod.</p>
    </td>
  </tr>
</table>


---

## How it works

A dedicated server has no screen. There is nothing to capture and no GPU view of that room. Dynmap-style maps flatten the world from above. MCCTV does neither.

When a browser opens a camera, the server copies a box of blocks around it (`viewDistance`). It reads the same vanilla blockstates and models a client would, packs those textures into one atlas, and emits a triangle mesh. That mesh and the atlas PNG go down a WebSocket.

The page is a small WebGL app. It sits at the camera's eye yaw and pitch from how you placed it and draws the mesh. Lighting, grass tint, water, cutout leaves, and translucent glass are already in the vertices. Scanlines and REC are just CSS on top.

Players are a second channel. About `entityHz` times a second the server sends pose, skin, sneak, and what they are holding. The browser draws those on top of the terrain. Break or place a block and only that cell plus its neighbors get remeshed and punched into the buffer. The whole view is not rebuilt.

Meshing runs on a worker thread so a busy feed does not stall the server tick. Chunk tickets keep the area loaded while someone is watching, otherwise you would stare at a hole.

An optional resource pack is what other players see on the camera block. The HTTP server lives inside the mod (Netty). The token in `/?token=` is the lock on the door.

---

## Requirements


| Requirement   | Version         |
| ------------- | --------------- |
| Java          | 21              |
| Minecraft     | 1.21.11         |
| Fabric Loader | 0.19.3          |
| Fabric API    | 0.141.6+1.21.11 |


Jar + Fabric API go in the server `mods` folder. Singleplayer works via `runClient` if you want to poke at it locally.

## Setup

1. Drop the mod jar and Fabric API on the server. Boot once so `config/mcctv.json` appears.
2. Craft a CCTV Camera (iron, glass pane, redstone) or run `/cctv give`.
3. Place the camera on a wall, facing the room you care about.
4. Run `/cctv` and open the clickable link. Token is in the URL; treat it like a password.
5. Walk in front of the camera. You should show up on the page.

Hard-refresh the browser (Ctrl+F5) after you update the web UI.


| Command             | What it does                      |
| ------------------- | --------------------------------- |
| `/cctv`             | Link to your cameras              |
| `/cctv name <name>` | Rename the nearest camera you own |
| `/cctv token reset` | Kill the old link                 |
| `/cctv give`        | Give yourself a camera            |
| `/cctv remove`      | Remove the nearest camera you own |


Operators see every camera. Default bind is `0.0.0.0:8088`. Do not put that on the public internet without a reverse proxy and TLS. Set `publicBaseUrl` to whatever URL the browser actually uses.

## Config

`config/mcctv.json` after first boot:


| Key                     | Default                 | What it does                                         |
| ----------------------- | ----------------------- | ---------------------------------------------------- |
| `httpPort`              | `8088`                  | Web server port                                      |
| `bindAddress`           | `0.0.0.0`               | Listen address                                       |
| `publicBaseUrl`         | `http://localhost:8088` | URL printed by `/cctv`                               |
| `viewDistance`          | `48`                    | Blocks meshed around a camera                        |
| `maxCamerasPerPlayer`   | `8`                     | Cap per player                                       |
| `entityHz`              | `10`                    | How often players/mobs are sent                      |
| `forceLoadWhileViewing` | `true`                  | Keep a small radius loaded while someone is watching |
| `sendResourcePack`      | `true`                  | Camera skin for vanilla clients                      |
| `ticketRadius`          | `4`                     | Chunk ticket size while viewing                      |


## Build

Playable jar: `build/libs/mcctv-*.jar`. Skip the `-sources` jar.

```
gradlew.bat build          # Windows
./gradlew build            # Linux / macOS
```

`runServer` uses game port **25565** and web **8088**. One instance at a time on the same `run/` world.

GitHub Actions builds every pull request and attaches that jar as a workflow artifact. Review only — not a release.

## Contributing

Fork, patch, open a PR. Rules, test steps, and the PR checklist are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
