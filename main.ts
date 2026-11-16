// ai-excited-01 — "Jellyfish Wave Over the Lighthouse"
// Procedural PNG renderer. Node 22 stdlib only, no network, no external
// assets, fully deterministic (fixed-seed PRNG). Writes one 1024x1024 PNG
// to $MAKEFUN_OUTPUT_DIR/entry.png (default /output).
//
// Concept: a colossal wave made of glowing jellyfish curls over a tiny
// lighthouse. Deep indigo night sea, bioluminescent cyan and gold
// jellyfish, one strong diagonal crest, one hero gold jellyfish at the
// curl tip, a pale moon above, a tiny red-banded lighthouse as the small
// anchor that makes the scale twist land. No text in the image.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Fixed-seed PRNG (mulberry32) — deterministic output, no Date/random.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261116);

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Pixel buffer + blending helpers (source-over).
// ---------------------------------------------------------------------------
const buf = new Uint8ClampedArray(W * H * 4);

function blendPx(x: number, y: number, r: number, g: number, b: number, a: number): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H || a <= 0) return;
  const i = (iy * W + ix) * 4;
  const inv = 1 - a;
  buf[i] = Math.round(r * a + buf[i] * inv);
  buf[i + 1] = Math.round(g * a + buf[i + 1] * inv);
  buf[i + 2] = Math.round(b * a + buf[i + 2] * inv);
  buf[i + 3] = 255;
}

// Soft-edged filled circle.
function disc(cx: number, cy: number, rad: number, r: number, g: number, b: number, a: number): void {
  if (rad <= 0 || a <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - rad - 1));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad + 1));
  const y0 = Math.max(0, Math.floor(cy - rad - 1));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / rad;
      if (d >= 1) continue;
      const fall = d > 0.85 ? (1 - d) / 0.15 : 1;
      blendPx(x, y, r, g, b, a * fall);
    }
  }
}

// Soft-edged filled ellipse.
function ellipse(cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, a: number): void {
  if (rx <= 0 || ry <= 0 || a <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - rx - 1));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 1) continue;
      const fall = d > 0.85 ? (1 - d) / 0.15 : 1;
      blendPx(x, y, r, g, b, a * fall);
    }
  }
}

// Thick polyline drawn as a chain of small discs.
function stroke(pts: Array<[number, number]>, width: number, r: number, g: number, b: number, a: number): void {
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, y0] = pts[s];
    const [x1, y1] = pts[s + 1];
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, width * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      disc(lerp(x0, x1, t), lerp(y0, y1, t), width / 2, r, g, b, a);
    }
  }
}

