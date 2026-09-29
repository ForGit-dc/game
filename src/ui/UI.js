import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

/** All DOM-side presentation: HUD, world markers, damage numbers, menus, augment cards, end screens. */
export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), objective: document.querySelector('.objective'), objText: $('obj-text'), objSub: $('obj-sub'),
      log: $('log'), echoRow: $('echo-row'), danger: $('danger'), core: $('core-val'), score: $('score-val'),
      timerWrap: $('timer-wrap'), timer: $('timer'), hpFill: $('hp-fill'), hpGhost: $('hp-ghost'), hpVal: $('hp-val'),
      hpBar: document.querySelector('.bar.hp'), enFill: $('en-fill'), enVal: $('en-val'),
      abDash: $('ab-dash'), abBlade: $('ab-blade'), abOver: $('ab-over'), dashPips: $('dash-pips'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'), dmgDir: $('dmg-dir'),
      banner: $('banner'), bannerKicker: $('banner-kicker'), bannerMain: $('banner-main'), bannerSub: $('banner-sub'),
      uplink: $('uplink'), ulRing: $('ul-ring'), ulPct: $('ul-pct'), prompt: $('prompt'), lockHint: $('lock-hint'),
      markers: $('markers'), dmgnums: $('dmgnums'), fade: $('fade'),
      boot: $('boot'), menu: $('menu'), augment: $('augment'), pause: $('pause'), gameover: $('gameover'), victory: $('victory'),
      augCards: $('aug-cards'), augKicker: $('aug-kicker'),
    };
    this.cache = {};
    this.logLines = [];
    this.nums = [];
    this.promptT = 0;
    this.spread = 0;
    this.markers = [];
    this.aug = null;
    this._bind();
    this._location = document.createElement('div');
    this._location.className = 'location';
    Object.assign(this._location.style, {
      position: 'absolute', top: '96px', left: '50%', transform: 'translateX(-50%)', fontSize: '13px',
      letterSpacing: '0.5em', color: 'var(--gold)', opacity: '0', transition: 'opacity 0.6s', textShadow: '0 0 12px rgba(255,211,107,0.6)',
      whiteSpace: 'nowrap',
    });
    this.el.hud.appendChild(this._location);
  }

  _bind() {
    const g = this.game;
    document.querySelectorAll('[data-action]').forEach((b) => {
      b.addEventListener('mouseenter', () => g.audio.uiHover());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        g.audio.uiClick();
        g.onMenuAction(b.dataset.action, b);
      });
    });
    $('set-sens').addEventListener('input', (e) => g.setSensitivity(parseFloat(e.target.value)));
    $('set-vol').addEventListener('input', (e) => g.audio.setVolume(parseFloat(e.target.value)));
    $('set-invert').addEventListener('change', (e) => (g.rig.invertY = e.target.checked));
  }

  // ------------------------------------------------------------------ screens

  show(name) {
    for (const s of ['menu', 'augment', 'pause', 'gameover', 'victory']) this.el[s].classList.toggle('hidden', s !== name);
  }

  hideAll() {
    this.show(null);
  }

  setHud(v) {
    this.el.hud.classList.toggle('hidden', !v);
  }

  panel(name) {
    $('panel-controls').classList.toggle('hidden', name !== 'controls');
    $('panel-credits').classList.toggle('hidden', name !== 'credits');
  }

  fade(v, white = false, dur = 0.6) {
    const f = this.el.fade;
    f.classList.toggle('white', white);
    f.style.transitionDuration = `${dur}s`;
    f.style.opacity = String(v);
  }

  // ------------------------------------------------------------------ messages

  log(text, cls = '') {
    const line = document.createElement('div');
    line.className = `log-line ${cls}`;
    this.el.log.appendChild(line);
    // typewriter
    let i = 0;
    const step = Math.max(1, Math.ceil(text.length / 26));
    const tick = () => {
      i = Math.min(text.length, i + step);
      line.textContent = text.slice(0, i);
      if (i < text.length) setTimeout(tick, 16);
    };
    tick();
    this.logLines.push({ line, t: 0 });
    while (this.logLines.length > 6) this.logLines.shift().line.remove();
  }

  banner(kicker, main, sub = '', cls = '') {
    const b = this.el.banner;
    b.className = '';
    void b.offsetWidth; // restart animation
    b.className = `show ${cls}`;
    this.el.bannerKicker.textContent = kicker;
    this.el.bannerMain.textContent = main;
    this.el.bannerMain.dataset.text = main;
    this.el.bannerSub.textContent = sub;
  }

  location(name) {
    this._location.textContent = `▸ ${name}`;
    this._location.style.opacity = '1';
    clearTimeout(this._locT);
    this._locT = setTimeout(() => (this._location.style.opacity = '0'), 3200);
  }

  prompt(html, seconds = 5) {
    this.el.prompt.innerHTML = html;
    this.el.prompt.classList.add('show');
    this.promptT = seconds;
  }

  pulseAbility(name) {
    const el = name === 'dash' ? this.el.abDash : name === 'blade' ? this.el.abBlade : this.el.abOver;
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 140);
  }

  hitmarker(kill = false) {
    const h = this.el.hitmarker;
    h.className = '';
    void h.offsetWidth;
    h.className = kill ? 'show kill' : 'show';
  }

  damageDirection(fromPos) {
    const g = this.game;
    const p = g.player.pos;
    const dx = fromPos.x - p.x, dz = fromPos.z - p.z;
    const ang = Math.atan2(dx, dz); // world angle
    const camYaw = g.rig.yaw; // camera looks along (-sin yaw, -cos yaw)
    const rel = -(ang - (camYaw + Math.PI));
    const d = document.createElement('div');
    d.className = 'dd';
    d.style.transform = `rotate(${rel}rad)`;
    this.el.dmgDir.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  kickCrosshair(a = 6) {
    this.spread = Math.min(22, this.spread + a);
  }

  // ------------------------------------------------------------------ damage numbers

  number(pos, text, cls = '') {
    let n = this.nums.find((x) => !x.active);
    if (!n) {
      if (this.nums.length > 40) return;
      const el = document.createElement('div');
      this.el.dmgnums.appendChild(el);
      n = { el, active: false };
      this.nums.push(n);
    }
    n.active = true;
    n.el.className = `dmgnum ${cls}`;
    n.el.textContent = text;
    n.el.style.display = 'block';
    n.pos = pos.clone();
    n.pos.x += (Math.random() - 0.5) * 0.6;
    n.pos.y += 0.4;
    n.vy = 1.6 + Math.random() * 0.6;
    n.t = 0;
    n.dur = cls === 'big' ? 1.4 : 0.8;
  }

  // ------------------------------------------------------------------ markers

  initMarkers(echoes, skyport) {
    this.el.markers.innerHTML = '';
    this.markers = echoes.items.map((e) => this._marker('', e.base.clone().setY(e.base.y + 1.6), () => !e.collected));
    this.skyMarker = this._marker('skyport', skyport.center.clone().setY(skyport.center.y + 2), () => this.game.director.phase === 'collapse' || this.game.director.phase === 'uplink', 'SKYPORT');
    this.markers.push(this.skyMarker);
  }

  _marker(cls, pos, visible, label = '') {
    const el = document.createElement('div');
    el.className = `marker ${cls}`;
    el.innerHTML = `<div class="mk-icon"></div><div class="mk-label">${label}</div><div class="mk-dist"></div>`;
    this.el.markers.appendChild(el);
    return { el, pos, visible, dist: el.querySelector('.mk-dist'), label: el.querySelector('.mk-label'), lastD: -1 };
  }

  updateMarkers(camera, player, w, h) {
    for (const m of this.markers) {
      const vis = this.game.state !== 'menu' && m.visible();
      if (!vis) {
        if (m.el.style.display !== 'none') m.el.style.display = 'none';
        continue;
      }
      m.el.style.display = '';
      _v.copy(m.pos).project(camera);
      let x = _v.x, y = _v.y;
      const behind = _v.z > 1;
      if (behind) {
        x = -x;
        y = -y;
      }
      const margin = 0.9;
      let edge = false;
      if (behind || Math.abs(x) > margin || Math.abs(y) > margin) {
        const s = margin / Math.max(Math.abs(x), Math.abs(y), 1e-3);
        x *= s;
        y *= s;
        if (behind) y = -margin;
        edge = true;
      }
      const sx = ((x + 1) / 2) * w;
      const sy = ((1 - y) / 2) * h;
      m.el.style.transform = `translate(${sx - 20}px, ${sy - 10}px)`;
      m.el.classList.toggle('edge', edge);
      const d = Math.round(m.pos.distanceTo(player.pos));
      if (d !== m.lastD) {
        m.lastD = d;
        m.dist.textContent = `${d}m`;
      }
    }
  }

  // ------------------------------------------------------------------ per-frame HUD

  set(key, el, prop, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else el.style.setProperty(prop, value);
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const s = p.stats;
    const d = g.director;
    const el = this.el;

    // bars
    const hp = p.hp / s.maxHp;
    this.set('hp', el.hpFill, 'transform', `scaleX(${hp.toFixed(3)})`);
    this.set('hpg', el.hpGhost, 'transform', `scaleX(${hp.toFixed(3)})`);
    this.set('hpv', el.hpVal, 'text', String(Math.ceil(p.hp)));
    const low = hp < 0.3;
    if (this.cache.low !== low) {
      this.cache.low = low;
      el.hpBar.classList.toggle('low', low);
    }
    this.set('en', el.enFill, 'transform', `scaleX(${(p.energy / s.maxEnergy).toFixed(3)})`);
    this.set('env', el.enVal, 'text', String(Math.floor(p.energy)));

    // abilities
    const dashCd = p.dashCharges >= s.dashCharges ? 0 : 1 - p.dashRecharge / s.dashCd;
    this.set('dcd', el.abDash, '--cd', (p.dashCharges > 0 ? 0 : dashCd).toFixed(3));
    const pips = `${'<i></i>'.repeat(p.dashCharges)}${'<i class="off"></i>'.repeat(Math.max(0, s.dashCharges - p.dashCharges))}`;
    this.set('pips', el.dashPips, 'html', s.dashCharges > 1 ? pips : '');
    this.set('bcd', el.abBlade, '--cd', Math.max(0, p.bladeCd / 0.42).toFixed(3));
    const over = p.overclockT > 0;
    this.set('ocd', el.abOver, '--cd', over ? '0' : (1 - p.sync / 100).toFixed(3));
    const ready = p.sync >= 100 && !over;
    if (this.cache.ready !== ready) {
      this.cache.ready = ready;
      el.abOver.classList.toggle('ready', ready);
    }
    if (this.cache.over !== over) {
      this.cache.over = over;
      el.abOver.classList.toggle('active', over);
    }

    // objective / stats
    const obj = d.objective;
    this.set('objt', el.objText, 'text', obj.text);
    this.set('objs', el.objSub, 'text', obj.sub);
    const alert = !!obj.alert;
    if (this.cache.alert !== alert) {
      this.cache.alert = alert;
      el.objective.classList.toggle('alert', alert);
    }
    const dg = d.danger;
    if (this.cache.dg !== dg) {
      this.cache.dg = dg;
      [...el.danger.children].forEach((c, i) => c.classList.toggle('on', i < dg));
      el.danger.classList.toggle('max', dg >= 5);
    }
    this.set('core', el.core, 'text', `${d.core.toFixed(1)}%`);
    this.set('score', el.score, 'text', String(Math.floor(g.score)).padStart(6, '0'));

    const collapse = d.phase === 'collapse' || d.phase === 'uplink';
    if (this.cache.collapse !== collapse) {
      this.cache.collapse = collapse;
      el.timerWrap.classList.toggle('hidden', !collapse);
    }
    if (collapse) {
      this.set('timer', el.timer, 'text', d.timerText);
      const crit = d.timeLeft < 20;
      if (this.cache.crit !== crit) {
        this.cache.crit = crit;
        el.timer.classList.toggle('crit', crit);
      }
    }

    const up = d.phase === 'uplink';
    if (this.cache.up !== up) {
      this.cache.up = up;
      el.uplink.classList.toggle('hidden', !up);
    }
    if (up) {
      this.set('ulr', el.ulRing, 'stroke-dashoffset', String((326.7 * (1 - d.uplink)).toFixed(1)));
      this.set('ulp', el.ulPct, 'text', String(Math.floor(d.uplink * 100)));
      if (this.cache.inz !== d.inZone) {
        this.cache.inz = d.inZone;
        el.uplink.classList.toggle('paused', !d.inZone);
      }
    }

    // crosshair
    this.spread = Math.max(0, this.spread - dt * 60);
    const moveSpread = Math.min(8, Math.hypot(p.vel.x, p.vel.z) * 0.5);
    this.set('spread', el.crosshair, '--spread', `${(8 + this.spread + moveSpread).toFixed(1)}px`);
    const lock = !!g.aimCache?.target;
    if (this.cache.lock !== lock) {
      this.cache.lock = lock;
      el.crosshair.classList.toggle('lock', lock);
    }

    // log fade
    for (const l of this.logLines) {
      l.t += dt;
      if (l.t > 7 && !l.faded) {
        l.faded = true;
        l.line.classList.add('fade');
      }
    }
    // prompt
    if (this.promptT > 0) {
      this.promptT -= dt;
      if (this.promptT <= 0) el.prompt.classList.remove('show');
    }
  }

  /** Runs even while paused so numbers/markers stay glued to the world. */
  updateWorld(dt, camera, w, h) {
    for (const n of this.nums) {
      if (!n.active) continue;
      n.t += dt;
      n.pos.y += n.vy * dt;
      n.vy *= Math.exp(-3 * dt);
      _v.copy(n.pos).project(camera);
      if (_v.z > 1 || n.t > n.dur) {
        n.active = false;
        n.el.style.display = 'none';
        continue;
      }
      const sx = ((_v.x + 1) / 2) * w;
      const sy = ((1 - _v.y) / 2) * h;
      const k = n.t / n.dur;
      const sc = k < 0.12 ? 1.5 - k * 4 : 1;
      n.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(${sc.toFixed(2)})`;
      n.el.style.opacity = String(k > 0.6 ? (1 - k) / 0.4 : 1);
    }
    this.updateMarkers(camera, this.game.player, w, h);
  }

  setEchoPips(total, required, collected) {
    this.el.echoRow.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const pip = document.createElement('div');
      pip.className = `echo-pip${i < required ? ' req' : ''}${i < collected ? ' on' : ''}`;
      this.el.echoRow.appendChild(pip);
    }
  }

  flashObjective() {
    const o = this.el.objective;
    o.classList.remove('flash');
    void o.offsetWidth;
    o.classList.add('flash');
  }

  // ------------------------------------------------------------------ augments

  showAugments(options, echoIndex, onPick) {
    this.show('augment');
    this.el.augKicker.textContent = `ECHO ${String(echoIndex).padStart(2, '0')} INTEGRATED`;
    const wrap = this.el.augCards;
    wrap.innerHTML = '';
    this.aug = { options, sel: 1, onPick, acc: 0, cards: [] };
    options.forEach((a, i) => {
      const c = document.createElement('div');
      c.className = 'aug-card';
      c.style.setProperty('--ac', a.color);
      const lvl = (this.game.player.upgrades[a.id] || 0) + 1;
      c.innerHTML = `
        <div class="ac-num">[${i + 1}]</div>
        <div class="ac-glyph"><span>${a.glyph}</span></div>
        <div class="ac-name">${a.name}</div>
        <div class="ac-desc">${a.desc}</div>
        <div class="ac-tag">${a.max > 1 ? `RANK ${lvl} / ${a.max}` : 'UNIQUE'}</div>`;
      c.addEventListener('mouseenter', () => this._augSelect(i));
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        this._augPick(i);
      });
      wrap.appendChild(c);
      this.aug.cards.push(c);
    });
    this._augSelect(1);
  }

  _augSelect(i) {
    if (!this.aug) return;
    if (i !== this.aug.sel) this.game.audio.uiHover();
    this.aug.sel = Math.max(0, Math.min(this.aug.options.length - 1, i));
    this.aug.cards.forEach((c, k) => c.classList.toggle('sel', k === this.aug.sel));
  }

  _augPick(i) {
    if (!this.aug) return;
    const { options, onPick } = this.aug;
    this.aug = null;
    this.game.audio.uiClick();
    this.show(null);
    onPick(options[i]);
  }

  /** Called from the game loop with pointer-locked mouse deltas while the augment screen is up. */
  augmentInput(input, dx) {
    if (!this.aug) return;
    this.aug.acc += dx;
    if (this.aug.acc > 110) {
      this.aug.acc = 0;
      this._augSelect(this.aug.sel + 1);
    } else if (this.aug.acc < -110) {
      this.aug.acc = 0;
      this._augSelect(this.aug.sel - 1);
    }
    for (let k = 0; k < 3; k++) if (input.wasPressed(`Digit${k + 1}`, `Numpad${k + 1}`) && k < this.aug.options.length) return this._augPick(k);
    if (input.wasPressed('KeyA', 'ArrowLeft')) this._augSelect(this.aug.sel - 1);
    if (input.wasPressed('KeyD', 'ArrowRight')) this._augSelect(this.aug.sel + 1);
    if ((input.locked && input.mouse.leftPressed) || input.wasPressed('Enter', 'Space')) this._augPick(this.aug.sel);
  }

  // ------------------------------------------------------------------ end screens

  showEnd(kind, stats) {
    const box = kind === 'victory' ? $('vic-stats') : $('go-stats');
    box.innerHTML = stats.rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('') +
      `<div class="total"><span>SCORE</span><span>${stats.score.toLocaleString('en-US')}</span></div>`;
    if (kind === 'victory') $('vic-rank').textContent = stats.rank;
    else $('go-reason').textContent = stats.reason;
    this.show(kind);
  }

  setBest(score) {
    $('best-score').textContent = score > 0 ? `BEST ${score.toLocaleString('en-US')}` : 'NO RECORD';
  }

  setKeyLabels(input) {
    document.querySelectorAll('kbd[data-code]').forEach((k) => (k.textContent = input.label(k.dataset.code)));
    document.querySelectorAll('[data-keylabel]').forEach((k) => (k.textContent = input.label(k.dataset.keylabel)));
  }
}
