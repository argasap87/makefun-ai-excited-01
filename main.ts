// Jellyfish Wave Over the Lighthouse — make.fun ai-excited-01 entry (round 4).
// Procedurally drawn 1024x1024 PNG, Node 22 standard library only.
// A colossal wave made of glowing jellyfish curls over a tiny lighthouse.
// One hero gold jellyfish rides the curl tip where the lighthouse beam hits,
// and a racing stream of light streaks along the wave's diagonal.
// Fully deterministic: fixed-seed PRNG, no Date, no network, no external assets.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const buf = new Float32Array(W * H * 3);

// ---------------------------------------------------------------- seeded PRNG
let s = 0x51ab3c7d;
function rnd(): number {
  s |= 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rr(a: number, b: number): number {
  return a + (b - a) * rnd();
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------- pixel layer
function addPx(x: number, y: number, r: number, g: number, b: number): void {
  const xi = x | 0;
  const yi = y | 0;
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = (yi * W + xi) * 3;
  buf[i] += r;
  buf[i + 1] += g;
  buf[i + 2] += b;
}

// Soft radial glow with a kernel that reaches exactly zero at the edge,
// so no hard rectangular bbox seam shows around the light.
function glow(
  cx: number, cy: number, rad: number,
  r: number, g: number, b: number, amt: number,
): void {
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  const inv = 1 / (rad * rad);
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      const q = 1 - d2 * inv;
      if (q <= 0) continue;
      const f = q * q * amt;
      if (f < 0.002) continue;
      const i = (y * W + x) * 3;
      buf[i] += r * f;
      buf[i + 1] += g * f;
      buf[i + 2] += b * f;
    }
  }
}

// Line with gaussian cross-section falloff.
function line(
  x0: number, y0: number, x1: number, y1: number, w: number,
  r: number, g: number, b: number, amt: number,
): void {
  const pad = w * 3 + 2;
  const minx = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const maxx = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + pad));
  const miny = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const maxy = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + pad));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      let t = ((x - x0) * dx + (y - y0) * dy) / len2;
      t = clamp(t, 0, 1);
      const px = x0 + t * dx;
      const py = y0 + t * dy;
      const ddx = x - px;
      const ddy = y - py;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      const f = Math.exp(-((d / w) * (d / w)) * 2.0) * amt;
      if (f < 0.002) continue;
      const i = (y * W + x) * 3;
      buf[i] += r * f;
      buf[i + 1] += g * f;
      buf[i + 2] += b * f;
    }
  }
}

// Comet streak: bright head at (x, y), fading tail backwards along (dx, dy).
// (dx, dy) must be a unit vector pointing from tail toward head.
function streak(
  x: number, y: number, dx: number, dy: number, len: number, w: number,
  r: number, g: number, b: number, amt: number,
): void {
  const tx = x - dx * len;
  const ty = y - dy * len;
  const pad = w * 3 + 2;
  const minx = Math.max(0, Math.floor(Math.min(x, tx) - pad));
  const maxx = Math.min(W - 1, Math.ceil(Math.max(x, tx) + pad));
  const miny = Math.max(0, Math.floor(Math.min(y, ty) - pad));
  const maxy = Math.min(H - 1, Math.ceil(Math.max(y, ty) + pad));
  for (let yy = miny; yy <= maxy; yy++) {
    for (let xx = minx; xx <= maxx; xx++) {
      const u = ((xx - tx) * dx + (yy - ty) * dy) / len; // 0 tail -> 1 head
      if (u < 0 || u > 1) continue;
      const d = Math.abs((xx - tx) * dy - (yy - ty) * dx);
      const f = (0.12 + 0.88 * u * u) * Math.exp(-((d / w) * (d / w)) * 2.5) * amt;
      if (f < 0.002) continue;
      const i = (yy * W + xx) * 3;
      buf[i] += r * f;
      buf[i + 1] += g * f;
      buf[i + 2] += b * f;
    }
  }
}

type RGB = [number, number, number];

