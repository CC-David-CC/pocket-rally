# Pocket Rally — desktop integration

Pocket Rally is a three-track, three-lap time-trial game built on the standalone
rally rules model. It uses Phaser 4.2.1 for the responsive track view and keeps
vehicle, checkpoint, lap, penalty, ghost and medal state in the deterministic
model.

The app exports synchronous `mount(host)` and owns its Phaser instance,
listeners, audio context, resize observer and file subscription. It pauses on
focus loss and disposes idempotently. Desktop supports arrows/WASD plus Space
for gas and Shift for brake; phone-sized controls provide independent hold
buttons.

Save and Open use My files through `host.storage.mirrorFileContext()`. The
versioned checkpoint contains persistent best-lap ghosts and medals, while an
active race is clearly restored at the start line and paused for explicit
resume. Files-route launches load directly without opening a second picker.
Save captures a paused snapshot and destination; changes made while storage is
pending remain unsaved, and closing during a save is guarded. Open rejects a
stale result if the race changes while its confirmation or file read is
pending. The desktop-window focus observer pauses on focus loss, workspace
switching, minimizing, or rolling up; browser blur and visibility changes also
pause the race.

## Tests

```sh
npm ci --prefix apps/games/01-phaser-arcade/pocket-rally --ignore-scripts
npm run typecheck --prefix apps/games/01-phaser-arcade/pocket-rally
npm test --prefix apps/games/01-phaser-arcade/pocket-rally
node tests/pocket-rally-browser.test.mjs
CODI_PHONE=1 node tests/pocket-rally-browser.test.mjs
node tests/pocket-rally-account.test.mjs
node tests/pocket-rally-input-review.test.mjs
```

The browser fixture was checked at desktop and 412x915 emulated-phone sizes.
It covers driving input, focus pause/resume, save, malformed-file recovery,
independent windows, and idempotent disposal. The account test covers server
sync, Files-route reopening, phone reload, paused restore, and account
isolation once the parent desktop registers the app. The input review test uses
an isolated account-backed preview and checks that a held accelerator is released
when the track loses focus and that emulated phone touch drives the car. It does
not replace testing simultaneous touches on a physical phone.

## Remaining gates

No authored `rally-dash.riv` is supplied. The speed, lap and medal panel is a
clearly labeled procedural fallback and does not close the Rive acceptance
gate. Physical-phone driving, full medal runs and performance/thermal evidence
remain unrun.

## Design requirements

The original [design brief, controls, save rules, artwork and acceptance plans](design/README.md) are retained as reference. They describe targets; the implementation and qualification status above takes precedence.
