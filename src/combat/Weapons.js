import * as THREE from 'three';
import { SHOT_Y } from './Projectiles.js';
import { buildCourier } from '../player/PlayerModel.js';
import { makeHoloMaterial } from '../world/Materials.js';

/** Weapon catalogue. `desc[i]` describes what level i+1 adds. */
export const WEAPONS = {
  pulse: {
    id: 'pulse', name: 'PYTHON PULSE', glyph: '⟫', color: '#7ff6ff', primary: true,
    desc: ['Rapid-fire tensors where you aim.', '+30% bolt damage.', '+1 bolt per shot.', 'Bolts pierce 1 drone. +fire rate.', '+1 bolt, +20% damage.'],
    evo: { name: 'PYTORCH RAILSTORM', with: 'coils', desc: 'GPU-accelerated triple rails that pierce everything — shields included.' },
  },
  arc: {
    id: 'arc', name: 'XGBOOST CHAIN', glyph: 'ϟ', color: '#9fe8ff',
    desc: ['Boosted lightning: each jump corrects the last.', '+33% damage.', '+2 chain jumps.', '-20% cooldown.', '+2 jumps, +15% damage.'],
    evo: { name: 'GRADIENT STORM', with: 'capacitor', desc: 'A permanent storm: gradients rain down around you.' },
  },
  orbit: {
    id: 'orbit', name: 'CLIP ORBIT', glyph: '✧', color: '#ff5ae0',
    desc: ['Vision embeddings circle around you, slicing what they see.', '+1 blade.', '+50% damage.', '+1 blade, wider orbit.', '+1 blade, +33% damage.'],
    evo: { name: 'DINO HALO', with: 'frame', desc: 'Two counter-rotating rings of embeddings.' },
  },
  nova: {
    id: 'nova', name: 'HDBSCAN NOVA', glyph: '◎', color: '#ffd36b',
    desc: ['A clustering shockwave bursts from you.', '+35% damage.', '+22% radius.', '-17% cooldown.', '+18% radius, +18% damage.'],
    evo: { name: 'UMAP SUPERNOVA', with: 'nano', desc: 'Huge, frequent novas that repair you per hit.' },
  },
  seeker: {
    id: 'seeker', name: 'RETRIEVAL SWARM', glyph: '➶', color: '#ffb35c', locked: 'seeker',
    desc: ['Semantic retrieval: homing queries always find their target.', '+1 missile.', '+37% damage.', '-15% cooldown.', '+2 missiles, bigger blasts.'],
    evo: { name: 'RERANKER HYDRA', with: 'targeting', desc: 'Every hit is reranked: missiles split into three on impact.' },
  },
  boomerang: {
    id: 'boomerang', name: 'BACKPROP', glyph: '⟲', color: '#7dff9a',
    desc: ['A disc flies forward, then propagates back through everything it hit.', '+30% damage.', '+1 disc.', '+30% range, faster discs.', '+1 disc, +20% damage.'],
    evo: { name: 'GRADIENT DESCENT', with: 'phase', desc: 'Five discs spiral out and back, slicing through shields.' },
  },
  attention: {
    id: 'attention', name: 'ATTENTION HEAD', glyph: '◉', color: '#ff7ad9',
    desc: ['A beam locks onto the strongest threat. The longer it stares, the harder it burns.', '+30% damage.', 'Focuses 40% faster.', '+25% range.', '+35% damage.'],
    evo: { name: 'MULTI-HEAD ATTENTION', with: 'echo', desc: 'Four heads, four targets, ×4 focus.' },
  },
  kmeans: {
    id: 'kmeans', name: 'K-MEANS SINGULARITY', glyph: '✺', color: '#c08bff', locked: 'kmeans',
    desc: ['Drops a centroid that drags drones into one cluster, then collapses it.', '+30% collapse damage.', '+1 centroid (k = 2).', 'Wider pull, -15% cooldown.', '+1 centroid (k = 3).'],
    evo: { name: 'HIERARCHICAL COLLAPSE', with: 'magnet', desc: 'Huge centroids that also drag every data shard to you.' },
  },
  gan: {
    id: 'gan', name: 'GAN DECOY', glyph: '⧉', color: '#ffe066', locked: 'gan',
    desc: ['Generates a fake you. Drones fall for it, it shoots back, then it detonates.', '+40% decoy integrity.', 'Decoy fires twice as fast.', '-20% cooldown.', 'Bigger detonation, +30% damage.'],
    evo: { name: 'ADVERSARIAL PAIR', with: 'reg', desc: 'Two decoys at once — every detonation repairs you.' },
  },
  drone: {
    id: 'drone', name: 'LLM AGENT', glyph: '⊹', color: '#b69cff', locked: 'drone',
    desc: ['An autonomous agent lasers the nearest threat.', '+40% damage.', '+40% fire rate.', '+30% range.', 'Beams pierce 2, +27% damage.'],
    evo: { name: 'MULTI-AGENT', with: 'cycler', desc: 'Two agents. Beams pierce everything.' },
  },
};

