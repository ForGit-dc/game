import { pick } from '../utils/math.js';

/** Augments offered after each Echo. Each run the courier becomes a different weapon. */
export const AUGMENTS = [
  { id: 'speed', name: 'KINETIC FRAME', glyph: '»', color: '#22e6ff', desc: '+12% movement and sprint speed.', max: 3,
    apply: (s) => { s.walk *= 1.12; s.sprint *= 1.12; } },
  { id: 'damage', name: 'OVERCHARGED COILS', glyph: 'Ψ', color: '#ffd36b', desc: '+30% pulse damage.', max: 4,
    apply: (s) => { s.damage *= 1.3; } },
  { id: 'rate', name: 'RAPID CYCLER', glyph: '≡', color: '#7ff6ff', desc: '+25% fire rate, -10% shot cost.', max: 3,
    apply: (s) => { s.fireRate *= 1.25; s.shotCost *= 0.9; } },
  { id: 'split', name: 'FRACTAL EMITTER', glyph: '⋔', color: '#8b5cff', desc: 'Every pulse splits into +2 side bolts.', max: 2,
    apply: (s) => { s.split += 1; } },
  { id: 'dash', name: 'PHASE DRIVE', glyph: '↯', color: '#22e6ff', desc: '-30% dash cooldown.', max: 3,
    apply: (s) => { s.dashCd *= 0.7; } },
  { id: 'charges', name: 'VECTOR THRUSTERS', glyph: '⇉', color: '#4d9dff', desc: '+1 dash charge.', max: 2,
    apply: (s) => { s.dashCharges += 1; } },
  { id: 'phase', name: 'PHASE STRIKE', glyph: '✦', color: '#ff2bd6', desc: 'Dashing through drones shreds them (35 dmg).', max: 1,
    apply: (s) => { s.phaseStrike = true; } },
  { id: 'blade', name: 'MONOMOLECULAR EDGE', glyph: '/', color: '#ff5ae0', desc: '+50% blade damage, +25% reach.', max: 3,
    apply: (s) => { s.bladeDamage *= 1.5; s.bladeRange *= 1.25; } },
  { id: 'energy', name: 'DEEP CAPACITOR', glyph: 'Ξ', color: '#8b5cff', desc: '+35 max energy, +30% regen.', max: 3,
    apply: (s, p) => { s.maxEnergy += 35; s.energyRegen *= 1.3; p.energy = s.maxEnergy; } },
  { id: 'hp', name: 'NANO MESH', glyph: '+', color: '#20ffd0', desc: '+30 max integrity and full repair.', max: 3,
    apply: (s, p) => { s.maxHp += 30; p.hp = s.maxHp; } },
  { id: 'leech', name: 'SIPHON PROTOCOL', glyph: '◈', color: '#ff2a55', desc: 'Kills restore 6 integrity.', max: 2,
    apply: (s) => { s.leech += 6; } },
  { id: 'chrono', name: 'CHRONO SINK', glyph: '◷', color: '#ffd36b', desc: 'Overclock charges 50% faster, lasts +2s.', max: 2,
    apply: (s) => { s.syncGain *= 1.5; s.overclockTime += 2; } },
];

export function rollAugments(player, n = 3) {
  const owned = player.upgrades;
  const pool = AUGMENTS.filter((a) => (owned[a.id] || 0) < a.max);
  const out = [];
  while (out.length < n && pool.length) {
    const a = pick(pool);
    pool.splice(pool.indexOf(a), 1);
    out.push(a);
  }
  return out;
}

export function applyAugment(player, aug) {
  aug.apply(player.stats, player);
  player.upgrades[aug.id] = (player.upgrades[aug.id] || 0) + 1;
  if (aug.id === 'charges') player.dashCharges = player.stats.dashCharges;
}
