import * as THREE from 'three';
import { Level, C } from './Level.js';
import { shared, makeHoloMaterial, makeBeamMaterial } from './Materials.js';
import { makeRng } from '../utils/math.js';

/** Radii of the three concentric rings: the inner disc never falls. */
export const RINGS = [16, 27, 38];

const FLOOR_Y = 0;

/**
 * THE RING — a floating circular arena above the drowned city of Vashta.
 * Built on top of the city kit (Level) so the surroundings share its neon vocabulary.
 */
export class Arena extends Level {
  build() {
    this.rng = makeRng(777);
    this.obstacles = [];
    this.segments = [];
    this.ringUniforms = [];
    this.boundary = RINGS[2] - 0.7;
    this.boundaryTarget = this.boundary;
    this.stage = 2; // index of the outermost ring still standing
    this.solidStage = 2; // rings whose pillars still collide

    this.buildFloor();
    this.buildBarrier();
    this.buildPillars();
    this.buildScenery();
    this.buildLights();
  }

  // ------------------------------------------------------------------ floor

  buildFloor() {
    const map = this.mats.platform.map.clone();
    map.repeat.set(0.25, 0.25);
    map.needsUpdate = true;
    const rough = this.mats.platform.roughnessMap.clone();
    rough.repeat.set(0.18, 0.18);
    rough.needsUpdate = true;
    this.floorMat = new THREE.MeshStandardMaterial({
      map,
      roughnessMap: rough,
      roughness: 0.85,
      metalness: 0.6,
      envMapIntensity: 1.35,
      color: 0xb8bcd8,
    });

    const depth = 2.6;
    const ring = (r0, r1, count, stage, trim) => {
      const gap = count > 1 ? 0.012 : 0;
      for (let i = 0; i < count; i++) {
        const a0 = (i / count) * Math.PI * 2 + gap;
        const a1 = ((i + 1) / count) * Math.PI * 2 - gap;
        const group = new THREE.Group();
        this.root.add(group);
        const geo = sectorGeometry(r0, r1, a0, a1, depth);
        const mesh = new THREE.Mesh(geo, this.floorMat);
        mesh.receiveShadow = true;
        mesh.position.y = FLOOR_Y;
        group.add(mesh);
        // underside hull
        const hullGeo = sectorGeometry(r0 * 0.9 + 0.5, r1 * 0.88, a0 + 0.02, a1 - 0.02, 7, false);
        const hull = new THREE.Mesh(hullGeo, this.mats.underside);
        hull.position.y = FLOOR_Y - depth - 0.2;
        group.add(hull);
        // outer lip light strip
        const lipMat = this.mats.glowUnique(trim, 3.2);
        const lip = new THREE.Mesh(arcStrip(r1 + 0.16, a0, a1, 0.12), lipMat);
        lip.position.y = FLOOR_Y - 0.2;
        group.add(lip);
        // thruster glow on the hull
        const mid = (a0 + a1) / 2;
        const tr = (r0 + r1) / 2;
        if (stage > 0) {
          const th = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 16), this.mats.glow(trim, 4));
          th.position.set(Math.cos(mid) * tr * 0.95, FLOOR_Y - depth - 7.2, Math.sin(mid) * tr * 0.95);
          group.add(th);
          const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 0.6, 30, 12, 1, true), makeBeamMaterial(trim, 0.45));
          beam.geometry.translate(0, 15, 0);
          beam.rotation.x = Math.PI;
          beam.position.copy(th.position);
          group.add(beam);
        }
        this.segments.push({ group, stage, a0, a1, r0, r1, lipMat, trim: new THREE.Color(trim), state: 'idle', t: 0, vel: 0, spin: new THREE.Vector3() });
      }
    };
    ring(0, RINGS[0], 1, 0, C.CYAN);
    ring(RINGS[0] + 0.1, RINGS[1], 8, 1, C.MAGENTA);
    ring(RINGS[1] + 0.1, RINGS[2], 12, 2, C.VIOLET);

    // glowing circuitry overlay (one shader across all rings)
    this.circuitU = {
      uTime: shared.time,
      uAlarm: shared.alarm,
      uPulse: { value: 0 },
      uPulseR: { value: 0 },
      uWarn: { value: new THREE.Vector3(0, 0, 0) }, // x: stage warning (1/2), y: amount
      uPlayer: { value: new THREE.Vector3() },
    };
    const circuitMat = new THREE.ShaderMaterial({
      uniforms: this.circuitU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAlarm, uPulse, uPulseR;
        uniform vec3 uWarn;
        uniform vec3 uPlayer;
        varying vec3 vWorld;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 p = vWorld.xz;
          float r = length(p);
          float a = atan(p.y, p.x + 1e-5) + 3.14159265;
          // polar cells: more angular divisions further out
          float ringW = 1.6;
          float ri = floor(r / ringW);
          float n = max(6.0, floor(ri * 3.0 + 6.0));
          float aj = floor(a / 6.2831853 * n);
          float fr = fract(r / ringW);
          float fa = fract(a / 6.2831853 * n);
          float h = hash(vec2(ri, aj));
          float h2 = hash(vec2(ri + 17.0, aj * 3.1));
          float aa = max(0.04, fwidth(r) * 1.2);
          float arcDist = abs(fr - 0.5) * ringW;
          float radDist = abs(fa - 0.5) * (r * 6.2831853 / n);
          float arcLine = (1.0 - smoothstep(0.0, aa, arcDist)) * step(0.55, h) * step(abs(fa - 0.5), 0.5 - 0.5 * h2);
          float radLine = (1.0 - smoothstep(0.0, aa, radDist)) * step(0.62, h2) * step(abs(fr - 0.5), 0.35 + 0.15 * h);
          float nodeD = length(vec2(arcDist, radDist));
          float node = (1.0 - smoothstep(0.08, 0.08 + aa, nodeD)) * step(0.8, h);
          float trace = max(arcLine, radLine) + node * 1.5;
          // energy wave travelling outward
          float wave = pow(max(0.0, sin(r * 0.35 - uTime * 2.2 + h * 0.6)), 14.0);
          // big pulse (level-up / nova)
          float pulse = uPulse * (1.0 - smoothstep(0.0, 2.5, abs(r - uPulseR)));
          // ring borders
          float border = 0.0;
          border += 1.0 - smoothstep(0.0, 0.07, abs(r - 16.0));
          border += 1.0 - smoothstep(0.0, 0.07, abs(r - 27.0));
          border += (1.0 - smoothstep(0.0, 0.1, abs(r - 38.0))) * 1.5;
          float dash = step(0.5, fract(a * 30.0 + uTime * 0.2));
          border *= 0.6 + 0.4 * dash;
          // colour: cyan <-> magenta by angle, orange under alarm or collapse warning
          vec3 cA = vec3(0.1, 0.85, 1.0);
          vec3 cB = vec3(1.0, 0.2, 0.85);
          vec3 col = mix(cA, cB, 0.5 + 0.5 * sin(a * 2.0 + r * 0.08));
          vec3 warnCol = vec3(1.0, 0.35, 0.05);
          float inWarn = 0.0;
          if (uWarn.x > 1.5) inWarn = step(27.0, r);
          else if (uWarn.x > 0.5) inWarn = step(16.0, r) * step(r, 27.0);
          float blink = inWarn * uWarn.y * (0.5 + 0.5 * step(0.0, sin(uTime * 14.0)));
          col = mix(col, warnCol, clamp(uAlarm * 0.6 + blink, 0.0, 1.0));
          // player proximity: traces light up near the courier
          float near = 1.0 - smoothstep(0.0, 7.0, length(p - uPlayer.xz));
          float I = trace * (0.18 + wave * 1.6 + near * 0.9 + pulse * 3.0) + border * (1.2 + blink * 3.0);
          I += (1.0 - smoothstep(0.0, 4.5, r)) * 0.08;
          I += blink * 0.08;
          // centre emblem ring
          I += (1.0 - smoothstep(0.0, 0.06, abs(r - 3.2))) * 1.5;
          I += (1.0 - smoothstep(0.0, 0.05, abs(r - 4.0))) * (0.8 + 0.6 * sin(uTime * 3.0));
          gl_FragColor = vec4(col * I, 1.0);
        }
      `,
    });
    this.circuitMeshes = [];
    const addCircuit = (r0, r1, stage) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 128, 1), circuitMat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = FLOOR_Y + 0.02;
      m.renderOrder = 2;
      this.root.add(m);
      this.circuitMeshes.push({ mesh: m, stage });
    };
    addCircuit(0.01, RINGS[0], 0);
    addCircuit(RINGS[0], RINGS[1], 1);
    addCircuit(RINGS[1], RINGS[2] + 0.2, 2);

    // centre emblem: diamond
    const em = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.85, 4, 1), this.mats.glow(C.CYAN, 3));
    em.rotation.x = -Math.PI / 2;
    em.position.y = FLOOR_Y + 0.03;
    this.root.add(em);
    const em2 = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.65, 4, 1), this.mats.glow(C.MAGENTA, 3));
    em2.rotation.x = -Math.PI / 2;
    em2.position.y = FLOOR_Y + 0.03;
    this.root.add(em2);
    this.spinners.push({ obj: em2, speed: 0.6, axis: 'z' });
  }

  buildBarrier() {
    this.barrierU = { uTime: shared.time, uAlarm: shared.alarm, uPlayer: { value: new THREE.Vector3() }, uR: { value: this.boundary }, uHit: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.barrierU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec3 vWorld; varying vec2 vUv;
        void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAlarm, uR, uHit;
        uniform vec3 uPlayer;
        varying vec3 vWorld; varying vec2 vUv;
        void main() {
          float h = vUv.y;
          float a = atan(vWorld.z, vWorld.x + 1e-5);
          float hex = abs(sin(a * uR * 1.2) * sin(vWorld.y * 5.0 + a * 3.0));
          float grid = smoothstep(0.92, 1.0, hex);
          float near = 1.0 - smoothstep(0.0, 6.0, length(vWorld.xz - uPlayer.xz));
          float base = pow(1.0 - h, 3.0);
          float scan = smoothstep(0.96, 1.0, fract(h * 3.0 - uTime * 0.6));
          vec3 col = mix(vec3(0.2, 0.8, 1.0), vec3(1.0, 0.4, 0.1), uAlarm);
          float I = base * 0.55 + grid * (0.08 + near * 0.9) * (1.0 - h) + scan * 0.15 * (1.0 - h) + near * base * 1.2 + uHit * base;
          gl_FragColor = vec4(col * I, 1.0);
        }
      `,
    });
    this.barrier = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3.2, 128, 1, true), mat);
    this.barrier.geometry.translate(0, 1.6, 0);
    this.barrier.scale.set(this.boundary + 0.6, 1, this.boundary + 0.6);
    this.barrier.position.y = FLOOR_Y;
    this.barrier.renderOrder = 3;
    this.root.add(this.barrier);
  }

  buildPillars() {
    const cap = (color) => this.mats.glow(color, 3.5);
    const spots = [
      [9, Math.PI / 6, C.CYAN], [9, Math.PI / 6 + (2 * Math.PI) / 3, C.MAGENTA], [9, Math.PI / 6 + (4 * Math.PI) / 3, C.VIOLET],
      [21.5, 0, C.ORANGE], [21.5, (2 * Math.PI) / 3, C.CYAN], [21.5, (4 * Math.PI) / 3, C.PINK],
      [32, Math.PI / 3, C.VIOLET], [32, Math.PI, C.TEAL], [32, (5 * Math.PI) / 3, C.MAGENTA],
    ];
    for (const [r, a, color] of spots) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const stage = r < RINGS[0] ? 0 : r < RINGS[1] ? 1 : 2;
      const seg = this.segmentAt(x, z);
      const parent = seg ? seg.group : this.root;
      const g = new THREE.Group();
      g.position.set(x, FLOOR_Y, z);
      parent.add(g);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.3, 2.4, 6), this.mats.metal);
      body.position.y = 1.2;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.12, 6), cap(color));
      band.position.y = 2.1;
      g.add(band);
      const band2 = new THREE.Mesh(new THREE.CylinderGeometry(1.26, 1.26, 0.06, 6), cap(color));
      band2.position.y = 0.4;
      g.add(band2);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), this.mats.glow(color, 2));
      crystal.position.y = 3.0;
      crystal.scale.y = 1.6;
      g.add(crystal);
      this.spinners.push({ obj: crystal, speed: 1.2, axis: 'y' });
      this.bobbers.push({ obj: crystal, base: 3.0, amp: 0.15, speed: 1.5, phase: a * 3 });
      this.obstacles.push({ x, z, r: 1.3, stage, seg });
    }
  }

  segmentAt(x, z) {
    const r = Math.hypot(x, z);
    let a = Math.atan2(z, x);
    if (a < 0) a += Math.PI * 2;
    return this.segments.find((s) => r >= s.r0 - 0.2 && r <= s.r1 + 0.5 && a >= s.a0 - 0.02 && a <= s.a1 + 0.02) || null;
  }

  // ------------------------------------------------------------------ surroundings

  buildScenery() {
    const rng = this.rng;
    // pylons on the outer lip (fall with the outer ring)
    for (let i = 0; i < 12; i++) {
      const a = ((i + 0.5) / 12) * Math.PI * 2;
      const r = RINGS[2] + 0.9;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const seg = this.segmentAt(Math.cos(a) * (RINGS[2] - 1), Math.sin(a) * (RINGS[2] - 1));
      const g = new THREE.Group();
      g.position.set(x, FLOOR_Y, z);
      (seg ? seg.group : this.root).add(g);
      const color = [C.CYAN, C.MAGENTA, C.VIOLET, C.ORANGE][i % 4];
      const h = 5 + (i % 3) * 1.5;
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.35, h, 0.35), this.mats.metal);
      mast.position.y = h / 2;
      g.add(mast);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, h * 0.8, 0.06), this.mats.glow(color, 4));
      strip.position.set(0.2, h / 2, 0.2);
      g.add(strip);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), this.mats.glowUnique(C.RED, 5));
      tip.position.y = h + 0.2;
      g.add(tip);
      this.blinkers.push({ m: tip.material, base: tip.material.color.clone(), phase: i * 0.7 });
      const holo = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.03, 6, 32), this.mats.glow(color, 3));
      holo.position.y = h * 0.75;
      holo.rotation.x = Math.PI / 2;
      g.add(holo);
      this.bobbers.push({ obj: holo, base: h * 0.75, amp: 0.4, speed: 1.2, phase: i });
    }

    // a crown of towers around the Ring; tall to the north (behind the action), low to the south (towards the camera)
    const towers = [];
    const N = 34;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rng.range(-0.06, 0.06);
      const south = Math.sin(a); // +1 = towards camera
      const r = rng.range(52, 70) + (south > 0.3 ? 16 : 0);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const w = rng.range(7, 13), d = rng.range(7, 13);
      const top = south > 0.3 ? rng.range(-26, -12) : south > -0.35 ? rng.range(-16, -2) : rng.range(6, 40);
      const base = top - rng.range(45, 80);
      this.building({ x, z, base, w, d, h: top - base, variant: i % 3, trim: [C.CYAN, C.MAGENTA, C.VIOLET, C.ORANGE, C.TEAL][i % 5], roof: true });
      towers.push({ x, z, top, a, w, d, south });
    }
    // signs & holograms facing the arena
    const texts = ['PYTORCH', 'GRADIENT', 'XGBOOST', 'TENSOR', 'EMBEDDINGS', 'NEURAL', 'MACHINE LEARNING', 'BENCHMARK', 'DATA SCIENCE', 'ANASS'];
    towers.forEach((t, i) => {
      if (t.south > 0.2) return;
      const face = Math.atan2(-t.x, -t.z); // yaw that faces the centre
      const off = Math.max(t.w, t.d) / 2 + 0.1;
      const px = t.x + Math.sin(face) * off, pz = t.z + Math.cos(face) * off;
      if (i % 2 === 0) {
        this.sign({
          text: texts[i % texts.length], color: [C.MAGENTA, C.CYAN, C.ORANGE, C.VIOLET, C.PINK][i % 5],
          x: px, y: t.top - 6 - rng.range(0, 8), z: pz, ry: face, height: rng.range(5, 9), vertical: true, frame: false, flicker: rng.range(0, 0.5),
        });
      } else if (i % 3 === 0) {
        this.holoAd({
          lines: [texts[(i + 3) % texts.length], 'ship the model.', 'survive production.'], color: [C.CYAN, C.MAGENTA, C.ORANGE][i % 3],
          x: px, y: t.top + 4, z: pz, ry: face, w: 9, seed: i,
        });
      }
    });
    // cables stitching the northern towers together
    const north = towers.filter((t) => t.south < -0.2).sort((p, q) => p.a - q.a);
    for (let i = 0; i < north.length - 1; i += 1) {
      const p = north[i], q = north[i + 1];
      this.cable(new THREE.Vector3(p.x, p.top - 2, p.z), new THREE.Vector3(q.x, q.top - 3, q.z), 6, [C.CYAN, C.MAGENTA, C.VIOLET][i % 3], 1 + (i % 3) * 0.3);
    }
    // floating broken chunks around the rim
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng.range(42, 50);
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(rng.range(0.8, 2.2), 0), this.mats.underside);
      m.position.set(Math.cos(a) * r, rng.range(-12, -3), Math.sin(a) * r);
      m.scale.y = 0.6;
      this.root.add(m);
      this.bobbers.push({ obj: m, base: m.position.y, amp: 0.6, speed: rng.range(0.3, 0.6), phase: rng() * 6 });
      this.spinners.push({ obj: m, speed: rng.range(-0.2, 0.2), axis: 'y' });
    }
  }

  buildLights() {
    const spots = [
      [C.MAGENTA, -24, 7, -18], [C.CYAN, 24, 7, -18], [C.VIOLET, -22, 7, 20], [C.ORANGE, 22, 7, 20],
    ];
    for (const [c, x, y, z] of spots) this.light(c, x, y, z, 90, 40);
  }

  // ------------------------------------------------------------------ runtime

  reset() {
    for (const s of this.segments) {
      s.state = 'idle';
      s.t = 0;
      s.vel = 0;
      s.group.visible = true;
      s.group.position.set(0, 0, 0);
      s.group.rotation.set(0, 0, 0);
      s.lipMat.color.copy(s.trim).multiplyScalar(3.2);
    }
    for (const c of this.circuitMeshes) c.mesh.visible = true;
    this.stage = 2;
    this.solidStage = 2;
    this.pendingBoundary = null;
    this.boundary = this.boundaryTarget = RINGS[2] - 0.7;
    this.barrier.scale.set(this.boundary + 0.6, 1, this.boundary + 0.6);
    this.circuitU.uWarn.value.set(0, 0, 0);
    this.circuitU.uPulse.value = 0;
    this.barrierU.uR.value = this.boundary;
  }

  /** Begin the collapse of the outermost standing ring (warning → fall). */
  collapseRing(stage, warnTime = 5) {
    if (stage <= 0 || stage > this.stage) return;
    this.stage = stage - 1;
    const segs = this.segments.filter((s) => s.stage === stage);
    // shuffle fall order
    for (let i = segs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [segs[i], segs[j]] = [segs[j], segs[i]];
    }
    segs.forEach((s, i) => {
      s.state = 'warn';
      s.t = -(warnTime + i * 0.35);
    });
    this.warnStage = stage;
    this.warnT = warnTime;
    this.circuitU.uWarn.value.set(stage, 1, 0);
    this.pendingBoundary = { at: warnTime, r: RINGS[stage - 1] - 0.7 };
  }

  pulse(radius = 0) {
    this.circuitU.uPulse.value = 1;
    this.circuitU.uPulseR.value = radius;
  }

  updateArena(dt, t, player, events) {
    const U = this.circuitU;
    U.uPlayer.value.copy(player);
    this.barrierU.uPlayer.value.copy(player);
    U.uPulse.value = Math.max(0, U.uPulse.value - dt * 1.2);
    U.uPulseR.value += dt * 30;
    this.barrierU.uHit.value = Math.max(0, this.barrierU.uHit.value - dt * 3);

    if (this.pendingBoundary) {
      this.pendingBoundary.at -= dt;
      if (this.pendingBoundary.at <= 0) {
        this.boundaryTarget = this.pendingBoundary.r;
        this.pendingBoundary = null;
        this.solidStage = this.stage;
        U.uWarn.value.set(0, 0, 0);
        for (const c of this.circuitMeshes) if (c.stage > this.stage) c.mesh.visible = false;
      }
    }
    // barrier glides inward
    if (this.boundary > this.boundaryTarget) {
      this.boundary = Math.max(this.boundaryTarget, this.boundary - dt * 6);
      this.barrier.scale.set(this.boundary + 0.6, 1, this.boundary + 0.6);
      this.barrierU.uR.value = this.boundary;
    }

    for (const s of this.segments) {
      if (s.state === 'warn') {
        s.t += dt;
        const blink = Math.sin(t * 16) > 0 ? 1 : 0.2;
        s.lipMat.color.setRGB(1, 0.35, 0.05).multiplyScalar(5 * blink);
        if (s.t > -1.5) {
          const sh = 0.03 + (s.t + 1.5) * 0.04;
          s.group.position.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
        }
        if (s.t >= 0) {
          s.state = 'fall';
          s.t = 0;
          const mid = (s.a0 + s.a1) / 2;
          s.spin.set(Math.sin(mid) * 0.5, (Math.random() - 0.5) * 0.3, -Math.cos(mid) * 0.5);
          events.push({ type: 'segmentFall', pos: new THREE.Vector3(Math.cos(mid) * (s.r0 + s.r1) / 2, 0, Math.sin(mid) * (s.r0 + s.r1) / 2) });
        }
      } else if (s.state === 'fall') {
        s.t += dt;
        s.vel += 18 * dt;
        s.group.position.y -= s.vel * dt;
        const mid = (s.a0 + s.a1) / 2;
        s.group.position.x += Math.cos(mid) * dt * 2;
        s.group.position.z += Math.sin(mid) * dt * 2;
        s.group.rotation.x += s.spin.x * dt;
        s.group.rotation.y += s.spin.y * dt;
        s.group.rotation.z += s.spin.z * dt;
        if (s.t > 6) {
          s.state = 'gone';
          s.group.visible = false;
        }
      }
    }
    this.update(dt, t, events);
  }

  /** Keep a circle inside the arena and out of pillars. Returns true if it hit the barrier. */
  constrain(pos, radius) {
    let hit = false;
    const lim = this.boundary - radius;
    const r = Math.hypot(pos.x, pos.z);
    if (r > lim) {
      pos.x *= lim / r;
      pos.z *= lim / r;
      hit = true;
    }
    for (const o of this.obstacles) {
      if (o.stage > this.solidStage) continue;
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const d = Math.hypot(dx, dz);
      const m = o.r + radius;
      if (d < m && d > 1e-4) {
        pos.x = o.x + (dx / d) * m;
        pos.z = o.z + (dz / d) * m;
      }
    }
    return hit;
  }

  /** Segment test for projectiles vs pillars. Returns t (0..1) or -1. */
  hitsObstacle(ax, az, bx, bz, radius = 0) {
    let best = -1;
    for (const o of this.obstacles) {
      if (o.stage > this.solidStage) continue;
      const dx = bx - ax, dz = bz - az;
      const fx = ax - o.x, fz = az - o.z;
      const a = dx * dx + dz * dz;
      const b = 2 * (fx * dx + fz * dz);
      const r = o.r + radius;
      const c = fx * fx + fz * fz - r * r;
      if (c < 0) return 0;
      const disc = b * b - 4 * a * c;
      if (disc < 0 || a < 1e-9) continue;
      const tt = (-b - Math.sqrt(disc)) / (2 * a);
      if (tt >= 0 && tt <= 1 && (best < 0 || tt < best)) best = tt;
    }
    return best;
  }
}

