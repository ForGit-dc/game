import * as THREE from 'three';
import { makePanelTextures, makeFacadeTextures, makeCrateTexture } from './Textures.js';

/** Uniforms shared by every custom shader (one update per frame drives all of them). */
export const shared = {
  time: { value: 0 },
  fogDensity: { value: 0.012 },
  alarm: { value: 0 }, // 0..1 during city collapse, tints things orange
};

// Additive materials should fade to black in fog, not to fog colour.
const FOG_ADD = /* glsl */ `
  uniform float uFogDensity;
  varying float vFogDepth2;
  float fogFade() { float f = uFogDensity * vFogDepth2; return exp(-f * f); }
`;
const FOG_VERT = /* glsl */ `
  varying float vFogDepth2;
`;

export class Materials {
  constructor() {
    const panel = makePanelTextures();
    this.panelMap = panel.map;

    this.platform = new THREE.MeshStandardMaterial({
      map: panel.map,
      roughnessMap: panel.roughnessMap,
      roughness: 0.9,
      metalness: 0.55,
      envMapIntensity: 1.1,
    });

    this.underside = new THREE.MeshStandardMaterial({
      color: 0x0c0d16,
      roughness: 0.6,
      metalness: 0.8,
      envMapIntensity: 0.8,
    });

    this.metal = new THREE.MeshStandardMaterial({
      color: 0x2a2e42,
      roughness: 0.32,
      metalness: 0.9,
      envMapIntensity: 1.2,
    });

    this.dark = new THREE.MeshStandardMaterial({
      color: 0x101119,
      roughness: 0.55,
      metalness: 0.7,
    });

    this.white = new THREE.MeshStandardMaterial({
      color: 0xdfe6f5,
      roughness: 0.35,
      metalness: 0.3,
    });

    this.facades = [0, 1, 2].map((v) => {
      const f = makeFacadeTextures(v);
      return new THREE.MeshStandardMaterial({
        map: f.map,
        emissiveMap: f.emissiveMap,
        emissive: 0xffffff,
        emissiveIntensity: 2.4,
        roughness: 0.55,
        metalness: 0.45,
        envMapIntensity: 0.9,
      });
    });

    this.crate = new THREE.MeshStandardMaterial({
      map: makeCrateTexture(),
      roughness: 0.6,
      metalness: 0.4,
    });

    this._trims = new Map();
  }

  /** Unlit HDR colour — anything above ~1 blooms. Cached per colour+intensity. */
  glow(color, intensity = 3) {
    const key = `${color}|${intensity}`;
    if (!this._trims.has(key)) {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
      this._trims.set(key, m);
    }
    return this._trims.get(key);
  }

  /** A fresh (non-cached) glow material, for things that animate their colour. */
  glowUnique(color, intensity = 3) {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
  }
}

