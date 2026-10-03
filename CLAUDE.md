# CLAUDE.md — NEON//ECHO

This file lets a new Claude Code session continue this project without losing anything.
Read it fully before touching code.

## The user & how to work with them

- The user is **Anass El Basraoui**, Data Scientist & ML Engineer (ENSAI + INSEA, works at Opsci, Rennes). The game is **personalised around him** (see "Personalisation").
- The user writes casual **French** (sometimes with typos). **Always answer in French.**
- They gave total creative freedom ("t'es le chef", "surprends-moi") and want something **jaw-dropping** ("un truc extraordinaire") that **isn't boring after 5 minutes** (long-term replayability).
- **NO MUSIC. Ever.** Music is haram for the user. No melodic score, no chord/arpeggio jingles, no melodic stingers, no ambience made of random notes.
  Allowed: rain, thunder, wind, city hum, non-melodic SFX (single-tone blips, sweeps, noise hits). Background ambience = **rain + thunder** (already implemented).
- **Commit AND push by yourself, regularly** ("push au fur et à mesure", "commit et push toi même"). Push after every meaningful milestone.
  The user asked to **push to `main`** ("push dans le main"): `neon-echo` was fast-forwarded into `main` and work now continues directly on `main` (repo `ForGit-dc/game`).
- The user plays on a high-DPI laptop (screenshot was 2576px wide, AZERTY keyboard). They once saw a **black screen** (fixed: see "Rendering pitfalls").
- Hard constraint: must run with `npm install && npm run dev`. No backend, no API keys, no downloaded assets. Everything procedural.
- Commit message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Current status (read this!)

**v2 — 3D neon roguelite horde-survival — is DONE and playable** (on `main`, pushed). v1 (exploration game) was removed.
Verified headless: full loop (drop-in → waves → level-up cards → Hive Mother → ring collapse → Warden phases/Core Lance → victory → endless → death → shards → Lattice buy), all 6 weapons + evolutions, chests/rerolls, meteors, blackout, revive, overdrive. ~5 ms/frame JS with 350 drones.

Files (all live): `game/{Game,TopCamera,Input}.js`, `player/{Player,PlayerModel}.js`, `enemies/{Horde,Bosses}.js`, `combat/{Projectiles,Weapons}.js`, `systems/{Progression,Loot,Waves,Meta}.js`, `world/{Arena,Level,Sky,Skyline,Weather,Materials,Textures}.js`, `fx/*`, `audio/Audio.js`, `ui/UI.js`.
`Level.build()` still contains the old v1 city layout (dead code; Arena overrides `build()` and only uses the kit methods) — safe to strip.

Audio: user said the first storm sounded "fake et agaçant" → rewritten as **pre-rendered buffers** (`_renderRain` droplet synthesis, `_renderThunder` rumble bank + near crack), thunder throttled (≥2.5 s apart) and lightning much rarer (14–36 s), ambience slider in pause (`localStorage neon-echo-amb`). If the user still dislikes it, lower/disable thunder first.

**Stages** (user asked "ajoute d'autres steps"): a run = 3 stages defined in `systems/Waves.js` `STAGES` (THE RING → THE DATA LAKE → THE CORE), each with its own drone unlocks, events and boss (event/unlock times are relative to `waves.stageT`; difficulty `hpMul`/spawn rate follow total time `waves.t`). Boss killed → `Game.startStageClear()` (clear field, +30% HP, +30 shards, 4.5 s) → `Game.enterStage(i)` (arena reset, `applyTheme`, drop-in). Themes in `Game.js` `THEMES` drive fog, hemi light, `Sky.setTheme`, `Arena.applyTheme`. Stage 3 boss → victory → Endless. Verified headless end to end.

