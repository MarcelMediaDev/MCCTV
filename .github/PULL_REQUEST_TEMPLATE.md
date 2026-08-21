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
