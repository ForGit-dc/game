import * as THREE from 'three';
import { buildCourier, Scarf } from './PlayerModel.js';
import { dampAngle, angleDelta, clamp } from '../utils/math.js';
import { SHOT_Y } from '../combat/Projectiles.js';

const RADIUS = 0.45;

/** K-7, twin-stick edition: move with WASD/ZQSD, aim with the mouse, dash, blade, overclock. */
export class Player {
  constructor(game) {
    this.game = game;
    this.model = buildCourier();
    this.model.group.scale.setScalar(1.25); // read clearly from the high camera
    game.scene.add(this.model.group);
    this.scarf = new Scarf(game.scene);
    this.light = new THREE.PointLight('#7ff6ff', 16, 10, 1.6);
    this.light.position.set(0, 2.6, 0.8);
    this.model.group.add(this.light);
    // floor marker so the courier never gets lost in the crowd
    this.marker = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#22e6ff').multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.82, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    this.marker.add(ring);
    const tick = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 3, 1, -0.22, 0.44), ringMat);
    tick.rotation.x = -Math.PI / 2;
    this.markerRing = ring;
    this.aimMarker = new THREE.Group();
    const chev = new THREE.Shape();
    chev.moveTo(-0.28, 0);
    chev.lineTo(0, 0.34);
    chev.lineTo(0.28, 0);
    chev.lineTo(0, 0.14);
    chev.closePath();
    const chevMesh = new THREE.Mesh(new THREE.ShapeGeometry(chev), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5ae0').multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    chevMesh.rotation.x = -Math.PI / 2;
    chevMesh.position.z = 1.35;
    this.aimMarker.add(chevMesh);
    this.marker.add(this.aimMarker);
    void tick;
    this.marker.renderOrder = 4;
    game.scene.add(this.marker);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.aim = new THREE.Vector3(0, 0, -1);
    this.dashDir = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._anchor = new THREE.Vector3();
    this._back = new THREE.Vector3();
    this._center = new THREE.Vector3();
    this.stats = null;
    this.reset();
  }

  reset() {
    this.pos.set(0, 0, 4);
    this.vel.set(0, 0, 0);
    this.aim.set(0, 0, -1);
    this.facing = Math.PI;
    this.hp = this.stats ? this.stats.maxHp : 100;
    this.dashCharges = this.stats ? this.stats.dashCharges : 1;
    this.dashRecharge = 0;
    this.dashT = 0;
    this.invuln = 0;
    this.bladeCd = 0;
    this.sync = 0;
    this.overT = 0;
    this.aimT = 0;
    this.dead = false;
    this.revived = false;
    this.hitFlash = 0;
    this.stepDist = 0;
    this.dropT = 0;
    this.firing = false;
    this.model.group.visible = true;
    if (this.marker) this.marker.visible = true;
    this.scarf.setVisible(true);
    this.scarf.initialized = false;
    this.model.group.position.copy(this.pos);
  }

  get center() {
    return this._center.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
  }

  get overclocked() {
    return this.overT > 0;
  }

  muzzleWorld() {
    this.model.muzzle.getWorldPosition(this._muzzle);
    // shots travel on a fixed plane so the top-down read stays clean
    this._muzzle.y = SHOT_Y;
    return this._muzzle;
  }

  /** Begin a run: the courier drops onto the Ring from the sky. */
  dropIn() {
    this.dropT = 1.1;
    this.pos.y = 14;
  }

  update(dt, input, aimPoint, controls = true) {
    const g = this.game;
    const s = this.stats;
    if (this.dead) {
      this.scarf.update(dt, this._anchor, this._back.set(0, -1, 0), g.time);
      return;
    }

    // drop-in from the sky
    if (this.dropT > 0) {
      this.dropT -= dt;
      const k = Math.max(0, this.dropT / 1.1);
      this.pos.y = 14 * k * k;
      if (this.dropT <= 0) {
        this.pos.y = 0;
        g.onPlayerLanded();
      }
    }

    // ---------------------------------------------------------------- input
    let ix = 0, iz = 0;
    if (controls) {
      if (input.isDown('KeyW', 'ArrowUp')) iz -= 1;
      if (input.isDown('KeyS', 'ArrowDown')) iz += 1;
      if (input.isDown('KeyA', 'ArrowLeft')) ix -= 1;
      if (input.isDown('KeyD', 'ArrowRight')) ix += 1;
    }
    const il = Math.hypot(ix, iz);
    if (il > 0) { ix /= il; iz /= il; }

    // aim towards the cursor on the ground
    if (aimPoint) {
      const ax = aimPoint.x - this.pos.x, az = aimPoint.z - this.pos.z;
      const al = Math.hypot(ax, az);
      if (al > 0.4) this.aim.set(ax / al, 0, az / al);
    }

    // timers
    this.invuln -= dt;
    this.bladeCd -= dt;
    this.aimT -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    if (this.dashCharges < s.dashCharges) {
      this.dashRecharge += dt;
      if (this.dashRecharge >= s.dashCd) {
        this.dashRecharge = 0;
        this.dashCharges++;
        g.ui.pulseAbility('dash');
      }
    } else this.dashRecharge = 0;

    // ---------------------------------------------------------------- dash
    if (controls && input.wasPressed('Space', 'ShiftLeft', 'ShiftRight') && this.dashCharges > 0 && this.dashT <= 0 && this.dropT <= 0) {
      if (il > 0) this.dashDir.set(ix, 0, iz);
      else this.dashDir.copy(this.aim);
      this.dashT = 0.17;
      this.dashCharges--;
      this.invuln = Math.max(this.invuln, 0.28);
      this.facing = Math.atan2(this.dashDir.x, this.dashDir.z);
      g.onPlayerDash(this);
    }

    // ---------------------------------------------------------------- movement
    const speed = 7.4 * s.speedMul;
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.set(this.dashDir.x * 27, 0, this.dashDir.z * 27);
      if (Math.random() < 0.7) g.fx.afterimage(this.model, this.pos, this.model.group.rotation.y);
      if (this.dashT <= 0) this.vel.set(this.dashDir.x * speed, 0, this.dashDir.z * speed);
    } else {
      const k = 1 - Math.exp(-(il > 0 ? 14 : 18) * dt);
      this.vel.x += (ix * speed - this.vel.x) * k;
      this.vel.z += (iz * speed - this.vel.z) * k;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (g.arena.constrain(this.pos, RADIUS)) g.arena.barrierU.uHit.value = Math.min(1, g.arena.barrierU.uHit.value + dt * 6);

    const hsp = Math.hypot(this.vel.x, this.vel.z);
    if (hsp > 1 && this.pos.y < 0.05) {
      this.stepDist += hsp * dt;
      if (this.stepDist > 1.9) {
        this.stepDist = 0;
        g.audio.footstep(hsp > 8);
      }
    }

    // ---------------------------------------------------------------- combat
    const firing = controls && this.dropT <= 0 && (input.mouse.left || g.settings.autoFire);
    if (firing) this.aimT = 0.45;
    if (controls && this.dropT <= 0 && (input.mouse.rightPressed || input.wasPressed('KeyF')) && this.bladeCd <= 0) {
      this.bladeCd = 0.62 * s.cdMul;
      this.model.slash();
      this.aimT = 0.5;
      this.facing = Math.atan2(this.aim.x, this.aim.z);
      g.bladeSlash(this);
    }
    if (controls && input.wasPressed('KeyQ')) {
      if (this.sync >= 100 && this.overT <= 0) {
        this.sync = 0;
        this.overT = s.overTime;
        g.onOverclock(true);
      } else if (this.overT <= 0) g.audio.denied();
    }
    if (this.overT > 0) {
      this.overT -= dt;
      if (this.overT <= 0) g.onOverclock(false);
    }
    this.firing = firing;

    // regen
    if (s.regen > 0) this.hp = Math.min(s.maxHp, this.hp + s.regen * dt);

    // ---------------------------------------------------------------- facing & animation
    let targetYaw = this.facing;
    if (this.aimT > 0 && this.dashT <= 0) targetYaw = Math.atan2(this.aim.x, this.aim.z);
    else if (hsp > 0.8) targetYaw = Math.atan2(this.vel.x, this.vel.z);
    const prev = this.facing;
    this.facing = dampAngle(this.facing, targetYaw, this.aimT > 0 ? 24 : 14, dt);
    const turn = angleDelta(prev, this.facing) / Math.max(dt, 1e-4);

    const grp = this.model.group;
    grp.position.copy(this.pos);
    grp.rotation.y = this.facing;
    // moving backwards while aiming: slow the stride so it reads as a backpedal
    const fwd = Math.sin(this.facing) * this.vel.x + Math.cos(this.facing) * this.vel.z;
    this.model.update(dt, {
      speed: this.dashT > 0 ? 14 : fwd < 0 ? hsp * 0.6 : hsp,
      grounded: this.pos.y < 0.05,
      vy: this.dropT > 0 ? -20 : 0,
      dash: this.dashT > 0,
      aiming: this.aimT > 0 && this.dashT <= 0,
      aimPitch: -0.05,
      turn: clamp(turn, -8, 8),
    });
    this.model.M.armor.emissive?.setRGB(0.012 + this.hitFlash * 3, 0.025 + this.hitFlash * 0.3, 0.045 + this.hitFlash * 0.5);
    this.light.intensity = 16 + (this.overT > 0 ? 10 : 0);
    this.light.color.set(this.overT > 0 ? '#ffd36b' : '#7ff6ff');

    this.marker.position.set(this.pos.x, 0.05, this.pos.z);
    this.markerRing.scale.setScalar(1 + Math.sin(g.time * 4) * 0.04 + (this.dashT > 0 ? 0.3 : 0));
    this.aimMarker.rotation.y = Math.atan2(this.aim.x, this.aim.z);
    this.marker.visible = this.dropT <= 0;
    this.model.chest.localToWorld(this._anchor.set(0, 0.43, -0.13));
    this._back.set(-this.vel.x * 0.25 - Math.sin(this.facing) * 1.5, 0, -this.vel.z * 0.25 - Math.cos(this.facing) * 1.5);
    this.scarf.update(dt, this._anchor, this._back, g.time);
  }

  /** Returns true when damage landed, 'dodge' for a perfect dodge, false when ignored. */
  hurt(dmg, fromX, fromZ) {
    if (this.dead || this.dropT > 0) return false;
    if (this.dashT > 0) {
      this.game.onPerfectDodge(fromX, fromZ);
      return 'dodge';
    }
    if (this.invuln > 0) return false;
    this.hp -= dmg;
    this.invuln = 0.55;
    this.hitFlash = 1;
    this.game.onPlayerHurt(dmg, fromX, fromZ);
    if (this.hp <= 0) {
      if (!this.revived && this.game.meta.level('revive') > 0) {
        this.revived = true;
        this.hp = this.stats.maxHp * 0.5;
        this.invuln = 2.5;
        this.game.onRevive();
      } else {
        this.hp = 0;
        this.dead = true;
        this.game.onPlayerDeath();
      }
    }
    return true;
  }

  heal(n) {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  addSync(n) {
    if (this.overT > 0) return;
    const before = this.sync;
    this.sync = Math.min(100, this.sync + n);
    if (before < 100 && this.sync >= 100) this.game.onSyncReady();
  }
}