// Even-odd scanline polygon fill with a per-pixel shader.
function fillPoly(pts: Array<[number, number]>, shade: (x: number, y: number) => RGB): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(H - 1, Math.ceil(maxY));
  const n = pts.length;
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const x0 = pts[i][0];
      const y0 = pts[i][1];
      const x1 = pts[(i + 1) % n][0];
      const y1 = pts[(i + 1) % n][1];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) {
        const c = shade(x, y);
        addPx(x, y, c[0], c[1], c[2]);
      }
    }
  }
}

// Distance from a point to a polyline (used for crest proximity).
function distToPolyline(px: number, py: number, pts: Array<[number, number]>): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const x0 = pts[i][0];
    const y0 = pts[i][1];
    const x1 = pts[i + 1][0];
    const y1 = pts[i + 1][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - x0) * dx + (py - y0) * dy) / len2;
    t = clamp(t, 0, 1);
    const qx = x0 + t * dx;
    const qy = y0 + t * dy;
    const ddx = px - qx;
    const ddy = py - qy;
    const d = Math.sqrt(ddx * ddx + ddy * ddy);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------- scene setup
// Wave silhouette: upper crest line, then the inner face down to the bottom.
const CREST: Array<[number, number]> = [
  [0, 905], [110, 720], [250, 545], [400, 415],
  [540, 320], [660, 272], [755, 292], [798, 355],
];
const WAVE: Array<[number, number]> = [
  ...CREST,
  [748, 420], [668, 428], [612, 505], [580, 660],
  [605, 830], [665, 1024], [0, 1024],
];

const BURST: [number, number] = [742, 345]; // hero jellyfish / beam impact point
const LAMP: [number, number] = [880, 708]; // lighthouse lamp
const FLOW = [0.72, -0.69]; // unit-ish diagonal flow direction (up-right)

// ---------------------------------------------------------------- background
// Sky: deep indigo, darker at the top, slightly lighter toward the horizon.
for (let y = 0; y < H; y++) {
  const t = y / H;
  const r = lerp(0.012, 0.05, t);
  const g = lerp(0.02, 0.075, t);
  const b = lerp(0.07, 0.19, t);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  }
}
// Faint deep-blue nebula wash for depth.
glow(300, 180, 420, 0.05, 0.09, 0.28, 0.5);
glow(880, 420, 380, 0.04, 0.07, 0.24, 0.4);

// Stars (upper sky only).
for (let i = 0; i < 170; i++) {
  const x = rr(0, W);
  const y = rr(0, 620);
  const a = rr(0.05, 0.5);
  addPx(x, y, a * 0.9, a * 0.95, a);
  if (rnd() < 0.18) {
    addPx(x + 1, y, a * 0.5, a * 0.5, a * 0.5);
    addPx(x, y + 1, a * 0.5, a * 0.5, a * 0.5);
  }
}

// Moon: pale disc, top right, with a soft halo.
glow(848, 118, 170, 0.55, 0.62, 0.85, 0.35);
for (let dy = -38; dy <= 38; dy++) {
  for (let dx = -38; dx <= 38; dx++) {
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 38) continue;
    const edge = clamp((38 - d) / 6, 0, 1);
    const v = 0.55 + 0.45 * edge;
    addPx(848 + dx, 118 + dy, v * 0.85, v * 0.9, v);
  }
}
// A couple of faint darker maria patches on the moon.
glow(836, 108, 12, -0.18, -0.18, -0.2, 0.5);
glow(860, 130, 9, -0.15, -0.15, -0.16, 0.5);

// ---------------------------------------------------------------- the sea
// Dark sea on the right, below where the wave face ends.
fillPoly(
  [[665, 1024], [605, 830], [580, 660], [700, 700], [1024, 760], [1024, 1024]],
  (_x, y) => {
    const t = clamp((y - 700) / 324, 0, 1);
    return [lerp(0.02, 0.008, t), lerp(0.05, 0.015, t), lerp(0.13, 0.05, t)];
  },
);
// Moon shimmer column on the sea.
for (let i = 0; i < 14; i++) {
  const y = rr(830, 1000);
  const x = 848 + rr(-34, 34);
  line(x - rr(12, 42), y, x + rr(12, 42), y, 1.6, 0.5, 0.6, 0.85, rr(0.05, 0.13));
}
// Sparse cyan glints across the open sea.
for (let i = 0; i < 26; i++) {
  const y = rr(820, 1000);
  const x = rr(680, 1000);
  line(x, y, x + rr(18, 70), y, 1.4, 0.25, 0.55, 0.7, rr(0.04, 0.12));
}

