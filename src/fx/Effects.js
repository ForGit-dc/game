import * as THREE from 'three';
import { buildCourier } from '../player/PlayerModel.js';
import { makeHoloMaterial } from '../world/Materials.js';

/** Short-lived visual effects: shockwaves, light flashes, blade arcs, dash afterimages. */
export class Effects {
  constructor(scene) {
    this.scene = scene;

    // --- shockwave rings ---
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(ringGeo, m);
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, t: 0, dur: 1, r: 1, color: new THREE.Color(), active: false });
    }

    // --- light flashes (fixed pool: adding lights at runtime forces shader recompiles) ---
    this.flashes = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 18, 1.8);
      scene.add(l);
      this.flashes.push({ l, t: 0, dur: 1, peak: 0 });
    }

    // --- blade arcs ---
    this.arcs = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color('#ff5ae0') } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
        fragmentShader: /* glsl */ `
          uniform float uT; uniform vec3 uColor; varying vec2 vUv;
          void main(){
            float along = vUv.x;
            float head = smoothstep(uT - 0.6, uT, along) * step(along, uT + 0.02);
            float edge = smoothstep(0.0, 0.6, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
            float fade = 1.0 - smoothstep(0.6, 1.3, uT);
            vec3 c = mix(uColor, vec3(1.0), pow(vUv.y, 6.0));
            gl_FragColor = vec4(c * head * edge * fade * 4.0, 1.0);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const geo = arcGeometry(1.0, 3.3, -1.25, 1.25, 24);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.arcs.push({ mesh, mat, t: 0, active: false, flip: 1 });
    }

    // --- dash afterimages ---
    this.ghosts = [];
    for (let i = 0; i < 6; i++) {
      const mat = makeHoloMaterial('#22e6ff', { opacity: 0.8, rim: 1.4, flicker: 0 });
      const g = buildCourier({ holo: mat });
      g.group.visible = false;
      scene.add(g.group);
      this.ghosts.push({ model: g, mat, t: 0, active: false });
    }
    this.ghostIdx = 0;

    // --- muzzle flash sprite ---
    const mf = new THREE.SpriteMaterial({
      map: radialTexture(),
      color: new THREE.Color('#9ff8ff').multiplyScalar(4),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.muzzle = new THREE.Sprite(mf);
    this.muzzle.scale.setScalar(0.6);
    this.muzzle.visible = false;
    scene.add(this.muzzle);
    this.muzzleT = 0;
  }

  ring(pos, color = '#22e6ff', radius = 4, dur = 0.5, facing = null) {
    const r = this.rings.find((x) => !x.active) || this.rings[0];
    r.active = true;
    r.t = 0;
    r.dur = dur;
    r.r = radius;
    r.color.set(color).multiplyScalar(3);
    r.mesh.visible = true;
    r.mesh.position.copy(pos);
    if (facing) r.mesh.lookAt(facing);
    else r.mesh.rotation.set(-Math.PI / 2, 0, 0);
  }

  flash(pos, color = '#ffffff', intensity = 80, dur = 0.25) {
    let f = this.flashes[0];
    for (const x of this.flashes) if (x.t >= x.dur) { f = x; break; }
    f.l.position.copy(pos);
    f.l.color.set(color);
    f.t = 0;
    f.dur = dur;
    f.peak = intensity;
  }

  /** Blade arc around the player. `yaw` = facing angle. */
  arc(pos, yaw, flip = 1, color = '#ff5ae0', scale = 1) {
    const a = this.arcs.find((x) => !x.active) || this.arcs[0];
    a.active = true;
    a.t = 0;
    a.mesh.visible = true;
    a.mesh.position.copy(pos);
    a.mesh.rotation.set(0, yaw, flip > 0 ? 0.25 : -0.25);
    a.mesh.scale.set(flip * scale, scale, scale);
    a.mat.uniforms.uColor.value.set(color);
  }

  afterimage(src, pos, rotY) {
    const g = this.ghosts[this.ghostIdx];
    this.ghostIdx = (this.ghostIdx + 1) % this.ghosts.length;
    g.model.copyPose(src);
    g.model.group.position.copy(pos);
    g.model.group.rotation.y = rotY;
    g.model.group.visible = true;
    g.active = true;
    g.t = 0;
  }

  muzzleFlash(pos) {
    this.muzzle.position.copy(pos);
    this.muzzle.visible = true;
    this.muzzle.material.rotation = Math.random() * Math.PI;
    this.muzzle.scale.setScalar(0.45 + Math.random() * 0.35);
    this.muzzleT = 0.05;
  }

  update(dt, camera) {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      r.mesh.scale.setScalar(0.2 + e * r.r);
      r.mesh.material.color.copy(r.color).multiplyScalar(1 - k);
    }
    for (const f of this.flashes) {
      if (f.t < f.dur) {
        f.t += dt;
        const k = Math.max(0, 1 - f.t / f.dur);
        f.l.intensity = f.peak * k * k;
      } else f.l.intensity = 0;
    }
    for (const a of this.arcs) {
      if (!a.active) continue;
      a.t += dt;
      a.mat.uniforms.uT.value = a.t / 0.16;
      if (a.t > 0.26) {
        a.active = false;
        a.mesh.visible = false;
      }
    }
    for (const g of this.ghosts) {
      if (!g.active) continue;
      g.t += dt;
      g.mat.uniforms.uOpacity.value = Math.max(0, 0.7 * (1 - g.t / 0.35));
      if (g.t > 0.35) {
        g.active = false;
        g.model.group.visible = false;
      }
    }
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      if (this.muzzleT <= 0) this.muzzle.visible = false;
    }
  }

  clear() {
    for (const r of this.rings) { r.active = false; r.mesh.visible = false; }
    for (const a of this.arcs) { a.active = false; a.mesh.visible = false; }
    for (const g of this.ghosts) { g.active = false; g.model.group.visible = false; }
    for (const f of this.flashes) { f.t = f.dur; f.l.intensity = 0; }
  }
}

/** Flat horizontal arc (sector of an annulus) for blade trails. uv.x runs along the arc. */
function arcGeometry(r0, r1, a0, a1, seg) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = a0 + (a1 - a0) * t;
    const s = Math.sin(a), c = Math.cos(a);
    pos.push(s * r0, 0, c * r0, s * r1, 0, c * r1);
    uv.push(t, 0, t, 1);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

let _radial = null;
export function radialTexture() {
  if (_radial) return _radial;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  // star spikes
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(0, 62, 128, 4);
  ctx.fillRect(62, 0, 4, 128);
  _radial = new THREE.CanvasTexture(c);
  return _radial;
}
