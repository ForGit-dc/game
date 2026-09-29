import * as THREE from 'three';
import { rand, clamp } from '../utils/math.js';

const _v = new THREE.Vector3();

function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const l = abx * abx + abz * abz;
  let t = l > 0 ? ((px - ax) * abx + (pz - az) * abz) / l : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(ax + abx * t - px, az + abz * t - pz);
}

/** A ground-level beam (laser sweep, lightning trail). Unit box stretched from A along +Z. */
class Beam {
  constructor(scene, color) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, 0.5);
    this.color = new THREE.Color(color);
    this.mat = new THREE.MeshBasicMaterial({ color: this.color.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mesh.add(this.core);
    this.core.scale.set(0.3, 0.3, 1);
    scene.add(this.mesh);
  }

  set(ax, az, bx, bz, y, width, intensity, telegraph = false) {
    const len = Math.hypot(bx - ax, bz - az);
    this.mesh.visible = true;
    this.mesh.position.set(ax, y, az);
    this.mesh.rotation.set(0, Math.atan2(bx - ax, bz - az), 0);
    this.mesh.scale.set(width, telegraph ? 0.05 : width * 0.8, len);
    this.mat.color.copy(this.color).multiplyScalar(intensity);
    this.core.visible = !telegraph;
  }

  hide() {
    this.mesh.visible = false;
  }

  dispose(scene) {
    scene.remove(this.mesh);
  }
}

class Boss {
  constructor(game, { name, title, hp, r, y, color }) {
    this.game = game;
    this.name = name;
    this.title = title;
    this.hp = hp;
    this.maxHp = hp;
    this.r = r;
    this.hoverY = y;
    this.color = new THREE.Color(color);
    this.pos = new THREE.Vector3(0, -30, -34);
    this.vel = new THREE.Vector3();
    this.alive = true;
    this.intro = 3.2;
    this.t = 0;
    this.flash = 0;
    this.attackT = 2;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.glowMats = [];
    this.beams = [];
    this.dying = 0;
  }

  get x() { return this.pos.x; }
  get z() { return this.pos.z; }
  get invulnerable() { return this.intro > 0 || !this.alive; }

