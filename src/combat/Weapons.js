import * as THREE from 'three';
import { SHOT_Y } from './Projectiles.js';

/** Weapon catalogue. `desc[i]` describes what level i+1 adds. */
export const WEAPONS = {
  pulse: {
    id: 'pulse', name: 'PULSE BLASTER', glyph: '⟫', color: '#7ff6ff', primary: true,
    desc: ['Rapid-fire bolts where you aim.', '+30% bolt damage.', '+1 bolt per shot.', 'Bolts pierce 1 drone. +fire rate.', '+1 bolt, +20% damage.'],
    evo: { name: 'RAILSTORM', with: 'coils', desc: 'Triple railguns that pierce everything — shields included.' },
  },
  arc: {
    id: 'arc', name: 'ARC CHAIN', glyph: 'ϟ', color: '#9fe8ff',
    desc: ['Lightning leaps between nearby drones.', '+33% damage.', '+2 chain jumps.', '-20% cooldown.', '+2 jumps, +15% damage.'],
    evo: { name: 'THUNDERCROWN', with: 'capacitor', desc: 'A permanent storm: lightning rains around you.' },
  },
  orbit: {
    id: 'orbit', name: 'ORBIT BLADES', glyph: '✧', color: '#ff5ae0',
    desc: ['Neon shards circle around you.', '+1 blade.', '+50% damage.', '+1 blade, wider orbit.', '+1 blade, +33% damage.'],
    evo: { name: 'HALO OF KNIVES', with: 'frame', desc: 'Two counter-rotating rings of blades.' },
  },
  nova: {
    id: 'nova', name: 'NOVA PULSE', glyph: '◎', color: '#ffd36b',
    desc: ['A shockwave bursts from you.', '+35% damage.', '+22% radius.', '-17% cooldown.', '+18% radius, +18% damage.'],
    evo: { name: 'SUPERNOVA', with: 'nano', desc: 'Huge, frequent novas that repair you per hit.' },
  },
  seeker: {
    id: 'seeker', name: 'SEEKER SWARM', glyph: '➶', color: '#ffb35c', locked: 'seeker',
    desc: ['Homing micro-missiles.', '+1 missile.', '+37% damage.', '-15% cooldown.', '+2 missiles, bigger blasts.'],
    evo: { name: 'HYDRA', with: 'targeting', desc: 'Missiles split into three on impact.' },
  },
  drone: {
    id: 'drone', name: 'LASER DRONE', glyph: '⊹', color: '#b69cff', locked: 'drone',
    desc: ['A companion drone lasers the nearest threat.', '+40% damage.', '+40% fire rate.', '+30% range.', 'Beams pierce 2, +27% damage.'],
    evo: { name: 'TWIN SATELLITES', with: 'cycler', desc: 'Two drones. Beams pierce everything.' },
  },
};

export const PASSIVES = {
  coils: { id: 'coils', name: 'OVERCHARGED COILS', glyph: 'Ψ', color: '#ffd36b', desc: '+12% damage.' },
  cycler: { id: 'cycler', name: 'RAPID CYCLER', glyph: '≡', color: '#7ff6ff', desc: '-8% cooldowns, +8% fire rate.' },
  frame: { id: 'frame', name: 'KINETIC FRAME', glyph: '»', color: '#22e6ff', desc: '+8% movement speed.' },
  magnet: { id: 'magnet', name: 'MAGNET FIELD', glyph: '∪', color: '#20ffd0', desc: '+35% pickup radius.' },
  nano: { id: 'nano', name: 'NANO MESH', glyph: '+', color: '#20ffa0', desc: '+20 max integrity, +0.5 repair/s.' },
  capacitor: { id: 'capacitor', name: 'CAPACITOR', glyph: 'Ξ', color: '#8b5cff', desc: '+12% area and reach.' },
  targeting: { id: 'targeting', name: 'TARGETING MATRIX', glyph: '⌖', color: '#ff2a55', desc: '+7% critical chance.' },
  phase: { id: 'phase', name: 'PHASE DRIVE', glyph: '↯', color: '#4d9dff', desc: '-10% dash cooldown, extra charges at ranks 1, 3, 5.' },
  echo: { id: 'echo', name: 'ECHO LINK', glyph: '◈', color: '#a6fffb', desc: '+12% XP, +1s overclock.' },
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function segCircle(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - cx, fz = az - cz;
  const a = dx * dx + dz * dz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-9) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

class Weapon {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.id = def.id;
    this.level = 1;
    this.evolved = false;
    this.cd = 0.5;
  }
  get S() { return this.game.player.stats; }
  get P() { return this.game.player; }
  L(arr) { return arr[Math.min(arr.length, this.level) - 1]; }
  crit(dmg) {
    const c = Math.random() < this.S.crit;
    return [c ? dmg * 2 : dmg, c];
  }
  levelUp() { this.level = Math.min(5, this.level + 1); this.onChange?.(); }
  evolve() { this.evolved = true; this.onChange?.(); }
  update() {}
  dispose() {}
}

