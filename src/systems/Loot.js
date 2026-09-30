import * as THREE from 'three';

const CAP = 1800;
const TIERS = [
  { v: 1, color: '#7ff6ff', s: 0.12 },
  { v: 3, color: '#20ffa0', s: 0.15 },
  { v: 8, color: '#b69cff', s: 0.19 },
  { v: 20, color: '#ffd36b', s: 0.24 },
];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();

function tierOf(v) {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (v >= TIERS[i].v) t = i;
  return t;
}

/** XP data-shards (thousands, instanced) plus hearts, magnets and supply chests. */
export class Loot {
  constructor(game) {
    this.game = game;
    this.x = new Float32Array(CAP);
    this.z = new Float32Array(CAP);
    this.y = new Float32Array(CAP);
    this.vx = new Float32Array(CAP);
    this.vz = new Float32Array(CAP);
    this.v = new Float32Array(CAP);
    this.pull = new Uint8Array(CAP);
    this.age = new Float32Array(CAP);
    this.n = 0;
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), CAP);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < CAP; i++) this.mesh.setColorAt(i, _c.set(1, 1, 1));
    game.scene.add(this.mesh);
    this.items = [];
    this.itemGeo = {
      heart: new THREE.OctahedronGeometry(0.34, 0),
      magnet: new THREE.TorusGeometry(0.34, 0.1, 8, 20),
      chest: new THREE.BoxGeometry(0.8, 0.6, 0.8),
    };
    this.itemMat = {
      heart: new THREE.MeshBasicMaterial({ color: new THREE.Color('#20ffa0').multiplyScalar(4) }),
      magnet: new THREE.MeshBasicMaterial({ color: new THREE.Color('#22e6ff').multiplyScalar(4) }),
      chest: new THREE.MeshStandardMaterial({ color: 0x2a2436, metalness: 0.8, roughness: 0.3, emissive: new THREE.Color('#ffd36b'), emissiveIntensity: 1.4 }),
    };
    this.tickT = 0;
  }

  clear() {
    this.n = 0;
    this.mesh.count = 0;
    for (const it of this.items) this.game.scene.remove(it.mesh);
    this.items.length = 0;
  }

  xp(x, z, value) {
    if (this.n >= CAP) {
      // merge into a random existing shard instead of dropping
      const i = Math.floor(Math.random() * this.n);
      this.v[i] += value;
      return;
    }
    const i = this.n++;
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 2.5;
    this.x[i] = x; this.z[i] = z; this.y[i] = 0.8;
    this.vx[i] = Math.cos(a) * sp; this.vz[i] = Math.sin(a) * sp;
    this.v[i] = value;
    this.pull[i] = 0;
    this.age[i] = 0;
  }

  item(kind, x, z) {
    const mesh = new THREE.Mesh(this.itemGeo[kind], this.itemMat[kind]);
    mesh.position.set(x, 0.8, z);
    this.game.scene.add(mesh);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(kind === 'chest' ? '#ffd36b' : kind === 'heart' ? '#20ffa0' : '#22e6ff').multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(x, 0.05, z);
    this.game.scene.add(halo);
    this.items.push({ kind, mesh, halo, t: 0, life: kind === 'chest' ? 60 : 25 });
  }

  /** Magnet pickup: every shard on the field flies to you. */
  vacuum() {
    for (let i = 0; i < this.n; i++) this.pull[i] = 1;
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const px = p.pos.x, pz = p.pos.z;
    const mag = p.stats.magnet;
    const mag2 = mag * mag;
    let gained = 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      const dx = px - this.x[i], dz = pz - this.z[i];
      const d2 = dx * dx + dz * dz;
      if (!this.pull[i] && d2 < mag2 && this.age[i] > 0.25) this.pull[i] = 1;
      if (this.pull[i] && !p.dead) {
        const d = Math.sqrt(d2) || 1e-4;
        const sp = 9 + this.age[i] * 6;
        const k = Math.min(1, dt * 8);
        this.vx[i] += ((dx / d) * sp - this.vx[i]) * k;
        this.vz[i] += ((dz / d) * sp - this.vz[i]) * k;
        if (d < 0.7) {
          gained += this.v[i];
          // swap-remove
          const j = --this.n;
          this.x[i] = this.x[j]; this.z[i] = this.z[j]; this.y[i] = this.y[j];
          this.vx[i] = this.vx[j]; this.vz[i] = this.vz[j]; this.v[i] = this.v[j];
          this.pull[i] = this.pull[j]; this.age[i] = this.age[j];
          i--;
          continue;
        }
      } else {
        const k = Math.exp(-3 * dt);
        this.vx[i] *= k;
        this.vz[i] *= k;
      }
      this.x[i] += this.vx[i] * dt;
      this.z[i] += this.vz[i] * dt;
      this.y[i] += (0.55 - this.y[i]) * Math.min(1, dt * 4);
    }
    if (gained > 0) {
      g.onXp(gained);
      this.tickT -= dt;
      if (this.tickT <= 0) {
        this.tickT = 0.05;
        g.audio.xpTick?.();
      }
    }

    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      it.t += dt;
      it.life -= dt;
      it.mesh.rotation.y += dt * 2.5;
      it.mesh.position.y = 0.8 + Math.sin(it.t * 3) * 0.15;
      it.halo.scale.setScalar(1 + Math.sin(it.t * 4) * 0.1);
      const d = Math.hypot(px - it.mesh.position.x, pz - it.mesh.position.z);
      if (d < 1.2 && !p.dead) {
        g.onItem(it.kind, it.mesh.position);
        this.removeItem(k);
      } else if (it.life <= 0) this.removeItem(k);
      else if (it.life < 3) it.mesh.visible = Math.sin(it.t * 20) > 0;
    }
  }

  removeItem(k) {
    const it = this.items[k];
    this.game.scene.remove(it.mesh, it.halo);
    this.items.splice(k, 1);
  }

  render(t) {
    for (let i = 0; i < this.n; i++) {
      const tier = TIERS[tierOf(this.v[i])];
      _e.set(t * 1.5 + i, t * 2 + i * 0.3, 0);
      _q.setFromEuler(_e);
      const s = tier.s * (1 + Math.sin(t * 6 + i) * 0.12);
      _m.compose(_p.set(this.x[i], this.y[i] + Math.sin(t * 3 + i) * 0.06, this.z[i]), _q, _s.set(s, s * 1.4, s));
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.set(tier.color).multiplyScalar(3.2));
    }
    this.mesh.count = this.n;
    if (this.n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
