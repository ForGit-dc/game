import * as THREE from 'three';
import { CollisionWorld } from '../physics/Collision.js';
import { Materials, shared } from '../world/Materials.js';
import { Sky } from '../world/Sky.js';
import { Skyline, Traffic, Searchlights, HoloWhale, CityCore } from '../world/Skyline.js';
import { Rain, Dust, Debris } from '../world/Weather.js';
import { Level } from '../world/Level.js';
import { Particles } from '../fx/Particles.js';
import { Effects } from '../fx/Effects.js';
import { PostFX } from '../fx/PostFX.js';
import { Player } from '../player/Player.js';
import { CameraRig } from './CameraRig.js';
import { Input } from './Input.js';
import { Projectiles } from '../combat/LegacyProjectiles.js'; // legacy exploration build — replaced by the survivor rewrite
import { EnemyManager } from '../enemies/Enemies.js';
import { Echoes } from '../systems/Echoes.js';
import { Pickups } from '../systems/Pickups.js';
import { Director, REQUIRED_ECHOES } from '../systems/Director.js';
import { rollAugments, applyAugment } from '../systems/Upgrades.js';
import { AudioEngine } from '../audio/Audio.js';
import { UI } from '../ui/UI.js';
import { clamp, damp, rand } from '../utils/math.js';

const SPAWN = new THREE.Vector3(0, 0, 4);
const FOG = 0x0f0820;

export class Game {
  constructor(canvas, { debug = false, lowQuality = false } = {}) {
    this.canvas = canvas;
    this.debug = debug;
    this.lowQuality = lowQuality;
    this.state = 'boot';
    this.time = 0;
    this.score = 0;
    this.kills = 0;
    this.timers = [];
    this.hitstop = 0;
    this.worldScale = 1;
    this.playerScale = 1;
    this.dodgeSlow = 0;
    this.post = { damage: 0, glitch: 0, overclock: 0, radial: 0, white: 0, fade: 0 };
    this.frame = 0;
    this.aimCache = null;
    this.best = 0;
    try {
      this.best = parseInt(localStorage.getItem('neon-echo-best') || '0', 10) || 0;
    } catch {
      this.best = 0;
    }
  }

  // ================================================================== setup