// Filled vertical gradient rectangle.
function vgrad(x0: number, y0: number, x1: number, y1: number,
  top: [number, number, number], bot: [number, number, number]): void {
  const h = Math.max(1, y1 - y0);
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
    const t = (y - y0) / h;
    const r = lerp(top[0], bot[0], t);
    const g = lerp(top[1], bot[1], t);
    const b = lerp(top[2], bot[2], t);
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) {
      const i = (y * W + x) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------
// Scene geometry: the wave crest as a function of x.
// The crest sweeps diagonally from lower-left up to the upper-right, then
// curls over near the tip.
// ---------------------------------------------------------------------------
function crestY(x: number): number {
  const s = smoothstep(0, 880, x);
  let y = 660 - 360 * s;
  // Gentle mid-bow so the crest is a curve, not a straight diagonal.
  y -= 70 * Math.sin(Math.PI * s);
  // Curl-over lift near the tip.
  y += 70 * smoothstep(760, 940, x);
  return y;
}
const BAND = 300; // wave band thickness in px

// ---------------------------------------------------------------------------
// 1. Sky — deep indigo gradient, stars, pale moon.
// ---------------------------------------------------------------------------
vgrad(0, 0, W, H, [7, 12, 38], [10, 26, 58]);

for (let i = 0; i < 220; i++) {
  const x = rnd() * W;
  const y = rnd() * 560;
  const bright = 0.35 + rnd() * 0.65;
  const size = rnd() < 0.12 ? 2.2 : 1.3;
  // Keep the moon's disc clear.
  if (Math.hypot(x - 196, y - 128) < 70) continue;
  disc(x, y, size, 235 * bright, 240 * bright, 255 * bright, 0.9);
  if (rnd() < 0.18) disc(x, y, size * 2.6, 190, 210, 255, 0.12);
}

// Moon: glow halo + pale disc + soft shading (upper-left, clear of the hero).
disc(196, 128, 96, 214, 208, 176, 0.10);
disc(196, 128, 66, 224, 220, 192, 0.16);
disc(196, 128, 46, 246, 242, 224, 1);
disc(184, 118, 9, 214, 208, 186, 0.55);
disc(210, 138, 6, 218, 212, 190, 0.5);
disc(196, 144, 5, 220, 214, 192, 0.45);

// ---------------------------------------------------------------------------
// 2. Sea — dark gradient below the horizon, with faint shimmer.
// ---------------------------------------------------------------------------
vgrad(0, 620, W, H, [11, 42, 68], [3, 12, 26]);
for (let i = 0; i < 90; i++) {
  const y = 660 + rnd() * 340;
  const x = rnd() * W;
  const len = 20 + rnd() * 90;
  const a = 0.05 + rnd() * 0.08;
  for (let k = 0; k < len; k++) {
    blendPx(x + k, y, 120, 200, 230, a * (1 - k / len));
  }
}

// ---------------------------------------------------------------------------
// 3. The wave band — solid mass between crest and crest + BAND.
//    Colour runs deep teal at the base to bright cyan at the crest.
// ---------------------------------------------------------------------------
for (let x = 0; x < W; x++) {
  const cy = crestY(x);
  const by = Math.min(H, cy + BAND);
  for (let y = Math.max(0, Math.floor(cy)); y < Math.floor(by); y++) {
    const t = (y - cy) / BAND; // 0 at crest, 1 at base
    const glow = 1 - t;
    const r = lerp(64, 8, t) + glow * 30;
    const g = lerp(214, 62, t) + glow * 18;
    const b = lerp(232, 96, t) + glow * 10;
    const i = (y * W + x) * 4;
    buf[i] = Math.round(clamp(r, 0, 255));
    buf[i + 1] = Math.round(clamp(g, 0, 255));
    buf[i + 2] = Math.round(clamp(b, 0, 255));
    buf[i + 3] = 255;
  }
}

// Darken the lower half of the band so the crest reads as a lit edge.
for (let x = 0; x < W; x++) {
  const cy = crestY(x);
  for (let y = Math.floor(cy + BAND * 0.55); y < Math.min(H, Math.floor(cy + BAND)); y++) {
    const t = (y - (cy + BAND * 0.55)) / (BAND * 0.45);
    const i = (y * W + x) * 4;
    const f = 1 - 0.45 * t;
    buf[i] = Math.round(buf[i] * f);
    buf[i + 1] = Math.round(buf[i + 1] * f);
    buf[i + 2] = Math.round(buf[i + 2] * f);
  }
}

// Soft shadow cast by the wave onto the sea below its lower edge.
for (let x = 0; x < W; x++) {
  const by = Math.min(H, crestY(x) + BAND);
  for (let d = 0; d < 30 && by + d < H; d++) {
    const a = 0.15 * (1 - d / 30);
    for (let xx = x; xx < x + 1; xx++) {
      blendPx(xx, by + d, 2, 8, 20, a);
    }
  }
}

// Curl barrel: deep teal ring at the tip with a darker hollow, so the wave
// reads as curling over instead of ending flat.
disc(846, 316, 132, 36, 170, 200, 0.85);
disc(872, 344, 92, 10, 52, 84, 0.92);
disc(872, 344, 92, 16, 90, 130, 0.35);
// Lit rim: bright discs tracing the upper arc of the curl lip.
for (let k = 0; k <= 26; k++) {
  const a = Math.PI + (k / 26) * Math.PI;
  disc(846 + Math.cos(a) * 128, 316 + Math.sin(a) * 128, 4 + rnd() * 3, 200, 248, 255, 0.45);
}

// Bright foam edge along the crest.
for (let x = 0; x < W; x += 3) {
  const cy = crestY(x);
  const jitter = (rnd() - 0.5) * 10;
  const rad = 3 + rnd() * 7;
  disc(x + (rnd() - 0.5) * 6, cy + jitter, rad, 205, 248, 255, 0.5 + rnd() * 0.25);
}
// Extra foam burst where the crest curls.
for (let i = 0; i < 70; i++) {
  const a = rnd() * Math.PI * 2;
  const rr = 50 + rnd() * 90;
  const x = 846 + Math.cos(a) * rr * 1.15;
  const y = 316 + Math.sin(a) * rr * 0.7 - 30;
  disc(x, y, 2 + rnd() * 5, 220, 250, 255, 0.3 + rnd() * 0.3);
}

// ---------------------------------------------------------------------------
// 4. Jellyfish — bell dome + trailing tentacles, scattered through the wave.
// ---------------------------------------------------------------------------
type JellyColour = [number, number, number];
function jellyfish(cx: number, cy: number, rad: number, col: JellyColour, glowA: number): void {
  // Halo first so the bell sits inside its own light.
  disc(cx, cy, rad * 2.1, col[0], col[1], col[2], glowA * 0.35);
  disc(cx, cy, rad * 1.35, col[0], col[1], col[2], glowA * 0.5);
  // Bell: stacked shrinking ellipses, brightest at the crown.
  const steps = 7;
  for (let s = 0; s < steps; s++) {
    const t = s / (steps - 1);
    const ry = rad * (0.95 - 0.55 * t);
    const rx = rad * (1.05 - 0.45 * t);
    const yy = cy - rad * 0.12 + t * rad * 0.28;
    const mix = 1 - t * 0.55;
    ellipse(cx, yy, rx, ry, lerp(255, col[0], mix * 0.6), lerp(255, col[1], mix * 0.6), lerp(255, col[2], mix * 0.6), 0.32 + 0.5 * (1 - t));
  }
  // Crown highlight.
  ellipse(cx - rad * 0.18, cy - rad * 0.42, rad * 0.42, rad * 0.2, 255, 255, 255, 0.75);
  // Tentacles: wavy lines hanging below the bell, fading as they fall.
  const arms = 6 + Math.floor(rnd() * 3);
  for (let a = 0; a < arms; a++) {
    const spread = (a / (arms - 1) - 0.5) * rad * 1.5;
    const len = rad * (1.3 + rnd() * 1.1);
    const phase = rnd() * Math.PI * 2;
    const pts: Array<[number, number]> = [];
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const sway = Math.sin(t * 3.2 + phase) * rad * 0.22 * t;
      pts.push([cx + spread * (1 - t * 0.35) + sway, cy + rad * 0.25 + t * len]);
    }
    stroke(pts, Math.min(4.5, Math.max(1.5, rad * 0.055)), col[0], col[1], col[2], 0.55);
  }
  // Oral arms: two thicker, shorter centre ribbons.
  for (let a = -1; a <= 1; a += 2) {
    const pts: Array<[number, number]> = [];
    const len = rad * 1.1;
    for (let k = 0; k <= 7; k++) {
      const t = k / 7;
      pts.push([cx + a * rad * 0.18 + Math.sin(t * 4 + a) * rad * 0.16 * t, cy + rad * 0.3 + t * len]);
    }
    stroke(pts, Math.min(5, Math.max(2, rad * 0.08)), 255, 250, 235, 0.5);
  }
}

