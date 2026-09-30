import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand } from '../utils/math.js';

/**
 * Enemy roster. hp scales with time; `xp` is the value of the shard they drop.
 */
export const ENEMY_TYPES = {
  wisp: { hp: 12, speed: 5.0, r: 0.45, dmg: 6, xp: 1, y: 1.0, color: '#ff2a55', score: 10, mass: 1, cap: 520, name: 'BUG' },
  shard: { hp: 26, speed: 4.2, r: 0.55, dmg: 16, xp: 2, y: 1.0, color: '#ff2bd6', score: 20, mass: 1.5, cap: 140, name: 'OUTLIER' },
  sentinel: { hp: 55, speed: 2.9, r: 0.95, dmg: 12, xp: 4, y: 2.1, color: '#ff8a2b', score: 40, mass: 3, cap: 90, name: 'DATA LEAK' },
  bulwark: { hp: 280, speed: 2.1, r: 1.35, dmg: 22, xp: 12, y: 1.3, color: '#8b5cff', score: 100, mass: 9, cap: 50, name: 'LEGACY CODE' },
  splitter: { hp: 48, speed: 3.4, r: 0.85, dmg: 12, xp: 3, y: 1.2, color: '#20ffd0', score: 30, mass: 2, cap: 90, name: 'DUPLICATE' },
  bomber: { hp: 30, speed: 4.7, r: 0.6, dmg: 26, xp: 3, y: 0.9, color: '#ffd36b', score: 25, mass: 1.2, cap: 90, name: 'MEMORY LEAK' },
};

const CELL = 3;
const GRID_HALF = 66;
const GN = Math.ceil((GRID_HALF * 2) / CELL);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);
const _gold = new THREE.Color('#ffd36b');
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function merge(parts) {
  const geos = parts.map(([g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1]) => {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal'].includes(k)) geo.deleteAttribute(k);
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    geo.applyMatrix4(_m);
    return geo;
  });
  return mergeGeometries(geos, false);
}

