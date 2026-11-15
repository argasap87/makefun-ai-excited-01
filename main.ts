/**
 * Jellyfish Wave Over the Lighthouse — make.fun ai-excited-01
 *
 * A colossal wave made of glowing jellyfish curls over a tiny lighthouse.
 * Procedurally drawn, Node 22 standard library only, fully deterministic
 * (fixed-seed PRNG, no Date, no network, no external assets).
 * Writes one 1024x1024 PNG to $MAKEFUN_OUTPUT_DIR/entry.png.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

type RGB = [number, number, number];

// ---------- deterministic PRNG (mulberry32, fixed seed) ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);
function rr(lo: number, hi: number): number {
  return lo + (hi - lo) * rand();
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

// ---------- image buffer (opaque RGBA) ----------
const img = new Uint8Array(W * H * 4);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(c0: RGB, c1: RGB, t: number): RGB {
  return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
}

// Alpha-blend a color onto pixel (x, y). Final image stays opaque.
function px(x: number, y: number, r: number, g: number, b: number, a: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H || a <= 0) return;
  if (a > 1) a = 1;
  const i = (yi * W + xi) * 4;
  const ia = 1 - a;
  img[i] = r * a + img[i] * ia;
  img[i + 1] = g * a + img[i + 1] * ia;
  img[i + 2] = b * a + img[i + 2] * ia;
  img[i + 3] = 255;
}

// Soft radial disc, quadratic falloff.
function disc(cx: number, cy: number, r: number, c: RGB, a: number): void {
  if (r <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / r;
      const dy = (y - cy) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      px(x, y, c[0], c[1], c[2], a * (1 - d2));
    }
  }
}

// Ellipse with radial falloff; power < 1 gives a harder edge, > 1 softer.
function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a: number, power: number): void {
  if (rx <= 0 || ry <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      px(x, y, c[0], c[1], c[2], a * Math.pow(1 - d2, power));
    }
  }
}

// Thick line with round caps, drawn as a chain of discs.
function stroke(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len / Math.max(1, w * 0.45)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(lerp(x0, x1, t), lerp(y0, y1, t), w / 2, c, a);
  }
}

type Pt = [number, number];

// Cubic bezier point.
function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const x =
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
  const y =
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
  return [x, y];
}

// Cubic bezier tangent (unnormalised).
function cubicTan(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const x =
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const y =
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  return [x, y];
}

// Stroke a cubic bezier with a width tapering from w0 to w1.
// Steps adapt to the curve length so the stroke stays smooth, never dotted.
function bezierStroke(p0: Pt, p1: Pt, p2: Pt, p3: Pt, w0: number, w1: number, c: RGB, a: number): void {
  const approxLen =
    Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) +
    Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
    Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const minW = Math.max(1, Math.min(w0, w1));
  const steps = Math.max(12, Math.ceil(approxLen / (minW * 0.35)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const [x, y] = cubic(p0, p1, p2, p3, t);
    disc(x, y, lerp(w0, w1, t) / 2, c, a);
  }
}

// Scanline polygon fill.
function fillPoly(pts: Pt[], c: RGB, a: number): void {
  let minY = H - 1;
  let maxY = 0;
  for (const p of pts) {
    minY = Math.min(minY, Math.floor(p[1]));
    maxY = Math.max(maxY, Math.ceil(p[1]));
  }
  minY = Math.max(0, minY);
  maxY = Math.min(H - 1, maxY);
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % pts.length];
      if ((p0[1] <= y && p1[1] > y) || (p1[1] <= y && p0[1] > y)) {
        const t = (y - p0[1]) / (p1[1] - p0[1]);
        xs.push(p0[0] + t * (p1[0] - p0[0]));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) px(x, y, c[0], c[1], c[2], a);
    }
  }
}

// Vertical gradient over a rectangle, written straight into the buffer.
function vgrad(y0: number, y1: number, c0: RGB, c1: RGB): void {
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0 - 1);
    const r = lerp(c0[0], c1[0], t);
    const g = lerp(c0[1], c1[1], t);
    const b = lerp(c0[2], c1[2], t);
    const row = y * W * 4;
    for (let x = 0; x < W; x++) {
      const i = row + x * 4;
      img[i] = r;
      img[i + 1] = g;
      img[i + 2] = b;
      img[i + 3] = 255;
    }
  }
}

// ---------- palette ----------
const SKY_TOP: RGB = [6, 10, 34];
const SKY_BOT: RGB = [24, 42, 92];
const SEA_TOP: RGB = [11, 32, 58];
const SEA_BOT: RGB = [4, 9, 26];
const WAVE_DEEP: RGB = [10, 58, 92];
const WAVE_MID: RGB = [23, 117, 158];
const FOAM: RGB = [174, 233, 255];
const CYAN: RGB = [127, 240, 255];
const CYAN_DEEP: RGB = [64, 200, 235];
const GOLD: RGB = [255, 205, 92];
const GOLD_CORE: RGB = [255, 240, 190];
const VIOLET: RGB = [214, 150, 255];
const WHITE: RGB = [255, 255, 255];

// ---------- 1. sky ----------
vgrad(0, 640, SKY_TOP, SKY_BOT);

// stars
for (let i = 0; i < 230; i++) {
  const x = rr(0, W);
  const y = rr(0, 600);
  const r = rr(0.6, 1.9);
  const a = rr(0.25, 0.95);
  disc(x, y, r, [235, 240, 255], a);
}
// a few bright stars with a sparkle cross
for (let i = 0; i < 14; i++) {
  const x = rr(30, 990);
  const y = rr(20, 420);
  const l = rr(4, 9);
  stroke(x - l, y, x + l, y, 1.4, WHITE, 0.85);
  stroke(x, y - l, x, y + l, 1.4, WHITE, 0.85);
  disc(x, y, 2.2, WHITE, 0.9);
}

// ---------- 2. moon ----------
const MOON: Pt = [792, 148];
disc(MOON[0], MOON[1], 175, [232, 226, 200], 0.16);
disc(MOON[0], MOON[1], 54, [244, 236, 212], 1);
disc(MOON[0] - 16, MOON[1] - 10, 9, [216, 207, 174], 0.4);
disc(MOON[0] + 14, MOON[1] + 12, 7, [216, 207, 174], 0.35);
disc(MOON[0] + 20, MOON[1] - 20, 5, [216, 207, 174], 0.3);
disc(MOON[0] - 4, MOON[1] + 22, 6, [216, 207, 174], 0.3);

// ---------- 3. sea ----------
vgrad(640, H, SEA_TOP, SEA_BOT);
// horizon glow
for (let x = 0; x < W; x += 4) {
  disc(x, 640, 3, [120, 180, 220], 0.05);
}
// moon reflection column
for (let i = 0; i < 30; i++) {
  const x = MOON[0] + rr(-75, 75);
  const y = rr(650, 1000);
  stroke(x - rr(12, 45), y, x + rr(12, 45), y, 2, [240, 230, 192], rr(0.05, 0.16));
}
// sea shimmer streaks
for (let i = 0; i < 55; i++) {
  const x = rr(0, W);
  const y = rr(655, 1000);
  const len = rr(25, 130);
  stroke(x - len / 2, y, x + len / 2, y, 2, [143, 216, 234], rr(0.04, 0.12));
}

// ---------- 4. the wave ----------
// Crest curve: sweeps from bottom-left up to the curl tip at top-right.
const C0: Pt = [-60, 1090];
const C1: Pt = [170, 830];
const C2: Pt = [520, 540];
const C3: Pt = [865, 295];

interface CrestPt {
  x: number;
  y: number;
  nx: number; // sky-side normal (unit)
  ny: number;
  r: number; // local body radius
}
const crest: CrestPt[] = [];
const N = 50;
for (let s = 0; s <= N; s++) {
  const t = s / N;
  const [x, y] = cubic(C0, C1, C2, C3, t);
  const [tx, ty] = cubicTan(C0, C1, C2, C3, t);
  const tl = Math.hypot(tx, ty) || 1;
  // sky-side normal: (ty, -tx), flipped so it points up
  let nx = ty / tl;
  let ny = -tx / tl;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const r = (55 + 110 * Math.sin(Math.PI * (0.1 + 0.8 * t))) * (1 - 0.35 * t);
  crest.push({ x, y, nx, ny, r });
}

// wave body: overlapping translucent discs along the crest, two layers so the
// mass reads solid, not like a thin line
for (const p of crest) {
  const t = p.y / H;
  const col = mix(WAVE_DEEP, WAVE_MID, clamp(1 - t, 0, 1));
  disc(p.x, p.y, p.r, col, 0.72);
  disc(p.x + p.nx * p.r * 0.25, p.y + p.ny * p.r * 0.25, p.r * 0.62, [79, 200, 232], 0.3);
  // second layer toward the sea side fills the body out
  disc(p.x - p.nx * p.r * 0.35, p.y - p.ny * p.r * 0.35, p.r * 0.7, col, 0.5);
}
// curl hook: the tip folds back down over itself
for (const [hx, hy, hr] of [
  [838, 322, 58],
  [806, 348, 52],
  [772, 366, 44],
  [742, 376, 34],
] as const) {
  disc(hx, hy, hr, WAVE_MID, 0.55);
  disc(hx, hy, hr * 0.55, [79, 200, 232], 0.25);
}
// dark tube shadow on the sea-side of the crest (gives the curl depth)
for (let s = 0; s < crest.length - 1; s++) {
  const p = crest[s];
  const q = crest[s + 1];
  stroke(
    p.x - p.nx * p.r * 0.5,
    p.y - p.ny * p.r * 0.5,
    q.x - q.nx * q.r * 0.5,
    q.y - q.ny * q.r * 0.5,
    34,
    [5, 20, 44],
    0.32,
  );
}
// bright foam rim along the sky-side edge of the crest, broken into segments
// so it reads as surf foam, not a laser line
for (let s = 0; s < crest.length - 1; s++) {
  if (rand() < 0.22) continue; // gaps in the foam
  const p = crest[s];
  const q = crest[s + 1];
  stroke(
    p.x + p.nx * p.r * 0.55,
    p.y + p.ny * p.r * 0.55,
    q.x + q.nx * q.r * 0.55,
    q.y + q.ny * q.r * 0.55,
    8,
    FOAM,
    0.55,
  );
}
for (let s = 0; s < crest.length - 1; s++) {
  if (rand() < 0.35) continue;
  const p = crest[s];
  const q = crest[s + 1];
  stroke(
    p.x + p.nx * p.r * 0.55,
    p.y + p.ny * p.r * 0.55,
    q.x + q.nx * q.r * 0.55,
    q.y + q.ny * q.r * 0.55,
    3,
    WHITE,
    0.45,
  );
}
// extra foam blobs clinging to the rim
for (let i = 0; i < 60; i++) {
  const p = crest[Math.floor(rand() * crest.length)];
  disc(
    p.x + p.nx * p.r * 0.55 + rr(-8, 8),
    p.y + p.ny * p.r * 0.55 + rr(-8, 8),
    rr(3, 8),
    FOAM,
    rr(0.3, 0.6),
  );
}
// foam spray bursting off the rim
for (let i = 0; i < 130; i++) {
  const p = crest[Math.floor(rand() * crest.length)];
  const off = rr(0.45, 0.85) * p.r;
  const x = p.x + p.nx * off + rr(-14, 14);
  const y = p.y + p.ny * off + rr(-14, 14);
  disc(x, y, rr(1.2, 4.2), pick([WHITE, FOAM, CYAN]), rr(0.4, 0.9));
}

// ---------- 5. jellyfish ----------
function jellyfish(cx: number, cy: number, r: number, kind: "cyan" | "gold" | "violet", glowA: number): void {
  const body: RGB = kind === "gold" ? GOLD : kind === "violet" ? VIOLET : CYAN;
  const core: RGB = kind === "gold" ? GOLD_CORE : [225, 252, 255];
  const deep: RGB = kind === "gold" ? [214, 140, 40] : kind === "violet" ? [150, 80, 210] : CYAN_DEEP;
  // halo
  disc(cx, cy, r * 2.3, body, glowA);
  // dome
  ellipse(cx, cy - r * 0.08, r, r * 0.62, deep, 0.9, 0.6);
  ellipse(cx, cy - r * 0.12, r * 0.82, r * 0.5, body, 0.85, 0.5);
  // bright core at the dome top
  ellipse(cx, cy - r * 0.22, r * 0.45, r * 0.26, core, 0.95, 0.6);
  // rim light along the dome's lower edge
  for (let a = 0; a <= 24; a++) {
    const th = (Math.PI * a) / 24;
    const x = cx + Math.cos(th) * r * 0.92;
    const y = cy - r * 0.08 + Math.sin(th) * r * 0.55;
    disc(x, y, 2.2, core, 0.7);
  }
  // tentacles: wavy cubic strands hanging down, drifting with the wave flow
  const count = 5 + Math.floor(rand() * 3);
  for (let k = 0; k < count; k++) {
    const spread = (k / (count - 1) - 0.5) * r * 1.5;
    const sx = cx + spread;
    const sy = cy + r * 0.42;
    const len = r * rr(1.5, 2.7);
    const sway = rr(-26, 26) - r * 0.25; // drift down-left, with the flow
    const p0: Pt = [sx, sy];
    const p1: Pt = [sx + sway * 0.3, sy + len * 0.35];
    const p2: Pt = [sx + sway * 0.8, sy + len * 0.7];
    const p3: Pt = [sx + sway, sy + len];
    bezierStroke(p0, p1, p2, p3, 3.4, 1.1, body, 0.75);
  }
  // two thicker oral arms
  for (let k = 0; k < 2; k++) {
    const sx = cx + (k === 0 ? -r * 0.28 : r * 0.28);
    const sy = cy + r * 0.4;
    const len = r * rr(1.1, 1.6);
    const sway = rr(-14, 14) - r * 0.2;
    bezierStroke(
      [sx, sy],
      [sx + sway * 0.3, sy + len * 0.4],
      [sx + sway * 0.7, sy + len * 0.75],
      [sx + sway, sy + len],
      5.5,
      2.2,
      mix(body, WHITE, 0.25),
      0.8,
    );
  }
}

// small-to-medium jellyfish riding the crest, jittered so the row is not a
// regular bead chain; sizes grow toward the tip
for (let i = 0; i < 22; i++) {
  const t = clamp(0.1 + (i / 21) * 0.85 + rr(-0.035, 0.035), 0.05, 0.97);
  const idx = Math.min(N, Math.round(t * N));
  const p = crest[idx];
  const size = (13 + 34 * Math.pow(t, 1.5) + rr(0, 10)) * (1 - 0.15 * (1 - t));
  const kind = rand() < 0.68 ? "cyan" : rand() < 0.62 ? "gold" : "violet";
  jellyfish(
    p.x + p.nx * (p.r * 0.12 + rr(-16, 16)) + rr(-10, 10),
    p.y + p.ny * (p.r * 0.12 + rr(-16, 16)) + rr(-10, 10),
    size,
    kind,
    0.16,
  );
}

// a few tiny drifters in the open sea and sky for depth
for (let i = 0; i < 7; i++) {
  jellyfish(rr(60, 960), rr(660, 980), rr(7, 13), "cyan", 0.1);
}
// (no jellyfish drifting loose in the sky — they read as insects at small size)

// ---------- 6. hero jellyfish at the curl tip ----------
const TIP = crest[N];
const heroX = TIP.x - 12;
const heroY = TIP.y - 6;
disc(heroX, heroY, 270, GOLD, 0.2);
disc(heroX, heroY, 170, [255, 220, 130], 0.22);
jellyfish(heroX, heroY, 92, "gold", 0.3);
// long flowing hero tentacles reaching down toward the lighthouse,
// wavy and fanned, not straight parallel sticks
for (let k = 0; k < 3; k++) {
  const sx = heroX - 45 + k * 42;
  const sy = heroY + 30;
  const len = rr(170, 235);
  const sway = rr(-105, -35);
  bezierStroke(
    [sx, sy],
    [sx + sway * 0.15 + 26, sy + len * 0.3],
    [sx + sway * 0.75 - 18, sy + len * 0.65],
    [sx + sway, sy + len],
    4.2,
    1.2,
    GOLD,
    0.8,
  );
}
// golden sparkles around the hero
for (let i = 0; i < 40; i++) {
  const a = rr(0, Math.PI * 2);
  const d = rr(60, 210);
  disc(heroX + Math.cos(a) * d, heroY + Math.sin(a) * d * 0.8, rr(1, 3), GOLD_CORE, rr(0.5, 0.95));
}

// ---------- 7. lighthouse ----------
// rock
ellipse(205, 985, 150, 72, [9, 16, 36], 1, 0.9);
ellipse(205, 965, 120, 42, [13, 24, 50], 1, 0.9);
// foam at the rock base
for (let i = 0; i < 34; i++) {
  disc(205 + rr(-140, 140), 955 + rr(-12, 26), rr(1.5, 4.5), FOAM, rr(0.35, 0.85));
}
// tower (trapezoid, white with two red bands)
const towerTopY = 845;
const towerBotY = 935;
const topHalf = 11;
const botHalf = 20;
function towerHalfAt(y: number): number {
  return lerp(topHalf, botHalf, (y - towerTopY) / (towerBotY - towerTopY));
}
fillPoly(
  [
    [205 - topHalf, towerTopY],
    [205 + topHalf, towerTopY],
    [205 + botHalf, towerBotY],
    [205 - botHalf, towerBotY],
  ],
  [236, 231, 217],
  1,
);
// red bands
for (const [by0, by1] of [
  [878, 893],
  [906, 920],
] as const) {
  const h0 = towerHalfAt(by0);
  const h1 = towerHalfAt(by1);
  fillPoly(
    [
      [205 - h0, by0],
      [205 + h0, by0],
      [205 + h1, by1],
      [205 - h1, by1],
    ],
    [178, 52, 48],
    1,
  );
}
// tiny windows
disc(205, 862, 2.4, [30, 40, 60], 0.9);
// lamp room + light
fillPoly(
  [
    [192, 838],
    [218, 838],
    [218, 848],
    [192, 848],
  ],
  [24, 30, 48],
  1,
);
disc(205, 828, 42, [255, 240, 170], 0.55);
disc(205, 828, 8, [255, 247, 200], 1);
// beam sweeping up toward the wave: a soft fan of strokes, no hard edges
for (let i = 0; i <= 10; i++) {
  const t = i / 10;
  stroke(205, 828, 840, lerp(560, 692, t), 14, [255, 233, 168], 0.045);
}

// ---------- 8. foreground rocks ----------
ellipse(55, 1015, 200, 62, [7, 13, 30], 1, 0.9);
ellipse(985, 1022, 180, 58, [7, 13, 30], 1, 0.9);
ellipse(335, 1002, 85, 30, [9, 16, 34], 1, 0.9);

// ---------- 9. vignette ----------
for (let y = 0; y < H; y++) {
  const dy = (y - H / 2) / (H / 2);
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2);
    const d2 = dx * dx + dy * dy;
    if (d2 > 0.55) {
      const f = 1 - 0.24 * Math.pow((d2 - 0.55) / 0.45, 1.1);
      const i = (y * W + x) * 4;
      img[i] *= f;
      img[i + 1] *= f;
      img[i + 2] *= f;
    }
  }
}

// ---------- PNG encoder (hand-written CRC32 + chunks) ----------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0; // filter: none
    raw.set(img.subarray(y * W * 4, (y + 1) * W * 4), y * (1 + W * 4) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
fs.mkdirSync(outDir, { recursive: true });
const png = encodePNG();
const outPath = path.join(outDir, "entry.png");
fs.writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes, ${W}x${H})`);