**Progression v3** (user: more Lattice levels, no level-5 cap in match, more creative weapons):
- In-match cap is **level 8** (`MAX_LEVEL`), evolution still unlocks at **5** (`EVOLVE_AT`) and evolved weapons keep levelling; each level above 5 = +20% damage, −7% cooldown via the per-weapon stat view `Weapon.get S()`. Slots are **5 weapons + 5 passives**.
- **10 weapons**: the 6 originals + `boomerang` BACKPROP (discs out-and-back → GRADIENT DESCENT, +SERVERLESS), `attention` ATTENTION HEAD (focus beam that ramps on the strongest target → MULTI-HEAD ATTENTION, +BENCHMARK), `kmeans` K-MEANS SINGULARITY (black-hole centroids pull then collapse → HIERARCHICAL COLLAPSE, +DATA PIPELINE; Lattice unlock), `gan` GAN DECOY (holographic double that taunts drones via `game.taunts`, shoots, detonates → ADVERSARIAL PAIR, +new passive `reg` REGULARIZATION −6% damage taken; Lattice unlock).
- **Lattice: 21 nodes**, up to 10 ranks, escalating costs (`costs()` in `Meta.js`). New: FIREWALL (armor), PRECISION (crit), BLADE MASTERY, SYNC BOOSTER, SHARD MINER, HEAD START (free level-ups at run start), revive rank 2, dash rank 2, unlocks for K-Means and GAN. New stats live in `BASE_STATS` (`armorMul`, `bladeMul`, `bladeReach`, `syncMul`).

- **DATA INGESTION** passive `ingest` (8 ranks, `INGEST_RANGE` in `Weapons.js`): kills within N m of the player drop shards with `pull` set (fly straight to you); rank 8 = every kill anywhere (`Game.ingests`, `Loot.xp(x,z,v,pull)`). Cards use `PASSIVES[id].descFor(level)`.
- **Endless squeeze**: after 20 s of Endless the barrier closes at 0.075 m/s down to `ENDLESS_MIN_RADIUS` = 11 (`Waves.update` → `Arena.shrinkTo`); rings break away as the barrier passes them; HUD shows the ring width.

- **DEPLOY special attack** on **E** (`Game.castSpecial` → `specialStrike` → burning zone in `updateSpecials`): orbital strike at the cursor (≤18 m), 0.55 s telegraph, 380×dmg in 6.5 m, chain lightning, 3 s burn; cooldown `Game.specialCooldown()` = 20 s scaled by half of `cdMul`; HUD slot `#ab-special`.
- **Camera zoom** (user wanted a better zoom + strong zoom-out): default 24, wheel/NumpadAdd/NumpadSubtract/PageUp/PageDown from 12 to 64 (proportional steps), pitch tilts 44°→66° as you pull back, auto pull-back for bosses/big hordes (`cam.autoTarget`), fog thins and the shadow frustum widens with distance; zoom saved in `localStorage neon-echo-zoom`.

Possible next steps: real-GPU playtest feedback from the user, balance tuning (spawn rate in `Waves.update`, xp curve `xpToNext`), more enemy variety/bosses, stripping `Level.build()`.

## Personalisation (Anass's game)

The game is signed "A game by Anass El Basraoui" and reskinned with his ML world — gameplay ids are unchanged, only display names/texts:
- Weapons: `pulse` PYTHON PULSE → PYTORCH RAILSTORM · `arc` XGBOOST CHAIN → GRADIENT STORM · `orbit` CLIP ORBIT → DINO HALO · `nova` HDBSCAN NOVA → UMAP SUPERNOVA · `seeker` RETRIEVAL SWARM → RERANKER HYDRA · `drone` LLM AGENT → MULTI-AGENT.
- Passives: `coils` CUDA CORES · `cycler` TERRAFORM · `frame` CLOUD RUN · `magnet` DATA PIPELINE · `nano` MONITORING · `capacitor` EMBEDDINGS · `targeting` FROZEN TEST SET · `phase` SERVERLESS · `echo` BENCHMARK.
- Enemies: BUG (wisp), OUTLIER (shard), DATA LEAK (sentinel), LEGACY CODE (bulwark), DUPLICATE (splitter), MEMORY LEAK (bomber). Bosses: THE HALLUCINATION (hive), OVERFIT (lancer), THE BLACK BOX (warden). Events: DATA DRIFT STORM (meteors), GPU OUTAGE (blackout).
- **Keep it sober** — the user said "je veux pas exagérer": no rankings, no numbers, no schools/employer/city, no CV bragging. The **AUTHOR** panel (`#panel-author` in `index.html`) is just name, role, two plain sentences and the website link. His name appears only in: menu kicker ("A GAME BY ANASS EL BASRAOUI"), HUD tag, credits, author panel, page title, and one neon sign among ML words (`Arena.buildScenery`).
- The aim **reticle** must stay big and high-contrast (yellow ring + white ticks + black outline, ~66px span, `#reticle` in `styles.css`): the user found the first one too small and the same colour as the arena.
- Menu panels must stay **readable**: near-opaque dark background + light text (`#menu .menu-panel` in `styles.css`); the user complained the first version was illegible.
- **Privacy:** the game is public. Only his name, role and website `elbasraoui.engineer` are shown. Never put his phone number or e-mail in the game or the repo.

