# Pocket Rally

**Top-down single-player racing · Phaser · single-player · phone required · flat-screen app**

> Planned design, not implemented or browser-tested. `index.pseudo.mjs` is an explanatory entry point, not a playable game.

## Experience

Three tiny circuits built for time trials, visible racing lines and a local best-lap ghost.

## What this demonstrates

- Camera follow and layered track rendering
- Simple arcade vehicle kinematics
- Local ghost replay and HUD animation

## Rules and complete loop

- Steer, accelerate and brake a top-down car. Race three laps; gates must be crossed in order and direction.
- Offroad slows the car; reset-to-track adds a penalty. No damage economy or multiplayer.
- Ghost is a recorded pose trace of a completed valid lap, not a simulated opponent.

## Bounded polished release

Three original tracks, time trial and medal targets, one car with two handling presets.

- Legible checkpoints and wrong-way indicator
- No camera shake by default
- Ghost opacity adjustable and never collidable

No multiplayer, accounts, server simulation or generic editor is required. Start, rules/help, play/activity, pause, outcome/goal feedback and retry must all be complete. Settings include volume/mute, reduced motion, contrast and game-specific options where meaningful. State changes occur in the game model; animations illustrate them.

## Rive inside this app

Speed gauge, lap banner and medal celebration inside the game UI. The requested asset is `rally-dash.riv`; it is **not included**. See [RIVE.md](RIVE.md) for the authoring/integration contract. A placeholder or unrelated animated logo does not satisfy this requirement.

## Save behavior

Persistent progress and ghost data; active races resume at race start, clearly labeled. See [SAVE.md](SAVE.md). Loading starts paused; resume is explicit. Restart and load cancel stale callbacks and any owned AI work.

## Build sequence

Implement the rule loop in [gameplay.pseudo.txt](gameplay.pseudo.txt); bind the exact app lifecycle from [index.pseudo.mjs](index.pseudo.mjs); complete [CONTROLS.md](CONTROLS.md); author/integrate [RIVE.md](RIVE.md); then satisfy [ACCEPTANCE.md](ACCEPTANCE.md). Do not add XR or a 3D engine solely to widen the technology list.

Target wave: **3**. Integrator first reads [AGENTS.md](../../AGENTS.md); do not guess host APIs from symbolic helper names.

Use original/licensed artwork and audio. Keep the scope small enough to polish; expand content only after the release gates pass.
