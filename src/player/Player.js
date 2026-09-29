import * as THREE from 'three';
import { buildCourier, Scarf } from './PlayerModel.js';
import { clamp, damp, dampAngle, angleDelta } from '../utils/math.js';

const RADIUS = 0.38;
const HEIGHT = 1.85;
const STEP = 0.55;
const GRAVITY = 30;

export const BASE_STATS = () => ({
  walk: 7.8,
  sprint: 11.8,
  damage: 11,
  fireRate: 7.5,
  shotCost: 3.2,
  split: 0,
  dashCd: 0.95,
  dashCharges: 1,
  maxEnergy: 100,
  energyRegen: 28,
  maxHp: 100,
  bladeDamage: 42,
  bladeRange: 3.3,
  phaseStrike: false,
  leech: 0,
  syncGain: 1,
  overclockTime: 5,
});

export class Player {
  constructor(game) {
    this.game = game;
    this.model = buildCourier();
    game.scene.add(this.model.group);
    this.scarf = new Scarf(game.scene);
    this.light = new THREE.PointLight('#7ff6ff', 6, 7, 1.8);
    this.light.position.set(0, 1.4, 0.6);
    this.model.group.add(this.light);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.moveOut = {};
    this.facing = 0;
    this._wish = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._anchor = new THREE.Vector3();
    this._back = new THREE.Vector3();
    this._center = new THREE.Vector3();
    this.reset(new THREE.Vector3(0, 0, 6), 0);
  }

  reset(spawn, yaw) {
    this.stats = BASE_STATS();
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.facing = yaw + Math.PI; // model forward = +Z; camera yaw 0 looks -Z
    this.hp = this.stats.maxHp;
    this.energy = this.stats.maxEnergy;
    this.sync = 0;
    this.grounded = true;
    this.wasGrounded = true;
    this.ground = null;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpsUsed = 0;
    this.jumpHeld = false;
    this.dashT = 0;
    this.dashDir = new THREE.Vector3();
    this.dashCharges = this.stats.dashCharges;
    this.dashRecharge = 0;
    this.dashHit = new Set();
    this.lungeT = 0;
    this.lungeVel = new THREE.Vector3();
    this.invuln = 0;
    this.launched = false;
    this.fireCd = 0;
    this.bladeCd = 0;
    this.bladePending = -1;
    this.aimT = 0;
    this.energyDelay = 0;
    this.overclockT = 0;
    this.dead = false;
    this.sprinting = false;
    this.lastSafe = { pos: spawn.clone(), collider: null };
    this.safeTimer = 0;
    this.stepDist = 0;
    this.turnRate = 0;
    this.airTime = 0;
    this.lockedPadMsg = 0;
    this.hitFlash = 0;
    this.model.group.visible = true;
    this.scarf.setVisible(true);
    this.scarf.initialized = false;
    this.model.group.position.copy(this.pos);
    this.model.group.rotation.y = this.facing;
    this.inPool = false;
    this.upgrades = {};
  }

  get alive() {
    return !this.dead;
  }

