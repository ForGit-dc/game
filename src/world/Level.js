import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  worldBox, facadeBox, makeHoloMaterial, makeCableMaterial, makeBeamMaterial, makePadMaterial, makePoolMaterial, shared,
} from './Materials.js';
import { makeSignTexture, makeHoloAdTexture, makeSkyportTexture } from './Textures.js';
import { makeRng } from '../utils/math.js';
import { buildCourier } from '../player/PlayerModel.js';

export const C = {
  CYAN: '#22e6ff', MAGENTA: '#ff2bd6', VIOLET: '#8b5cff', ORANGE: '#ff8a2b', TEAL: '#20ffd0',
  BLUE: '#4d9dff', GOLD: '#ffd36b', PINK: '#ff6ad5', RED: '#ff2a55',
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Collects static geometry and merges it per material: a whole district in a handful of draw calls. */
class Batcher {
  constructor() {
    this.lists = new Map();
  }
  add(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(_m);
    if (!this.lists.has(mat)) this.lists.set(mat, []);
    this.lists.get(mat).push(g);
  }
  build(parent) {
    for (const [mat, geos] of this.lists) {
      const merged = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(merged, mat);
      const lit = mat.isMeshStandardMaterial;
      mesh.castShadow = lit;
      mesh.receiveShadow = lit;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.lists.clear();
  }
}

/** Adds meshes either to the static batch (world offset) or to a dynamic group (local coords). */
class Sink {
  constructor(batcher, ox, oy, oz, group = null) {
    this.b = batcher; this.o = new THREE.Vector3(ox, oy, oz); this.group = group;
  }
  add(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, shadow = true) {
    if (this.group) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.scale.set(sx, sy, sz);
      const lit = mat.isMeshStandardMaterial;
      mesh.castShadow = lit && shadow;
      mesh.receiveShadow = lit;
      this.group.add(mesh);
      return mesh;
    }
    this.b.add(geo, mat, x + this.o.x, y + this.o.y, z + this.o.z, rx, ry, rz, sx, sy, sz);
    return null;
  }
}

// shared unit geometries
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  frustum: (() => {
    const g = new THREE.CylinderGeometry(0.7071, 0.25, 1, 4, 1);
    g.rotateY(Math.PI / 4);
    g.translate(0, -0.5, 0);
    return g;
  })(),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
  disc: new THREE.CylinderGeometry(0.5, 0.5, 0.06, 32),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  round: new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
};

export class Level {
  constructor(scene, collision, materials) {
    this.scene = scene;
    this.col = collision;
    this.mats = materials;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.batch = new Batcher();
    this.rng = makeRng(4242);

    this.echoSpots = [];
    this.pads = [];
    this.pools = [];
    this.anchors = [];
    this.spawnPoints = [];
    this.patrols = [];
    this.collapsibles = [];
    this.movers = [];
    this.flickers = [];
    this.spinners = [];
    this.bobbers = [];
    this.blinkers = [];
    this.districts = [];
    this.lights = [];

    this.build();
    this.batch.build(this.root);
  }

  // ------------------------------------------------------------------ primitives

  _sink(x, y, z, collapsible) {
    if (collapsible) {
      const group = new THREE.Group();
      group.position.set(x, y, z);
      this.root.add(group);
      return new Sink(null, 0, 0, 0, group);
    }
    return new Sink(this.batch, x, y, z);
  }