// ---------------------------------------------------------------------------------------------

class Pulse extends Weapon {
  update(dt, firing) {
    const S = this.S;
    this.cd -= dt;
    if (!firing || this.cd > 0) return;
    const g = this.game;
    const p = this.P;
    const muzzle = p.muzzleWorld();
    const aim = p.aim;
    if (this.evolved) {
      this.cd = 1 / (3.4 * S.rateMul);
      for (let i = 0; i < 3; i++) this.rail(muzzle, rotate(aim.x, aim.z, (i - 1) * 0.06));
      g.audio.rail?.();
      g.fx.muzzleFlash(muzzle);
      g.cam.addTrauma(0.06);
      return;
    }
    const rate = this.L([6, 6, 6.5, 7.2, 7.8]) * S.rateMul;
    this.cd = 1 / rate;
    const n = this.L([1, 1, 2, 2, 3]);
    const base = this.L([10, 13, 13, 13, 15.6]) * S.dmgMul;
    const pierce = this.L([0, 0, 0, 1, 1]);
    for (let i = 0; i < n; i++) {
      const [dx, dz] = rotate(aim.x, aim.z, (i - (n - 1) / 2) * 0.085);
      const [dmg, crit] = this.crit(base);
      g.projectiles.bolt(muzzle.x, muzzle.z, dx, dz, { dmg, crit, pierce, speed: 64 });
    }
    g.fx.muzzleFlash(muzzle);
    g.audio.shoot();
    g.cam.addTrauma(0.012);
  }

  rail(origin, [dx, dz]) {
    const g = this.game;
    const L = 42;
    let bx = origin.x + dx * L, bz = origin.z + dz * L;
    const wall = g.arena.hitsObstacle(origin.x, origin.z, bx, bz, 0);
    if (wall >= 0) { bx = origin.x + dx * L * wall; bz = origin.z + dz * L * wall; }
    const dmgBase = 44 * this.S.dmgMul;
    const len = Math.hypot(bx - origin.x, bz - origin.z);
    const victims = [];
    g.horde.forEachNear((origin.x + bx) / 2, (origin.z + bz) / 2, len / 2 + 1, (e) => {
      if (segCircle(origin.x, origin.z, bx, bz, e.x, e.z, e.r + 0.2) >= 0) victims.push(e);
    });
    for (const e of victims) {
      const [dmg, crit] = this.crit(dmgBase);
      g.hitEnemy(e, dmg, dx, dz, 5, { crit, pierceShield: true, x: e.x, z: e.z, quiet: victims.length > 6 });
    }
    for (const b of g.bosses) if (!b.invulnerable && segCircle(origin.x, origin.z, bx, bz, b.x, b.z, b.r) >= 0) g.hitBoss(b, dmgBase, false, b.x, b.z);
    g.projectiles.ray(origin.x, origin.z, bx, bz, '#c8fbff', 0.28, 0.2);
    for (let k = 0; k < 6; k++) {
      const f = Math.random();
      g.particles.burst(_v.set(origin.x + (bx - origin.x) * f, SHOT_Y, origin.z + (bz - origin.z) * f), { count: 2, color: '#7ff6ff', speed: [1, 4], life: [0.15, 0.35], size: [0.06, 0.12] });
    }
  }
}

