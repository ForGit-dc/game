import * as THREE from 'three';
import { damp, rand, clamp } from '../utils/math.js';

const TYPES = {
  scout: { hp: 28, radius: 0.55, speed: 11, detect: 26, score: 100, contact: 12, name: 'WISP' },
  guardian: { hp: 120, radius: 1.15, speed: 4.5, detect: 34, score: 250, orbDamage: 16, name: 'SENTINEL' },
  warden: { hp: 540, radius: 2.1, speed: 3.2, detect: 70, score: 1000, orbDamage: 14, name: 'WARDEN' },
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _chest = new THREE.Vector3();

let sharedMats = null;
function mats() {
  if (sharedMats) return sharedMats;
  sharedMats = {
    shell: new THREE.MeshStandardMaterial({ color: 0x22232f, roughness: 0.3, metalness: 0.9, envMapIntensity: 1.3 }),
    plate: new THREE.MeshStandardMaterial({ color: 0x3a3548, roughness: 0.4, metalness: 0.8 }),
    white: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6) }),
  };
  return sharedMats;
}

function buildScout() {
  const M = mats();
  const g = new THREE.Group();
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a55').multiplyScalar(4) });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), coreMat);
  g.add(core);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.36), M.shell);
  const bot = top.clone();
  bot.rotation.x = Math.PI;
  top.castShadow = bot.castShadow = true;
  g.add(top, bot);
  const spin = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.5), M.plate);
    const a = (i / 3) * Math.PI * 2;
    fin.position.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
    fin.rotation.y = -a;
    spin.add(fin);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.2), coreMat);
    tip.position.set(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8);
    tip.rotation.y = -a;
    spin.add(tip);
  }
  g.add(spin);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.white);
  eye.position.z = 0.42;
  g.add(eye);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.02, 6, 32), coreMat);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  return { group: g, coreMat, spin, core, baseColor: new THREE.Color('#ff2a55') };
}

function buildSentinel(scale = 1, color = '#ff7a1a') {
  const M = mats();
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(scale);
  g.add(inner);
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4) });
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0), M.shell);
  body.scale.set(1, 1.3, 1);
  body.castShadow = true;
  inner.add(body);
  const seams = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5) }));
  seams.scale.copy(body.scale).multiplyScalar(1.01);
  inner.add(seams);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.12), M.plate);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    p.position.set(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7);
    p.rotation.y = -a + Math.PI / 2;
    p.castShadow = true;
    inner.add(p);
  }
  const housing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 8, 24), M.plate);
  housing.position.z = 0.74;
  inner.add(housing);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), coreMat);
  eye.position.z = 0.7;
  inner.add(eye);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), M.white);
  pupil.position.z = 0.92;
  inner.add(pupil);
  const ringHolder = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.045, 6, 64), coreMat);
  ring.rotation.x = Math.PI / 2;
  ringHolder.add(ring);
  for (let i = 0; i < 4; i++) {
    const n = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), coreMat);
    const a = (i / 4) * Math.PI * 2;
    n.position.set(Math.cos(a) * 1.35, 0, Math.sin(a) * 1.35);
    ringHolder.add(n);
  }
  inner.add(ringHolder);
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.35, 8), coreMat);
    const a = (i / 4) * Math.PI * 2;
    t.position.set(Math.cos(a) * 0.4, -1.15, Math.sin(a) * 0.4);
    t.rotation.x = Math.PI;
    inner.add(t);
  }
  // aim laser (unit length along +Z, scaled at runtime)
  const laserMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const laserGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  laserGeo.rotateX(Math.PI / 2);
  laserGeo.translate(0, 0, 0.5);
  const laser = new THREE.Mesh(laserGeo, laserMat);
  laser.visible = false;
  laser.frustumCulled = false; // lives in world space, added to the scene by the drone
  // health bar
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(1.6 * scale, 0.1), new THREE.MeshBasicMaterial({ color: 0x220008, transparent: true, opacity: 0.7, depthWrite: false }));
  const barFill = new THREE.Mesh(new THREE.PlaneGeometry(1.6 * scale, 0.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), depthWrite: false }));
  barFill.geometry.translate(0.8 * scale, 0, 0);
  barFill.position.x = -0.8 * scale;
  barFill.position.z = 0.001;
  const bar = new THREE.Group();
  bar.add(barBg, barFill);
  bar.position.y = 1.9 * scale;
  bar.visible = false;
  g.add(bar);
  return { group: g, inner, coreMat, eye, ringHolder, laser, laserMat, bar, barFill, baseColor: new THREE.Color(color) };
}