  /** Main update. `dt` is already scaled by the player's timescale. */
  update(dt, input, rig, controlsEnabled = true) {
    const g = this.game;
    const s = this.stats;
    if (this.dead) {
      this.scarf.update(dt, this._anchor, this._back.set(0, 0, 0), g.time);
      return;
    }

    // ---------------------------------------------------------------- input
    let ix = 0, iz = 0;
    if (controlsEnabled) {
      if (input.isDown('KeyW', 'ArrowUp')) iz += 1;
      if (input.isDown('KeyS', 'ArrowDown')) iz -= 1;
      if (input.isDown('KeyA', 'ArrowLeft')) ix -= 1;
      if (input.isDown('KeyD', 'ArrowRight')) ix += 1;
    }
    const fwdX = -Math.sin(rig.yaw), fwdZ = -Math.cos(rig.yaw);
    const rgtX = Math.cos(rig.yaw), rgtZ = -Math.sin(rig.yaw);
    const wish = this._wish.set(rgtX * ix + fwdX * iz, 0, rgtZ * ix + fwdZ * iz);
    const hasInput = wish.lengthSq() > 0.01;
    if (hasInput) wish.normalize();

    const shift = controlsEnabled && input.isDown('ShiftLeft', 'ShiftRight');
    const shiftPressed = controlsEnabled && input.wasPressed('ShiftLeft', 'ShiftRight');
    if (controlsEnabled && input.wasPressed('Space')) this.jumpBuffer = 0.14;
    this.jumpHeld = controlsEnabled && input.isDown('Space');
    const firing = controlsEnabled && input.mouse.left;
    const bladePressed = controlsEnabled && (input.mouse.rightPressed || input.wasPressed('KeyF'));
    const overPressed = controlsEnabled && input.wasPressed('KeyQ');

    // ---------------------------------------------------------------- timers
    this.coyote -= dt;
    this.jumpBuffer -= dt;
    this.fireCd -= dt;
    this.bladeCd -= dt;
    this.invuln -= dt;
    this.aimT -= dt;
    this.energyDelay -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    this.lockedPadMsg -= dt;
    if (this.dashCharges < s.dashCharges) {
      this.dashRecharge += dt;
      if (this.dashRecharge >= s.dashCd) {
        this.dashRecharge = 0;
        this.dashCharges++;
        g.ui.pulseAbility('dash');
      }
    } else this.dashRecharge = 0;

    // ---------------------------------------------------------------- dash
    if (shiftPressed && this.dashCharges > 0 && this.dashT <= 0) {
      const dir = hasInput ? wish.clone() : new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
      this.dashDir.copy(dir);
      this.dashT = 0.17;
      this.dashCharges--;
      this.invuln = Math.max(this.invuln, 0.22);
      this.launched = false;
      this.dashHit.clear();
      this.vel.y = Math.max(this.vel.y, 0);
      this.facing = Math.atan2(dir.x, dir.z);
      g.onPlayerDash(this);
    }
    this.sprinting = shift && hasInput && this.dashT <= 0;

    // ---------------------------------------------------------------- horizontal movement
    const lunging = this.lungeT > 0 && this.dashT <= 0;
    if (lunging) {
      this.lungeT -= dt;
      this.vel.copy(this.lungeVel);
      if (this.lungeT <= 0) this.vel.multiplyScalar(0.35);
    }
    const moving = this.dashT > 0;
    if (lunging) {
      // velocity already set
    } else if (moving) {
      this.dashT -= dt;
      const sp = 29;
      this.vel.x = this.dashDir.x * sp;
      this.vel.z = this.dashDir.z * sp;
      this.vel.y = 0;
      if (Math.random() < 0.6) g.fx.afterimage(this.model, this.pos, this.model.group.rotation.y);
      if (s.phaseStrike) g.phaseStrike(this);
      if (this.dashT <= 0) {
        // keep momentum out of the dash
        const keep = s.sprint * 1.05;
        this.vel.x = this.dashDir.x * keep;
        this.vel.z = this.dashDir.z * keep;
      }
    } else {
      let target = this.sprinting ? s.sprint : s.walk;
      if (firing) target *= 0.88;
      const tx = wish.x * target, tz = wish.z * target;
      let lambda;
      if (this.grounded) lambda = hasInput ? 13 : 16;
      else if (this.launched) lambda = hasInput ? 1.2 : 0.3;
      else lambda = hasInput ? 4.5 : 1.2;
      const k = damp(lambda, dt);
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
    }

    // ---------------------------------------------------------------- jumping
    const canGroundJump = this.grounded || this.coyote > 0;
    if (this.jumpBuffer > 0 && this.dashT <= 0) {
      if (canGroundJump) {
        this.vel.y = 10.6;
        this.jumpsUsed = 1;
        this.jumpBuffer = 0;
        this.coyote = 0;
        this.grounded = false;
        this.launched = false;
        g.onPlayerJump(this, false);
      } else if (this.jumpsUsed < 2) {
        this.vel.y = 9.6;
        this.jumpsUsed = 2;
        this.jumpBuffer = 0;
        this.launched = false;
        if (hasInput) {
          // redirect momentum on the double jump — feels great for platforming
          const sp = Math.max(Math.hypot(this.vel.x, this.vel.z), s.walk);
          this.vel.x = wish.x * sp;
          this.vel.z = wish.z * sp;
        }
        g.onPlayerJump(this, true);
      }
    }

    // ---------------------------------------------------------------- gravity
    if (!moving && !lunging) {
      let gmul = 1;
      if (!this.launched) {
        if (this.vel.y < 0) gmul = 1.45;
        else if (!this.jumpHeld) gmul = 2.1; // variable jump height
      }
      this.vel.y -= GRAVITY * gmul * dt;
      this.vel.y = Math.max(this.vel.y, -55);
    }

    // ---------------------------------------------------------------- carried by moving platforms
    if (this.grounded && this.ground && this.ground.enabled) {
      const d = this.ground.delta;
      if (d.lengthSq() > 0) this.pos.add(d);
    }

    // ---------------------------------------------------------------- integrate + collide
    const wasGrounded = this.grounded;
    const disp = this._tmp.copy(this.vel).multiplyScalar(dt);
    const out = g.collision.moveCharacter(this.pos, disp, RADIUS, HEIGHT, wasGrounded ? STEP : 0.3, this.moveOut);
    if (out.hitCeiling && this.vel.y > 0) this.vel.y = 0;
    this.grounded = out.grounded && this.vel.y <= 0.01;
    this.ground = out.ground;

    // stick to the ground when walking down steps / off tiny ledges
    if (!this.grounded && wasGrounded && this.vel.y <= 0 && !moving) {
      const probe = g.collision.probeGround(this.pos, RADIUS, 0.6);
      if (probe) {
        this.pos.y = probe.y;
        this.grounded = true;
        this.ground = probe.collider;
      }
    }

    if (this.grounded) {
      if (!wasGrounded) {
        const impact = -this.vel.y;
        if (this.airTime > 0.25 || impact > 12) g.onPlayerLand(this, impact);
        this.model.squash = clamp(impact / 40, 0.05, 0.3);
      }
      this.vel.y = 0;
      this.coyote = 0.12;
      this.jumpsUsed = 0;
      this.launched = false;
      this.airTime = 0;
      // replenish air dash on landing
      if (this.dashCharges < 1) this.dashCharges = 1;
    } else {
      this.airTime += dt;
    }

    // ---------------------------------------------------------------- footsteps
    const hsp = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hsp > 1) {
      this.stepDist += hsp * dt;
      const stride = this.sprinting ? 2.1 : 1.7;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        g.audio.footstep(this.sprinting);
      }
    }

    // ---------------------------------------------------------------- pads
    for (const pad of g.level.pads) {
      const dx = this.pos.x - pad.pos.x, dz = this.pos.z - pad.pos.z;
      if (dx * dx + dz * dz > 1.5 * 1.5) continue;
      if (Math.abs(this.pos.y - pad.pos.y) > 0.6 || this.vel.y > 0.1) continue;
      if (pad.locked) {
        if (this.lockedPadMsg <= 0) {
          this.lockedPadMsg = 4;
          g.onLockedPad(pad);
        }
        continue;
      }
      if (pad.cool > 0) continue;
      this.launch(pad);
      break;
    }

    // ---------------------------------------------------------------- coolant pools
    this.inPool = this.grounded && g.level.inPool(this.pos);
    const regen = this.inPool ? s.energyRegen * 3 : this.energyDelay <= 0 ? s.energyRegen : 0;
    this.energy = Math.min(s.maxEnergy, this.energy + regen * dt);
    if (this.inPool) this.hp = Math.min(s.maxHp, this.hp + 3 * dt);

    // ---------------------------------------------------------------- safe position tracking
    this.safeTimer -= dt;
    if (this.grounded && this.safeTimer <= 0 && this.ground && this.ground.tag === 'ground' && this.ground.enabled && this.ground.delta.lengthSq() === 0) {
      this.safeTimer = 0.3;
      this.lastSafe.pos.copy(this.pos);
      this.lastSafe.collider = this.ground;
    }
    if (this.pos.y < -32) g.onPlayerFell(this);

    // ---------------------------------------------------------------- combat
    const aim = firing || this.aimT > 0 ? g.getAim() : null;
    if (firing && this.fireCd <= 0) {
      if (this.energy >= s.shotCost) {
        this.fireCd = 1 / s.fireRate;
        this.energy -= s.shotCost;
        this.energyDelay = 0.4;
        this.aimT = 0.7;
        this.model.recoil = 1;
        this.model.muzzle.getWorldPosition(this._muzzle);
        g.firePlayerShot(this._muzzle, aim);
      } else {
        this.fireCd = 0.25;
        g.onOutOfEnergy();
      }
    }
    if (bladePressed && this.bladeCd <= 0) {
      this.bladeCd = 0.42;
      this.bladePending = 0.05;
      this.model.slash();
      g.onBladeStart(this);
    }
    if (this.bladePending >= 0) {
      this.bladePending -= dt;
      if (this.bladePending < 0) g.resolveBlade(this);
    }
    if (overPressed) {
      if (this.sync >= 100 && this.overclockT <= 0) {
        this.sync = 0;
        this.overclockT = s.overclockTime;
        g.onOverclock(true);
      } else if (this.overclockT <= 0) g.onOverclockNotReady();
    }
    if (this.overclockT > 0) {
      this.overclockT -= dt;
      if (this.overclockT <= 0) g.onOverclock(false);
    }

    // ---------------------------------------------------------------- facing & animation
    const aiming = this.aimT > 0 && this.dashT <= 0;
    let targetYaw = this.facing;
    if (aiming && aim) {
      this._tmp2.subVectors(aim.point, this.pos);
      targetYaw = Math.atan2(this._tmp2.x, this._tmp2.z);
    } else if (hsp > 0.6 && !moving) {
      targetYaw = Math.atan2(this.vel.x, this.vel.z);
    }
    const prev = this.facing;
    this.facing = dampAngle(this.facing, targetYaw, aiming ? 22 : 13, dt);
    this.turnRate = angleDelta(prev, this.facing) / Math.max(dt, 1e-4);

    let aimPitch = 0;
    if (aim) {
      this.model.muzzle.getWorldPosition(this._muzzle);
      this._tmp2.subVectors(aim.point, this._muzzle);
      aimPitch = Math.atan2(this._tmp2.y, Math.hypot(this._tmp2.x, this._tmp2.z));
    }

    const grp = this.model.group;
    grp.position.copy(this.pos);
    grp.rotation.y = this.facing;
    this.model.update(dt, {
      speed: moving ? 14 : hsp,
      grounded: this.grounded,
      vy: this.vel.y,
      dash: moving,
      aiming,
      aimPitch: clamp(aimPitch, -1.1, 1.1),
      turn: clamp(this.turnRate, -8, 8),
    });

    // hit flash on armour
    const flash = this.hitFlash;
    this.model.M.armor.emissive?.setRGB(flash * 3, flash * 0.4, flash * 0.6);
    this.light.intensity = 6 + (this.overclockT > 0 ? 6 : 0);

    // scarf anchored at the back of the neck
    this.model.chest.localToWorld(this._anchor.set(0, 0.43, -0.13));
    this._back.set(-this.vel.x, 0, -this.vel.z).multiplyScalar(0.25);
    this._back.x += -Math.sin(this.facing) * 1.5;
    this._back.z += -Math.cos(this.facing) * 1.5;
    this.scarf.update(dt, this._anchor, this._back, g.time);
  }

  /** Blade lunge: short burst toward a target, gravity suspended. */
  lunge(dir, speed = 20, time = 0.13) {
    this.lungeVel.copy(dir).multiplyScalar(speed);
    this.lungeT = time;
    this.launched = false;
    this.facing = Math.atan2(dir.x, dir.z);
  }

  launch(pad) {
    const start = this.pos;
    const tgt = pad.target;
    const apexY = Math.max(start.y, tgt.y) + pad.apex;
    const vy = Math.sqrt(2 * GRAVITY * (apexY - start.y));
    const tUp = vy / GRAVITY;
    const tDown = Math.sqrt((2 * (apexY - tgt.y)) / GRAVITY);
    const T = tUp + tDown;
    this.vel.set((tgt.x - start.x) / T, vy, (tgt.z - start.z) / T);
    this.launched = true;
    this.grounded = false;
    this.coyote = 0;
    this.jumpsUsed = 1;
    this.pos.y += 0.05;
    pad.cool = 0.6;
    this.game.onPadLaunch(pad);
  }

  takeDamage(amount, fromPos, kind = 'hit') {
    if (this.dead) return false;
    if (this.dashT > 0 || this.invuln > 0.25) {
      if (this.dashT > 0 && kind !== 'fall') this.game.onPerfectDodge(fromPos);
      return false;
    }
    if (this.invuln > 0 && kind !== 'fall') return false;
    this.hp -= amount;
    this.invuln = 0.4;
    this.hitFlash = 1;
    this.game.onPlayerHurt(amount, fromPos);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.game.onPlayerDeath();
    }
    return true;
  }

  heal(n) {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  addSync(n) {
    if (this.overclockT > 0) return;
    const before = this.sync;
    this.sync = Math.min(100, this.sync + n * this.stats.syncGain);
    if (before < 100 && this.sync >= 100) this.game.onSyncReady();
  }

  get center() {
    return this._center.set(this.pos.x, this.pos.y + 1.1, this.pos.z);
  }
}

export const PLAYER_RADIUS = RADIUS;
export const PLAYER_HEIGHT = HEIGHT;
