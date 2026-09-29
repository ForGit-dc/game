import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const SHOT_Y = 1.15;

/** Segment (a→b) vs circle; returns entry t in [0,1] or -1. */
function segCircle(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - cx, fz = az - cz;
  const a = dx * dx + dz * dz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

function instanced(scene, geo, cap, order = 4) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), cap);
  m.frustumCulled = false;
  m.count = 0;
  m.renderOrder = order;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < cap; i++) {
    m.setMatrixAt(i, ZERO);
    m.setColorAt(i, _c.set(1, 1, 1));
  }
  scene.add(m);
  return m;
}

/**
 * Everything that flies: courier bolts, hostile orbs (dodge / deflect them), homing missiles,
 * plus short-lived visuals for hitscan rays and chain lightning.
 */
export class Projectiles {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.bolts = [];
    this.orbs = [];
    this.missiles = [];
    this.rays = [];
    this.zaps = [];
    this.boltMesh = instanced(scene, new THREE.BoxGeometry(0.09, 0.09, 1.5), 420);
    this.orbMesh = instanced(scene, new THREE.IcosahedronGeometry(0.3, 2), 600);
    const mg = new THREE.ConeGeometry(0.1, 0.5, 6);
    mg.rotateX(Math.PI / 2);
    this.missileMesh = instanced(scene, mg, 160);
    const rg = new THREE.BoxGeometry(1, 1, 1);
    rg.translate(0, 0, 0.5);
    this.rayMesh = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 80);
    this.rayMesh.frustumCulled = false;
    this.rayMesh.count = 0;
    for (let i = 0; i < 80; i++) this.rayMesh.setColorAt(i, _c.set(1, 1, 1));
    scene.add(this.rayMesh);
    // chain lightning: a big dynamic line buffer
    this.ZMAX = 900;
    this.zapPos = new Float32Array(this.ZMAX * 6);
    this.zapCol = new Float32Array(this.ZMAX * 6);
    const zg = new THREE.BufferGeometry();
    zg.setAttribute('position', new THREE.BufferAttribute(this.zapPos, 3).setUsage(THREE.DynamicDrawUsage));
    zg.setAttribute('color', new THREE.BufferAttribute(this.zapCol, 3).setUsage(THREE.DynamicDrawUsage));
    zg.setDrawRange(0, 0);
    this.zapLines = new THREE.LineSegments(zg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.zapLines.frustumCulled = false;
    scene.add(this.zapLines);
    this.orbColor = new THREE.Color('#ff7a1a');
    this.reflectColor = new THREE.Color('#ff5ae0');
  }

  clear() {
    this.bolts.length = 0;
    this.orbs.length = 0;
    this.missiles.length = 0;
    this.rays.length = 0;
    this.zaps.length = 0;
  }

  // ------------------------------------------------------------------ spawning

  bolt(x, z, dx, dz, { dmg = 10, speed = 62, pierce = 0, crit = false, color = '#7ff6ff', size = 1, life = 0.85, shield = false } = {}) {
    if (this.bolts.length >= 420) this.bolts.shift();
    this.bolts.push({ x, z, vx: dx * speed, vz: dz * speed, dmg, pierce, crit, color: new THREE.Color(color), size, life, shield, hits: null });
  }

  enemyOrb(x, z, vx, vz, { dmg = 14, owner = null, size = 1, homing = 0, life = 7 } = {}) {
    if (this.orbs.length >= 600) this.orbs.shift();
    this.orbs.push({ x, z, vx, vz, dmg, owner, size, r: 0.3 * size, homing, life, reflected: false, age: 0 });
  }

  missile(x, z, dx, dz, target, { dmg = 16, splash = 1.4, split = false, speed = 20 } = {}) {
    if (this.missiles.length >= 160) return;
    this.missiles.push({ x, z, vx: dx * speed * 0.6, vz: dz * speed * 0.6, target, dmg, splash, split, speed, life: 3.2, y: SHOT_Y + 0.6 });
  }

  /** Visual-only hitscan ray. */
  ray(ax, az, bx, bz, color = '#7ff6ff', width = 0.12, life = 0.14, y = SHOT_Y) {
    if (this.rays.length >= 80) this.rays.shift();
    this.rays.push({ ax, az, bx, bz, y, color: new THREE.Color(color), width, life, max: life });
  }

  /** Visual-only jagged lightning through a list of [x, y, z] points. */
  zap(points, color = '#9fe8ff', life = 0.18) {
    this.zaps.push({ points, color: new THREE.Color(color), life, max: life, seed: Math.random() * 100 });
    if (this.zaps.length > 60) this.zaps.shift();
  }

  /** Blade deflection: hostile orbs in the arc become the courier's. */
  deflect(ox, oz, fx, fz, range, arcCos) {
    let n = 0;
    const g = this.game;
    for (const o of this.orbs) {
      if (o.reflected) continue;
      const dx = o.x - ox, dz = o.z - oz;
      const d = Math.hypot(dx, dz);
      if (d > range + 0.6) continue;
      if ((dx * fx + dz * fz) / (d || 1) < arcCos && d > 1.3) continue;
      o.reflected = true;
      o.life = 2.5;
      o.homing = 0;
      const tgt = g.horde.nearest(o.x, o.z, 30) || g.nearestBoss(o.x, o.z);
      let tx = fx, tz = fz;
      if (tgt) {
        tx = tgt.x - o.x;
        tz = tgt.z - o.z;
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
      }
      o.vx = tx * 36;
      o.vz = tz * 36;
      o.dmg = 55 * g.player.stats.dmgMul;
      n++;
      g.particles.burst(_p.set(o.x, SHOT_Y, o.z), { count: 14, color: '#ff5ae0', speed: [3, 9], life: [0.2, 0.5], size: [0.1, 0.2] });
    }
    return n;
  }

  // ------------------------------------------------------------------ simulation

  update(dt, worldScale, playerScale) {
    const g = this.game;
    const horde = g.horde;
    const arena = g.arena;
    const player = g.player;
    const pdt = dt * playerScale;
    const wdt = dt * worldScale;

    // ---- courier bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= pdt;
      const ax = b.x, az = b.z;
      const bx = ax + b.vx * pdt, bz = az + b.vz * pdt;
      let wallT = arena.hitsObstacle(ax, az, bx, bz, 0.05);
      const limit = wallT >= 0 ? wallT : 1;
      const segLen = Math.hypot(bx - ax, bz - az) || 1e-4;
      const dx = (bx - ax) / segLen, dz = (bz - az) / segLen;
      const midx = (ax + bx) / 2, midz = (az + bz) / 2;
      let dead = false;
      const hits = [];
      horde.forEachNear(midx, midz, segLen / 2 + 0.5, (e) => {
        if (e.spawnT > 0.6 || (b.hits && b.hits.has(e.id))) return;
        const t = segCircle(ax, az, bx, bz, e.x, e.z, e.r + 0.08 * b.size);
        if (t >= 0 && t <= limit) hits.push([t, e]);
      });
      hits.sort((p, q) => p[0] - q[0]);
      for (const [t, e] of hits) {
        if (!b.hits) b.hits = new Set();
        b.hits.add(e.id);
        g.hitEnemy(e, b.dmg, dx, dz, 2.2, { crit: b.crit, x: ax + (bx - ax) * t, z: az + (bz - az) * t, pierceShield: b.shield, bolt: true });
        if (b.pierce-- <= 0) {
          dead = true;
          break;
        }
      }
      if (!dead) {
        for (const boss of g.bosses) {
          if (boss.invulnerable || (b.hits && b.hits.has(boss))) continue;
          const t = segCircle(ax, az, bx, bz, boss.x, boss.z, boss.r);
          if (t >= 0 && t <= limit) {
            g.hitBoss(boss, b.dmg, b.crit, ax + (bx - ax) * t, az + (bz - az) * t);
            if (!b.hits) b.hits = new Set();
            b.hits.add(boss);
            if (b.pierce-- <= 0) { dead = true; break; }
          }
        }
      }
      if (!dead && wallT >= 0) {
        g.particles.burst(_p.set(ax + (bx - ax) * wallT, SHOT_Y, az + (bz - az) * wallT), { count: 5, color: '#' + b.color.getHexString(), speed: [2, 6], life: [0.1, 0.3], size: [0.04, 0.1], gravity: 6 });
        dead = true;
      }
      if (dead || b.life <= 0) {
        this.bolts.splice(i, 1);
        continue;
      }
      b.x = bx;
      b.z = bz;
    }

    // ---- hostile orbs
    const px = player.pos.x, pz = player.pos.z;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      const odt = o.reflected ? pdt : wdt;
      o.life -= odt;
      o.age += odt;
      if (!o.reflected && o.homing > 0 && !player.dead) {
        const sp = Math.hypot(o.vx, o.vz);
        const tx = px - o.x, tz = pz - o.z;
        const tl = Math.hypot(tx, tz) || 1;
        const k = Math.min(1, o.homing * odt);
        o.vx += ((tx / tl) * sp - o.vx) * k;
        o.vz += ((tz / tl) * sp - o.vz) * k;
      }
      const ax = o.x, az = o.z;
      const bx = ax + o.vx * odt, bz = az + o.vz * odt;
      let done = false;
      const wallT = o.age > 0.05 ? arena.hitsObstacle(ax, az, bx, bz, o.r) : -1;
      if (o.reflected) {
        const hits = [];
        horde.forEachNear(bx, bz, 1.5, (e) => {
          if (segCircle(ax, az, bx, bz, e.x, e.z, e.r + o.r) >= 0) hits.push(e);
        });
        for (const e of hits) g.hitEnemy(e, o.dmg, o.vx / 36, o.vz / 36, 8, { big: true, x: o.x, z: o.z, pierceShield: true });
        if (hits.length) {
          o.pierceLeft = (o.pierceLeft ?? 3) - hits.length;
          if (o.pierceLeft <= 0) done = true;
        }
        for (const boss of g.bosses) {
          if (!boss.invulnerable && segCircle(ax, az, bx, bz, boss.x, boss.z, boss.r + o.r) >= 0) {
            g.hitBoss(boss, o.dmg * 2, true, o.x, o.z);
            done = true;
          }
        }
      } else if (!player.dead) {
        const t = segCircle(ax, az, bx, bz, px, pz, 0.45 + o.r);
        if (t >= 0) {
          const res = player.hurt(o.dmg, o.x, o.z);
          if (res === true) {
            g.particles.burst(_p.set(o.x, SHOT_Y, o.z), { count: 18, color: '#ff7a1a', speed: [2, 7], life: [0.2, 0.5] });
            done = true;
          } else if (res === 'shielded') done = true;
        }
      }
      if (!done && wallT >= 0) {
        g.particles.burst(_p.set(ax + (bx - ax) * wallT, SHOT_Y, az + (bz - az) * wallT), { count: 10, color: o.reflected ? '#ff5ae0' : '#ff8a2b', speed: [2, 6], life: [0.15, 0.35] });
        done = true;
      }
      if (!done && (o.x * o.x + o.z * o.z > 70 * 70)) done = true;
      if (done || o.life <= 0) {
        this.orbs.splice(i, 1);
        continue;
      }
      o.x = bx;
      o.z = bz;
    }

    // ---- missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= pdt;
      let t = m.target;
      if (!t || !(t.alive ?? true) || t.hp <= 0) {
        t = m.target = horde.nearest(m.x, m.z, 22) || g.nearestBoss(m.x, m.z);
      }
      const sp = m.speed;
      if (t) {
        const tx = t.x - m.x, tz = t.z - m.z;
        const tl = Math.hypot(tx, tz) || 1;
        const k = Math.min(1, pdt * 6);
        m.vx += ((tx / tl) * sp - m.vx) * k;
        m.vz += ((tz / tl) * sp - m.vz) * k;
        if (tl < (t.r || 1) + 0.4) {
          this.explodeMissile(m);
          this.missiles.splice(i, 1);
          continue;
        }
      }
      const vl = Math.hypot(m.vx, m.vz) || 1;
      if (vl < sp) { m.vx *= 1 + pdt * 3; m.vz *= 1 + pdt * 3; }
      m.x += m.vx * pdt;
      m.z += m.vz * pdt;
      m.y += (SHOT_Y - m.y) * Math.min(1, pdt * 3);
      if (Math.random() < 0.8) g.particles.spawn(m.x, m.y, m.z, 0, 0.3, 0, 0.35, 0.16, 0, _c.set('#ffb35c').multiplyScalar(2.5), _c2.set('#ff2a55'), 0, 1);
      if (m.life <= 0) {
        this.explodeMissile(m);
        this.missiles.splice(i, 1);
      }
    }

    // ---- fade visuals
    for (let i = this.rays.length - 1; i >= 0; i--) {
      this.rays[i].life -= dt;
      if (this.rays[i].life <= 0) this.rays.splice(i, 1);
    }
    for (let i = this.zaps.length - 1; i >= 0; i--) {
      this.zaps[i].life -= dt;
      if (this.zaps[i].life <= 0) this.zaps.splice(i, 1);
    }
  }

  explodeMissile(m) {
    const g = this.game;
    g.areaDamage(m.x, m.z, m.splash, m.dmg, { color: '#ffb35c', knock: 4, cause: 'missile' });
    g.particles.burst(_p.set(m.x, SHOT_Y, m.z), { count: 16, color: '#ffd36b', colorEnd: '#ff2a55', speed: [2, 8], life: [0.2, 0.45], size: [0.1, 0.25] });
    g.audio.missileHit?.(_p);
    if (m.split) {
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * Math.PI * 2;
        this.missiles.push({ x: m.x, z: m.z, vx: Math.cos(a) * 12, vz: Math.sin(a) * 12, target: g.horde.randomNear(m.x, m.z, 10), dmg: m.dmg * 0.6, splash: m.splash * 0.8, split: false, speed: m.speed, life: 1.6, y: SHOT_Y });
      }
    }
  }

  // ------------------------------------------------------------------ rendering

  render(t) {
    let n = 0;
    for (const b of this.bolts) {
      _d.set(b.vx, 0, b.vz).normalize();
      _q.setFromUnitVectors(_z, _d);
      const s = b.size * (b.crit ? 1.5 : 1);
      _m.compose(_p.set(b.x, SHOT_Y, b.z), _q, _s.set(s, s, 1 + b.size * 0.3));
      this.boltMesh.setMatrixAt(n, _m);
      this.boltMesh.setColorAt(n, _c.copy(b.color).multiplyScalar(b.crit ? 7 : 5));
      n++;
    }
    this.boltMesh.count = n;
    if (n) { this.boltMesh.instanceMatrix.needsUpdate = true; this.boltMesh.instanceColor.needsUpdate = true; }

    n = 0;
    for (const o of this.orbs) {
      const pulse = (1 + Math.sin(t * 18 + n) * 0.15) * o.size;
      _q.identity();
      _m.compose(_p.set(o.x, SHOT_Y, o.z), _q, _s.setScalar(pulse));
      this.orbMesh.setMatrixAt(n, _m);
      this.orbMesh.setColorAt(n, _c.copy(o.reflected ? this.reflectColor : this.orbColor).multiplyScalar(6));
      n++;
    }
    this.orbMesh.count = n;
    if (n) { this.orbMesh.instanceMatrix.needsUpdate = true; this.orbMesh.instanceColor.needsUpdate = true; }

    n = 0;
    for (const m of this.missiles) {
      _d.set(m.vx, 0, m.vz).normalize();
      _q.setFromUnitVectors(_z, _d);
      _m.compose(_p.set(m.x, m.y, m.z), _q, _s.set(1, 1, 1));
      this.missileMesh.setMatrixAt(n, _m);
      this.missileMesh.setColorAt(n, _c.set('#ffd36b').multiplyScalar(5));
      n++;
    }
    this.missileMesh.count = n;
    if (n) { this.missileMesh.instanceMatrix.needsUpdate = true; this.missileMesh.instanceColor.needsUpdate = true; }

    n = 0;
    for (const r of this.rays) {
      const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
      const k = r.life / r.max;
      _q.setFromAxisAngle(_up, Math.atan2(r.bx - r.ax, r.bz - r.az));
      _m.compose(_p.set(r.ax, r.y, r.az), _q, _s.set(r.width * (0.4 + k), r.width * (0.4 + k), len));
      this.rayMesh.setMatrixAt(n, _m);
      this.rayMesh.setColorAt(n, _c.copy(r.color).multiplyScalar(5 * k));
      n++;
    }
    this.rayMesh.count = n;
    if (n) { this.rayMesh.instanceMatrix.needsUpdate = true; this.rayMesh.instanceColor.needsUpdate = true; }

    // lightning
    let v = 0;
    const P = this.zapPos, Cc = this.zapCol;
    for (const z of this.zaps) {
      const k = z.life / z.max;
      const pts = z.points;
      for (let i = 0; i < pts.length - 1 && v < this.ZMAX - 8; i++) {
        const [ax, ay, az] = pts[i];
        const [bx, by, bz] = pts[i + 1];
        const segs = 6;
        let lx = ax, ly = ay, lz = az;
        for (let s = 1; s <= segs; s++) {
          const f = s / segs;
          const j = s === segs ? 0 : 0.45;
          const nx = ax + (bx - ax) * f + (Math.random() - 0.5) * j;
          const ny = ay + (by - ay) * f + (Math.random() - 0.5) * j;
          const nz = az + (bz - az) * f + (Math.random() - 0.5) * j;
          P.set([lx, ly, lz, nx, ny, nz], v * 6);
          const br = 4 * k;
          Cc.set([z.color.r * br, z.color.g * br, z.color.b * br, z.color.r * br, z.color.g * br, z.color.b * br], v * 6);
          v++;
          lx = nx; ly = ny; lz = nz;
        }
      }
    }
    const zg = this.zapLines.geometry;
    zg.setDrawRange(0, v * 2);
    zg.attributes.position.needsUpdate = true;
    zg.attributes.color.needsUpdate = true;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
export { SHOT_Y };
