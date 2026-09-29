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
    this.ambBus.gain.value = 0.7;
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
    this.thunder(0.25 + Math.random() * 2.2, 0.55 + Math.random() * 0.6);
  }

  /** Rolling thunder: optional close crack, then a long brown-noise rumble with random swells. */
  thunder(delay = 0, power = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 1.2;
    pan.connect(this.ambBus);
    const rs = ctx.createGain();
    rs.gain.value = 0.5;
    pan.connect(rs);
    rs.connect(this.revSend);
    if (power > 0.9 || Math.random() < 0.35) {
      // crack
      const c = ctx.createBufferSource();
      c.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5 * power, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      c.connect(hp);
      hp.connect(g);
      g.connect(pan);
      c.start(t0, Math.random());
      c.stop(t0 + 0.4);
    }
    const dur = 3 + Math.random() * 3 * power;
    const src = ctx.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900 * power + 200, t0);
    lp.frequency.exponentialRampToValueAtTime(90, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    let tt = t0 + 0.05;
    g.gain.exponentialRampToValueAtTime(0.9 * power, tt);
    while (tt < t0 + dur - 0.4) {
      tt += 0.2 + Math.random() * 0.6;
      g.gain.exponentialRampToValueAtTime(Math.max(0.05, (0.2 + Math.random() * 0.8) * power * (1 - (tt - t0) / dur)), tt);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(pan);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.1);
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

  // ================================================================ the storm

  _loopNoise(buf, type, freq, q, vol, pan, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f);
    f.connect(g);
    g.connect(p);
    p.connect(dest);
    src.start(0, Math.random() * 1.8);
    return { src, f, g };
  }

  _startStorm() {
    const ctx = this.ctx;
    const bus = this.ambBus;
    // rain bed: two decorrelated layers, wide stereo
    this.rainL = this._loopNoise(this.noiseBuf, 'bandpass', 2400, 0.35, 0.16, -0.7, bus);
    this.rainR = this._loopNoise(this.noiseBuf, 'bandpass', 2900, 0.35, 0.16, 0.7, bus);
    this.rainHiss = this._loopNoise(this.noiseBuf, 'highpass', 6500, 0.5, 0.05, 0, bus);
    // heavy downpour body
    this.rainBody = this._loopNoise(this.brownBuf, 'lowpass', 900, 0.5, 0.35, 0, bus);
    // wind with slow gusts
    this.wind = this._loopNoise(this.noiseBuf, 'lowpass', 420, 0.7, 0.12, 0, bus);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 260;
    lfo.connect(lfoG);
    lfoG.connect(this.wind.f.frequency);
    lfo.start();
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.045;
    const lfo2G = ctx.createGain();
    lfo2G.gain.value = 0.07;
    lfo2.connect(lfo2G);
    lfo2G.connect(this.wind.g.gain);
    lfo2.start();
    // city hum far below the clouds
    const hum = ctx.createOscillator();
    hum.frequency.value = 48;
    const humG = ctx.createGain();
    humG.gain.value = 0.025;
    hum.connect(humG);
    humG.connect(bus);
    hum.start();

    this.stormLevel = 0.6;
    // droplets on metal, gutter drips
    this._dropT = setInterval(() => this._drops(), 50);
    // background thunder even when no lightning is on screen
    this._thunderT = setInterval(() => {
      if (this.ctx.state === 'running' && Math.random() < 0.35) this.thunder(Math.random(), 0.25 + Math.random() * 0.3);
    }, 6000);
  }

  _drops() {
    if (!this.ready || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const n = Math.floor(this.stormLevel * 4 + Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + Math.random() * 0.05;
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2500 + Math.random() * 5500;
      f.Q.value = 6 + Math.random() * 10;
      const g = ctx.createGain();
      const v = 0.02 + Math.random() * 0.06;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012 + Math.random() * 0.02);
      const p = ctx.createStereoPanner();
      p.pan.value = Math.random() * 2 - 1;
      s.connect(f);
      f.connect(g);
      g.connect(p);
      p.connect(this.ambBus);
      s.start(t, Math.random() * 1.9);
      s.stop(t + 0.05);
    }
    if (Math.random() < 0.05) {
      // heavier drip from a gutter
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f0 = 500 + Math.random() * 500;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      const p = ctx.createStereoPanner();
      p.pan.value = Math.random() * 1.6 - 0.8;
      o.connect(g);
      g.connect(p);
      p.connect(this.ambBus);
      const rs = ctx.createGain();
      rs.gain.value = 0.3;
      p.connect(rs);
      rs.connect(this.revSend);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  /** Storm intensity instead of music: -1 menu, 0 calm, 1..3 building up to the collapse. */
  setIntensity(level) {
    if (!this.ready || level === this.intensity) return;
    this.intensity = level;
    const k = { '-1': 0.55, 0: 0.6, 1: 0.7, 2: 0.8, 3: 1 }[level] ?? 0.6;
    this.stormLevel = k;
    const t = this.ctx.currentTime;
    this.rainL.g.gain.setTargetAtTime(0.16 * k, t, 1.5);
    this.rainR.g.gain.setTargetAtTime(0.16 * k, t, 1.5);
    this.rainBody.g.gain.setTargetAtTime(0.35 * k * k, t, 1.5);
    this.wind.f.frequency.setTargetAtTime(300 + k * 300, t, 2);
  }

  setDark() {}
}
