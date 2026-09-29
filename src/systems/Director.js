import * as THREE from 'three';
import { pick, rand, formatTime } from '../utils/math.js';
import { shared } from '../world/Materials.js';

export const REQUIRED_ECHOES = 5;
const COLLAPSE_TIME = 140;
const UPLINK_TIME = 18;

const ECHO_LINES = [
  '“Deliver the package. Do not open it.”',
  '“The city was never floating. It was falling. Slowly.”',
  '“They shut down every courier. Every one but you.”',
  '“The package was never in the bag, K-7. It was you.”',
  '“YOU WERE NOT SUPPOSED TO WAKE UP.”',
  '“If the Core sees you, run. Don’t look back.”',
  '“I left a light on at the Skyport. Come home.”',
];

/**
 * Run director: phases, threat level, reinforcements, narrative beats, the collapse and the uplink.
 */
export class Director {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.phase = 'wake';
    this.t = 0;
    this.echoes = 0;
    this.danger = 1;
    this.core = 61;
    this.collapseT = 0;
    this.timeLeft = COLLAPSE_TIME;
    this.spawnT = 12;
    this.uplink = 0;
    this.uplinkWave = 0;
    this.inZone = false;
    this.aggroMul = 1;
    this.district = null;
    this.visited = new Set();
    this.beats = new Set();
    this.hintMove = false;
    this.hintCombat = false;
    this.moved = 0;
    this.alarm = 0;
    this.warnings = new Set();
    this.lastPos = null;
    shared.alarm.value = 0;
  }

  get required() {
    return REQUIRED_ECHOES;
  }

  once(key, fn) {
    if (this.beats.has(key)) return;
    this.beats.add(key);
    fn();
  }

  // ---------------------------------------------------------------- events

  onEcho(echo) {
    const g = this.game;
    this.echoes++;
    const n = this.echoes;
    this.core = Math.min(99, 61 + n * 5);
    this.danger = n >= REQUIRED_ECHOES ? 5 : n >= 4 ? 4 : n >= 2 ? 3 : 2;
    this.spawnT = Math.min(this.spawnT, 4);
    const line = ECHO_LINES[Math.min(n - 1, ECHO_LINES.length - 1)];
    g.ui.log(`ECHO ${String(n).padStart(2, '0')} // ${line}`, n === 5 ? 'red' : 'echo');
    g.core.setAwake(0.15 + n * 0.16);
    if (n === 1) g.ui.log('THREAT LEVEL RISING. DRONES INBOUND.', 'warn');
    if (n === REQUIRED_ECHOES && this.phase === 'explore') {
      this.startCollapse();
      return false; // no banner / augment delay handled by game
    }
    if (n > REQUIRED_ECHOES) g.ui.log(`BONUS ECHO RECOVERED — ${this.game.echoes.remaining.length} LEFT`, 'gold');
    else g.ui.log(`CITY CORE FAILURE: ${this.core}%`, 'warn');
    return true;
  }

  startCollapse() {
    const g = this.game;
    this.phase = 'collapse';
    this.collapseT = 0;
    this.timeLeft = COLLAPSE_TIME;
    this.aggroMul = 3;
    for (const e of g.enemies.list) e.aware = true;
    g.level.startCollapse();
    g.level.setSkyliftOnline(true);
    g.core.setAwake(1.3);
    g.onCollapseStart();
    setTimeout(() => g.ui.log('SKYLIFT ONLINE — LIFT DECK, EAST OF THE MARKET.', 'gold'), 2500);
    setTimeout(() => g.ui.log('REACH SKYPORT 07. HOLD THE UPLINK.', 'sys'), 4500);
  }

  // ---------------------------------------------------------------- tick

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.t += dt;

    // alarm ramp (drives shaders)
    const alarmTarget = this.phase === 'collapse' || this.phase === 'uplink' ? 1 : 0;
    this.alarm += (alarmTarget - this.alarm) * Math.min(1, dt * 0.8);
    shared.alarm.value = this.alarm;

    if (this.phase === 'wake') this.updateWake();
    this.updateHints(dt);
    this.updateDistrict();

    if (this.phase === 'explore' || this.phase === 'collapse' || this.phase === 'uplink') this.updateSpawns(dt);

    if (this.phase === 'collapse' || this.phase === 'uplink') {
      this.collapseT += dt;
      this.timeLeft = Math.max(0, COLLAPSE_TIME - this.collapseT);
      this.core = Math.min(100, 86 + 14 * (this.collapseT / COLLAPSE_TIME));
      for (const mark of [60, 30, 10]) {
        if (this.timeLeft <= mark && !this.warnings.has(mark)) {
          this.warnings.add(mark);
          g.ui.log(`STRUCTURAL FAILURE IN ${mark} SECONDS`, 'red');
          g.audio.warningBeep(mark <= 10 ? 3 : 1);
        }
      }
      if (this.timeLeft <= 0) {
        g.gameOver('The city fell into the Abyss — with you still in it.');
        return;
      }
    }

    if (this.phase === 'collapse') {
      if (this.playerInZone()) this.startUplink();
    } else if (this.phase === 'uplink') {
      this.inZone = this.playerInZone();
      if (this.inZone && !p.dead) {
        this.uplink = Math.min(1, this.uplink + dt / UPLINK_TIME);
      }
      if (this.uplink > 0.33 && this.uplinkWave < 2) this.uplinkWaveSpawn(2);
      if (this.uplink > 0.66 && this.uplinkWave < 3) this.uplinkWaveSpawn(3);
      if (this.uplink >= 1) g.victory();
    }
  }

  playerInZone() {
    const p = this.game.player.pos;
    const sp = this.game.level.skyport;
    const dx = p.x - sp.center.x, dz = p.z - sp.center.z;
    return dx * dx + dz * dz < sp.radius * sp.radius && Math.abs(p.y - sp.center.y) < 2.5;
  }

  startUplink() {
    const g = this.game;
    this.phase = 'uplink';
    this.uplink = 0;
    g.onUplinkStart();
    this.uplinkWaveSpawn(1);
  }

  uplinkWaveSpawn(n) {
    const g = this.game;
    this.uplinkWave = n;
    const c = g.level.skyport.center;
    const ring = (count, type, r, h) => {
      for (let i = 0; i < count; i++) {
        const a = rand(0, Math.PI * 2);
        g.enemies.spawn(type, new THREE.Vector3(c.x + Math.cos(a) * r, c.y + h + rand(-1, 2), c.z + Math.sin(a) * r), { aware: true });
      }
    };
    if (n === 1) {
      g.enemies.spawn('warden', new THREE.Vector3(c.x, c.y + 11, c.z - 16), { aware: true });
      ring(3, 'scout', 13, 4);
      g.ui.banner('WARDEN-CLASS SIGNATURE', 'THE CORE SENT ITS WARDEN', 'Hold the uplink zone. Deflect its orbs.', 'red');
    } else if (n === 2) {
      ring(2, 'guardian', 18, 7);
      ring(2, 'scout', 12, 3);
      g.ui.log('UPLINK 33% — SECOND WAVE', 'warn');
    } else {
      ring(4, 'scout', 12, 3);
      ring(1, 'guardian', 16, 6);
      g.ui.log('UPLINK 66% — THEY ARE DESPERATE', 'warn');
    }
  }

  updateWake() {
    const g = this.game;
    const t = this.t;
    const at = (time, key, fn) => {
      if (t >= time) this.once(key, fn);
    };
    at(0.6, 'w1', () => g.ui.log('SYSTEM RESTORED.', 'sys'));
    at(1.5, 'w2', () => g.ui.log('UNIT K-7 // COURIER CLASS // ONLINE', 'sys'));
    at(2.6, 'w3', () => g.ui.log('CITY CORE FAILURE: 61%', 'warn'));
    at(3.6, 'w4', () => {
      g.ui.banner('SIGNAL 7', 'ECHO SIGNAL DETECTED', `7 memory fragments nearby — recover ${REQUIRED_ECHOES}`, '');
      g.audio.echoDetected();
    });
    at(5.2, 'w5', () => {
      g.ui.log('FOLLOW THE CYAN BEAMS.', 'echo');
      this.phase = 'explore';
      g.updateObjective();
    });
  }

  updateHints(dt) {
    const g = this.game;
    const p = g.player;
    if (!this.lastPos) this.lastPos = p.pos.clone();
    this.moved += p.pos.distanceTo(this.lastPos);
    this.lastPos.copy(p.pos);
    if (this.t > 4 && !this.hintMove) {
      this.hintMove = true;
      g.ui.prompt(`${g.keyHint('KeyW', 'KeyA', 'KeyS', 'KeyD')} MOVE · <kbd>SPACE</kbd> JUMP ×2 · <kbd>SHIFT</kbd> DASH`, 9);
    }
    if (!this.hintCombat && g.enemies.awareCount(40, p.pos) > 0) {
      this.hintCombat = true;
      g.ui.prompt('<kbd>LMB</kbd> PULSE · <kbd>RMB</kbd> BLADE — DEFLECTS ORANGE ORBS · DASH THROUGH ATTACKS', 7);
    }
  }

  updateDistrict() {
    const g = this.game;
    const d = g.level.districtAt(g.player.pos);
    if (d && d !== this.district) {
      this.district = d;
      if (!this.visited.has(d)) {
        this.visited.add(d);
        if (this.t > 5) g.ui.location(d);
      }
    }
  }

  updateSpawns(dt) {
    const g = this.game;
    if (this.phase === 'explore' && this.echoes === 0) return;
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    const uplink = this.phase === 'uplink';
    const budget = uplink ? 9 : [0, 0, 3, 4, 6, 7][this.danger];
    const interval = uplink ? 3.2 : [0, 0, 10, 8, 6, 4.5][this.danger];
    this.spawnT = interval * rand(0.8, 1.2);
    if (g.enemies.count() >= budget) return;
    const p = g.player.pos;
    let pts;
    if (uplink) {
      const c = g.level.skyport.center;
      const a = rand(0, Math.PI * 2);
      pts = [new THREE.Vector3(c.x + Math.cos(a) * 16, c.y + rand(3, 8), c.z + Math.sin(a) * 16)];
    } else {
      pts = g.level.spawnPoints.filter((s) => {
        const d = s.distanceTo(p);
        return d > 18 && d < 55;
      });
      if (!pts.length) pts = g.level.spawnPoints;
    }
    const sp = pick(pts).clone().add(new THREE.Vector3(rand(-3, 3), rand(-1, 1), rand(-3, 3)));
    const scoutChance = [1, 1, 0.8, 0.65, 0.55, 0.5][this.danger];
    const type = Math.random() < scoutChance ? 'scout' : 'guardian';
    g.enemies.spawn(type, sp, { aware: this.danger >= 3 || uplink });
    if (type === 'scout' && this.danger >= 4 && Math.random() < 0.5) {
      g.enemies.spawn('scout', sp.clone().add(new THREE.Vector3(2, 1, 0)), { aware: true });
    }
  }

  get objective() {
    const g = this.game;
    const n = this.echoes;
    if (this.phase === 'wake') return { text: 'Systems rebooting…', sub: '' };
    if (this.phase === 'explore')
      return { text: 'Recover Echo fragments', sub: `${n} / ${REQUIRED_ECHOES} recovered · ${g.echoes.items.length} detected` };
    if (this.phase === 'collapse')
      return { text: 'Reach Skyport 07', sub: g.level.skylift.locked ? '' : 'Skylift on the lift deck, east of the market', alert: true };
    if (this.phase === 'uplink')
      return { text: this.inZone ? 'Hold the uplink' : 'Return to the uplink zone!', sub: `Uplink ${Math.floor(this.uplink * 100)}%`, alert: !this.inZone };
    return { text: '', sub: '' };
  }

  get timerText() {
    return formatTime(this.timeLeft);
  }
}
