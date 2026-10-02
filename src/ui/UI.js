import * as THREE from 'three';
import { LATTICE } from '../systems/Meta.js';
import { STAGES } from '../systems/Waves.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** DOM layer: HUD, floating numbers, reticle, level-up cards, lattice, pause and end screens. */
export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), xpFill: $('xp-fill'), xpLvl: $('xp-lvl'), timer: $('timer'), nextEv: $('next-ev'),
      bossbar: $('bossbar'), bbName: $('bb-name'), bbFill: $('bb-fill'), bbGhost: $('bb-ghost'), bbTitle: $('bb-title'),
      warning: $('warning'), hpFill: $('hp-fill'), hpGhost: $('hp-ghost'), hpVal: $('hp-val'), hpBar: document.querySelector('.bar.hp'),
      syncFill: $('sync-fill'), syncVal: $('sync-val'), wSlots: $('w-slots'), pSlots: $('p-slots'),
      kills: $('kills'), score: $('score'), shards: $('shards'), combo: $('combo'), comboN: $('combo-n'),
      log: $('log'), abDash: $('ab-dash'), abBlade: $('ab-blade'), abOver: $('ab-over'), dashPips: $('dash-pips'),
      reticle: $('reticle'), dmgDir: $('dmg-dir'), banner: $('banner'), bannerKicker: $('banner-kicker'), bannerMain: $('banner-main'), bannerSub: $('banner-sub'),
      prompt: $('prompt'), dmgnums: $('dmgnums'), fade: $('fade'),
      menu: $('menu'), cards: $('cards'), pause: $('pause'), gameover: $('gameover'), victory: $('victory'),
      cardsList: $('cards-list'), cardsTitle: $('cards-title'), cardsKicker: $('cards-kicker'), rerollN: $('reroll-n'), rerollBtn: $('reroll-btn'),
    };
    this.cache = {};
    this.logLines = [];
    this.nums = [];
    this.promptT = 0;
    this.warnT = 0;
    this.cardState = null;
    this._bind();
  }

  _bind() {
    const g = this.game;
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      e.stopPropagation();
      g.audio.uiClick();
      g.onMenuAction(b.dataset.action, b);
    });
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest?.('[data-action], .aug-card')) g.audio.uiHover();
    });
    $('set-vol').addEventListener('input', (e) => g.audio.setVolume(parseFloat(e.target.value)));
    $('set-amb').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      g.audio.setAmbience(v);
      try {
        localStorage.setItem('neon-echo-amb', String(v));
      } catch {
        /* ignore */
      }
    });
    $('set-autoblade').addEventListener('change', (e) => g.toggleAutoBlade(e.target.checked));
    $('set-auto').addEventListener('change', (e) => {
      g.settings.autoFire = e.target.checked;
      try {
        localStorage.setItem('neon-echo-autofire', g.settings.autoFire ? '1' : '0');
      } catch {
        /* ignore */
      }
    });
  }

  // ------------------------------------------------------------------ screens

  show(name) {
    for (const s of ['menu', 'cards', 'pause', 'gameover', 'victory']) this.el[s].classList.toggle('hidden', s !== name);
  }

  hideAll() {
    this.show(null);
  }

  setHud(v) {
    this.el.hud.classList.toggle('hidden', !v);
  }

  panel(name) {
    for (const p of ['controls', 'credits', 'author', 'lattice']) $(`panel-${p}`).classList.toggle('hidden', p !== name);
    this.el.menu.classList.toggle('wide-open', name === 'lattice');
    if (name === 'lattice') this.renderLattice();
  }

  refreshMenu() {
    const g = this.game;
    const m = g.meta;
    $('menu-shards').textContent = `◆ ${m.shards}`;
    const s = m.stats;
    $('menu-foot').textContent = s.runs
      ? `RUNS ${s.runs} · BEST ${fmt(s.bestTime)} · ${s.bestScore.toLocaleString('en-US')} PTS · ${s.victories} VICTORIES`
      : 'NO RECORD — THE RING AWAITS';
    const od = m.level('overdrive') > 0;
    $('diff-btn').classList.toggle('hidden', !od);
    $('diff-label').textContent = g.difficulty === 'overdrive' ? 'OVERDRIVE' : 'NORMAL';
    $('diff-btn').classList.toggle('on', g.difficulty === 'overdrive');
    if (!$('panel-lattice').classList.contains('hidden')) this.renderLattice();
  }

  renderLattice() {
    const m = this.game.meta;
    $('lat-shards').textContent = `◆ ${m.shards}`;
    $('lattice').innerHTML = LATTICE.map((n) => {
      const lvl = m.level(n.id);
      const cost = m.costOf(n.id);
      const maxed = cost === null;
      const afford = !maxed && m.shards >= cost;
      const pips = Array.from({ length: n.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `<button class="node ${maxed ? 'maxed' : afford ? 'afford' : 'poor'}" data-action="buy" data-id="${n.id}" ${maxed ? 'disabled' : ''}>
        <span class="n-glyph">${n.glyph}</span>
        <span class="n-body"><b>${n.name}</b><small>${n.desc}</small><span class="n-pips">${pips}</span></span>
        <span class="n-cost">${maxed ? 'MAX' : `◆ ${cost}`}</span>
      </button>`;
    }).join('');
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
    line.textContent = text;
    this.el.log.appendChild(line);
    this.logLines.push({ line, t: 0 });
    while (this.logLines.length > 5) this.logLines.shift().line.remove();
  }

  banner(kicker, main, sub = '', cls = '') {
    const b = this.el.banner;
    b.className = '';
    void b.offsetWidth;
    b.className = `show ${cls}`;
    this.el.bannerKicker.textContent = kicker;
    this.el.bannerMain.textContent = main;
    this.el.bannerMain.dataset.text = main;
    this.el.bannerSub.textContent = sub;
  }

  warning(text, cls = 'warn') {
    const w = this.el.warning;
    w.textContent = text;
    w.className = `warning show ${cls}`;
    this.warnT = 3;
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

  combo(n) {
    const c = this.el.combo;
    if (n < 10) return;
    this.el.comboN.textContent = `×${n}`;
    c.classList.remove('bump');
    void c.offsetWidth;
    c.classList.add('bump', 'show');
    c.style.setProperty('--heat', String(Math.min(1, n / 200)));
  }

  damageDirection(fx, fz) {
    const p = this.game.player.pos;
    // screen-up = world -Z with the fixed camera
    const ang = Math.atan2(fx - p.x, -(fz - p.z));
    const d = document.createElement('div');
    d.className = 'dd';
    d.style.transform = `rotate(${ang}rad)`;
    this.el.dmgDir.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  resetRunHud() {
    this.cache = {};
    this.el.log.innerHTML = '';
    this.logLines = [];
    this.el.combo.classList.remove('show');
    this.bossBar(null);
    this.refreshSlots();
  }

  bossBar(boss) {
    this.boss = boss;
    this.el.bossbar.classList.toggle('hidden', !boss);
    if (boss) {
      this.el.bbName.textContent = boss.name;
      this.el.bbTitle.textContent = boss.title;
    }
  }

  refreshSlots() {
    const { weapons, passives } = this.game.progression.slots();
    const slot = (s) => `<div class="slot ${s.evolved ? 'evo' : ''}" style="--c:${s.color}" title="${s.name}"><span>${s.glyph}</span><em>${s.evolved ? '★' : ''}${s.level}</em></div>`;
    const empty = (n, max) => '<div class="slot empty"></div>'.repeat(Math.max(0, max - n));
    this.el.wSlots.innerHTML = weapons.map(slot).join('') + empty(weapons.length, 5);
    this.el.pSlots.innerHTML = passives.map(slot).join('') + empty(passives.length, 5);
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
    const el = this.el;
    const pr = g.progression;

    this.set('xp', el.xpFill, 'transform', `scaleX(${Math.min(1, pr.xp / pr.next).toFixed(3)})`);
    this.set('lvl', el.xpLvl, 'text', `LV ${pr.level}`);
    const t = g.waves.t;
    this.set('timer', el.timer, 'text', fmt(t));
    const w = g.waves;
    this.set('stage', $('stage-lbl'), 'text', w.endless ? `ENDLESS · LOOP ${w.loop}` : `STAGE ${w.stage + 1} / ${STAGES.length} · ${w.def.name}`);
    const nev = w.nextEvent;
    const late = !!(nev && nev.boss && nev.left < 30) || !!this.boss;
    if (this.cache.late !== late) {
      this.cache.late = late;
      el.timer.classList.toggle('late', late);
    }
    const ev = g.waves.nextEvent;
    let evText = '';
    if (ev && !this.boss) evText = ev.active ? `⚠ ${ev.label} · ${Math.ceil(ev.left)}s` : ev.left < 60 ? `${ev.boss ? '☠ ' : ''}${ev.label} IN ${Math.ceil(ev.left)}s` : '';
    if (g.waves.endless && !ev) evText = 'ENDLESS';
    this.set('ev', el.nextEv, 'text', evText);

    if (this.boss) {
      const f = Math.max(0, this.boss.hp / this.boss.maxHp);
      this.set('bb', el.bbFill, 'transform', `scaleX(${f.toFixed(4)})`);
      this.set('bbg', el.bbGhost, 'transform', `scaleX(${f.toFixed(4)})`);
    }

    const hp = p.hp / s.maxHp;
    this.set('hp', el.hpFill, 'transform', `scaleX(${hp.toFixed(3)})`);
    this.set('hpg', el.hpGhost, 'transform', `scaleX(${hp.toFixed(3)})`);
    this.set('hpv', el.hpVal, 'text', String(Math.ceil(p.hp)));
    const low = hp < 0.3;
    if (this.cache.low !== low) {
      this.cache.low = low;
      el.hpBar.classList.toggle('low', low);
    }
    this.set('sync', el.syncFill, 'transform', `scaleX(${(p.overclocked ? p.overT / s.overTime : p.sync / 100).toFixed(3)})`);
    this.set('syncv', el.syncVal, 'text', p.overclocked ? 'ON' : String(Math.floor(p.sync)));

    this.set('kills', el.kills, 'text', g.kills.toLocaleString('en-US'));
    this.set('score', el.score, 'text', Math.floor(g.score).toLocaleString('en-US'));
    this.set('shards', el.shards, 'text', `◆ ${Math.floor(g.runShards)}`);
    if (g.combo < 10 && el.combo.classList.contains('show')) el.combo.classList.remove('show');

    // abilities
    const dashCd = p.dashCharges > 0 ? 0 : 1 - p.dashRecharge / s.dashCd;
    this.set('dcd', el.abDash, '--cd', dashCd.toFixed(3));
    const pips = s.dashCharges > 1 ? `${'<i></i>'.repeat(p.dashCharges)}${'<i class="off"></i>'.repeat(Math.max(0, s.dashCharges - p.dashCharges))}` : '';
    this.set('pips', el.dashPips, 'html', pips);
    this.set('bcd', el.abBlade, '--cd', Math.max(0, p.bladeCd / (0.62 * s.cdMul)).toFixed(3));
    const over = p.overclocked;
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

    for (const l of this.logLines) {
      l.t += dt;
      if (l.t > 6 && !l.faded) {
        l.faded = true;
        l.line.classList.add('fade');
      }
    }
    if (this.promptT > 0) {
      this.promptT -= dt;
      if (this.promptT <= 0) el.prompt.classList.remove('show');
    }
    if (this.warnT > 0) {
      this.warnT -= dt;
      if (this.warnT <= 0) el.warning.classList.remove('show');
    }
  }

  /** Numbers & reticle follow the world even while paused. */
  updateWorld(dt, camera, w, h) {
    const g = this.game;
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
      n.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${sc.toFixed(2)})`;
      n.el.style.opacity = String(k > 0.6 ? (1 - k) / 0.4 : 1);
    }
    // reticle at the mouse
    const m = g.input.mouse;
    const r = this.el.reticle;
    const show = g.state === 'playing';
    if (this.cache.ret !== show) {
      this.cache.ret = show;
      r.style.display = show ? 'block' : 'none';
    }
    if (show) {
      r.style.transform = `translate(${m.x}px, ${m.y}px)`;
      r.classList.toggle('firing', g.player.firing);
    }
  }

  number(pos, text, cls = '') {
    let n = this.nums.find((x) => !x.active);
    if (!n) {
      if (this.nums.length > 50) return;
      const el = document.createElement('div');
      this.el.dmgnums.appendChild(el);
      n = { el, active: false, pos: new THREE.Vector3() };
      this.nums.push(n);
    }
    n.active = true;
    n.el.className = `dmgnum ${cls}`;
    n.el.textContent = text;
    n.el.style.display = 'block';
    n.pos.copy(pos);
    n.pos.x += (Math.random() - 0.5) * 0.6;
    n.vy = 1.8 + Math.random() * 0.6;
    n.t = 0;
    n.dur = cls === 'big' ? 1.3 : 0.75;
  }

  // ------------------------------------------------------------------ level-up cards

  showCards(cards, { title, kicker, rerolls, onPick }) {
    this.show('cards');
    this.cardTitle = title;
    this.cardKicker = kicker;
    this.el.cardsTitle.textContent = title;
    this.el.cardsKicker.textContent = kicker;
    this.el.rerollN.textContent = String(rerolls);
    this.el.rerollBtn.classList.toggle('hidden', rerolls <= 0);
    const wrap = this.el.cardsList;
    wrap.innerHTML = '';
    this.cardState = { cards, onPick, sel: 0, els: [], armed: false };
    cards.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = `aug-card ${c.kind === 'evo' ? 'evo' : ''} ${c.isNew ? 'new' : ''}`;
      d.style.setProperty('--ac', c.color);
      d.innerHTML = `
        <div class="ac-num">[${i + 1}]</div>
        <div class="ac-tag2">${c.tag || ''}</div>
        <div class="ac-glyph"><span>${c.glyph}</span></div>
        <div class="ac-name">${c.title}</div>
        <div class="ac-desc">${c.desc}</div>
        ${c.hint ? `<div class="ac-hint">${c.hint}</div>` : ''}`;
      d.addEventListener('mouseenter', () => this._select(i));
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        this._pick(i);
      });
      wrap.appendChild(d);
      this.cardState.els.push(d);
    });
    this._select(0);
    // ignore the click that may still be held from shooting
    setTimeout(() => this.cardState && (this.cardState.armed = true), 350);
  }

  _select(i) {
    const st = this.cardState;
    if (!st) return;
    st.sel = Math.max(0, Math.min(st.cards.length - 1, i));
    st.els.forEach((e, k) => e.classList.toggle('sel', k === st.sel));
  }

  _pick(i) {
    const st = this.cardState;
    if (!st || !st.armed) return;
    this.cardState = null;
    this.game.audio.uiClick();
    this.show(null);
    st.onPick(st.cards[i]);
  }

  cardsInput(input) {
    const st = this.cardState;
    if (!st) return;
    for (let k = 0; k < st.cards.length; k++) if (input.wasPressed(`Digit${k + 1}`, `Numpad${k + 1}`)) return this._pick(k);
    if (input.wasPressed('KeyA', 'ArrowLeft')) this._select(st.sel - 1);
    if (input.wasPressed('KeyD', 'ArrowRight')) this._select(st.sel + 1);
    if (input.wasPressed('Enter')) this._pick(st.sel);
  }

  // ------------------------------------------------------------------ pause & end

  showPause() {
    this.show('pause');
    this.syncSettings();
    $('pause-build').innerHTML = this.buildHtml(this.game.progression.slots());
  }

  syncSettings() {
    $('set-auto').checked = this.game.settings.autoFire;
    $('set-autoblade').checked = this.game.settings.autoBlade;
    this.el.abBlade.classList.toggle('auto', this.game.settings.autoBlade);
    if (this.game.audio.ambience !== undefined) $('set-amb').value = String(this.game.audio.ambience);
  }

  buildHtml({ weapons, passives }) {
    const row = (s) => `<div class="b-item" style="--c:${s.color}"><span>${s.glyph}</span><b>${s.name}</b><em>${s.evolved ? `EVOLVED · LV ${s.level}` : `LV ${s.level}`}</em></div>`;
    return `<div class="b-col">${weapons.map(row).join('')}</div><div class="b-col">${passives.map(row).join('') || '<div class="b-none">no passives</div>'}</div>`;
  }

  showEnd(kind, d) {
    const pre = kind === 'victory' ? 'vic' : 'go';
    $(`${pre}-stats`).innerHTML = d.rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('') +
      `<div class="total"><span>SCORE${d.newBest ? ' · NEW RECORD' : ''}</span><span>${d.score.toLocaleString('en-US')}</span></div>`;
    $(`${pre}-shards`).innerHTML = `<b>+◆ ${d.earned}</b> SHARDS EARNED <small>· ${d.total} IN THE LATTICE</small>`;
    // tell the player what to do next: spend shards if they can, otherwise go again
    const meta = this.game.meta;
    const affordable = LATTICE.filter((n) => {
      const c = meta.costOf(n.id);
      return c !== null && meta.shards >= c;
    }).length;
    const hint = $(`${pre}-hint`);
    hint.innerHTML = affordable > 0
      ? `NEXT STEP → open the <b>LATTICE</b>: you can buy <b>${affordable}</b> permanent upgrade${affordable > 1 ? 's' : ''} with your ◆ shards, then <b>REBOOT</b> stronger.`
      : kind === 'victory'
        ? 'NEXT STEP → <b>CONTINUE</b> into Endless, or start a new run.'
        : 'NEXT STEP → <b>REBOOT</b> and survive longer: every run earns ◆ shards for permanent upgrades. Beat each stage boss to reach the next stage — the Black Box waits at stage 3.';
    const box = $(kind === 'victory' ? 'victory' : 'gameover');
    box.querySelectorAll('.end-btns .sbtn').forEach((btn) => {
      const act = btn.dataset.action;
      btn.classList.toggle('primary', affordable > 0 ? act === 'to-lattice' : act === (kind === 'victory' ? 'continue' : 'restart'));
    });
    $(`${pre}-build`).innerHTML = this.buildHtml(d.build);
    $(`${pre}-reason`).textContent = d.reason;
    if (kind === 'victory') {
      $('vic-rank').textContent = d.rank;
      $('vic-continue').classList.toggle('hidden', !d.endless);
    }
    this.show(kind);
  }

  setKeyLabels(input) {
    document.querySelectorAll('kbd[data-code]').forEach((k) => (k.textContent = input.label(k.dataset.code)));
    document.querySelectorAll('[data-keylabel]').forEach((k) => (k.textContent = input.label(k.dataset.keylabel)));
  }
}
