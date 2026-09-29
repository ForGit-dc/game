import * as THREE from 'three';
import { shared } from '../world/Materials.js';

/**
 * One big additive point-sprite pool simulated on the CPU.
 * Handles sparks, embers, explosions, pickups, dust puffs…
 */
export class Particles {
  constructor(scene, max = 5000) {
    this.max = max;
    this.head = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.baseCol = new Float32Array(max * 3);
    this.endCol = new Float32Array(max * 3);

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uFogDensity: shared.fogDensity },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        uniform float uFogDensity;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          float f = uFogDensity * d * 0.8;
          vAlpha = aAlpha * exp(-f * f);
          gl_PointSize = aAlpha > 0.0 ? clamp(aSize * uScale / max(d, 0.1), 0.0, 180.0) : 0.0;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.0, d);
          float a = core * core * vAlpha;
          gl_FragColor = vec4(vColor * a * (1.0 + core * 1.5), 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this._c = new THREE.Color();
    this._c2 = new THREE.Color();
  }

  setViewportHeight(h) {
    this.mat.uniforms.uScale.value = h * 0.9;
  }

  /**
   * Spawn one particle.
   */
  spawn(x, y, z, vx, vy, vz, life, size, sizeEnd, color, colorEnd, gravity = 0, drag = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = size;
    this.s1[i] = sizeEnd;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.baseCol[i3] = color.r; this.baseCol[i3 + 1] = color.g; this.baseCol[i3 + 2] = color.b;
    this.endCol[i3] = colorEnd.r; this.endCol[i3 + 1] = colorEnd.g; this.endCol[i3 + 2] = colorEnd.b;
    this.alpha[i] = 1;
    this.size[i] = size;
  }

  /** Radial burst. */
  burst(p, { count = 20, color = '#22e6ff', colorEnd = null, speed = [2, 8], life = [0.3, 0.8], size = [0.1, 0.25], sizeEnd = 0, gravity = 0, drag = 2, intensity = 3, dir = null, spread = 1, up = 0 } = {}) {
    const c = this._c.set(color).multiplyScalar(intensity);
    const ce = this._c2.set(colorEnd || color).multiplyScalar(colorEnd ? intensity * 0.6 : 0.2);
    for (let k = 0; k < count; k++) {
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      if (dir) {
        dx = dir.x + dx * spread; dy = dir.y + dy * spread; dz = dir.z + dz * spread;
        const l2 = Math.hypot(dx, dy, dz) || 1;
        dx /= l2; dy /= l2; dz /= l2;
      }
      const sp = speed[0] + Math.random() * (speed[1] - speed[0]);
      const lf = life[0] + Math.random() * (life[1] - life[0]);
      const sz = size[0] + Math.random() * (size[1] - size[0]);
      this.spawn(p.x, p.y, p.z, dx * sp, dy * sp + up, dz * sp, lf, sz, sizeEnd * sz, c, ce, gravity, drag);
    }
  }

  update(dt) {
    const n = this.max;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt;
      this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i3] = this.baseCol[i3] + (this.endCol[i3] - this.baseCol[i3]) * t;
      this.col[i3 + 1] = this.baseCol[i3 + 1] + (this.endCol[i3 + 1] - this.baseCol[i3 + 1]) * t;
      this.col[i3 + 2] = this.baseCol[i3 + 2] + (this.endCol[i3 + 2] - this.baseCol[i3 + 2]) * t;
      this.alpha[i] = this.life[i] > 0 ? Math.min(1, (1 - t) * 1.6) : 0;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}