  glow(color, k = 4) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
    this.glowMats.push({ m, base: new THREE.Color(color), k });
    return m;
  }

  beam(color) {
    const b = new Beam(this.game.scene, color);
    this.beams.push(b);
    return b;
  }

  damage(dmg) {
    if (this.invulnerable) return false;
    this.hp -= dmg;
    this.flash = 1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.dying = 1.6;
      for (const b of this.beams) b.hide();
      this.game.onBossDying(this);
      return true;
    }
    return false;
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    if (!this.alive) {
      this.dying -= dt;
      this.pos.y -= dt * 1.5;
      this.group.rotation.y += dt * 2;
      if (Math.random() < 0.5) g.onBossSpark(this);
      if (this.dying <= 0 && !this.removed) {
        this.removed = true;
        g.onBossKilled(this);
      }
      this.render(dt);
      return;
    }
    if (this.intro > 0) {
      this.intro -= dt;
      const k = 1 - Math.max(0, this.intro) / 3.2;
      this.pos.y = -30 + (this.hoverY + 30) * (1 - Math.pow(1 - k, 3));
      this.pos.z += ((this.homeZ ?? -18) - this.pos.z) * Math.min(1, dt * 1.2);
      this.render(dt);
      return;
    }
    this.think(dt);
    // keep hovering inside the arena
    const lim = g.arena.boundary - this.r - 0.5;
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > lim) {
      this.pos.x *= lim / rr;
      this.pos.z *= lim / rr;
    }
    this.pos.y += (this.hoverY + Math.sin(this.t * 1.3) * 0.25 - this.pos.y) * Math.min(1, dt * 3);
    // contact damage
    const p = g.player;
    if (!p.dead && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < this.r + 0.5) p.hurt(this.contact || 20, this.pos.x, this.pos.z);
    this.render(dt);
  }

  render() {
    this.group.position.copy(this.pos);
    for (const g of this.glowMats) g.m.color.copy(g.base).lerp(_white, this.flash * 0.6).multiplyScalar(g.k + this.flash * 4);
  }

  faceYaw(x, z) {
    return Math.atan2(x - this.pos.x, z - this.pos.z);
  }

  orbRing(n, speed, offset = 0, { gap = 0, gapAt = 0, dmg = 14, size = 1 } = {}) {
    const g = this.game;
    for (let i = 0; i < n; i++) {
      const a = offset + (i / n) * Math.PI * 2;
      if (gap > 0) {
        let d = Math.abs(((a - gapAt + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < (gap / n) * Math.PI) continue;
      }
      g.projectiles.enemyOrb(this.pos.x + Math.sin(a) * this.r, this.pos.z + Math.cos(a) * this.r, Math.sin(a) * speed, Math.cos(a) * speed, { dmg, owner: this, size });
    }
  }

  fan(n, spread, speed, { dmg = 14, size = 1 } = {}) {
    const g = this.game;
    const p = g.player.pos;
    const base = this.faceYaw(p.x, p.z);
    for (let i = 0; i < n; i++) {
      const a = base + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
      g.projectiles.enemyOrb(this.pos.x + Math.sin(a) * this.r, this.pos.z + Math.cos(a) * this.r, Math.sin(a) * speed, Math.cos(a) * speed, { dmg, owner: this, size });
    }
  }

  dispose() {
    this.game.scene.remove(this.group);
    for (const b of this.beams) b.dispose(this.game.scene);
  }
}

const _white = new THREE.Color(1, 1, 1);

// ====================================================================== HIVE MOTHER

export class HiveMother extends Boss {
  constructor(game, hpMul = 1) {
    super(game, { name: 'HIVE MOTHER', title: 'CARRIER OF A THOUSAND WISPS', hp: 2400 * hpMul, r: 2.8, y: 3.8, color: '#ff5a2a' });
    const M = game.horde.meshes.wisp.body.material;
    // shell of floating hex-ish plates around a molten core
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(2.0, 2), this.glow('#ff5a2a', 3));
    this.group.add(core);
    this.shell = new THREE.Group();
    const ico = new THREE.IcosahedronGeometry(2.7, 1).toNonIndexed();
    const pos = ico.attributes.position;
    for (let f = 0; f < pos.count; f += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, f);
      const b = new THREE.Vector3().fromBufferAttribute(pos, f + 1);
      const c = new THREE.Vector3().fromBufferAttribute(pos, f + 2);
      const ctr = a.clone().add(b).add(c).divideScalar(3);
      const shrink = (v) => v.clone().lerp(ctr, 0.18).sub(ctr);
      const geo = new THREE.BufferGeometry().setFromPoints([shrink(a), shrink(b), shrink(c)]);
      geo.computeVertexNormals();
      const plate = new THREE.Mesh(geo, M.clone());
      plate.material.side = THREE.DoubleSide;
      plate.material.color.setRGB(0.25, 0.22, 0.28);
      plate.position.copy(ctr).multiplyScalar(1.05);
      this.shell.add(plate);
    }
    this.group.add(this.shell);
    this.ports = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const port = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.9, 8), this.glow('#ffd36b', 4));
      port.position.set(Math.cos(a) * 2.9, Math.sin(i * 2.1) * 0.8, Math.sin(a) * 2.9);
      port.lookAt(0, 0, 0);
      port.rotateX(Math.PI / 2);
      this.shell.add(port);
    }
    this.orbiters = [];
    for (let i = 0; i < 7; i++) {
      const o = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), this.glow('#ff2a55', 4));
      this.group.add(o);
      this.orbiters.push(o);
    }
    this.lasers = [this.beam('#ff5a2a'), this.beam('#ff5a2a'), this.beam('#ff5a2a'), this.beam('#ff5a2a')];
    this.orbitA = -Math.PI / 2;
    this.pattern = ['swarm', 'lasers', 'ring', 'swarm', 'lasers', 'ring'];
    this.pi = 0;
    this.state = 'idle';
    this.st = 0;
    this.contact = 18;
    this.homeZ = -12;
  }

  think(dt) {
    const g = this.game;
    const p = g.player.pos;
    this.st += dt;
    const enraged = this.hp < this.maxHp * 0.5;
    // slow orbit around the ring's centre
    this.orbitA += dt * (enraged ? 0.2 : 0.13);
    const R = 11;
    const tx = Math.cos(this.orbitA) * R, tz = Math.sin(this.orbitA) * R;
    this.pos.x += (tx - this.pos.x) * Math.min(1, dt * 0.8);
    this.pos.z += (tz - this.pos.z) * Math.min(1, dt * 0.8);

    if (this.state === 'idle') {
      this.attackT -= dt;
      if (this.attackT <= 0) {
        this.state = this.pattern[this.pi++ % this.pattern.length];
        this.st = 0;
        this.fresh = true;
        if (this.state === 'lasers') {
          this.laserN = enraged ? 4 : 3;
          this.laserA = this.faceYaw(p.x, p.z) + Math.PI / this.laserN;
          this.laserDir = Math.random() < 0.5 ? 1 : -1;
          g.audio.bossCharge?.(this.pos, 1.1);
        }
      }
    } else if (this.state === 'swarm') {
      if (this.fresh) {
        this.fresh = false;
        for (let i = 0; i < (enraged ? 10 : 7); i++) {
          const a = (i / 7) * Math.PI * 2;
          const e = g.horde.spawn('wisp', this.pos.x + Math.cos(a) * 3.2, this.pos.z + Math.sin(a) * 3.2, { rise: false, hpMul: g.waves.hpMul });
          if (e) { e.y = 3; e.kx = Math.cos(a) * 8; e.kz = Math.sin(a) * 8; }
        }
        if (enraged) g.horde.spawn('splitter', this.pos.x, this.pos.z + 3, { rise: false, hpMul: g.waves.hpMul });
        g.audio.warp?.(this.pos);
      }
      if (this.st > 0.6) this.endAttack(1.8);
    } else if (this.state === 'ring') {
      if (this.st > 0.1 && !this.fired1) { this.fired1 = true; this.orbRing(enraged ? 24 : 18, 7.5, this.t); g.audio.sentinelFire?.(this.pos, true); }
      if (this.st > 0.6 && !this.fired2) { this.fired2 = true; this.orbRing(enraged ? 24 : 18, 7.5, this.t + 0.13); g.audio.sentinelFire?.(this.pos, true); }
      if (this.st > 1.1) { this.fired1 = this.fired2 = false; this.endAttack(1.6); }
    } else if (this.state === 'lasers') {
      const tele = 1.1, active = 3.6;
      const n = this.laserN;
      if (this.st > tele) this.laserA += dt * 0.55 * this.laserDir;
      const L = 48;
      for (let i = 0; i < 4; i++) {
        const b = this.lasers[i];
        if (i >= n) { b.hide(); continue; }
        const a = this.laserA + (i / n) * Math.PI * 2;
        const bx = this.pos.x + Math.sin(a) * L, bz = this.pos.z + Math.cos(a) * L;
        if (this.st < tele) b.set(this.pos.x, this.pos.z, bx, bz, 0.3, 0.12, Math.sin(this.st * 30) > 0 ? 3 : 1, true);
        else {
          b.set(this.pos.x, this.pos.z, bx, bz, 1.0, 0.7, 4.5);
          if (!g.player.dead && segDist(p.x, p.z, this.pos.x, this.pos.z, bx, bz) < 0.85) g.player.hurt(16, this.pos.x, this.pos.z);
        }
      }
      if (this.st > tele && !this.laserSfx) { this.laserSfx = true; g.audio.laser?.(this.pos); }
      if (this.st > tele + active) {
        for (const b of this.lasers) b.hide();
        this.laserSfx = false;
        this.endAttack(1.5);
      }
    }
  }

  endAttack(wait) {
    this.state = 'idle';
    this.attackT = wait * (this.hp < this.maxHp * 0.5 ? 0.7 : 1);
  }

  render(dt = 0) {
    super.render();
    this.shell.rotation.y += dt * 0.35;
    this.shell.rotation.x += dt * 0.12;
    this.orbiters.forEach((o, i) => {
      const a = this.t * 1.4 + (i / this.orbiters.length) * Math.PI * 2;
      o.position.set(Math.cos(a) * 4, Math.sin(a * 2 + i) * 0.8, Math.sin(a) * 4);
    });
  }
}