class Arc extends Weapon {
  update(dt) {
    this.cd -= dt;
    if (this.cd > 0) return;
    const g = this.game;
    const S = this.S;
    const p = this.P.pos;
    if (this.evolved) {
      this.cd = 0.34 * S.cdMul;
      const target = g.horde.randomNear(p.x, p.z, 11 * S.areaMul) || g.nearestBoss(p.x, p.z, 11 * S.areaMul);
      if (!target) return;
      this.strike(target, 30 * S.dmgMul, 3, true);
      return;
    }
    const target = g.horde.nearest(p.x, p.z, this.L([8, 8, 9, 9, 10]) * S.areaMul) || g.nearestBoss(p.x, p.z, 9 * S.areaMul);
    if (!target) { this.cd = 0.2; return; }
    this.cd = this.L([1.6, 1.6, 1.5, 1.2, 1.1]) * S.cdMul;
    this.strike(target, this.L([18, 24, 24, 26, 30]) * S.dmgMul, this.L([2, 2, 4, 4, 6]), false);
  }

  strike(first, dmg, chains, fromSky) {
    const g = this.game;
    const p = this.P.pos;
    const pts = fromSky ? [[first.x + (Math.random() - 0.5) * 2, 16, first.z + (Math.random() - 0.5) * 2]] : [[p.x, 1.6, p.z]];
    const hit = new Set();
    let cur = first;
    for (let i = 0; i <= chains && cur; i++) {
      hit.add(cur);
      pts.push([cur.x, 1.1, cur.z]);
      const [d, crit] = this.crit(dmg * Math.pow(0.9, i));
      if (cur.maxHp !== undefined && cur.def) g.hitEnemy(cur, d, 0, 0, 1.5, { crit, pierceShield: true, x: cur.x, z: cur.z, zap: true });
      else g.hitBoss(cur, d, crit, cur.x, cur.z);
      let next = null, bd = 6 * this.S.areaMul;
      g.horde.forEachNear(cur.x, cur.z, bd, (e) => {
        if (hit.has(e) || e.spawnT > 0.5) return;
        const dd = Math.hypot(e.x - cur.x, e.z - cur.z);
        if (dd < bd) { bd = dd; next = e; }
      });
      cur = next;
    }
    g.projectiles.zap(pts, fromSky ? '#d6f6ff' : '#9fe8ff', fromSky ? 0.22 : 0.16);
    g.audio.arcZap?.(fromSky);
    if (fromSky) {
      g.particles.burst(_v.set(first.x, 0.2, first.z), { count: 10, color: '#9fe8ff', speed: [2, 6], life: [0.2, 0.4], size: [0.08, 0.16] });
      g.fx.flash(_v.set(first.x, 2, first.z), '#9fe8ff', 40, 0.12);
    }
  }
}

class Orbit extends Weapon {
  constructor(game, def) {
    super(game, def);
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.hitAt = new Map();
    this.angle = 0;
    this.geo = new THREE.OctahedronGeometry(0.28, 0);
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5ae0').multiplyScalar(2.4) });
    this.mat2 = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7ff6ff').multiplyScalar(2.4) });
    this.blades = [];
    this.onChange();
  }

  layout() {
    if (this.evolved) return [{ n: 6, r: 2.4, dir: 1, mat: this.mat }, { n: 6, r: 4.2, dir: -1, mat: this.mat2 }];
    return [{ n: this.L([2, 3, 3, 4, 5]), r: this.L([2.3, 2.3, 2.5, 2.9, 3.0]), dir: 1, mat: this.mat }];
  }

  onChange() {
    for (const b of this.blades) this.group.remove(b.mesh);
    this.blades = [];
    for (const ring of this.layout()) {
      for (let i = 0; i < ring.n; i++) {
        const mesh = new THREE.Mesh(this.geo, ring.mat);
        mesh.scale.set(0.5, 0.5, 1.8);
        this.group.add(mesh);
        this.blades.push({ mesh, ring, i });
      }
    }
  }

