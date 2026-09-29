import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: 0.0025 },
    uDamage: { value: 0 },
    uGlitch: { value: 0 },
    uOverclock: { value: 0 },
    uLowHealth: { value: 0 },
    uRadial: { value: 0 },
    uFade: { value: 0 },
    uWhite: { value: 0 },
    uAlarm: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uDamage, uGlitch, uOverclock, uLowHealth, uRadial, uFade, uWhite, uAlarm;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      // block glitch
      if (uGlitch > 0.001) {
        float row = floor(uv.y * 28.0);
        float n = hash(vec2(row, floor(uTime * 24.0)));
        if (n < uGlitch * 0.55) uv.x += (hash(vec2(row, floor(uTime * 30.0))) - 0.5) * 0.09 * uGlitch;
        float col = floor(uv.x * 10.0);
        if (hash(vec2(col, floor(uTime * 12.0))) < uGlitch * 0.12) uv.y += (hash(vec2(col, uTime)) - 0.5) * 0.02;
      }
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      // overclock lens warp
      uv -= c * r2 * 0.22 * uOverclock;

      float ab = uAberration + uGlitch * 0.014 + uDamage * 0.007 + uOverclock * 0.005 + uRadial * 0.004;
      vec2 off = c * ab * (0.4 + r2 * 3.0);
      vec3 col;
      if (uRadial > 0.01) {
        // radial motion blur towards the centre (dash / launch)
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 6; i++) {
          float s = 1.0 - float(i) * 0.012 * uRadial;
          vec2 u = 0.5 + (uv - 0.5) * s;
          acc.r += texture2D(tDiffuse, u + off).r;
          acc.g += texture2D(tDiffuse, u).g;
          acc.b += texture2D(tDiffuse, u - off).b;
        }
        col = acc / 6.0;
      } else {
        col.r = texture2D(tDiffuse, uv + off).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - off).b;
      }

      // overclock grade: desaturate into cold cyan, keep neon highlights
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 cold = vec3(lum) * vec3(0.55, 1.05, 1.35) + max(col - 1.0, 0.0) * 0.6;
      col = mix(col, cold, uOverclock * 0.65);

      float vd = length(c) * 1.35;
      float vig = smoothstep(0.35, 1.0, vd);
      // damage flash
      col = mix(col, col * vec3(1.3, 0.25, 0.3) + vec3(0.3, 0.0, 0.03), vig * uDamage);
      // low health heartbeat
      float beat = pow(max(0.0, sin(uTime * 5.5)), 6.0);
      col += vec3(0.45, 0.0, 0.05) * vig * uLowHealth * (0.35 + beat);
      // collapse alarm: faint orange pulse at the edges
      col += vec3(0.25, 0.06, 0.0) * vig * uAlarm * (0.5 + 0.5 * sin(uTime * 3.0));
      // vignette
      col *= 1.0 - vig * 0.5;
      // grain + faint scanlines
      col += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.03;
      col *= 0.97 + 0.03 * sin(vUv.y * uRes.y * 1.5);

      col = mix(col, vec3(4.0), uWhite);
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/** Replaces NaN/Inf and absurd HDR values: one bad pixel must never black out the frame through bloom. */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    float fix(float v) { return (v >= 0.0 && v < 60.0) ? v : (v >= 60.0 ? 60.0 : 0.0); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(fix(c.r), fix(c.g), fix(c.b), 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, { samples = 4 } = {}) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.95, 0.55, 0.78);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    this.u = this.final.uniforms;
  }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.u.uRes.value.set(w * pixelRatio, h * pixelRatio);
  }

  render(dt) {
    this.u.uTime.value += dt;
    this.composer.render(dt);
  }
}
