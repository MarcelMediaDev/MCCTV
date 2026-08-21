# Contributing to MCCTV

Thanks for wanting to help. This is a Fabric **1.21.11 dedicated-server** mod: a live first-person CCTV feed in the browser from server world state. Joining players do not need the mod.

You do not need to be invited. Fork the repo, open a pull request, and the maintainer will review it. PRs may be requested to change, delayed, or closed. Merging is not guaranteed.

By submitting a pull request you license your contribution under the [MIT License](LICENSE), the same as the rest of the project.

## Rules

1. **One concern per PR.** A visual fix, a performance fix, or one feature — not a bundle. Large work (TNT, mobs, boats, item frames, signs, and similar) should have an issue first.
2. **Match what is already there.** Incremental terrain patches, existing camera/entity/held-item behavior, and server-tick cost are not optional. Do not full-rebuild the world mesh for a small block edit. Do not do unbounded work on the server thread.
3. **Do not weaken security** without an issue and discussion. Camera tokens, bind address, and “this is an HTTP server” warnings stay unless the change is the point of the PR.
4. **Do not commit** `run/`, worlds, logs, crash reports, tokens, `.env` files, or vanilla Minecraft assets. Loom copies vanilla textures at build time; they do not belong in git.
5. **Test the CCTV feed**, not only that Gradle succeeded. If the change is visible on camera, say what you saw.

## Build

You need **Java 21**.

Windows:

```
gradlew.bat build
```

Linux / macOS:

```
./gradlew build
```

The playable jar is `build/libs/mcctv-*.jar`. Do not ship or upload the `-sources` jar.

`./gradlew runServer` starts a local dedicated server (game **25565**, web **8088**). Only one `runServer` at a time on this `run/` world. After web/`app.js` changes, hard-refresh the browser (Ctrl+F5).

Pull requests run the same `./gradlew build` on GitHub Actions and attach the jar as a **workflow artifact**. That is for review. It is not an official release.

## Pull request template

Copy this into the PR body (GitHub also inserts it automatically):

```markdown
## Summary

<!-- What changed and why. Link an issue if there is one. -->

## How you tested

<!-- In-game and CCTV feed. Example: runServer, broke/placed blocks, hard-refreshed http://localhost:8088 -->

## Checklist

- [ ] `gradlew build` succeeds locally
- [ ] Playable jar is `build/libs/mcctv-*.jar` (not `-sources`)
- [ ] No `run/`, worlds, logs, tokens, or vanilla assets in the diff
- [ ] One concern; no full terrain rebuild for a small block edit
- [ ] CCTV feed checked if the change is visible on camera
```