/** Holographic material: scanlines, flicker, fresnel rim. Additive. */
export function makeHoloMaterial(color, { map = null, opacity = 0.8, rim = 1.0, scroll = 0.0, flicker = 1.0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.time,
      uFogDensity: shared.fogDensity,
      uColor: { value: new THREE.Color(color) },
      uMap: { value: map },
      uHasMap: { value: map ? 1 : 0 },
      uOpacity: { value: opacity },
      uRim: { value: rim },
      uScroll: { value: scroll },
      uFlicker: { value: flicker },
    },
    vertexShader: /* glsl */ `
      ${FOG_VERT}
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vView = -mv.xyz;
        vN = normalize(normalMatrix * normal);
        vFogDepth2 = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FOG_ADD}
      uniform float uTime;
      uniform vec3 uColor;
      uniform sampler2D uMap;
      uniform float uHasMap;
      uniform float uOpacity;
      uniform float uRim;
      uniform float uScroll;
      uniform float uFlicker;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vWorld;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float scan = 0.65 + 0.35 * sin(vWorld.y * 60.0 - uTime * 6.0);
        float band = smoothstep(0.0, 0.08, fract(vWorld.y * 0.35 - uTime * 0.4)) * 0.4 + 0.6;
        float fl = mix(1.0, 0.75 + 0.25 * step(0.08, hash(floor(uTime * 18.0))), uFlicker);
        float a = 1.0;
        if (uHasMap > 0.5) {
          vec2 uv = vUv;
          float glitch = step(0.985, hash(floor(uTime * 9.0) + floor(uv.y * 14.0)));
          uv.x += glitch * 0.03 * uFlicker;
          uv.y = fract(uv.y + uScroll * uTime);
          a = texture2D(uMap, uv).a * texture2D(uMap, uv).r;
        } else {
          float f = 1.0 - abs(dot(normalize(vN), normalize(vView)));
          a = 0.25 + pow(f, 2.0) * 1.6 * uRim;
        }
        vec3 col = uColor * a * scan * band * fl * uOpacity;
        gl_FragColor = vec4(col * 2.2 * fogFade(), 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Energy cable: dim core with bright pulses running along it. */
export function makeCableMaterial(color, speed = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.time,
      uFogDensity: shared.fogDensity,
      uColor: { value: new THREE.Color(color) },
      uSpeed: { value: speed },
      uAlarm: shared.alarm,
    },
    vertexShader: /* glsl */ `
      ${FOG_VERT}
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth2 = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FOG_ADD}
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uSpeed;
      uniform float uAlarm;
      varying vec2 vUv;
      void main() {
        float p = fract(vUv.x * 3.0 - uTime * 0.35 * uSpeed);
        float pulse = smoothstep(0.0, 0.05, p) * (1.0 - smoothstep(0.05, 0.22, p));
        vec3 c = mix(uColor, vec3(1.0, 0.45, 0.1), uAlarm * 0.8);
        vec3 col = c * (0.35 + pulse * 5.0);
        gl_FragColor = vec4(col * fogFade(), 1.0);
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

/** Vertical light beam (echo locators, extraction). */
export function makeBeamMaterial(color, strength = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.time,
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
    },
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
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vView)));
        float edge = pow(f, 1.5);
        float fade = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.04, vUv.y);
        float ripple = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 5.0);
        gl_FragColor = vec4(uColor * edge * fade * ripple * uStrength * 1.6, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Launch pad: rings expanding outward. uActive 0 = offline (red, slow). */
export function makePadMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.time,
      uFogDensity: shared.fogDensity,
      uColor: { value: new THREE.Color(color) },
      uActive: { value: 1 },
      uKick: { value: 0 },
    },
    vertexShader: /* glsl */ `
      ${FOG_VERT}
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth2 = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FOG_ADD}
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uActive;
      uniform float uKick;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float speed = mix(0.15, 1.2, uActive);
        float rings = smoothstep(0.75, 1.0, fract(r * 3.0 - uTime * speed));
        float rim = smoothstep(0.86, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
        float core = 1.0 - smoothstep(0.0, 0.35, r);
        float ang = atan(p.y, p.x + 1e-5);
        float ticks = step(0.9, fract(ang * 3.8197)) * step(0.62, r) * step(r, 0.8);
        vec3 c = mix(vec3(1.0, 0.15, 0.2), uColor, uActive);
        float i = rings * 1.4 + rim * 2.5 + core * 0.6 * uActive + ticks * 1.2 + uKick * 3.0;
        gl_FragColor = vec4(c * i * (0.4 + 0.6 * uActive) * fogFade(), 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** Glowing coolant pool surface. */
export function makePoolMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.time,
      uFogDensity: shared.fogDensity,
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */ `
      ${FOG_VERT}
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vFogDepth2 = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FOG_ADD}
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz * 0.6;
        float t = uTime * 0.6;
        float w = sin(p.x * 2.1 + t) * sin(p.y * 1.7 - t * 1.3) + sin((p.x + p.y) * 1.3 + t * 0.7);
        float caustic = pow(abs(sin(w * 2.2)), 8.0);
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = 1.0 - smoothstep(0.0, 0.06, min(e.x, e.y));
        vec3 col = uColor * (0.55 + caustic * 1.6 + edge * 2.5);
        gl_FragColor = vec4(col * fogFade(), 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** Generic world-UV box so textures keep a constant texel size regardless of box dimensions. */
export function worldBox(w, h, d, tile = 4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [
    [d, h], [d, h],
    [w, d], [w, d],
    [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** Facade box: UV in metres / tile size (4m x 6m tile), random u offset per building. */
export function facadeBox(w, h, d, uOffset = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [
    [d, h], [d, h],
    [w, d], [w, d],
    [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      if (f === 2 || f === 3) {
        // roof & bottom: sample a dark, unlit corner of the texture
        uv.setXY(i, 0.01, 0.99);
      } else {
        uv.setXY(i, (uv.getX(i) * dims[f][0]) / 4 + uOffset, (uv.getY(i) * dims[f][1]) / 6);
      }
    }
  }
  uv.needsUpdate = true;
  return g;
}
