import * as THREE from 'three';
import { shared } from './Materials.js';

/**
 * Sky dome with nebula, stars, a shattered ringed moon and distant lightning.
 * Plus the glowing cloud sea ("the Abyss") the city floats above.
 */
export class Sky {
  constructor(scene) {
    this.uniforms = {
      uHor: { value: new THREE.Vector3(0.42, 0.09, 0.36) },
      uTime: shared.time,
      uAlarm: shared.alarm,
      uFlash: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(-0.55, 0.42, -0.72).normalize() },
    };

    const geo = new THREE.SphereGeometry(1400, 48, 32);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uAlarm;
        uniform float uFlash;
        uniform vec3 uMoonDir;
        uniform vec3 uHor;
        varying vec3 vDir;

        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float noise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;

          // base gradient: magenta haze horizon -> violet -> ink zenith
          vec3 zen = vec3(0.012, 0.008, 0.035);
          vec3 mid = vec3(0.07, 0.025, 0.16);
          vec3 hor = uHor;
          vec3 col = mix(hor, mid, smoothstep(-0.02, 0.22, h));
          col = mix(col, zen, smoothstep(0.2, 0.85, h));

          // warm glow from burning districts far below (north-east)
          float warm = pow(max(0.0, dot(normalize(vec3(d.x, 0.0, d.z) + vec3(1e-4, 0.0, 0.0)), normalize(vec3(0.6, 0.0, -0.8)))), 6.0);
          col += vec3(1.0, 0.35, 0.08) * warm * 0.35 * (1.0 - smoothstep(0.0, 0.25, h));

          // below horizon: city glow through the cloud sea
          col = mix(col, uHor * 0.7, smoothstep(0.02, -0.25, h));

          // nebula
          float n = fbm(d * 3.0 + vec3(0.0, 0.0, uTime * 0.004));
          float n2 = fbm(d * 6.0 - vec3(uTime * 0.003, 0.0, 0.0));
          float neb = smoothstep(0.45, 0.85, n) * smoothstep(0.05, 0.4, h);
          col += mix(vec3(0.25, 0.05, 0.45), vec3(0.0, 0.35, 0.5), n2) * neb * 0.55;

          // stars
          vec3 sp = d * 420.0;
          float st = hash(floor(sp));
          float star = step(0.9975, st) * smoothstep(0.08, 0.5, h);
          float tw = 0.6 + 0.4 * sin(uTime * 3.0 + st * 400.0);
          col += vec3(0.8, 0.9, 1.0) * star * tw * 1.8 * (1.0 - neb * 0.6);

          // shattered moon with ring
          float md = dot(d, uMoonDir);
          float moonR = 0.9965;
          if (md > moonR) {
            float k = smoothstep(moonR, moonR + 0.0012, md);
            vec3 mp = d * 90.0;
            float crater = fbm(mp * 1.6);
            float crack = smoothstep(0.47, 0.5, abs(fbm(mp * 0.9) - 0.5) + 0.47);
            vec3 mc = vec3(0.72, 0.68, 0.82) * (0.55 + crater * 0.6);
            mc = mix(mc, vec3(1.0, 0.45, 0.85) * 2.2, (1.0 - crack) * 0.9);
            col = mix(col, mc, k);
          }
          // halo
          col += vec3(0.5, 0.35, 0.8) * pow(max(0.0, md), 350.0) * 0.8;
          // ring: thin band in a tilted plane through the moon
          vec3 rn = normalize(vec3(0.25, 1.0, 0.35));
          vec3 rel = d - uMoonDir * md;
          float ringDist = abs(dot(rel, rn));
          float ringR = length(rel);
          float ring = (1.0 - smoothstep(0.0, 0.0022, ringDist)) * smoothstep(0.1, 0.12, ringR) * (1.0 - smoothstep(0.2, 0.26, ringR));
          float behind = step(md, moonR) + step(0.0, dot(rel, cross(rn, uMoonDir)));
          col += vec3(0.8, 0.6, 1.0) * ring * 0.8 * clamp(behind, 0.0, 1.0);

          // collapse alarm tint + lightning
          col = mix(col, col * vec3(1.6, 0.6, 0.35) + vec3(0.12, 0.02, 0.0), uAlarm * 0.8);
          col += vec3(0.6, 0.55, 1.0) * uFlash * (0.4 + 0.6 * smoothstep(0.3, -0.1, h)) * 0.6;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // --- The Abyss: glowing cloud sea beneath the city ---
    this.abyssUniforms = {
      uGlow: { value: new THREE.Vector3(0.55, 0.08, 0.5) },
      uTime: shared.time,
      uAlarm: shared.alarm,
      uFlash: this.uniforms.uFlash,
    };
    const abyssMat = new THREE.ShaderMaterial({
      uniforms: this.abyssUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uAlarm;
        uniform float uFlash;
        uniform vec3 uGlow;
        varying vec3 vWorld;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.02 + 3.1; a *= 0.5; } return s; }
        void main() {
          vec2 p = vWorld.xz * 0.006;
          float t = uTime * 0.012;
          float c = fbm(p + vec2(t, t * 0.6) + fbm(p * 1.7 - t) * 0.8);
          float lights = pow(fbm(p * 6.0 + 11.0), 3.0);
          float dist = length(vWorld.xz);
          vec3 deep = vec3(0.05, 0.01, 0.08);
          vec3 glowA = uGlow;
          vec3 glowB = vec3(1.0, 0.35, 0.1);
          vec3 col = mix(deep, glowA, smoothstep(0.35, 0.8, c));
          col += glowB * lights * (1.2 + uAlarm * 3.0) * smoothstep(0.4, 0.7, c);
          col += vec3(0.6, 0.6, 1.0) * uFlash * c * 1.5;
          float fade = 1.0 - smoothstep(500.0, 1300.0, dist);
          gl_FragColor = vec4(col * 1.3, fade);
        }
      `,
    });
    this.abyss = new THREE.Mesh(new THREE.PlaneGeometry(2800, 2800, 1, 1), abyssMat);
    this.abyss.rotation.x = -Math.PI / 2;
    this.abyss.position.y = -45;
    this.abyss.renderOrder = -5;
    scene.add(this.abyss);

    this.flashTimer = 4;
    this.flash = 0;
  }

  setTheme(horizon, glow) {
    this.uniforms.uHor.value.set(...horizon);
    this.abyssUniforms.uGlow.value.set(...glow);
  }

  update(dt, camera) {
    this.dome.position.copy(camera.position);
    this.abyss.position.x = camera.position.x;
    this.abyss.position.z = camera.position.z;
    this.flashTimer -= dt;
    if (this.flashTimer <= 0) {
      this.flash = 1;
      this.flashTimer = 14 + Math.random() * 22 - shared.alarm.value * 6;
      this.onLightning?.();
    }
    this.flash = Math.max(0, this.flash - dt * 3.5);
    const f = this.flash * (0.6 + 0.4 * Math.sin(this.flash * 40));
    this.uniforms.uFlash.value = f;
  }
}
