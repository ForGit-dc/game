import * as THREE from 'three';
import { shared, makeHoloMaterial } from './Materials.js';
import { makeRng } from '../utils/math.js';

const FAR_FOG = /* glsl */ `
  vec3 farFog(vec3 col, float dist, float h) {
    float f = 1.0 - exp(-pow(dist * 0.0021, 1.6));
    vec3 haze = mix(vec3(0.34, 0.07, 0.3), vec3(0.06, 0.02, 0.12), smoothstep(-40.0, 220.0, h));
    return mix(col, haze, clamp(f, 0.0, 0.93));
  }
`;

/** Hundreds of distant towers rising out of the cloud sea, windows computed in-shader. */
export class Skyline {
  constructor(scene) {
    const rng = makeRng(2024);
    const N = 520;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.time, uAlarm: shared.alarm },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vLocal;
        varying vec3 vSeed;
        varying vec3 vScale;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vLocal = position;
          vSeed = aSeed;
          vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uAlarm;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vLocal;
        varying vec3 vSeed;
        varying vec3 vScale;
        ${FAR_FOG}
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          vec3 n = normalize(vNormal);
          vec3 base = vec3(0.018, 0.016, 0.035);
          vec3 col = base;
          if (abs(n.y) < 0.5) {
            float u = (abs(n.x) > 0.5 ? vLocal.z * vScale.z : vLocal.x * vScale.x);
            float v = vLocal.y * vScale.y;
            vec2 cell = floor(vec2(u / 2.4, v / 3.2));
            vec2 f = fract(vec2(u / 2.4, v / 3.2));
            float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8);
            float h = hash(vec3(cell, vSeed.x * 91.0 + n.x * 3.0 + n.z * 7.0));
            float lit = step(0.62 - vSeed.z * 0.25, h);
            float flick = step(0.02, fract(h * 13.0 + floor(uTime * 0.5 + h * 20.0) * 0.37));
            vec3 wc = mix(vec3(0.3, 0.9, 1.0), vec3(1.0, 0.35, 0.85), step(0.5, fract(h * 7.3 + vSeed.y)));
            wc = mix(wc, vec3(1.0, 0.7, 0.4), step(0.8, fract(h * 3.1)));
            col += wc * win * lit * flick * 1.6;
            // corner neon strips on some towers
            float edgeU = abs(abs(n.x) > 0.5 ? vLocal.z : vLocal.x);
            float strip = step(0.47, edgeU) * step(0.7, vSeed.y);
            vec3 sc = mix(vec3(0.1, 0.9, 1.0), vec3(1.0, 0.2, 0.8), vSeed.z);
            col += sc * strip * 2.5;
            // horizontal band near top
            float band = step(0.965, vLocal.y) * step(vLocal.y, 0.975);
            col += sc * band * 3.0 * step(0.4, vSeed.x);
          } else if (n.y > 0.5) {
            col = base * 1.4;
          }
          col = mix(col, col * vec3(1.5, 0.6, 0.4), uAlarm * 0.6);
          float dist = length(vWorld - cameraPosition);
          gl_FragColor = vec4(farFog(col, dist, vWorld.y), 1.0);
        }
      `,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const seeds = new Float32Array(N * 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    this.tops = [];
    let i = 0;
    while (i < N) {
      const a = rng() * Math.PI * 2;
      const r = rng.range(125, 620) * (rng() < 0.25 ? 0.8 : 1);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 20;
      // keep the core's line of sight clear
      if (Math.abs(x) < 55 && z < -150 && z > -420) continue;
      const w = rng.range(10, 34);
      const d = rng.range(10, 34);
      const tall = rng() < 0.08;
      const h = tall ? rng.range(260, 420) : rng.range(60, 230);
      const base = -140 - rng() * 40;
      p.set(x, base, z);
      s.set(w, h, d);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rng() < 0.7 ? 0 : rng() * 0.8));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      seeds[i * 3] = rng();
      seeds[i * 3 + 1] = rng();
      seeds[i * 3 + 2] = rng();
      if (rng() < 0.55) this.tops.push(new THREE.Vector3(x, base + h + 1, z));
      i++;
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    mesh.frustumCulled = false;
    scene.add(mesh);
    this.mesh = mesh;

    // blinking aviation lights on tower tops
    const lg = new THREE.BufferGeometry();
    const lp = new Float32Array(this.tops.length * 3);
    const lph = new Float32Array(this.tops.length);
    this.tops.forEach((t, k) => {
      lp[k * 3] = t.x; lp[k * 3 + 1] = t.y; lp[k * 3 + 2] = t.z;
      lph[k] = rng();
    });
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setAttribute('aPhase', new THREE.BufferAttribute(lph, 1));
    const lm = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.time },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying float vOn;
        void main() {
          vOn = step(0.75, fract(uTime * 0.6 + aPhase));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(2400.0 / -mv.z, 2.0, 9.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vOn;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(1.0, 0.1, 0.15) * a * vOn * 4.0, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lights = new THREE.Points(lg, lm);
    lights.frustumCulled = false;
    scene.add(lights);
  }
}

/** Streams of flying vehicles circling the city on invisible sky-lanes. */
export class Traffic {
  constructor(scene) {
    const rng = makeRng(99);
    this.lanes = [];
    const lanes = [
      { r: 95, y: 22, speed: 0.05, n: 34, color: 0xfff1d6 },
      { r: 100, y: 26, speed: -0.045, n: 30, color: 0xff3350 },
      { r: 150, y: 8, speed: 0.035, n: 44, color: 0xfff1d6 },
      { r: 158, y: 12, speed: -0.032, n: 44, color: 0xff3350 },
      { r: 230, y: 40, speed: 0.022, n: 60, color: 0x7ff6ff },
      { r: 240, y: 46, speed: -0.02, n: 60, color: 0xff4fd8 },
      { r: 330, y: 70, speed: 0.016, n: 70, color: 0xfff1d6 },
      { r: 340, y: -10, speed: -0.015, n: 70, color: 0xff3350 },
    ];
    let total = 0;
    for (const l of lanes) total += l.n;
    const geo = new THREE.BoxGeometry(0.7, 0.35, 2.6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, total);
    this.mesh.frustumCulled = false;
    const color = new THREE.Color();
    let idx = 0;
    for (const l of lanes) {
      const cars = [];
      for (let k = 0; k < l.n; k++) {
        cars.push({
          a: (k / l.n) * Math.PI * 2 + rng.range(-0.05, 0.05),
          dy: rng.range(-3, 3),
          dr: rng.range(-4, 4),
          wob: rng() * 10,
          idx,
        });
        color.set(l.color).multiplyScalar(rng.range(2.5, 5));
        this.mesh.setColorAt(idx, color);
        idx++;
      }
      this.lanes.push({ ...l, cars });
    }
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._e = new THREE.Euler();
  }

  update(t) {
    for (const l of this.lanes) {
      for (const c of l.cars) {
        const a = c.a + t * l.speed;
        const r = l.r + c.dr;
        this._p.set(Math.cos(a) * r, l.y + c.dy + Math.sin(t * 0.5 + c.wob) * 0.8, Math.sin(a) * r - 20);
        this._e.set(0, -a + (l.speed > 0 ? Math.PI : 0), 0);
        this._q.setFromEuler(this._e);
        this._m.compose(this._p, this._q, this._s);
        this.mesh.setMatrixAt(c.idx, this._m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Huge sweeping volumetric searchlights mounted on distant towers. */
export class Searchlights {
  constructor(scene) {
    const rng = makeRng(31);
    this.beams = [];
    const mat = () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0.75, 0.8, 1.0) }, uAlarm: shared.alarm },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vN;
          varying vec3 vView;
          void main() {
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vView = -mv.xyz;
            vN = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uAlarm;
          varying vec2 vUv;
          varying vec3 vN;
          varying vec3 vView;
          void main() {
            float f = abs(dot(normalize(vN), normalize(vView)));
            float soft = pow(f, 2.2);
            float along = pow(vUv.y, 2.5);
            vec3 c = mix(uColor, vec3(1.0, 0.4, 0.2), uAlarm);
            gl_FragColor = vec4(c * soft * along * 0.22, 1.0);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    const spots = [
      [-210, 60, -160], [230, 40, -120], [-260, 30, 140], [180, 70, 210], [40, 90, -420], [-120, 50, -330],
    ];
    for (const [x, y, z] of spots) {
      const geo = new THREE.CylinderGeometry(1.2, 32, 420, 24, 1, true);
      geo.translate(0, -210, 0);
      const mesh = new THREE.Mesh(geo, mat());
      const pivot = new THREE.Object3D();
      pivot.position.set(x, y, z);
      pivot.add(mesh);
      scene.add(pivot);
      mesh.frustumCulled = false;
      this.beams.push({ pivot, phase: rng() * 10, speed: rng.range(0.1, 0.25), tilt: rng.range(0.45, 0.8) });
    }
  }

  update(t) {
    for (const b of this.beams) {
      const a = t * b.speed + b.phase;
      // point the beam (which extends along -Y) up into the sky and sweep it
      b.pivot.rotation.set(Math.PI - b.tilt * Math.cos(a * 0.7), a, Math.sin(a * 1.3) * 0.25);
    }
  }
}

/** A colossal holographic whale drifting between the towers. Pure spectacle. */
export class HoloWhale {
  constructor(scene) {
    this.group = new THREE.Group();
    const col = 0x5ff4ff;
    const body = makeHoloMaterial(col, { opacity: 0.55, rim: 1.2, flicker: 0.4 });
    const wire = new THREE.LineBasicMaterial({
      color: new THREE.Color(col).multiplyScalar(0.9),
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const LEN = 44;
    // body radius along its length: t = 0 tail .. 1 nose
    const radius = (t) => Math.max(0.08, Math.sin(Math.pow(t, 0.75) * Math.PI) * 5.2 * (0.25 + 0.75 * Math.pow(t, 0.4)));
    const segment = (a, b) => {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = a + ((b - a) * i) / 12;
        pts.push(new THREE.Vector2(radius(t), (t - a) * LEN));
      }
      const g = new THREE.LatheGeometry(pts, 18);
      g.rotateX(Math.PI / 2); // lathe axis +Y -> +Z (towards the nose)
      return g;
    };
    // chain tail -> mid -> head; each joint sits where the previous segment ends
    const cuts = [0, 0.34, 0.66, 1];
    this.segs = [];
    let parent = this.group;
    for (let i = 0; i < 3; i++) {
      const joint = new THREE.Group();
      joint.position.z = i === 0 ? -LEN / 2 : (cuts[i] - cuts[i - 1]) * LEN;
      const g = segment(cuts[i], cuts[i + 1]);
      joint.add(new THREE.Mesh(g, body), new THREE.LineSegments(new THREE.WireframeGeometry(g), wire));
      parent.add(joint);
      this.segs.push(joint);
      parent = joint;
    }
    // pectoral fins on the head segment
    this.fins = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 4.2, -2.4, 4);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(1.5, 11, 4, 1), body);
      fin.scale.set(1, 1, 0.25);
      fin.position.x = side * 5.2;
      fin.rotation.z = -side * Math.PI / 2;
      pivot.add(fin);
      this.segs[2].add(pivot);
      this.fins.push({ pivot, side });
    }
    // tail flukes (flat, behind the tail tip)
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.5);
    shape.lineTo(7.5, 5);
    shape.lineTo(5, 1.8);
    shape.lineTo(0, 2.6);
    shape.lineTo(-5, 1.8);
    shape.lineTo(-7.5, 5);
    shape.closePath();
    const fg = new THREE.ShapeGeometry(shape);
    fg.rotateX(-Math.PI / 2);
    this.fluke = new THREE.Group();
    this.fluke.add(new THREE.Mesh(fg, body), new THREE.LineSegments(new THREE.EdgesGeometry(fg), wire));
    this.segs[0].add(this.fluke);
    scene.add(this.group);
  }

  update(t) {
    const a = t * 0.028;
    const R = 125;
    this.group.position.set(Math.cos(a) * R, 38 + Math.sin(t * 0.13) * 6, Math.sin(a) * R - 20);
    this.group.rotation.y = -a; // nose (+Z) along the direction of travel
    this.group.rotation.z = Math.sin(t * 0.2) * 0.08;
    const sw = t * 0.9;
    this.segs[0].rotation.x = Math.sin(sw) * 0.05;
    this.segs[1].rotation.x = Math.sin(sw - 0.9) * 0.08;
    this.segs[2].rotation.x = Math.sin(sw - 1.8) * 0.06;
    this.fluke.rotation.x = Math.sin(sw + 0.9) * 0.35;
    for (const f of this.fins) f.pivot.rotation.z = f.side * (0.25 + Math.sin(sw * 0.8) * 0.18);
  }
}

/**
 * The City Core — a gigantic mechanical eye in the sky that follows you.
 * It wakes as you gather Echoes and turns red when the city begins to fall.
 */
export class CityCore {
  constructor(scene) {
    this.pos = new THREE.Vector3(0, 95, -330);
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.uniforms = {
      uTime: shared.time,
      uAlarm: shared.alarm,
      uLook: { value: new THREE.Vector3(0, -0.2, 1).normalize() },
      uAwake: { value: 0.15 },
      uPulse: { value: 0 },
    };
    const eyeMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vObj;
        varying vec3 vView;
        void main() {
          vObj = normalize(position);
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uAlarm;
        uniform vec3 uLook;
        uniform float uAwake;
        uniform float uPulse;
        varying vec3 vN;
        varying vec3 vObj;
        varying vec3 vView;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float noise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        void main() {
          vec3 p = normalize(vObj);
          float d = dot(p, normalize(uLook));
          float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 3.0);

          // armoured shell with glowing seams
          float plates = abs(noise(p * 9.0) - 0.5);
          float seam = 1.0 - smoothstep(0.0, 0.035, plates);
          vec3 shell = vec3(0.03, 0.03, 0.06) + vec3(0.06, 0.05, 0.1) * noise(p * 30.0);
          vec3 seamCol = mix(vec3(0.5, 0.1, 1.0), vec3(1.0, 0.25, 0.05), uAlarm);
          vec3 col = shell + seamCol * seam * (0.6 + 1.6 * uAwake) * (0.7 + 0.3 * sin(uTime * 2.0 + p.y * 10.0));

          // iris
          float irisR = 0.86;
          float pupilR = mix(0.975, 0.955, uAlarm);
          if (d > irisR) {
            float k = smoothstep(irisR, irisR + 0.012, d);
            vec3 side = normalize(p - uLook * d);
            float ang = atan(dot(side, normalize(cross(uLook, vec3(0.0, 1.0, 0.0)))), dot(side, vec3(0.0, 1.0, 0.0)));
            float stri = 0.5 + 0.5 * sin(ang * 40.0 + noise(p * 20.0) * 6.0);
            float ringT = smoothstep(irisR, 1.0, d);
            vec3 ic = mix(vec3(0.1, 0.9, 1.0), vec3(1.0, 0.08, 0.12), uAlarm);
            vec3 iris = ic * (0.4 + stri * 0.8) * (0.3 + ringT * 1.5) * (0.3 + uAwake * 2.4) * (1.0 + uPulse * 2.0);
            col = mix(col, iris, k);
            // pupil
            float pk = smoothstep(pupilR, pupilR + 0.004, d);
            col = mix(col, vec3(0.0), pk);
            // pupil glint ring
            col += ic * 4.0 * (1.0 - smoothstep(0.0, 0.004, abs(d - pupilR))) * uAwake;
          }
          col += seamCol * fres * (0.4 + uAwake);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(42, 64, 48), eyeMat);
    this.group.add(eye);

    // orbiting rings
    this.rings = [];
    const ringDefs = [
      [62, 0.9, 0x8b5cff, [0.3, 0, 0.2]],
      [74, 0.6, 0x22e6ff, [1.2, 0.4, 0]],
      [88, 1.4, 0xff2bd6, [-0.4, 0.9, 0.5]],
    ];
    this.ringMats = [];
    for (const [r, tube, c, rot] of ringDefs) {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2), fog: false });
      this.ringMats.push({ m, base: new THREE.Color(c) });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 160), m);
      ring.rotation.set(...rot);
      const holder = new THREE.Group();
      holder.add(ring);
      this.group.add(holder);
      this.rings.push(holder);
      // ring nodes
      for (let k = 0; k < 6; k++) {
        const node = new THREE.Mesh(new THREE.OctahedronGeometry(tube * 3.2), m);
        const a = (k / 6) * Math.PI * 2;
        node.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
        ring.add(node);
      }
    }

    // the spire holding it up, sinking into the clouds
    const spireMat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.time, uAlarm: shared.alarm },
      vertexShader: /* glsl */ `
        varying vec3 vWorld; varying vec2 vUv;
        void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uAlarm;
        varying vec3 vWorld; varying vec2 vUv;
        ${FAR_FOG}
        void main() {
          float bands = step(0.92, fract(vWorld.y * 0.08 - uTime * 0.25));
          float ribs = step(0.9, fract(vUv.x * 24.0));
          vec3 c = vec3(0.02, 0.02, 0.04);
          vec3 glow = mix(vec3(0.55, 0.3, 1.0), vec3(1.0, 0.3, 0.05), uAlarm);
          c += glow * (bands * 2.5 + ribs * 0.5);
          gl_FragColor = vec4(farFog(c, length(vWorld - cameraPosition) * 0.7, vWorld.y), 1.0);
        }
      `,
    });
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(9, 30, 260, 24, 1, true), spireMat);
    spire.position.y = -170;
    this.group.add(spire);
    const spire2 = new THREE.Mesh(new THREE.CylinderGeometry(3, 9, 60, 12, 1, true), spireMat);
    spire2.position.y = -48;
    this.group.add(spire2);

    // halo glow sprite behind the eye
    const haloMat = new THREE.ShaderMaterial({
      uniforms: { uAlarm: shared.alarm, uAwake: this.uniforms.uAwake },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: /* glsl */ `
        uniform float uAlarm; uniform float uAwake; varying vec2 vUv;
        void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.5);
          vec3 c = mix(vec3(0.45, 0.2, 1.0), vec3(1.0, 0.25, 0.05), uAlarm);
          gl_FragColor = vec4(c * a * (0.35 + uAwake * 0.5), 1.0); }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(340, 340), haloMat);
    this.halo.position.z = -60;
    this.group.add(this.halo);

    scene.add(this.group);
    this.look = new THREE.Vector3(0, -0.2, 1).normalize();
    this.awake = 0.15;
    this.awakeTarget = 0.15;
    this.pulse = 0;
  }

  setAwake(v) {
    this.awakeTarget = v;
    this.pulse = 1;
  }

  update(dt, t, target, camera) {
    const want = new THREE.Vector3().subVectors(target, this.pos).normalize();
    // slightly sluggish, deliberate gaze with micro-saccades
    want.x += Math.sin(t * 1.7) * 0.004;
    want.y += Math.sin(t * 2.3) * 0.004;
    this.look.lerp(want, 1 - Math.exp(-2.2 * dt)).normalize();
    this.uniforms.uLook.value.copy(this.look);
    this.awake += (this.awakeTarget - this.awake) * (1 - Math.exp(-1.5 * dt));
    this.uniforms.uAwake.value = this.awake;
    this.pulse = Math.max(0, this.pulse - dt * 0.8);
    this.uniforms.uPulse.value = this.pulse;
    const alarm = shared.alarm.value;
    this.rings.forEach((r, i) => {
      r.rotation.z += dt * (0.05 + i * 0.03) * (1 + alarm * 3);
      r.rotation.x += dt * 0.02 * (i - 1) * (1 + alarm * 2);
    });
    for (const { m, base } of this.ringMats) {
      m.color.copy(base).lerp(new THREE.Color(1, 0.3, 0.05), alarm * 0.85).multiplyScalar(2.2 + this.pulse * 3);
    }
    this.halo.lookAt(camera.position);
  }
}