  update(dt) {
    const g = this.game;
    const S = this.S;
    const p = this.P.pos;
    const speed = this.evolved ? 4.4 : this.L([3.2, 3.4, 3.6, 3.8, 4.2]);
    this.angle += dt * speed;
    const dmgBase = (this.evolved ? 26 : this.L([10, 10, 15, 15, 20])) * S.dmgMul;
    const now = g.time;
    for (const b of this.blades) {
      const { ring, i } = b;
      const a = this.angle * ring.dir + (i / ring.n) * Math.PI * 2;
      const r = ring.r * S.areaMul;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      b.mesh.position.set(x, 1.1, z);
      b.mesh.rotation.set(0, -a + (ring.dir > 0 ? 0 : Math.PI), 0);
      if (Math.random() < 0.15) g.particles.spawn(x, 1.1, z, 0, 0, 0, 0.2, 0.12, 0, _c.copy(ring.mat.color).multiplyScalar(0.35), _c2.set(0, 0, 0), 0, 0);
      g.horde.forEachNear(x, z, 0.55 * S.areaMul, (e) => {
        const key = e.id * 16 + (ring.dir > 0 ? 0 : 1);
        if ((this.hitAt.get(key) || 0) > now) return;
        this.hitAt.set(key, now + 0.35);
        const dx = e.x - p.x, dz = e.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        const [dmg, crit] = this.crit(dmgBase);
        g.hitEnemy(e, dmg, dx / d, dz / d, 5, { crit, x: e.x, z: e.z, pierceShield: true });
      });
      for (const boss of g.bosses) {
        if (boss.invulnerable) continue;
        if (Math.hypot(boss.x - x, boss.z - z) < boss.r + 0.4) {
          const key = -1 - (ring.dir > 0 ? 0 : 1);
          if ((this.hitAt.get(key) || 0) > now) continue;
          this.hitAt.set(key, now + 0.25);
          g.hitBoss(boss, dmgBase, false, x, z);
        }
      }
    }
    if (this.hitAt.size > 4000) this.hitAt.clear();
  }

  dispose() {
    this.game.scene.remove(this.group);
  }
}

class Nova extends Weapon {
  update(dt) {
    this.cd -= dt;
    if (this.cd > 0) return;
    const g = this.game;
    const S = this.S;
    const p = this.P.pos;
    let R, dmg;
    if (this.evolved) {
      this.cd = 2.0 * S.cdMul;
      R = 8 * S.areaMul;
      dmg = 50 * S.dmgMul;
    } else {
      this.cd = this.L([3.2, 3.2, 3.0, 2.5, 2.3]) * S.cdMul;
      R = this.L([4.5, 4.5, 5.5, 5.5, 6.5]) * S.areaMul;
      dmg = this.L([22, 30, 30, 34, 40]) * S.dmgMul;
    }
    const hits = g.areaDamage(p.x, p.z, R, dmg, { knock: 14, color: this.evolved ? '#ffe9a8' : '#ffd36b', cause: 'nova', pierceShield: true, quiet: true });
    if (this.evolved && hits > 0) this.P.heal(Math.min(6, hits * 0.5));
    g.fx.ring(_v.set(p.x, 0.15, p.z), '#ffd36b', R, 0.45);
    g.fx.ring(_v.set(p.x, 0.25, p.z), '#ffffff', R * 0.7, 0.3);
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      g.particles.spawn(p.x + Math.cos(a) * 0.8, 0.3, p.z + Math.sin(a) * 0.8, Math.cos(a) * R * 2.2, 0.5, Math.sin(a) * R * 2.2, 0.4, 0.22, 0.05, _c.set('#ffd36b').multiplyScalar(3), _c2.set('#ff8a2b'), 0, 3);
    }
    g.audio.nova?.(this.evolved);
    g.cam.addTrauma(this.evolved ? 0.12 : 0.06);
  }
}