// ---------------------------------------------------------------- the wave body
fillPoly(WAVE, (x, y) => {
  const t = clamp((905 - y) / 640, 0, 1); // 0 deep base -> 1 near crest
  const t2 = Math.pow(t, 1.7); // keep the body deep; brightness lives at the crest
  let r = lerp(0.008, 0.03, t2);
  let g = lerp(0.03, 0.14, t2);
  let b = lerp(0.08, 0.3, t2);
  // Brighten toward the crest line (rim glow inside the water).
  const d = distToPolyline(x, y, CREST);
  const rim = Math.exp(-d / 42) * 0.75;
  r += 0.1 * rim;
  g += 0.5 * rim;
  b += 0.62 * rim;
  // Diagonal flow bands: alternating lighter/darker stripes along the flow,
  // so the water has texture and direction instead of a flat fill.
  const along = (x * 0.72 - y * 0.69) / 90;
  const band = (Math.sin(along) * 0.5 + 0.5) * 0.055 * t;
  r += band;
  g += band * 1.6;
  b += band * 1.8;
  return [r, g, b];
});

// Soft glowing edge along the wave's inner face, so the face does not read
// as a hard geometric cut against the dark sea.
const FACE: Array<[number, number]> = [
  [748, 420], [668, 428], [612, 505], [580, 660], [605, 830], [665, 1024],
];
for (let i = 0; i + 1 < FACE.length; i++) {
  const [x0, y0] = FACE[i];
  const [x1, y1] = FACE[i + 1];
  line(x0, y0, x1, y1, 10, 0.2, 0.5, 0.75, 0.1);
  line(x0, y0, x1, y1, 2.5, 0.4, 0.75, 0.95, 0.22);
}
// Barrel shadow: dark hollow under the curl tip.
for (let dy = -44; dy <= 44; dy++) {
  for (let dx = -80; dx <= 80; dx++) {
    const e = (dx * dx) / (80 * 80) + (dy * dy) / (44 * 44);
    if (e > 1) continue;
    const edge = clamp((1 - e) * 3, 0, 1);
    addPx(712 + dx, 396 + dy, -0.02 * edge, -0.03 * edge, -0.05 * edge);
  }
}
// Bright rim along the crest line (the wave's glowing edge).
for (let i = 0; i + 1 < CREST.length; i++) {
  const [x0, y0] = CREST[i];
  const [x1, y1] = CREST[i + 1];
  line(x0, y0, x1, y1, 9, 0.25, 0.75, 0.9, 0.22);
  line(x0, y0, x1, y1, 3, 0.55, 0.95, 1.0, 0.75);
}
// Gold kiss of light where the beam will hit the curl tip.
line(660, 272, 755, 292, 7, 1.0, 0.8, 0.35, 0.5);
line(755, 292, 798, 355, 6, 1.0, 0.75, 0.3, 0.45);
// Energy ribbon: a bright white-cyan trail hugging the crest, with a gold
// thread running just beneath it — the focal path the eye follows to the burst.
for (let i = 0; i + 1 < CREST.length; i++) {
  const [x0, y0] = CREST[i];
  const [x1, y1] = CREST[i + 1];
  line(x0, y0, x1, y1, 14, 0.3, 0.85, 1.0, 0.3);
  line(x0, y0, x1, y1, 4.5, 1.0, 1.0, 1.0, 0.85);
  line(x0, y0 + 16, x1, y1 + 16, 3, 1.0, 0.7, 0.25, 0.6);
}
// Dense bright particle stream riding the crest line.
for (let i = 0; i < 260; i++) {
  const x = rr(0, 800);
  let cyTop = 900;
  for (let k = 0; k + 1 < CREST.length; k++) {
    const [ax, ay] = CREST[k];
    const [bx, by] = CREST[k + 1];
    if (x >= ax && x <= bx && bx > ax) {
      cyTop = ay + ((x - ax) / (bx - ax)) * (by - ay);
      break;
    }
  }
  const y = cyTop + rr(0, 70);
  const a = rr(0.5, 1.0);
  const pick = rnd();
  if (pick < 0.3) addPx(x, y, a, a * 0.7, a * 0.25);
  else if (pick < 0.8) addPx(x, y, a * 0.5, a * 0.9, a);
  else addPx(x, y, a, a, a * 0.95);
  if (rnd() < 0.3) glow(x, y, rr(4, 9), 0.5, 0.85, 1.0, 0.35);
}

