import * as THREE from 'three';
import { CollisionWorld } from '../physics/Collision.js';
import { Materials, shared } from '../world/Materials.js';
import { Sky } from '../world/Sky.js';
import { Skyline, Traffic, Searchlights, HoloWhale, CityCore } from '../world/Skyline.js';
import { Rain, Dust } from '../world/Weather.js';
import { Arena } from '../world/Arena.js';
import { Particles } from '../fx/Particles.js';
import { Effects } from '../fx/Effects.js';
import { PostFX } from '../fx/PostFX.js';
import { Player } from '../player/Player.js';
import { TopCamera } from './TopCamera.js';
import { Input } from './Input.js';
import { Projectiles, SHOT_Y } from '../combat/Projectiles.js';
import { Horde } from '../enemies/Horde.js';
import { BOSSES } from '../enemies/Bosses.js';
import { Progression } from '../systems/Progression.js';
import { Loot } from '../systems/Loot.js';
import { Waves, RUN_LENGTH } from '../systems/Waves.js';
import { Meta } from '../systems/Meta.js';
import { AudioEngine } from '../audio/Audio.js';
import { UI } from '../ui/UI.js';
import { damp, rand } from '../utils/math.js';

const FOG = 0x0f0820;
const FOG_DENSITY = 0.0072;

export class Game {
  constructor(canvas, { debug = false, lowQuality = false, pixelRatio = null, msaa = null } = {}) {
    this.canvas = canvas;
    this.debug = debug;
    this.lowQuality = lowQuality;
    this.forcePR = pixelRatio;
    this.forceMSAA = msaa;
    this.state = 'boot';
    this.time = 0;
    this.frame = 0;
    this.hitstop = 0;
    this.slowmo = 0;
    this.worldScale = 1;
    this.playerScale = 1;
    this.post = { damage: 0, glitch: 0, overclock: 0, radial: 0, white: 0, fade: 0 };
    this.bosses = [];
    this.meteors = [];
    this.settings = { autoFire: false };
    this.aimPoint = new THREE.Vector3(0, SHOT_Y, -5);
    this.blackout = 0;
    this.blackoutTarget = 0;
    this.difficulty = 'normal';
    try {
      this.settings.autoFire = localStorage.getItem('neon-echo-autofire') === '1';
    } catch {
      /* no storage */
    }
  }

  // ================================================================== setup

