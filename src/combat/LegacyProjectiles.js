import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Segment–sphere intersection: returns t in [0,1] or -1. */
function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const fx = ax - cx, fy = ay - cy, fz = az - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-9) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/** Distance² from point to segment. */
function pointSegDist2(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const l = abx * abx + aby * aby + abz * abz;
  let t = l > 0 ? (apx * abx + apy * aby + apz * abz) / l : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + abx * t - px, qy = ay + aby * t - py, qz = az + abz * t - pz;
  return qx * qx + qy * qy + qz * qz;
}

/**
 * Player pulse bolts (fast cyan tracers) and hostile energy orbs (slow, dodgeable, deflectable).
 */
export class Projectiles {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.MAX_P = 90;
    this.MAX_E = 90;
    this.bolts = [];
    this.orbs = [];

    const boltGeo = new THREE.BoxGeometry(0.07, 0.07, 1.6);
    this.boltMesh = new THREE.InstancedMesh(boltGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), this.MAX_P);
    this.boltMesh.frustumCulled = false;
    for (let i = 0; i < this.MAX_P; i++) {
      this.boltMesh.setMatrixAt(i, ZERO);
      this.boltMesh.setColorAt(i, _c.set('#7ff6ff').multiplyScalar(5));
    }
    scene.add(this.boltMesh);

    const orbGeo = new THREE.IcosahedronGeometry(0.3, 2);
    this.orbMesh = new THREE.InstancedMesh(orbGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), this.MAX_E);
    this.orbMesh.frustumCulled = false;
    for (let i = 0; i < this.MAX_E; i++) {
      this.orbMesh.setMatrixAt(i, ZERO);
      this.orbMesh.setColorAt(i, _c.set('#ff7a1a').multiplyScalar(5));
    }
    scene.add(this.orbMesh);

    this.orbColor = new THREE.Color('#ff7a1a');
    this.reflectColor = new THREE.Color('#ff5ae0');
  }

  clear() {
    this.bolts.length = 0;
    this.orbs.length = 0;
  }

  firePlayer(pos, dir, { speed = 115, damage = 10, crit = false, color = null } = {}) {
    if (this.bolts.length >= this.MAX_P) this.bolts.shift();
    this.bolts.push({
      p: pos.clone(),
      v: dir.clone().multiplyScalar(speed),
      life: 1.1,
      damage,
      crit,
      color: color || (crit ? '#ffd36b' : '#7ff6ff'),
    });
  }

  fireEnemy(pos, vel, { damage = 15, homing = 0.6, radius = 0.32, owner = null, size = 1 } = {}) {
    if (this.orbs.length >= this.MAX_E) this.orbs.shift();
    this.orbs.push({ p: pos.clone(), v: vel.clone(), life: 7, damage, homing, radius, owner, size, reflected: false, age: 0 });
  }

  /** Blade deflect: turns hostile orbs in the arc into player-owned projectiles. */
  deflect(origin, forward, range, aimPoint) {
    let count = 0;
    for (const o of this.orbs) {
      if (o.reflected) continue;
      _d.subVectors(o.p, origin);
      const dist = _d.length();
      if (dist > range + 0.6) continue;
      _d.divideScalar(dist || 1);
      if (_d.x * forward.x + _d.z * forward.z < -0.1 && dist > 1.2) continue;
      o.reflected = true;
      o.life = 3;
      o.homing = 0;
      const target = this.game.enemies.nearestTo(o.p, 45, o.owner) || null;
      const tp = target ? target.pos : aimPoint;
      _n.subVectors(tp, o.p).normalize();
      o.v.copy(_n).multiplyScalar(48);
      o.damage = 70;
      count++;
      this.game.fx.burst(o.p, { count: 16, color: '#ff5ae0', speed: [3, 9], life: [0.2, 0.5], size: [0.1, 0.2] });
    }
    return count;
  }

  update(dt, worldScale, playerScale) {
    const g = this.game;
    const col = g.collision;
    const enemies = g.enemies.list;

    // ---- player bolts
    const pdt = dt * playerScale;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= pdt;
      const ax = b.p.x, ay = b.p.y, az = b.p.z;
      const bx = ax + b.v.x * pdt, by = ay + b.v.y * pdt, bz = az + b.v.z * pdt;
      const segLen = Math.hypot(bx - ax, by - ay, bz - az);
      _d.set(bx - ax, by - ay, bz - az).divideScalar(segLen || 1);
      const wallT = col.raycast(b.p, _d, segLen, _n);
      let best = wallT < Infinity ? wallT / (segLen || 1) : 2;
      let hitEnemy = null;
      for (const e of enemies) {
        if (!e.alive || e.warp > 0) continue;
        const t = segSphere(ax, ay, az, bx, by, bz, e.pos.x, e.pos.y, e.pos.z, e.radius + 0.1);
        if (t >= 0 && t < best) {
          best = t;
          hitEnemy = e;
        }
      }
      if (best <= 1) {
        const hx = ax + (bx - ax) * best, hy = ay + (by - ay) * best, hz = az + (bz - az) * best;
        _s.set(hx, hy, hz);
        if (hitEnemy) g.onBoltHitEnemy(b, hitEnemy, _s, _d);
        else g.onBoltHitWall(_s, _n, b);
        this.bolts.splice(i, 1);
        continue;
      }
      b.p.set(bx, by, bz);
      if (b.life <= 0) this.bolts.splice(i, 1);
    }

    // ---- hostile orbs
    const player = g.player;
    const pc = player.pos;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      const odt = dt * (o.reflected ? playerScale : worldScale);
      o.life -= odt;
      o.age += odt;
      if (!o.reflected && o.homing > 0 && !player.dead) {
        _d.set(pc.x - o.p.x, pc.y + 1.1 - o.p.y, pc.z - o.p.z).normalize();
        const sp = o.v.length();
        _n.copy(o.v).divideScalar(sp || 1);
        _n.lerp(_d, Math.min(1, o.homing * odt)).normalize();
        o.v.copy(_n).multiplyScalar(sp);
      }
      const ax = o.p.x, ay = o.p.y, az = o.p.z;
      const bx = ax + o.v.x * odt, by = ay + o.v.y * odt, bz = az + o.v.z * odt;
      const segLen = Math.hypot(bx - ax, by - ay, bz - az);
      _d.set(bx - ax, by - ay, bz - az).divideScalar(segLen || 1);
      const wallT = o.age > 0.05 ? col.raycast(o.p, _d, segLen, _n) : Infinity;
      let done = false;
      if (o.reflected) {
        for (const e of enemies) {
          if (!e.alive || e.warp > 0) continue;
          const t = segSphere(ax, ay, az, bx, by, bz, e.pos.x, e.pos.y, e.pos.z, e.radius + o.radius);
          if (t >= 0) {
            _s.set(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
            g.onReflectHit(o, e, _s);
            done = true;
            break;
          }
        }
      } else if (!player.dead) {
        // capsule test against the player
        const d2 = pointSegDist2(bx, by, bz, pc.x, pc.y + 0.35, pc.z, pc.x, pc.y + 1.6, pc.z);
        const r = 0.45 + o.radius;
        if (d2 < r * r) {
          if (player.takeDamage(o.damage, o.p, 'orb')) {
            g.fx.burst(o.p, { count: 24, color: '#ff7a1a', speed: [2, 8], life: [0.2, 0.6] });
            done = true;
          } else if (player.dashT > 0) {
            // dodged — let it pass through
          } else done = true;
        }
      }
      if (!done && wallT < Infinity) {
        _s.set(ax + _d.x * wallT, ay + _d.y * wallT, az + _d.z * wallT);
        g.onOrbHitWall(_s, o);
        done = true;
      }
      if (done || o.life <= 0) {
        this.orbs.splice(i, 1);
        continue;
      }
      o.p.set(bx, by, bz);
      if (Math.random() < 0.7) {
        const c = o.reflected ? '#ff5ae0' : '#ff8a2b';
        g.particles.spawn(o.p.x, o.p.y, o.p.z, (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5), 0.35, 0.22 * o.size, 0, _c.set(c).multiplyScalar(2.5), _c, 0, 1);
      }
    }

    this.render(g.time);
  }

  render(t) {
    for (let i = 0; i < this.MAX_P; i++) {
      const b = this.bolts[i];
      if (!b) {
        this.boltMesh.setMatrixAt(i, ZERO);
        continue;
      }
      _d.copy(b.v).normalize();
      _q.setFromUnitVectors(_z, _d);
      _s.set(b.crit ? 1.6 : 1, b.crit ? 1.6 : 1, 1);
      _m.compose(b.p, _q, _s);
      this.boltMesh.setMatrixAt(i, _m);
      this.boltMesh.setColorAt(i, _c.set(b.color).multiplyScalar(5));
    }
    this.boltMesh.instanceMatrix.needsUpdate = true;
    this.boltMesh.instanceColor.needsUpdate = true;

    for (let i = 0; i < this.MAX_E; i++) {
      const o = this.orbs[i];
      if (!o) {
        this.orbMesh.setMatrixAt(i, ZERO);
        continue;
      }
      const pulse = (1 + Math.sin(t * 20 + i) * 0.15) * o.size;
      _q.identity();
      _s.setScalar(pulse);
      _m.compose(o.p, _q, _s);
      this.orbMesh.setMatrixAt(i, _m);
      this.orbMesh.setColorAt(i, _c.copy(o.reflected ? this.reflectColor : this.orbColor).multiplyScalar(6));
    }
    this.orbMesh.instanceMatrix.needsUpdate = true;
    this.orbMesh.instanceColor.needsUpdate = true;
  }
}