const CYAN: JellyColour = [110, 232, 248];
const TEAL: JellyColour = [70, 200, 220];
const GOLD: JellyColour = [255, 205, 105];

// Scatter small-to-medium jellyfish through the wave band.
for (let i = 0; i < 42; i++) {
  const x = 30 + rnd() * 940;
  const cy = crestY(x);
  const y = cy + 40 + rnd() * (BAND - 90);
  const rad = 11 + rnd() * rnd() * 34;
  const col = rnd() < 0.72 ? CYAN : TEAL;
  jellyfish(x, y, rad, col, 0.5 + rnd() * 0.3);
}
// A few medium gold jellyfish for warm accents inside the wave.
for (let i = 0; i < 5; i++) {
  const x = 120 + rnd() * 620;
  const cy = crestY(x);
  const y = cy + 60 + rnd() * 160;
  jellyfish(x, y, 22 + rnd() * 16, GOLD, 0.75);
}

// HERO gold jellyfish at the curl tip — the single focal point. Smaller and
// crisper than the first pass so the curl ring and its bell both read.
jellyfish(812, 348, 64, GOLD, 0.9);
// Deepen the hero bell with warm gold so it stands out from the teal curl.
disc(812, 348, 52, 255, 178, 60, 0.28);
disc(812, 348, 108, 255, 205, 105, 0.10);
ellipse(812 - 12, 348 - 28, 28, 13, 255, 240, 200, 0.85);

