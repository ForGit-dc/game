const KEY = 'neon-echo-meta-v1';

/** Escalating costs, rounded to 5. */
const costs = (base, n, growth) => Array.from({ length: n }, (_, i) => Math.round((base * Math.pow(growth, i)) / 5) * 5);

/** The Neural Lattice: permanent upgrades bought with shards earned across runs. */
export const LATTICE = [
  { id: 'hp', name: 'REINFORCED FRAME', glyph: '+', desc: '+10 max integrity', max: 10, cost: costs(30, 10, 1.42) },
  { id: 'dmg', name: 'AMPLIFIER', glyph: 'Ψ', desc: '+6% damage', max: 10, cost: costs(40, 10, 1.42) },
  { id: 'armor', name: 'FIREWALL', glyph: '▣', desc: '-4% damage taken', max: 8, cost: costs(50, 8, 1.45) },
  { id: 'speed', name: 'SERVOS', glyph: '»', desc: '+4% move speed', max: 6, cost: costs(40, 6, 1.5) },
  { id: 'crit', name: 'PRECISION', glyph: '⌖', desc: '+3% critical chance', max: 8, cost: costs(45, 8, 1.45) },
  { id: 'blade', name: 'BLADE MASTERY', glyph: '/', desc: '+12% blade damage, +5% reach', max: 6, cost: costs(40, 6, 1.5) },
  { id: 'xp', name: 'DATA SIPHON', glyph: '◇', desc: '+8% XP gain', max: 8, cost: costs(35, 8, 1.45) },
  { id: 'magnet', name: 'FIELD EMITTER', glyph: '∪', desc: '+20% pickup radius', max: 6, cost: costs(25, 6, 1.5) },
  { id: 'regen', name: 'SELF-REPAIR', glyph: '♥', desc: '+0.3 integrity per second', max: 6, cost: costs(60, 6, 1.5) },
  { id: 'sync', name: 'SYNC BOOSTER', glyph: '◷', desc: '+15% overclock charge speed', max: 5, cost: costs(50, 5, 1.5) },
  { id: 'shards', name: 'SHARD MINER', glyph: '◆', desc: '+10% shards earned per run', max: 8, cost: costs(60, 8, 1.45) },
  { id: 'headstart', name: 'HEAD START', glyph: '▲', desc: '+1 free level-up at the start of each run', max: 3, cost: [150, 350, 700] },
  { id: 'reroll', name: 'PROBABILITY ENGINE', glyph: '↻', desc: '+1 card reroll per run', max: 5, cost: costs(80, 5, 1.6) },
  { id: 'dash', name: 'VECTOR CORE', glyph: '↯', desc: '+1 dash charge', max: 2, cost: [260, 650] },
  { id: 'revive', name: 'SECOND SIGNAL', glyph: '✦', desc: 'Revive once per run at half integrity (rank 2: twice)', max: 2, cost: [400, 1200] },
  { id: 'choice', name: 'WIDER SIGHT', glyph: '◎', desc: '4 choices on every level-up', max: 1, cost: [500] },
  { id: 'seeker', name: 'UNLOCK · RETRIEVAL SWARM', glyph: '➶', desc: 'Homing queries join the weapon pool', max: 1, cost: [120] },
  { id: 'drone', name: 'UNLOCK · LLM AGENT', glyph: '⊹', desc: 'An autonomous agent joins the weapon pool', max: 1, cost: [200] },
  { id: 'kmeans', name: 'UNLOCK · K-MEANS SINGULARITY', glyph: '✺', desc: 'Black-hole centroids join the weapon pool', max: 1, cost: [300] },
  { id: 'gan', name: 'UNLOCK · GAN DECOY', glyph: '⧉', desc: 'A holographic double joins the weapon pool', max: 1, cost: [400] },
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