// ====================================================================== LANCER

export class Lancer extends Boss {
  constructor(game, hpMul = 1) {
    super(game, { name: 'LANCER', title: 'THE CORE’S EXECUTIONER', hp: 3800 * hpMul, r: 1.7, y: 1.9, color: '#ff2bd6' });
    const M = game.horde.meshes.shard.body.material.clone();
    M.color.setRGB(0.3, 0.26, 0.36);
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.2, 6), M);
    body.rotation.x = Math.PI / 2;
    this.ship = new THREE.Group();
    this.ship.add(body);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.4), M);
      wing.position.set(s * 1.4, 0, -0.6);
      wing.rotation.y = s * 0.45;
      this.ship.add(wing);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.05, 0.06), this.glow('#ff2bd6', 4));
      edge.position.set(s * 1.45, 0.05, -0.05);
      edge.rotation.y = s * 0.45;
      this.ship.add(edge);
      const eng = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), this.glow('#ff9ef0', 5));
      eng.position.set(s * 0.5, 0, -1.9);
      this.ship.add(eng);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), this.glow('#ffffff', 5));
    eye.position.set(0, 0.35, 1.2);
    this.ship.add(eye);
    this.group.add(this.ship);
    this.tele = this.beam('#ff2bd6');
    this.trails = [this.beam('#ff5ae0'), this.beam('#ff5ae0'), this.beam('#ff5ae0'), this.beam('#ff5ae0')];
    this.trailData = [];
    this.pattern = ['dash', 'fan', 'dash', 'summon', 'fan'];
    this.pi = 0;
    this.state = 'idle';
    this.st = 0;
    this.yaw = Math.PI;
    this.contact = 24;
    this.homeZ = -14;
  }

  think(dt) {
    const g = this.game;
    const p = g.player.pos;
    this.st += dt;
    const enraged = this.hp < this.maxHp * 0.5;
    let faceTarget = this.faceYaw(p.x, p.z);

    if (this.state === 'idle') {
      // circle-strafe the courier
      const a = Math.atan2(this.pos.x - p.x, this.pos.z - p.z) + dt * 0.7;
      const tx = p.x + Math.sin(a) * 12, tz = p.z + Math.cos(a) * 12;
      this.pos.x += (tx - this.pos.x) * Math.min(1, dt * 1.5);
      this.pos.z += (tz - this.pos.z) * Math.min(1, dt * 1.5);
      this.attackT -= dt;
      if (this.attackT <= 0) {
        this.state = this.pattern[this.pi++ % this.pattern.length];
        this.st = 0;
        this.fresh = true;
        this.dashes = enraged ? 4 : 3;
      }
    } else if (this.state === 'dash') {
      if (!this.dashing) {
        // telegraph through the courier to the barrier
        if (this.fresh) {
          this.fresh = false;
          this.st = 0;
          const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          this.dx = dx / d; this.dz = dz / d;
          // distance to the barrier along this ray
          const R = g.arena.boundary - 1;
          const b = this.pos.x * this.dx + this.pos.z * this.dz;
          const c = this.pos.x * this.pos.x + this.pos.z * this.pos.z - R * R;
          this.dashLen = -b + Math.sqrt(Math.max(0, b * b - c));
          g.audio.bossCharge?.(this.pos, 0.7);
        }
        const ex = this.pos.x + this.dx * this.dashLen, ez = this.pos.z + this.dz * this.dashLen;
        this.tele.set(this.pos.x, this.pos.z, ex, ez, 0.08, 0.5 + this.st, Math.sin(this.st * 30) > 0 ? 3 : 1.2, true);
        faceTarget = Math.atan2(this.dx, this.dz);
        if (this.st > (enraged ? 0.55 : 0.75)) {
          this.dashing = true;
          this.st = 0;
          this.sx = this.pos.x; this.sz = this.pos.z;
          this.tele.hide();
          g.audio.dash?.();
          g.rig?.addTrauma?.(0.2);
        }
      } else {
        const speed = 44;
        const step = Math.min(speed * dt, this.dashLen);
        this.pos.x += this.dx * step;
        this.pos.z += this.dz * step;
        this.dashLen -= step;
        faceTarget = Math.atan2(this.dx, this.dz);
        g.particles.burst(this.pos, { count: 3, color: '#ff5ae0', speed: [1, 4], life: [0.2, 0.5], size: [0.15, 0.3] });
        if (this.dashLen <= 0.01) {
          this.trailData.push({ ax: this.sx, az: this.sz, bx: this.pos.x, bz: this.pos.z, t: 2.4 });
          if (this.trailData.length > 4) this.trailData.shift();
          g.rig?.addTrauma?.(0.25);
          this.dashing = false;
          this.st = 0;
          this.fresh = true;
          this.dashes--;
          if (this.dashes <= 0) this.endAttack(1.4);
        }
      }
    } else if (this.state === 'fan') {
      if (this.st > 0.3 && !this.f1) { this.f1 = true; this.fan(enraged ? 11 : 9, 1.4, 9); g.audio.sentinelFire?.(this.pos, true); }
      if (this.st > 0.8 && !this.f2) { this.f2 = true; this.fan(enraged ? 11 : 9, 1.4, 9); g.audio.sentinelFire?.(this.pos, true); }
      if (this.st > 1.1) { this.f1 = this.f2 = false; this.endAttack(1.2); }
    } else if (this.state === 'summon') {
      if (this.fresh) {
        this.fresh = false;
        for (let i = 0; i < (enraged ? 4 : 3); i++) {
          const a = rand(0, Math.PI * 2);
          g.horde.spawn('shard', this.pos.x + Math.cos(a) * 3, this.pos.z + Math.sin(a) * 3, { rise: false, hpMul: g.waves.hpMul });
        }
        g.audio.warp?.(this.pos);
      }
      if (this.st > 0.5) this.endAttack(1);
    }

    // electric trails
    for (let i = 0; i < this.trails.length; i++) {
      const tr = this.trailData[i];
      const b = this.trails[i];
      if (!tr) { b.hide(); continue; }
      tr.t -= dt;
      if (tr.t <= 0) { b.hide(); continue; }
      const flick = 2 + Math.random() * 3;
      b.set(tr.ax, tr.az, tr.bx, tr.bz, 0.25, 0.35 + Math.random() * 0.2, flick * Math.min(1, tr.t));
      if (!g.player.dead && segDist(p.x, p.z, tr.ax, tr.az, tr.bx, tr.bz) < 0.55) g.player.hurt(12, tr.bx, tr.bz);
    }
    this.trailData = this.trailData.filter((t) => t.t > 0);

    let d = faceTarget - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 8);
    this.contact = this.dashing ? 26 : 14;
  }

  endAttack(wait) {
    this.state = 'idle';
    this.attackT = wait * (this.hp < this.maxHp * 0.5 ? 0.7 : 1);
  }

  render(dt = 0) {
    super.render();
    this.ship.rotation.y = this.yaw;
    this.ship.rotation.z = Math.sin(this.t * 2) * 0.1;
  }
}

