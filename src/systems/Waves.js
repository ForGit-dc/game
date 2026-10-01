import { rand, pick } from '../utils/math.js';

/**
 * A run is three stages, each on its own themed Ring with its own drone mix, events and boss.
 * Killing the stage boss clears the stage; the build carries over. After stage 3: Endless.
 * Event and unlock times are relative to the start of the stage.
 */
export const STAGES = [
  {
    name: 'THE RING',
    sub: 'Where every pipeline starts',
    theme: 'ring',
    unlock: { wisp: 0, shard: 40, sentinel: 100 },
    events: [
      { t: 95, type: 'meteors', dur: 18, label: 'DATA DRIFT STORM' },
      { t: 200, type: 'boss', id: 'hive', label: 'THE HALLUCINATION' },
    ],
  },
  {
    name: 'THE DATA LAKE',
    sub: 'Everything leaks down here',
    theme: 'lake',
    unlock: { wisp: 0, shard: 0, sentinel: 0, splitter: 15, bomber: 55 },
    events: [
      { t: 60, type: 'blackout', dur: 20, label: 'GPU OUTAGE' },
      { t: 125, type: 'meteors', dur: 18, label: 'DATA DRIFT STORM' },
      { t: 155, type: 'collapse', ring: 2, label: 'OUTER RING COLLAPSE' },
      { t: 200, type: 'boss', id: 'lancer', label: 'OVERFIT' },
    ],
  },
  {
    name: 'THE CORE',
    sub: 'The model nobody can explain',
    theme: 'core',
    unlock: { wisp: 0, shard: 0, sentinel: 0, splitter: 0, bomber: 0, bulwark: 20 },
    events: [
      { t: 50, type: 'meteors', dur: 18, label: 'DATA DRIFT STORM' },
      { t: 105, type: 'blackout', dur: 20, label: 'GPU OUTAGE' },
      { t: 150, type: 'collapse', ring: 2, label: 'OUTER RING COLLAPSE' },
      { t: 200, type: 'boss', id: 'warden', label: 'THE BLACK BOX' },
    ],
  },
];

const ENDLESS = {
  name: 'ENDLESS',
  sub: 'Production never sleeps',
  theme: 'core',
  unlock: { wisp: 0, shard: 0, sentinel: 0, splitter: 0, bomber: 0, bulwark: 0 },
  events: [],
};

const BOSS_LABEL = { hive: 'THE HALLUCINATION', lancer: 'OVERFIT', warden: 'THE BLACK BOX' };

/** Spawn director: escalating hordes, elites, surges and each stage's scripted timeline. */
export class Waves {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset(difficulty = { hp: 1, rate: 1 }) {
    this.t = 0;
    this.diff = difficulty;
    this.endless = false;
    this.loop = 0;
    this.hpMul = 1;
    this.paused = false;
    this.startStage(0);
  }

  startStage(index) {
    this.stage = index;
    this.def = index < STAGES.length ? STAGES[index] : ENDLESS;
    this.stageT = 0;
    this.acc = 0;
    this.events = this.def.events.map((e) => ({ ...e, done: false, warned: false }));
    this.active = [];
    this.eliteT = index === 0 ? 75 : 35;
    this.surgeT = index === 0 ? 40 : 30;
    this.magnetT = 90;
    this.meteorT = 0;
  }

  get stageCount() {
    return STAGES.length;
  }

  get lastStage() {
    return this.stage >= STAGES.length - 1;
  }

  get minutes() {
    return this.t / 60;
  }

  startEndless() {
    this.endless = true;
    this.loop++;
    this.startStage(STAGES.length);
    const bosses = ['hive', 'lancer', 'warden'];
    for (let k = 0; k < 14; k++) {
      const at = 45 + k * 75;
      if (k % 2 === 0) {
        const id = bosses[(k / 2) % 3];
        this.events.push({ t: at, type: 'boss', id, label: BOSS_LABEL[id], done: false, warned: false, hpBoost: 1.6 + k * 0.25 });
      } else {
        const meteors = k % 4 === 1;
        this.events.push({ t: at, type: meteors ? 'meteors' : 'blackout', dur: 20, label: meteors ? 'DATA DRIFT STORM' : 'GPU OUTAGE', done: false, warned: false });
      }
    }
  }

  /** Next scripted event for the HUD. */
  get nextEvent() {
    const act = this.active.find((a) => a.type !== 'boss');
    if (act) return { label: act.label, active: true, left: act.end - this.stageT };
    const ev = this.events.find((e) => !e.done);
    if (!ev) return null;
    return { label: ev.label, active: false, left: ev.t - this.stageT, boss: ev.type === 'boss' };
  }

  unlocked(type) {
    const u = this.def.unlock[type];
    return u !== undefined && this.stageT >= u;
  }

