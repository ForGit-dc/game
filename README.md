# NEON//ECHO

A 3D neon roguelite horde-survival game that runs in the browser, by Anass El Basraoui ([elbasraoui.engineer](https://elbasraoui.engineer)). The enemies are what breaks a machine-learning model in production: bugs, outliers, data leaks, overfitting, and finally the Black Box. Everything is procedural: every mesh, texture and sound is generated at runtime, with no asset files and no music.

K-7, a courier android, is trapped on **the Ring**, a floating arena above the drowned city of Vashta. Survive 10 minutes of escalating drone hordes and build a loadout from weapons, passives and evolutions. Three bosses stand in your way: **Hive Mother** (3:00), **Lancer** (6:30) and **The Warden** (10:00). After that, keep going in Endless mode. When you die, the shards you earned buy permanent upgrades in the **Neural Lattice**.

## Run it

```bash
npm install
npm run dev
```

The browser opens on `http://localhost:5173`. Click **WAKE UP**, then **PLAY**. It needs a recent Chrome, Edge or Firefox with WebGL2 and hardware acceleration.

To build a static version, run `npm run build`, which outputs to `dist/`. Serve it with `npm run preview`.

## Controls

| Input | Action |
|---|---|
| WASD / ZQSD (AZERTY is detected) | Move |
| Mouse | Aim |
| Left mouse (hold) | Pulse Blaster · **T** toggles auto-fire |
| Space / Shift | Dash (invulnerable). Getting hit mid-dash triggers a *Perfect Dodge* with slow motion |
| Right mouse / F | Blade: cleaves, breaks Bulwark shields and **deflects orange orbs** back |
| Q (A on AZERTY) | Overclock when SYNC is full: time slows and damage is ×1.5 |
| Mouse wheel | Zoom |
| Esc / P | Pause (volume, ambience, auto-fire, current build) |

## How a run works

- **Kills drop data shards.** Collect them to level up, then pick 1 of 3 cards (a new weapon, an upgrade or a passive). You have 4 weapon slots and 4 passive slots.
- **Evolutions.** Max a weapon to level 5 while owning its paired passive, and a golden EVOLVE card appears. The pairs are:
  - Pulse Blaster + Coils → Railstorm
  - Arc Chain + Capacitor → Thundercrown
  - Orbit Blades + Kinetic Frame → Halo of Knives
  - Nova Pulse + Nano Mesh → Supernova
  - Seeker Swarm + Targeting → Hydra
  - Laser Drone + Cycler → Twin Satellites
- **Three stages.** Each one is played on its own themed Ring, with its own drone mix, events and boss:
  - Stage 1, **The Ring**: The Hallucination
  - Stage 2, **The Data Lake**: Overfit
  - Stage 3, **The Core**: The Black Box

  Killing a stage boss clears the stage (+30 % integrity, +30 shards) and warps you to the next one with your build intact. Clearing stage 3 wins the run and unlocks Endless.
- **Scripted events:**
  - 2:00 and 7:10: meteor storms (the circles hurt drones too)
  - 5:00: the outer ring collapses
  - 8:00: blackout
  - Horde surges roughly every 50 s, elites with supply chests, and magnet cores
- **Drones:**
  - Wisp: swarms
  - Shard: telegraphed charge, so dash through it
  - Sentinel: slow orbs you can deflect
  - Bulwark: frontal shield
  - Splitter: splits into small drones
  - Bomber: its explosions chain-react
- **Meta-progression:** shards buy permanent upgrades, unlock Seeker Swarm and Laser Drone, and unlock the Overdrive mode. Progress is saved in `localStorage`.

## Architecture

```
src/
  main.js              boot screen, font preload, WebGL2 check, URL flags
  game/Game.js         state machine, main loop, time scales, every gameplay callback
  game/TopCamera.js    3/4 follow camera, cursor look-ahead, zoom, shake, mouse→ground ray
  game/Input.js        physical key codes, keyboard-layout-aware labels
  player/              courier model (procedural rig + verlet scarf) and twin-stick controller
  enemies/Horde.js     instanced drones + spatial hash grid, per-type AI
  enemies/Bosses.js    Hive Mother, Lancer, The Warden (+ Core Lance)
  combat/              projectiles (bolts, orbs, missiles, rays, lightning) and weapons
  systems/             Progression (cards, evolutions, stats), Loot, Waves (director), Meta (lattice)
  world/               Arena (the Ring), Level (city kit), sky, skyline, whale, City Core eye, weather
  fx/                  particles, effects, post-processing (sanitize → bloom → grade)
  audio/Audio.js       Web Audio: pre-rendered rain & thunder, all SFX synthesized
  ui/UI.js             HUD, cards, lattice, pause, end screens
```

A few implementation notes:
- **Drones and loot are instanced.** A single draw call per type keeps hundreds of drones cheap.
- **Collisions use a spatial hash grid** rebuilt every frame.
- **The static scenery is merged per material.**
- **Dynamic resolution** lowers the pixel ratio if the frame rate drops.
- **A sanitize pass runs before bloom**, so a single invalid pixel can never black out the screen.

Debug URL flags: `?debug` exposes `window.__game` and its deterministic `debugStep(frames)`, `?lowq` switches to low quality, and `?pr=0.8&msaa=0` forces the pixel ratio and anti-aliasing.
