import * as THREE from 'three';
import { clamp, damp, noise1 } from '../utils/math.js';

/** Over-the-shoulder third-person camera with collision, trauma shake and FOV kicks. */
export class CameraRig {
  constructor(camera, collision) {
    this.camera = camera;
    this.col = collision;
    this.yaw = 0;
    this.pitch = -0.12;
    this.dist = 5.4;
    this.curDist = 5.4;
    this.shoulder = 0.65;
    this.pivot = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.trauma = 0;
    this.shakeT = 0;
    this.baseFov = 72;
    this.fovKick = 0;
    this.sens = 1;
    this.invertY = false;
    this.cinematic = null; // { pos: Vector3, look: Vector3, lambda }
    this._desired = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this.initialized = false;
  }

  applyMouse(dx, dy) {
    const k = 0.0021 * this.sens;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (this.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.25, 1.05);
  }

  addTrauma(a) {
    this.trauma = Math.min(1, this.trauma + a);
  }

  snapTo(target, yaw = this.yaw) {
    this.yaw = yaw;
    this.pivot.set(target.x, target.y + 1.55, target.z);
    this.curDist = this.dist;
    this.initialized = true;
  }

  computeBasis() {
    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  update(dt, target, { speedFov = 0, extraDist = 0 } = {}) {
    const cam = this.camera;
    if (!this.initialized) this.snapTo(target);

    if (this.cinematic) {
      const c = this.cinematic;
      const k = damp(c.lambda ?? 3, dt);
      cam.position.lerp(c.pos, k);
      this._look.lerp(c.look, k);
      cam.lookAt(this._look);
      this._shake(dt);
      this._fov(dt, 0);
      return;
    }

    // smooth pivot (vertical slower so jumps feel floaty, not jittery)
    this.pivot.x += (target.x - this.pivot.x) * damp(20, dt);
    this.pivot.z += (target.z - this.pivot.z) * damp(20, dt);
    this.pivot.y += (target.y + 1.55 - this.pivot.y) * damp(11, dt);

    this.computeBasis();
    const want = this.dist + extraDist - Math.max(0, -this.pitch) * 1.2;
    this._origin.copy(this.pivot).addScaledVector(this.right, this.shoulder * 0.5);
    this._desired
      .copy(this.pivot)
      .addScaledVector(this.forward, -want)
      .addScaledVector(this.right, this.shoulder)
      .add(_up.set(0, 0.22, 0));
    this._dir.subVectors(this._desired, this._origin);
    const len = this._dir.length();
    this._dir.divideScalar(len || 1);
    let hit = this.col.raycast(this._origin, this._dir, len + 0.3);
    let d = len;
    if (hit < len + 0.3) d = Math.max(0.6, hit - 0.35);
    // snap in fast, ease out slowly
    this.curDist += (d - this.curDist) * (d < this.curDist ? damp(30, dt) : damp(5, dt));
    cam.position.copy(this._origin).addScaledVector(this._dir, this.curDist);
    this._look.copy(cam.position).add(this.forward);
    cam.lookAt(this._look);

    this._shake(dt);
    this._fov(dt, speedFov);
  }

  _shake(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    if (s > 0.0001) {
      this.shakeT += dt * 30;
      const cam = this.camera;
      cam.rotateX(noise1(this.shakeT) * 0.05 * s);
      cam.rotateY(noise1(this.shakeT + 31.7) * 0.05 * s);
      cam.rotateZ(noise1(this.shakeT + 77.1) * 0.08 * s);
    }
  }

  _fov(dt, speedFov) {
    this.fovKick *= Math.exp(-6 * dt);
    const target = this.baseFov + speedFov + this.fovKick;
    const cam = this.camera;
    const f = cam.fov + (target - cam.fov) * damp(8, dt);
    if (Math.abs(f - cam.fov) > 0.01) {
      cam.fov = f;
      cam.updateProjectionMatrix();
    }
  }
}

const _up = new THREE.Vector3();