## Deployment

GitHub Pages via `.github/workflows/deploy.yml` (build + deploy on every push to `main`), `base: './'` in `vite.config.js`. URL: `https://forgit-dc.github.io/game/`. Pages is enabled in **legacy "Deploy from a branch" mode** (the Codespace token gets 403 on the Pages API, so it cannot be switched from here). In that mode GitHub also publishes the raw source on every push, so the workflow's deploy job **waits for the `pages build and deployment` run to finish, then deploys the built `dist/` last**. Verified live (loads, menu shows, no errors). If the user switches Source to "GitHub Actions", the wait step simply finds nothing and proceeds. Note: user screenshots can be too large to read — check the live site with curl/Playwright instead.

## v2 game design (implemented)

**Pitch:** K-7, a courier android, is trapped on *The Ring*, a floating arena above the drowned neon city of Vashta. Survive 10 minutes of escalating drone hordes, build a synergy loadout, kill three bosses, then keep going in Endless. Death is progress: shards buy permanent upgrades.

**Controls (no pointer lock; custom DOM reticle, hide system cursor over canvas):**
WASD/ZQSD move (use `event.code`, labels via `input.label(code)` → AZERTY-aware) · mouse aim on the ground plane · LMB hold = Pulse Blaster (option: auto-fire) · SPACE or SHIFT = dash (i-frames; being hit during a dash = *Perfect Dodge*: 0.45s slow-mo + sync) · RMB = Blade (arc in aim dir, high dmg, knockback, ignores shields, deflects orange orbs) · **Y** toggles auto-blade (swings at the nearest drone/boss/orange orb in reach, `Game.bladeTarget`; user asked for it, like T for auto-fire; `localStorage neon-echo-autoblade`, AUTO badge on the blade icon) · Q (KeyQ, "A" on AZERTY) = Overclock (when SYNC 100: 6s, world ×0.35 speed, courier dmg ×1.5) · Esc/P pause · mouse wheel zoom.

**Camera:** perspective FOV 50, pitch 44–66° (tilts with zoom), distance 24 default (wheel 12–64), yaw fixed looking north (-Z), small look-ahead toward the cursor, smooth follow, trauma shake. Scenery tall only in the north so it frames the top of the screen.

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

- (Reading screenshots can fail once a large image is in the conversation — then verify with DOM measurements: computed colours, font sizes, rects.)
- A Playwright + Chromium install lives **outside the repo** in a scratchpad `pw/` dir (harness `h.mjs` + scripts `look.mjs`, `paths.mjs`, `boss.mjs`, `perf.mjs`, `audio.mjs`). Scratchpads get wiped between sessions: if missing, `npm init -y && npm i playwright` in a scratch dir (Chromium is cached in `~/.cache/ms-playwright`).
- Launch flags: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. Use `?debug&lowq` (or `?debug&pr=0.8&msaa=0` for nicer screenshots), viewport ~640×360–960×540.
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