// ---------------------------------------------------------------- jellyfish
// kind: 0 = cyan, 1 = gold. Dome + glowing rim + wavy tentacles trailing
// down-left (the flow direction), so the whole school feels like it is
// racing up-right along the wave.
function jellyfish(
  cx: number, cy: number, r: number, kind: number, phase: number,
  coreScale = 1,
): void {
  const cr = kind === 1 ? 1.0 : 0.25;
  const cg = kind === 1 ? 0.72 : 0.9;
  const cb = kind === 1 ? 0.1 : 1.0; // deep amber for gold: saturated, not washed out
  // Halo behind the dome.
  glow(cx, cy - r * 0.2, r * 2.4, cr, cg, cb, 0.30);
  // Dome: upper half-disc with a hot core near the top.
  for (let dy = -r; dy <= 0; dy++) {
    const hw = Math.sqrt(r * r - dy * dy);
    const y = Math.round(cy + dy);
    if (y < 0 || y >= H) continue;
    for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) {
      const ddx = x - cx;
      const d = Math.sqrt(ddx * ddx + dy * dy) / r;
      const base = 0.5 + 0.65 * (1 - d);
      // Hot core toward the top centre.
      const core = Math.exp(
        -(((x - cx) * (x - cx)) / ((r * 0.5) * (r * 0.5)) +
          ((y - (cy - r * 0.45)) * (y - (cy - r * 0.45))) / ((r * 0.42) * (r * 0.42))),
      );
      addPx(
        x, y,
        cr * base * 0.55 + 0.9 * core * coreScale,
        cg * base * 0.55 + 0.85 * core * coreScale,
        cb * base * 0.55 + 0.7 * core * coreScale,
      );
    }
  }
  // Bright rim arc over the dome.
  for (let a = 200; a <= 340; a += 6) {
    const rad = (a * Math.PI) / 180;
    const x0 = cx + Math.cos(rad) * r * 0.98;
    const y0 = cy + Math.sin(rad) * r * 0.98;
    const rad2 = ((a + 6) * Math.PI) / 180;
    const x1 = cx + Math.cos(rad2) * r * 0.98;
    const y1 = cy + Math.sin(rad2) * r * 0.98;
    line(x0, y0, x1, y1, 2, 1.0, 1.0, 1.0, 0.7);
  }
  // Tentacles: 6 wavy strands streaming down-left.
  const n = 6;
  for (let i = 0; i < n; i++) {
    const spread = ((i / (n - 1)) * 2 - 1) * r * 0.75;
    const sx = cx + spread;
    const sy = cy + 2;
    const len = r * (1.7 + 0.45 * Math.sin(phase + i * 1.7));
    const steps = 14;
    let px = sx;
    let py = sy;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const sway = Math.sin(t * 5.5 + phase + i * 1.3) * 9 * t;
      const nx = sx - 0.55 * len * t + sway * 0.7;
      const ny = sy + 0.85 * len * t + sway * 0.25;
      line(px, py, nx, ny, Math.max(1, 3 * (1 - t * 0.7)), cr, cg, cb, 0.55 * (1 - t * 0.6));
      px = nx;
      py = ny;
    }
    // Glowing tip bead.
    addPx(px, py, cr * 0.5, cg * 0.5, cb * 0.5);
  }
}

