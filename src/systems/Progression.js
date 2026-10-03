import { WEAPONS, PASSIVES, createWeapon } from '../combat/Weapons.js';

export const MAX_WEAPONS = 5;
export const MAX_PASSIVES = 5;
export const MAX_LEVEL = 8;
export const EVOLVE_AT = 5;

export const BASE_STATS = () => ({
  maxHp: 100,
  speedMul: 1,
  dmgMul: 1,
  cdMul: 1,
  rateMul: 1,
  areaMul: 1,
  crit: 0.05,
  magnet: 3.2,
  xpMul: 1,
  regen: 0,
  dashCharges: 1,
  dashCd: 1.15,
  overTime: 6,
  armorMul: 1,
  bladeMul: 1,
  bladeReach: 1,
  syncMul: 1,
});

export function xpToNext(level) {
  return Math.floor(6 + 5 * (level - 1) + Math.pow(level, 1.6));
}

/** Levels, weapons, passives, evolutions and the resulting stat block. */
export class Progression {
  constructor(game) {
    this.game = game;
    this.weapons = new Map();
    this.passives = new Map();
  }

  reset() {
    for (const w of this.weapons.values()) w.dispose();
    this.weapons.clear();
    this.passives.clear();
    this.level = 1;
    this.xp = 0;
    this.next = xpToNext(1);
    this.pending = 0;
    this.rerolls = this.game.meta.level('reroll');
    this.addWeapon('pulse');
    this.recompute();
  }

  addWeapon(id) {
    if (this.weapons.has(id)) return;
    this.weapons.set(id, createWeapon(this.game, id));
  }

  addXp(n) {
    this.xp += n * this.stats.xpMul;
    while (this.xp >= this.next) {
      this.xp -= this.next;
      this.level++;
      this.next = xpToNext(this.level);
      this.pending++;
    }
  }

  /** Stats = base + meta lattice + passives. Preserves current HP ratio. */
  recompute() {
    const p = this.game.player;
    const meta = this.game.meta;
    const old = this.stats;
    const s = BASE_STATS();
    s.maxHp += meta.level('hp') * 10;
    s.dmgMul *= 1 + meta.level('dmg') * 0.06;
    s.speedMul *= 1 + meta.level('speed') * 0.04;
    s.xpMul *= 1 + meta.level('xp') * 0.08;
    s.magnet *= 1 + meta.level('magnet') * 0.2;
    s.regen += meta.level('regen') * 0.3;
    s.dashCharges += meta.level('dash');
    s.crit += meta.level('crit') * 0.03;
    s.armorMul *= Math.pow(0.96, meta.level('armor'));
    s.bladeMul *= 1 + meta.level('blade') * 0.12;
    s.bladeReach *= 1 + meta.level('blade') * 0.05;
    s.syncMul *= 1 + meta.level('sync') * 0.15;
    const P = (id) => this.passives.get(id) || 0;
    s.dmgMul *= 1 + P('coils') * 0.12;
    s.cdMul *= Math.pow(0.92, P('cycler'));
    s.rateMul *= 1 + P('cycler') * 0.08;
    s.speedMul *= 1 + P('frame') * 0.08;
    s.magnet *= 1 + P('magnet') * 0.35;
    s.maxHp += P('nano') * 20;
    s.regen += P('nano') * 0.5;
    s.areaMul *= 1 + P('capacitor') * 0.12;
    s.crit += P('targeting') * 0.07;
    s.dashCd *= Math.pow(0.9, P('phase'));
    s.dashCharges += (P('phase') >= 1 ? 1 : 0) + (P('phase') >= 3 ? 1 : 0) + (P('phase') >= 5 ? 1 : 0);
    s.xpMul *= 1 + P('echo') * 0.12;
    s.overTime += P('echo');
    s.armorMul *= Math.pow(0.94, P('reg'));
    this.stats = s;
    if (p) {
      p.stats = s;
      if (old) p.hp = Math.min(s.maxHp, p.hp + Math.max(0, s.maxHp - old.maxHp));
      p.dashCharges = Math.min(s.dashCharges, p.dashCharges + Math.max(0, s.dashCharges - (old ? old.dashCharges : s.dashCharges)));
    }
  }

  evolutionsReady() {
    const out = [];
    for (const w of this.weapons.values()) {
      if (w.evolved || w.level < EVOLVE_AT) continue;
      if (this.passives.has(w.def.evo.with)) out.push(w);
    }
    return out;
  }

  unlocked(def) {
    return !def.locked || this.game.meta.level(def.locked) > 0;
  }