/** Body (lit metal) + glow (unlit HDR) geometry for each drone type, facing +Z. */
function buildGeometries(type) {
  const T = THREE;
  switch (type) {
    case 'wisp': {
      const shell = new T.SphereGeometry(0.42, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.36);
      const fin = new T.BoxGeometry(0.05, 0.1, 0.45);
      return {
        body: merge([[shell], [shell, 0, 0, 0, Math.PI], [fin, 0.55, 0, 0, 0, Math.PI / 2], [fin, -0.28, 0, 0.48, 0, -Math.PI / 6], [fin, -0.28, 0, -0.48, 0, Math.PI / 6]]),
        glow: merge([[new T.IcosahedronGeometry(0.24, 1)], [new T.TorusGeometry(0.43, 0.022, 5, 24), 0, 0, 0, Math.PI / 2], [new T.SphereGeometry(0.08, 6, 4), 0, 0, 0.42]]),
      };
    }
    case 'shard': {
      const hull = new T.OctahedronGeometry(0.5, 0);
      return {
        body: merge([[hull, 0, 0, 0, 0, 0, 0, 0.55, 0.32, 1.25], [new T.BoxGeometry(1.3, 0.04, 0.35), 0, 0, -0.2]]),
        glow: merge([[new T.ConeGeometry(0.14, 0.4, 6), 0, 0, -0.7, -Math.PI / 2], [new T.BoxGeometry(0.03, 0.03, 1.1), 0.22, 0.08, 0], [new T.BoxGeometry(0.03, 0.03, 1.1), -0.22, 0.08, 0], [new T.SphereGeometry(0.07, 6, 4), 0, 0.06, 0.55]]),
      };
    }
    case 'sentinel': {
      const plate = new T.BoxGeometry(0.46, 0.85, 0.1);
      const parts = [[new T.OctahedronGeometry(0.8, 0), 0, 0, 0, 0, 0, 0, 1, 1.3, 1]];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        parts.push([plate, Math.cos(a) * 0.66, 0, Math.sin(a) * 0.66, 0, -a + Math.PI / 2]);
      }
      parts.push([new T.TorusGeometry(0.28, 0.06, 6, 16), 0, 0, 0.72]);
      return {
        body: merge(parts),
        glow: merge([[new T.SphereGeometry(0.22, 12, 8), 0, 0, 0.68], [new T.TorusGeometry(1.2, 0.04, 5, 48), 0, 0, 0, Math.PI / 2], [new T.ConeGeometry(0.09, 0.3, 6), 0.35, -1.1, 0, Math.PI], [new T.ConeGeometry(0.09, 0.3, 6), -0.35, -1.1, 0, Math.PI]]),
      };
    }
    case 'bulwark': {
      const shieldGeo = new T.CylinderGeometry(1.45, 1.45, 1.5, 16, 1, true, -0.9, 1.8);
      return {
        body: merge([[new T.BoxGeometry(1.4, 1.0, 1.5), 0, 0, -0.2], [new T.BoxGeometry(1.7, 0.3, 0.9), 0, 0.55, -0.4], [shieldGeo, 0, 0, -0.4]]),
        glow: merge([[new T.BoxGeometry(0.9, 0.08, 0.05), 0, 0.15, 1.08], [new T.CylinderGeometry(1.48, 1.48, 0.06, 16, 1, true, -0.9, 1.8), 0, 0.73, -0.4], [new T.CylinderGeometry(1.48, 1.48, 0.06, 16, 1, true, -0.9, 1.8), 0, -0.73, -0.4], [new T.SphereGeometry(0.2, 8, 6), 0, 0.2, -1.0]]),
      };
    }
    case 'splitter': {
      return {
        body: merge([[new T.DodecahedronGeometry(0.72, 0)]]),
        glow: merge([[new T.SphereGeometry(0.2, 8, 6), 0.75, 0, 0], [new T.SphereGeometry(0.2, 8, 6), -0.38, 0, 0.65], [new T.SphereGeometry(0.2, 8, 6), -0.38, 0, -0.65], [new T.TorusGeometry(0.76, 0.03, 5, 32), 0, 0, 0, Math.PI / 2]]),
      };
    }
    case 'bomber':
    default: {
      const parts = [[new T.SphereGeometry(0.46, 14, 10)]];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push([new T.ConeGeometry(0.1, 0.35, 5), Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5, 0, 0, Math.PI / 2 + 0, 1, 1, 1]);
      }
      const spikes = parts.map((p, i) => {
        if (i === 0) return p;
        const a = ((i - 1) / 6) * Math.PI * 2;
        return [p[0], Math.cos(a) * 0.52, 0, Math.sin(a) * 0.52, 0, -a, -Math.PI / 2];
      });
      return {
        body: merge(spikes),
        glow: merge([[new T.TorusGeometry(0.48, 0.07, 6, 24), 0, 0, 0, Math.PI / 2], [new T.SphereGeometry(0.16, 8, 6), 0, 0.42, 0]]),
      };
    }
  }
}

let _decalTex = null;
function decalTexture() {
  if (_decalTex) return _decalTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _decalTex = new THREE.CanvasTexture(c);
  return _decalTex;
}

