# CLAUDE.md — NEON//ECHO

This file lets a new Claude Code session continue this project without losing anything.
Read it fully before touching code.

## The user & how to work with them

- The user writes casual **French** (sometimes with typos). **Always answer in French.**
- They gave total creative freedom ("t'es le chef", "surprends-moi") and want something **jaw-dropping** ("un truc extraordinaire") that **isn't boring after 5 minutes** (long-term replayability).
- **NO MUSIC. Ever.** Music is haram for the user. No melodic score, no chord/arpeggio jingles, no melodic stingers, no ambience made of random notes.
  Allowed: rain, thunder, wind, city hum, non-melodic SFX (single-tone blips, sweeps, noise hits). Background ambience = **rain + thunder** (already implemented).
- **Commit AND push by yourself, regularly** ("push au fur et à mesure", "commit et push toi même"). Push after every meaningful milestone.
  Work happens on branch **`neon-echo`** (repo `ForGit-dc/game`, default branch `main`). Tell the user they can merge / offer a PR at the end.
- The user plays on a high-DPI laptop (screenshot was 2576px wide, AZERTY keyboard). They once saw a **black screen** (fixed: see "Rendering pitfalls").
- Hard constraint: must run with `npm install && npm run dev`. No backend, no API keys, no downloaded assets. Everything procedural.
- Commit message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Current status (read this!)

The project went through two designs:

1. **v1 — third-person exploration game (DONE, playable, currently what `npm run dev` runs).**
   Explore a floating city, collect 5/7 Echo fragments, augments, drones, city collapse, uplink at Skyport, victory.
   Files: `src/game/Game.js`, `src/game/CameraRig.js`, `src/player/Player.js`, `src/enemies/Enemies.js`,
   `src/systems/{Echoes,Director,Upgrades,Pickups}.js`, `src/combat/LegacyProjectiles.js`, `src/world/Level.js` (`build()` = the city).
   The user judged it "fun for 5 min then boring" → asked for a **radical change**.