// The school, riding the crest from the tail (bottom-left) to the hero.
jellyfish(55, 830, 24, 0, 0.4);
jellyfish(140, 705, 30, 0, 1.2);
jellyfish(262, 575, 38, 0, 2.1);
jellyfish(405, 445, 46, 0, 0.9);
jellyfish(548, 352, 58, 0, 1.7);
jellyfish(330, 700, 26, 0, 2.6);
jellyfish(470, 560, 32, 0, 3.1);
jellyfish(610, 470, 26, 1, 0.7);
jellyfish(300, 900, 16, 0, 1.5);
jellyfish(470, 935, 13, 0, 2.9);
// (The hero gold jellyfish at the curl tip is drawn after the burst flash,
// so its dome stays crisp on top of the glow.)

// ---------------------------------------------------------------- light stream
// Racing comet streaks along the wave's diagonal, denser and brighter near
// the crest — the light looks like it is accelerating toward the burst.
// Short, thick, tapered comets with a slight angle jitter (organic, not rain).
for (let i = 0; i < 120; i++) {
  const x = rr(20, 820);
  // Crest height at this x (upper boundary polyline, left part).
  let cyTop = 900;
  for (let k = 0; k + 1 < CREST.length; k++) {
    const [ax, ay] = CREST[k];
    const [bx, by] = CREST[k + 1];
    if (x >= ax && x <= bx && bx > ax) {
      cyTop = ay + ((x - ax) / (bx - ax)) * (by - ay);
      break;
    }
  }
  const y = cyTop + rr(10, 240);
  if (y > 1010) continue;
  const near = clamp(1 - (y - cyTop) / 260, 0.15, 1); // brighter near crest
  const len = rr(30, 105) * (0.6 + near);
  const w = rr(1.8, 4.2);
  const ja = rr(-0.12, 0.12);
  const dx = FLOW[0] * Math.cos(ja) - FLOW[1] * Math.sin(ja);
  const dy = FLOW[0] * Math.sin(ja) + FLOW[1] * Math.cos(ja);
  const gold = rnd() < 0.3;
  const amt = rr(0.4, 0.95) * near;
  if (gold) streak(x, y, dx, dy, len, w, 1.0, 0.75, 0.3, amt);
  else streak(x, y, dx, dy, len, w, 0.45, 0.9, 1.0, amt);
}
// (Sky streaks removed: they read as rain, not speed.)
// Glowing particles racing along the wave.
for (let i = 0; i < 320; i++) {
  const x = rr(10, 830);
  let cyTop = 900;
  for (let k = 0; k + 1 < CREST.length; k++) {
    const [ax, ay] = CREST[k];
    const [bx, by] = CREST[k + 1];
    if (x >= ax && x <= bx && bx > ax) {
      cyTop = ay + ((x - ax) / (bx - ax)) * (by - ay);
      break;
    }
  }
  const y = cyTop + rr(8, 320);
  if (y > 1015) continue;
  const a = rr(0.15, 0.8);
  if (rnd() < 0.25) addPx(x, y, a, a * 0.7, a * 0.3);
  else addPx(x, y, a * 0.4, a * 0.85, a);
}

// ---------------------------------------------------------------- lighthouse
// Rock.
for (let dy = -26; dy <= 26; dy++) {
  for (let dx = -72; dx <= 72; dx++) {
    const e = (dx * dx) / (72 * 72) + (dy * dy) / (26 * 26);
    if (e > 1) continue;
    const v = 0.05 + 0.05 * (1 - e);
    addPx(880 + dx, 812 + dy, v * 0.7, v * 0.8, v * 1.2);
  }
}
// Tower: white with two red bands (tiny against the giant wave).
fillPoly(
  [[868, 800], [872, 714], [888, 714], [892, 800]],
  (x, y) => {
    if ((y >= 736 && y <= 752) || (y >= 768 && y <= 784)) return [0.55, 0.1, 0.12];
    const shade = 0.75 + 0.2 * ((x - 868) / 24);
    return [shade * 0.9, shade * 0.92, shade];
  },
);
// Lamp room + lamp glow.
fillPoly([[874, 714], [886, 714], [886, 700], [874, 700]], () => [0.15, 0.14, 0.12]);
glow(LAMP[0], LAMP[1], 26, 1.0, 0.85, 0.45, 0.9);
addPx(LAMP[0], LAMP[1], 1.0, 0.95, 0.7);

