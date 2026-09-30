import { rand, pick } from '../utils/math.js';

export const RUN_LENGTH = 600;

const TIMELINE = [
  { t: 120, type: 'meteors', dur: 22, label: 'METEOR STORM' },
  { t: 180, type: 'boss', id: 'hive', label: 'HIVE MOTHER' },
  { t: 300, type: 'collapse', ring: 2, label: 'OUTER RING COLLAPSE' },
  { t: 390, type: 'boss', id: 'lancer', label: 'LANCER' },
  { t: 430, type: 'meteors', dur: 22, label: 'METEOR STORM' },
  { t: 480, type: 'blackout', dur: 26, label: 'BLACKOUT' },
  { t: 600, type: 'boss', id: 'warden', label: 'THE WARDEN' },
];

const UNLOCK = { wisp: 0, shard: 60, sentinel: 120, splitter: 210, bomber: 300, bulwark: 330 };

/** Spawn director: escalating hordes, elites, surges and the scripted event timeline. */
export class Waves {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset(difficulty = { hp: 1, rate: 1 }) {
    this.t = 0;
    this.diff = difficulty;
    this.acc = 0;
    this.events = TIMELINE.map((e) => ({ ...e, done: false, warned: false }));
    this.active = [];
    this.eliteT = 90;
    this.surgeT = 40;
    this.magnetT = 100;
    this.meteorT = 0;
    this.endless = false;
    this.loop = 0;
    this.hpMul = 1;
    this.paused = false;
  }

  get minutes() {
    return this.t / 60;
  }

  startEndless() {
    this.endless = true;
    this.loop++;
    const base = this.t;
    const bosses = ['hive', 'lancer', 'warden'];
    for (let k = 0; k < 12; k++) {
      const at = base + 45 + k * 75;
      if (k % 2 === 0) this.events.push({ t: at, type: 'boss', id: bosses[(k / 2) % 3], label: bosses[(k / 2) % 3] === 'hive' ? 'HIVE MOTHER' : bosses[(k / 2) % 3] === 'lancer' ? 'LANCER' : 'THE WARDEN', done: false, warned: false, hpBoost: 1.6 + k * 0.25 });
      else this.events.push({ t: at, type: k % 3 === 1 ? 'meteors' : 'blackout', dur: 22, label: k % 3 === 1 ? 'METEOR STORM' : 'BLACKOUT', done: false, warned: false });
    }
  }

  /** Next scripted event for the HUD. */
  get nextEvent() {
    const act = this.active.find((a) => a.type !== 'boss');
    if (act) return { label: act.label, active: true, left: act.end - this.t };
    const ev = this.events.find((e) => !e.done);
    if (!ev) return null;
    return { label: ev.label, active: false, left: ev.t - this.t, boss: ev.type === 'boss' };
  }

  update(dt) {
    const g = this.game;
    if (this.paused) return;
    this.t += dt;
    const m = this.minutes;
    this.hpMul = (1 + 0.16 * m) * (this.endless ? Math.pow(1.15, Math.max(0, m - 10)) : 1) * this.diff.hp;

    // scripted events
    for (const ev of this.events) {
      if (ev.done) continue;
      if (!ev.warned && this.t >= ev.t - 8) {
        ev.warned = true;
        g.onEventWarning(ev);
      }
      if (this.t >= ev.t) {
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
      if (a.end !== undefined && this.t >= a.end) {
        this.active.splice(i, 1);
        if (a.type === 'blackout') g.setBlackout(false);
        g.onEventEnd(a);
      }
    }

    const bossActive = g.bosses.length > 0;
    // regular spawns
    const rate = (1.5 + 0.55 * m) * this.diff.rate * (bossActive ? 0.35 : 1) * (this.endless ? 1.3 : 1);
    const maxAlive = Math.min(420, Math.floor((40 + 16 * m) * (bossActive ? 0.6 : 1) * this.diff.rate));
    this.acc += rate * dt;
    let guard = 0;
    while (this.acc >= 1 && g.horde.count < maxAlive && guard++ < 20) {
      this.acc -= this.spawnPack(m);
    }
    if (this.acc > 6) this.acc = 6;

    // elites
    if (this.t > 90) {
      this.eliteT -= dt;
      if (this.eliteT <= 0) {
        this.eliteT = rand(34, 44) / (this.endless ? 1.5 : 1);
        const types = Object.keys(UNLOCK).filter((k) => k !== 'wisp' && this.t >= UNLOCK[k]);
        const [x, z] = this.edgePoint();
        const e = g.horde.spawn(pick(types.length ? types : ['shard']), x, z, { elite: true, hpMul: this.hpMul });
        if (e) g.onEliteSpawn(e);
      }
    }
    // surges: a ring of wisps closes in around the courier
    this.surgeT -= dt;
    if (this.surgeT <= 0 && !bossActive) {
      this.surgeT = rand(50, 60);
      const n = Math.floor(16 + m * 3.5);
      const p = g.player.pos;
      const R = 13;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        let x = p.x + Math.cos(a) * R, z = p.z + Math.sin(a) * R;
        g.horde.spawn(m > 4 && i % 5 === 0 ? 'shard' : 'wisp', x, z, { warp: true, rise: false, hpMul: this.hpMul });
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
    const w = { wisp: 10, shard: 3 + m * 0.4, sentinel: 2 + m * 0.3, splitter: 2 + m * 0.3, bomber: 2.6, bulwark: 1 + m * 0.2 };
    let total = 0;
    for (const k in w) if (this.t >= UNLOCK[k]) total += w[k];
    let r = Math.random() * total;
    let type = 'wisp';
    for (const k in w) {
      if (this.t < UNLOCK[k]) continue;
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
      this.active.push({ ...ev, end: this.t + ev.dur });
      g.onEventStart(ev);
    } else if (ev.type === 'blackout') {
      this.active.push({ ...ev, end: this.t + ev.dur });
      g.setBlackout(true);
      g.onEventStart(ev);
    }
  }
}