class Seeker extends Weapon {
  update(dt) {
    this.cd -= dt;
    if (this.cd > 0) return;
    const g = this.game;
    const S = this.S;
    const p = this.P.pos;
    const anyone = g.horde.nearest(p.x, p.z, 22) || g.nearestBoss(p.x, p.z, 22);
    if (!anyone) { this.cd = 0.3; return; }
    this.cd = (this.evolved ? 1.5 : this.L([2.2, 2.2, 2.0, 1.7, 1.6])) * S.cdMul;
    const n = this.evolved ? 6 : this.L([3, 4, 4, 5, 7]);
    const dmg = (this.evolved ? 26 : this.L([16, 16, 22, 22, 26])) * S.dmgMul;
    const splash = (this.evolved ? 2 : this.L([1.4, 1.4, 1.5, 1.7, 2.0])) * S.areaMul;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const target = g.horde.randomNear(p.x, p.z, 18) || anyone;
      g.projectiles.missile(p.x, p.z, Math.cos(a), Math.sin(a), target, { dmg, splash, split: this.evolved });
    }
    g.audio.missileLaunch?.();
  }
}

class Drone extends Weapon {
  constructor(game, def) {
    super(game, def);
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.drones = [];
    this.onChange();
    this.a = 0;
  }

  onChange() {
    const want = this.evolved ? 2 : 1;
    while (this.drones.length < want) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: 0x2a2e42, metalness: 0.9, roughness: 0.3 }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 6, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color('#b69cff').multiplyScalar(4) }));
      ring.rotation.x = Math.PI / 2;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(5) }));
      g.add(body, ring, eye);
      this.group.add(g);
      this.drones.push({ g, cd: Math.random() * 0.3 });
    }
  }

  update(dt) {
    const game = this.game;
    const S = this.S;
    const p = this.P.pos;
    this.a += dt * 1.6;
    const rate = (this.evolved ? 0.18 : this.L([0.35, 0.35, 0.25, 0.25, 0.22])) * S.cdMul;
    const dmgBase = (this.evolved ? 16 : this.L([7, 10, 10, 11, 14])) * S.dmgMul;
    const range = (this.evolved ? 14 : this.L([10, 10, 10, 13, 13])) * S.areaMul;
    const pierce = this.evolved ? 99 : this.L([0, 0, 0, 0, 2]);
    this.drones.forEach((d, i) => {
      const a = this.a + (i / this.drones.length) * Math.PI * 2;
      const x = p.x + Math.cos(a) * 1.8, z = p.z + Math.sin(a) * 1.8, y = 2.4 + Math.sin(this.a * 2 + i) * 0.15;
      d.g.position.set(x, y, z);
      d.g.rotation.y += dt * 4;
      d.cd -= dt;
      if (d.cd > 0) return;
      const t = game.horde.nearest(x, z, range) || game.nearestBoss(x, z, range);
      if (!t) return;
      d.cd = rate;
      const dx = t.x - x, dz = t.z - z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const reach = pierce > 0 ? range : len;
      const bx = x + ux * reach, bz = z + uz * reach;
      const victims = [];
      game.horde.forEachNear((x + bx) / 2, (z + bz) / 2, reach / 2 + 1, (e) => {
        const tt = segCircle(x, z, bx, bz, e.x, e.z, e.r + 0.1);
        if (tt >= 0) victims.push([tt, e]);
      });
      victims.sort((p1, p2) => p1[0] - p2[0]);
      let left = pierce + 1;
      let endX = bx, endZ = bz;
      for (const [tt, e] of victims) {
        const [dmg, crit] = this.crit(dmgBase);
        game.hitEnemy(e, dmg, ux, uz, 1, { crit, x: e.x, z: e.z, quiet: true });
        if (--left <= 0) { endX = x + (bx - x) * tt; endZ = z + (bz - z) * tt; break; }
      }
      if (t.def === undefined) game.hitBoss(t, dmgBase, false, t.x, t.z);
      game.projectiles.ray(x, z, endX, endZ, '#b69cff', 0.08, 0.1, y - 0.6);
      game.audio.laserZap?.();
    });
  }

  dispose() {
    this.game.scene.remove(this.group);
  }
}

const CLASSES = { pulse: Pulse, arc: Arc, orbit: Orbit, nova: Nova, seeker: Seeker, drone: Drone };

export function createWeapon(game, id) {
  return new CLASSES[id](game, WEAPONS[id]);
}

function rotate(x, z, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - z * s, x * s + z * c];
}

const _c = new THREE.Color();
const _c2 = new THREE.Color();
void _v2;