// ====================================================================== THE WARDEN

export class Warden extends Boss {
  constructor(game, hpMul = 1) {
    super(game, { name: 'THE WARDEN', title: 'THE EYE THAT KEEPS VASHTA', hp: 8200 * hpMul, r: 2.6, y: 4.2, color: '#ff2a55' });
    const M = game.horde.meshes.sentinel.body.material.clone();
    M.color.setRGB(0.24, 0.22, 0.3);
    const S = 2.4;
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.85 * S, 0), M);
    body.scale.set(1, 1.3, 1);
    body.castShadow = true;
    this.group.add(body);
    const seams = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: new THREE.Color('#ff2a55').multiplyScalar(3) }));
    seams.scale.copy(body.scale).multiplyScalar(1.01);
    this.group.add(seams);
    for (let i = 0; i < 4; i++) {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(0.5 * S, 0.9 * S, 0.12 * S), M);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      pl.position.set(Math.cos(a) * 0.72 * S, 0, Math.sin(a) * 0.72 * S);
      pl.rotation.y = -a + Math.PI / 2;
      this.group.add(pl);
    }
    this.eye = new THREE.Mesh(new THREE.SphereGeometry(0.28 * S, 16, 12), this.glow('#ff2a55', 5));
    this.eye.position.z = 0.72 * S;
    this.eyeHolder = new THREE.Group();
    this.eyeHolder.add(this.eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.1 * S, 8, 6), this.glow('#ffffff', 6));
    pupil.position.z = 0.95 * S;
    this.eyeHolder.add(pupil);
    this.group.add(this.eyeHolder);
    this.rings = [];
    for (let k = 0; k < 3; k++) {
      const holder = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry((1.35 + k * 0.45) * S, 0.05 * S, 6, 64), this.glow(k === 1 ? '#ffd36b' : '#ff2a55', 3.5));
      ring.rotation.x = Math.PI / 2 + k * 0.4;
      holder.add(ring);
      this.group.add(holder);
      this.rings.push(holder);
    }
    // Core Lance telegraph + strike
    this.lanceRing = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.6, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a55').multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.lanceRing.rotation.x = -Math.PI / 2;
    this.lanceFill = new THREE.Mesh(new THREE.CircleGeometry(3.6, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a55').multiplyScalar(0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.lanceFill.rotation.x = -Math.PI / 2;
    this.lanceBeam = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 140, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd0d8').multiplyScalar(4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.lanceBeam.geometry.translate(0, 70, 0);
    for (const m of [this.lanceRing, this.lanceFill, this.lanceBeam]) {
      m.visible = false;
      m.frustumCulled = false;
      game.scene.add(m);
    }
    this.lance = { state: 'off', t: 0, x: 0, z: 0, cd: 6 };
    this.pattern = ['fan', 'nova', 'summon', 'fan', 'nova'];
    this.pi = 0;
    this.state = 'idle';
    this.st = 0;
    this.phase = 1;
    this.contact = 22;
    this.homeZ = -16;
  }

  think(dt) {
    const g = this.game;
    const p = g.player.pos;
    this.st += dt;
    const frac = this.hp / this.maxHp;
    if (this.phase === 1 && frac < 0.6) {
      this.phase = 2;
      g.onWardenPhase(2);
      this.pattern = ['fan', 'nova', 'fan', 'summon', 'nova'];
    }
    if (this.phase === 2 && frac < 0.45 && !this.shrunk) {
      this.shrunk = true;
      g.onWardenPhase(2.5);
    }
    if (this.phase === 2 && frac < 0.25) {
      this.phase = 3;
      g.onWardenPhase(3);
      this.pattern = ['spiral', 'fan', 'nova', 'spiral', 'summon'];
    }

    // keep distance from the courier
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const want = 12;
    const push = (want - d) * 0.6;
    const strafe = Math.sin(this.t * 0.4) * 2.5;
    this.pos.x += ((dx / d) * push + (-dz / d) * strafe) * dt;
    this.pos.z += ((dz / d) * push + (dx / d) * strafe) * dt;
    this.eyeHolder.rotation.y = this.faceYaw(p.x, p.z);

    if (this.state === 'idle') {
      this.attackT -= dt;
      if (this.attackT <= 0) {
        this.state = this.pattern[this.pi++ % this.pattern.length];
        this.st = 0;
        this.fresh = true;
        this.shots = 0;
      }
    } else if (this.state === 'fan') {
      const n = this.phase >= 3 ? 3 : 2;
      if (this.st > 0.35 * (this.shots + 1) && this.shots < n) {
        this.shots++;
        this.fan(this.phase >= 2 ? 9 : 7, 1.1, 10, { dmg: 16, size: 1.2 });
        g.audio.sentinelFire?.(this.pos, true);
      }
      if (this.st > 0.35 * n + 0.4) this.endAttack(1.1);
    } else if (this.state === 'nova') {
      if (this.st > 0.5 && this.shots < 2) {
        if (this.st > 0.5 + this.shots * 0.7) {
          this.shots++;
          this.orbRing(30, 7, this.t, { gap: 6, gapAt: rand(0, Math.PI * 2), dmg: 16, size: 1.1 });
          g.audio.sentinelFire?.(this.pos, true);
          g.arena.pulse(0);
        }
      }
      if (this.st > 2.2) this.endAttack(1.2);
    } else if (this.state === 'summon') {
      if (this.fresh) {
        this.fresh = false;
        const types = this.phase >= 2 ? ['sentinel', 'shard', 'shard', 'wisp', 'wisp', 'wisp', 'bomber'] : ['sentinel', 'wisp', 'wisp', 'wisp', 'wisp'];
        types.forEach((t, i) => {
          const a = (i / types.length) * Math.PI * 2;
          g.horde.spawn(t, this.pos.x + Math.cos(a) * 4, this.pos.z + Math.sin(a) * 4, { rise: false, hpMul: g.waves.hpMul });
        });
        g.audio.warp?.(this.pos);
      }
      if (this.st > 0.6) this.endAttack(1.4);
    } else if (this.state === 'spiral') {
      this.spinA = (this.spinA || 0) + dt * 2.2;
      this.emitT = (this.emitT || 0) - dt;
      if (this.emitT <= 0) {
        this.emitT = 0.085;
        for (let arm = 0; arm < 3; arm++) {
          const a = this.spinA + (arm / 3) * Math.PI * 2;
          g.projectiles.enemyOrb(this.pos.x + Math.sin(a) * this.r, this.pos.z + Math.cos(a) * this.r, Math.sin(a) * 7.5, Math.cos(a) * 7.5, { dmg: 14, owner: this });
        }
      }
      if (this.st > 4.2) this.endAttack(1.2);
    }

    // Core Lance: the city's eye strikes where you stand (phase 2+)
    if (this.phase >= 2) this.updateLance(dt);
  }

  updateLance(dt) {
    const g = this.game;
    const p = g.player.pos;
    const L = this.lance;
    L.t += dt;
    if (L.state === 'off') {
      L.cd -= dt;
      if (L.cd <= 0) {
        L.state = 'aim';
        L.t = 0;
        L.x = p.x; L.z = p.z;
        g.onCoreLanceAim();
      }
    } else if (L.state === 'aim') {
      const k = Math.min(1, dt * 1.8);
      L.x += (p.x - L.x) * k;
      L.z += (p.z - L.z) * k;
      this.lanceRing.visible = this.lanceFill.visible = true;
      this.lanceRing.position.set(L.x, 0.08, L.z);
      this.lanceFill.position.set(L.x, 0.07, L.z);
      const s = 1.3 - Math.min(1, L.t / 1.7) * 0.3;
      this.lanceRing.scale.setScalar(s);
      this.lanceFill.material.opacity = 0.3 + 0.3 * Math.sin(L.t * 20);
      if (L.t > 1.7) { L.state = 'lock'; L.t = 0; }
    } else if (L.state === 'lock') {
      this.lanceFill.material.opacity = Math.sin(L.t * 60) > 0 ? 1 : 0.4;
      if (L.t > 0.35) {
        L.state = 'fire';
        L.t = 0;
        this.lanceBeam.visible = true;
        this.lanceBeam.position.set(L.x, 0, L.z);
        const dist = Math.hypot(p.x - L.x, p.z - L.z);
        if (dist < 3.6 && !g.player.dead) g.player.hurt(34, L.x, L.z);
        g.onCoreLanceStrike(L.x, L.z);
      }
    } else if (L.state === 'fire') {
      const k = 1 - L.t / 0.7;
      this.lanceBeam.scale.set(Math.max(0.05, k), 1, Math.max(0.05, k));
      this.lanceRing.scale.setScalar(1 + L.t * 3);
      this.lanceFill.material.opacity = Math.max(0, k);
      if (L.t > 0.7) {
        L.state = 'off';
        L.cd = this.phase >= 3 ? 3.5 : 5.5;
        this.lanceBeam.visible = this.lanceRing.visible = this.lanceFill.visible = false;
      }
    }
  }

  endAttack(wait) {
    this.state = 'idle';
    this.attackT = wait * (this.phase >= 3 ? 0.6 : this.phase === 2 ? 0.8 : 1);
  }

  render(dt = 0) {
    super.render();
    this.rings.forEach((r, i) => {
      r.rotation.y += dt * (0.5 + i * 0.3) * (i % 2 ? -1 : 1) * this.phase;
      r.rotation.z = Math.sin(this.t * 0.5 + i) * 0.3;
    });
  }

  damage(dmg) {
    const killed = super.damage(dmg);
    if (killed) {
      this.lanceBeam.visible = this.lanceRing.visible = this.lanceFill.visible = false;
    }
    return killed;
  }

  dispose() {
    super.dispose();
    for (const m of [this.lanceRing, this.lanceFill, this.lanceBeam]) this.game.scene.remove(m);
  }
}

export const BOSSES = { hive: HiveMother, lancer: Lancer, warden: Warden };
