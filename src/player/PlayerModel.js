import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { damp, lerp, clamp } from '../utils/math.js';

const rbox = (w, h, d, r = 0.04) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);

/**
 * K-7, courier-class synthetic. Built from primitives; animated procedurally.
 * With `holo` set, every part uses that material (used for the plaza statue and dash afterimages).
 */
export function buildCourier({ holo = null } = {}) {
  const M = holo
    ? { armor: holo, dark: holo, joint: holo, glow: holo, accent: holo, blade: holo }
    : {
        armor: new THREE.MeshStandardMaterial({ color: 0xe9eef8, roughness: 0.28, metalness: 0.3, envMapIntensity: 1.4, emissive: 0x1a2a3a }),
        dark: new THREE.MeshStandardMaterial({ color: 0x191b27, roughness: 0.45, metalness: 0.75, envMapIntensity: 1.2 }),
        joint: new THREE.MeshStandardMaterial({ color: 0x3b4058, roughness: 0.35, metalness: 0.85 }),
        glow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#22e6ff').multiplyScalar(4.5) }),
        accent: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2bd6').multiplyScalar(3) }),
        blade: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5ae0').multiplyScalar(6), transparent: true }),
      };

  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = !holo;
    parent.add(m);
    return m;
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.96;
  body.add(hips);
  add(hips, rbox(0.34, 0.16, 0.22), M.dark);

  const spine = new THREE.Group();
  spine.position.y = 0.07;
  hips.add(spine);
  add(spine, rbox(0.26, 0.18, 0.18), M.joint, 0, 0.09, 0);

  const chest = new THREE.Group();
  chest.position.y = 0.18;
  spine.add(chest);
  add(chest, rbox(0.46, 0.38, 0.28, 0.07), M.armor, 0, 0.2, 0);
  add(chest, new THREE.BoxGeometry(0.3, 0.025, 0.01), M.glow, 0, 0.27, 0.142);
  add(chest, new THREE.BoxGeometry(0.02, 0.16, 0.01), M.accent, 0.12, 0.16, 0.142);
  add(chest, new THREE.CylinderGeometry(0.1, 0.12, 0.08, 12), M.dark, 0, 0.41, 0);
  // courier pack
  add(chest, rbox(0.4, 0.44, 0.2, 0.05), M.dark, 0, 0.2, -0.24);
  add(chest, new THREE.OctahedronGeometry(0.06), M.glow, 0, 0.24, -0.345);
  add(chest, new THREE.BoxGeometry(0.02, 0.3, 0.02), M.accent, 0.18, 0.2, -0.345);
  add(chest, new THREE.BoxGeometry(0.02, 0.3, 0.02), M.accent, -0.18, 0.2, -0.345);
  add(chest, new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), M.joint, 0.13, 0.55, -0.3);
  add(chest, new THREE.SphereGeometry(0.02, 6, 4), M.accent, 0.13, 0.7, -0.3);

  const head = new THREE.Group();
  head.position.y = 0.44;
  chest.add(head);
  add(head, rbox(0.24, 0.26, 0.27, 0.08), M.armor, 0, 0.13, 0);
  add(head, rbox(0.25, 0.1, 0.04, 0.02), M.dark, 0, 0.14, 0.125);
  const visor = add(head, new THREE.BoxGeometry(0.21, 0.05, 0.02), M.glow, 0, 0.14, 0.145);
  for (const s of [-1, 1]) {
    const ear = add(head, new THREE.CylinderGeometry(0.045, 0.045, 0.04, 10), M.joint, s * 0.125, 0.12, -0.01);
    ear.rotation.z = Math.PI / 2;
  }
  add(head, new THREE.BoxGeometry(0.02, 0.02, 0.1), M.accent, 0, 0.27, -0.05);

  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.29, 0.33, 0);
    chest.add(shoulder);
    add(shoulder, rbox(0.17, 0.12, 0.2, 0.04), M.armor, side * 0.02, 0.03, 0);
    add(shoulder, capsule(0.052, 0.18), M.joint, 0, -0.14, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);
    add(elbow, capsule(0.06, 0.16), M.armor, 0, -0.12, 0);
    add(elbow, new THREE.CylinderGeometry(0.066, 0.066, 0.02, 12), M.glow, 0, -0.06, 0);
    const hand = new THREE.Group();
    hand.position.y = -0.27;
    elbow.add(hand);
    add(hand, rbox(0.08, 0.1, 0.09, 0.03), M.dark, 0, -0.02, 0);
    return { shoulder, elbow, hand };
  };
  const armR = makeArm(-1); // model faces +Z, so -X is its right side
  const armL = makeArm(1);

  // pulse blaster on the right forearm
  const gun = new THREE.Group();
  armR.elbow.add(gun);
  add(gun, new THREE.CylinderGeometry(0.045, 0.05, 0.28, 10), M.dark, 0, -0.18, 0.06);
  add(gun, new THREE.CylinderGeometry(0.052, 0.052, 0.02, 10), M.glow, 0, -0.1, 0.06);
  add(gun, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), M.glow, 0, -0.33, 0.06);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.36, 0.06);
  gun.add(muzzle);

  // energy blade (shown only while slashing)
  const blade = add(armL.hand, new THREE.BoxGeometry(0.02, 0.95, 0.06), M.blade, 0, -0.5, 0.02);
  blade.visible = !!holo ? false : false;

  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, -0.04, 0);
    hips.add(hip);
    add(hip, capsule(0.068, 0.26), M.dark, 0, -0.2, 0);
    add(hip, rbox(0.15, 0.22, 0.16, 0.04), M.armor, 0, -0.17, 0.01);
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    add(knee, capsule(0.058, 0.3), M.armor, 0, -0.2, 0);
    add(knee, new THREE.BoxGeometry(0.03, 0.22, 0.01), M.glow, 0, -0.2, 0.062);
    const ankle = new THREE.Group();
    ankle.position.y = -0.44;
    knee.add(ankle);
    add(ankle, rbox(0.12, 0.08, 0.25, 0.03), M.dark, 0, -0.035, 0.05);
    return { hip, knee, ankle };
  };
  const legR = makeLeg(-1);
  const legL = makeLeg(1);

  const joints = [
    body, hips, spine, chest, head,
    armR.shoulder, armR.elbow, armL.shoulder, armL.elbow,
    legR.hip, legR.knee, legL.hip, legL.knee, legR.ankle, legL.ankle,
  ];

  const model = {
    group: root, body, hips, spine, chest, head, armR, armL, legR, legL, gun, muzzle, blade, visor, joints, M,
    phase: 0,
    squash: 0,
    slashT: -1,
    slashSide: 1,
    recoil: 0,
    time: 0,

    pose(name) {
      if (name === 'statue') {
        armR.shoulder.rotation.set(-2.5, 0, -0.2);
        armR.elbow.rotation.set(-0.3, 0, 0);
        armL.shoulder.rotation.set(0.1, 0, 0.25);
        legR.hip.rotation.set(-0.25, 0, -0.08);
        legR.knee.rotation.set(0.35, 0, 0);
        legL.hip.rotation.set(0.15, 0, 0.1);
        head.rotation.set(-0.25, 0, 0);
      }
    },

    /** Copy the current pose from another courier (for afterimages). */
    copyPose(src) {
      for (let i = 0; i < joints.length; i++) {
        joints[i].position.copy(src.joints[i].position);
        joints[i].quaternion.copy(src.joints[i].quaternion);
        joints[i].scale.copy(src.joints[i].scale);
      }
    },

    slash() {
      this.slashT = 0;
      this.slashSide *= -1;
    },

    update(dt, s) {
      this.time += dt;
      const t = this.time;
      const run = clamp(s.speed / 10, 0, 1.25);
      const k = damp(16, dt);

      // stride phase advances with distance travelled
      if (s.grounded) this.phase += s.speed * dt * 1.35;
      const ph = this.phase;
      const sw = Math.sin(ph);
      const sw2 = Math.cos(ph);

      // targets
      let hipL = 0, hipR = 0, kneeL = 0, kneeR = 0;
      let shL = 0, shR = 0, elL = -0.15, elR = -0.15;
      let shLz = 0.08, shRz = -0.08;
      let lean = 0, bob = 0, twist = 0;

      if (s.grounded) {
        const A = 0.95 * run;
        hipL = -sw * A;
        hipR = sw * A;
        kneeL = Math.max(0, -sw2) * 1.3 * run + 0.05;
        kneeR = Math.max(0, sw2) * 1.3 * run + 0.05;
        shL = sw * 0.75 * run;
        shR = -sw * 0.75 * run;
        elL = -0.2 - run * 0.6;
        elR = -0.2 - run * 0.6;
        lean = run * 0.22;
        bob = Math.abs(sw) * 0.06 * run - 0.02 * run;
        twist = sw * 0.12 * run;
        // idle breathing
        const br = Math.sin(t * 2.2) * 0.012 * (1 - run);
        bob += br;
      } else {
        const up = clamp(s.vy / 10, -1, 1);
        hipL = -0.7; hipR = 0.25;
        kneeL = 0.9; kneeR = 0.45 + (1 - up) * 0.2;
        shL = -0.5 + up * 0.3; shR = 0.3;
        shLz = 0.5; shRz = -0.5;
        elL = -0.7; elR = -0.4;
        lean = 0.12;
      }
      if (s.dash) {
        lean = 0.75;
        hipL = 0.6; hipR = 0.9; kneeL = 1.1; kneeR = 1.4;
        shL = 1.0; shR = 1.0; shLz = 0.35; shRz = -0.35;
        elL = -0.2; elR = -0.2;
        twist = 0;
      }

      // right arm aims the blaster
      let aimR = null;
      if (s.aiming) {
        aimR = -(Math.PI / 2 + s.aimPitch) - this.recoil * 0.25;
        shR = aimR;
        shRz = 0;
        elR = -0.05 + this.recoil * 0.3;
        twist = -0.25;
      }
      this.recoil = Math.max(0, this.recoil - dt * 9);

      // blade slash overrides the left arm
      if (this.slashT >= 0) {
        this.slashT += dt;
        const p = clamp(this.slashT / 0.22, 0, 1);
        const e = 1 - Math.pow(1 - p, 3);
        const side = this.slashSide;
        shL = -1.5;
        shLz = lerp(1.6 * side, -0.9 * side, e);
        elL = -0.25;
        twist = lerp(0.7 * side, -0.6 * side, e);
        this.blade.visible = !holo;
        this.blade.scale.y = p < 0.15 ? p / 0.15 : 1;
        if (this.slashT > 0.32) {
          this.slashT = -1;
          this.blade.visible = false;
        }
      }

      const set = (obj, x, y, z, kk = k) => {
        obj.rotation.x += (x - obj.rotation.x) * kk;
        obj.rotation.y += (y - obj.rotation.y) * kk;
        obj.rotation.z += (z - obj.rotation.z) * kk;
      };
      const fast = damp(30, dt);
      set(legL.hip, hipL, 0, 0.02);
      set(legR.hip, hipR, 0, -0.02);
      set(legL.knee, kneeL, 0, 0);
      set(legR.knee, kneeR, 0, 0);
      set(legL.ankle, -kneeL * 0.35, 0, 0);
      set(legR.ankle, -kneeR * 0.35, 0, 0);
      set(armL.shoulder, shL, 0, shLz, this.slashT >= 0 ? fast : k);
      set(armR.shoulder, shR, 0, shRz, s.aiming ? fast : k);
      set(armL.elbow, elL, 0, 0);
      set(armR.elbow, elR, 0, 0);
      set(spine, lean * 0.4, twist, 0, this.slashT >= 0 ? fast : k);
      set(body, lean * 0.5, 0, -s.turn * 0.05);
      set(head, s.aiming ? -s.aimPitch * 0.5 - lean * 0.3 : -lean * 0.4, s.aiming ? 0.2 : 0, 0);

      // squash & stretch
      this.squash *= Math.exp(-10 * dt);
      const stretch = s.grounded ? 0 : clamp(Math.abs(s.vy) / 30, 0, 0.08);
      body.scale.set(1 + this.squash * 0.5, 1 - this.squash + stretch, 1 + this.squash * 0.5);
      hips.position.y = 0.96 + bob - this.squash * 0.3;
    },
  };
  return model;
}