export class Drone {
  constructor(game, type, pos, { warp = true, aware = false } = {}) {
    this.game = game;
    this.type = type;
    this.def = TYPES[type];
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.radius = this.def.radius;
    this.pos = pos.clone();
    this.home = pos.clone();
    this.vel = new THREE.Vector3();
    this.alive = true;
    this.dying = 0;
    this.remove = false;
    this.aware = aware;
    this.flash = 0;
    this.stun = 0;
    this.warp = warp ? 0.9 : 0;
    this.t = Math.random() * 10;
    this.state = 'patrol';
    this.stateT = 0;
    this.wanderT = 0;
    this.wander = pos.clone();
    this.orbitA = Math.random() * Math.PI * 2;
    this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    this.attackT = rand(1.5, 3);
    this.fireT = rand(1.8, 3);
    this.lungeHit = false;
    this.volley = 0;

    if (type === 'scout') this.v = buildScout();
    else if (type === 'guardian') this.v = buildSentinel(1, '#ff7a1a');
    else this.v = buildSentinel(1.9, '#ff2a55');
    this.group = this.v.group;
    this.group.position.copy(this.pos);
    if (this.warp > 0) this.group.scale.setScalar(0.01);
    game.scene.add(this.group);
    if (this.v.laser) game.scene.add(this.v.laser);
  }

  get chest() {
    return _chest;
  }