2. **v2 — REWRITE IN PROGRESS: 3D neon roguelite horde-survival ("Vampire Survivors meets Hades", twin-stick, skill-based).**
   Already written for v2 (new, NOT yet wired into Game, untested):
   - `src/world/Arena.js` — `class Arena extends Level` (reuses the city kit). Circular floating arena, 3 rings (radii 16/27/38), segments that warn (orange blink) then fall, shrinking force-field barrier, circuit-glow floor shader, 9 pillars (circle obstacles), towers/signs/holos/cables around (tall to the north, low to the south so they never block the camera). API: `updateArena(dt, t, playerPos, events)`, `collapseRing(stage, warnTime)`, `constrain(pos, radius)`, `hitsObstacle(ax,az,bx,bz,r)` → t or -1, `pulse(radius)`, `reset()`, fields `boundary`, `obstacles`, `solidStage`, `stage`.
   - `src/enemies/Horde.js` — instanced enemies + spatial hash grid. Types: wisp, shard (telegraphed charge), sentinel (ranged orbs), bulwark (front shield −85%), splitter (→3 mini wisps), bomber (arms & explodes, chain reactions). Elites (×5 hp, gold). Floor glow decals, charge telegraphs. API: `spawn(type,x,z,{elite,mini,rise,hpMul})`, `update(dt)`, `render(t)`, `forEachNear(x,z,r,fn)`, `nearest`, `randomNear`, `damage(e,dmg,dirX,dirZ,knock,opts)`, `kill`, `clear`. Expects `game.player.hurt(dmg, fromX, fromZ)`, `game.waves.hpMul`, `game.onEnemyKilled(e,cause)`, `game.onBomberExplode(x,z,R)`, `game.projectiles.enemyOrb(...)`, `game.arena`, optional `game.audio.shardAim/scoutLunge/sentinelFire/bomberArm`.
   - `src/enemies/Bosses.js` — `HiveMother` (3:00: wisp swarms, rotating laser beams, orb rings), `Lancer` (6:30: telegraphed dashes leaving electric trails, fans, summons shards), `Warden` (10:00 final, 3 phases: fans / gap-nova rings / summons → phase 2 "Core Lance" sky beam on the player's position → phase 3 spiral bullet-hell). Base `Boss`: `damage(dmg)`, `update(dt)`, `invulnerable` during 3.2s rise-from-abyss intro, `dispose()`. Expects `game.onBossDying/onBossKilled/onBossSpark/onWardenPhase(2|2.5|3)/onCoreLanceAim/onCoreLanceStrike`, `game.horde`, `game.projectiles`, `game.arena`, `game.player.hurt`, `game.waves.hpMul`, `game.rig?.addTrauma`.
   - `src/combat/Projectiles.js` — v2 API: `bolt(x,z,dx,dz,{dmg,speed,pierce,crit,color,size,life,shield})`, `enemyOrb(x,z,vx,vz,{dmg,owner,size,homing,life})`, `missile(x,z,dx,dz,target,{dmg,splash,split,speed})`, `ray(...)` (visual hitscan), `zap(points,color)` (visual lightning), `deflect(ox,oz,fx,fz,range,arcCos)`, `update(dt, worldScale, playerScale)`, `render(t)`. Expects `game.hitEnemy(e,dmg,dx,dz,knock,opts)`, `game.hitBoss(boss,dmg,crit,x,z)`, `game.areaDamage(x,z,r,dmg,opts)`, `game.nearestBoss(x,z)`, `game.bosses` (array), `player.hurt()` returning `true` (hit) / `'dodge'` / `false` / `'shielded'`.
   - `src/world/Skyline.js` changes: whale orbit configurable via `whale.orbit = {R, y, speed, cz}` (plan: `{R:78, y:-22, speed:0.03, cz:0}` so it swims *below* the arena), traffic lanes lowered, `core.setPosition(x,y,z)` (plan: Eye rising from the abyss north of the arena, rises over the run; Core Lance comes from it).

   **Still TO WRITE for v2** (in this order), then delete v1-only files:
   1. `src/combat/Weapons.js` (see design below)
   2. `src/systems/Progression.js` (XP, level-ups, cards, evolutions, stat recompute)
   3. `src/systems/Loot.js` (instanced XP shards + heart / magnet / chest)
   4. `src/systems/Waves.js` (spawn director + event timeline, exposes `hpMul`, `t`, `nextEvent`)
   5. `src/systems/Meta.js` (persistent shards + "Neural Lattice" upgrades in localStorage key `neon-echo-meta-v1`, wrap in try/catch)
   6. `src/player/Player.js` rewrite (twin-stick, reuse `PlayerModel.js` + `Scarf`)
   7. `src/game/TopCamera.js` (3/4 view camera + mouse-to-ground ray)
   8. `src/game/Game.js` rewrite (flow, loop, all `on*`/`hit*` callbacks above)
   9. `index.html` + `src/styles.css` + `src/ui/UI.js`: new HUD, level-up cards (reuse `.aug-card` styles), Lattice screen, pause (show build), end screens with shards earned
   10. `src/audio/Audio.js`: add non-melodic SFX used by v2 (`levelUp`, `xpTick`, `bossWarn`, `bossCharge`, `laser`, `missileHit`, `bomberArm`, `shardAim`, `arcZap`, `nova`, `chest`, `meteor`), keep the storm
   11. Delete v1-only files: `src/enemies/Enemies.js`, `src/systems/{Echoes,Director,Upgrades,Pickups}.js`, `src/game/CameraRig.js`, `src/combat/LegacyProjectiles.js`; strip the city layout out of `Level.build()` (keep the kit methods — Arena uses them).
   12. Headless test the whole loop, screenshots, tune balance, update README.md, push.

## v2 game design (the plan to implement)

**Pitch:** K-7, a courier android, is trapped on *The Ring*, a floating arena above the drowned neon city of Vashta. Survive 10 minutes of escalating drone hordes, build a synergy loadout, kill three bosses, then keep going in Endless. Death is progress: shards buy permanent upgrades.

**Controls (no pointer lock; custom DOM reticle, hide system cursor over canvas):**
WASD/ZQSD move (use `event.code`, labels via `input.label(code)` → AZERTY-aware) · mouse aim on the ground plane · LMB hold = Pulse Blaster (option: auto-fire) · SPACE or SHIFT = dash (i-frames; being hit during a dash = *Perfect Dodge*: 0.45s slow-mo + sync) · RMB = Blade (arc in aim dir, high dmg, knockback, ignores shields, deflects orange orbs) · Q (KeyQ, "A" on AZERTY) = Overclock (when SYNC 100: 6s, world ×0.35 speed, courier dmg ×1.5) · Esc/P pause · mouse wheel zoom.

**Camera:** perspective FOV 50, pitch ~40°, distance ~25 (wheel 18–34), yaw fixed looking north (-Z), small look-ahead toward the cursor, smooth follow, trauma shake. Scenery tall only in the north so it frames the top of the screen.

**Arena events timeline (10:00 run):**
2:00 meteor rain (25s, telegraphed circles, hurts enemies too) · 3:00 HIVE MOTHER · 5:00 outer ring collapses (38→27) · 6:30 LANCER · 7:00 meteor rain · 8:00 blackout (25s, fog up, lights flicker) · 10:00 THE WARDEN (at <45% HP middle ring collapses 27→16). Kill Warden → victory screen with "CONTINUE (ENDLESS)" (bosses cycle every ~2.5min with growing HP).
Also: horde surge every ~55s (ring of wisps closing on the player), an elite every ~40s after 1:30, a magnet pickup every ~100s.

**Spawns:** rate ≈ 0.9 + 0.55·minute per second, max alive ≈ 40 + 16·minute, during bosses ×0.35. Spawn outside the barrier (radius boundary+4..9), they rise from the abyss (`rise: true`). `hpMul = 1 + 0.16·minute` (endless ×1.15^(minutes past 10)). Composition unlocks: shard ≥1:00, sentinel ≥2:00, splitter ≥3:30, bomber ≥5:00, bulwark ≥5:30.

**Weapons** (4 weapon slots incl. primary, max level 5, evolution = weapon L5 + paired passive owned → golden EVOLVE card):
| Weapon | Behaviour | Evolution (+passive) |
|---|---|---|
| Pulse Blaster (primary, manual aim) | bolts; L3 +1 bolt, L4 pierce, L5 +1 bolt | RAILSTORM (+Coils): piercing hitscan rails, shield-piercing |
| Arc Chain | periodic lightning jumping between enemies | THUNDERCROWN (+Capacitor): constant storm around you, with thunder SFX |
| Orbit Blades | neon shards orbiting you | HALO OF KNIVES (+Kinetic Frame): 2 counter-rotating rings |
| Nova Pulse | periodic shockwave + knockback | SUPERNOVA (+Nano Mesh): bigger, heals per hit |
| Seeker Swarm (meta unlock) | homing micro-missiles, splash | HYDRA (+Targeting): missiles split on impact |
| Laser Drone (meta unlock) | orbiting drone zapping nearest | TWIN SATELLITES (+Cycler): 2 drones, beams pierce |

**Passives** (4 slots, max 5): Coils (+12% dmg) · Cycler (−8% cooldowns/+8% fire rate) · Kinetic Frame (+8% speed) · Magnet Field (+35% pickup radius) · Nano Mesh (+20 max HP, +0.5 HP/s) · Capacitor (+12% area/duration) · Targeting Matrix (+7% crit) · Phase Drive (+1 dash charge at L1/3/5, −10% dash cd) · Echo Link (+12% XP, +1s overclock).

**Level-ups:** XP shards (value 1/3/8/20 → cyan/green/violet/gold), magnetized. XP to next ≈ 6 + 5·(L−1) + L^1.6. Level-up freezes the game and offers 3 cards (4 with meta "Wider Sight"); rerolls from meta. Fallback cards: heal +40 / +500 score.

**Scoring & juice:** combo counter (resets after 2.5s without a kill) → score multiplier; kill pops; elites/bosses big explosions; damage numbers (pool, only show crits/big hits when crowded); hitstop only for big events.

**Meta "Neural Lattice"** (shards earned ≈ time/10 + kills/25 + 50/boss + 10/elite + 2·level, +200 on victory): Reinforced Frame (+10 HP ×5), Amplifier (+6% dmg ×5), Servos (+4% speed ×3), Data Siphon (+8% XP ×5), Field Emitter (+20% magnet ×3), Self-Repair (+0.3 HP/s ×3), Probability Engine (+1 reroll ×3), Second Signal (revive once), Wider Sight (4 choices), Unlock Seeker Swarm, Unlock Laser Drone, Vector Core (+1 dash), Overdrive Protocol (hard mode, +60% shards).

**Menus:** Boot ("WAKE UP" click = audio unlock) → Main menu (PLAY / LATTICE / CONTROLS / CREDITS, shard balance, best time) → run → level-up cards / pause (build + settings) → SIGNAL LOST or SIGNAL SURVIVED screen (stats, shards earned, RETRY / LATTICE / MENU, CONTINUE on victory).

## Architecture (shared by both designs)

- Vite + Three.js r186 (`three/addons/...`), plain JS modules, no framework. Fonts from `@fontsource` (offline).
- `src/main.js` boot screen, font preload (canvas text textures need them), WebGL2 check, `?debug` exposes `window.__game`, `?lowq` low quality, `?autostart`.
- Rendering: `fx/PostFX.js` = RenderPass → **SanitizeShader (kills NaN/Inf)** → UnrealBloom → FinalShader (chromatic aberration, glitch, damage vignette, overclock grade, radial blur, fade/white) → OutputPass (ACES). MSAA 4× only when DPR ≤ 1.1. DPR capped 1.25, dynamic resolution in `Game.perf()`.
- `world/Materials.js` shared uniforms (`shared.time`, `shared.fogDensity`, `shared.alarm`), glow materials (`mats.glow(color, intensity)` → HDR MeshBasic for bloom), holo/cable/beam/pad/pool shaders, `worldBox`/`facadeBox` world-UV boxes.
- `world/Level.js` is a **kit**: `platform`, `building`, `sign`, `holoAd`, `cable`, `light`, `lamp`, `crate`, `blinker`, etc. Static geometry is merged per material via `Batcher` (few draw calls). `Level.update()` animates spinners/bobbers/flickers/blinkers/lights.
- `world/Sky.js` (dome with nebula, ringed moon, lightning flashes → `sky.onLightning` → thunder), `world/Skyline.js` (instanced distant towers with in-shader windows, traffic, searchlights, holographic whale, City Core eye that tracks a target), `world/Weather.js` (rain, dust, debris).
- `fx/Particles.js` single additive point pool (`burst`, `spawn`), `fx/Effects.js` (rings, flash lights pool, blade arcs, dash afterimages, muzzle flash).
- `player/PlayerModel.js` procedural courier (`buildCourier({holo})`, `update(dt, {speed, grounded, vy, dash, aiming, aimPitch, turn})`, `slash()`, `copyPose()`) + verlet `Scarf`.
- `audio/Audio.js` everything synthesized; **storm ambience only** (`_startStorm`, `thunder(delay, power)`, `setIntensity(-1..3)` = storm strength), spatial one-shots via `_out(pos, vol, range, reverb)`, `_tone`, `_noise`.
- `game/Input.js` physical key codes, `loadLayout()` + `label(code)` for AZERTY labels, pointer-lock helpers (v2 won't use lock).

## Rendering pitfalls (learned the hard way)

- A single NaN pixel gets smeared over the whole screen by bloom → **black screen** on real GPUs (not reproducible in SwiftShader). Keep the sanitize pass; in shaders never `normalize()` a possibly-zero vector, never `atan(y, x)` with both 0 (add `1e-5`), guard `pow()` bases with `max(0.0, …)`.
- Adding/removing lights at runtime recompiles shaders → use fixed light pools.
- Canvas-text textures need fonts loaded first (`document.fonts.load`).
- `THREE.Clock` is deprecated in r183+ (use `performance.now()`).

## Testing (headless)

- A Playwright + Chromium install lives **outside the repo** in the session scratchpad (`.../scratchpad/pw`, scripts `smoke.mjs`, `loop.mjs`, `dbg.mjs`). If missing: `npm init -y && npm i playwright && npx playwright install --with-deps chromium` in a scratch dir.
- Launch flags: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. Use `?debug&lowq`, viewport ~640×360–800×450.
- Drive the game with `window.__game.debugStep(frames, dt)` (deterministic, no rAF) **in chunks of ≤10 frames per `page.evaluate`** — big chunks crash the renderer (first frames compile shaders for ~15s in SwiftShader). Simulate input by writing `game.input.down/pressed` and `game.input.mouse.*`.
- Always check console errors/pageerrors, take screenshots and look at them. Run `npx vite build` before pushing.
- Dev server: `npx vite --port 5173 --strictPort` (background).

## Commands

```bash
npm install
npm run dev      # vite --open
npm run build
npm run preview
```
