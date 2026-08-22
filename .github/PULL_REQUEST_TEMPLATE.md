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
