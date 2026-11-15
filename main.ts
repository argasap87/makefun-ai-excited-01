import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// "Jellyfish Wave Over the Lighthouse" — procedural 1024x1024 PNG.
// Node 22 stdlib only. Fully deterministic: fixed-seed PRNG, no Date,
// no network, no external assets. PNG encoding is hand-rolled
// (zlib deflate + CRC32 written here).

const W = 1024;
const H = 1024;

// ---------------- deterministic PRNG (mulberry32) ----------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

// ---------------- CRC32 + PNG encoder ----------------
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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

function encodePNG(rgba: Buffer, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------- tiny canvas ----------------
type RGB = [number, number, number];
const img = Buffer.alloc(W * H * 4);

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Source-over blend of one pixel.
function put(x: number, y: number, r: number, g: number, b: number, a: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H || a <= 0) return;
  const i = (yi * W + xi) * 4;
  const ia = 1 - a;
  img[i] = Math.round(r * a + img[i] * ia);
  img[i + 1] = Math.round(g * a + img[i + 1] * ia);
  img[i + 2] = Math.round(b * a + img[i + 2] * ia);
  img[i + 3] = 255;
}

// Soft radial disc, alpha falls off quadratically.
function softDisc(cx: number, cy: number, rad: number, c: RGB, a: number): void {
  const r0 = Math.max(1, Math.floor(cx - rad));
  const r1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(1, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = r0; x <= r1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / rad;
      if (d >= 1) continue;
      const f = (1 - d) * (1 - d);
      put(x, y, c[0], c[1], c[2], a * f);
    }
  }
}

// Filled disc with a radial gradient from centre colour to edge colour.
function gradDisc(cx: number, cy: number, rad: number, cIn: RGB, cOut: RGB, a: number): void {
  const r0 = Math.max(0, Math.floor(cx - rad));
  const r1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = r0; x <= r1; x++) {
      const dx = (x - cx) / rad;
      const dy = (y - cy) / rad;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 1) continue;
      const c = mix(cIn, cOut, d);
      put(x, y, c[0], c[1], c[2], a * (1 - d * 0.35));
    }
  }
}

// Polyline stroke made of soft discs.
function stroke(pts: Array<[number, number]>, wd: number, c: RGB, a: number): void {
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, y0] = pts[s];
    const [x1, y1] = pts[s + 1];
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist * 1.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      softDisc(lerp(x0, x1, t), lerp(y0, y1, t), wd / 2, c, a);
    }
  }
}

// Even-odd scanline polygon fill; colour from a per-pixel callback.
function fillPoly(pts: Array<[number, number]>, colour: (x: number, y: number) => [RGB, number]): void {
  let minY = H;
  let maxY = 0;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(H - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) {
        const [c, a] = colour(x, y);
        put(x, y, c[0], c[1], c[2], a);
      }
    }
  }
}