export const PASSIVES = {
  coils: { id: 'coils', name: 'CUDA CORES', glyph: 'Ψ', color: '#ffd36b', desc: '+12% damage.' },
  cycler: { id: 'cycler', name: 'TERRAFORM', glyph: '≡', color: '#7ff6ff', desc: '-8% cooldowns, +8% fire rate.' },
  frame: { id: 'frame', name: 'CLOUD RUN', glyph: '»', color: '#22e6ff', desc: '+8% movement speed.' },
  magnet: { id: 'magnet', name: 'DATA PIPELINE', glyph: '∪', color: '#20ffd0', desc: '+35% pickup radius.' },
  nano: { id: 'nano', name: 'MONITORING', glyph: '+', color: '#20ffa0', desc: '+20 max integrity, +0.5 repair/s.' },
  capacitor: { id: 'capacitor', name: 'EMBEDDINGS', glyph: 'Ξ', color: '#8b5cff', desc: '+12% area and reach.' },
  targeting: { id: 'targeting', name: 'FROZEN TEST SET', glyph: '⌖', color: '#ff2a55', desc: '+7% critical chance.' },
  phase: { id: 'phase', name: 'SERVERLESS', glyph: '↯', color: '#4d9dff', desc: '-10% dash cooldown, extra charges at ranks 1, 3, 5.' },
  echo: { id: 'echo', name: 'BENCHMARK', glyph: '◈', color: '#a6fffb', desc: '+12% XP, +1s overclock.' },
  reg: { id: 'reg', name: 'REGULARIZATION', glyph: '▣', color: '#ffe066', desc: '-6% damage taken.' },
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
  /** Player stats, plus this weapon's own boost for levels above 5 (+20% damage, -7% cooldown per level). */
  get S() {
    const s = this.game.player.stats;
    const k = Math.max(0, this.level - 5);
    if (!k) return s;
    if (this._sFrame !== this.game.frame || this._sBase !== s || this._sK !== k) {
      const haste = Math.pow(0.93, k);
      this._sv = { ...s, dmgMul: s.dmgMul * (1 + 0.2 * k), cdMul: s.cdMul * haste, rateMul: s.rateMul / haste };
      this._sFrame = this.game.frame;
      this._sBase = s;
      this._sK = k;
    }
    return this._sv;
  }
  get P() { return this.game.player; }
  L(arr) { return arr[Math.min(arr.length, this.level) - 1]; }
  crit(dmg) {
    const c = Math.random() < this.S.crit;
    return [c ? dmg * 2 : dmg, c];
  }
  levelUp() { this.level = Math.min(8, this.level + 1); this.onChange?.(); }
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

/** BACKPROP: discs fly out (forward pass) then home back to you (backward pass), hitting on both legs. */
class Backprop extends Weapon {
  constructor(game, def) {
    super(game, def);
    this.discs = [];
    this.geo = new THREE.TorusGeometry(0.42, 0.08, 6, 24);
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7dff9a').multiplyScalar(3) });
    this.matEvo = new THREE.MeshBasicMaterial({ color: new THREE.Color('#d6ff7a').multiplyScalar(3.4) });
  }

  update(dt) {
    const g = this.game;
    const S = this.S;
    const p = this.P;
    this.cd -= dt;
    if (this.cd <= 0) {
      if (!g.horde.nearest(p.pos.x, p.pos.z, 16) && !g.nearestBoss(p.pos.x, p.pos.z, 16)) this.cd = 0.25;
      else {
        this.cd = (this.evolved ? 1.6 : this.L([1.8, 1.8, 1.7, 1.5, 1.4])) * S.cdMul;
        const n = this.evolved ? 5 : this.L([1, 1, 2, 2, 3]);
        const range = (this.evolved ? 12 : this.L([9, 9, 9, 11.5, 11.5])) * S.areaMul;
        const speed = this.evolved ? 20 : this.L([16, 16, 16, 19, 19]);
        const base = Math.atan2(p.aim.z, p.aim.x);
        for (let i = 0; i < n; i++) {
          const a = this.evolved ? base + (i / n) * Math.PI * 2 : base + (i - (n - 1) / 2) * 0.35;
          const mesh = new THREE.Mesh(this.geo, this.evolved ? this.matEvo : this.mat);
          mesh.rotation.x = Math.PI / 2;
          g.scene.add(mesh);
          this.discs.push({ mesh, x: p.pos.x, z: p.pos.z, dx: Math.cos(a), dz: Math.sin(a), out: true, dist: 0, range, speed, hits: new Set(), t: 0 });
        }
        g.audio.dash?.();
      }
    }
    const dmgBase = (this.evolved ? 34 : this.L([18, 23, 23, 23, 28])) * S.dmgMul;
    const hitR = 0.75 * S.areaMul;
    for (let k = this.discs.length - 1; k >= 0; k--) {
      const d = this.discs[k];
      d.t += dt;
      if (d.out) {
        if (this.evolved) {
          // spiral: keep turning while flying out
          const c = Math.cos(1.6 * dt), s2 = Math.sin(1.6 * dt);
          const nx = d.dx * c - d.dz * s2, nz = d.dx * s2 + d.dz * c;
          d.dx = nx; d.dz = nz;
        }
        const step = d.speed * (1 - 0.55 * (d.dist / d.range)) * dt;
        d.x += d.dx * step;
        d.z += d.dz * step;
        d.dist += step;
        if (d.dist >= d.range) { d.out = false; d.hits.clear(); }
      } else {
        const tx = p.pos.x - d.x, tz = p.pos.z - d.z;
        const l = Math.hypot(tx, tz) || 1;
        d.dx = tx / l; d.dz = tz / l;
        const sp = d.speed * 1.35 * dt;
        d.x += d.dx * sp;
        d.z += d.dz * sp;
        if (l < 1 || d.t > 6) {
          g.scene.remove(d.mesh);
          this.discs.splice(k, 1);
          continue;
        }
      }
      g.horde.forEachNear(d.x, d.z, hitR, (e) => {
        if (d.hits.has(e.id) || e.spawnT > 0.5) return;
        d.hits.add(e.id);
        const [dmg, crit] = this.crit(dmgBase);
        g.hitEnemy(e, dmg, d.dx, d.dz, 4, { crit, x: e.x, z: e.z, pierceShield: this.evolved, quiet: true });
      });
      for (const b of g.bosses) {
        if (b.invulnerable || d.hits.has(b)) continue;
        if (Math.hypot(b.x - d.x, b.z - d.z) < b.r + hitR) {
          d.hits.add(b);
          g.hitBoss(b, dmgBase, false, d.x, d.z);
        }
      }
      d.mesh.position.set(d.x, 1.1, d.z);
      d.mesh.rotation.z += dt * 18;
      if (Math.random() < 0.5) g.particles.spawn(d.x, 1.1, d.z, 0, 0, 0, 0.25, 0.16, 0, _c.copy(d.mesh.material.color).multiplyScalar(0.3), _c2.set(0, 0, 0), 0, 0);
    }
  }

  dispose() {
    for (const d of this.discs) this.game.scene.remove(d.mesh);
    this.discs.length = 0;
  }
}

/** ATTENTION HEAD: a beam on the strongest threat in range; focus ramps damage the longer it holds. */
class Attention extends Weapon {
  constructor(game, def) {
    super(game, def);
    this.heads = [];
  }

  pickTarget(range, taken) {
    const g = this.game;
    const p = this.P.pos;
    for (const b of g.bosses) if (!b.invulnerable && !taken.has(b) && Math.hypot(b.x - p.x, b.z - p.z) < range + b.r) return b;
    let best = null;
    g.horde.forEachNear(p.x, p.z, range, (e) => {
      if (taken.has(e) || e.spawnT > 0.5) return;
      if (!best || e.hp > best.hp) best = e;
    });
    return best;
  }

  update(dt) {
    const g = this.game;
    const S = this.S;
    const p = this.P.pos;
    const nHeads = this.evolved ? 4 : 1;
    while (this.heads.length < nHeads) this.heads.push({ target: null, focus: 0, tick: 0 });
    this.heads.length = nHeads;
    const range = (this.evolved ? 13 : this.L([10, 10, 10, 12.5, 12.5])) * S.areaMul;
    const dps = (this.evolved ? 40 : this.L([26, 34, 34, 34, 46])) * S.dmgMul;
    const ramp = this.evolved ? 1.8 : this.L([2, 2, 1.4, 1.4, 1.4]);
    const maxFocus = this.evolved ? 4 : 3;
    const taken = new Set();
    for (const h of this.heads) {
      const t = h.target;
      const alive = t && (t.def ? t.alive : !t.invulnerable && t.hp > 0);
      if (!alive || Math.hypot(t.x - p.x, t.z - p.z) > range + (t.r || 0) + 1 || taken.has(t)) {
        h.target = this.pickTarget(range, taken);
        h.focus = 0;
      }
      if (!h.target) continue;
      taken.add(h.target);
      h.focus = Math.min(1, h.focus + dt / ramp);
      h.tick -= dt;
      if (h.tick > 0) continue;
      h.tick = 0.1;
      const mult = 1 + (maxFocus - 1) * h.focus;
      const t2 = h.target;
      const dmg = dps * 0.1 * mult;
      if (t2.def) g.hitEnemy(t2, dmg, 0, 0, 0.3, { x: t2.x, z: t2.z, quiet: h.focus < 1, crit: h.focus >= 1, pierceShield: true });
      else g.hitBoss(t2, dmg, h.focus >= 1, t2.x, t2.z);
      g.projectiles.ray(p.x, p.z, t2.x, t2.z, h.focus >= 1 ? '#ffffff' : '#ff7ad9', 0.05 + 0.16 * h.focus, 0.12, 1.5);
      if (h.focus >= 1 && Math.random() < 0.4) g.particles.burst(_v.set(t2.x, 1.2, t2.z), { count: 3, color: '#ff7ad9', speed: [1, 4], life: [0.15, 0.3], size: [0.06, 0.12] });
    }
  }
}

/** K-MEANS SINGULARITY: centroids drag nearby drones into a cluster, then collapse it. */
class KMeans extends Weapon {
  constructor(game, def) {
    super(game, def);
    this.cents = [];
    this.coreGeo = new THREE.SphereGeometry(0.6, 20, 14);
    this.ringGeo = new THREE.RingGeometry(0.9, 1.05, 48);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#c08bff').multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }

  update(dt) {
    const g = this.game;
    const S = this.S;
    const p = this.P.pos;
    this.cd -= dt;
    if (this.cd <= 0) {
      if (!g.horde.nearest(p.x, p.z, 13)) this.cd = 0.4;
      else {
        this.cd = (this.evolved ? 4 : this.L([5, 5, 5, 4.25, 4.25])) * S.cdMul;
        const k = this.evolved ? 3 : this.L([1, 1, 2, 2, 3]);
        for (let i = 0; i < k; i++) {
          const seed = g.horde.randomNear(p.x, p.z, 13);
          if (!seed) break;
          const core = new THREE.Mesh(this.coreGeo, this.coreMat);
          const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
          ring.rotation.x = -Math.PI / 2;
          const grp = new THREE.Group();
          grp.add(core, ring);
          grp.position.set(seed.x, 1.2, seed.z);
          g.scene.add(grp);
          this.cents.push({
            grp, core, ring, x: seed.x, z: seed.z, t: 0, dur: 2.2, tick: 0,
            R: (this.evolved ? 8.5 : this.L([5, 5, 5, 6.2, 6.2])) * S.areaMul,
            dmg: (this.evolved ? 95 : this.L([42, 55, 55, 55, 64])) * S.dmgMul,
          });
        }
        g.audio.bossCharge?.(null, 0.6);
      }
    }
    for (let i = this.cents.length - 1; i >= 0; i--) {
      const c = this.cents[i];
      c.t += dt;
      const k = c.t / c.dur;
      // gravity well: pull drones toward the centroid
      c.tick -= dt;
      const tickNow = c.tick <= 0;
      if (tickNow) c.tick = 0.25;
      g.horde.forEachNear(c.x, c.z, c.R, (e) => {
        const dx = c.x - e.x, dz = c.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        const pull = (14 + 22 * (1 - d / c.R)) / Math.max(1, e.def.mass * (e.elite ? 2 : 1));
        e.kx += (dx / d) * pull * dt * 4;
        e.kz += (dz / d) * pull * dt * 4;
        if (tickNow) g.hitEnemy(e, c.dmg * 0.06, 0, 0, 0, { quiet: true, pierceShield: true, x: e.x, z: e.z });
      });
      if (this.evolved) {
        const L = g.loot;
        for (let j = 0; j < L.n; j++) if ((L.x[j] - c.x) ** 2 + (L.z[j] - c.z) ** 2 < c.R * c.R) L.pull[j] = 1;
      }
      c.core.scale.setScalar(0.6 + k * 0.9);
      c.ring.scale.setScalar((c.R / 1.05) * (1 - k * 0.85));
      c.ring.rotation.z += dt * 3;
      if (Math.random() < 0.9) {
        const a = Math.random() * Math.PI * 2;
        const r = c.R * (0.6 + Math.random() * 0.4);
        g.particles.spawn(c.x + Math.cos(a) * r, 0.6 + Math.random(), c.z + Math.sin(a) * r, -Math.cos(a) * r * 2, 0, -Math.sin(a) * r * 2, 0.45, 0.14, 0.04, _c.set('#c08bff').multiplyScalar(2.5), _c2.set('#ffffff'), 0, 0);
      }
      if (c.t >= c.dur) {
        const R = (this.evolved ? 4.8 : 3.2) * S.areaMul;
        g.areaDamage(c.x, c.z, R, c.dmg, { knock: 16, cause: 'kmeans', pierceShield: true });
        g.fx.ring(_v.set(c.x, 0.2, c.z), '#c08bff', R * 1.6, 0.45);
        g.fx.flash(_v.set(c.x, 2, c.z), '#c08bff', 70, 0.25);
        g.particles.burst(_v.set(c.x, 1.2, c.z), { count: 50, color: '#ffffff', colorEnd: '#c08bff', speed: [3, 12], life: [0.25, 0.6], size: [0.08, 0.2], drag: 2 });
        g.audio.nova?.(true);
        g.cam.addTrauma(0.12);
        g.scene.remove(c.grp);
        this.cents.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const c of this.cents) this.game.scene.remove(c.grp);
    this.cents.length = 0;
  }
}

/** GAN DECOY: a holographic fake you that taunts drones, shoots back, then detonates. */
class Gan extends Weapon {
  constructor(game, def) {
    super(game, def);
    this.decoys = [];
    this.cd = 2;
  }

  spawnDecoy(offset) {
    const g = this.game;
    const p = this.P;
    const mat = makeHoloMaterial('#ffe066', { opacity: 0.85, rim: 1.4, flicker: 0.3 });
    const model = buildCourier({ holo: mat });
    model.group.scale.setScalar(1.25);
    const side = new THREE.Vector3(-p.aim.z, 0, p.aim.x).multiplyScalar(offset);
    let x = p.pos.x + side.x + p.aim.x * 2, z = p.pos.z + side.z + p.aim.z * 2;
    const lim = g.arena.boundary - 1.5;
    const rr = Math.hypot(x, z);
    if (rr > lim) { x *= lim / rr; z *= lim / rr; }
    model.group.position.set(x, 0, z);
    g.scene.add(model.group);
    const hp = (this.evolved ? 140 : this.L([60, 84, 84, 84, 84])) * (1 + 0.1 * Math.max(0, this.level - 5));
    this.decoys.push({ model, mat, x, z, hp, maxHp: hp, t: 0, life: 6, fire: 0, yaw: 0 });
    g.particles.burst(_v.set(x, 1, z), { count: 30, color: '#ffe066', speed: [2, 6], life: [0.3, 0.6], size: [0.08, 0.18] });
    g.audio.warp?.(null);
  }

  detonate(d, i) {
    const g = this.game;
    const S = this.S;
    const R = (this.evolved ? 5 : this.L([3.5, 3.5, 3.5, 3.5, 4.5])) * S.areaMul;
    const dmg = (this.evolved ? 75 : this.L([45, 45, 45, 45, 58])) * S.dmgMul;
    g.areaDamage(d.x, d.z, R, dmg, { knock: 16, cause: 'gan', pierceShield: true });
    if (this.evolved) {
      this.P.heal(8);
      g.ui.number(this.P.center, '+8', 'heal');
    }
    g.fx.ring(_v.set(d.x, 0.2, d.z), '#ffe066', R * 1.4, 0.45);
    g.fx.flash(_v.set(d.x, 2, d.z), '#ffe066', 80, 0.25);
    g.particles.burst(_v.set(d.x, 1.1, d.z), { count: 60, color: '#ffffff', colorEnd: '#ffe066', speed: [3, 12], life: [0.25, 0.7], size: [0.08, 0.22], drag: 2 });
    g.audio.explosion(null, 1.2);
    g.scene.remove(d.model.group);
    this.decoys.splice(i, 1);
  }

  update(dt) {
    const g = this.game;
    const S = this.S;
    this.cd -= dt;
    if (this.cd <= 0 && this.decoys.length === 0) {
      this.cd = (this.evolved ? 6 : this.L([8, 8, 8, 6.4, 6.4])) * S.cdMul;
      if (this.evolved) { this.spawnDecoy(-3); this.spawnDecoy(3); } else this.spawnDecoy(2.5);
    }
    const fireEvery = this.evolved ? 0.2 : this.L([0.4, 0.4, 0.2, 0.2, 0.2]);
    const boltDmg = 9 * S.dmgMul;
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i];
      d.t += dt;
      let crowd = 0;
      g.horde.forEachNear(d.x, d.z, 1.3, () => { crowd++; });
      d.hp -= crowd * 14 * dt;
      d.fire -= dt;
      const tgt = g.horde.nearest(d.x, d.z, 14) || g.nearestBoss(d.x, d.z, 14);
      if (tgt) {
        d.yaw = Math.atan2(tgt.x - d.x, tgt.z - d.z);
        if (d.fire <= 0) {
          d.fire = fireEvery;
          const dx = tgt.x - d.x, dz = tgt.z - d.z, l = Math.hypot(dx, dz) || 1;
          g.projectiles.bolt(d.x + (dx / l) * 0.8, d.z + (dz / l) * 0.8, dx / l, dz / l, { dmg: boltDmg, color: '#ffe066', speed: 55 });
        }
      }
      d.model.group.rotation.y = d.yaw;
      d.model.update(dt, { speed: 0, grounded: true, vy: 0, dash: false, aiming: !!tgt, aimPitch: -0.05, turn: 0 });
      d.mat.uniforms.uOpacity.value = 0.85 * (d.t > d.life - 1 ? (Math.sin(d.t * 30) > 0 ? 1 : 0.3) : 1);
      if (d.t >= d.life || d.hp <= 0) this.detonate(d, i);
    }
    // drones prefer the decoys while they stand
    g.taunts = this.decoys.map((d) => ({ x: d.x, z: d.z, r: 13 }));
  }

  dispose() {
    for (const d of this.decoys) this.game.scene.remove(d.model.group);
    this.decoys.length = 0;
    this.game.taunts = [];
  }
}

const CLASSES = { pulse: Pulse, arc: Arc, orbit: Orbit, nova: Nova, seeker: Seeker, drone: Drone, boomerang: Backprop, attention: Attention, kmeans: KMeans, gan: Gan };

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
