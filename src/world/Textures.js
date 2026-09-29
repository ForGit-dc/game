import * as THREE from 'three';
import { makeRng } from '../utils/math.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function noiseFill(ctx, w, h, rng, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 1.2;
  }
  ctx.putImageData(img, 0, 0);
}

/** Dark wet metal floor panels (4m x 4m per tile). Returns { map, roughnessMap }. */
export function makePanelTextures() {
  const rng = makeRng(11);
  const S = 512;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#1c1e2c';
  ctx.fillRect(0, 0, S, S);

  // panel tint variation
  const cells = 4, cs = S / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const v = rng.int(-8, 10);
      ctx.fillStyle = `rgb(${28 + v},${30 + v},${44 + v})`;
      if (rng() < 0.3) {
        // subdivided panel
        ctx.fillRect(x * cs, y * cs, cs / 2, cs);
        ctx.fillStyle = `rgb(${24 + v},${26 + v},${38 + v})`;
        ctx.fillRect(x * cs + cs / 2, y * cs, cs / 2, cs);
      } else {
        ctx.fillRect(x * cs, y * cs, cs, cs);
      }
      // diamond plate or vent
      if (rng() < 0.18) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let i = 0; i < 7; i++) ctx.fillRect(x * cs + 24, y * cs + 20 + i * 12, cs - 48, 5);
      }
      if (rng() < 0.12) {
        // hazard stripe
        ctx.save();
        ctx.beginPath();
        ctx.rect(x * cs + 8, y * cs + cs - 26, cs - 16, 16);
        ctx.clip();
        for (let i = -4; i < 20; i++) {
          ctx.fillStyle = i % 2 ? 'rgba(255,150,40,0.55)' : 'rgba(10,10,14,0.9)';
          ctx.beginPath();
          ctx.moveTo(x * cs + i * 12, y * cs + cs - 10);
          ctx.lineTo(x * cs + i * 12 + 12, y * cs + cs - 10);
          ctx.lineTo(x * cs + i * 12 + 28, y * cs + cs - 26);
          ctx.lineTo(x * cs + i * 12 + 16, y * cs + cs - 26);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }
  // seams
  for (let i = 0; i <= cells; i++) {
    ctx.fillStyle = '#07070c';
    ctx.fillRect(i * cs - 2, 0, 4, S);
    ctx.fillRect(0, i * cs - 2, S, 4);
    ctx.fillStyle = 'rgba(120,130,170,0.18)';
    ctx.fillRect(i * cs + 2, 0, 1, S);
    ctx.fillRect(0, i * cs + 2, S, 1);
  }
  // bolts
  ctx.fillStyle = 'rgba(160,170,200,0.35)';
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++)
      for (const [bx, by] of [[10, 10], [cs - 10, 10], [10, cs - 10], [cs - 10, cs - 10]]) {
        ctx.beginPath();
        ctx.arc(x * cs + bx, y * cs + by, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
  // grime
  for (let i = 0; i < 40; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(rng() * S, rng() * S);
    ctx.scale(rng.range(20, 90), rng.range(20, 90));
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  noiseFill(ctx, S, S, rng, 14);

  // roughness: mostly satin, with wet puddles that mirror neon
  const [rc, rctx] = canvas(256, 256);
  rctx.fillStyle = 'rgb(150,150,150)';
  rctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) {
    const x = rng() * 256, y = rng() * 256, r = rng.range(10, 46);
    const g = rctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(25,25,25,0.95)');
    g.addColorStop(0.7, 'rgba(40,40,40,0.6)');
    g.addColorStop(1, 'rgba(150,150,150,0)');
    rctx.fillStyle = g;
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      rctx.save();
      rctx.translate(ox, oy);
      rctx.fillRect(x - r, y - r, r * 2, r * 2);
      rctx.restore();
    }
  }
  noiseFill(rctx, 256, 256, rng, 30);

  return { map: toTexture(c), roughnessMap: toTexture(rc, { srgb: false }) };
}

const WINDOW_PALETTES = [
  ['#7ff6ff', '#bafcff', '#3ad7ff', '#fff4e0'],
  ['#ff6ad5', '#ff9ee8', '#c38bff', '#fff0fb'],
  ['#ffb35c', '#ffd89c', '#ff7a3c', '#fff1d8'],
];

/**
 * Building facade (4m wide x 6m tall tile).
 * Returns { map, emissiveMap } — lit windows glow and bloom.
 */
