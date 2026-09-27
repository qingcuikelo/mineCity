/**
 * The whole game renders against this 32 colour palette (DOS/PC98 flavoured).
 * Colours are grouped into ramps; quantisation walks the ramp by luminance and
 * uses 4x4 ordered (Bayer) dithering between adjacent ramp entries, which gives
 * the classic dithered gradient bands of the era.
 */

export const PALETTE = [
  // greys / ink (0-7)
  [5, 7, 10], [26, 31, 38], [49, 58, 68], [75, 87, 102],
  [106, 118, 134], [141, 153, 166], [180, 190, 200], [221, 228, 234],
  // warm / earth (8-13)
  [43, 29, 18], [70, 48, 29], [106, 74, 44], [147, 108, 66],
  [189, 152, 104], [227, 201, 154],
  // brick / red (14-17)
  [61, 18, 12], [115, 31, 18], [168, 58, 32], [209, 106, 68],
  // amber / gold (18-21)
  [74, 46, 5], [138, 92, 14], [201, 154, 30], [242, 214, 90],
  // green (22-26)
  [20, 42, 16], [39, 70, 26], [63, 107, 36], [95, 147, 52], [139, 186, 80],
  // teal / water (27-31)
  [11, 31, 43], [22, 64, 79], [42, 110, 130], [79, 164, 180], [138, 212, 220],
];

export const RAMPS = [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [8, 9, 10, 11, 12, 13],
  [14, 15, 16, 17],
  [18, 19, 20, 21],
  [22, 23, 24, 25, 26],
  [27, 28, 29, 30, 31],
];

export const C = {
  ink: 0, nearBlack: 1, grey2: 2, grey3: 3, grey4: 4, grey5: 5, grey6: 6, paper: 7,
  soilDark: 8, soil: 9, wood: 10, woodLight: 11, tan: 12, sand: 13,
  maroon: 14, brickDark: 15, brick: 16, brickLight: 17,
  amberDark: 18, amber: 19, gold: 20, goldBright: 21,
  greenDark: 22, green1: 23, green2: 24, green3: 25, green4: 26,
  tealDark: 27, teal1: 28, teal2: 29, teal3: 30, cyan: 31,
};

const RAMP_OF = new Int8Array(PALETTE.length).fill(0);
RAMPS.forEach((ramp, ri) => ramp.forEach((ci) => { RAMP_OF[ci] = ri; }));

const LUM = PALETTE.map(([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b);

export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Nearest palette index (weighted RGB distance). */
export function nearest(r, g, b) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const p = PALETTE[i];
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

const nearestCache = new Map();

function nearestCached(r, g, b) {
  const cr = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  const cg = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  const cb = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  const key = (cr << 16) | (cg << 8) | cb;
  let v = nearestCache.get(key);
  if (v === undefined) {
    v = nearest(cr, cg, cb);
    nearestCache.set(key, v);
  }
  return v;
}

/** Quantise a continuous colour to a palette index using ramp-aware ordered dithering. */
export function quantize(r, g, b, x, y, crisp = false) {
  const near = nearestCached(r, g, b);
  if (crisp) return near;
  const ramp = RAMPS[RAMP_OF[near]];
  if (ramp.length === 1) return near;
  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  let k = 0;
  while (k < ramp.length - 2 && LUM[ramp[k + 1]] < L) k++;
  const i0 = ramp[k];
  const i1 = ramp[k + 1];
  const l0 = LUM[i0];
  const l1 = LUM[i1];
  const t = l1 === l0 ? 0 : (L - l0) / (l1 - l0);
  const threshold = (BAYER4[y & 3][x & 3] + 0.5) / 16;
  return threshold < t ? i1 : i0;
}

export function hexOf(index) {
  const [r, g, b] = PALETTE[index];
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Quantise a float rgb triplet to a palette lut (for previewing). */
export function rgbOf(index) {
  return PALETTE[index];
}