// Beam: a widening cone from the lamp to the burst point.
{
  const ax = LAMP[0];
  const ay = LAMP[1];
  const bx = BURST[0];
  const by = BURST[1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const w0 = 7;
  const w1 = 58;
  fillPoly(
    [
      [ax + px * w0, ay + py * w0],
      [ax - px * w0, ay - py * w0],
      [bx - px * w1, by - py * w1],
      [bx + px * w1, by + py * w1],
    ],
    (x, y) => {
      const u = clamp(((x - ax) * ux + (y - ay) * uy) / len, 0, 1);
      const v = Math.abs((x - ax) * px + (y - ay) * py) / lerp(w0, w1, u);
      const a = (1 - u * 0.55) * Math.exp(-v * v * 2.4) * 0.5;
      return [1.0 * a, 0.85 * a, 0.42 * a];
    },
  );
  line(ax, ay, bx, by, 8, 1.0, 0.85, 0.45, 0.18);
  line(ax, ay, bx, by, 2.5, 1.0, 0.95, 0.7, 0.8);
}

// ---------------------------------------------------------------- the burst
// Hot core where the beam meets the hero jellyfish: a tight white-gold flash
// (kept compact so it does not swallow the hero), radial spray and a cloud
// of racing particles. The hero is re-drawn AFTER the flash so its gold dome
// stays crisp on top of the glow.
glow(BURST[0], BURST[1], 210, 1.0, 0.8, 0.4, 0.6);
glow(BURST[0], BURST[1], 70, 1.0, 0.95, 0.8, 0.7);
for (let i = 0; i < 30; i++) {
  const a = rr(0, Math.PI * 2);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const len = rr(45, 150);
  // Head at the centre so the streak is brightest at the burst.
  streak(BURST[0], BURST[1], -ux, -uy, len, rr(1.6, 3.4), 1.0, 0.85, 0.45, rr(0.4, 0.85));
}
for (let i = 0; i < 130; i++) {
  const a = rr(0, Math.PI * 2);
  const d = rr(10, 230);
  const x = BURST[0] + Math.cos(a) * d;
  const y = BURST[1] + Math.sin(a) * d * 0.8;
  const v = rr(0.2, 0.9) * (1 - d / 260);
  addPx(x, y, v, v * 0.8, v * 0.4);
}
// Anamorphic flare: a horizontal blade of light through the burst.
streak(BURST[0] + 230, BURST[1], 1, 0, 230, 2.5, 1.0, 0.9, 0.55, 0.7);
streak(BURST[0] - 230, BURST[1], -1, 0, 230, 2.5, 1.0, 0.9, 0.55, 0.7);
// Hero gold jellyfish, re-drawn crisp on top of the flash, with a cooler
// core so the dome reads GOLD instead of blowing out to white. It sits just
// below-left of the flash centre so the burst crowns it instead of swallowing it.
jellyfish(705, 378, 85, 1, 0.2, 0.35);
// Starburst flare at the lamp.
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2 + 0.4;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  streak(LAMP[0], LAMP[1], -ux, -uy, rr(18, 42), 1.6, 1.0, 0.9, 0.5, 0.7);
}

// ---------------------------------------------------------------- vignette
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const nx = (x - W / 2) / (W / 2);
    const ny = (y - H / 2) / (H / 2);
    const d = Math.sqrt(nx * nx + ny * ny);
    const v = 1 - 0.22 * clamp((d - 0.55) / 0.85, 0, 1);
    const i = (y * W + x) * 3;
    buf[i] *= v;
    buf[i + 1] *= v;
    buf[i + 2] *= v;
  }
}

// ---------------------------------------------------------------- PNG encode
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function writePNG(outPath: string): void {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = Math.round(255 * Math.pow(1 - Math.exp(-1.9 * Math.max(0, buf[i])), 0.92));
      raw[o + 1] = Math.round(255 * Math.pow(1 - Math.exp(-1.9 * Math.max(0, buf[i + 1])), 0.92));
      raw[o + 2] = Math.round(255 * Math.pow(1 - Math.exp(-1.9 * Math.max(0, buf[i + 2])), 0.92));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
writePNG(path.join(outDir, "entry.png"));
console.log("wrote " + path.join(outDir, "entry.png"));
