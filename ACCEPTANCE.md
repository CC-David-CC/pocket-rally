# Acceptance — Pocket Rally

**All runtime cases are NOT RUN.** This file is a plan; document checks are not gameplay evidence.

Apply all C01–C24 in [common acceptance](../../docs/ACCEPTANCE-COMMON.md). No immersive support is claimed or required for this flat-screen app.

## Game-specific cases

| ID | Experiment / invariant | Status |
|---|---|---|
| pocket-rally-G01 | Skipping or reversing a checkpoint cannot register a lap. | not_run |
| pocket-rally-G02 | Ghost cannot affect collisions. | not_run |
| pocket-rally-G03 | Brake/accelerator multi-touch works. | not_run |
| pocket-rally-G04 | Reset applies penalty once. | not_run |
| pocket-rally-G05 | Recorded ghost uses simulation timestamps. | not_run |
| pocket-rally-G06 | Phone rotation does not stretch handling coordinates. | not_run |

## Release evidence

Record rules/content and dependency versions, actual asset names/hashes, desktop browser, real phone and (where required) Galaxy XR build, commands/logs, complete-playthrough result, save restoration result, multiwindow/late-disposal behavior, frame timing and unresolved defects. Exercise actual Rive properties and texture input rather than substituting an HTML mock.

A pure rules unit test, a visual smoke test and a hardware XR test are different evidence. Preserve that distinction. All promised features must be demonstrated or explicitly left incomplete; do not relabel a generic engine scene as the finished game.
