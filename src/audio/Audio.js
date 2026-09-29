/**
 * Fully procedural audio: generative synthwave score with intensity layers,
 * city ambience and every sound effect synthesized with the Web Audio API.
 */

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const PROG_CALM = [
  { root: 33, pad: [57, 60, 64, 67, 71] }, // Am9
  { root: 29, pad: [53, 57, 60, 64, 67] }, // Fmaj9
  { root: 36, pad: [52, 55, 59, 60, 62] }, // Cmaj9
  { root: 28, pad: [52, 55, 59, 62, 66] }, // Em9
];
const PROG_DARK = [
  { root: 33, pad: [57, 60, 64, 69, 72] }, // Am
  { root: 29, pad: [53, 57, 60, 65, 69] }, // F
  { root: 38, pad: [50, 53, 57, 62, 65] }, // Dm
  { root: 28, pad: [52, 56, 59, 64, 68] }, // E (G#)
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.8;
    this.intensity = 0;
    this.dark = false;
    this.listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
    this.lastPlay = new Map();
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // buses
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicBus.connect(this.musicFilter);
    this.musicFilter.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxFilter = ctx.createBiquadFilter();
    this.sfxFilter.type = 'lowpass';
    this.sfxFilter.frequency.value = 20000;
    this.sfxBus.connect(this.sfxFilter);
    this.sfxFilter.connect(this.master);

    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.5;
    this.ambBus.connect(this.sfxFilter);

    // reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.6);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.9;
    this.revSend.connect(this.reverb);
    this.reverb.connect(this.master);

    // music delay (dotted eighth)
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = (60 / 92) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dFilt = ctx.createBiquadFilter();
    dFilt.type = 'lowpass';
    dFilt.frequency.value = 2600;
    this.delay.connect(dFilt);
    dFilt.connect(fb);
    fb.connect(this.delay);
    dFilt.connect(this.musicBus);

    // noise
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // music layer gains
    this.layers = {};
    for (const k of ['pad', 'arp', 'bass', 'drums', 'alarm']) {
      const gnode = ctx.createGain();
      gnode.gain.value = k === 'pad' ? 0.9 : 0;
      gnode.connect(this.musicBus);
      this.layers[k] = gnode;
    }
    this.layers.arp.connect(this.delay);

    this.ready = true;
    this._startAmbience();
    this._startMusic();
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** 0 = clear, 1 = heavily muffled (pause), 0.5 = overclock. */
  setMuffle(m, sfx = m) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(18000 * Math.pow(1 - m, 3) + 350, t, 0.12);
    this.sfxFilter.frequency.setTargetAtTime(20000 * Math.pow(1 - sfx, 3) + 500, t, 0.08);
  }

  setListener(pos, right) {
    const L = this.listener;
    L.x = pos.x; L.y = pos.y; L.z = pos.z;
    L.rx = right.x; L.rz = right.z;
  }

  _spatial(pos, range = 14) {
    if (!pos) return { gain: 1, pan: 0 };
    const L = this.listener;
    const dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gain = 1 / (1 + (d / range) * (d / range));
    const pan = d > 0.1 ? Math.max(-1, Math.min(1, (dx * L.rx + dz * L.rz) / d)) * 0.75 : 0;
    return { gain, pan, d };
  }

  _throttle(key, ms) {
    const now = performance.now();
    if (now - (this.lastPlay.get(key) || 0) < ms) return true;
    this.lastPlay.set(key, now);
    return false;
  }

  /** Output node for a spatialized one-shot. */
  _out(pos, vol = 1, range = 14, reverb = 0.15) {
    const ctx = this.ctx;
    const { gain, pan } = this._spatial(pos, range);
    const g = ctx.createGain();
    g.gain.value = vol * gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(this.sfxBus);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      p.connect(s);
      s.connect(this.revSend);
    }
    return { node: g, gain };
  }

  _tone(dest, { type = 'sine', f = 440, f2 = null, t = 0, dur = 0.2, vol = 0.3, a = 0.004, curve = 'exp', detune = 0 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    o.detune.value = detune;
    if (f2 !== null) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t0 + dur);
      else o.frequency.linearRampToValueAtTime(f2, t0 + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  _noise(dest, { t = 0, dur = 0.2, vol = 0.3, type = 'bandpass', f = 1000, f2 = null, q = 1, a = 0.003 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + t;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(f, t0);
    if (f2 !== null) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    fl.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(fl);
    fl.connect(g);
    g.connect(dest);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.05);
  }

  // ================================================================ SFX

  uiHover() {
    if (!this.ready || this._throttle('hover', 40)) return;
    this._tone(this.sfxBus, { type: 'sine', f: 1800, f2: 2400, dur: 0.05, vol: 0.05 });
  }

  uiClick() {
    if (!this.ready) return;
    this._tone(this.sfxBus, { type: 'square', f: 880, f2: 1760, dur: 0.08, vol: 0.06 });
    this._tone(this.sfxBus, { type: 'sine', f: 440, t: 0.03, dur: 0.15, vol: 0.08 });
  }

  boot() {
    if (!this.ready) return;
    const o = this._out(null, 0.6, 1, 0.6);
    this._tone(o.node, { type: 'sawtooth', f: 55, f2: 440, dur: 1.4, vol: 0.2, a: 0.3 });
    this._tone(o.node, { type: 'sine', f: 880, t: 1.1, dur: 1.2, vol: 0.2 });
    this._tone(o.node, { type: 'sine', f: 1318.5, t: 1.25, dur: 1.2, vol: 0.12 });
    this._noise(o.node, { dur: 1.2, vol: 0.12, type: 'bandpass', f: 300, f2: 6000, q: 2, a: 0.4 });
  }

  shoot() {
    if (!this.ready) return;
    const o = this._out(null, 0.5, 1, 0.08);
    const f = 900 + Math.random() * 120;
    this._tone(o.node, { type: 'square', f, f2: f * 0.35, dur: 0.09, vol: 0.12 });
    this._tone(o.node, { type: 'sine', f: 180, f2: 60, dur: 0.08, vol: 0.25 });
    this._noise(o.node, { dur: 0.05, vol: 0.12, type: 'highpass', f: 4000 });
  }

  outOfEnergy() {
    if (!this.ready || this._throttle('ooe', 300)) return;
    this._tone(this.sfxBus, { type: 'square', f: 220, f2: 180, dur: 0.1, vol: 0.06 });
  }

  hit(pos, crit = false) {
    if (!this.ready || this._throttle('hit', 30)) return;
    const o = this._out(pos, 0.7, 18, 0.05);
    this._tone(o.node, { type: 'triangle', f: crit ? 1400 : 1000, f2: 300, dur: 0.07, vol: 0.2 });
    this._noise(o.node, { dur: 0.05, vol: 0.18, type: 'bandpass', f: 3000, q: 3 });
    if (crit) this._tone(o.node, { type: 'sine', f: 2600, t: 0.02, dur: 0.12, vol: 0.08 });
  }

  explosion(pos, size = 1) {
    if (!this.ready) return;
    const o = this._out(pos, 0.9 * Math.min(1.6, size), 22, 0.35);
    this._tone(o.node, { type: 'sine', f: 120 / Math.sqrt(size), f2: 30, dur: 0.6 * size, vol: 0.6 });
    this._noise(o.node, { dur: 0.7 * size, vol: 0.45, type: 'lowpass', f: 3500, f2: 120, q: 0.7 });
    this._noise(o.node, { dur: 0.12, vol: 0.25, type: 'highpass', f: 3000 });
    this._tone(o.node, { type: 'sawtooth', f: 400, f2: 40, dur: 0.3, vol: 0.12 });
  }

  dash() {
    if (!this.ready) return;
    const o = this._out(null, 0.6, 1, 0.2);
    this._noise(o.node, { dur: 0.28, vol: 0.35, type: 'bandpass', f: 600, f2: 4500, q: 1.4, a: 0.02 });
    this._tone(o.node, { type: 'sine', f: 300, f2: 900, dur: 0.18, vol: 0.12 });
  }

  jump(double = false) {
    if (!this.ready) return;
    const o = this._out(null, 0.4, 1, 0.1);
    if (double) {
      this._tone(o.node, { type: 'triangle', f: 500, f2: 1200, dur: 0.18, vol: 0.14 });
      this._noise(o.node, { dur: 0.2, vol: 0.15, type: 'bandpass', f: 1200, f2: 3000, q: 2 });
    } else {
      this._tone(o.node, { type: 'sine', f: 220, f2: 420, dur: 0.12, vol: 0.14 });
      this._noise(o.node, { dur: 0.08, vol: 0.08, type: 'highpass', f: 2000 });
    }
  }

  land(impact) {
    if (!this.ready) return;
    const v = Math.min(1, impact / 25);
    const o = this._out(null, 0.3 + v * 0.5, 1, 0.1);
    this._tone(o.node, { type: 'sine', f: 110, f2: 45, dur: 0.14, vol: 0.4 * v + 0.1 });
    this._noise(o.node, { dur: 0.1, vol: 0.12 * v + 0.04, type: 'lowpass', f: 1200 });
  }

  footstep(sprint) {
    if (!this.ready) return;
    const o = this._out(null, sprint ? 0.22 : 0.15, 1, 0.02);
    this._noise(o.node, { dur: 0.05, vol: 0.4, type: 'bandpass', f: 1800 + Math.random() * 900, q: 3 });
    this._tone(o.node, { type: 'sine', f: 90 + Math.random() * 20, f2: 50, dur: 0.06, vol: 0.2 });
  }

  blade() {
    if (!this.ready) return;
    const o = this._out(null, 0.6, 1, 0.25);
    this._noise(o.node, { dur: 0.2, vol: 0.4, type: 'bandpass', f: 1500, f2: 7000, q: 3, a: 0.01 });
    this._tone(o.node, { type: 'sawtooth', f: 180, f2: 900, dur: 0.14, vol: 0.06 });
  }

  bladeHit(pos) {
    if (!this.ready) return;
    const o = this._out(pos, 0.8, 18, 0.2);
    this._tone(o.node, { type: 'square', f: 160, f2: 60, dur: 0.12, vol: 0.2 });
    this._noise(o.node, { dur: 0.15, vol: 0.35, type: 'highpass', f: 2500 });
    this._tone(o.node, { type: 'sine', f: 3200, f2: 1800, dur: 0.18, vol: 0.06 });
  }

  deflect(pos) {
    if (!this.ready) return;
    const o = this._out(pos, 0.9, 18, 0.4);
    this._tone(o.node, { type: 'triangle', f: 1200, f2: 2400, dur: 0.25, vol: 0.2 });
    this._tone(o.node, { type: 'sine', f: 1800, f2: 3600, t: 0.04, dur: 0.3, vol: 0.12 });
    this._noise(o.node, { dur: 0.08, vol: 0.2, type: 'highpass', f: 5000 });
  }

  perfectDodge() {
    if (!this.ready) return;
    const o = this._out(null, 0.8, 1, 0.6);
    this._tone(o.node, { type: 'sine', f: 1600, f2: 400, dur: 0.6, vol: 0.18 });
    this._tone(o.node, { type: 'triangle', f: 2400, f2: 600, t: 0.02, dur: 0.6, vol: 0.08 });
  }

  echoPickup() {
    if (!this.ready) return;
    const o = this._out(null, 0.8, 1, 0.9);
    const notes = [69, 72, 76, 79, 83, 88];
    notes.forEach((n, i) => this._tone(o.node, { type: 'sine', f: midi(n), t: i * 0.07, dur: 1.6, vol: 0.14, a: 0.01 }));
    notes.forEach((n, i) => this._tone(o.node, { type: 'triangle', f: midi(n + 12), t: i * 0.07 + 0.02, dur: 0.8, vol: 0.04 }));
    this._noise(o.node, { dur: 1.2, vol: 0.08, type: 'bandpass', f: 3000, f2: 9000, q: 4, a: 0.2 });
  }

  echoDetected() {
    if (!this.ready) return;
    const o = this._out(null, 0.5, 1, 1);
    [81, 88, 81, 88].forEach((n, i) => this._tone(o.node, { type: 'sine', f: midi(n), t: i * 0.18, dur: 0.5, vol: 0.1 }));
  }

  pickup(kind) {
    if (!this.ready || this._throttle('pickup', 60)) return;
    const base = kind === 'hp' ? 76 : 81;
    this._tone(this.sfxBus, { type: 'sine', f: midi(base), dur: 0.12, vol: 0.1 });
    this._tone(this.sfxBus, { type: 'sine', f: midi(base + 7), t: 0.05, dur: 0.18, vol: 0.08 });
  }

  hurt() {
    if (!this.ready) return;
    const o = this._out(null, 0.8, 1, 0.1);
    this._tone(o.node, { type: 'sawtooth', f: 140, f2: 50, dur: 0.25, vol: 0.3 });
    this._noise(o.node, { dur: 0.2, vol: 0.3, type: 'lowpass', f: 2500, f2: 300 });
    this._tone(o.node, { type: 'square', f: 70, dur: 0.15, vol: 0.12 });
  }

  overclock(on) {
    if (!this.ready) return;
    const o = this._out(null, 0.9, 1, 0.8);
    if (on) {
      this._tone(o.node, { type: 'sawtooth', f: 880, f2: 55, dur: 0.9, vol: 0.18, curve: 'exp' });
      this._tone(o.node, { type: 'sine', f: 55, dur: 1.2, vol: 0.4, a: 0.05 });
      this._noise(o.node, { dur: 0.9, vol: 0.2, type: 'lowpass', f: 6000, f2: 200 });
    } else {
      this._tone(o.node, { type: 'sawtooth', f: 55, f2: 660, dur: 0.5, vol: 0.12 });
    }
  }

  syncReady() {
    if (!this.ready) return;
    [72, 79, 84].forEach((n, i) => this._tone(this.sfxBus, { type: 'triangle', f: midi(n), t: i * 0.08, dur: 0.35, vol: 0.08 }));
  }

  pad() {
    if (!this.ready) return;
    const o = this._out(null, 0.7, 1, 0.4);
    this._tone(o.node, { type: 'sine', f: 120, f2: 900, dur: 0.45, vol: 0.3 });
    this._noise(o.node, { dur: 0.5, vol: 0.25, type: 'bandpass', f: 400, f2: 5000, q: 1, a: 0.02 });
  }

  denied() {
    if (!this.ready) return;
    this._tone(this.sfxBus, { type: 'square', f: 180, dur: 0.12, vol: 0.08 });
    this._tone(this.sfxBus, { type: 'square', f: 140, t: 0.14, dur: 0.18, vol: 0.08 });
  }

  scoutCharge(pos) {
    if (!this.ready) return;
    const o = this._out(pos, 0.5, 14, 0.1);
    this._tone(o.node, { type: 'square', f: 600, f2: 2400, dur: 0.5, vol: 0.06, a: 0.05 });
  }

  scoutLunge(pos) {
    if (!this.ready) return;
    const o = this._out(pos, 0.6, 14, 0.1);
    this._noise(o.node, { dur: 0.3, vol: 0.2, type: 'bandpass', f: 3000, f2: 800, q: 2 });
  }

  sentinelCharge(pos, big = false) {
    if (!this.ready) return;
    const o = this._out(pos, big ? 1 : 0.6, big ? 40 : 20, 0.3);
    this._tone(o.node, { type: 'sawtooth', f: big ? 60 : 120, f2: big ? 240 : 520, dur: big ? 1.1 : 0.85, vol: 0.1, a: 0.1, curve: 'lin' });
    this._tone(o.node, { type: 'sine', f: big ? 120 : 240, f2: big ? 480 : 1040, dur: big ? 1.1 : 0.85, vol: 0.08, a: 0.1, curve: 'lin' });
  }

  sentinelFire(pos, big = false) {
    if (!this.ready) return;
    const o = this._out(pos, big ? 1 : 0.7, big ? 40 : 20, 0.3);
    this._tone(o.node, { type: 'square', f: big ? 200 : 400, f2: 80, dur: 0.3, vol: 0.18 });
    this._noise(o.node, { dur: 0.25, vol: 0.2, type: 'lowpass', f: 2000, f2: 200 });
  }

  enemyAlert(pos) {
    if (!this.ready || this._throttle('alert', 400)) return;
    const o = this._out(pos, 0.5, 20, 0.2);
    this._tone(o.node, { type: 'square', f: 1320, dur: 0.06, vol: 0.06 });
    this._tone(o.node, { type: 'square', f: 1760, t: 0.08, dur: 0.08, vol: 0.06 });
  }

  warp(pos) {
    if (!this.ready || this._throttle('warp', 150)) return;
    const o = this._out(pos, 0.6, 24, 0.5);
    this._tone(o.node, { type: 'sine', f: 2000, f2: 120, dur: 0.7, vol: 0.12 });
    this._noise(o.node, { dur: 0.6, vol: 0.12, type: 'bandpass', f: 6000, f2: 300, q: 3 });
  }

  collapse(pos) {
    if (!this.ready) return;
    const o = this._out(pos, 1.2, 40, 0.6);
    this._tone(o.node, { type: 'sine', f: 50, f2: 25, dur: 2.2, vol: 0.5, a: 0.05 });
    this._noise(o.node, { dur: 2.4, vol: 0.4, type: 'lowpass', f: 900, f2: 60, q: 0.8, a: 0.05 });
    for (let i = 0; i < 5; i++) this._noise(o.node, { t: 0.2 + i * 0.25 + Math.random() * 0.2, dur: 0.2, vol: 0.2, type: 'bandpass', f: 2000 + Math.random() * 2000, q: 5 });
  }

  creak(pos) {
    if (!this.ready) return;
    const o = this._out(pos, 0.8, 30, 0.5);
    this._tone(o.node, { type: 'sawtooth', f: 70, f2: 45, dur: 1.4, vol: 0.12, a: 0.2 });
    this._noise(o.node, { dur: 1.4, vol: 0.12, type: 'bandpass', f: 300, f2: 180, q: 8, a: 0.3 });
  }

  lightning() {
    if (!this.ready) return;
    const o = this._out(null, 0.35, 1, 1.2);
    this._noise(o.node, { t: 0.4 + Math.random() * 0.6, dur: 2.6, vol: 0.35, type: 'lowpass', f: 400, f2: 60, a: 0.04 });
  }

  warningBeep(n = 1) {
    if (!this.ready) return;
    for (let i = 0; i < n; i++) this._tone(this.sfxBus, { type: 'square', f: 1046, t: i * 0.22, dur: 0.15, vol: 0.08 });
  }

  collapseStart() {
    if (!this.ready) return;
    const o = this._out(null, 1, 1, 1);
    this._tone(o.node, { type: 'sawtooth', f: 40, f2: 30, dur: 4, vol: 0.4, a: 0.3 });
    this._tone(o.node, { type: 'sawtooth', f: 60.5, f2: 45, dur: 4, vol: 0.25, a: 0.3 });
    this._noise(o.node, { dur: 3.5, vol: 0.35, type: 'lowpass', f: 2500, f2: 80, a: 0.2 });
    // the Core's voice: a detuned, pitched-down chord
    [45, 48, 52, 53].forEach((n, i) => this._tone(o.node, { type: 'sine', f: midi(n), t: 0.6 + i * 0.05, dur: 3.5, vol: 0.1, a: 0.5 }));
  }

  uplinkStart() {
    if (!this.ready) return;
    const o = this._out(null, 1, 1, 1);
    [57, 64, 69, 73, 76].forEach((n, i) => this._tone(o.node, { type: 'triangle', f: midi(n), t: i * 0.1, dur: 2.2, vol: 0.1, a: 0.05 }));
    this._tone(o.node, { type: 'sine', f: 55, f2: 110, dur: 2, vol: 0.3 });
  }

  victory() {
    if (!this.ready) return;
    const o = this._out(null, 1, 1, 1.2);
    const chords = [[57, 61, 64, 69], [59, 62, 66, 71], [61, 64, 69, 73, 76, 81]];
    chords.forEach((c, k) => c.forEach((n, i) => this._tone(o.node, { type: 'triangle', f: midi(n), t: k * 0.7 + i * 0.03, dur: k === 2 ? 4 : 0.9, vol: 0.09, a: 0.02 })));
    this._noise(o.node, { dur: 3, vol: 0.15, type: 'bandpass', f: 800, f2: 9000, q: 2, a: 1 });
  }

  death() {
    if (!this.ready) return;
    const o = this._out(null, 1, 1, 1);
    this._tone(o.node, { type: 'sawtooth', f: 440, f2: 30, dur: 2.2, vol: 0.25 });
    this._tone(o.node, { type: 'square', f: 220, f2: 20, dur: 1.8, vol: 0.12 });
    this._noise(o.node, { dur: 1.5, vol: 0.3, type: 'lowpass', f: 8000, f2: 100 });
  }

  glitch() {
    if (!this.ready || this._throttle('glitch', 80)) return;
    const o = this._out(null, 0.5, 1, 0);
    for (let i = 0; i < 4; i++) this._tone(o.node, { type: 'square', f: 200 + Math.random() * 2000, t: i * 0.03, dur: 0.03, vol: 0.05 });
  }

  // ================================================================ ambience & music

  _startAmbience() {
    const ctx = this.ctx;
    // wind
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 500;
    wf.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 280;
    lfo.connect(lfoG);
    lfoG.connect(wf.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.22;
    wind.connect(wf);
    wf.connect(wg);
    wg.connect(this.ambBus);
    wind.start();
    lfo.start();
    // rain hiss
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuf;
    rain.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 5000;
    const rg = ctx.createGain();
    rg.gain.value = 0.045;
    rain.connect(rf);
    rf.connect(rg);
    rg.connect(this.ambBus);
    rain.start(0, 0.7);
    // city hum
    for (const [f, v] of [[55, 0.05], [110.5, 0.025], [165, 0.012]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = v;
      o.connect(g);
      g.connect(this.ambBus);
      o.start();
    }
    // distant pings / sirens
    this._ambT = setInterval(() => {
      if (!this.ready || this.ctx.state !== 'running') return;
      const r = Math.random();
      const o = this._out(null, 0.25, 1, 1.5);
      if (r < 0.4) {
        const n = [81, 84, 88, 91][Math.floor(Math.random() * 4)];
        this._tone(o.node, { type: 'sine', f: midi(n), dur: 1.4, vol: 0.05 });
        this._tone(o.node, { type: 'sine', f: midi(n) * 2.76, dur: 0.6, vol: 0.02 });
      } else if (r < 0.55) {
        this._tone(o.node, { type: 'triangle', f: 700, f2: 950, dur: 1.5, vol: 0.02, a: 0.4, curve: 'lin' });
        this._tone(o.node, { type: 'triangle', f: 950, f2: 700, t: 1.5, dur: 1.5, vol: 0.02, a: 0.2, curve: 'lin' });
      }
    }, 3800);
  }

  setIntensity(level) {
    if (!this.ready) return;
    if (level === this.intensity) return;
    this.intensity = level;
    const t = this.ctx.currentTime;
    const L = this.layers;
    const tgt = {
      '-1': { pad: 0.8, arp: 0, bass: 0, drums: 0, alarm: 0 },
      0: { pad: 0.85, arp: 0.35, bass: 0, drums: 0, alarm: 0 },
      1: { pad: 0.8, arp: 0.5, bass: 0.55, drums: 0.25, alarm: 0 },
      2: { pad: 0.7, arp: 0.55, bass: 0.7, drums: 0.8, alarm: 0 },
      3: { pad: 0.7, arp: 0.6, bass: 0.8, drums: 1, alarm: 0.5 },
    }[level];
    for (const k in tgt) L[k].gain.setTargetAtTime(tgt[k], t, 1.2);
  }

  setDark(dark) {
    this.dark = dark;
  }

  _startMusic() {
    this.bpm = 92;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.chordIdx = 0;
    this._musicT = setInterval(() => this._schedule(), 25);
  }

  _schedule() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this._playStep(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  _playStep(step, t, sx) {
    const prog = this.dark ? PROG_DARK : PROG_CALM;
    const bar32 = step % 32;
    if (bar32 === 0) {
      this.chordIdx = Math.floor(step / 32) % prog.length;
      this._padChord(prog[this.chordIdx].pad, t, sx * 32);
    }
    const chord = prog[this.chordIdx];
    const s16 = step % 16;
    // arp
    const pattern = [0, 2, 4, 1, 3, 2, 4, 3];
    const notes = chord.pad;
    const n = notes[pattern[step % 8] % notes.length] + 12 + (step % 32 >= 16 ? 12 : 0) * (this.intensity >= 2 ? 1 : 0);
    if (this.intensity >= 0 && (step % 2 === 0 || this.intensity >= 2)) this._pluck(n, t, sx * 1.6, this.intensity >= 2 ? 0.07 : 0.05);
    // bass
    if (this.intensity >= 1) {
      const bassSteps = this.intensity >= 3 ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 3, 6, 8, 11, 14];
      if (bassSteps.includes(s16)) this._bass(chord.root + (s16 === 14 ? 12 : 0), t, sx * 1.8);
    }
    // drums
    if (this.intensity >= 1) {
      const four = this.intensity >= 3;
      if (s16 === 0 || s16 === 8 || (four && (s16 === 4 || s16 === 12)) || (!four && s16 === 10 && this.intensity >= 2)) this._kick(t);
      if (this.intensity >= 2 && (s16 === 4 || s16 === 12)) this._snare(t);
      if (this.intensity >= 2 || s16 % 4 === 2) this._hat(t, s16 % 4 === 2 ? 0.05 : 0.025, four && s16 % 4 === 2);
    }
    // alarm stabs
    if (this.intensity >= 3 && step % 64 === 0) this._alarmStab(t);
  }

  _padChord(notes, t, dur) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.045;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(this.intensity < 0 ? 600 : 900, t);
    f.frequency.linearRampToValueAtTime(this.intensity < 0 ? 900 : 1700, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(this.intensity < 0 ? 600 : 1000, t + dur);
    f.Q.value = 2;
    out.connect(f);
    f.connect(this.layers.pad);
    const rs = ctx.createGain();
    rs.gain.value = 0.6;
    f.connect(rs);
    rs.connect(this.revSend);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 1.4);
    env.gain.setValueAtTime(1, t + dur - 0.2);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 2.2);
    env.connect(out);
    notes.forEach((n, i) => {
      for (const det of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det + (Math.random() - 0.5) * 4;
        const p = ctx.createStereoPanner();
        p.pan.value = (i / (notes.length - 1) - 0.5) * 0.8 * Math.sign(det);
        o.connect(p);
        p.connect(env);
        o.start(t);
        o.stop(t + dur + 2.4);
      }
    });
  }

  _pluck(n, t, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midi(n);
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = midi(n) * 1.002;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o2.connect(g2);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3800, t);
    f.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    g2.connect(f);
    f.connect(g);
    g.connect(this.layers.arp);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  _bass(n, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midi(n);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midi(n);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(140, t + dur * 0.8);
    f.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const sg = ctx.createGain();
    sg.gain.value = 0.9;
    o.connect(f);
    f.connect(g);
    sub.connect(sg);
    sg.connect(g);
    g.connect(this.layers.bass);
    o.start(t);
    sub.start(t);
    o.stop(t + dur + 0.05);
    sub.stop(t + dur + 0.05);
  }

  _kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g);
    g.connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.4);
  }

  _snare(t) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    s.connect(f);
    f.connect(g);
    g.connect(this.layers.drums);
    const rs = ctx.createGain();
    rs.gain.value = 0.4;
    g.connect(rs);
    rs.connect(this.revSend);
    s.start(t, Math.random());
    s.stop(t + 0.25);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.15, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og);
    og.connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.12);
  }

  _hat(t, vol, open) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = ctx.createGain();
    const d = open ? 0.18 : 0.04;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f);
    f.connect(g);
    g.connect(this.layers.drums);
    s.start(t, Math.random());
    s.stop(t + d + 0.02);
  }

  _alarmStab(t) {
    const ctx = this.ctx;
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(i ? 740 : 988, t + i * 0.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.4);
      g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.4 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.4 + 0.38);
      o.connect(g);
      g.connect(this.layers.alarm);
      o.start(t + i * 0.4);
      o.stop(t + i * 0.4 + 0.4);
    }
  }
}
