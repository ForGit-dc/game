import * as THREE from 'three';
import { clamp, damp, noise1 } from '../utils/math.js';

/**
 * Three-quarter view camera: fixed yaw looking north, soft follow with cursor look-ahead,
 * wheel zoom, trauma shake and a cinematic override.
 */
export class TopCamera {
  constructor(camera) {
    this.camera = camera;
    this.minDist = 12;
    this.maxDist = 64;
    this.dist = 24;
    this.targetDist = 24;
    this.autoExtra = 0; // extra pull-back the game asks for (bosses, big hordes)
    this.autoTarget = 0;
    this.pitch = THREE.MathUtils.degToRad(47);
    this.focus = new THREE.Vector3();
    this.trauma = 0;
    this.shakeT = 0;
    this.fovKick = 0;
    this.baseFov = 50;
    this.cinematic = null;
    this.right = new THREE.Vector3(1, 0, 0);
    this._look = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();
    this.initialized = false;
  }

  /** Proportional zoom: the same wheel notch feels the same close up and far out. */
  zoom(delta) {
    this.targetDist = clamp(this.targetDist * Math.exp(delta * 0.0011), this.minDist, this.maxDist);
  }

  /** 0 = closest, 1 = furthest. */
  get zoomT() {
    return (this.dist - this.minDist) / (this.maxDist - this.minDist);
  }

  addTrauma(a) {
    this.trauma = Math.min(1, this.trauma + a);
  }

  snap(target) {
    this.focus.copy(target);
    this.initialized = true;
  }

  /** Where the mouse ray meets the horizontal plane y = h. */
  screenToGround(mx, my, w, h, planeY = 1.15) {
    this._ndc.set((mx / w) * 2 - 1, -(my / h) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    this._plane.constant = -planeY;
    const hit = this._ray.ray.intersectPlane(this._plane, this._hit);
    return hit ? this._hit : null;
  }

  update(dt, target, aimPoint = null) {
    const cam = this.camera;
    if (!this.initialized) this.snap(target);
    if (this.cinematic) {
      const c = this.cinematic;
      const k = damp(c.lambda ?? 3, dt);
      cam.position.lerp(c.pos, k);
      this._look.lerp(c.look, k);
      cam.lookAt(this._look);
      this._shake(dt);
      this._fov(dt);
      return;
    }
    // follow with a little look-ahead toward the cursor
    let fx = target.x, fz = target.z;
    if (aimPoint) {
      const ax = aimPoint.x - target.x, az = aimPoint.z - target.z;
      const al = Math.hypot(ax, az);
      const lead = Math.min(al, 10) * 0.22;
      if (al > 0.01) { fx += (ax / al) * lead; fz += (az / al) * lead; }
    }
    const k = damp(6, dt);
    this.focus.x += (fx - this.focus.x) * k;
    this.focus.z += (fz - this.focus.z) * k;
    this.focus.y += (target.y * 0.3 - this.focus.y) * k;
    this.autoExtra += (this.autoTarget - this.autoExtra) * damp(1.2, dt);
    this.dist += (clamp(this.targetDist + this.autoExtra, this.minDist, this.maxDist + 8) - this.dist) * damp(6, dt);
    // tilt toward top-down as you pull back, so the whole horde stays readable
    const zt = clamp((this.dist - this.minDist) / (this.maxDist - this.minDist), 0, 1);
    this.pitch = THREE.MathUtils.degToRad(44 + 22 * zt * zt * (3 - 2 * zt));
    const h = Math.sin(this.pitch) * this.dist;
    const back = Math.cos(this.pitch) * this.dist;
    this._pos.set(this.focus.x, this.focus.y + h, this.focus.z + back);
    cam.position.copy(this._pos);
    this._look.set(this.focus.x, this.focus.y + 0.6, this.focus.z);
    cam.lookAt(this._look);
    this._shake(dt);
    this._fov(dt);
  }

  _shake(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    if (s > 0.0001) {
      this.shakeT += dt * 32;
      const cam = this.camera;
      cam.position.x += noise1(this.shakeT) * 0.6 * s;
      cam.position.y += noise1(this.shakeT + 13.1) * 0.4 * s;
      cam.rotateZ(noise1(this.shakeT + 77.1) * 0.05 * s);
    }
  }

  _fov(dt) {
    this.fovKick *= Math.exp(-7 * dt);
    const target = this.baseFov + this.fovKick;
    const cam = this.camera;
    const f = cam.fov + (target - cam.fov) * damp(10, dt);
    if (Math.abs(f - cam.fov) > 0.01) {
      cam.fov = f;
      cam.updateProjectionMatrix();
    }
  }
}
