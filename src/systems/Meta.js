const KEY = 'neon-echo-meta-v1';

/** The Neural Lattice: permanent upgrades bought with shards earned across runs. */
export const LATTICE = [
  { id: 'hp', name: 'REINFORCED FRAME', glyph: '+', desc: '+10 max integrity', max: 5, cost: [30, 60, 110, 180, 280] },
  { id: 'dmg', name: 'AMPLIFIER', glyph: 'Ψ', desc: '+6% damage', max: 5, cost: [40, 80, 140, 220, 320] },
  { id: 'speed', name: 'SERVOS', glyph: '»', desc: '+4% move speed', max: 3, cost: [40, 90, 160] },
  { id: 'xp', name: 'DATA SIPHON', glyph: '◇', desc: '+8% XP gain', max: 5, cost: [35, 70, 120, 190, 280] },
  { id: 'magnet', name: 'FIELD EMITTER', glyph: '∪', desc: '+20% pickup radius', max: 3, cost: [25, 60, 110] },
  { id: 'regen', name: 'SELF-REPAIR', glyph: '♥', desc: '+0.3 integrity per second', max: 3, cost: [60, 130, 220] },
  { id: 'reroll', name: 'PROBABILITY ENGINE', glyph: '↻', desc: '+1 card reroll per run', max: 3, cost: [80, 180, 320] },
  { id: 'dash', name: 'VECTOR CORE', glyph: '↯', desc: '+1 dash charge', max: 1, cost: [260] },
  { id: 'seeker', name: 'UNLOCK · SEEKER SWARM', glyph: '➶', desc: 'Homing missiles join the weapon pool', max: 1, cost: [120] },
  { id: 'drone', name: 'UNLOCK · LASER DRONE', glyph: '⊹', desc: 'A laser companion joins the weapon pool', max: 1, cost: [200] },
  { id: 'revive', name: 'SECOND SIGNAL', glyph: '✦', desc: 'Revive once per run at half integrity', max: 1, cost: [400] },
  { id: 'choice', name: 'WIDER SIGHT', glyph: '◎', desc: '4 choices on every level-up', max: 1, cost: [500] },
  { id: 'overdrive', name: 'OVERDRIVE PROTOCOL', glyph: '☢', desc: 'Unlocks Overdrive: tougher hordes, +60% shards', max: 1, cost: [700] },
];

export class Meta {
  constructor() {
    this.data = { shards: 0, levels: {}, stats: { runs: 0, bestTime: 0, bestKills: 0, bestScore: 0, victories: 0, bossKills: 0 } };
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.data = { ...this.data, ...d, levels: { ...(d.levels || {}) }, stats: { ...this.data.stats, ...(d.stats || {}) } };
      }
    } catch {
      /* private mode / blocked storage: run without persistence */
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  get shards() {
    return this.data.shards;
  }

  level(id) {
    return this.data.levels[id] || 0;
  }

  costOf(id) {
    const node = LATTICE.find((n) => n.id === id);
    const lvl = this.level(id);
    return lvl >= node.max ? null : node.cost[lvl];
  }

  buy(id) {
    const cost = this.costOf(id);
    if (cost === null || this.data.shards < cost) return false;
    this.data.shards -= cost;
    this.data.levels[id] = this.level(id) + 1;
    this.save();
    return true;
  }

  addShards(n) {
    this.data.shards += Math.floor(n);
    this.save();
  }

  recordRun({ time, kills, score, victory, bosses }) {
    const s = this.data.stats;
    s.runs++;
    s.bestTime = Math.max(s.bestTime, time);
    s.bestKills = Math.max(s.bestKills, kills);
    const newBest = score > s.bestScore;
    s.bestScore = Math.max(s.bestScore, score);
    if (victory) s.victories++;
    s.bossKills += bosses;
    this.save();
    return newBest;
  }

  get stats() {
    return this.data.stats;
  }
}