// Catmull-Rom spline through control points.
function spline(pts: Array<[number, number]>, samplesPerSeg: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const ext: Array<[number, number]> = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 0; i < ext.length - 3; i++) {
    const p0 = ext[i];
    const p1 = ext[i + 1];
    const p2 = ext[i + 2];
    const p3 = ext[i + 3];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function pointInPoly(x: number, y: number, pts: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------- scene ----------------
const SKY_TOP: RGB = [6, 8, 34];
const SKY_HOR: RGB = [26, 42, 88];
const SEA_TOP: RGB = [10, 38, 62];
const SEA_BOT: RGB = [3, 12, 26];
const CYAN: RGB = [90, 225, 255];
const CYAN_DEEP: RGB = [30, 140, 190];
const GOLD: RGB = [255, 205, 105];
const GOLD_DEEP: RGB = [220, 140, 50];

// Wave outline: crest sweeps bottom-left -> top-right, curls over,
// folds back into a tube, then the inner face falls to the sea line.
const CREST_CTRL: Array<[number, number]> = [
  [0, 742],
  [120, 600],
  [280, 480],
  [460, 370],
  [640, 270],
  [790, 210],
  [900, 185],
  [965, 235],
  [950, 300],
  [880, 340],
  [800, 360],
  [700, 400],
  [620, 450],
  [520, 600],
  [400, 690],
  [260, 725],
  [120, 738],
];
const crestPts = spline(CREST_CTRL.slice(0, 9), 14);
const innerPts = spline(CREST_CTRL.slice(8), 14);
const WAVE_POLY: Array<[number, number]> = [...crestPts, ...innerPts.slice(1), [0, 742]];

const HORIZON_Y = 742; // sea line at the lighthouse side

function drawSky(): void {
  for (let y = 0; y < HORIZON_Y; y++) {
    const t = y / HORIZON_Y;
    const c = mix(SKY_TOP, SKY_HOR, t * t);
    for (let x = 0; x < W; x++) put(x, y, c[0], c[1], c[2], 1);
  }
  // stars
  for (let i = 0; i < 190; i++) {
    const x = rand() * W;
    const y = rand() * 560;
    const a = 0.25 + rand() * 0.65;
    const r = rand() < 0.12 ? 2.2 : 1.1;
    softDisc(x, y, r, [235, 240, 255], a);
  }
  // moon, upper left, with halo
  softDisc(168, 138, 150, [255, 235, 180], 0.1);
  softDisc(168, 138, 78, [255, 240, 200], 0.14);
  gradDisc(168, 138, 46, [255, 248, 225], [235, 210, 160], 1);
  softDisc(152, 124, 8, [225, 200, 155], 0.5);
  softDisc(184, 150, 6, [225, 200, 155], 0.45);
  softDisc(174, 120, 4, [225, 200, 155], 0.4);
}

function drawSea(): void {
  for (let y = HORIZON_Y; y < H; y++) {
    const t = (y - HORIZON_Y) / (H - HORIZON_Y);
    const c = mix(SEA_TOP, SEA_BOT, t);
    for (let x = 0; x < W; x++) put(x, y, c[0], c[1], c[2], 1);
  }
  // glowing horizon line so the sea reads against the sky
  stroke(
    [
      [0, HORIZON_Y],
      [W, HORIZON_Y],
    ],
    3,
    [90, 170, 210],
    0.3,
  );
  // moonlight path on the water, left side
  for (let i = 0; i < 36; i++) {
    const y = HORIZON_Y + 12 + rand() * 220;
    const wdt = 26 + rand() * 90;
    const x = 168 + (rand() - 0.5) * (40 + (y - HORIZON_Y) * 0.55);
    stroke(
      [
        [x - wdt / 2, y],
        [x + wdt / 2, y],
      ],
      2.5,
      [255, 225, 160],
      0.1 + rand() * 0.12,
    );
  }
  // faint swell lines
  for (let i = 0; i < 22; i++) {
    const y = HORIZON_Y + 20 + rand() * 240;
    const x = rand() * W;
    const wdt = 40 + rand() * 130;
    stroke(
      [
        [x, y],
        [x + wdt, y + (rand() - 0.5) * 4],
      ],
      2,
      CYAN_DEEP,
      0.08 + rand() * 0.08,
    );
  }
}

function waveColour(x: number, y: number): [RGB, number] {
  // Brightest near the crest (top edge), deep teal low inside.
  const t = clamp((760 - y) / 560, 0, 1);
  let c = mix([10, 55, 95], [24, 125, 170], t);
  c = mix(c, [70, 205, 235], Math.pow(t, 3) * 0.8);
  // warm gold wash near the curling tip
  const dx = x - 880;
  const dy = y - 220;
  const dTip = Math.sqrt(dx * dx + dy * dy);
  if (dTip < 260) {
    const g = (1 - dTip / 260) * 0.45;
    c = mix(c, GOLD, g);
  }
  return [c, 1];
}

function drawWave(): void {
  fillPoly(WAVE_POLY, waveColour);
  // darker inner face under the curl (the tube shadow)
  const tube: Array<[number, number]> = [
    [950, 300],
    [880, 340],
    [800, 360],
    [700, 400],
    [620, 450],
    [560, 500],
    [640, 520],
    [760, 470],
    [860, 420],
    [950, 360],
  ];
  fillPoly(tube, () => [[5, 22, 46], 0.55]);
  // soft light refracting inside the tube hollow
  softDisc(800, 385, 95, CYAN, 0.09);
  // bright rim on the lip underside so the curl reads
  stroke(innerPts.slice(0, 7), 3, [150, 225, 250], 0.5);
  // diagonal current streaks inside the wave body — flow + momentum
  for (let k = 0; k < 14; k++) {
    const off = 55 + k * 17 + rand() * 8;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < crestPts.length; i += 2) {
      const [x, y] = crestPts[i];
      // keep the streak inside the wave body, never spilling into the sea
      if (x > 60 && x < 940 && pointInPoly(x, y + off, WAVE_POLY)) {
        pts.push([x + rand() * 4, y + off]);
      }
    }
    if (pts.length > 3) stroke(pts, 3 + rand() * 3, CYAN, 0.05 + rand() * 0.07);
  }
  // foam where the wave base meets the sea
  const base = spline(
    [
      [0, 742],
      [120, 738],
      [260, 725],
      [400, 690],
    ],
    10,
  );
  stroke(base, 5, [190, 235, 250], 0.4);
  for (let i = 0; i < 26; i++) {
    const [x, y] = base[Math.floor(rand() * base.length)];
    softDisc(x + (rand() - 0.5) * 20, y - rand() * 10, 1 + rand() * 2.2, [210, 245, 255], 0.5);
  }
  // glowing crest edge
  stroke(crestPts, 14, [40, 160, 200], 0.35);
  stroke(crestPts, 8, CYAN, 0.55);
  stroke(crestPts, 3.5, [210, 250, 255], 0.8);
  // spray dots along the crest
  for (let i = 0; i < crestPts.length; i += 2) {
    const [x, y] = crestPts[i];
    if (rand() < 0.55) {
      softDisc(x + (rand() - 0.5) * 26, y - rand() * 22, 1 + rand() * 2.6, [200, 245, 255], 0.5 + rand() * 0.4);
    }
  }
}

// One jellyfish: glowing bell (dome) + wavy tentacles trailing down-left.
function drawJellyfish(cx: number, cy: number, r: number, gold: boolean): void {
  const bellIn: RGB = gold ? [255, 226, 150] : [150, 235, 255];
  const bellOut: RGB = gold ? [230, 150, 60] : [40, 160, 215];
  // halo
  softDisc(cx, cy - r * 0.15, r * 1.7, gold ? GOLD : CYAN, 0.1);
  // tentacles first (behind the bell)
  const n = 4 + Math.floor(rand() * 4);
  for (let k = 0; k < n; k++) {
    const bx = cx + (k / (n - 1) - 0.5) * r * 1.5;
    const len = r * (1.9 + rand() * 1.3);
    const pts: Array<[number, number]> = [];
    const phase = rand() * 6.28;
    const steps = 12;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      pts.push([
        bx - t * len * 0.45 + Math.sin(t * 7 + phase) * r * 0.14 * (0.3 + t),
        cy + t * len,
      ]);
    }
    stroke(pts, 1.6, gold ? GOLD : CYAN, 0.5 * (1 - 0.25 * k / n));
  }
  // bell dome: upper half-ellipse as a polygon
  const dome: Array<[number, number]> = [];
  const segs = 22;
  for (let s = 0; s <= segs; s++) {
    const a = Math.PI + (s / segs) * Math.PI; // PI..2PI = upper half
    dome.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.82]);
  }
  fillPoly(dome, (x, y) => {
    const d = Math.hypot((x - cx) / r, (y - cy) / (r * 0.82));
    const c = mix(bellIn, bellOut, clamp(d, 0, 1));
    return [c, 0.92];
  });
  // bright rim arc on the dome
  const rim: Array<[number, number]> = [];
  for (let s = 0; s <= segs; s++) {
    const a = Math.PI + (s / segs) * Math.PI;
    rim.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.82]);
  }
  stroke(rim, 2, [225, 250, 255], 0.75);
  // inner glow spot
  softDisc(cx, cy - r * 0.28, r * 0.42, [255, 255, 255], 0.35);
  // oral arms: two short centre streamers
  const c1: Array<[number, number]> = [];
  for (let s = 0; s <= 8; s++) {
    const t = s / 8;
    c1.push([cx - 2 + Math.sin(t * 6 + 1) * 3, cy + t * r * 1.1]);
  }
  stroke(c1, 1.8, bellIn, 0.6);
}