export class Horde {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nextId = 1;
    this.meshes = {};
    const scene = game.scene;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.85, envMapIntensity: 1.4 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const [type, def] of Object.entries(ENEMY_TYPES)) {
      const g = buildGeometries(type);
      const body = new THREE.InstancedMesh(g.body, bodyMat, def.cap);
      const glow = new THREE.InstancedMesh(g.glow, glowMat, def.cap);
      for (const m of [body, glow]) {
        m.frustumCulled = false;
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < def.cap; i++) {
          m.setMatrixAt(i, ZERO);
          m.setColorAt(i, _white);
        }
        scene.add(m);
      }
      this.meshes[type] = { body, glow, def, color: new THREE.Color(def.color) };
    }
    // glow pools on the floor under every drone
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    decalGeo.rotateX(-Math.PI / 2);
    this.decals = new THREE.InstancedMesh(
      decalGeo,
      new THREE.MeshBasicMaterial({ map: decalTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      1100,
    );
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 3;
    this.decals.count = 0;
    for (let i = 0; i < 1100; i++) this.decals.setColorAt(i, _white);
    scene.add(this.decals);
    // charge telegraphs (shards)
    const telGeo = new THREE.PlaneGeometry(1, 1);
    telGeo.rotateX(-Math.PI / 2);
    telGeo.translate(0, 0, 0.5);
    this.telegraphs = new THREE.InstancedMesh(
      telGeo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2bd6').multiplyScalar(1.2), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }),
      80,
    );
    this.telegraphs.frustumCulled = false;
    this.telegraphs.count = 0;
    this.telegraphs.renderOrder = 3;
    scene.add(this.telegraphs);

    // spatial hash
    this.cellCount = new Int32Array(GN * GN);
    this.cellStart = new Int32Array(GN * GN + 1);
    this.cellItems = new Int32Array(4096);
  }

  get count() {
    return this.list.length;
  }

  spawn(type, x, z, { elite = false, mini = false, rise = true, warp = false, hpMul = 1 } = {}) {
    const def = ENEMY_TYPES[type];
    let n = 0;
    for (const e of this.list) if (e.type === type) n++;
    if (n >= def.cap) return null;
    const scale = elite ? 1.5 : mini ? 0.65 : 1;
    const hp = def.hp * hpMul * (elite ? 5 : mini ? 0.4 : 1);
    const e = {
      id: this.nextId++, type, def, x, z, y: rise ? -6 - Math.random() * 4 : def.y,
      vx: 0, vz: 0, kx: 0, kz: 0, hp, maxHp: hp, r: def.r * scale, scale, elite, mini,
      flash: 0, state: 'seek', st: 0, t: Math.random() * 10, facing: Math.atan2(-x, -z),
      spawnT: rise ? 1 : warp ? 0.7 : 0, alive: true, fireT: rand(1.5, 3), dirX: 0, dirZ: 0, burn: 0, hitCd: new Map(),
      speed: def.speed * (mini ? 1.25 : 1) * rand(0.92, 1.08) * (elite ? 0.85 : 1),
    };
    this.list.push(e);
    return e;
  }

  clear() {
    this.list.length = 0;
  }

  // ------------------------------------------------------------------ spatial queries

  _cell(x, z) {
    const cx = Math.max(0, Math.min(GN - 1, Math.floor((x + GRID_HALF) / CELL)));
    const cz = Math.max(0, Math.min(GN - 1, Math.floor((z + GRID_HALF) / CELL)));
    return cz * GN + cx;
  }

  rebuildGrid() {
    const L = this.list;
    const cnt = this.cellCount;
    cnt.fill(0);
    if (this.cellItems.length < L.length) this.cellItems = new Int32Array(L.length * 2);
    if (!this._cellOf || this._cellOf.length < L.length) this._cellOf = new Int32Array(Math.max(8192, L.length * 2));
    for (let i = 0; i < L.length; i++) {
      const c = this._cell(L[i].x, L[i].z);
      this._cellOf[i] = c;
      cnt[c]++;
    }
    const start = this.cellStart;
    start[0] = 0;
    for (let i = 0; i < GN * GN; i++) start[i + 1] = start[i] + cnt[i];
    const fill = this._fill || (this._fill = new Int32Array(GN * GN));
    fill.set(start.subarray(0, GN * GN));
    for (let i = 0; i < L.length; i++) this.cellItems[fill[this._cellOf[i]]++] = i;
  }

  /** Calls fn(enemy) for enemies whose centre is within r (+ their radius) of (x, z). */
  forEachNear(x, z, r, fn) {
    const L = this.list;
    const pad = r + 1.5;
    const x0 = Math.max(0, Math.floor((x - pad + GRID_HALF) / CELL)), x1 = Math.min(GN - 1, Math.floor((x + pad + GRID_HALF) / CELL));
    const z0 = Math.max(0, Math.floor((z - pad + GRID_HALF) / CELL)), z1 = Math.min(GN - 1, Math.floor((z + pad + GRID_HALF) / CELL));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cz * GN + cx;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const e = L[this.cellItems[k]];
          if (!e || !e.alive) continue;
          const dx = e.x - x, dz = e.z - z;
          const rr = r + e.r;
          if (dx * dx + dz * dz <= rr * rr) {
            if (fn(e) === false) return;
          }
        }
      }
    }
  }

  nearest(x, z, maxR = 30, exclude = null) {
    let best = null, bd = maxR * maxR;
    for (const e of this.list) {
      if (!e.alive || e === exclude || e.spawnT > 0.5) continue;
      const dx = e.x - x, dz = e.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  randomNear(x, z, maxR) {
    const pool = [];
    this.forEachNear(x, z, maxR, (e) => { if (e.spawnT <= 0.5) pool.push(e); });
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  // ------------------------------------------------------------------ simulation

  update(dt) {
    const g = this.game;
    const p = g.player;
    const px = p.pos.x, pz = p.pos.z;
    const L = this.list;
    // compact first so the grid built below stays valid for every query this frame
    for (let i = L.length - 1; i >= 0; i--) if (!L[i].alive) L.splice(i, 1);
    this.rebuildGrid();
    const arena = g.arena;

    for (let i = 0; i < L.length; i++) {
      const e = L[i];
      if (!e.alive) continue;
      e.t += dt;
      e.st += dt;
      e.flash = Math.max(0, e.flash - dt * 7);
      if (e.spawnT > 0) {
        e.spawnT = Math.max(0, e.spawnT - dt * 0.9);
        e.y += (e.def.y - e.y) * Math.min(1, dt * 3.5);
      }
      const dx = px - e.x, dz = pz - e.z;
      const dist = Math.hypot(dx, dz) || 1e-4;
      const nx = dx / dist, nz = dz / dist;
      let wantX = nx, wantZ = nz, sp = e.speed, accel = 5;
      const type = e.type;

      if (type === 'wisp') {
        const w = Math.sin(e.t * 3 + e.id) * 0.45;
        wantX += -nz * w;
        wantZ += nx * w;
      } else if (type === 'shard') {
        if (e.state === 'seek') {
          if (dist < 10 && e.spawnT <= 0 && e.st > 1) { e.state = 'aim'; e.st = 0; g.audio.shardAim?.(e); }
        } else if (e.state === 'aim') {
          sp = 0.2;
          e.dirX = nx; e.dirZ = nz;
          if (e.st > 0.6) { e.state = 'dash'; e.st = 0; g.audio.scoutLunge?.({ x: e.x, y: 1, z: e.z }); }
        } else if (e.state === 'dash') {
          wantX = e.dirX; wantZ = e.dirZ; sp = 18; accel = 30;
          if (e.st > 0.55) { e.state = 'rest'; e.st = 0; }
        } else if (e.state === 'rest') {
          sp = 1.2;
          if (e.st > 0.9) { e.state = 'seek'; e.st = 0; }
        }
      } else if (type === 'sentinel') {
        const pref = 11;
        const f = dist > pref + 2 ? 1 : dist < pref - 2 ? -1 : 0;
        const orbit = Math.sin(e.id) > 0 ? 1 : -1;
        wantX = nx * f + -nz * orbit * 0.8;
        wantZ = nz * f + nx * orbit * 0.8;
        e.fireT -= dt;
        if (e.state === 'seek' && e.fireT <= 0 && dist < 22 && e.spawnT <= 0) { e.state = 'charge'; e.st = 0; }
        if (e.state === 'charge') {
          sp = 0.3;
          if (e.st > 0.7) {
            e.state = 'seek';
            e.fireT = rand(2.4, 3.4) / (e.elite ? 1.6 : 1);
            const lead = 0.3;
            const tx = px + p.vel.x * lead - e.x, tz = pz + p.vel.z * lead - e.z;
            const tl = Math.hypot(tx, tz) || 1;
            const shots = e.elite ? 3 : 1;
            for (let s = 0; s < shots; s++) {
              const a = (s - (shots - 1) / 2) * 0.22;
              const cx = tx / tl, cz = tz / tl;
              const ux = cx * Math.cos(a) - cz * Math.sin(a), uz = cx * Math.sin(a) + cz * Math.cos(a);
              g.projectiles.enemyOrb(e.x + ux * 0.9, e.z + uz * 0.9, ux * 9.5, uz * 9.5, { dmg: e.def.dmg, owner: e });
            }
            g.audio.sentinelFire?.({ x: e.x, y: 2, z: e.z }, false);
          }
        }
      } else if (type === 'bomber') {
        if (e.state === 'seek' && dist < 2.4 && e.spawnT <= 0) { e.state = 'armed'; e.st = 0; g.audio.bomberArm?.(e); }
        if (e.state === 'armed') {
          sp = 0.4;
          if (e.st > 0.75) {
            this.explodeBomber(e, true);
            continue;
          }
        }
      } else if (type === 'bulwark') {
        accel = 2;
      }

      // separation from neighbours
      let sx = 0, sz = 0;
      const er = e.r;
      this.forEachNear(e.x, e.z, er + 1.4, (o) => {
        if (o === e) return;
        const ox = e.x - o.x, oz = e.z - o.z;
        const d = Math.hypot(ox, oz);
        const m = er + o.r + 0.1;
        if (d < m && d > 1e-4) {
          const push = (m - d) / m;
          sx += (ox / d) * push;
          sz += (oz / d) * push;
        }
      });

      const wl = Math.hypot(wantX, wantZ) || 1;
      const tvx = (wantX / wl) * sp + sx * 4, tvz = (wantZ / wl) * sp + sz * 4;
      const k = 1 - Math.exp(-accel * dt);
      e.vx += (tvx - e.vx) * k;
      e.vz += (tvz - e.vz) * k;
      // knockback decays separately
      e.kx *= Math.exp(-6 * dt);
      e.kz *= Math.exp(-6 * dt);
      e.x += (e.vx + e.kx) * dt;
      e.z += (e.vz + e.kz) * dt;

      // pillars
      for (const o of arena.obstacles) {
        if (o.stage > arena.solidStage) continue;
        const ox = e.x - o.x, oz = e.z - o.z;
        const d = Math.hypot(ox, oz);
        const m = o.r + e.r;
        if (d < m && d > 1e-4) {
          e.x = o.x + (ox / d) * m;
          e.z = o.z + (oz / d) * m;
        }
      }

      // facing
      const faceX = type === 'shard' && e.state !== 'seek' ? e.dirX : type === 'bulwark' ? nx : e.vx + nx * 0.5;
      const faceZ = type === 'shard' && e.state !== 'seek' ? e.dirZ : type === 'bulwark' ? nz : e.vz + nz * 0.5;
      const target = Math.atan2(faceX, faceZ);
      let dA = target - e.facing;
      while (dA > Math.PI) dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
      e.facing += dA * Math.min(1, dt * (type === 'bulwark' ? 1.6 : 10));

      // contact damage
      if (!p.dead && e.spawnT <= 0.2) {
        const cd = Math.hypot(px - e.x, pz - e.z);
        if (cd < e.r + 0.45) {
          const dmg = type === 'shard' && e.state === 'dash' ? e.def.dmg * 1.3 : type === 'shard' ? e.def.dmg * 0.4 : e.def.dmg;
          if (type !== 'bomber' || e.state === 'armed') p.hurt(dmg * (e.elite ? 1.5 : 1), e.x, e.z);
          else p.hurt(dmg * 0.4, e.x, e.z);
        }
      }
    }

  }

  /** Apply damage. Returns true when it kills. `opts.pierceShield` bypasses bulwark shields. */
  damage(e, dmg, dirX, dirZ, knock = 2, opts = {}) {
    if (!e.alive) return false;
    if (e.type === 'bulwark' && !opts.pierceShield) {
      const fx = Math.sin(e.facing), fz = Math.cos(e.facing);
      if (dirX * fx + dirZ * fz < -0.35) {
        dmg *= 0.15;
        opts.blocked = true;
      }
    }
    e.hp -= dmg;
    e.flash = 1;
    const mass = e.def.mass * (e.elite ? 3 : 1);
    e.kx += (dirX * knock) / mass;
    e.kz += (dirZ * knock) / mass;
    if (e.hp <= 0) {
      this.kill(e, opts.cause || 'hit');
      return true;
    }
    return false;
  }

  kill(e, cause) {
    if (!e.alive) return;
    e.alive = false;
    const g = this.game;
    if (e.type === 'splitter' && !e.mini && cause !== 'victory') {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + Math.random();
        const m = this.spawn('wisp', e.x + Math.cos(a) * 0.8, e.z + Math.sin(a) * 0.8, { mini: true, rise: false, hpMul: g.waves.hpMul });
        if (m) { m.kx = Math.cos(a) * 6; m.kz = Math.sin(a) * 6; m.y = e.y; }
      }
    }
    if (e.type === 'bomber' && cause !== 'selfdestruct' && cause !== 'victory') this.explodeBomber(e, false);
    g.onEnemyKilled(e, cause);
  }

  explodeBomber(e, hurtsPlayer) {
    const g = this.game;
    e.alive = false;
    const R = 3.6;
    g.onBomberExplode(e.x, e.z, R);
    if (hurtsPlayer) {
      const d = Math.hypot(g.player.pos.x - e.x, g.player.pos.z - e.z);
      if (d < R) g.player.hurt(e.def.dmg * (e.elite ? 1.5 : 1), e.x, e.z);
      g.onEnemyKilled(e, 'selfdestruct');
    }
    // chain reactions: bombers hurt their friends
    const victims = [];
    this.forEachNear(e.x, e.z, R, (o) => { if (o !== e) victims.push(o); });
    for (const o of victims) {
      const dx = o.x - e.x, dz = o.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      this.damage(o, 45 * g.waves.hpMul, dx / d, dz / d, 10, { pierceShield: true, cause: 'bomb' });
    }
  }

  // ------------------------------------------------------------------ rendering

  render(time) {
    const counts = {};
    for (const k in this.meshes) counts[k] = 0;
    let dc = 0, tc = 0;
    for (const e of this.list) {
      if (!e.alive) continue;
      const M = this.meshes[e.type];
      const i = counts[e.type]++;
      const bob = Math.sin(e.t * 2.4 + e.id) * 0.12;
      const s = e.scale * (e.spawnT > 0 ? 1 - e.spawnT * 0.6 : 1) * (e.state === 'armed' ? 1 + Math.sin(e.st * 40) * 0.12 : 1);
      let roll = 0, pitch = 0, yaw = e.facing;
      if (e.type === 'wisp') roll = Math.sin(e.t * 5) * 0.3;
      else if (e.type === 'splitter') { yaw = e.t * 1.5; pitch = e.t * 0.7; }
      else if (e.type === 'bomber') yaw = e.t * 4;
      else if (e.type === 'shard' && e.state === 'aim') roll = Math.sin(e.st * 60) * 0.15;
      _e.set(pitch, yaw, roll, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(e.x, e.y + bob, e.z), _q, _s.set(s, s, s));
      M.body.setMatrixAt(i, _m);
      M.glow.setMatrixAt(i, _m);
      // body: dark metal that flashes white when hit
      const f = e.flash;
      _c.setRGB(0.42 + f * 2.5, 0.42 + f * 2.5, 0.48 + f * 2.5);
      if (e.elite) _c.lerp(_gold, 0.35);
      M.body.setColorAt(i, _c);
      let gi = 2.3;
      if (e.state === 'aim' || e.state === 'charge') gi = 2.3 + e.st * 9;
      if (e.state === 'armed') gi = Math.sin(e.st * 40) > 0 ? 9 : 2;
      _c.copy(M.color);
      if (e.elite) _c.lerp(_gold, 0.55);
      _c.lerp(_white, f * 0.7).multiplyScalar(gi + f * 3);
      M.glow.setColorAt(i, _c);
      // floor glow
      if (dc < 1100) {
        const ds = e.r * 3.6 * (1 - e.spawnT);
        _q.identity();
        _m.compose(_p.set(e.x, 0.04, e.z), _q, _s.set(ds, 1, ds));
        this.decals.setMatrixAt(dc, _m);
        _c.copy(M.color).multiplyScalar(e.elite ? 0.45 : 0.16);
        this.decals.setColorAt(dc, _c);
        dc++;
      }
      if (e.type === 'shard' && e.state === 'aim' && tc < 80) {
        _e.set(0, Math.atan2(e.dirX, e.dirZ), 0);
        _q.setFromEuler(_e);
        _m.compose(_p.set(e.x, 0.06, e.z), _q, _s.set(0.25 + e.st * 0.6, 1, 11));
        this.telegraphs.setMatrixAt(tc++, _m);
      }
    }
    for (const k in this.meshes) {
      const M = this.meshes[k];
      M.body.count = counts[k];
      M.glow.count = counts[k];
      if (counts[k]) {
        M.body.instanceMatrix.needsUpdate = true;
        M.glow.instanceMatrix.needsUpdate = true;
        M.body.instanceColor.needsUpdate = true;
        M.glow.instanceColor.needsUpdate = true;
      }
    }
    this.decals.count = dc;
    if (dc) {
      this.decals.instanceMatrix.needsUpdate = true;
      this.decals.instanceColor.needsUpdate = true;
    }
    this.telegraphs.count = tc;
    if (tc) this.telegraphs.instanceMatrix.needsUpdate = true;
  }
}
