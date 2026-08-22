# Contributing to MCCTV

This is a Fabric **1.21.11** dedicated-server mod: live first-person CCTV in a browser, rebuilt from server world state. Players on the server do not need the mod.

Start on the **Issues** tab. That is the queue. Testers file what they see. Pull requests exist to close those issues. Merging is not guaranteed. PRs may be asked to change, sit, or be closed.

By submitting a pull request you license your contribution under the [MIT License](LICENSE).

## Issues first

Open an issue when something is wrong on the feed, in-game, or in the docs. GitHub offers two forms:

- [Bug](.github/ISSUE_TEMPLATE/bug.md) — something broken in-game or on the CCTV feed
- [Request](.github/ISSUE_TEMPLATE/feature.md) — a missing feature or a change that needs talking through first (including anything that would move the mod's structure)

Use the matching form. Say what you did, what you saw, and whether the CCTV page matched the world. Screenshots or a short clip of the feed help.

If you want to write code, pick an open issue (or file one) and say you are taking it. One issue per PR.

Do not use a PR as the first place to dump a new idea. File the issue, talk there, then open the PR.

## What a PR is for

A PR should squash a specific issue: a missing model, a lighting bug, a hitch, a bad caption. Keep the change on that problem.

The package layout, meshing pipeline, patch/relight path, HTTP/WebSocket server, and how the browser draws the world stay as they are unless we agree otherwise. You can still open a PR that wants to move that furniture. It will be discussed in the comments and will not land until that conversation is done. Do not rewrite the mod "while you are here."

Same bar as before on the code that does land:

- Incremental terrain patches. Do not full-rebuild the world mesh for a small block edit.
- Do not do unbounded work on the server thread.
- Do not weaken camera tokens or bind defaults unless the issue is about that.
- Do not commit `run/`, worlds, logs, crash reports, tokens, `.env` files, or vanilla Minecraft assets. Loom copies vanilla textures at build time.
- Test the CCTV feed, not only that Gradle succeeded.

## Build

Java **21**.

```
gradlew.bat build          # Windows
./gradlew build            # Linux / macOS
```

Playable jar: `build/libs/mcctv-*.jar`. Not the `-sources` jar.

`./gradlew runServer` is game **25565**, web **8088**. One instance at a time on this `run/` world. After `app.js` changes, hard-refresh the browser (Ctrl+F5).

GitHub Actions runs the same build on every PR and attaches the jar as a **workflow artifact**. Review only. Not an official release.

## Pull request template

GitHub inserts this when you open a PR. The issue link is required.

```markdown
## Issue

<!-- Closes #123 -->

## Summary

<!-- What you changed to squash that issue. -->

## How you tested

<!-- In-game and CCTV feed. Example: runServer, reproduced the issue, hard-refreshed http://localhost:8088 -->

## Checklist

- [ ] Fixes a filed issue (link above)
- [ ] Does not restructure the mod unless that issue asked for it and it was discussed
- [ ] `gradlew build` succeeds locally
- [ ] Playable jar is `build/libs/mcctv-*.jar` (not `-sources`)
- [ ] No `run/`, worlds, logs, tokens, or vanilla assets in the diff
- [ ] One concern; no full terrain rebuild for a small block edit
- [ ] CCTV feed checked if the change is visible on camera
```