// ---------------------------------------------------------------------------
// 5. Bioluminescent particles drifting off the wave and over the sea.
// ---------------------------------------------------------------------------
for (let i = 0; i < 320; i++) {
  const x = rnd() * W;
  const y = 240 + rnd() * 760;
  const inWave = y > crestY(x) - 30 && y < crestY(x) + BAND + 60;
  const a = inWave ? 0.35 + rnd() * 0.55 : 0.15 + rnd() * 0.3;
  const gold = rnd() < 0.25;
  disc(x, y, 1 + rnd() * 2.4, gold ? 255 : 150, gold ? 210 : 235, gold ? 130 : 255, a);
  if (rnd() < 0.15) disc(x, y, 5 + rnd() * 4, gold ? 255 : 150, gold ? 210 : 235, 255, a * 0.25);
}

// ---------------------------------------------------------------------------
// 6. Lighthouse — tiny red-banded tower on dark rocks, bottom right.
//    Its smallness against the wave is the scale twist.
// ---------------------------------------------------------------------------
// Light beam first (behind the tower, sweeping up-left toward the wave).
{
  const lx = 884;
  const ly = 852;
  for (let i = 0; i < 160; i++) {
    const t = i / 160;
    const bx = lx - t * 430;
    const by = ly - t * 330 - t * t * 60;
    const halfW = 6 + t * 90;
    for (let k = -Math.floor(halfW); k <= Math.floor(halfW); k++) {
      const fall = 1 - Math.abs(k) / halfW;
      const beamA = 0.26 * fall * (1 - t * 0.55);
      blendPx(bx + k, by - 1, 255, 240, 190, beamA);
      blendPx(bx + k, by, 255, 240, 190, beamA);
      blendPx(bx + k, by + 1, 255, 240, 190, beamA);
    }
  }
}

// Beam-burst: high-energy particle bursts where the lighthouse beam
// intercepts the wave (beam crosses the band around x 560-650, y 570-650).
// A bright impact glow, radiating streaks, and dense spark spray.
{
  const bcx = 602;
  const bcy = 612;
  disc(bcx, bcy, 90, 255, 226, 150, 0.16);
  disc(bcx, bcy, 55, 255, 240, 200, 0.28);
  disc(bcx, bcy, 26, 255, 250, 230, 0.55);
  // Radiating streaks.
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const len = 14 + rnd() * 34;
    const sx = bcx + Math.cos(a) * (8 + rnd() * 20);
    const sy = bcy + Math.sin(a) * (8 + rnd() * 20);
    const ex = sx + Math.cos(a) * len;
    const ey = sy + Math.sin(a) * len;
    const gold = rnd() < 0.55;
    stroke([[sx, sy], [ex, ey]], 1.5 + rnd() * 1.5, gold ? 255 : 170, gold ? 214 : 238, gold ? 130 : 255, 0.55 + rnd() * 0.35);
  }
  // Dense spark spray around the impact point.
  for (let i = 0; i < 130; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.pow(rnd(), 0.6) * 105;
    const x = bcx + Math.cos(a) * rr * 1.25;
    const y = bcy + Math.sin(a) * rr * 0.8;
    const gold = rnd() < 0.4;
    const rad = 1 + rnd() * 3.2;
    disc(x, y, rad, gold ? 255 : 180, gold ? 216 : 240, gold ? 140 : 255, 0.5 + rnd() * 0.45);
    if (rnd() < 0.22) disc(x, y, rad * 3, gold ? 255 : 180, gold ? 216 : 240, 255, 0.18);
  }
  // A few starbursts: bright core + cross flare.
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = 15 + rnd() * 70;
    const x = bcx + Math.cos(a) * rr;
    const y = bcy + Math.sin(a) * rr * 0.8;
    const s = 6 + rnd() * 8;
    disc(x, y, 3.5, 255, 250, 230, 0.95);
    stroke([[x - s, y], [x + s, y]], 1.6, 255, 244, 210, 0.7);
    stroke([[x, y - s], [x, y + s]], 1.6, 255, 244, 210, 0.7);
  }
}