function drawJellyfishField(): void {
  // hero jellyfish near the curling tip
  drawJellyfish(830, 262, 82, true);
  drawJellyfish(690, 335, 58, false);
  drawJellyfish(545, 420, 50, true);
  // scattered field inside the wave, denser near the crest
  let placed = 0;
  let guard = 0;
  const placedPts: Array<[number, number, number]> = [
    [830, 262, 82],
    [690, 335, 58],
    [545, 420, 50],
  ];
  while (placed < 40 && guard < 1400) {
    guard++;
    const x = 20 + rand() * 940;
    const y = 180 + rand() * 540;
    if (!pointInPoly(x, y, WAVE_POLY)) continue;
    // keep clear of the tube shadow centre so bells stay readable
    if (x > 640 && x < 940 && y > 330 && y < 470 && rand() < 0.6) continue;
    const nearCrest = y < 420;
    const r = nearCrest ? 15 + rand() * 28 : 10 + rand() * 20;
    // minimum spacing so domes do not pile into a blob
    let crowded = false;
    for (const [px, py, pr] of placedPts) {
      if (Math.hypot(x - px, y - py) < r + pr * 0.55 + 14) {
        crowded = true;
        break;
      }
    }
    if (crowded) continue;
    drawJellyfish(x, y, r, rand() < 0.3);
    placedPts.push([x, y, r]);
    placed++;
  }
  // tiny buds
  for (let i = 0; i < 60; i++) {
    const x = 20 + rand() * 940;
    const y = 180 + rand() * 520;
    if (!pointInPoly(x, y, WAVE_POLY)) continue;
    softDisc(x, y, 2 + rand() * 4, rand() < 0.5 ? CYAN : GOLD, 0.35 + rand() * 0.4);
  }
  // bioluminescent speckles
  for (let i = 0; i < 420; i++) {
    const x = 10 + rand() * 980;
    const y = 170 + rand() * 540;
    if (!pointInPoly(x, y, WAVE_POLY)) continue;
    softDisc(x, y, 0.8 + rand() * 1.6, rand() < 0.65 ? CYAN : GOLD, 0.3 + rand() * 0.5);
  }
}