/** Extruded annulus sector lying in XZ with its top face at y = 0. */
function sectorGeometry(r0, r1, a0, a1, depth, bevel = true) {
  const shape = new THREE.Shape();
  const full = a1 - a0 >= Math.PI * 2 - 0.01;
  if (full && r0 <= 0.01) {
    shape.absarc(0, 0, r1, 0, Math.PI * 2, false);
  } else {
    shape.moveTo(Math.cos(a0) * r1, Math.sin(a0) * r1);
    shape.absarc(0, 0, r1, a0, a1, false);
    shape.lineTo(Math.cos(a1) * Math.max(r0, 0.01), Math.sin(a1) * Math.max(r0, 0.01));
    if (r0 > 0.01) shape.absarc(0, 0, r0, a1, a0, true);
    shape.closePath();
  }
  const segs = Math.max(8, Math.ceil(((a1 - a0) * r1) / 1.2));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: segs,
    bevelEnabled: bevel,
    bevelThickness: 0.15,
    bevelSize: 0.12,
    bevelSegments: 2,
  });
  // shape XY -> world XZ, extrusion goes downward
  geo.rotateX(Math.PI / 2);
  if (bevel) geo.translate(0, -0.15, 0); // bevel pokes 0.15 above the cap
  return geo;
}

/** Thin vertical light strip following an arc. */
function arcStrip(r, a0, a1, h) {
  const segs = Math.max(8, Math.ceil((a1 - a0) * r));
  const g = new THREE.CylinderGeometry(r, r, h, segs * 4, 1, true, Math.PI / 2 - a1, a1 - a0);
  return g;
}