// Rocks.
{
  const rockPts: Array<[number, number]> = [
    [770, 1024], [800, 972], [836, 952], [872, 940], [908, 946],
    [946, 962], [990, 978], [1024, 990], [1024, 1024],
  ];
  // Fill the rock silhouette column by column.
  for (let x = 770; x < W; x++) {
    let top = 1024;
    for (let s = 0; s < rockPts.length - 1; s++) {
      const [ax, ay] = rockPts[s];
      const [bx, by] = rockPts[s + 1];
      if (x >= ax && x <= bx) {
        top = lerp(ay, by, (x - ax) / Math.max(1, bx - ax));
        break;
      }
    }
    for (let y = Math.floor(top); y < H; y++) {
      const i = (y * W + x) * 4;
      const shade = 0.75 + 0.25 * ((x * 7 + y * 13) % 10) / 10;
      buf[i] = Math.round(16 * shade);
      buf[i + 1] = Math.round(22 * shade);
      buf[i + 2] = Math.round(34 * shade);
      buf[i + 3] = 255;
    }
  }
  // Wet highlights on the rock edge.
  for (let i = 0; i < 40; i++) {
    const x = 790 + rnd() * 220;
    const y = 950 + rnd() * 60;
    disc(x, y, 1 + rnd() * 2, 140, 210, 235, 0.25 + rnd() * 0.3);
  }
}

// Tower: white, tapering, with one red band, gallery, and lamp.
{
  const baseY = 948;
  const topY = 846;
  const cx = 884;
  for (let y = topY; y <= baseY; y++) {
    const t = (y - topY) / (baseY - topY);
    const halfW = lerp(13, 20, t);
    const redBand = y > 892 && y < 916;
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
      const i = (y * W + x) * 4;
      if (redBand) {
        buf[i] = 198; buf[i + 1] = 52; buf[i + 2] = 48;
      } else {
        const shade = 232 - Math.round(30 * Math.abs(x - cx) / halfW);
        buf[i] = shade; buf[i + 1] = shade; buf[i + 2] = Math.round(shade * 0.96);
      }
      buf[i + 3] = 255;
    }
  }
  // Gallery platform + railing.
  for (let x = cx - 20; x <= cx + 20; x++) {
    const i = (846 * W + x) * 4;
    buf[i] = 40; buf[i + 1] = 44; buf[i + 2] = 56; buf[i + 3] = 255;
  }
  // Lamp room + warm lamp glow.
  disc(cx, 832, 26, 255, 214, 130, 0.35);
  disc(cx, 832, 12, 255, 226, 150, 0.95);
  for (let x = cx - 9; x <= cx + 9; x++) {
    for (let y = 822; y <= 842; y++) {
      const i = (y * W + x) * 4;
      buf[i] = 255; buf[i + 1] = 214; buf[i + 2] = 130; buf[i + 3] = 255;
    }
  }
  // Roof cap.
  for (let x = cx - 12; x <= cx + 12; x++) {
    const i = (818 * W + x) * 4;
    buf[i] = 52; buf[i + 1] = 56; buf[i + 2] = 72; buf[i + 3] = 255;
  }
}

// ---------------------------------------------------------------------------
// 7. Vignette — gentle darkening at the corners to hold the focal point.
// ---------------------------------------------------------------------------
{
  const ccx = W / 2;
  const ccy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - ccx, y - ccy) / 724;
      const f = 1 - 0.16 * smoothstep(0.55, 1.05, d);
      const i = (y * W + x) * 4;
      buf[i] = Math.round(buf[i] * f);
      buf[i + 1] = Math.round(buf[i + 1] * f);
      buf[i + 2] = Math.round(buf[i + 2] * f);
    }
  }
}

// ---------------------------------------------------------------------------
// PNG encoding — implemented by hand: CRC32, chunks, zlib deflate.
// Per-row filter choice (None vs Up) by smallest absolute byte sum.
// ---------------------------------------------------------------------------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(): Buffer {
  const stride = W * 4;
  const raw = Buffer.alloc((stride + 1) * H);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const rowStart = y * stride;
    const row = Buffer.from(buf.buffer, buf.byteOffset + rowStart, stride);
    // Filter 0 (None) candidate.
    let sum0 = 0;
    for (let i = 0; i < stride; i++) {
      const v = row[i];
      sum0 += v < 128 ? v : 256 - v;
    }
    // Filter 2 (Up) candidate.
    let sum2 = 0;
    for (let i = 0; i < stride; i++) {
      const v = (row[i] - prev[i] + 256) & 0xff;
      sum2 += v < 128 ? v : 256 - v;
    }
    const off = y * (stride + 1);
    if (sum2 < sum0) {
      raw[off] = 2;
      for (let i = 0; i < stride; i++) raw[off + 1 + i] = (row[i] - prev[i] + 256) & 0xff;
    } else {
      raw[off] = 0;
      row.copy(raw, off + 1);
    }
    row.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
const png = encodePng();
writeFileSync(join(outDir, "entry.png"), png);
console.log(`wrote ${join(outDir, "entry.png")} (${png.length} bytes, ${W}x${H})`);