/** Verlet ribbon scarf that trails from the courier's neck. */
export class Scarf {
  constructor(scene, color = '#ff2bd6', n = 12, seg = 0.11) {
    this.n = n;
    this.seg = seg;
    this.p = [];
    this.o = [];
    for (let i = 0; i < n; i++) {
      this.p.push(new THREE.Vector3());
      this.o.push(new THREE.Vector3());
    }
    const verts = new Float32Array(n * 2 * 3);
    const colors = new Float32Array(n * 2 * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = 1 - i / n;
      const f = 0.6 + 2.6 * k;
      for (let j = 0; j < 2; j++) colors.set([c.r * f, c.g * f, c.b * f], (i * 2 + j) * 3);
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c2 = a + 2, d = a + 3;
      idx.push(a, b, c2, b, d, c2);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.initialized = false;
    this._side = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  reset(anchor) {
    for (let i = 0; i < this.n; i++) {
      this.p[i].copy(anchor).y -= i * this.seg;
      this.o[i].copy(this.p[i]);
    }
    this.initialized = true;
  }

  update(dt, anchor, back, t) {
    if (!this.initialized) this.reset(anchor);
    dt = Math.min(dt, 1 / 30);
    const g = -7;
    const wind = Math.sin(t * 1.7) * 0.6;
    for (let i = 1; i < this.n; i++) {
      const p = this.p[i], o = this.o[i];
      const vx = (p.x - o.x) * 0.9, vy = (p.y - o.y) * 0.9, vz = (p.z - o.z) * 0.9;
      o.copy(p);
      p.x += vx + (back.x * 2.2 + wind * 0.4) * dt * dt;
      p.y += vy + g * dt * dt + Math.sin(t * 9 + i) * 0.0006;
      p.z += vz + (back.z * 2.2) * dt * dt;
    }
    this.p[0].copy(anchor);
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < this.n; i++) {
        const a = this.p[i - 1], b = this.p[i];
        this._d.subVectors(b, a);
        const len = this._d.length() || 1e-6;
        const diff = (len - this.seg) / len;
        if (i === 1) b.addScaledVector(this._d, -diff);
        else {
          a.addScaledVector(this._d, diff * 0.5);
          b.addScaledVector(this._d, -diff * 0.5);
        }
      }
      this.p[0].copy(anchor);
    }
    const pos = this.geo.attributes.position.array;
    for (let i = 0; i < this.n; i++) {
      const a = this.p[Math.max(0, i - 1)], b = this.p[Math.min(this.n - 1, i + 1)];
      this._d.subVectors(b, a).normalize();
      this._side.set(-this._d.z, 0, this._d.x);
      if (this._side.lengthSq() < 1e-4) this._side.set(1, 0, 0);
      this._side.normalize().multiplyScalar(0.07 * (1 - i / this.n * 0.5));
      const p = this.p[i];
      pos.set([p.x - this._side.x, p.y - this._side.y, p.z - this._side.z, p.x + this._side.x, p.y + this._side.y, p.z + this._side.z], i * 6);
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  setVisible(v) {
    this.mesh.visible = v;
  }
}