  /**
   * Floating slab. (x,z) centre, `top` walkable height.
   * opts: collapse (seconds after collapse start), move {amp, speed, phase}, rails [n,s,e,w], thruster
   */
  platform({ x, z, top, w, d, h = 2.5, trim = C.CYAN, thruster = false, rails = [], collapse = null, move = null, under = true }) {
    const dynamic = collapse !== null || move !== null;
    const sink = this._sink(x, top, z, dynamic);
    const trimMat = dynamic ? this.mats.glowUnique(trim, 3.2) : this.mats.glow(trim, 3.2);
    const colliders = [];
    colliders.push(this.col.addTopBox(x, top, z, w, h, d, 'ground'));

    sink.add(worldBox(w, h, d), this.mats.platform, 0, -h / 2, 0);
    // glowing edge trims (top + bottom)
    const t = 0.09;
    sink.add(G.box, trimMat, 0, -0.05, d / 2 + 0.01, 0, 0, 0, w + 0.02, t, t);
    sink.add(G.box, trimMat, 0, -0.05, -d / 2 - 0.01, 0, 0, 0, w + 0.02, t, t);
    sink.add(G.box, trimMat, w / 2 + 0.01, -0.05, 0, 0, 0, 0, t, t, d + 0.02);
    sink.add(G.box, trimMat, -w / 2 - 0.01, -0.05, 0, 0, 0, 0, t, t, d + 0.02);
    const dimTrim = dynamic ? trimMat : this.mats.glow(trim, 1.2);
    sink.add(G.box, dimTrim, 0, -h + 0.08, d / 2 + 0.01, 0, 0, 0, w, 0.05, 0.05);
    sink.add(G.box, dimTrim, 0, -h + 0.08, -d / 2 - 0.01, 0, 0, 0, w, 0.05, 0.05);

    if (under) {
      const uh = Math.min(10, (w + d) * 0.28);
      sink.add(G.frustum, this.mats.underside, 0, -h, 0, 0, 0, 0, w * 0.86, uh, d * 0.86);
      if (thruster) {
        sink.add(G.disc, this.mats.glow(trim, 4), 0, -h - uh + 0.05, 0, 0, 0, 0, 1.4, 1, 1.4);
        // narrow end (uv.y = 0, brightest) sits on the thruster, widening as it fades downward
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 0.6, 26, 16, 1, true), makeBeamMaterial(trim, 0.35));
        beam.geometry.translate(0, 13, 0);
        beam.position.set(0, -h - uh, 0);
        beam.rotation.x = Math.PI;
        if (sink.group) sink.group.add(beam);
        else {
          beam.position.add(sink.o);
          this.root.add(beam);
        }
      }
    }

    for (const side of rails) {
      const along = side === 'n' || side === 's';
      const len = along ? w : d;
      const off = (along ? d : w) / 2 - 0.12;
      const sx = side === 'e' ? off : side === 'w' ? -off : 0;
      const sz = side === 's' ? off : side === 'n' ? -off : 0;
      // top bar + posts
      sink.add(G.box, this.mats.metal, sx, 1.0, sz, 0, 0, 0, along ? len : 0.08, 0.08, along ? 0.08 : len);
      sink.add(G.box, trimMat, sx, 0.55, sz, 0, 0, 0, along ? len : 0.04, 0.04, along ? 0.04 : len);
      const posts = Math.max(2, Math.round(len / 3));
      for (let i = 0; i <= posts; i++) {
        const k = -len / 2 + (len * i) / posts;
        sink.add(G.box, this.mats.metal, along ? k : sx, 0.5, along ? sz : k, 0, 0, 0, 0.08, 1, 0.08);
      }
      const cx = x + sx, cz = z + sz;
      colliders.push(this.col.addTopBox(cx, top + 1.05, cz, along ? len : 0.2, 1.05, along ? 0.2 : len, 'rail'));
    }

    const rec = { group: sink.group, colliders, trimMat, trimColor: new THREE.Color(trim), top, x, z, w, d };
    const mover = move ? { ...rec, ...move, baseTop: top, offset: 0 } : null;
    if (mover) this.movers.push(mover);
    if (collapse !== null) this.collapsibles.push({ ...rec, mover, delay: collapse, state: 'idle', t: 0, vel: 0, spin: new THREE.Vector3() });
    return { sink, rec };
  }

  /** Solid facade block, optional sign + roof clutter. */
  building({ x, z, base, w, d, h, variant = 0, trim = C.CYAN, roof = true, corner = true }) {
    const rng = this.rng;
    this.col.addTopBox(x, base + h, z, w, h, d, 'building');
    this.batch.add(facadeBox(w, h, d, rng.range(0, 1)), this.mats.facades[variant], x, base + h / 2, z);
    // roof cap + trim
    this.batch.add(G.box, this.mats.dark, x, base + h + 0.25, z, 0, 0, 0, w + 0.4, 0.5, d + 0.4);
    this.col.addTopBox(x, base + h + 0.5, z, w + 0.4, 0.5, d + 0.4, 'building');
    const tm = this.mats.glow(trim, 3);
    this.batch.add(G.box, tm, x, base + h + 0.52, z + d / 2 + 0.2, 0, 0, 0, w + 0.42, 0.06, 0.06);
    this.batch.add(G.box, tm, x, base + h + 0.52, z - d / 2 - 0.2, 0, 0, 0, w + 0.42, 0.06, 0.06);
    this.batch.add(G.box, tm, x + w / 2 + 0.2, base + h + 0.52, z, 0, 0, 0, 0.06, 0.06, d + 0.42);
    this.batch.add(G.box, tm, x - w / 2 - 0.2, base + h + 0.52, z, 0, 0, 0, 0.06, 0.06, d + 0.42);
    if (corner) {
      const cx = x + (rng() < 0.5 ? -1 : 1) * (w / 2 + 0.05);
      const cz = z + (rng() < 0.5 ? -1 : 1) * (d / 2 + 0.05);
      this.batch.add(G.box, this.mats.glow(trim, 4), cx, base + h * 0.5, cz, 0, 0, 0, 0.12, h * 0.9, 0.12);
    }
    if (roof) {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        const bw = rng.range(1, 2.2), bh = rng.range(0.6, 1.4), bd = rng.range(1, 2.2);
        const bx = x + rng.range(-w / 2 + bw, w / 2 - bw) * 0.8;
        const bz = z + rng.range(-d / 2 + bd, d / 2 - bd) * 0.8;
        this.batch.add(G.box, this.mats.metal, bx, base + h + 0.5 + bh / 2, bz, 0, 0, 0, bw, bh, bd);
      }
      if (rng() < 0.7) {
        const ah = rng.range(3, 8);
        const ax = x + rng.range(-w / 3, w / 3), az = z + rng.range(-d / 3, d / 3);
        this.batch.add(G.cyl, this.mats.metal, ax, base + h + 0.5 + ah / 2, az, 0, 0, 0, 0.12, ah, 0.12);
        this.blinker(ax, base + h + 0.6 + ah, az, C.RED);
      }
    }
  }

  blinker(x, y, z, color) {
    const m = this.mats.glowUnique(color, 5);
    const mesh = new THREE.Mesh(G.sphere, m);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.28);
    this.root.add(mesh);
    this.blinkers.push({ m, base: m.color.clone(), phase: this.rng() * 3 });
  }

  sign({ text, color, x, y, z, ry = 0, height = 2, vertical = false, flicker = 0.3, frame = true }) {
    const { texture, aspect } = makeSignTexture(text, color, { vertical, frame });
    const hgt = height;
    const wid = hgt * aspect;
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      color: new THREE.Color(2.2, 2.2, 2.2),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wid, hgt), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    this.root.add(mesh);
    // backing plate
    const back = new THREE.Mesh(G.box, this.mats.dark);
    back.scale.set(wid * 0.96, hgt * 0.96, 0.08);
    back.position.set(x, y, z).addScaledVector(new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)), -0.08);
    back.rotation.y = ry;
    this.root.add(back);
    this.flickers.push({ mat, base: 2.2, flicker, phase: this.rng() * 100, dead: 0 });
    return mesh;
  }

  holoAd({ lines, color, x, y, z, ry = 0, w = 6, seed = 1 }) {
    const tex = makeHoloAdTexture(lines, seed);
    const mat = makeHoloMaterial(color, { map: tex, opacity: 0.9 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    this.root.add(mesh);
    this.bobbers.push({ obj: mesh, base: y, amp: 0.15, speed: 0.8, phase: this.rng() * 6 });
    // projector emitter
    this.batch.add(G.box, this.mats.metal, x, y - w / 4 - 0.5, z, 0, ry, 0, 0.6, 0.3, 0.6);
    return mesh;
  }

  crate(x, bottom, z, w = 1.4, h = 1.4, d = 1.4, trim = C.ORANGE) {
    this.col.addTopBox(x, bottom + h, z, w, h, d, 'crate');
    this.batch.add(worldBox(w, h, d, 1.6), this.mats.crate, x, bottom + h / 2, z);
    this.batch.add(G.box, this.mats.glow(trim, 2.5), x, bottom + h * 0.8, z + d / 2 + 0.01, 0, 0, 0, w * 0.6, 0.05, 0.02);
  }

  steps({ x0, z0, dir, count, rise, width, trim }) {
    // dir: 'n','s','e','w' — steps rising (rise>0) or falling (rise<0) away from (x0,z0)
    for (let i = 1; i <= count; i++) {
      const top = rise * i;
      const off = i - 0.5;
      let x = x0, z = z0, w = 1, d = 1;
      if (dir === 'n') { z = z0 - off; w = width; }
      if (dir === 's') { z = z0 + off; w = width; }
      if (dir === 'e') { x = x0 + off; d = width; }
      if (dir === 'w') { x = x0 - off; d = width; }
      const h = Math.abs(top) + 1.2;
      this.col.addTopBox(x, top, z, w, h, d, 'ground');
      this.batch.add(worldBox(w, h, d), this.mats.platform, x, top - h / 2, z);
      const edge = this.mats.glow(trim, 2.5);
      if (dir === 'n' || dir === 's') this.batch.add(G.box, edge, x, top - 0.04, z + (dir === 'n' ? 0.5 : -0.5), 0, 0, 0, w, 0.05, 0.05);
      else this.batch.add(G.box, edge, x + (dir === 'e' ? -0.5 : 0.5), top - 0.04, z, 0, 0, 0, 0.05, 0.05, d);
    }
  }

  pad({ x, top, z, tx, ty, tz, apex = 5, color = C.CYAN, locked = false, label = null }) {
    const mat = makePadMaterial(color);
    mat.uniforms.uActive.value = locked ? 0 : 1;
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), mat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, top + 0.03, z);
    this.root.add(disc);
    this.batch.add(G.cyl, this.mats.metal, x, top + 0.02, z, 0, 0, 0, 3.3, 0.06, 3.3);
    const pad = { pos: new THREE.Vector3(x, top, z), target: new THREE.Vector3(tx, ty, tz), apex, mat, locked, cool: 0, color, label };
    this.pads.push(pad);
    return pad;
  }

  pool(x, top, z, w, d, color = C.TEAL) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), makePoolMaterial(color));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, top + 0.03, z);
    this.root.add(mesh);
    this.pools.push({ x, z, w, d, top });
  }

  cable(a, b, sag, color, speed = 1) {
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= sag;
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5).add(new THREE.Vector3(0, -sag * 0.25, 0)), mid, b.clone().lerp(mid, 0.5).add(new THREE.Vector3(0, -sag * 0.25, 0)), b]);
    const geo = new THREE.TubeGeometry(curve, 48, 0.07, 5, false);
    const mesh = new THREE.Mesh(geo, makeCableMaterial(color, speed));
    this.root.add(mesh);
  }

  light(color, x, y, z, intensity = 40, distance = 30) {
    const l = new THREE.PointLight(color, intensity, distance, 1.6);
    l.position.set(x, y, z);
    this.root.add(l);
    this.lights.push({ l, base: intensity, color: new THREE.Color(color) });
    return l;
  }

  lantern(x, y, z, color) {
    const m = this.mats.glow(color, 3.5);
    this.batch.add(G.sphere, m, x, y, z, 0, 0, 0, 0.35, 0.45, 0.35);
    this.batch.add(G.cyl, this.mats.dark, x, y + 0.3, z, 0, 0, 0, 0.12, 0.15, 0.12);
  }

  lamp(x, top, z, color) {
    this.batch.add(G.cyl, this.mats.metal, x, top + 1.6, z, 0, 0, 0, 0.12, 3.2, 0.12);
    this.batch.add(G.box, this.mats.glow(color, 4), x, top + 3.25, z, 0, 0, 0, 0.5, 0.12, 0.5);
    this.col.addTopBox(x, top + 3.2, z, 0.25, 3.2, 0.25, 'prop');
  }

  stall(x, top, z, color, sign) {
    this.col.addTopBox(x, top + 1.1, z, 3, 1.1, 1.4, 'prop');
    this.batch.add(G.round, this.mats.metal, x, top + 0.55, z, 0, 0, 0, 3, 1.1, 1.4);
    this.batch.add(G.box, this.mats.glow(color, 2.5), x, top + 1.08, z + 0.71, 0, 0, 0, 3, 0.05, 0.03);
    // posts + awning
    for (const sx of [-1.4, 1.4]) this.batch.add(G.cyl, this.mats.dark, x + sx, top + 1.4, z - 0.5, 0, 0, 0, 0.08, 2.8, 0.08);
    this.batch.add(G.box, this.mats.glow(color, 0.9), x, top + 2.75, z + 0.1, 0.35, 0, 0, 3.4, 0.06, 2.0);
    this.lantern(x - 1.1, top + 2.3, z + 0.9, color);
    this.lantern(x + 1.1, top + 2.3, z + 0.9, C.CYAN);
    if (sign) this.sign({ text: sign, color, x, y: top + 3.35, z: z - 0.3, height: 0.7, flicker: 0.5 });
  }

  district(name, x0, z0, x1, z1, y0 = -20, y1 = 40) {
    this.districts.push({ name, min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) });
  }

  // ------------------------------------------------------------------ the city

  build() {
    const rng = this.rng;

    // ================= ATRIUM (spawn) =================
    this.district('THE ATRIUM', -18, -18, 18, 18);
    this.platform({ x: 0, z: 0, top: 0, w: 36, d: 36, h: 3, trim: C.CYAN, thruster: true });
    // inlaid floor ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(6.2, 6.5, 64), this.mats.glow(C.CYAN, 2));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.02, -3);
    this.root.add(ring);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(9.5, 9.6, 64), this.mats.glow(C.MAGENTA, 1.6));
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.set(0, 0.02, -3);
    this.root.add(ring2);

    // memorial statue of "the courier" (a hologram of you)
    this.col.addTopBox(0, 0.5, -3, 3, 0.5, 3, 'prop');
    this.batch.add(G.cyl, this.mats.metal, 0, 0.25, -3, 0, 0, 0, 3.2, 0.5, 3.2);
    this.batch.add(G.cyl, this.mats.glow(C.CYAN, 3), 0, 0.51, -3, 0, 0, 0, 3.3, 0.02, 3.3);
    const statue = buildCourier({ holo: makeHoloMaterial(C.CYAN, { opacity: 0.9, rim: 1.4, flicker: 0.6 }) });
    statue.group.scale.setScalar(2.3);
    statue.group.position.set(0, 0.55, -3);
    statue.pose('statue');
    this.root.add(statue.group);
    this.spinners.push({ obj: statue.group, speed: 0.25, axis: 'y' });

    // wake pod: where K-7 is reactivated
    this.col.addTopBox(0, 2.6, 10.8, 2.2, 2.6, 1.6, 'prop');
    this.batch.add(G.round, this.mats.white, 0, 1.3, 11, 0, 0, 0, 2.2, 2.6, 1.2);
    this.batch.add(G.round, this.mats.dark, 0, 1.3, 10.45, 0, 0, 0, 1.6, 2.1, 0.2);
    this.batch.add(G.box, this.mats.glow(C.CYAN, 4), 0, 2.45, 10.3, 0, 0, 0, 1.2, 0.06, 0.06);
    this.batch.add(G.box, this.mats.glow(C.CYAN, 4), 0, 0.2, 10.3, 0, 0, 0, 1.2, 0.06, 0.06);
    // open pod door lying on the floor
    this.batch.add(G.round, this.mats.white, 1.8, 0.12, 9.6, 0, 0.4, 0, 1.4, 0.2, 2.2);
    this.anchors.push({ pos: new THREE.Vector3(0, 0, 4), always: true });

    // corner towers framing the plaza
    this.building({ x: -13, z: -13, base: 0, w: 7, d: 7, h: 22, variant: 1, trim: C.MAGENTA });
    this.building({ x: 13, z: -13, base: 0, w: 7, d: 7, h: 16, variant: 0, trim: C.CYAN });
    this.building({ x: -13, z: 13, base: 0, w: 7, d: 7, h: 12, variant: 2, trim: C.ORANGE });
    this.building({ x: 13, z: 13, base: 0, w: 7, d: 7, h: 28, variant: 0, trim: C.VIOLET });
    this.sign({ text: 'HOTEL MIRAGE', color: C.MAGENTA, x: -13, y: 9, z: -9.42, height: 1.6 });
    this.sign({ text: 'VOLTA', color: C.CYAN, x: 9.42, y: 9, z: -13, ry: -Math.PI / 2, height: 5.5, vertical: true, frame: false });
    this.sign({ text: 'OPEN 24H', color: C.PINK, x: -13, y: 5, z: 9.42, ry: Math.PI, height: 1.2, flicker: 0.8 });
    this.sign({ text: 'LUMEN', color: C.VIOLET, x: 9.42, y: 12, z: 13, ry: -Math.PI / 2, height: 7, vertical: true, frame: false });
    this.holoAd({ lines: ['DREAM ENGINE', 'sleep is optional.', 'subscribe before shutdown.'], color: C.MAGENTA, x: 13, y: 19, z: 9.2, ry: Math.PI, w: 7, seed: 2 });
    this.holoAd({ lines: ['K-7 COURIERS', 'we always deliver.', 'always.'], color: C.CYAN, x: -9.2, y: 15, z: -13, ry: Math.PI / 2, w: 6, seed: 4 });

    // cover & clutter
    this.crate(-6, 0, 5, 1.4, 1.2, 1.4);
    this.crate(-7.3, 0, 5.4, 1.1, 0.8, 1.1);
    this.crate(7, 0, -8, 1.6, 1.4, 1.6, C.CYAN);
    this.crate(6, 0, 12, 1.2, 1.0, 2.4);
    this.lamp(-6, 0, -12, C.MAGENTA);
    this.lamp(6, 0, -12, C.CYAN);
    this.lamp(-15, 0, 0, C.CYAN);
    this.lamp(15, 0, 4, C.VIOLET);
    this.light(C.MAGENTA, -8, 6, -8, 60, 30);
    this.light(C.CYAN, 7, 5, 9, 55, 28);

    // balconies that break away when the city falls
    this.platform({ x: 21, z: 10, top: 0, w: 6, d: 6, h: 1.5, trim: C.CYAN, collapse: 3, under: true });
    this.platform({ x: -21, z: 10, top: 0, w: 6, d: 8, h: 1.5, trim: C.CYAN, collapse: 7 });
    this.platform({ x: 10, z: 21, top: 0, w: 8, d: 6, h: 1.5, trim: C.CYAN, collapse: 12 });
    this.platform({ x: -10, z: 21, top: 0, w: 8, d: 6, h: 1.5, trim: C.CYAN, collapse: 16 });

    // ================= MARKET STACKS (north) =================
    this.district('MARKET STACKS', -16, -52, 13, -18.1, -5, 40);
    this.steps({ x0: 0, z0: -18, dir: 'n', count: 3, rise: 0.5, width: 8, trim: C.ORANGE });
    this.platform({ x: 0, z: -29.5, top: 2, w: 24, d: 17, h: 3, trim: C.ORANGE, thruster: true });
    this.anchors.push({ pos: new THREE.Vector3(0, 2, -24) });
    this.stall(-7, 2, -25.5, C.ORANGE, 'NOODLE');
    this.stall(-7, 2, -31, C.PINK, 'CHROME');
    this.stall(7.5, 2, -25.5, C.CYAN, 'REPAIR');
    this.stall(3, 2, -30.5, C.MAGENTA, 'SOBA');
    this.building({ x: 7, z: -35.5, base: 2, w: 9, d: 4, h: 12, variant: 2, trim: C.ORANGE });
    this.sign({ text: 'SYNTH//LIFE', color: C.ORANGE, x: 7, y: 9.5, z: -33.42, height: 1.5 });
    this.holoAd({ lines: ['KAIROS NOODLE', 'hot · fast · synthetic', 'open through the end'], color: C.ORANGE, x: -2, y: 8.5, z: -37, w: 6, seed: 6 });
    this.crate(-10.5, 2, -35.5, 1.4, 1.4, 1.4);
    this.crate(10.5, 2, -23, 1.2, 1.0, 1.2, C.CYAN);
    this.light(C.ORANGE, 0, 6, -29, 70, 30);
    for (let i = 0; i < 6; i++) this.lantern(-10 + i * 4, 5.2, -21.6, i % 2 ? C.ORANGE : C.PINK);
    this.echoSpots.push({ pos: new THREE.Vector3(-1, 2, -26.5), district: 'MARKET STACKS' });
    this.pad({ x: -8, top: 2, z: -36, tx: -8, ty: 5, tz: -45.5, apex: 5, color: C.ORANGE });
    this.patrols.push({ type: 'scout', pos: new THREE.Vector3(0, 6, -30) }, { type: 'scout', pos: new THREE.Vector3(4, 7, -26) });

    // tier B (upper market shrine) — collapses
    this.platform({ x: -8, z: -46, top: 5, w: 14, d: 10, h: 2.5, trim: C.MAGENTA, collapse: 44, thruster: true });
    this.echoSpots.push({ pos: new THREE.Vector3(-11, 5, -48), district: 'MARKET STACKS' });
    this.building({ x: -8, z: -57, base: -12, w: 14, d: 8, h: 50, variant: 1, trim: C.MAGENTA, roof: true });
    this.sign({ text: 'MIRAGE', color: C.MAGENTA, x: -12, y: 22, z: -52.92, height: 12, vertical: true, frame: false, flicker: 0.15 });
    this.sign({ text: 'NO VACANCY', color: C.RED, x: -3, y: 12, z: -52.92, height: 1.1, flicker: 1 });
    this.light(C.MAGENTA, -8, 9, -46, 45, 22);

    // lift deck & skylift
    this.platform({ x: 15, z: -30, top: 2, w: 6, d: 4, h: 0.8, trim: C.GOLD, rails: ['n', 's'], under: false });
    this.platform({ x: 22, z: -30, top: 2, w: 8, d: 8, h: 2.5, trim: C.GOLD, thruster: true });
    this.anchors.push({ pos: new THREE.Vector3(22, 2, -27) });
    this.skylift = this.pad({ x: 22, top: 2, z: -30, tx: 36.5, ty: 14, tz: -39.5, apex: 9, color: C.GOLD, locked: true, label: 'SKYLIFT' });
    this.skyliftSign = this.sign({ text: 'SKYLIFT OFFLINE', color: C.RED, x: 25.9, y: 5.2, z: -30, ry: -Math.PI / 2, height: 0.9, flicker: 0.6 });

    // ================= SKYPORT (extraction) =================
    this.district('SKYPORT 07', 30, -54, 50, -34, 10, 40);
    this.platform({ x: 40, z: -44, top: 14, w: 18, d: 18, h: 3.5, trim: C.GOLD, thruster: true });
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), new THREE.MeshStandardMaterial({
      map: makeSkyportTexture(), roughness: 0.5, metalness: 0.4, emissive: new THREE.Color(C.GOLD), emissiveIntensity: 0.25,
      transparent: false,
    }));
    mark.material.emissiveMap = mark.material.map;
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(40, 14.02, -45);
    mark.receiveShadow = true;
    this.root.add(mark);
    this.skyport = { center: new THREE.Vector3(40, 14, -45), radius: 4.8 };
    this.anchors.push({ pos: new THREE.Vector3(36, 14, -39), skyport: true });
    // arch gate
    const gate = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.35, 12, 64, Math.PI), this.mats.metal);
    gate.position.set(40, 14, -52.2);
    gate.castShadow = true;
    this.root.add(gate);
    const gateGlow = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.08, 8, 64, Math.PI), this.mats.glow(C.GOLD, 4));
    gateGlow.position.set(40, 14, -51.8);
    this.root.add(gateGlow);
    this.uplinkBeam = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 120, 32, 1, true), makeBeamMaterial(C.GOLD, 0));
    this.uplinkBeam.geometry.translate(0, 60, 0);
    this.uplinkBeam.position.set(40, 14, -45);
    this.root.add(this.uplinkBeam);
    this.crate(33.5, 14, -51, 1.6, 1.4, 1.6, C.GOLD);
    this.crate(47, 14, -37.5, 1.4, 1.2, 2.2, C.GOLD);
    this.crate(46.5, 14, -51, 1.4, 1.8, 1.4, C.GOLD);
    this.crate(33, 14, -38, 1.2, 1.0, 1.2, C.GOLD);
    this.lamp(32, 14, -45, C.GOLD);
    this.lamp(48, 14, -45, C.GOLD);
    this.light(C.GOLD, 40, 19, -45, 70, 30);
    this.pad({ x: 46, top: 14, z: -41, tx: 22, ty: 2, tz: -28, apex: 4, color: C.CYAN });
    this.sign({ text: 'EXTRACTION', color: C.GOLD, x: 40, y: 21.8, z: -52.4, height: 1.3, flicker: 0.1 });

    // ================= TRANSIT SPINE (east) =================
    this.district('TRANSIT SPINE', 18.1, -12, 72, 12);
    this.platform({ x: 26, z: 0, top: 0, w: 16, d: 4, h: 1, trim: C.VIOLET, rails: ['n', 's'], under: false });
    this.platform({ x: 44.5, z: 0, top: 0, w: 11, d: 4, h: 1, trim: C.VIOLET, rails: ['n', 's'], under: false, collapse: 28 });
    // broken bridge pieces hovering in the gap
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(G.box, this.mats.platform);
      m.scale.set(rng.range(0.8, 1.6), 0.6, rng.range(1, 3));
      m.position.set(35 + i * 1.2, -1.5 - i * 0.8, rng.range(-1.5, 1.5));
      m.rotation.set(rng.range(-0.5, 0.5), rng.range(-0.5, 0.5), rng.range(-0.6, 0.6));
      this.root.add(m);
      this.bobbers.push({ obj: m, base: m.position.y, amp: 0.3, speed: 0.6 + i * 0.1, phase: i });
    }
    this.platform({ x: 60, z: 0, top: 0, w: 20, d: 20, h: 3, trim: C.VIOLET, thruster: true });
    this.anchors.push({ pos: new THREE.Vector3(57, 0, 3) });
    // derailed train car
    this.col.addTopBox(58, 2.8, -6, 10, 2.8, 3, 'prop');
    this.batch.add(G.round, this.mats.white, 58, 1.4, -6, 0, 0, 0, 10, 2.8, 3);
    this.batch.add(G.box, this.mats.glow(C.CYAN, 3), 58, 1.8, -4.48, 0, 0, 0, 9, 0.5, 0.02);
    this.batch.add(G.box, this.mats.glow(C.CYAN, 3), 58, 1.8, -7.52, 0, 0, 0, 9, 0.5, 0.02);
    this.batch.add(G.box, this.mats.glow(C.MAGENTA, 3), 58, 0.5, -4.48, 0, 0, 0, 10, 0.08, 0.03);
    this.crate(61.8, 0, -3.3, 1.4, 1.3, 1.4, C.VIOLET);
    this.echoSpots.push({ pos: new THREE.Vector3(57, 2.8, -6), district: 'TRANSIT SPINE' });
    this.building({ x: 65, z: 5, base: 0, w: 6, d: 6, h: 34, variant: 0, trim: C.VIOLET });
    this.sign({ text: 'TRANSIT', color: C.VIOLET, x: 61.92, y: 14, z: 5, ry: -Math.PI / 2, height: 9, vertical: true, frame: false });
    this.building({ x: 55.5, z: 6.5, base: 0, w: 5, d: 5, h: 9, variant: 2, trim: C.CYAN });
    this.pad({ x: 51.5, top: 0, z: 6, tx: 55.5, ty: 9.5, tz: 6.2, apex: 3, color: C.VIOLET });
    this.echoSpots.push({ pos: new THREE.Vector3(55.5, 9.5, 6.5), district: 'TRANSIT SPINE' });
    this.pad({ x: 67, top: 0, z: -7.5, tx: 8, ty: 0, tz: 2, apex: 8, color: C.CYAN });
    this.holoAd({ lines: ['ORBITAL LINE', 'service suspended.', 'we apologise forever.'], color: C.VIOLET, x: 60, y: 7.5, z: 9.6, ry: Math.PI, w: 6, seed: 8 });
    this.lamp(52, 0, -8.5, C.VIOLET);
    this.lamp(68.5, 0, 9, C.VIOLET);
    this.light(C.VIOLET, 59, 6, 0, 70, 30);
    this.patrols.push({ type: 'guardian', pos: new THREE.Vector3(60, 6, 2) }, { type: 'scout', pos: new THREE.Vector3(56, 5, -3) });

    // ================= RESERVOIR (west, lower) =================
    this.district('COOLANT RESERVOIR', -55, -16, -18.1, 16, -20, 30);
    this.steps({ x0: -18, z0: 0, dir: 'w', count: 8, rise: -0.5, width: 6, trim: C.TEAL });
    this.platform({ x: -39.5, z: 0, top: -4, w: 29, d: 30, h: 3.5, trim: C.TEAL, thruster: true });
    this.anchors.push({ pos: new THREE.Vector3(-30, -4, 0) });
    this.pool(-34, -4, -6, 8, 6);
    this.pool(-45, -4, 7, 7, 6);
    // tanks
    const tank = (x, z, r, h) => {
      this.col.addTopBox(x, -4 + h, z, r * 1.75, h, r * 1.75, 'prop');
      this.batch.add(G.cyl, this.mats.metal, x, -4 + h / 2, z, 0, 0, 0, r * 2, h, r * 2);
      this.batch.add(G.cyl, this.mats.dark, x, -4 + h + 0.1, z, 0, 0, 0, r * 2.05, 0.2, r * 2.05);
      for (let k = 1; k < 3; k++) this.batch.add(G.cyl, this.mats.glow(C.TEAL, 2.5), x, -4 + (h * k) / 3, z, 0, 0, 0, r * 2.03, 0.08, r * 2.03);
    };
    tank(-49.5, -9.5, 3.2, 5);
    tank(-49.5, 8.5, 3, 7);
    this.crate(-43.2, -4, -13, 1.8, 1.4, 1.8, C.TEAL);
    this.crate(-45.6, -4, -13, 1.8, 2.8, 1.8, C.TEAL);
    this.echoSpots.push({ pos: new THREE.Vector3(-49.5, 1, -9.5), district: 'COOLANT RESERVOIR' });
    // pipes
    for (const z of [-2, 1.5]) {
      this.batch.add(G.cyl, this.mats.metal, -46, -3.4, z, 0, 0, Math.PI / 2, 0.7, 14, 0.7);
      this.col.addTopBox(-46, -2.9, z, 14, 1.1, 0.7, 'prop');
    }
    this.building({ x: -36, z: 11.5, base: -4, w: 8, d: 5, h: 6, variant: 0, trim: C.TEAL });
    this.sign({ text: 'COOLANT 07', color: C.TEAL, x: -36, y: 0.4, z: 8.92, ry: Math.PI, height: 1.1 });
    this.holoAd({ lines: ['AQUA-9', 'coolant is not potable.', 'stay hydrated anyway.'], color: C.TEAL, x: -52, y: 4, z: 0, ry: Math.PI / 2, w: 6, seed: 9 });
    this.pad({ x: -30, top: -4, z: -11, tx: -40, ty: 9, tz: -33, apex: 5, color: C.PINK });
    this.lamp(-27, -4, 13, C.TEAL);
    this.lamp(-27, -4, -13, C.TEAL);
    this.light(C.TEAL, -40, 1, 0, 70, 32);
    this.patrols.push({ type: 'scout', pos: new THREE.Vector3(-38, 0, -4) }, { type: 'scout', pos: new THREE.Vector3(-44, 1, 5) });

    // sky garden (floating memorial) — collapses
    this.district('SKY GARDEN', -46, -40, -34, -28, 5, 30);
    this.platform({ x: -40, z: -34, top: 9, w: 10, d: 10, h: 2.5, trim: C.PINK, collapse: 50, thruster: true });
    this.echoSpots.push({ pos: new THREE.Vector3(-40, 9, -35.5), district: 'SKY GARDEN' });
    this.holoTree(-41.5, 9, -32);
    this.pad({ x: -37, top: 9, z: -31, tx: -9, ty: 5, tz: -43.5, apex: 5, color: C.MAGENTA });

    // ================= RELAY ARRAY (south) =================
    this.district('RELAY ARRAY', -12, 18.1, 12, 59, -10, 30);
    const stones = [
      [0, 0.4, 22, 10], [2.5, 1.1, 28, 14], [-1, 1.8, 34, 18], [1, 2.5, 40, 22],
    ];
    stones.forEach(([sx, st, sz, t], i) => {
      this.platform({ x: sx, z: sz, top: st, w: 4, d: 4, h: 1.2, trim: C.BLUE, collapse: t, move: { amp: 0.35, speed: 1.1, phase: i * 1.3 }, thruster: true });
    });
    this.platform({ x: 0, z: 51, top: 3, w: 22, d: 14, h: 3, trim: C.BLUE, thruster: true });
    this.anchors.push({ pos: new THREE.Vector3(0, 3, 47) });
    this.echoSpots.push({ pos: new THREE.Vector3(-2, 3, 49), district: 'RELAY ARRAY' });
    // radar dish
    this.col.addTopBox(6, 5, 54, 3, 2, 3, 'prop');
    this.batch.add(G.cyl, this.mats.metal, 6, 4, 54, 0, 0, 0, 2.6, 2, 2.6);
    const dish = new THREE.Group();
    dish.position.set(6, 6.2, 54);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(3.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3.2), this.mats.white);
    bowl.rotation.x = -Math.PI / 2 + 0.5;
    bowl.material = this.mats.white;
    bowl.castShadow = true;
    const needle = new THREE.Mesh(G.cyl, this.mats.metal);
    needle.scale.set(0.12, 3, 0.12);
    needle.rotation.x = 0.5 + Math.PI / 2 - Math.PI / 2;
    needle.position.set(0, 1.4, 0.8);
    const tip = new THREE.Mesh(G.sphere, this.mats.glow(C.BLUE, 6));
    tip.scale.setScalar(0.4);
    tip.position.set(0, 2.9, 1.6);
    dish.add(bowl, needle, tip);
    this.root.add(dish);
    this.spinners.push({ obj: dish, speed: 0.35, axis: 'y' });
    this.building({ x: -6, z: 54.5, base: 3, w: 6, d: 4, h: 3.5, variant: 0, trim: C.BLUE, roof: false });
    this.sign({ text: 'RELAY 9', color: C.BLUE, x: -6, y: 5.4, z: 52.42, ry: Math.PI, height: 0.9 });
    for (const [mx, mz] of [[-10, 57], [10, 45.5], [-10, 45.5]]) {
      this.batch.add(G.cyl, this.mats.metal, mx, 3 + 4, mz, 0, 0, 0, 0.2, 8, 0.2);
      this.col.addTopBox(mx, 11, mz, 0.3, 8, 0.3, 'prop');
      this.blinker(mx, 11.2, mz, C.RED);
    }
    this.pad({ x: 8, top: 3, z: 47, tx: 4, ty: 0, tz: 12, apex: 6, color: C.CYAN });
    this.light(C.BLUE, 0, 8, 51, 60, 30);
    this.patrols.push({ type: 'guardian', pos: new THREE.Vector3(0, 8, 52) });

    // ================= cables between towers =================
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    this.cable(V(-13, 22, -13), V(-8, 36, -53), 6, C.MAGENTA, 1);
    this.cable(V(13, 16, -13), V(7, 14, -35.5), 3, C.ORANGE, 1.4);
    this.cable(V(13, 28, 13), V(65, 34, 5), 10, C.VIOLET, 0.8);
    this.cable(V(-13, 12, 13), V(-36, 2, 11.5), 3, C.TEAL, 1.2);
    this.cable(V(13, 16, -13), V(40, 20, -52), 7, C.GOLD, 0.6);
    this.cable(V(-13, 22, -13), V(-13, 12, 13), 5, C.CYAN, 1.1);
    this.cable(V(13, 28, 13), V(0, 11, 57), 8, C.BLUE, 1);

    // ================= enemy reinforcement points =================
    const S = (x, y, z) => this.spawnPoints.push(new THREE.Vector3(x, y, z));
    S(0, 9, -30); S(-8, 11, -46); S(22, 8, -30); S(30, 6, 0); S(60, 8, 0); S(-40, 3, 0);
    S(-40, 14, -34); S(0, 9, 50); S(-4, 8, 6); S(40, 19, -44); S(12, 9, 10); S(-25, 6, -20);
  }

  holoTree(x, top, z) {
    const mat = makeHoloMaterial(C.PINK, { opacity: 0.8, rim: 1.2, flicker: 0.2 });
    const g = new THREE.Group();
    g.position.set(x, top, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 3, 6), this.mats.dark);
    trunk.position.y = 1.5;
    g.add(trunk);
    const rng = makeRng(55);
    for (let i = 0; i < 9; i++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.7, 1.3), 0), mat);
      leaf.position.set(rng.range(-1.4, 1.4), 3 + rng.range(-0.4, 1.4), rng.range(-1.4, 1.4));
      g.add(leaf);
    }
    this.root.add(g);
    this.spinners.push({ obj: g, speed: 0.1, axis: 'y' });
    this.col.addTopBox(x, top + 3, z, 0.6, 3, 0.6, 'prop');
  }

  // ------------------------------------------------------------------ runtime

  setSkyliftOnline(on) {
    this.skylift.locked = !on;
    this.skylift.mat.uniforms.uActive.value = on ? 1 : 0;
    const s = this.skyliftSign;
    const { texture, aspect } = makeSignTexture(on ? 'SKYLIFT ONLINE' : 'SKYLIFT OFFLINE', on ? C.GOLD : C.RED, {});
    s.material.map.dispose();
    s.material.map = texture;
    s.geometry.dispose();
    s.geometry = new THREE.PlaneGeometry(0.9 * aspect, 0.9);
  }

  startCollapse() {
    this.collapsing = true;
    this.collapseT = 0;
  }

  reset() {
    this.collapsing = false;
    this.collapseT = 0;
    for (const c of this.collapsibles) {
      c.state = 'idle';
      c.t = 0;
      c.vel = 0;
      if (c.group) {
        c.group.visible = true;
        c.group.rotation.set(0, 0, 0);
        c.group.position.set(c.x, c.top, c.z);
      }
      // restore colliders to their original place
      for (const col of c.colliders) {
        if (col.userData.orig) {
          col.min.copy(col.userData.orig.min);
          col.max.copy(col.userData.orig.max);
        }
        col.enabled = true;
      }
      c.trimMat.color.copy(c.trimColor).multiplyScalar(3.2);
    }
    for (const m of this.movers) {
      m.offset = 0;
      m.fallen = false;
    }
    this.setSkyliftOnline(false);
    this.uplinkBeam.material.uniforms.uStrength.value = 0;
  }

  /** Called every frame. Returns list of events (e.g. collapse warnings) for the game to react to. */
  update(dt, t, events) {
    // moving stepping stones
    for (const m of this.movers) {
      if (m.fallen) continue;
      const off = Math.sin(t * m.speed + m.phase) * m.amp;
      const dy = off - m.offset;
      m.offset = off;
      m.group.position.y = m.baseTop + off;
      for (const col of m.colliders) {
        if (!col.userData.orig) col.userData.orig = { min: col.min.clone(), max: col.max.clone() };
        col.translate(0, dy, 0);
      }
    }

    // city collapse
    if (this.collapsing) {
      this.collapseT += dt;
      for (const c of this.collapsibles) {
        if (c.state === 'idle' && this.collapseT >= c.delay - 3) {
          c.state = 'warn';
          c.t = 0;
          events.push({ type: 'collapseWarn', pos: new THREE.Vector3(c.x, c.top, c.z) });
        }
        if (c.state === 'warn') {
          c.t += dt;
          const blink = Math.sin(c.t * (8 + c.t * 8)) > 0 ? 1 : 0.25;
          c.trimMat.color.setRGB(1, 0.35, 0.05).multiplyScalar(4 * blink);
          if (c.group) {
            const sh = 0.03 + c.t * 0.03;
            const baseY = c.mover ? c.mover.baseTop + c.mover.offset : c.top;
            c.group.position.set(c.x + (Math.random() - 0.5) * sh, baseY + (Math.random() - 0.5) * sh, c.z + (Math.random() - 0.5) * sh);
          }
          if (c.t >= 3) {
            c.state = 'fall';
            if (c.mover) c.mover.fallen = true;
            c.t = 0;
            c.vel = 0;
            c.spin.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6);
            for (const col of c.colliders) {
              if (!col.userData.orig) col.userData.orig = { min: col.min.clone(), max: col.max.clone() };
              col.enabled = false;
            }
            events.push({ type: 'collapseFall', pos: new THREE.Vector3(c.x, c.top, c.z), size: c.w * c.d });
          }
        } else if (c.state === 'fall') {
          c.t += dt;
          c.vel += 22 * dt;
          if (c.group) {
            c.group.position.y -= c.vel * dt;
            c.group.rotation.x += c.spin.x * dt;
            c.group.rotation.y += c.spin.y * dt;
            c.group.rotation.z += c.spin.z * dt;
          }
          if (c.t > 7) {
            c.state = 'gone';
            if (c.group) c.group.visible = false;
          }
        }
      }
    }

    // ambient animation
    for (const s of this.spinners) s.obj.rotation[s.axis] += s.speed * dt;
    for (const b of this.bobbers) b.obj.position.y = b.base + Math.sin(t * b.speed + b.phase) * b.amp;
    for (const f of this.flickers) {
      let k = 1;
      if (f.flicker > 0) {
        const n = Math.sin(t * 13 + f.phase) * Math.sin(t * 7.3 + f.phase * 2);
        if (n > 1 - f.flicker * 0.25) k = 0.15;
        if (f.dead > 0) { f.dead -= dt; k = 0.1; }
        else if (Math.random() < 0.0015 * f.flicker) f.dead = Math.random() * 0.4;
      }
      const alarm = shared.alarm.value;
      f.mat.color.setScalar(f.base * k * (1 - alarm * 0.3 * (Math.sin(t * 9) > 0 ? 1 : 0)));
    }
    for (const b of this.blinkers) {
      const on = Math.sin(t * 3 + b.phase) > 0.6;
      b.m.color.copy(b.base).multiplyScalar(on ? 1 : 0.05);
    }
    const alarm = shared.alarm.value;
    for (const L of this.lights) {
      L.l.color.copy(L.color).lerp(_orange, alarm * 0.6);
      L.l.intensity = L.base * (1 - alarm * 0.3 + (alarm > 0 ? Math.max(0, Math.sin(t * 6)) * alarm * 0.6 : 0));
    }
    for (const p of this.pads) {
      p.cool = Math.max(0, p.cool - dt);
      p.mat.uniforms.uKick.value = p.cool > 0 ? p.cool : 0;
    }
  }

  /** Which named district contains this point. */
  districtAt(p) {
    for (const d of this.districts) {
      if (p.x >= d.min.x && p.x <= d.max.x && p.z >= d.min.z && p.z <= d.max.z && p.y >= d.min.y && p.y <= d.max.y) return d.name;
    }
    return null;
  }

  inPool(p) {
    for (const pl of this.pools) {
      if (Math.abs(p.x - pl.x) < pl.w / 2 && Math.abs(p.z - pl.z) < pl.d / 2 && Math.abs(p.y - pl.top) < 0.3) return true;
    }
    return false;
  }
}

const _orange = new THREE.Color(1, 0.4, 0.1);