  /** Build `count` level-up cards. */
  roll(count = 3, { chest = false } = {}) {
    const cards = [];
    const evo = this.evolutionsReady();
    for (const w of evo) {
      cards.push({
        kind: 'evo', id: w.id, weight: 100, rarity: 'evo',
        title: w.def.evo.name, glyph: w.def.glyph, color: '#ffd36b',
        desc: w.def.evo.desc, tag: 'EVOLUTION',
      });
    }
    const pool = [];
    for (const w of this.weapons.values()) {
      if (w.level < MAX_LEVEL) {
        const over = w.level >= EVOLVE_AT;
        pool.push({
          kind: 'weapon', id: w.id, weight: over ? 2.4 : 3,
          title: w.evolved ? w.def.evo.name : w.def.name, glyph: w.def.glyph, color: w.evolved ? '#ffd36b' : w.def.color,
          desc: over ? '+20% damage, -7% cooldown.' : w.def.desc[w.level],
          tag: `LV ${w.level + 1}`, level: w.level + 1,
          hint: over && !w.evolved ? `Evolves with ${PASSIVES[w.def.evo.with].name}` : null,
        });
      }
    }
    if (this.weapons.size < MAX_WEAPONS) {
      for (const def of Object.values(WEAPONS)) {
        if (this.weapons.has(def.id) || !this.unlocked(def)) continue;
        pool.push({ kind: 'weapon', id: def.id, weight: 2.2, title: def.name, glyph: def.glyph, color: def.color, desc: def.desc[0], tag: 'NEW WEAPON', isNew: true, hint: `Evolves with ${PASSIVES[def.evo.with].name}` });
      }
    }
    for (const [id, lvl] of this.passives) {
      if (lvl < MAX_LEVEL) {
        const def = PASSIVES[id];
        pool.push({ kind: 'passive', id, weight: 2.5, title: def.name, glyph: def.glyph, color: def.color, desc: def.descFor ? def.descFor(lvl + 1) : def.desc, tag: `LV ${lvl + 1}`, level: lvl + 1 });
      }
    }
    if (this.passives.size < MAX_PASSIVES) {
      for (const def of Object.values(PASSIVES)) {
        if (this.passives.has(def.id)) continue;
        const evoFor = Object.values(WEAPONS).find((w) => w.evo.with === def.id && this.weapons.has(w.id));
        pool.push({ kind: 'passive', id: def.id, weight: evoFor ? 2.4 : 1.6, title: def.name, glyph: def.glyph, color: def.color, desc: def.descFor ? def.descFor(1) : def.desc, tag: 'NEW PASSIVE', isNew: true, hint: evoFor ? `Evolves ${evoFor.name}` : null });
      }
    }
    // chests favour upgrades of what you own
    if (chest) for (const c of pool) if (!c.isNew) c.weight *= 2;
    while (cards.length < count && pool.length) {
      const total = pool.reduce((a, c) => a + c.weight, 0);
      let r = Math.random() * total;
      let pick = pool[0];
      for (const c of pool) {
        r -= c.weight;
        if (r <= 0) { pick = c; break; }
      }
      pool.splice(pool.indexOf(pick), 1);
      cards.push(pick);
    }
    if (cards.length < count) cards.push({ kind: 'heal', id: 'heal', title: 'FIELD REPAIR', glyph: '+', color: '#20ffa0', desc: 'Restore 40 integrity.', tag: 'SUPPORT' });
    if (cards.length < count) cards.push({ kind: 'score', id: 'score', title: 'DATA CACHE', glyph: '◆', color: '#a6fffb', desc: '+750 score and 5 shards.', tag: 'SUPPORT' });
    return cards.slice(0, Math.max(count, Math.min(evo.length, count)));
  }

  apply(card) {
    const g = this.game;
    if (card.kind === 'evo') {
      this.weapons.get(card.id).evolve();
      g.onEvolution(card);
    } else if (card.kind === 'weapon') {
      if (this.weapons.has(card.id)) this.weapons.get(card.id).levelUp();
      else this.addWeapon(card.id);
    } else if (card.kind === 'passive') {
      this.passives.set(card.id, (this.passives.get(card.id) || 0) + 1);
    } else if (card.kind === 'heal') {
      g.player.heal(40);
    } else if (card.kind === 'score') {
      g.score += 750;
      g.runShards += 5;
    }
    this.recompute();
  }

  update(dt, firing) {
    for (const w of this.weapons.values()) w.update(dt, firing);
  }

  /** For the HUD. */
  slots() {
    const weapons = [...this.weapons.values()].map((w) => ({ id: w.id, glyph: w.def.glyph, color: w.evolved ? '#ffd36b' : w.def.color, level: w.level, evolved: w.evolved, name: w.evolved ? w.def.evo.name : w.def.name }));
    const passives = [...this.passives.entries()].map(([id, lvl]) => ({ id, glyph: PASSIVES[id].glyph, color: PASSIVES[id].color, level: lvl, name: PASSIVES[id].name }));
    return { weapons, passives };
  }
}