  async init(progress = () => {}) {
    const canvas = this.canvas;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    this.maxPixelRatio = this.forcePR ?? (this.lowQuality ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.25));
    this.pixelRatio = this.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !this.lowQuality;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.FogExp2(FOG, FOG_DENSITY);
    shared.fogDensity.value = FOG_DENSITY;
    const camera = (this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 3000));
    camera.position.set(0, 30, 50);

    progress('Compiling neon…');
    await tick();
    this.buildEnvironment();
    this.mats = new Materials();
    this.collision = new CollisionWorld();

    progress('Raising the skyline…');
    await tick();
    this.sky = new Sky(scene);
    this.sky.onLightning = () => this.audio.lightning();
    this.skyline = new Skyline(scene);
    this.traffic = new Traffic(scene);
    this.searchlights = new Searchlights(scene);
    this.whale = new HoloWhale(scene);
    this.whale.orbit = { R: 80, y: -24, speed: 0.03, cz: 0 };
    this.core = new CityCore(scene);
    this.coreRest = new THREE.Vector3(0, -58, -150);
    this.coreTarget = this.coreRest.clone();
    this.core.setPosition(this.coreRest.x, this.coreRest.y, this.coreRest.z);

    progress('Building the Ring…');
    await tick();
    this.arena = new Arena(scene, this.collision, this.mats);
    this.rain = new Rain(scene, 2200);
    this.dust = new Dust(scene, 700);

    const hemi = (this.hemi = new THREE.HemisphereLight(0x6a4ab0, 0x0a0418, 1.0));
    scene.add(hemi);
    const moon = (this.moon = new THREE.DirectionalLight(0xa9b8ff, 1.4));
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 120;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.03;
    scene.add(moon, moon.target);

    progress('Waking the horde…');
    await tick();
    this.particles = new Particles(scene);
    this.fx = new Effects(scene, this.particles);
    this.input = new Input(canvas);
    this.input.allowUnlocked = true;
    this.cam = new TopCamera(camera);
    this.rig = this.cam; // bosses call rig.addTrauma
    this.audio = new AudioEngine();
    this.meta = new Meta();
    this.player = new Player(this);
    this.progression = new Progression(this);
    this.projectiles = new Projectiles(this);
    this.horde = new Horde(this);
    this.loot = new Loot(this);
    this.waves = new Waves(this);
    this.ui = new UI(this);
    this.progression.reset();
    this.postfx = new PostFX(renderer, scene, camera, { samples: this.forceMSAA ?? (this.lowQuality || this.maxPixelRatio > 1.1 ? 0 : 4) });
    this.buildMeteorPool();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    await this.input.loadLayout();
    this.ui.setKeyLabels(this.input);
    this.input.onKey = (code) => this.onKey(code);
    canvas.addEventListener('wheel', (e) => {
      if (this.state === 'playing') this.cam.zoom(e.deltaY);
    }, { passive: true });

    progress('Warming shaders…');
    await tick();
    this.player.model.group.visible = false;
    this.player.scarf.setVisible(false);
    // spawn one of each drone offscreen so their materials compile now, not mid-fight
    for (const t of ['wisp', 'shard', 'sentinel', 'bulwark', 'splitter', 'bomber']) this.horde.spawn(t, 200, 200, { rise: false });
    this.horde.render(0);
    renderer.compile(scene, camera);
    this.horde.clear();
    this.horde.render(0);
    this.state = 'menu-idle';
    this.last = performance.now();
    renderer.setAnimationLoop(() => this.loop());
  }

  buildEnvironment() {
    const env = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 32, 16);
    const col = [];
    const pos = geo.attributes.position;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 50;
      if (y > 0.2) c.setRGB(0.06, 0.03, 0.14).lerp(new THREE.Color(0.02, 0.01, 0.05), (y - 0.2) / 0.8);
      else if (y > -0.1) c.setRGB(0.5, 0.12, 0.45);
      else c.setRGB(0.12, 0.03, 0.12);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const panel = (color, x, y, z, w, h, k = 6) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel('#22e6ff', -30, 6, -20, 18, 3);
    panel('#ff2bd6', 32, 8, -10, 16, 4);
    panel('#ff8a2b', 10, 2, 35, 20, 2, 4);
    panel('#8b5cff', -15, 25, 25, 25, 6, 3);
    panel('#ffffff', 0, 40, 0, 20, 20, 1.2);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(env, 0.03).texture;
    this.scene.environmentIntensity = 0.8;
    pmrem.dispose();
  }

  buildMeteorPool() {
    this.meteorPool = [];
    for (let i = 0; i < 14; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.3, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5a2a').multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      const fill = new THREE.Mesh(new THREE.CircleGeometry(2.3, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5a2a').multiplyScalar(0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      fill.rotation.x = -Math.PI / 2;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb35c').multiplyScalar(4) }));
      for (const m of [ring, fill, rock]) {
        m.visible = false;
        this.scene.add(m);
      }
      this.meteorPool.push({ ring, fill, rock, active: false });
    }
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.w = w;
    this.h = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.postfx?.setSize(w, h, this.pixelRatio);
    this.particles?.setViewportHeight(h * this.pixelRatio);
  }

  keyHint(...codes) {
    return codes.map((c) => `<kbd>${this.input.label(c)}</kbd>`).join('');
  }

  // ================================================================== flow

  boot() {
    this.audio.init();
    this.audio.setVolume(parseFloat(document.getElementById('set-vol').value));
    this.audio.boot();
    this.audio.setIntensity(-1);
    this.enterMenu();
  }

  enterMenu() {
    this.state = 'menu';
    this.ui.setHud(false);
    this.ui.show('menu');
    this.ui.panel(null);
    this.ui.refreshMenu();
    this.audio.setIntensity(-1);
    this.audio.setMuffle(0);
    this.clearRun();
    this.player.model.group.visible = false;
    this.player.marker.visible = false;
    this.player.scarf.setVisible(false);
    this.cam.cinematic = { pos: new THREE.Vector3(0, 30, 60), look: new THREE.Vector3(0, 0, -20), lambda: 1.5 };
    this.menuT = 0;
    document.body.classList.remove('playing');
  }

  onMenuAction(action, el) {
    switch (action) {
      case 'play': this.startRun(); break;
      case 'controls':
      case 'credits':
      case 'lattice':
        this.ui.panel(action);
        break;
      case 'back': this.ui.panel(null); break;
      case 'resume': this.resume(); break;
      case 'restart': this.startRun(); break;
      case 'quit': this.enterMenu(); break;
      case 'continue': this.continueEndless(); break;
      case 'to-lattice': this.enterMenu(); this.ui.panel('lattice'); break;
      case 'reroll': this.rerollCards(); break;
      case 'buy': {
        const id = el?.dataset.id;
        if (id && this.meta.buy(id)) {
          this.audio.chest();
          this.ui.refreshMenu();
          this.progression.recompute();
        } else this.audio.denied();
        break;
      }
      case 'difficulty':
        this.difficulty = this.difficulty === 'normal' ? 'overdrive' : 'normal';
        this.ui.refreshMenu();
        break;
    }
  }

  clearRun() {
    for (const b of this.bosses) b.dispose();
    this.bosses.length = 0;
    this.horde.clear();
    this.horde.render(0);
    this.projectiles.clear();
    this.projectiles.render(0);
    this.loot.clear();
    this.particles.clear();
    this.fx.clear();
    this.arena.reset();
    for (const m of this.meteorPool) { m.active = false; m.ring.visible = m.fill.visible = m.rock.visible = false; }
    this.meteors.length = 0;
    this.setBlackout(false, true);
    this.coreTarget.copy(this.coreRest);
    this.core.setAwake(0.25);
    shared.alarm.value = 0;
  }

  startRun() {
    this.audio.init();
    this.clearRun();
    const od = this.difficulty === 'overdrive' && this.meta.level('overdrive') > 0;
    this.overdrive = od;
    this.waves.reset(od ? { hp: 1.35, rate: 1.4 } : { hp: 1, rate: 1 });
    this.progression.reset();
    this.player.reset();
    this.progression.recompute();
    this.player.hp = this.player.stats.maxHp;
    this.player.dashCharges = this.player.stats.dashCharges;
    this.player.dropIn();
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboT = 0;
    this.bestCombo = 0;
    this.elites = 0;
    this.bossKills = 0;
    this.runShards = 0;
    this.dodges = 0;
    this.deflects = 0;
    this.damageTaken = 0;
    this.runTime = 0;
    this.victoryShown = false;
    this.endShown = false;
    this.cardQueue = 0;
    this.hitstop = 0;
    this.slowmo = 0;
    for (const k in this.post) this.post[k] = 0;
    this.post.fade = 1;
    this.ui.hideAll();
    this.ui.setHud(true);
    this.ui.resetRunHud();
    this.audio.setIntensity(0);
    this.audio.setMuffle(0);
    this.state = 'playing';
    this.cam.cinematic = null;
    this.cam.snap(new THREE.Vector3(0, 0, 4));
    this.cam.targetDist = 20;
    this.camera.position.set(0, 40, 30);
    document.body.classList.add('playing');
    this.ui.banner('THE RING // VASHTA', 'SURVIVE', `${this.overdrive ? 'OVERDRIVE · ' : ''}10:00 until the Warden wakes`, '');
    this.ui.log('SYSTEM RESTORED. UNIT K-7 ONLINE.', 'sys');
    this.schedule(1.4, () => this.ui.prompt(`${this.keyHint('KeyW', 'KeyA', 'KeyS', 'KeyD')} MOVE · <kbd>MOUSE</kbd> AIM · <kbd>LMB</kbd> FIRE · <kbd>SPACE</kbd> DASH · <kbd>RMB</kbd> BLADE`, 8));
    this.schedule(10, () => this.ui.prompt(`<kbd>T</kbd> TOGGLE AUTO-FIRE (${this.settings.autoFire ? 'ON' : 'OFF'}) · <kbd>WHEEL</kbd> ZOOM`, 5));
  }

  continueEndless() {
    this.ui.hideAll();
    this.ui.setHud(true);
    this.state = 'playing';
    this.cam.cinematic = null;
    this.waves.startEndless();
    this.audio.setMuffle(0);
    this.ui.banner('ENDLESS', 'THE CITY KEEPS FALLING', 'How long can a courier last?', 'warn');
    document.body.classList.add('playing');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.showPause();
    this.audio.setMuffle(0.85, 1);
    document.body.classList.remove('playing');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.hideAll();
    this.state = 'playing';
    this.audio.setMuffle(this.player.overclocked ? 0.35 : 0, this.player.overclocked ? 0.05 : 0);
    document.body.classList.add('playing');
  }

  onKey(code) {
    if (code === 'Escape' || code === 'KeyP') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if (code === 'KeyT' && (this.state === 'playing' || this.state === 'paused')) {
      this.settings.autoFire = !this.settings.autoFire;
      try {
        localStorage.setItem('neon-echo-autofire', this.settings.autoFire ? '1' : '0');
      } catch {
        /* ignore */
      }
      this.ui.log(`AUTO-FIRE ${this.settings.autoFire ? 'ENGAGED' : 'OFF'}`, 'sys');
      this.ui.syncSettings();
    }
    if (this.state === 'levelup' && code === 'KeyR') this.rerollCards();
  }

  schedule(delay, fn) {
    (this.timers || (this.timers = [])).push({ t: delay, fn });
  }

  // ================================================================== main loop

  loop() {
    const now = performance.now();
    const rawDt = this._fixedDt ?? Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frame++;
    this.numberBudget = 6;
    this.perf(rawDt);

    let dt = rawDt;
    if (this.hitstop > 0) {
      this.hitstop -= rawDt;
      dt = rawDt * 0.05;
    }
    const p = this.player;
    let wTarget = 1, pTarget = 1;
    if (p.overclocked) { wTarget = 0.35; pTarget = 1; }
    if (this.slowmo > 0) {
      this.slowmo -= rawDt;
      wTarget = Math.min(wTarget, 0.3);
      pTarget = Math.min(pTarget, 0.6);
    }
    if (this.state === 'dead') { wTarget = 0.2; pTarget = 0.2; }
    this.worldScale += (wTarget - this.worldScale) * damp(12, rawDt);
    this.playerScale += (pTarget - this.playerScale) * damp(12, rawDt);

    this.time += rawDt;
    const frozen = this.state === 'paused' || this.state === 'levelup';
    shared.time.value += rawDt * (frozen ? 0.12 : 0.35 + 0.65 * this.worldScale);
    const t = shared.time.value;

    const st = this.state;
    if (st === 'menu' || st === 'menu-idle') this.updateMenu(rawDt);
    else if (st === 'playing') this.updatePlaying(dt);
    else if (st === 'levelup') this.updateLevelUp(rawDt);
    else if (st === 'dead') this.updateDead(rawDt);
    else if (st === 'victory') this.updateVictory(rawDt);
    else if (st === 'paused') this.cam.update(0, p.pos, this.aimPoint);

    // ambient world
    const wdt = frozen ? 0 : dt * this.worldScale;
    this.traffic.update(t);
    this.searchlights.update(t);
    this.whale.update(t);
    this.core.group.position.lerp(this.coreTarget, damp(0.4, rawDt));
    this.core.pos.copy(this.core.group.position);
    this.core.update(rawDt, t, st === 'menu' || st === 'menu-idle' ? this.camera.position : _v.copy(p.pos).setY(2), this.camera);
    this.sky.update(frozen ? 0 : rawDt, this.camera);
    this.rain.update(frozen ? 0 : rawDt, this.camera.position, this.worldScale);
    this.particles.update(wdt);
    this.fx.update(frozen ? 0 : dt * Math.max(this.worldScale, 0.5), this.camera);
    if (st !== 'playing') {
      const events = [];
      this.arena.updateArena(frozen ? 0 : rawDt, t, p.pos, events);
    }
    this.updateBlackout(rawDt);

    const focus = st === 'playing' || st === 'levelup' || st === 'paused' || st === 'dead' ? p.pos : _menuFocus;
    this.moon.position.set(focus.x - 20, focus.y + 45, focus.z + 22);
    this.moon.target.position.copy(focus);

    if (this.audio.ready) {
      this.audio.setListener(this.camera.position, this.cam.right);
      this.audio.setIntensity(this.stormLevel());
    }

    // render instanced sets
    this.horde.render(t);
    this.projectiles.render(t);
    this.loot.render(t);

    // post
    const P = this.post;
    P.damage = Math.max(0, P.damage - rawDt * 2.4);
    P.glitch = Math.max(0, P.glitch - rawDt * 1.5);
    P.radial = Math.max(0, P.radial - rawDt * 4);
    P.fade = Math.max(0, P.fade - rawDt * 1.4);
    P.overclock += ((p.overclocked && st === 'playing' ? 1 : 0) - P.overclock) * damp(6, rawDt);
    const U = this.postfx.u;
    U.uDamage.value = P.damage;
    U.uGlitch.value = P.glitch;
    U.uOverclock.value = P.overclock;
    U.uRadial.value = P.radial;
    U.uWhite.value = P.white;
    U.uFade.value = P.fade;
    U.uAlarm.value = shared.alarm.value * (st === 'playing' ? 0.8 : 0.3);
    U.uLowHealth.value = st === 'playing' && p.hp / p.stats.maxHp < 0.3 ? 1 : 0;

    this.ui.updateWorld(rawDt, this.camera, this.w, this.h);
    if (!this._noRender) this.postfx.render(rawDt);
    this.input.endFrame();
  }

  debugStep(frames = 60, dt = 1 / 60) {
    this.renderer.setAnimationLoop(null);
    this._fixedDt = dt;
    this._noRender = true;
    for (let i = 0; i < frames; i++) this.loop();
    this._noRender = false;
    this.loop();
  }

  debugResume() {
    this._fixedDt = null;
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.loop());
  }

  updateMenu(dt) {
    this.menuT = (this.menuT || 0) + dt;
    const a = this.menuT * 0.05;
    const c = this.cam.cinematic || (this.cam.cinematic = { pos: new THREE.Vector3(), look: new THREE.Vector3(), lambda: 1.5 });
    c.pos.set(Math.sin(a) * 34 + 10, 16 + Math.sin(this.menuT * 0.15) * 3, Math.cos(a) * 20 + 44);
    c.look.set(Math.sin(a + 1) * 6, -4, -40);
    this.cam.update(dt, _menuFocus);
  }

  updatePlaying(dt) {
    const input = this.input;
    const p = this.player;
    this.runTime += dt * this.worldScale;

    if (this.timers) {
      for (let i = this.timers.length - 1; i >= 0; i--) {
        const tm = this.timers[i];
        tm.t -= dt;
        if (tm.t <= 0) {
          this.timers.splice(i, 1);
          tm.fn();
        }
      }
    }

    const wdt = dt * this.worldScale;
    const pdt = dt * this.playerScale;
    // aim: cursor → ground
    const hit = this.cam.screenToGround(input.mouse.x, input.mouse.y, this.w, this.h, SHOT_Y);
    if (hit) this.aimPoint.copy(hit);

    const events = [];
    this.arena.updateArena(wdt, shared.time.value, p.pos, events);
    for (const ev of events) this.onArenaEvent(ev);

    p.update(pdt, input, this.aimPoint, true);
    this.progression.update(pdt, p.firing);
    this.horde.update(wdt);
    for (const b of this.bosses) b.update(wdt);
    for (let i = this.bosses.length - 1; i >= 0; i--) if (this.bosses[i].removed) this.bosses.splice(i, 1);
    this.projectiles.update(dt, this.worldScale, this.playerScale);
    this.loot.update(pdt);
    this.waves.update(wdt);
    this.updateMeteors(wdt);
    this.updateRainSplashes(dt);

    // combo decay
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    // alarm glow follows danger
    const danger = this.bosses.length ? 0.6 : this.waves.active.some((a) => a.type === 'meteors') ? 0.4 : 0;
    shared.alarm.value += (Math.max(danger, this.arena.pendingBoundary ? 0.7 : 0) - shared.alarm.value) * damp(1.5, dt);

    // queued level-ups
    if (this.progression.pending > 0 && !p.dead) {
      this.levelDelay = (this.levelDelay ?? 0.25) - dt;
      if (this.levelDelay <= 0) {
        this.levelDelay = 0.25;
        this.progression.pending--;
        this.openCards({ source: 'level' });
      }
    }

    this.cam.fovKick += 0;
    this.cam.update(dt, p.pos, this.aimPoint);
    this.ui.update(dt);
  }

  updateLevelUp(dt) {
    this.cam.update(0, this.player.pos, this.aimPoint);
    this.ui.cardsInput(this.input);
  }

  updateDead(dt) {
    this.deadT += dt;
    const wdt = dt * this.worldScale;
    this.horde.update(wdt);
    for (const b of this.bosses) b.update(wdt);
    this.projectiles.update(dt, this.worldScale, this.worldScale);
    const c = this.cam.cinematic;
    c.pos.lerp(_v.copy(this.deathPos).add(_v2.set(0, 9, 9)), damp(0.8, dt));
    c.look.lerp(this.deathPos, damp(2, dt));
    this.cam.update(dt, this.player.pos);
    this.post.glitch = Math.max(this.post.glitch, 0.2);
    if (this.deadT > 2.4 && !this.endShown) {
      this.endShown = true;
      this.showEnd(false);
    }
  }

  updateVictory(dt) {
    this.vicT += dt;
    const c = this.cam.cinematic;
    const p = this.player.pos;
    c.pos.set(p.x + Math.sin(this.vicT * 0.3) * 14, 10 + this.vicT * 1.5, p.z + Math.cos(this.vicT * 0.3) * 14);
    c.look.set(p.x, 1.5, p.z);
    this.cam.update(dt, p);
    this.player.model.update(dt, { speed: 0, grounded: true, vy: 0, dash: false, aiming: false, aimPitch: 0, turn: 0 });
    if (Math.random() < 0.6) this.particles.burst(_v.set(p.x + rand(-6, 6), 0.2, p.z + rand(-6, 6)), { count: 2, color: '#ffd36b', speed: [1, 3], life: [1, 2], up: 5, drag: 0.5, size: [0.1, 0.22] });
    if (this.vicT > 4 && !this.victoryShown) {
      this.victoryShown = true;
      this.showEnd(true);
    }
  }

  perf(dt) {
    this.perfAcc = (this.perfAcc || 0) + dt;
    this.perfN = (this.perfN || 0) + 1;
    if (this.perfAcc > 2.5) {
      const avg = this.perfAcc / this.perfN;
      this.perfAcc = 0;
      this.perfN = 0;
      if (this.state === 'boot' || this.debug) return;
      if (avg > 0.021 && this.pixelRatio > 0.6) {
        this.pixelRatio = Math.max(0.6, this.pixelRatio - 0.15);
        this.onResize();
      } else if (avg < 0.0135 && this.pixelRatio < this.maxPixelRatio) {
        this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
        this.onResize();
      }
    }
  }

  stormLevel() {
    const st = this.state;
    if (st === 'menu' || st === 'menu-idle' || st === 'boot') return -1;
    if (this.bosses.length) return 3;
    const m = this.waves.minutes;
    return m > 6 ? 2 : m > 2 ? 1 : 0;
  }

  // ================================================================== damage routing

  hitEnemy(e, dmg, dx, dz, knock, opts = {}) {
    if (!e.alive) return false;
    if (this.player.overclocked) dmg *= 1.5;
    const killed = this.horde.damage(e, dmg, dx, dz, knock, opts);
    const x = opts.x ?? e.x, z = opts.z ?? e.z;
    if (opts.blocked) {
      if (Math.random() < 0.3) this.particles.burst(_v.set(x, SHOT_Y, z), { count: 6, color: '#b69cff', speed: [2, 6], life: [0.1, 0.3], size: [0.05, 0.1] });
      this.audio.blocked?.();
    }
    if ((!opts.quiet || opts.crit || opts.big) && this.numberBudget > 0) {
      this.numberBudget--;
      this.ui.number(_v.set(x, e.y + 0.8, z), String(Math.round(dmg)), opts.big ? 'big' : opts.crit ? 'crit' : opts.blocked ? 'blocked' : '');
    }
    if (opts.bolt && Math.random() < 0.5) this.particles.burst(_v.set(x, SHOT_Y, z), { count: 3, color: '#7ff6ff', speed: [2, 6], life: [0.08, 0.2], size: [0.04, 0.09] });
    this.audio.hit(null, opts.crit);
    if (!killed) this.player.addSync(dmg * 0.004);
    return killed;
  }

  hitBoss(b, dmg, crit, x, z) {
    if (b.invulnerable) return false;
    if (this.player.overclocked) dmg *= 1.5;
    const killed = b.damage(dmg);
    if (this.numberBudget > 0) {
      this.numberBudget--;
      this.ui.number(_v.set(x, b.pos.y + 1, z), String(Math.round(dmg)), crit ? 'crit' : 'boss');
    }
    this.player.addSync(dmg * 0.01);
    this.audio.hit(null, crit);
    return killed;
  }

  areaDamage(x, z, R, dmg, { knock = 6, color = '#ffd36b', cause = 'area', pierceShield = true, quiet = true } = {}) {
    const victims = [];
    this.horde.forEachNear(x, z, R, (e) => { victims.push(e); });
    for (const e of victims) {
      const dx = e.x - x, dz = e.z - z;
      const d = Math.hypot(dx, dz) || 1;
      this.hitEnemy(e, dmg, dx / d, dz / d, knock, { pierceShield, cause, quiet });
    }
    for (const b of this.bosses) if (Math.hypot(b.x - x, b.z - z) < R + b.r) this.hitBoss(b, dmg, false, b.x, b.z);
    void color;
    return victims.length;
  }

  nearestBoss(x, z, maxR = Infinity) {
    let best = null, bd = maxR;
    for (const b of this.bosses) {
      if (b.invulnerable) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  bladeSlash(p) {
    const s = p.stats;
    const R = 3.7 * s.areaMul;
    const ax = p.aim.x, az = p.aim.z;
    const dmg = 50 * s.dmgMul;
    const victims = [];
    this.horde.forEachNear(p.pos.x, p.pos.z, R, (e) => {
      const dx = e.x - p.pos.x, dz = e.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if ((dx * ax + dz * az) / d > -0.25 || d < e.r + 1) victims.push([e, dx / d, dz / d]);
    });
    for (const [e, dx, dz] of victims) {
      e.state === 'aim' || e.state === 'charge' ? (e.state = 'rest', e.st = 0) : null;
      this.hitEnemy(e, dmg, dx, dz, 16, { pierceShield: true, crit: true, cause: 'blade' });
      this.particles.burst(_v.set(e.x, 1.1, e.z), { count: 10, color: '#ff5ae0', colorEnd: '#ffffff', speed: [4, 12], life: [0.12, 0.35], size: [0.05, 0.12], dir: _v2.set(dx, 0.2, dz), spread: 0.6 });
    }
    for (const b of this.bosses) {
      const dx = b.x - p.pos.x, dz = b.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < R + b.r && (dx * ax + dz * az) / (d || 1) > -0.25) this.hitBoss(b, dmg * 1.4, true, b.x, b.z);
    }
    const deflected = this.projectiles.deflect(p.pos.x, p.pos.z, ax, az, R + 0.6, -0.25);
    this.fx.arc(_v.set(p.pos.x, 1.1, p.pos.z), Math.atan2(ax, az), p.model.slashSide, '#ff5ae0', R / 3.3);
    this.audio.blade();
    if (victims.length) {
      this.hitstop = Math.max(this.hitstop, 0.035);
      this.cam.addTrauma(0.12);
      this.audio.bladeHit(null);
    }
    if (deflected) {
      this.deflects += deflected;
      this.audio.deflect(null);
      this.ui.number(_v.set(p.pos.x, 2.6, p.pos.z), deflected > 1 ? `DEFLECT ×${deflected}` : 'DEFLECT', 'big');
      p.addSync(4 * deflected);
      this.hitstop = Math.max(this.hitstop, 0.05);
    }
    this.ui.pulseAbility('blade');
  }

  // ================================================================== kill & loot

  onEnemyKilled(e, cause) {
    this.kills++;
    this.combo++;
    this.comboT = 2.6;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const mul = 1 + Math.min(2, Math.floor(this.combo / 20) * 0.1);
    this.score += e.def.score * (e.elite ? 6 : 1) * mul;
    const xp = Math.max(1, Math.round(e.def.xp * (e.elite ? 10 : 1) * (e.mini ? 0.5 : 1)));
    if (xp >= 8 || Math.random() < 0.85 || e.mini) this.loot.xp(e.x, e.z, xp);
    this.player.addSync(e.elite ? 12 : 0.9);
    if (e.elite) {
      this.elites++;
      this.runShards += 4;
      this.loot.item('chest', e.x, e.z);
      if (Math.random() < 0.5) this.loot.item('heart', e.x + 1, e.z);
      this.fx.ring(_v.set(e.x, 0.2, e.z), '#ffd36b', 5, 0.5);
      this.fx.flash(_v.set(e.x, 2, e.z), '#ffd36b', 80, 0.3);
      this.hitstop = Math.max(this.hitstop, 0.06);
      this.cam.addTrauma(0.25);
      this.audio.explosion(null, 1.4);
    } else if (Math.random() < 0.012) this.loot.item('heart', e.x, e.z);
    // death pop
    const big = e.type === 'bulwark' ? 2 : e.type === 'sentinel' ? 1.4 : 1;
    const crowd = this.horde.count > 150 ? 0.5 : 1;
    const col = e.def.color;
    this.particles.burst(_v.set(e.x, e.y, e.z), { count: Math.ceil(14 * big * crowd), color: '#ffffff', colorEnd: col, speed: [3, 10 * Math.sqrt(big)], life: [0.2, 0.5], size: [0.06, 0.16], drag: 3 });
    this.particles.burst(_v, { count: Math.ceil(6 * big * crowd), color: col, speed: [1, 5], life: [0.4, 0.9], size: [0.12, 0.28], gravity: 10, drag: 0.8 });
    if (big > 1.2) this.fx.ring(_v2.set(e.x, 0.2, e.z), col, 2.5 * big, 0.35);
    this.audio.kill?.(big);
    this.ui.combo(this.combo);
  }

  onBomberExplode(x, z, R) {
    this.particles.burst(_v.set(x, 1, z), { count: 40, color: '#fff2c0', colorEnd: '#ff8a2b', speed: [3, 12], life: [0.2, 0.6], size: [0.1, 0.25], drag: 2.5 });
    this.particles.burst(_v, { count: 10, color: '#ffd36b', speed: [0.5, 2], life: [0.3, 0.7], size: [0.6, 1.2], sizeEnd: 1.8, drag: 2, intensity: 1.2 });
    this.fx.ring(_v2.set(x, 0.2, z), '#ffd36b', R, 0.4);
    this.fx.flash(_v2.set(x, 2, z), '#ffb35c', 70, 0.25);
    this.audio.explosion(null, 1.1);
    const d = Math.hypot(this.player.pos.x - x, this.player.pos.z - z);
    this.cam.addTrauma(Math.max(0, 0.3 * (1 - d / 20)));
  }

  onXp(n) {
    this.progression.addXp(n);
  }

  onItem(kind, pos) {
    const p = this.player;
    if (kind === 'heart') {
      p.heal(25);
      this.ui.number(p.center, '+25', 'heal');
      this.audio.pickup('hp');
    } else if (kind === 'magnet') {
      this.loot.vacuum();
      this.ui.log('MAGNET CORE — ALL DATA INBOUND', 'gold');
      this.audio.pickup('energy');
      this.fx.ring(_v.set(p.pos.x, 0.3, p.pos.z), '#22e6ff', 20, 0.8);
    } else if (kind === 'chest') {
      this.runShards += 10;
      this.audio.chest();
      this.particles.burst(pos, { count: 50, color: '#ffd36b', speed: [2, 10], life: [0.4, 1], up: 3 });
      this.openCards({ source: 'chest' });
    }
  }

  // ================================================================== level-up cards

  openCards({ source = 'level' } = {}) {
    const n = this.meta.level('choice') > 0 ? 4 : 3;
    const cards = this.progression.roll(n, { chest: source === 'chest' });
    if (!cards.length) return;
    this.state = 'levelup';
    this.cardSource = source;
    this.audio.levelUp?.();
    this.audio.setMuffle(0.6, 0.2);
    this.arena.pulse(0);
    this.fx.ring(_v.set(this.player.pos.x, 0.3, this.player.pos.z), '#a6fffb', 8, 0.6);
    this.ui.showCards(cards, {
      title: source === 'chest' ? 'SUPPLY CACHE' : `LEVEL ${this.progression.level}`,
      kicker: source === 'chest' ? 'ELITE DROP DECRYPTED' : 'DATA THRESHOLD REACHED',
      rerolls: this.progression.rerolls,
      onPick: (card) => this.pickCard(card),
    });
    document.body.classList.remove('playing');
  }

  rerollCards() {
    if (this.state !== 'levelup' || this.progression.rerolls <= 0) return;
    this.progression.rerolls--;
    const n = this.meta.level('choice') > 0 ? 4 : 3;
    const cards = this.progression.roll(n, { chest: this.cardSource === 'chest' });
    this.audio.uiClick();
    this.ui.showCards(cards, { title: this.ui.cardTitle, kicker: this.ui.cardKicker, rerolls: this.progression.rerolls, onPick: (c) => this.pickCard(c) });
  }

  pickCard(card) {
    this.progression.apply(card);
    this.ui.log(card.kind === 'evo' ? `EVOLVED: ${card.title}` : `${card.title} ${card.tag || ''}`.trim(), card.kind === 'evo' ? 'gold' : 'sys');
    this.state = 'playing';
    this.audio.setMuffle(this.player.overclocked ? 0.35 : 0);
    this.ui.refreshSlots();
    document.body.classList.add('playing');
  }

  onEvolution(card) {
    this.ui.banner('EVOLUTION', card.title, card.desc, 'gold');
    this.audio.evolve?.();
    this.post.white = 0;
    this.post.radial = 1;
    this.fx.ring(_v.set(this.player.pos.x, 0.3, this.player.pos.z), '#ffd36b', 14, 0.9);
    this.particles.burst(this.player.center, { count: 80, color: '#ffd36b', colorEnd: '#ffffff', speed: [3, 12], life: [0.5, 1.2], size: [0.08, 0.2] });
  }

  // ================================================================== player events

  onPlayerLanded() {
    const p = this.player;
    this.fx.ring(_v.set(p.pos.x, 0.2, p.pos.z), '#22e6ff', 7, 0.6);
    this.particles.burst(_v.set(p.pos.x, 0.3, p.pos.z), { count: 50, color: '#7ff6ff', speed: [4, 12], life: [0.3, 0.8], size: [0.08, 0.2], dir: _v2.set(0, 0.3, 0), spread: 1 });
    this.audio.land(30);
    this.cam.addTrauma(0.45);
    this.arena.pulse(0);
  }

  onPlayerDash(p) {
    this.audio.dash();
    this.cam.fovKick += 3;
    this.post.radial = 0.6;
    this.particles.burst(_v.set(p.pos.x, 0.3, p.pos.z), { count: 12, color: '#22e6ff', speed: [2, 6], life: [0.2, 0.45], size: [0.08, 0.16], dir: _v2.copy(p.dashDir).negate(), spread: 0.7 });
    this.ui.pulseAbility('dash');
  }

  onPerfectDodge() {
    if (this._lastDodge && this.time - this._lastDodge < 0.5) return;
    this._lastDodge = this.time;
    this.dodges++;
    this.slowmo = 0.45;
    this.player.addSync(8);
    this.audio.perfectDodge();
    this.ui.number(this.player.center, 'PERFECT DODGE', 'big');
    this.fx.ring(_v.set(this.player.pos.x, 1, this.player.pos.z), '#22e6ff', 4, 0.4, this.camera.position);
  }

  onPlayerHurt(dmg, fx, fz) {
    this.damageTaken += dmg;
    // shove the crowd back so one mistake doesn't chain into death
    const p = this.player.pos;
    this.horde.forEachNear(p.x, p.z, 2.8, (e) => {
      const dx = e.x - p.x, dz = e.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      e.kx += (dx / d) * 9 / e.def.mass;
      e.kz += (dz / d) * 9 / e.def.mass;
    });
    this.combo = Math.floor(this.combo * 0.5);
    this.audio.hurt();
    this.post.damage = 1;
    this.post.glitch = Math.max(this.post.glitch, 0.2);
    this.cam.addTrauma(0.35);
    this.hitstop = Math.max(this.hitstop, 0.03);
    if (fx !== undefined) this.ui.damageDirection(fx, fz);
    this.ui.number(this.player.center, `-${Math.round(dmg)}`, 'hurt');
  }

  onRevive() {
    const p = this.player;
    this.ui.banner('SECOND SIGNAL', 'NOT YET.', 'Integrity restored to 50%', 'gold');
    this.areaDamage(p.pos.x, p.pos.z, 9, 400, { knock: 30 });
    this.fx.ring(_v.set(p.pos.x, 0.3, p.pos.z), '#ffffff', 12, 0.8);
    this.post.white = 0;
    this.post.glitch = 1;
    this.slowmo = 1;
    this.audio.overclock(true);
  }

  onPlayerDeath() {
    const p = this.player;
    this.state = 'dead';
    this.deadT = 0;
    this.endShown = false;
    this.deathPos = p.pos.clone().setY(1);
    p.model.group.visible = false;
    p.marker.visible = false;
    p.scarf.setVisible(false);
    this.particles.burst(this.deathPos, { count: 140, color: '#7ff6ff', colorEnd: '#ff2bd6', speed: [2, 13], life: [0.6, 1.6], size: [0.08, 0.22], drag: 1.5, gravity: 3 });
    this.fx.ring(this.deathPos, '#22e6ff', 7, 0.8, this.camera.position);
    this.fx.flash(this.deathPos, '#22e6ff', 120, 0.6);
    this.audio.death();
    this.post.glitch = 1;
    this.cam.addTrauma(0.6);
    this.cam.cinematic = { pos: this.camera.position.clone(), look: this.deathPos.clone(), lambda: 2 };
    document.body.classList.remove('playing');
  }

  onOverclock(on) {
    const p = this.player;
    this.audio.overclock(on);
    if (on) {
      this.audio.setMuffle(0.35, 0.05);
      this.fx.ring(_v.set(p.pos.x, 0.5, p.pos.z), '#ffd36b', 16, 0.7);
      this.cam.addTrauma(0.3);
      this.post.radial = 1;
      this.ui.number(p.center, 'OVERCLOCK', 'big');
      this.ui.pulseAbility('over');
    } else this.audio.setMuffle(0);
  }

  onSyncReady() {
    this.audio.syncReady();
    if (!this._syncHinted) {
      this._syncHinted = true;
      this.ui.prompt(`${this.keyHint('KeyQ')} OVERCLOCK READY — BEND TIME`, 5);
    }
  }

  // ================================================================== world events

  onEventWarning(ev) {
    this.audio.warningBeep(ev.type === 'boss' ? 3 : 2);
    this.ui.warning(`${ev.label} IN 8s`, ev.type === 'boss' ? 'red' : 'warn');
  }

  onEventStart(ev) {
    this.ui.banner('ALERT', ev.label, ev.type === 'meteors' ? 'Stay out of the red circles — they crush drones too.' : 'Power grid down. Trust your light.', 'warn');
  }

  onEventEnd(ev) {
    this.ui.log(`${ev.label} OVER`, 'sys');
  }

  onCollapse(ring) {
    this.audio.collapseStart();
    this.ui.banner('STRUCTURAL FAILURE', 'THE RING IS BREAKING', 'Move toward the centre!', 'red');
    this.post.glitch = 0.8;
    this.cam.addTrauma(0.5);
    void ring;
  }

  onArenaEvent(ev) {
    if (ev.type === 'segmentFall') {
      this.audio.collapse(ev.pos);
      this.particles.burst(ev.pos, { count: 40, color: '#ff8a2b', speed: [2, 9], life: [0.5, 1.2], size: [0.15, 0.4], gravity: 6, drag: 1 });
      this.cam.addTrauma(0.2);
    }
  }

  onEliteSpawn(e) {
    this.ui.log(`ELITE ${e.def.name} DETECTED`, 'gold');
    this.audio.enemyAlert(null);
  }

  onSurge() {
    this.ui.warning('SURGE — THEY SURROUND YOU', 'warn');
    this.audio.warp(null);
  }

  spawnBoss(id, hpBoost = 1) {
    const B = BOSSES[id];
    const boss = new B(this, this.waves.hpMul * hpBoost * (this.overdrive ? 1.3 : 1));
    this.bosses.push(boss);
    this.ui.banner('WARNING', boss.name, boss.title, 'red');
    this.audio.bossWarn?.();
    this.cam.addTrauma(0.5);
    this.post.glitch = 0.7;
    this.ui.bossBar(boss);
    if (id === 'warden') {
      this.coreTarget.set(0, -34, -120);
      this.core.setAwake(1);
    }
  }

  onBossSpark(b) {
    this.particles.burst(_v.set(b.x + rand(-2, 2), b.pos.y + rand(-1, 2), b.z + rand(-2, 2)), { count: 8, color: '#ffd36b', colorEnd: '#ff2a55', speed: [3, 10], life: [0.2, 0.5], size: [0.1, 0.25] });
    if (Math.random() < 0.15) this.audio.explosion(null, 0.8);
  }

  onBossDying(b) {
    this.slowmo = 1.2;
    this.ui.banner('TARGET DOWN', `${b.name} DESTROYED`, '', 'gold');
    this.audio.explosion(null, 2.5);
    this.cam.addTrauma(0.7);
    this.projectiles.orbs.length = 0;
  }

  onBossKilled(b) {
    const x = b.x, z = b.z;
    this.particles.burst(_v.set(x, b.pos.y, z), { count: 200, color: '#ffffff', colorEnd: '#ff8a2b', speed: [5, 22], life: [0.4, 1.4], size: [0.1, 0.3], drag: 2 });
    this.particles.burst(_v, { count: 40, color: '#ffd36b', speed: [1, 4], life: [0.6, 1.4], size: [1, 2.2], sizeEnd: 2, drag: 2, intensity: 1.1 });
    this.fx.ring(_v2.set(x, 0.3, z), '#ffd36b', 18, 0.9);
    this.fx.ring(_v2.set(x, 2, z), '#ffffff', 10, 0.5, this.camera.position);
    this.fx.flash(_v2.set(x, 3, z), '#ffd36b', 200, 0.8);
    this.audio.explosion(null, 3);
    this.cam.addTrauma(0.9);
    this.bossKills++;
    this.runShards += 50;
    this.score += 5000;
    for (let i = 0; i < 40; i++) this.loot.xp(x + rand(-3, 3), z + rand(-3, 3), 8);
    this.loot.item('chest', x, z);
    this.loot.item('heart', x + 2, z);
    b.dispose();
    this.ui.bossBar(null);
    if (b instanceof BOSSES.warden && !this.waves.endless) this.startVictory();
    else if (b instanceof BOSSES.warden) this.coreTarget.copy(this.coreRest);
  }

  onWardenPhase(ph) {
    if (ph === 2) {
      this.ui.banner('PHASE II', 'THE CORE IS WATCHING', 'Its lance falls where you stand — keep moving.', 'red');
      this.coreTarget.set(0, -18, -105);
      this.core.setAwake(1.6);
      this.audio.collapseStart();
      this.post.glitch = 1;
    } else if (ph === 2.5) {
      this.arena.collapseRing(this.arena.stage, 5);
      this.onCollapse(1);
    } else if (ph === 3) {
      this.ui.banner('PHASE III', 'OVERLOAD', 'Everything it has left.', 'red');
      this.post.glitch = 1;
      this.cam.addTrauma(0.5);
    }
  }

  onCoreLanceAim() {
    this.audio.bossCharge?.(null, 1.7);
    this.core.pulse = 1;
  }

  onCoreLanceStrike(x, z) {
    this.particles.burst(_v.set(x, 0.5, z), { count: 90, color: '#ffffff', colorEnd: '#ff2a55', speed: [4, 16], life: [0.3, 1], size: [0.1, 0.3], drag: 2 });
    this.fx.ring(_v2.set(x, 0.2, z), '#ff2a55', 9, 0.6);
    this.fx.flash(_v2.set(x, 4, z), '#ff5a7a', 180, 0.5);
    this.audio.explosion(null, 2.2);
    this.audio.thunder(0, 1);
    this.cam.addTrauma(0.6);
    this.post.white = 0;
    this.areaDamage(x, z, 3.6, 220, { knock: 20 });
  }

  // ================================================================== meteors & blackout

  spawnMeteor(x, z) {
    const lim = this.arena.boundary - 1;
    const r = Math.hypot(x, z);
    if (r > lim) { x *= lim / r; z *= lim / r; }
    const m = this.meteorPool.find((k) => !k.active);
    if (!m) return;
    m.active = true;
    m.t = 0;
    m.x = x;
    m.z = z;
    m.ring.visible = m.fill.visible = m.rock.visible = true;
    m.ring.position.set(x, 0.07, z);
    m.fill.position.set(x, 0.06, z);
    this.meteors.push(m);
  }

  updateMeteors(dt) {
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      const T = 1.25;
      const k = Math.min(1, m.t / T);
      m.ring.scale.setScalar(1.25 - k * 0.25);
      m.fill.material.opacity = 0.2 + k * 0.6;
      m.rock.position.set(m.x - (1 - k) * 10, 40 * (1 - k), m.z - (1 - k) * 6);
      m.rock.rotation.x += dt * 6;
      if (Math.random() < 0.9) this.particles.spawn(m.rock.position.x, m.rock.position.y, m.rock.position.z, rand(-1, 1), 2, rand(-1, 1), 0.5, 0.5, 0.1, _c.set('#ffb35c').multiplyScalar(3), _c2.set('#ff2a55'), -2, 1);
      if (m.t >= T) {
        const p = this.player;
        if (Math.hypot(p.pos.x - m.x, p.pos.z - m.z) < 2.3) p.hurt(18, m.x, m.z);
        this.areaDamage(m.x, m.z, 2.6, 90 * this.waves.hpMul, { knock: 14 });
        this.particles.burst(_v.set(m.x, 0.4, m.z), { count: 50, color: '#fff2c0', colorEnd: '#ff5a2a', speed: [3, 12], life: [0.3, 0.8], size: [0.1, 0.3], drag: 2 });
        this.fx.ring(_v2.set(m.x, 0.15, m.z), '#ff8a2b', 4, 0.4);
        this.audio.meteor?.(m);
        this.cam.addTrauma(Math.max(0, 0.25 * (1 - Math.hypot(p.pos.x - m.x, p.pos.z - m.z) / 25)));
        m.active = false;
        m.ring.visible = m.fill.visible = m.rock.visible = false;
        this.meteors.splice(i, 1);
      }
    }
  }

  setBlackout(on, instant = false) {
    this.blackoutTarget = on ? 1 : 0;
    if (instant) this.blackout = this.blackoutTarget;
    if (on) this.audio.powerDown?.();
  }

  updateBlackout(dt) {
    this.blackout += (this.blackoutTarget - this.blackout) * damp(1.5, dt);
    const b = this.blackout;
    const flick = b > 0.05 && Math.random() < 0.04 ? 0.5 : 1;
    this.scene.fog.density = FOG_DENSITY + b * 0.03;
    shared.fogDensity.value = this.scene.fog.density;
    this.hemi.intensity = (1.0 - b * 0.85) * flick;
    this.moon.intensity = 1.4 * (1 - b * 0.9);
    for (const L of this.arena.lights) L.l.intensity = L.base * (1 - b * 0.9) * flick;
  }

  updateRainSplashes(dt) {
    const p = this.player.pos;
    const n = Math.random() < dt * 40 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const x = p.x + rand(-14, 14), z = p.z + rand(-10, 8);
      if (Math.hypot(x, z) > this.arena.boundary) continue;
      this.particles.spawn(x, 0.05, z, rand(-0.5, 0.5), 1.5, rand(-0.5, 0.5), 0.25, 0.06, 0.02, _c.set('#9fb4ff').multiplyScalar(1.5), _c2.set(0, 0, 0), 8, 0);
    }
  }

  // ================================================================== endings

  startVictory() {
    this.state = 'victory';
    this.vicT = 0;
    this.victoryShown = false;
    this.cam.cinematic = { pos: this.camera.position.clone(), look: this.player.pos.clone(), lambda: 1.2 };
    this.ui.banner('SIGNAL SURVIVED', 'THE WARDEN HAS FALLEN', 'The Eye closes. For now.', 'gold');
    this.audio.victory();
    for (const e of [...this.horde.list]) if (e.alive) this.horde.kill(e, 'victory');
    this.horde.list.length = 0;
    this.projectiles.clear();
    this.coreTarget.copy(this.coreRest);
    this.core.setAwake(0.1);
    document.body.classList.remove('playing');
  }

  showEnd(victory) {
    const p = this.player;
    const t = this.waves.t;
    const shardsBase = t / 10 + this.kills / 25 + this.bossKills * 50 + this.elites * 10 + this.progression.level * 2 + (victory ? 200 : 0);
    const earned = Math.floor((shardsBase + this.runShards) * (this.overdrive ? 1.6 : 1));
    this.meta.addShards(earned);
    const score = Math.floor(this.score + (victory ? 20000 + p.hp * 20 : 0));
    const newBest = this.meta.recordRun({ time: t, kills: this.kills, score, victory, bosses: this.bossKills });
    const mm = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const rows = [
      ['TIME SURVIVED', mm(t)],
      ['LEVEL', String(this.progression.level)],
      ['DRONES DESTROYED', this.kills.toLocaleString('en-US')],
      ['BEST COMBO', `×${this.bestCombo}`],
      ['BOSSES', String(this.bossKills)],
      ['ELITES', String(this.elites)],
      ['PERFECT DODGES', String(this.dodges)],
      ['DEFLECTS', String(this.deflects)],
    ];
    const rank = score >= 60000 ? 'S' : score >= 35000 ? 'A' : score >= 18000 ? 'B' : 'C';
    this.ui.setHud(false);
    this.ui.showEnd(victory ? 'victory' : 'gameover', {
      rows, score, rank, earned, newBest, total: this.meta.shards,
      build: this.progression.slots(),
      reason: victory ? 'The package was you. You arrived.' : t < RUN_LENGTH ? `The Ring fell silent at ${mm(t)}.` : 'The endless city claimed you.',
      endless: victory && !this.waves.endless,
    });
    this.audio.setIntensity(0);
  }
}

const _menuFocus = new THREE.Vector3(0, 0, -10);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}