  update(dt) {
    const g = this.game;
    if (this.paused || g.state !== 'playing') return;
    this.t += dt;
    this.stageT += dt;
    const m = this.minutes;
    this.hpMul = (1 + 0.16 * m) * (this.endless ? Math.pow(1.15, Math.max(0, m - 11)) : 1) * this.diff.hp;

    // scripted events
    for (const ev of this.events) {
      if (ev.done) continue;
      if (!ev.warned && this.stageT >= ev.t - 8) {
        ev.warned = true;
        g.onEventWarning(ev);
      }
      if (this.stageT >= ev.t) {
        ev.done = true;
        this.fire(ev);
      }
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      if (a.type === 'meteors') {
        this.meteorT -= dt;
        if (this.meteorT <= 0) {
          this.meteorT = 0.42;
          const pl = g.player;
          const aimed = Math.random() < 0.4;
          const r = aimed ? rand(0, 2) : rand(2, 12);
          const ang = rand(0, Math.PI * 2);
          g.spawnMeteor(pl.pos.x + pl.vel.x * (aimed ? 0.9 : 0) + Math.cos(ang) * r, pl.pos.z + pl.vel.z * (aimed ? 0.9 : 0) + Math.sin(ang) * r);
        }
      }
      if (a.end !== undefined && this.stageT >= a.end) {
        this.active.splice(i, 1);
        if (a.type === 'blackout') g.setBlackout(false);
        g.onEventEnd(a);
      }
    }

    const bossActive = g.bosses.length > 0;
    // regular spawns (difficulty follows total run time, the mix follows the stage)
    const rate = (1.5 + 0.55 * m) * this.diff.rate * (bossActive ? 0.35 : 1) * (this.endless ? 1.3 : 1);
    const maxAlive = Math.min(420, Math.floor((40 + 16 * m) * (bossActive ? 0.6 : 1) * this.diff.rate));
    this.acc += rate * dt;
    let guard = 0;
    while (this.acc >= 1 && g.horde.count < maxAlive && guard++ < 20) {
      this.acc -= this.spawnPack(m);
    }
    if (this.acc > 6) this.acc = 6;

    // elites
    this.eliteT -= dt;
    if (this.eliteT <= 0) {
      this.eliteT = rand(34, 44) / (this.endless ? 1.5 : 1 + this.stage * 0.15);
      const types = Object.keys(this.def.unlock).filter((k) => k !== 'wisp' && this.unlocked(k));
      const [x, z] = this.edgePoint();
      const e = g.horde.spawn(pick(types.length ? types : ['shard']), x, z, { elite: true, hpMul: this.hpMul });
      if (e) g.onEliteSpawn(e);
    }
    // surges: a ring of drones closes in around the player
    this.surgeT -= dt;
    if (this.surgeT <= 0 && !bossActive) {
      this.surgeT = rand(50, 60);
      const n = Math.floor(16 + m * 3.5);
      const p = g.player.pos;
      const R = 13;
      const second = this.stage >= 1 && this.unlocked('splitter') ? 'splitter' : 'shard';
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = p.x + Math.cos(a) * R, z = p.z + Math.sin(a) * R;
        g.horde.spawn(m > 3 && i % 5 === 0 ? second : 'wisp', x, z, { warp: true, rise: false, hpMul: this.hpMul });
      }
      g.onSurge();
    }
    // magnet core
    this.magnetT -= dt;
    if (this.magnetT <= 0) {
      this.magnetT = rand(90, 110);
      const p = g.player.pos;
      const a = rand(0, Math.PI * 2), r = rand(7, 12);
      const lim = g.arena.boundary - 2;
      let x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const rr = Math.hypot(x, z);
      if (rr > lim) { x *= lim / rr; z *= lim / rr; }
      g.loot.item('magnet', x, z);
    }
  }

  edgePoint() {
    const R = this.game.arena.boundary + rand(3, 8);
    const a = rand(0, Math.PI * 2);
    return [Math.cos(a) * R, Math.sin(a) * R];
  }

  spawnPack(m) {
    const g = this.game;
    const w = { wisp: 10, shard: 3 + m * 0.4, sentinel: 2 + m * 0.3, splitter: 2.5 + m * 0.3, bomber: 2.6, bulwark: 1 + m * 0.2 };
    let total = 0;
    for (const k in w) if (this.unlocked(k)) total += w[k];
    let r = Math.random() * total;
    let type = 'wisp';
    for (const k in w) {
      if (!this.unlocked(k)) continue;
      r -= w[k];
      if (r <= 0) { type = k; break; }
    }
    const [x, z] = this.edgePoint();
    const n = type === 'wisp' ? 3 + Math.floor(Math.random() * (3 + m * 0.6)) : type === 'bulwark' ? 1 : 1 + (Math.random() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) g.horde.spawn(type, x + rand(-2, 2), z + rand(-2, 2), { hpMul: this.hpMul });
    return n;
  }

  fire(ev) {
    const g = this.game;
    if (ev.type === 'boss') {
      g.spawnBoss(ev.id, ev.hpBoost || 1);
    } else if (ev.type === 'collapse') {
      g.arena.collapseRing(ev.ring, 6);
      g.onCollapse(ev.ring);
    } else if (ev.type === 'meteors') {
      this.active.push({ ...ev, end: this.stageT + ev.dur });
      g.onEventStart(ev);
    } else if (ev.type === 'blackout') {
      this.active.push({ ...ev, end: this.stageT + ev.dur });
      g.setBlackout(true);
      g.onEventStart(ev);
    }
  }
}