function drawLighthouse(): void {
  // rock
  const rock: Array<[number, number]> = [
    [818, 782],
    [845, 742],
    [872, 730],
    [905, 738],
    [928, 770],
    [940, 800],
    [812, 800],
  ];
  fillPoly(rock, () => [[14, 20, 34], 1]);
  stroke(
    [
      [818, 782],
      [845, 742],
      [872, 730],
      [905, 738],
      [928, 770],
    ],
    2,
    [60, 90, 120],
    0.6,
  );
  // light beam toward the wave crest (drawn behind the tower top)
  const beam: Array<[number, number]> = [
    [880, 636],
    [610, 415],
    [580, 475],
    [880, 660],
  ];
  fillPoly(beam, (x, y) => {
    const t = clamp((880 - x) / 300, 0, 1);
    return [[255, 215, 130], 0.13 * (1 - t * 0.5)];
  });
  // tower (tapered)
  const tower: Array<[number, number]> = [
    [868, 748],
    [873, 648],
    [887, 648],
    [892, 748],
  ];
  fillPoly(tower, () => [[238, 240, 245], 1]);
  // red bands
  fillPoly(
    [
      [870, 700],
      [890, 700],
      [891, 716],
      [869, 716],
    ],
    () => [[190, 55, 55], 1],
  );
  fillPoly(
    [
      [872, 664],
      [888, 664],
      [889, 676],
      [871, 676],
    ],
    () => [[190, 55, 55], 1],
  );
  // lamp room + glow
  softDisc(880, 636, 46, GOLD, 0.35);
  softDisc(880, 636, 18, [255, 240, 190], 0.8);
  fillPoly(
    [
      [871, 648],
      [871, 626],
      [889, 626],
      [889, 648],
    ],
    () => [[40, 34, 26], 1],
  );
  gradDisc(880, 636, 9, [255, 250, 220], [255, 190, 90], 1);
  // tiny window dots
  put(880, 688, 255, 210, 120, 0.9);
  put(880, 728, 255, 210, 120, 0.9);
  // gold reflection on the water below the rock
  for (let i = 0; i < 12; i++) {
    const y = 800 + i * 16 + rand() * 8;
    const wdt = 18 + rand() * 60;
    stroke(
      [
        [880 - wdt / 2, y],
        [880 + wdt / 2, y],
      ],
      2,
      GOLD,
      0.12 + rand() * 0.1,
    );
  }
}

function vignette(): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      const dy = (y - H / 2) / (H / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const f = d > 0.75 ? 1 - (d - 0.75) * 0.55 : 1;
      if (f < 1) {
        const i = (y * W + x) * 4;
        img[i] = Math.round(img[i] * f);
        img[i + 1] = Math.round(img[i + 1] * f);
        img[i + 2] = Math.round(img[i + 2] * f);
      }
    }
  }
}

// ---------------- main ----------------
function main(): void {
  drawSky();
  drawSea();
  drawWave();
  drawJellyfishField();
  drawLighthouse();
  vignette();
  const png = encodePNG(img, W, H);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
}

main();