  hit(dmg, dir, force = 4) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flash = 1;
    this.aware = true;
    const mass = this.type === 'scout' ? 1 : this.type === 'guardian' ? 3 : 10;
    this.vel.addScaledVector(dir, force / mass);
    if (this.type === 'scout') this.stun = Math.max(this.stun, 0.12);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.dying = this.type === 'scout' ? 0 : this.type === 'guardian' ? 0.45 : 1.1;
      this.v.laser && (this.v.laser.visible = false);
      return true;
    }
    return false;
  }

  /** Interrupt a charging shot (blade hits). */
  interrupt() {
    if (this.state === 'charge') {
      this.state = 'engage';
      this.fireT = rand(1.2, 2);
      this.stun = 0.6;
      if (this.v.laser) this.v.laser.visible = false;
      return true;
    }
    return false;
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 8);

    if (this.warp > 0) {
      this.warp -= dt;
      const k = clamp(1 - this.warp / 0.9, 0, 1);
      const e = k < 0.7 ? k / 0.7 * 1.15 : 1.15 - (k - 0.7) / 0.3 * 0.15;
      this.group.scale.setScalar(Math.max(0.01, e));
      this.group.position.copy(this.pos);
      this.group.rotation.y += dt * 12 * (1 - k);
      if (this.warp <= 0) this.group.scale.setScalar(1);
      return;
    }

    if (!this.alive) {
      // death spiral for the big ones
      this.dying -= dt;
      this.vel.y -= 9 * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.group.position.copy(this.pos);
      this.group.rotation.y += dt * 9;
      this.group.rotation.z += dt * 3;
      if (Math.random() < 0.6) g.fx.burst(this.pos, { count: 3, color: '#ffb35c', speed: [2, 6], life: [0.2, 0.5], size: [0.1, 0.25] });
      if (this.dying <= 0 && !this.remove) {
        this.remove = true;
        g.onEnemyExploded(this);
      }
      return;
    }

    const player = g.player;
    _chest.set(player.pos.x, player.pos.y + 1.1, player.pos.z);
    const toP = _v.subVectors(_chest, this.pos);
    const dist = toP.length();

    if (!this.aware && !player.dead && dist < this.def.detect * (g.director.aggroMul || 1)) {
      if (dist < 9 || g.collision.raycast(this.pos, _dir.copy(toP).divideScalar(dist), dist) === Infinity) {
        this.aware = true;
        g.onEnemyAlert(this);
      }
    }
    if (player.dead) this.aware = false;

    if (this.stun > 0) {
      this.stun -= dt;
      this.vel.multiplyScalar(Math.exp(-4 * dt));
    } else if (this.type === 'scout') this.updateScout(dt, dist, toP);
    else this.updateSentinel(dt, dist, toP);

    // separation between drones
    for (const o of g.enemies.list) {
      if (o === this || !o.alive) continue;
      _v2.subVectors(this.pos, o.pos);
      const d = _v2.length();
      const min = this.radius + o.radius + 0.8;
      if (d > 0.001 && d < min) this.vel.addScaledVector(_v2.divideScalar(d), (min - d) * 6 * dt);
    }

    this.pos.addScaledVector(this.vel, dt);
    const touched = g.collision.resolveSphere(this.pos, this.radius);
    if (touched && this.state === 'lunge') {
      this.state = 'recover';
      this.stateT = 0;
      this.stun = 0.7;
      this.vel.multiplyScalar(-0.3);
      g.fx.burst(this.pos, { count: 12, color: '#ff2a55', speed: [2, 6], life: [0.2, 0.4] });
    }
    // never sink into the abyss or fly too far above the action
    if (this.pos.y < -20) this.pos.y = -20;

    this.render(dt, dist);
  }

  updateScout(dt, dist, toP) {
    const g = this.game;
    const player = g.player;
    this.stateT += dt;
    const desired = _v2;
    const sp = this.def.speed;
    if (!this.aware) {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = rand(2, 4);
        this.wander.set(this.home.x + rand(-6, 6), this.home.y + rand(-1.5, 2), this.home.z + rand(-6, 6));
      }
      desired.subVectors(this.wander, this.pos);
      const d = desired.length();
      desired.multiplyScalar(d > 0.1 ? Math.min(4, d) / d : 0);
      this.vel.lerp(desired, damp(2, dt));
      return;
    }
    if (this.state === 'patrol') this.state = 'orbit';

    if (this.state === 'orbit') {
      this.orbitA += this.orbitDir * dt * 0.9;
      const R = 7.5;
      desired.set(
        player.pos.x + Math.cos(this.orbitA) * R,
        player.pos.y + 2.4 + Math.sin(this.t * 1.7) * 0.9,
        player.pos.z + Math.sin(this.orbitA) * R,
      ).sub(this.pos);
      const d = desired.length();
      desired.multiplyScalar(d > 0.01 ? (sp * Math.min(1, d / 3)) / d : 0);
      this.vel.lerp(desired, damp(3, dt));
      this.attackT -= dt;
      if (this.attackT <= 0 && dist < 16 && !player.dead) {
        this.state = 'windup';
        this.stateT = 0;
        g.audio.scoutCharge(this.pos);
      }
    } else if (this.state === 'windup') {
      this.vel.multiplyScalar(Math.exp(-6 * dt));
      if (this.stateT > 0.55) {
        this.state = 'lunge';
        this.stateT = 0;
        this.lungeHit = false;
        _dir.set(player.pos.x + player.vel.x * 0.12, player.pos.y + 1.1, player.pos.z + player.vel.z * 0.12).sub(this.pos).normalize();
        this.vel.copy(_dir).multiplyScalar(25);
        g.audio.scoutLunge(this.pos);
      }
    } else if (this.state === 'lunge') {
      if (!this.lungeHit && dist < 1.25) {
        this.lungeHit = true;
        const hurt = player.takeDamage(this.def.contact, this.pos, 'lunge');
        if (hurt) this.vel.multiplyScalar(-0.4);
      }
      if (this.stateT > 0.5) {
        this.state = 'recover';
        this.stateT = 0;
      }
    } else if (this.state === 'recover') {
      desired.subVectors(this.pos, player.pos).setY(0).normalize().multiplyScalar(6);
      desired.y = 3;
      this.vel.lerp(desired, damp(3, dt));
      if (this.stateT > 0.8) {
        this.state = 'orbit';
        this.attackT = rand(1.3, 2.8) * (g.director.danger >= 4 ? 0.7 : 1);
      }
    }
  }

  updateSentinel(dt, dist, toP) {
    const g = this.game;
    const player = g.player;
    const isWarden = this.type === 'warden';
    this.stateT += dt;
    const desired = _v2;
    if (!this.aware) {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = rand(3, 5);
        this.wander.set(this.home.x + rand(-5, 5), this.home.y + rand(-1, 1.5), this.home.z + rand(-5, 5));
      }
      desired.subVectors(this.wander, this.pos);
      const d = desired.length();
      desired.multiplyScalar(d > 0.1 ? Math.min(2, d) / d : 0);
      this.vel.lerp(desired, damp(1.5, dt));
      return;
    }
    if (this.state === 'patrol') this.state = 'engage';

    // hold a firing position: preferred range, above the player, strafing
    const pref = isWarden ? 20 : 15;
    const flat = _dir.set(this.pos.x - player.pos.x, 0, this.pos.z - player.pos.z);
    const fl = flat.length() || 1;
    flat.divideScalar(fl);
    const strafe = _v.set(-flat.z, 0, flat.x).multiplyScalar(this.orbitDir);
    desired.copy(flat).multiplyScalar((pref - fl) * 0.6);
    desired.addScaledVector(strafe, isWarden ? 1.4 : 2.2);
    desired.y = (player.pos.y + (isWarden ? 8 : 5) - this.pos.y) * 0.8;
    if (desired.length() > this.def.speed) desired.setLength(this.def.speed);
    if (Math.random() < dt * 0.25) this.orbitDir *= -1;

    const hasLOS = () => {
      _v.set(player.pos.x, player.pos.y + 1.1, player.pos.z).sub(this.pos);
      const d = _v.length();
      return g.collision.raycast(this.pos, _v.divideScalar(d), d) === Infinity;
    };

    if (this.state === 'engage') {
      this.vel.lerp(desired, damp(1.8, dt));
      this.fireT -= dt;
      if (this.fireT <= 0 && dist < 55 && !player.dead) {
        if (hasLOS()) {
          this.state = 'charge';
          this.stateT = 0;
          g.audio.sentinelCharge(this.pos, isWarden);
        } else {
          this.fireT = 0.5;
          this.vel.y += 2;
        }
      }
    } else if (this.state === 'charge') {
      this.vel.multiplyScalar(Math.exp(-3 * dt));
      const chargeTime = isWarden ? 1.1 : 0.85;
      // telegraph laser
      const L = this.v.laser;
      L.visible = true;
      const eyePos = _v.set(0, 0, 0.75); // inner group already carries the warden scale
      this.v.inner.localToWorld(eyePos);
      L.position.copy(eyePos);
      const target = _chest.set(player.pos.x, player.pos.y + 1.1, player.pos.z);
      const len = eyePos.distanceTo(target);
      L.lookAt(target);
      const p = this.stateT / chargeTime;
      const w = 0.015 + p * 0.03;
      L.scale.set(w, w, len);
      this.v.laserMat.opacity = 0.25 + p * 0.75 * (0.6 + 0.4 * Math.sin(this.t * 60));
      if (this.stateT >= chargeTime) {
        L.visible = false;
        this.fire(eyePos, isWarden);
        this.state = 'engage';
        this.fireT = isWarden ? rand(2.6, 3.4) : rand(2.1, 3.1) * (g.director.danger >= 4 ? 0.75 : 1);
      }
    }
  }

  fire(from, isWarden) {
    const g = this.game;
    const player = g.player;
    const target = _v2.set(player.pos.x + player.vel.x * 0.35, player.pos.y + 1.0, player.pos.z + player.vel.z * 0.35);
    const base = _dir.subVectors(target, from).normalize();
    if (isWarden) {
      this.volley++;
      const n = this.volley % 3 === 0 ? 9 : 5;
      const spread = this.volley % 3 === 0 ? 0.5 : 0.22;
      for (let i = 0; i < n; i++) {
        const a = (i - (n - 1) / 2) * (spread / ((n - 1) / 2));
        const d = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
        g.projectiles.fireEnemy(from, d.multiplyScalar(14), { damage: this.def.orbDamage, homing: 0.2, owner: this, size: 1.3, radius: 0.4 });
      }
    } else {
      g.projectiles.fireEnemy(from, base.clone().multiplyScalar(16), { damage: this.def.orbDamage, homing: 0.55, owner: this });
    }
    g.audio.sentinelFire(from, isWarden);
    g.fx.burst(from, { count: 14, color: this.type === 'warden' ? '#ff2a55' : '#ff8a2b', speed: [2, 7], life: [0.15, 0.35] });
    this.vel.addScaledVector(base, -2);
  }

  render(dt, dist) {
    const g = this.game;
    const grp = this.group;
    const bob = Math.sin(this.t * 2.3) * 0.12;
    grp.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    const player = g.player;
    // face the player when aware, else face velocity
    const lookX = this.aware ? player.pos.x - this.pos.x : this.vel.x;
    const lookZ = this.aware ? player.pos.z - this.pos.z : this.vel.z;
    if (Math.abs(lookX) + Math.abs(lookZ) > 0.01) {
      const yaw = Math.atan2(lookX, lookZ);
      let d = yaw - grp.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      grp.rotation.y += d * damp(this.type === 'scout' ? 10 : 4, dt);
    }
    const v = this.v;
    const c = v.coreMat.color;
    let intensity = 4;
    if (this.type === 'scout') {
      v.spin.rotation.y += dt * (this.state === 'windup' ? 30 : 8);
      grp.rotation.z = -this.vel.x * 0.02;
      if (this.state === 'windup') {
        intensity = 4 + (this.stateT / 0.55) * 8 * (Math.sin(this.t * 50) > 0 ? 1 : 0.4);
        grp.position.x += (Math.random() - 0.5) * 0.08;
        grp.position.y += (Math.random() - 0.5) * 0.08;
      }
      if (this.state === 'lunge' && Math.random() < 0.8) g.fx.burst(this.pos, { count: 2, color: '#ff2a55', speed: [0.5, 1.5], life: [0.2, 0.4], size: [0.15, 0.3] });
    } else {
      v.ringHolder.rotation.y += dt * (this.state === 'charge' ? 6 : 1.2);
      v.ringHolder.rotation.x = Math.sin(this.t * 0.8) * 0.2;
      if (this.state === 'charge') intensity = 4 + (this.stateT / 0.85) * 6;
      if (v.bar) {
        v.bar.visible = this.hp < this.maxHp;
        v.barFill.scale.x = Math.max(0.001, this.hp / this.maxHp);
        v.bar.quaternion.copy(g.camera.quaternion);
        v.bar.quaternion.premultiply(_invQ.copy(grp.quaternion).invert());
      }
    }
    c.copy(v.baseColor).lerp(_white, this.flash).multiplyScalar(intensity + this.flash * 4);
  }

  dispose() {
    this.game.scene.remove(this.group);
    if (this.v.laser) this.game.scene.remove(this.v.laser);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}

const _white = new THREE.Color(1, 1, 1);
const _invQ = new THREE.Quaternion();

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(type, pos, opts = {}) {
    const d = new Drone(this.game, type, pos, opts);
    this.list.push(d);
    if (d.warp > 0) this.game.onEnemyWarp(d);
    return d;
  }

  update(dt) {
    for (const e of this.list) e.update(dt);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.remove) {
        e.dispose();
        this.list.splice(i, 1);
      }
    }
  }

  count(type = null) {
    let n = 0;
    for (const e of this.list) if (e.alive && (!type || e.type === type)) n++;
    return n;
  }

  nearestTo(p, maxDist = Infinity, exclude = null) {
    let best = null;
    let bd = maxDist * maxDist;
    for (const e of this.list) {
      if (!e.alive || e === exclude || e.warp > 0) continue;
      const d = e.pos.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  awareCount(maxDist, p) {
    let n = 0;
    for (const e of this.list) if (e.alive && e.aware && e.pos.distanceTo(p) < maxDist) n++;
    return n;
  }

  clear() {
    for (const e of this.list) e.dispose();
    this.list.length = 0;
  }
}
