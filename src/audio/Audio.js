/**
 * Fully procedural audio — no music. A living storm (rain on metal, wind, rolling thunder
 * synced to the lightning) and every sound effect synthesized with the Web Audio API.
 */

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

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

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxFilter = ctx.createBiquadFilter();
    this.sfxFilter.type = 'lowpass';
    this.sfxFilter.frequency.value = 20000;
    this.sfxBus.connect(this.sfxFilter);
    this.sfxFilter.connect(this.master);

    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.55;
    this.ambFilter = ctx.createBiquadFilter();
    this.ambFilter.type = 'lowpass';
    this.ambFilter.frequency.value = 20000;
    this.ambBus.connect(this.ambFilter);
    this.ambFilter.connect(this.master);

    // reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.6);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.9;
    this.revSend.connect(this.reverb);
    this.reverb.connect(this.master);

    // noise
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // brown noise for thunder / rumble
    this.brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const bd = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      bd[i] = last * 3.5;
    }

    this.ready = true;
    this._startStorm();
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

  /** 0 = clear, 1 = heavily muffled (pause), 0.35 = overclock. `amb` muffles the storm, `sfx` the effects. */
  setMuffle(amb, sfx = amb) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.ambFilter.frequency.setTargetAtTime(20000 * Math.pow(1 - amb, 3) + 300, t, 0.12);
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
    this._noise(o.node, { dur: 1.2, vol: 0.14, type: 'bandpass', f: 300, f2: 6000, q: 2, a: 0.4 });
    this._tone(o.node, { type: 'sine', f: 880, t: 1.1, dur: 0.5, vol: 0.12 });
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
    const o = this._out(null, 0.9, 1, 0.9);
    // energy absorption: rising sweep + shimmer + sub thump (no melody)
    this._tone(o.node, { type: 'sine', f: 200, f2: 1600, dur: 0.7, vol: 0.18, a: 0.02 });
    this._tone(o.node, { type: 'triangle', f: 100, f2: 800, dur: 0.6, vol: 0.08, a: 0.02 });
    this._noise(o.node, { dur: 1.3, vol: 0.14, type: 'bandpass', f: 1500, f2: 9000, q: 3, a: 0.15 });
    this._tone(o.node, { type: 'sine', f: 70, f2: 35, t: 0.55, dur: 0.6, vol: 0.4 });
    this._noise(o.node, { t: 0.55, dur: 0.5, vol: 0.2, type: 'lowpass', f: 2500, f2: 150 });
  }


  echoDetected() {
    if (!this.ready) return;
    const o = this._out(null, 0.5, 1, 1);
    for (let i = 0; i < 3; i++) this._tone(o.node, { type: 'sine', f: 1320, t: i * 0.35, dur: 0.25, vol: 0.08 });
  }


  pickup(kind) {
    if (!this.ready || this._throttle('pickup', 60)) return;
    const f = kind === 'hp' ? 700 : 1000;
    this._tone(this.sfxBus, { type: 'sine', f, f2: f * 1.6, dur: 0.12, vol: 0.09 });
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
    this._tone(this.sfxBus, { type: 'triangle', f: 400, f2: 2000, dur: 0.35, vol: 0.08 });
    this._noise(this.sfxBus, { dur: 0.3, vol: 0.06, type: 'highpass', f: 5000, a: 0.1 });
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
    // most strikes are far away: delayed, soft and dark
    this.thunder(0.6 + Math.random() * 2.4, 0.35 + Math.random() * 0.45);
  }

  /** Rolling thunder from pre-rendered buffers (crack + rumble bank). power ≈ 0.3 (far) … 1.4 (overhead). */
  thunder(delay = 0, power = 1) {
    if (!this.ready || !this.thunderBufs?.length) return;
    if (this._throttle('thunder', 2500)) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const near = power > 0.95 && this.thunderNear;
    const buf = near ? this.thunderNear : this.thunderBufs[Math.floor(Math.random() * this.thunderBufs.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = near ? 0.95 + Math.random() * 0.1 : 0.8 + Math.random() * 0.25;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = near ? 9000 : 900 + power * 2600;
    lp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = Math.min(1, 0.7 * power);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * (near ? 0.4 : 1.1);
    src.connect(lp);
    lp.connect(g);
    g.connect(pan);
    pan.connect(this.ambBus);
    const rs = ctx.createGain();
    rs.gain.value = near ? 0.15 : 0.3;
    pan.connect(rs);
    rs.connect(this.revSend);
    src.start(t0);
  }

  warningBeep(n = 1) {
    if (!this.ready) return;
    for (let i = 0; i < n; i++) this._tone(this.sfxBus, { type: 'square', f: 1046, t: i * 0.22, dur: 0.15, vol: 0.08 });
  }

  collapseStart() {
    if (!this.ready) return;
    const o = this._out(null, 1, 1, 1);
    this._tone(o.node, { type: 'sawtooth', f: 40, f2: 28, dur: 4, vol: 0.4, a: 0.3 });
    this._tone(o.node, { type: 'sawtooth', f: 41.5, f2: 29, dur: 4, vol: 0.25, a: 0.3 });
    this._noise(o.node, { dur: 3.5, vol: 0.35, type: 'lowpass', f: 2500, f2: 80, a: 0.2 });
    this.thunder(0, 1.4);
  }


  uplinkStart() {
    if (!this.ready) return;
    const o = this._out(null, 1, 1, 1);
    this._tone(o.node, { type: 'sine', f: 55, f2: 110, dur: 2, vol: 0.3 });
    this._tone(o.node, { type: 'sawtooth', f: 110, f2: 880, dur: 2, vol: 0.06, a: 0.5 });
    this._noise(o.node, { dur: 2.2, vol: 0.18, type: 'bandpass', f: 400, f2: 6000, q: 2, a: 0.6 });
  }


  victory() {
    if (!this.ready) return;
    const o = this._out(null, 1, 1, 1.2);
    this._tone(o.node, { type: 'sine', f: 60, f2: 30, dur: 3, vol: 0.4, a: 0.05 });
    this._noise(o.node, { dur: 3.5, vol: 0.2, type: 'bandpass', f: 300, f2: 9000, q: 1.5, a: 1.2 });
    this._tone(o.node, { type: 'sawtooth', f: 80, f2: 1200, dur: 3, vol: 0.05, a: 1 });
    this.thunder(0.2, 1.2);
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

  // ================================================================ survivor SFX (non-melodic)

  levelUp() {
    if (!this.ready) return;
    const o = this._out(null, 0.8, 1, 0.8);
    this._tone(o.node, { type: 'sine', f: 300, f2: 2400, dur: 0.5, vol: 0.14, a: 0.01 });
    this._noise(o.node, { dur: 0.8, vol: 0.14, type: 'bandpass', f: 2000, f2: 10000, q: 2, a: 0.1 });
    this._tone(o.node, { type: 'sine', f: 60, f2: 40, t: 0.05, dur: 0.4, vol: 0.3 });
  }

  xpTick() {
    if (!this.ready || this._throttle('xp', 45)) return;
    this._tone(this.sfxBus, { type: 'sine', f: 1900 + Math.random() * 500, dur: 0.035, vol: 0.025 });
  }

  kill(size = 1) {
    if (!this.ready || this._throttle('kill', 35)) return;
    const o = this._out(null, 0.35 * Math.min(1.6, size), 1, 0.05);
    this._noise(o.node, { dur: 0.09 * size, vol: 0.3, type: 'bandpass', f: 1400 + Math.random() * 800, f2: 300, q: 1.2 });
    this._tone(o.node, { type: 'sine', f: 180 / size, f2: 50, dur: 0.1 * size, vol: 0.25 });
  }

  bossWarn() {
    if (!this.ready) return;
    const o = this._out(null, 1, 1, 0.8);
    for (let i = 0; i < 3; i++) {
      this._tone(o.node, { type: 'sawtooth', f: 90, f2: 60, t: i * 0.5, dur: 0.45, vol: 0.2 });
      this._noise(o.node, { t: i * 0.5, dur: 0.4, vol: 0.14, type: 'lowpass', f: 900, f2: 100 });
    }
    this.thunder(0.2, 0.9);
  }

  bossCharge(pos, dur = 1) {
    if (!this.ready) return;
    const o = this._out(pos, 0.8, 30, 0.3);
    this._tone(o.node, { type: 'sawtooth', f: 70, f2: 420, dur, vol: 0.09, a: 0.1, curve: 'lin' });
    this._noise(o.node, { dur, vol: 0.1, type: 'bandpass', f: 400, f2: 4000, q: 4, a: dur * 0.6 });
  }

  laser(pos) {
    if (!this.ready) return;
    const o = this._out(pos, 0.8, 30, 0.3);
    this._tone(o.node, { type: 'sawtooth', f: 180, f2: 150, dur: 3.4, vol: 0.06, a: 0.05 });
    this._noise(o.node, { dur: 3.4, vol: 0.08, type: 'bandpass', f: 2500, q: 6, a: 0.05 });
  }

  rail() {
    if (!this.ready) return;
    const o = this._out(null, 0.7, 1, 0.3);
    this._noise(o.node, { dur: 0.25, vol: 0.35, type: 'highpass', f: 2500, a: 0.002 });
    this._tone(o.node, { type: 'square', f: 1400, f2: 90, dur: 0.22, vol: 0.12 });
    this._tone(o.node, { type: 'sine', f: 90, f2: 40, dur: 0.25, vol: 0.35 });
  }

  laserZap() {
    if (!this.ready || this._throttle('lz', 70)) return;
    this._tone(this.sfxBus, { type: 'square', f: 2600, f2: 900, dur: 0.05, vol: 0.03 });
  }

  arcZap(big = false) {
    if (!this.ready || this._throttle('arc', 60)) return;
    const o = this._out(null, big ? 0.6 : 0.45, 1, big ? 0.4 : 0.1);
    this._noise(o.node, { dur: big ? 0.22 : 0.12, vol: 0.35, type: 'highpass', f: 3000, a: 0.002 });
    for (let i = 0; i < 3; i++) this._tone(o.node, { type: 'square', f: 400 + Math.random() * 1600, t: i * 0.02, dur: 0.03, vol: 0.05 });
    if (big) this._tone(o.node, { type: 'sine', f: 70, f2: 35, dur: 0.3, vol: 0.25 });
  }

  nova(big = false) {
    if (!this.ready) return;
    const o = this._out(null, big ? 0.8 : 0.6, 1, 0.3);
    this._tone(o.node, { type: 'sine', f: 120, f2: 40, dur: 0.4, vol: 0.4 });
    this._noise(o.node, { dur: 0.35, vol: 0.25, type: 'lowpass', f: 4000, f2: 200, a: 0.005 });
  }

  missileLaunch() {
    if (!this.ready || this._throttle('ml', 120)) return;
    const o = this._out(null, 0.4, 1, 0.1);
    this._noise(o.node, { dur: 0.3, vol: 0.25, type: 'bandpass', f: 800, f2: 3000, q: 2, a: 0.01 });
  }

  missileHit() {
    if (!this.ready || this._throttle('mh', 50)) return;
    const o = this._out(null, 0.4, 1, 0.1);
    this._noise(o.node, { dur: 0.18, vol: 0.3, type: 'lowpass', f: 3000, f2: 200 });
    this._tone(o.node, { type: 'sine', f: 110, f2: 45, dur: 0.15, vol: 0.2 });
  }

  bomberArm() {
    if (!this.ready || this._throttle('ba', 90)) return;
    for (let i = 0; i < 3; i++) this._tone(this.sfxBus, { type: 'square', f: 1200, t: i * 0.2, dur: 0.06, vol: 0.04 });
  }

  shardAim() {
    if (!this.ready || this._throttle('sa', 120)) return;
    this._tone(this.sfxBus, { type: 'sawtooth', f: 500, f2: 1800, dur: 0.5, vol: 0.025, a: 0.05 });
  }

  chest() {
    if (!this.ready) return;
    const o = this._out(null, 0.8, 1, 0.6);
    this._noise(o.node, { dur: 0.7, vol: 0.2, type: 'bandpass', f: 600, f2: 8000, q: 2, a: 0.05 });
    this._tone(o.node, { type: 'sine', f: 200, f2: 1200, dur: 0.5, vol: 0.12 });
    this._tone(o.node, { type: 'sine', f: 60, f2: 35, dur: 0.4, vol: 0.3 });
  }

  evolve() {
    if (!this.ready) return;
    const o = this._out(null, 1, 1, 1);
    this._tone(o.node, { type: 'sawtooth', f: 60, f2: 1600, dur: 1.2, vol: 0.08, a: 0.3 });
    this._noise(o.node, { dur: 1.4, vol: 0.2, type: 'bandpass', f: 300, f2: 9000, q: 1.5, a: 0.6 });
    this._tone(o.node, { type: 'sine', f: 55, f2: 30, t: 1.1, dur: 0.8, vol: 0.45 });
  }

  meteor() {
    if (!this.ready || this._throttle('met', 80)) return;
    const o = this._out(null, 0.6, 1, 0.3);
    this._tone(o.node, { type: 'sine', f: 90, f2: 30, dur: 0.5, vol: 0.4 });
    this._noise(o.node, { dur: 0.45, vol: 0.3, type: 'lowpass', f: 2500, f2: 120 });
  }

  powerDown() {
    if (!this.ready) return;
    const o = this._out(null, 0.9, 1, 0.8);
    this._tone(o.node, { type: 'sawtooth', f: 240, f2: 25, dur: 2.2, vol: 0.15 });
    this._noise(o.node, { dur: 1.5, vol: 0.12, type: 'lowpass', f: 3000, f2: 80 });
  }

  blocked() {
    if (!this.ready || this._throttle('blk', 90)) return;
    this._tone(this.sfxBus, { type: 'triangle', f: 1800, f2: 1500, dur: 0.06, vol: 0.05 });
  }

  // ================================================================ the storm

  /** Ambience volume (rain, wind, thunder), 0..1. */
  setAmbience(v) {
    this.ambience = v;
    if (this.ambBus) this.ambBus.gain.setTargetAtTime(0.9 * v, this.ctx.currentTime, 0.1);
  }

  /**
   * Loopable stereo rain: a soft pink-noise bed plus thousands of individual droplets
   * (short decaying noise bursts, power-law sizes, random pan and brightness). No tones.
   */
  _renderRain(seconds, density, bright) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (const d of [L, R]) {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.03;
        b6 = w * 0.115926;
      }
    }
    const count = Math.floor(density * seconds);
    for (let k = 0; k < count; k++) {
      const start = Math.floor(Math.random() * n);
      const size = Math.pow(Math.random(), 2.4);
      const amp = 0.05 + size * 0.6;
      const len = Math.floor(sr * (0.0012 + size * 0.006 + Math.random() * 0.002));
      const decay = Math.exp(-4 / len);
      const pan = Math.random();
      const gl = Math.sqrt(1 - pan) * amp, gr = Math.sqrt(pan) * amp;
      const a = Math.min(0.9, 0.08 + Math.random() * 0.5 * bright);
      let y = 0, env = 1;
      for (let j = 0; j < len; j++) {
        y += a * ((Math.random() * 2 - 1) * env - y);
        env *= decay;
        const idx = (start + j) % n;
        L[idx] += y * gl;
        R[idx] += y * gr;
      }
    }
    // remove rumble / DC, then normalise
    const c = Math.exp((-2 * Math.PI * 140) / sr);
    let peak = 1e-6;
    for (const d of [L, R]) {
      let px = d[n - 1], py = 0;
      for (let i = 0; i < n; i++) {
        const x = d[i];
        py = c * (py + x - px);
        px = x;
        d[i] = py;
        const ab = py < 0 ? -py : py;
        if (ab > peak) peak = ab;
      }
    }
    const k = 0.7 / peak;
    for (const d of [L, R]) for (let i = 0; i < n; i++) d[i] *= k;
    return buf;
  }

  /**
   * Thunder: many overlapping rumble swells shaped from brown noise through a lowpass that
   * closes over time (energy loss with distance), stereo-offset; `near` adds the initial crack.
   */
  _renderThunder(seconds, near) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    const env = new Float32Array(n + 2048);
    const events = near ? 46 : 30;
    for (let e = 0; e < events; e++) {
      const t = Math.pow(Math.random(), 1.7) * seconds * 0.7 + (near ? 0.02 : 0.15);
      const amp = Math.pow(Math.max(0, 1 - t / seconds), 1.6) * (0.25 + 0.75 * Math.random());
      const att = Math.floor(sr * (0.03 + Math.random() * 0.12));
      const dec = sr * (0.2 + Math.random() * 0.9);
      const s0 = Math.floor(t * sr);
      const endI = Math.min(n, s0 + att + Math.floor(dec * 4));
      const k = Math.exp(-1 / dec);
      let v = amp;
      for (let i = s0; i < endI; i++) {
        if (i < s0 + att) env[i] += (amp * (i - s0)) / att;
        else { env[i] += v; v *= k; }
      }
    }
    const f0 = near ? 2600 : 900;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const off = ch ? Math.floor(sr * 0.009) : 0;
      let b = 0, y1 = 0, y2 = 0, a = 0;
      for (let i = 0; i < n; i++) {
        if ((i & 127) === 0) {
          const f = f0 * Math.pow(1 - i / n, 2.2) + 55;
          a = 1 - Math.exp((-2 * Math.PI * f) / sr);
        }
        const w = Math.random() * 2 - 1;
        b = (b + 0.02 * w) / 1.02;
        const src = b * 3.5 + w * 0.08;
        y1 += a * (src - y1);
        y2 += a * (y1 - y2);
        const ei = i - off;
        d[i] = y2 * (ei >= 0 ? env[ei] : 0);
      }
    }
    if (near) {
      // the crack: a bright, slightly clipped burst, then a short low boom
      const start = Math.floor(sr * 0.01);
      const len = Math.floor(sr * 0.09);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let hp = 0, prev = 0;
        for (let j = 0; j < len; j++) {
          const w = Math.random() * 2 - 1;
          hp = 0.9 * (hp + w - prev);
          prev = w;
          const e = Math.exp(-j / (sr * 0.018));
          d[start + j] += Math.tanh(hp * 2.2) * e * 0.9;
        }
      }
    }
    let peak = 1e-6;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) { const ab = Math.abs(d[i]); if (ab > peak) peak = ab; }
    }
    const k = 0.9 / peak;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] *= k;
      // fade the tail to silence
      const fade = Math.floor(sr * 0.5);
      for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
    }
    return buf;
  }

  _loopBuffer(buf, { rate = 1, lowpass = 20000, highpass = 20, vol = 0.3, dest }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = highpass;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(dest);
    src.start(0, Math.random() * buf.duration);
    g.gain.setTargetAtTime(vol, ctx.currentTime, 1.2);
    return { src, lp, g, vol };
  }

  _startStorm() {
    const ctx = this.ctx;
    let amb = 0.6;
    try {
      const v = localStorage.getItem('neon-echo-amb');
      if (v !== null) amb = parseFloat(v);
    } catch {
      /* no storage */
    }
    this.setAmbience(amb);
    this.stormLevel = 0.6;
    // wind: dark, slowly gusting noise (the only continuous element that isn't rain)
    const wind = ctx.createBufferSource();
    wind.buffer = this.brownBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 380;
    const wg = ctx.createGain();
    wg.gain.value = 0.1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.06;
    lfo.connect(lfoG);
    lfoG.connect(wg.gain);
    wind.connect(wf);
    wf.connect(wg);
    wg.connect(this.ambBus);
    wind.start(0, Math.random());
    lfo.start();
    this.wind = { f: wf, g: wg };
    // render the rain & thunder banks off the click handler, in small steps
    const jobs = [
      () => { this.rainNear = this._loopBuffer(this._renderRain(5.3, 1900, 1), { highpass: 300, lowpass: 8000, vol: 0.36, dest: this.ambBus }); },
      () => { this.rainFar = this._loopBuffer(this._renderRain(6.1, 3600, 0.35), { rate: 0.72, highpass: 120, lowpass: 3200, vol: 0.42, dest: this.ambBus }); },
      () => { this.thunderBufs = [this._renderThunder(7.5, false)]; },
      () => { this.thunderBufs.push(this._renderThunder(9, false)); },
      () => { this.thunderNear = this._renderThunder(8, true); },
    ];
    const run = () => {
      const job = jobs.shift();
      if (!job) return;
      job();
      setTimeout(run, 30);
    };
    setTimeout(run, 60);
  }

  /** Storm intensity: -1 menu, 0 calm, 1..3 building up to the bosses. */
  setIntensity(level) {
    if (!this.ready || level === this.intensity) return;
    this.intensity = level;
    const k = { '-1': 0.75, 0: 0.8, 1: 0.88, 2: 0.95, 3: 1.05 }[level] ?? 0.8;
    this.stormLevel = k;
    const t = this.ctx.currentTime;
    if (this.rainNear) this.rainNear.g.gain.setTargetAtTime(this.rainNear.vol * k, t, 2);
    if (this.rainFar) this.rainFar.g.gain.setTargetAtTime(this.rainFar.vol * k, t, 2);
    this.wind.f.frequency.setTargetAtTime(300 + k * 160, t, 3);
  }

  setDark() {}
}