  async init(progress = () => {}) {
    const canvas = this.canvas;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    this.maxPixelRatio = this.lowQuality ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.25);
    this.pixelRatio = this.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !this.lowQuality;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.FogExp2(FOG, 0.0115);
    shared.fogDensity.value = 0.0115;
    const camera = (this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 3000));
    camera.position.set(0, 8, 30);

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
    this.core = new CityCore(scene);

    progress('Assembling districts…');
    await tick();
    this.level = new Level(scene, this.collision, this.mats);
    this.rain = new Rain(scene);
    this.dust = new Dust(scene);
    this.debris = new Debris(scene, this.mats);

    // lighting
    const hemi = new THREE.HemisphereLight(0x6a4ab0, 0x0a0418, 0.9);
    scene.add(hemi);
    const moon = (this.moon = new THREE.DirectionalLight(0xa9b8ff, 1.3));
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 140;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.03;
    scene.add(moon, moon.target);

    progress('Booting systems…');
    await tick();
    this.particles = new Particles(scene);
    this.fx = new Effects(scene, this.particles);
    this.input = new Input(canvas);
    this.input.allowUnlocked = this.debug;
    this.rig = new CameraRig(camera, this.collision);
    this.audio = new AudioEngine();
    this.player = new Player(this);
    this.projectiles = new Projectiles(this);
    this.enemies = new EnemyManager(this);
    this.echoes = new Echoes(this, this.level.echoSpots);
    this.pickups = new Pickups(this);
    this.director = new Director(this);
    this.ui = new UI(this);
    this.ui.initMarkers(this.echoes, this.level.skyport);
    this.ui.setEchoPips(this.echoes.items.length, REQUIRED_ECHOES, 0);
    this.ui.setBest(this.best);
    this.postfx = new PostFX(renderer, scene, camera, { samples: this.lowQuality || this.maxPixelRatio > 1.1 ? 0 : 4 });
    this.onResize();
    window.addEventListener('resize', () => this.onResize());

    await this.input.loadLayout();
    this.ui.setKeyLabels(this.input);

    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKey = (code) => this.onKey(code);
    canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
    });

    // warm up shaders so the first frame of play doesn't hitch
    progress('Warming shaders…');
    await tick();
    this.player.model.group.visible = false;
    this.player.scarf.setVisible(false);
    renderer.compile(scene, camera);
    this.state = 'menu-idle';
    this.last = performance.now();
    renderer.setAnimationLoop(() => this.loop());
  }

  buildEnvironment() {
    // A tiny neon room baked into a PMREM so metal surfaces reflect magenta/cyan light.
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
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();
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

  setSensitivity(v) {
    this.rig.sens = v;
  }

  keyHint(...codes) {
    return codes.map((c) => `<kbd>${this.input.label(c)}</kbd>`).join('');
  }

  // ================================================================== flow

  /** First user gesture: start audio and reveal the menu. */
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
    this.input.exitLock();
    this.audio.setIntensity(-1);
    this.audio.setDark(false);
    this.audio.setMuffle(0);
    this.resetWorld();
    this.player.model.group.visible = false;
    this.player.scarf.setVisible(false);
    this.rig.cinematic = { pos: new THREE.Vector3(), look: new THREE.Vector3(), lambda: 2 };
    this.menuT = 0;
  }

  onMenuAction(action) {
    switch (action) {
      case 'play':
        this.startRun();
        break;
      case 'controls':
      case 'credits':
        this.ui.panel(action);
        break;
      case 'back':
        this.ui.panel(null);
        break;
      case 'resume':
        this.resume();
        break;
      case 'restart':
        this.startRun();
        break;
      case 'quit':
        this.enterMenu();
        break;
    }
  }

  resetWorld() {
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.particles.clear();
    this.fx.clear();
    this.level.reset();
    this.echoes.reset();
    this.director.reset();
    this.collision.clearDeltas();
    this.timers.length = 0;
    this.score = 0;
    this.kills = 0;
    this.runTime = 0;
    this.damageTaken = 0;
    this.dodges = 0;
    this.deflects = 0;
    this.hitstop = 0;
    this.dodgeSlow = 0;
    this.deathReason = null;
    this.pendingAugment = null;
    this.worldScale = 1;
    this.playerScale = 1;
    for (const k in this.post) this.post[k] = 0;
    this.core.setAwake(0.15);
    this.level.uplinkBeam.material.uniforms.uStrength.value = 0;
    this.ui.setEchoPips(this.echoes.items.length, REQUIRED_ECHOES, 0);
  }

  startRun() {
    this.audio.init();
    this.resetWorld();
    this.player.reset(SPAWN, 0);
    this.player.model.group.visible = true;
    this.player.scarf.setVisible(true);
    // initial patrols
    for (const p of this.level.patrols) this.enemies.spawn(p.type, p.pos, { warp: false });
    this.ui.hideAll();
    this.ui.setHud(true);
    this.ui.el.log.innerHTML = '';
    this.ui.logLines = [];
    this.ui.cache = {};
    this.audio.setIntensity(0);
    this.audio.setDark(false);
    this.audio.setMuffle(0);
    this.rig.yaw = 0;
    this.rig.pitch = -0.08;
    this.rig.cinematic = null;
    this.rig.snapTo(this.player.pos, 0);
    // intro: start in front of the courier's face, swing behind
    this.state = 'intro';
    this.introT = 0;
    this.post.fade = 1;
    this.post.glitch = 1;
    this.rig.cinematic = {
      pos: new THREE.Vector3(SPAWN.x + 0.6, SPAWN.y + 1.7, SPAWN.z - 2.6),
      look: new THREE.Vector3(SPAWN.x, SPAWN.y + 1.5, SPAWN.z),
      lambda: 50,
    };
    this.camera.position.copy(this.rig.cinematic.pos);
    this.input.requestLock();
    this.audio.glitch();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.show('pause');
    this.audio.setMuffle(0.85, 1);
    this.input.exitLock();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.hideAll();
    this.state = 'playing';
    this.audio.setMuffle(this.player.overclockT > 0 ? 0.35 : 0);
    this.input.requestLock();
  }

  onLockChange(locked) {
    this.ui.el.lockHint.classList.toggle('hidden', locked || this.state !== 'playing' || this.debug);
    if (!locked && this.state === 'playing' && !this.debug) this.pause();
  }

  onKey(code) {
    if (code === 'KeyP' || (code === 'Escape' && this.debug)) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if (code === 'Escape' && this.state === 'paused' && !this.input.locked) {
      // Escape while paused (lock already released) resumes
    }
  }

  schedule(delay, fn) {
    this.timers.push({ t: delay, fn });
  }

  // ================================================================== main loop

  loop() {
    const now = performance.now();
    const rawDt = this._fixedDt ?? Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frame++;
    this.aimCache = null;
    this.perf(rawDt);

    // hitstop freezes gameplay for a few frames on big hits
    let dt = rawDt;
    if (this.hitstop > 0) {
      this.hitstop -= rawDt;
      dt = rawDt * 0.04;
    }

    // time scales (overclock / perfect-dodge slow motion)
    const p = this.player;
    let wTarget = 1, pTarget = 1;
    if (p.overclockT > 0) { wTarget = 0.28; pTarget = 0.92; }
    if (this.dodgeSlow > 0) {
      this.dodgeSlow -= rawDt;
      wTarget = Math.min(wTarget, 0.3);
      pTarget = Math.min(pTarget, 0.75);
    }
    if (this.state === 'dead') { wTarget = 0.25; pTarget = 0.25; }
    this.worldScale += (wTarget - this.worldScale) * damp(10, rawDt);
    this.playerScale += (pTarget - this.playerScale) * damp(10, rawDt);

    this.time += rawDt;
    const frozen = this.state === 'paused' || this.state === 'augment';
    shared.time.value += rawDt * (frozen ? 0.15 : 0.35 + 0.65 * this.worldScale);

    const st = this.state;
    if (st === 'menu' || st === 'menu-idle') this.updateMenu(rawDt);
    else if (st === 'intro') this.updateIntro(rawDt);
    else if (st === 'playing') this.updatePlaying(dt);
    else if (st === 'augment') this.updateAugment(rawDt);
    else if (st === 'dead') this.updateDead(rawDt);
    else if (st === 'victory') this.updateVictory(rawDt);

    // ambient world animation (keeps going in menus)
    const t = shared.time.value;
    const wdt = frozen ? 0 : dt * this.worldScale;
    this.traffic.update(t);
    this.searchlights.update(t);
    this.whale.update(t);
    this.debris.update(t);
    this.core.update(rawDt, t, st === 'menu' || st === 'menu-idle' ? this.camera.position : p.pos, this.camera);
    this.sky.update(frozen ? 0 : rawDt, this.camera);
    this.rain.update(frozen ? 0 : rawDt, this.camera.position, this.worldScale);
    this.particles.update(wdt);
    this.fx.update(frozen ? 0 : dt * Math.max(this.worldScale, 0.5), this.camera);
    if (st === 'menu' || st === 'menu-idle') {
      this.collision.clearDeltas();
      const events = [];
      this.level.update(rawDt, t, events);
    }

    // shadows follow the player
    const focus = st === 'menu' || st === 'menu-idle' ? _menuFocus : p.pos;
    this.moon.position.set(focus.x - 22, focus.y + 45, focus.z + 18);
    this.moon.target.position.copy(focus);

    // audio listener + music intensity
    if (this.audio.ready) {
      this.audio.setListener(this.camera.position, this.rig.right);
      this.audio.setIntensity(this.musicIntensity());
    }

    // post
    const P = this.post;
    P.damage = Math.max(0, P.damage - rawDt * 2.2);
    P.glitch = Math.max(0, P.glitch - rawDt * 1.4);
    P.radial = Math.max(0, P.radial - rawDt * 4);
    P.overclock += ((p.overclockT > 0 && st === 'playing' ? 1 : 0) - P.overclock) * damp(6, rawDt);
    const U = this.postfx.u;
    U.uDamage.value = P.damage;
    U.uGlitch.value = P.glitch;
    U.uOverclock.value = P.overclock;
    U.uRadial.value = P.radial;
    U.uWhite.value = P.white;
    U.uFade.value = P.fade;
    U.uAlarm.value = shared.alarm.value * (st === 'playing' ? 1 : 0.4);
    U.uLowHealth.value = st === 'playing' && p.hp / p.stats.maxHp < 0.3 ? 1 : 0;

    this.ui.updateWorld(rawDt, this.camera, this.w, this.h);
    if (!this._noRender) this.postfx.render(rawDt);
    this.input.endFrame();
  }

  /** Debug/automation: advance the simulation deterministically (used by headless tests). */
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
    const a = this.menuT * 0.035 + 0.6;
    const c = this.rig.cinematic || (this.rig.cinematic = { pos: new THREE.Vector3(), look: new THREE.Vector3(), lambda: 2 });
    c.pos.set(Math.sin(a) * 34, 9 + Math.sin(this.menuT * 0.12) * 2.5, Math.cos(a) * 34 - 6);
    c.look.set(Math.sin(a + 2.6) * 12, 12, -30 + Math.cos(a) * 6);
    c.lambda = 1.5;
    if (!this._menuInit) {
      this._menuInit = true;
      this.camera.position.copy(c.pos);
      this.rig._look.copy(c.look);
    }
    this.rig.update(dt, _menuFocus);
  }

  updateIntro(dt) {
    this.introT += dt;
    const k = this.introT;
    const p = this.player;
    p.update(dt, this.input, this.rig, false);
    this.collision.clearDeltas();
    this.level.update(dt, shared.time.value, []);
    this.post.fade = Math.max(0, 1 - k / 1.2);
    if (k < 0.8) this.post.glitch = Math.max(this.post.glitch, 0.6 * (1 - k / 0.8));
    // swing from the face to over-the-shoulder
    const c = this.rig.cinematic;
    const s = Math.min(1, Math.max(0, (k - 1.1) / 1.6));
    const e = s * s * (3 - 2 * s);
    const ang = Math.PI * e;
    const R = 2.6 + e * 2.9;
    c.pos.set(SPAWN.x + Math.sin(ang) * 1.2 + e * this.rig.shoulder, SPAWN.y + 1.7 + e * 0.1, SPAWN.z - Math.cos(ang) * R + (e > 0.99 ? 0 : 0));
    c.look.set(SPAWN.x + e * this.rig.shoulder, SPAWN.y + 1.5 + e * 0.1, SPAWN.z - e * 8);
    c.lambda = 8;
    this.rig.update(dt, p.pos);
    this.director.update(dt);
    if (k > 2.9) {
      this.state = 'playing';
      this.rig.cinematic = null;
      this.rig.pivot.set(p.pos.x, p.pos.y + 1.55, p.pos.z);
      this.rig.curDist = this.camera.position.distanceTo(this.rig.pivot);
      this.input.requestLock();
      this.onLockChange(this.input.locked);
    }
  }

  updatePlaying(dt) {
    const input = this.input;
    const p = this.player;
    const m = input.consumeMouse();
    this.rig.applyMouse(m.dx, m.dy);
    this.runTime += dt;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }

    const wdt = dt * this.worldScale;
    const pdt = dt * this.playerScale;
    this.collision.clearDeltas();
    const events = [];
    this.level.update(wdt, shared.time.value, events);
    for (const ev of events) this.onLevelEvent(ev);

    p.update(pdt, input, this.rig, true);
    this.enemies.update(wdt);
    this.projectiles.update(dt, this.worldScale, this.playerScale);
    this.echoes.update(pdt, p);
    this.pickups.update(pdt);
    this.director.update(pdt);

    // pending augment choice
    if (this.pendingAugment !== undefined && this.pendingAugment !== null) {
      this.pendingAugment -= dt;
      if (this.pendingAugment <= 0 && this.state === 'playing') {
        this.pendingAugment = null;
        this.openAugments();
      }
    }

    const speed = Math.hypot(p.vel.x, p.vel.z);
    const fov = (p.sprinting ? 5 : 0) + (p.dashT > 0 ? 9 : 0) + (p.launched ? 6 : 0) - this.post.overclock * 6 + Math.min(4, speed * 0.15);
    this.rig.update(dt, p.pos, { speedFov: fov, extraDist: p.launched ? 1.2 : 0 });
    this.ui.update(dt);
    if (this.state === 'playing' && !input.locked && !this.debug) this.ui.el.lockHint.classList.remove('hidden');
  }

  updateAugment(dt) {
    const m = this.input.consumeMouse();
    this.ui.augmentInput(this.input, m.dx);
    this.rig.update(0, this.player.pos);
  }

  updateDead(dt) {
    this.deadT += dt;
    const wdt = dt * this.worldScale;
    this.collision.clearDeltas();
    this.level.update(wdt, shared.time.value, []);
    this.enemies.update(wdt);
    this.projectiles.update(dt, this.worldScale, this.worldScale);
    const c = this.rig.cinematic;
    c.pos.lerp(_tmp.copy(this.deathPos).add(_tmp2.set(6, 7, 6)), damp(0.8, dt));
    c.look.lerp(this.deathPos, damp(2, dt));
    this.rig.update(dt, this.player.pos);
    this.post.glitch = Math.max(this.post.glitch, 0.25);
    if (this.deadT > 2.6 && !this.endShown) {
      this.endShown = true;
      this.showEnd('gameover');
    }
  }

  updateVictory(dt) {
    this.vicT += dt;
    const k = this.vicT;
    const p = this.player;
    const sp = this.level.skyport.center;
    this.collision.clearDeltas();
    this.level.update(dt, shared.time.value, []);
    this.enemies.update(dt);
    // courier rises into the beam
    p.pos.lerp(_tmp.set(sp.x, sp.y + 2 + k * k * 1.8, sp.z), damp(1.2, dt));
    p.model.group.position.copy(p.pos);
    p.model.group.rotation.y += dt * (0.5 + k);
    p.model.update(dt, { speed: 0, grounded: false, vy: 4, dash: false, aiming: false, aimPitch: 0, turn: 0 });
    p.model.chest.localToWorld(p._anchor.set(0, 0.43, -0.13));
    p.scarf.update(dt, p._anchor, _tmp2.set(0, -2, 0), this.time);
    const beam = this.level.uplinkBeam.material.uniforms.uStrength;
    beam.value = Math.min(3, 0.6 + k * 0.7);
    if (Math.random() < 0.8) this.particles.burst(_tmp.set(sp.x + rand(-4, 4), sp.y + rand(0, 3), sp.z + rand(-4, 4)), { count: 2, color: '#ffd36b', speed: [1, 3], life: [1, 2], up: 6, drag: 0.5, size: [0.1, 0.25] });
    const c = this.rig.cinematic;
    c.pos.set(sp.x + Math.sin(k * 0.25) * (14 + k * 2), sp.y + 3 + k * 2.5, sp.z + Math.cos(k * 0.25) * (14 + k * 2));
    c.look.set(sp.x, sp.y + 2 + k * 3, sp.z);
    c.lambda = 1.5;
    this.rig.update(dt, p.pos);
    if (k > 3.2) this.post.white = Math.min(1, (k - 3.2) / 1.2);
    if (k > 4.4 && !this.endShown) {
      this.endShown = true;
      p.model.group.visible = false;
      p.scarf.setVisible(false);
      this.post.white = 0;
      this.showEnd('victory');
      this.ui.fade(0);
    }
  }

  perf(dt) {
    // simple dynamic resolution: drop pixel ratio if we can't hold ~50fps
    this.perfAcc = (this.perfAcc || 0) + dt;
    this.perfN = (this.perfN || 0) + 1;
    if (this.perfAcc > 2.5) {
      const avg = this.perfAcc / this.perfN;
      this.perfAcc = 0;
      this.perfN = 0;
      if (this.state === 'boot' || this.debug) return;
      if (avg > 0.021 && this.pixelRatio > 0.7) {
        this.pixelRatio = Math.max(0.7, this.pixelRatio - 0.15);
        this.onResize();
      } else if (avg < 0.0135 && this.pixelRatio < this.maxPixelRatio) {
        this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
        this.onResize();
      }
    }
  }

  musicIntensity() {
    const st = this.state;
    if (st === 'menu' || st === 'menu-idle' || st === 'boot') return -1;
    if (st === 'victory' || st === 'dead') return 0;
    const d = this.director;
    if (d.phase === 'collapse' || d.phase === 'uplink') return 3;
    if (this.enemies.awareCount(35, this.player.pos) > 0) return 2;
    return d.echoes >= 1 ? 1 : 0;
  }

  // ================================================================== aim

  getAim() {
    if (this.aimCache && this.aimCache.frame === this.frame) return this.aimCache;
    const cam = this.camera;
    const origin = _aimO.copy(cam.position);
    const dir = _aimD.copy(this.rig.forward);
    const skip = this.rig.curDist + 0.4;
    const start = _aimS.copy(origin).addScaledVector(dir, skip);
    const wall = this.collision.raycast(start, dir, 220);
    const maxD = wall === Infinity ? 220 : wall;
    let best = null;
    let bestScore = -Infinity;
    for (const e of this.enemies.list) {
      if (!e.alive || e.warp > 0) continue;
      _tmp.subVectors(e.pos, origin);
      const d = _tmp.length();
      if (d > 75 || d < skip) continue;
      const cos = _tmp.dot(dir) / d;
      const cone = Math.cos(THREE.MathUtils.degToRad(2.5 + 6 * (1 - d / 75)) + Math.atan(e.radius / d));
      if (cos < cone) continue;
      if (d - e.radius > maxD + 1) continue;
      const score = cos * 10 - d * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    const point = best ? best.pos.clone() : start.clone().addScaledVector(dir, maxD);
    this.aimCache = { frame: this.frame, point, target: best };
    return this.aimCache;
  }

  // ================================================================== combat events

  firePlayerShot(muzzle, aim) {
    const p = this.player;
    const s = p.stats;
    const target = aim ? aim.point : _tmp.copy(this.camera.position).addScaledVector(this.rig.forward, 60);
    const dir = _tmp2.subVectors(target, muzzle).normalize();
    const crit = Math.random() < 0.12;
    this.projectiles.firePlayer(muzzle, dir, { damage: s.damage * (crit ? 2 : 1), crit });
    for (let k = 1; k <= s.split; k++) {
      for (const sgn of [-1, 1]) {
        const d = dir.clone().applyAxisAngle(_up, sgn * 0.07 * k);
        this.projectiles.firePlayer(muzzle, d, { damage: s.damage * 0.6, color: '#b69cff' });
      }
    }
    this.fx.muzzleFlash(muzzle);
    this.particles.burst(muzzle, { count: 4, color: '#7ff6ff', speed: [2, 6], life: [0.05, 0.15], size: [0.05, 0.1], dir, spread: 0.5 });
    this.audio.shoot();
    this.rig.addTrauma(0.03);
    this.ui.kickCrosshair(5);
  }

  damageEnemy(e, dmg, dir, force, { crit = false, point = null, big = false } = {}) {
    if (!e.alive) return false;
    const killed = e.hit(dmg, dir, force);
    const at = point || e.pos;
    this.ui.number(at, String(Math.round(dmg)), big ? 'big' : crit ? 'crit' : '');
    this.player.addSync(dmg * 0.45);
    this.audio.hit(at, crit);
    this.ui.hitmarker(killed);
    if (killed) this.onEnemyKilled(e);
    return killed;
  }

  onEnemyKilled(e) {
    this.kills++;
    this.score += e.def.score;
    this.player.addSync(10);
    if (this.player.stats.leech > 0) {
      this.player.heal(this.player.stats.leech);
      this.ui.number(this.player.center, `+${this.player.stats.leech}`, 'heal');
    }
    const r = Math.random();
    const drops = e.type === 'warden' ? 6 : e.type === 'guardian' ? 2 : 1;
    for (let i = 0; i < drops; i++) {
      if (r < 0.35 || e.type !== 'scout') this.pickups.drop(e.pos, Math.random() < 0.5 ? 'hp' : 'energy');
      else if (r < 0.75) this.pickups.drop(e.pos, 'energy');
    }
    this.hitstop = Math.max(this.hitstop, e.type === 'scout' ? 0.04 : 0.07);
    if (e.type === 'warden') {
      this.ui.banner('THREAT NEUTRALIZED', 'WARDEN DESTROYED', '', 'gold');
      this.dodgeSlow = 0.8;
    }
  }

  onEnemyExploded(e) {
    const big = e.type === 'warden' ? 3 : e.type === 'guardian' ? 1.6 : 1;
    const col = e.type === 'scout' ? '#ff2a55' : e.type === 'guardian' ? '#ff8a2b' : '#ff2a55';
    this.particles.burst(e.pos, { count: Math.floor(40 * big), color: '#fff2d8', colorEnd: col, speed: [4, 16 * Math.sqrt(big)], life: [0.25, 0.7], size: [0.08, 0.2], drag: 3 });
    this.particles.burst(e.pos, { count: Math.floor(18 * big), color: col, speed: [2, 8], life: [0.6, 1.4], size: [0.15, 0.35], gravity: 12, drag: 0.6 });
    this.particles.burst(e.pos, { count: Math.floor(10 * big), color: '#ffd36b', speed: [0.5, 2], life: [0.4, 0.9], size: [0.5 * big, 1.1 * big], sizeEnd: 1.8, drag: 2, intensity: 1.2 });
    this.fx.ring(e.pos, col, 3 * big, 0.45);
    this.fx.ring(e.pos, '#ffffff', 2 * big, 0.3, this.camera.position);
    this.fx.flash(e.pos, col, 90 * big, 0.3);
    this.audio.explosion(e.pos, big);
    const d = e.pos.distanceTo(this.player.pos);
    this.rig.addTrauma(Math.max(0, 0.35 * big * (1 - d / 30)));
  }

  onBoltHitEnemy(b, e, point, dir) {
    this.particles.burst(point, { count: 8, color: b.crit ? '#ffd36b' : '#7ff6ff', speed: [3, 10], life: [0.1, 0.3], size: [0.05, 0.12], dir: dir.clone().negate(), spread: 0.8 });
    this.damageEnemy(e, b.damage, dir, 3, { crit: b.crit, point });
  }

  onBoltHitWall(point, normal, b) {
    this.particles.burst(point, { count: 6, color: b.color, speed: [2, 7], life: [0.1, 0.35], size: [0.04, 0.1], dir: normal, spread: 0.9, gravity: 8 });
  }

  onReflectHit(o, e, point) {
    this.particles.burst(point, { count: 30, color: '#ff5ae0', speed: [4, 12], life: [0.2, 0.5] });
    this.fx.ring(point, '#ff5ae0', 3, 0.3, this.camera.position);
    this.damageEnemy(e, o.damage, o.v.clone().normalize(), 8, { point, big: true });
    this.hitstop = Math.max(this.hitstop, 0.05);
  }

  onOrbHitWall(point, o) {
    this.particles.burst(point, { count: 14, color: o.reflected ? '#ff5ae0' : '#ff8a2b', speed: [2, 7], life: [0.15, 0.4] });
  }

  onBladeStart(p) {
    // soft lock-on: lunge toward the drone you're looking at
    const fwd = this.rig.forward;
    let target = null;
    let best = Infinity;
    for (const e of this.enemies.list) {
      if (!e.alive || e.warp > 0) continue;
      _tmp.subVectors(e.pos, p.pos).setY(e.pos.y - p.pos.y - 1.1);
      const d = _tmp.length();
      if (d > 8.5 || d < 0.5) continue;
      const cos = (_tmp.x * fwd.x + _tmp.z * fwd.z) / (Math.hypot(_tmp.x, _tmp.z) || 1);
      if (cos < 0.45) continue;
      if (d < best) {
        best = d;
        target = e;
      }
    }
    if (target) {
      const dir = _tmp.subVectors(target.pos, _tmp2.set(p.pos.x, p.pos.y + 1.1, p.pos.z));
      const dist = dir.length();
      dir.normalize();
      if (dist > 2.2) p.lunge(dir, Math.min(24, (dist - 1.6) / 0.13), 0.13);
      else p.facing = Math.atan2(dir.x, dir.z);
    } else {
      p.facing = Math.atan2(fwd.x, fwd.z);
    }
    this.audio.blade();
    this.ui.pulseAbility('blade');
  }

  resolveBlade(p) {
    const s = p.stats;
    const fwd = _tmp3.set(Math.sin(p.facing), 0, Math.cos(p.facing));
    const origin = _tmp4.set(p.pos.x, p.pos.y + 1.1, p.pos.z);
    this.fx.arc(origin, p.facing, p.model.slashSide, '#ff5ae0', s.bladeRange / 3.3);
    let hits = 0;
    for (const e of this.enemies.list) {
      if (!e.alive || e.warp > 0) continue;
      _tmp.subVectors(e.pos, origin);
      const d = _tmp.length();
      if (d > s.bladeRange + e.radius) continue;
      const flat = Math.hypot(_tmp.x, _tmp.z) || 1;
      const cos = (_tmp.x * fwd.x + _tmp.z * fwd.z) / flat;
      if (cos < 0.2 && d > 1.2 + e.radius) continue;
      const dir = _tmp.clone().normalize();
      e.interrupt();
      this.damageEnemy(e, s.bladeDamage, dir, 16, { point: e.pos, crit: true });
      this.particles.burst(e.pos, { count: 22, color: '#ff5ae0', colorEnd: '#ffffff', speed: [5, 14], life: [0.15, 0.4], size: [0.06, 0.14], dir, spread: 0.6 });
      hits++;
    }
    const aim = this.getAim();
    const deflected = this.projectiles.deflect(origin, fwd, s.bladeRange + 0.8, aim.point);
    if (hits) {
      this.hitstop = Math.max(this.hitstop, 0.075);
      this.rig.addTrauma(0.22);
      this.audio.bladeHit(origin);
    }
    if (deflected) {
      this.deflects += deflected;
      this.hitstop = Math.max(this.hitstop, 0.06);
      this.audio.deflect(origin);
      this.ui.number(origin, deflected > 1 ? `DEFLECT ×${deflected}` : 'DEFLECT', 'big');
      p.addSync(8 * deflected);
      this.rig.addTrauma(0.15);
    }
  }

  phaseStrike(p) {
    for (const e of this.enemies.list) {
      if (!e.alive || p.dashHit.has(e)) continue;
      if (e.pos.distanceTo(_tmp.set(p.pos.x, p.pos.y + 1, p.pos.z)) < e.radius + 1.4) {
        p.dashHit.add(e);
        this.damageEnemy(e, 35, _tmp2.copy(p.dashDir), 6, { crit: true });
      }
    }
  }

  onEnemyAlert(e) {
    this.audio.enemyAlert(e.pos);
  }

  onEnemyWarp(e) {
    this.audio.warp(e.pos);
    this.fx.ring(e.pos, '#ff2a55', 3, 0.6, this.camera.position);
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      const r = 3;
      const x = Math.cos(a) * Math.cos(b) * r, y = Math.sin(b) * r, z = Math.sin(a) * Math.cos(b) * r;
      this.particles.spawn(e.pos.x + x, e.pos.y + y, e.pos.z + z, -x * 3.2, -y * 3.2, -z * 3.2, 0.3, 0.18, 0.05, _c.set('#ff2a55').multiplyScalar(3), _c2.set('#ffffff'), 0, 0);
    }
  }

  // ================================================================== player events

  onPlayerDash(p) {
    this.audio.dash();
    this.rig.fovKick += 6;
    this.post.radial = 1;
    this.particles.burst(_tmp.set(p.pos.x, p.pos.y + 0.3, p.pos.z), { count: 14, color: '#22e6ff', speed: [2, 6], life: [0.2, 0.45], size: [0.08, 0.16], dir: _tmp2.copy(p.dashDir).negate(), spread: 0.7 });
    this.ui.pulseAbility('dash');
  }

  onPlayerJump(p, double) {
    this.audio.jump(double);
    if (double) {
      this.fx.ring(_tmp.set(p.pos.x, p.pos.y + 0.1, p.pos.z), '#22e6ff', 1.6, 0.3);
      this.particles.burst(p.pos, { count: 12, color: '#22e6ff', speed: [2, 5], life: [0.2, 0.4], size: [0.06, 0.12], dir: _tmp2.set(0, -1, 0), spread: 1 });
    }
  }

  onPlayerLand(p, impact) {
    this.audio.land(impact);
    if (impact > 14) {
      this.fx.ring(_tmp.set(p.pos.x, p.pos.y + 0.05, p.pos.z), '#9fb4ff', 1.2 + impact * 0.05, 0.35);
      this.rig.addTrauma(Math.min(0.25, impact * 0.007));
    }
  }

  onPadLaunch(pad) {
    this.audio.pad();
    this.fx.ring(_tmp.copy(pad.pos).setY(pad.pos.y + 0.1), pad.color, 3, 0.45);
    this.particles.burst(pad.pos, { count: 30, color: pad.color, speed: [3, 9], life: [0.3, 0.8], dir: _up, spread: 0.4, size: [0.08, 0.18] });
    this.rig.fovKick += 8;
    this.post.radial = 0.8;
    if (pad === this.level.skylift) this.ui.log('SKYLIFT ENGAGED — HOLD ON.', 'gold');
  }

  onLockedPad(pad) {
    this.audio.denied();
    this.ui.log(`SKYLIFT OFFLINE — RECOVER ${REQUIRED_ECHOES} ECHOES (${this.director.echoes}/${REQUIRED_ECHOES})`, 'warn');
  }

  onOutOfEnergy() {
    this.audio.outOfEnergy();
  }

  onOverclock(on) {
    const p = this.player;
    this.audio.overclock(on);
    if (on) {
      this.audio.setMuffle(0.35, 0.05);
      this.fx.ring(_tmp.set(p.pos.x, p.pos.y + 1, p.pos.z), '#ffd36b', 14, 0.7);
      this.fx.ring(_tmp.set(p.pos.x, p.pos.y + 1, p.pos.z), '#ffffff', 8, 0.4, this.camera.position);
      this.rig.addTrauma(0.3);
      this.post.radial = 1;
      this.ui.number(p.center, 'OVERCLOCK', 'big');
      this.ui.pulseAbility('over');
    } else {
      this.audio.setMuffle(0);
    }
  }

  onOverclockNotReady() {
    this.audio.denied();
  }

  onSyncReady() {
    this.audio.syncReady();
    if (!this._syncHinted) {
      this._syncHinted = true;
      this.ui.prompt(`${this.keyHint('KeyQ')} OVERCLOCK READY — BEND TIME`, 5);
    }
    this.ui.log('SYNC 100% — OVERCLOCK READY', 'gold');
  }

  onPerfectDodge(from) {
    const p = this.player;
    if (this._lastDodge && this.time - this._lastDodge < 0.4) return;
    this._lastDodge = this.time;
    this.dodges++;
    this.dodgeSlow = 0.55;
    p.addSync(15);
    this.audio.perfectDodge();
    this.ui.number(p.center, 'PERFECT DODGE', 'big');
    this.fx.ring(_tmp.set(p.pos.x, p.pos.y + 1, p.pos.z), '#22e6ff', 4, 0.4, this.camera.position);
  }

  onPlayerHurt(amount, from) {
    this.damageTaken += amount;
    this.audio.hurt();
    this.post.damage = 1;
    this.post.glitch = Math.max(this.post.glitch, 0.25);
    this.rig.addTrauma(0.4);
    this.hitstop = Math.max(this.hitstop, 0.04);
    if (from) this.ui.damageDirection(from);
    this.ui.number(this.player.center, `-${Math.round(amount)}`, 'crit');
    const p = this.player;
    if (p.hp / p.stats.maxHp < 0.3 && !this._lowWarned) {
      this._lowWarned = true;
      this.ui.log('INTEGRITY CRITICAL — FIND REPAIR MOTES OR COOLANT', 'red');
    }
    if (p.hp / p.stats.maxHp > 0.5) this._lowWarned = false;
  }

  onPlayerDeath() {
    const p = this.player;
    this.state = 'dead';
    this.deadT = 0;
    this.endShown = false;
    this.deathReason = this.deathReason || 'Integrity reached zero.';
    this.deathPos = p.pos.clone().setY(p.pos.y + 1);
    p.model.group.visible = false;
    p.scarf.setVisible(false);
    this.particles.burst(this.deathPos, { count: 120, color: '#7ff6ff', colorEnd: '#ff2bd6', speed: [2, 12], life: [0.6, 1.6], size: [0.08, 0.22], drag: 1.5, gravity: 3 });
    this.particles.burst(this.deathPos, { count: 30, color: '#ffffff', speed: [1, 4], life: [1, 2], size: [0.2, 0.4], drag: 1, up: 2 });
    this.fx.ring(this.deathPos, '#22e6ff', 6, 0.8, this.camera.position);
    this.fx.flash(this.deathPos, '#22e6ff', 120, 0.6);
    this.audio.death();
    this.post.glitch = 1;
    this.rig.addTrauma(0.6);
    this.rig.cinematic = { pos: this.camera.position.clone(), look: this.deathPos.clone(), lambda: 2 };
  }

  onPlayerFell(p) {
    // respawn at the last safe ground, or the nearest surviving anchor
    let pos = null;
    const safe = p.lastSafe;
    const collapsing = this.level.collapsibles.some((c) => c.state !== 'idle' && c.colliders.includes(safe.collider));
    if (safe.collider && safe.collider.enabled && !collapsing) pos = safe.pos.clone();
    if (!pos) {
      let bd = Infinity;
      for (const a of this.level.anchors) {
        if (a.skyport && this.level.skylift.locked) continue;
        const d = a.pos.distanceTo(p.pos);
        if (d < bd && this.collision.hasGroundBelow(a.pos.x, a.pos.y + 0.5, a.pos.z, 3)) {
          bd = d;
          pos = a.pos.clone();
        }
      }
    }
    if (!pos) pos = SPAWN.clone();
    p.pos.copy(pos).y += 0.2;
    p.vel.set(0, 0, 0);
    p.launched = false;
    p.dashT = 0;
    p.lungeT = 0;
    p.invuln = 0;
    this.post.glitch = 1;
    this.post.damage = 0.6;
    this.audio.glitch();
    this.rig.pivot.set(p.pos.x, p.pos.y + 1.55, p.pos.z);
    this.ui.log('SIGNAL RECOVERED — FRAME DAMAGED (-20)', 'warn');
    this.deathReason = 'You fell into the Abyss.';
    p.takeDamage(20, null, 'fall');
    if (!p.dead) {
      this.deathReason = null;
      p.invuln = 1.2;
    }
  }

  onPickup(kind, pos) {
    const p = this.player;
    this.audio.pickup(kind);
    if (kind === 'hp') {
      p.heal(12);
      this.ui.number(p.center, '+12', 'heal');
    } else {
      p.energy = Math.min(p.stats.maxEnergy, p.energy + 30);
    }
    this.particles.burst(pos, { count: 8, color: kind === 'hp' ? '#20ffa0' : '#9b7bff', speed: [1, 3], life: [0.2, 0.4] });
  }

  // ================================================================== progression events

  onEchoCollected(e) {
    const p = this.player;
    const pos = e.group.position.clone();
    this.audio.echoPickup();
    this.particles.burst(pos, { count: 90, color: '#ffffff', colorEnd: '#22e6ff', speed: [3, 14], life: [0.5, 1.4], size: [0.08, 0.2], drag: 2 });
    this.particles.burst(pos, { count: 40, color: '#a6fffb', speed: [0.5, 2], life: [1.5, 2.5], up: 5, drag: 0.8, size: [0.1, 0.2] });
    this.fx.ring(pos, '#a6fffb', 10, 0.8);
    this.fx.ring(pos, '#ffffff', 5, 0.5, this.camera.position);
    this.fx.flash(pos, '#a6fffb', 140, 0.8);
    this.rig.addTrauma(0.2);
    this.post.glitch = 0.5;
    this.score += 1000;
    const cont = this.director.onEcho(e);
    this.ui.setEchoPips(this.echoes.items.length, REQUIRED_ECHOES, this.director.echoes);
    this.ui.flashObjective();
    const n = this.director.echoes;
    if (cont !== false) this.ui.banner(`ECHO ${String(n).padStart(2, '0')} / ${String(this.echoes.items.length).padStart(2, '0')}`, 'ECHO RECOVERED', e.spot.district, '');
    this.pendingAugment = cont === false ? 5.5 : 0.9;
    this.pendingAugmentIdx = n;
    p.heal(15);
  }

  openAugments() {
    const opts = rollAugments(this.player, 3);
    if (!opts.length) return;
    this.state = 'augment';
    this.audio.setMuffle(0.6, 0.3);
    this.ui.showAugments(opts, this.pendingAugmentIdx || this.director.echoes, (aug) => {
      applyAugment(this.player, aug);
      this.ui.log(`AUGMENT INTEGRATED: ${aug.name}`, 'gold');
      this.state = 'playing';
      this.audio.setMuffle(this.player.overclockT > 0 ? 0.35 : 0);
      this.input.consumeMouse();
      if (!this.input.locked) this.input.requestLock();
    });
  }

  onCollapseStart() {
    this.audio.collapseStart();
    this.audio.setDark(true);
    this.post.glitch = 1.5;
    this.rig.addTrauma(0.7);
    this.ui.banner('ECHO 05', 'YOU WERE NOT SUPPOSED TO WAKE UP.', '', 'red');
    this.schedule(3.6, () => {
      this.ui.banner('CORE BREACH', 'THE CITY IS FALLING', `Reach Skyport 07 — the Skylift is online`, 'warn');
      this.rig.addTrauma(0.4);
    });
    this.updateObjective();
  }

  onUplinkStart() {
    this.audio.uplinkStart();
    this.level.uplinkBeam.material.uniforms.uStrength.value = 0.6;
    this.ui.log('UPLINK INITIATED — STAND IN THE LIGHT', 'gold');
    this.fx.ring(this.level.skyport.center, '#ffd36b', 12, 0.9);
    this.updateObjective();
  }

  onLevelEvent(ev) {
    const d = ev.pos.distanceTo(this.player.pos);
    if (ev.type === 'collapseWarn') {
      if (d < 60) this.audio.creak(ev.pos);
    } else if (ev.type === 'collapseFall') {
      this.audio.collapse(ev.pos);
      this.particles.burst(ev.pos, { count: 60, color: '#ff8a2b', speed: [2, 9], life: [0.5, 1.4], size: [0.15, 0.4], gravity: 6, drag: 1 });
      this.rig.addTrauma(Math.max(0, 0.5 * (1 - d / 50)));
      if (d < 40) this.ui.log('STRUCTURE LOST', 'red');
    }
  }

  updateObjective() {
    this.ui.flashObjective();
  }

  // ================================================================== endings

  gameOver(reason) {
    if (this.state !== 'playing') return;
    this.deathReason = reason;
    this.player.dead = true;
    this.onPlayerDeath();
  }

  victory() {
    if (this.state !== 'playing') return;
    this.state = 'victory';
    this.vicT = 0;
    this.endShown = false;
    this.victoryTime = this.runTime;
    this.audio.victory();
    this.ui.banner('UPLINK 100%', 'DELIVERY COMPLETE', 'The package was you.', 'gold');
    this.rig.cinematic = { pos: this.camera.position.clone(), look: this.player.pos.clone(), lambda: 1.5 };
    // the Core's drones die with the signal
    let k = 0;
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const en = e;
      setTimeout(() => {
        if (en.alive) {
          en.hit(99999, _up, 0);
          this.kills++;
          this.score += en.def.score;
        }
      }, 200 + k++ * 140);
    }
    this.projectiles.clear();
    this.post.glitch = 0.6;
  }

  showEnd(kind) {
    const p = this.player;
    const d = this.director;
    const mm = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const echoes = d.echoes;
    let timeBonus = 0, hpBonus = 0;
    if (kind === 'victory') {
      timeBonus = Math.floor(d.timeLeft * 25);
      hpBonus = Math.floor(p.hp * 10);
      this.score += timeBonus + hpBonus;
    }
    const score = Math.floor(this.score);
    const rank = score >= 15000 ? 'S' : score >= 11000 ? 'A' : score >= 7500 ? 'B' : 'C';
    const rows = [
      ['ECHOES', `${echoes} / ${this.echoes.items.length}`],
      ['DRONES', String(this.kills)],
      ['RUN TIME', mm(kind === 'victory' ? this.victoryTime : this.runTime)],
      ['PERFECT DODGES', String(this.dodges)],
      ['DEFLECTS', String(this.deflects)],
      ['DAMAGE TAKEN', String(Math.round(this.damageTaken))],
    ];
    if (kind === 'victory') rows.push(['TIME BONUS', `+${timeBonus}`], ['INTEGRITY BONUS', `+${hpBonus}`]);
    if (score > this.best) {
      this.best = score;
      try {
        localStorage.setItem('neon-echo-best', String(score));
      } catch {
        /* storage unavailable */
      }
      rows.push(['NEW RECORD', '★']);
    }
    this.ui.setBest(this.best);
    this.ui.setHud(false);
    this.ui.showEnd(kind, { rows, score, rank, reason: this.deathReason || 'Integrity reached zero.' });
    this.input.exitLock();
    this.audio.setIntensity(0);
  }
}

const _menuFocus = new THREE.Vector3(0, 0, -10);
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _tmp3 = new THREE.Vector3();
const _tmp4 = new THREE.Vector3();
const _aimO = new THREE.Vector3();
const _aimD = new THREE.Vector3();
const _aimS = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const _c2 = new THREE.Color();

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}