export function makeFacadeTextures(variant = 0) {
  const rng = makeRng(100 + variant * 17);
  const W = 256, H = 384;
  const [c, ctx] = canvas(W, H);
  const [e, ectx] = canvas(W, H);

  ctx.fillStyle = variant === 1 ? '#15101f' : variant === 2 ? '#17120f' : '#0f1320';
  ctx.fillRect(0, 0, W, H);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);

  const pal = WINDOW_PALETTES[variant % WINDOW_PALETTES.length];
  const floorH = H / 2;
  for (let f = 0; f < 2; f++) {
    const y0 = f * floorH;
    // floor band
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, y0 + floorH - 22, W, 22);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, y0 + floorH - 24, W, 2);
    const strip = rng() < 0.25;
    for (let i = 0; i < 4; i++) {
      const x = i * 64 + 8;
      const y = y0 + 26;
      const w = strip ? 64 : 48;
      const h = floorH - 64;
      const wx = strip ? i * 64 : x;
      ctx.fillStyle = '#05060a';
      ctx.fillRect(wx, y, w, h);
      ctx.strokeStyle = 'rgba(140,150,190,0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(wx + 1, y + 1, w - 2, h - 2);
      if (rng() < 0.42) {
        const col = pal[Math.floor(rng() * pal.length)];
        const g = ectx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0.6)');
        ectx.globalAlpha = rng.range(0.35, 1);
        ectx.fillStyle = g;
        ectx.fillRect(wx + 3, y + 3, w - 6, h - 6);
        // blinds / silhouettes
        ectx.fillStyle = 'rgba(0,0,0,0.55)';
        if (rng() < 0.5) for (let b = 0; b < h; b += 7) ectx.fillRect(wx + 3, y + b, w - 6, 3);
        else if (rng() < 0.4) ectx.fillRect(wx + w * 0.4, y + h * 0.45, w * 0.22, h * 0.55);
        ectx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(40,50,70,0.8)';
        ctx.fillRect(wx + 3, y + 3, w - 6, h - 6);
      }
    }
  }
  // vertical pilasters
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, 4, H);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(4, 0, 2, H);
  noiseFill(ctx, W, H, rng, 10);

  return { map: toTexture(c), emissiveMap: toTexture(e) };
}

/** Neon tube sign. Text is drawn as a glowing outline; returns texture + aspect. */
export function makeSignTexture(text, color = '#ff2bd6', { font = 'Chakra Petch', weight = 700, vertical = false, frame = true } = {}) {
  const chars = vertical ? text.split('') : [text];
  const size = 120;
  const [m, mctx] = canvas(8, 8);
  mctx.font = `${weight} ${size}px "${font}"`;
  const widths = chars.map((ch) => mctx.measureText(ch).width);
  const pad = 40;
  const W = vertical ? Math.ceil(Math.max(...widths) + pad * 2) : Math.ceil(widths[0] + pad * 2);
  const H = vertical ? Math.ceil(chars.length * size * 1.02 + pad * 2) : Math.ceil(size * 1.25 + pad * 2);
  const [c, ctx] = canvas(Math.min(2048, W), Math.min(2048, H));
  ctx.clearRect(0, 0, W, H);
  ctx.font = `${weight} ${size}px "${font}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  const drawText = (fn) => {
    if (vertical) chars.forEach((ch, i) => fn(ch, W / 2, pad + size * 0.55 + i * size * 1.02));
    else fn(text, W / 2, H / 2 + 4);
  };

  if (frame) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.strokeRect(12, 12, W - 24, H - 24);
  }
  ctx.shadowColor = color;
  ctx.shadowBlur = 30;
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  drawText((t, x, y) => ctx.strokeText(t, x, y));
  ctx.shadowBlur = 8;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ffffff';
  drawText((t, x, y) => ctx.strokeText(t, x, y));

  const tex = toTexture(c, { repeat: false });
  return { texture: tex, aspect: W / H };
}

/** Hologram advert panel: scrolling-ready text + shapes, drawn in white (tinted in shader). */
export function makeHoloAdTexture(lines, seed = 3) {
  const rng = makeRng(seed);
  const W = 512, H = 256;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '700 64px "Chakra Petch"';
  ctx.fillText(lines[0], 28, 26);
  ctx.font = '400 26px "Share Tech Mono"';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(lines[1] || '', 30, 106);
  ctx.fillText(lines[2] || '', 30, 142);
  // bar-code-ish glyphs
  for (let i = 0; i < 40; i++) {
    const w = rng.range(2, 6);
    ctx.fillRect(30 + i * 8, 196, w, rng.range(20, 36));
  }
  // circle emblem
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(W - 90, H / 2 + 20, 56, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W - 90, H / 2 + 20, 34, rng() * 6, rng() * 6 + 4);
  ctx.stroke();
  return toTexture(c, { repeat: false });
}

/** Big painted marking for the Skyport landing pad. */
export function makeSkyportTexture() {
  const S = 1024;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#16141c';
  ctx.fillRect(0, 0, S, S);
  const rng = makeRng(77);
  noiseFill(ctx, S, S, rng, 12);
  ctx.translate(S / 2, S / 2);
  ctx.strokeStyle = 'rgba(255, 211, 107, 0.85)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(0, 0, 400, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.setLineDash([40, 22]);
  ctx.beginPath();
  ctx.arc(0, 0, 350, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255, 211, 107, 0.8)';
  ctx.font = '700 120px "Chakra Petch"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SKYPORT', 0, -40);
  ctx.font = '400 60px "Share Tech Mono"';
  ctx.fillText('— 07 —', 0, 70);
  for (let i = 0; i < 12; i++) {
    ctx.save();
    ctx.rotate((i / 12) * Math.PI * 2);
    ctx.fillRect(-8, -470, 16, 40);
    ctx.restore();
  }
  return toTexture(c, { repeat: false });
}

/** Crate / container side panel. */
export function makeCrateTexture() {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rng = makeRng(5);
  ctx.fillStyle = '#23202e';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#2d2a3c';
  for (let i = 0; i < 8; i++) ctx.fillRect(i * 32 + 4, 10, 22, S - 20);
  ctx.strokeStyle = '#0a0a10';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, S - 10, S - 10);
  ctx.fillStyle = 'rgba(255,138,43,0.8)';
  ctx.fillRect(20, S - 50, 90, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '700 22px "Share Tech Mono"';
  ctx.fillText(`VX-${rng.int(100, 999)}`, 20, 40);
  noiseFill(ctx, S, S, rng, 16);
  return toTexture(c);
}
