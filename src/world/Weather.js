import * as THREE from 'three';
import { shared } from './Materials.js';
import { makeRng } from '../utils/math.js';

/** Neon-lit rain streaks that follow the camera. */
export class Rain {
  constructor(scene, count = 2600) {
    const rng = makeRng(7);
    this.count = count;
    this.box = new THREE.Vector3(70, 45, 70);
    const pos = new Float32Array(count * 6);
    this.seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.seeds[i * 3] = rng() * this.box.x;
      this.seeds[i * 3 + 1] = rng() * this.box.y;
      this.seeds[i * 3 + 2] = rng() * this.box.z;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const col = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const tint = rng();
      const c = tint < 0.15 ? [1.0, 0.4, 0.9] : tint < 0.3 ? [0.4, 0.95, 1.0] : [0.65, 0.7, 0.95];
      col.set([c[0] * 0.2, c[1] * 0.2, c[2] * 0.2, c[0], c[1], c[2]], i * 6);
    }
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.fall = 0;
  }

  update(dt, camPos, timeScale = 1) {
    this.fall += dt * 38 * timeScale;
    const p = this.geo.attributes.position.array;
    const bx = this.box.x, by = this.box.y, bz = this.box.z;
    const wind = 0.18;
    const len = 0.9 * Math.max(0.25, timeScale);
    for (let i = 0; i < this.count; i++) {
      const sx = this.seeds[i * 3], sy = this.seeds[i * 3 + 1], sz = this.seeds[i * 3 + 2];
      let x = ((sx - camPos.x + this.fall * wind) % bx + bx) % bx;
      let y = ((sy - this.fall - camPos.y) % by + by) % by;
      let z = ((sz - camPos.z) % bz + bz) % bz;
      x = camPos.x + x - bx / 2;
      y = camPos.y + y - by / 2;
      z = camPos.z + z - bz / 2;
      const o = i * 6;
      p[o] = x; p[o + 1] = y; p[o + 2] = z;
      p[o + 3] = x - wind * len; p[o + 4] = y - len * 2.2; p[o + 5] = z;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

/** Slow glowing motes / embers drifting through the air. */
export class Dust {
  constructor(scene, count = 900) {
    const rng = makeRng(8);
    const pos = new Float32Array(count * 3);
    const ph = new Float32Array(count);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rng.range(-90, 90);
      pos[i * 3 + 1] = rng.range(-10, 40);
      pos[i * 3 + 2] = rng.range(-90, 70);
      ph[i] = rng() * 100;
      const c = rng() < 0.5 ? [0.3, 0.9, 1.0] : rng() < 0.5 ? [1.0, 0.3, 0.8] : [1.0, 0.6, 0.25];
      col.set(c, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.time, uAlarm: shared.alarm, uFogDensity: shared.fogDensity },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute vec3 aColor;
        uniform float uTime;
        uniform float uAlarm;
        uniform float uFogDensity;
        varying vec3 vColor;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime * 0.25 + aPhase;
          p.x += sin(t * 0.7) * 2.0;
          p.y += mod(uTime * (0.4 + uAlarm * 2.0) + aPhase * 3.0, 50.0) - 25.0 + sin(t) * 1.5;
          p.z += cos(t * 0.5) * 2.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          gl_PointSize = clamp(90.0 / d, 1.0, 6.0);
          float f = uFogDensity * d;
          vA = exp(-f * f) * (0.5 + 0.5 * sin(t * 3.0));
          vColor = mix(aColor, vec3(1.0, 0.45, 0.1), uAlarm * 0.8);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * vA * 2.5, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
}

/** Chunks of broken city drifting and tumbling around the islands. */
export class Debris {
  constructor(scene, materials, count = 170) {
    const rng = makeRng(21);
    const geo = new THREE.DodecahedronGeometry(1, 0);
    this.mesh = new THREE.InstancedMesh(geo, materials.underside, count);
    this.items = [];
    for (let i = 0; i < count; i++) {
      let x, z, y;
      // ring distribution around the playable area, some close, some far
      const a = rng() * Math.PI * 2;
      const r = rng() < 0.6 ? rng.range(40, 95) : rng.range(95, 170);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r - 5;
      y = rng.range(-30, 45);
      const s = rng() < 0.1 ? rng.range(3, 7) : rng.range(0.4, 2.2);
      this.items.push({
        p: new THREE.Vector3(x, y, z),
        s: new THREE.Vector3(s * rng.range(0.7, 1.4), s * rng.range(0.5, 1.1), s * rng.range(0.7, 1.4)),
        r: new THREE.Euler(rng() * 6, rng() * 6, rng() * 6),
        spin: new THREE.Vector3(rng.range(-0.3, 0.3), rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)),
        bob: rng() * 10,
      });
    }
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  update(t) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      this._e.set(it.r.x + t * it.spin.x, it.r.y + t * it.spin.y, it.r.z + t * it.spin.z);
      this._q.setFromEuler(this._e);
      this._p.copy(it.p);
      this._p.y += Math.sin(t * 0.3 + it.bob) * 1.2;
      this._m.compose(this._p, this._q, it.s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
