/**
 * Procedural material library for the pre-render pipeline.
 *
 * Materials receive (P, n, ctx): P = world point in plan pixels, n = face
 * normal, ctx = { night, seed, scale }. They return continuous RGB
 * ([r, g, b]) or [r, g, b, alpha|'e'] where 'e' marks an emissive colour that
 * ignores shading/night, and a numeric 4th slot is a dithered alpha.
 * A `.crisp` property on the array disables ordered dithering.
 */

import { PALETTE, C } from '../palette.js';

export const col = (i) => PALETTE[i].slice();

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

export function jitter(a, k) { return [a[0] + k, a[1] + k, a[2] + k]; }

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Noise attached to a surface (uses the two axes that vary across the face). */
function surfHash(P, n, seed, scale = 1) {
  const an = Math.abs(n[0]) > Math.abs(n[1]) ? 0 : 1;
  const u = an === 0 ? P[1] : P[0];
  const v = P[2];
  if (n[2] > 0.5) return hash2((P[0] / scale) | 0, (P[1] / scale) | 0, seed);
  return hash2((u / scale) | 0, (v / scale) | 0, seed);
}

export function flat(color, flags) {
  return () => (flags ? Object.assign(color.slice(), flags) : color.slice());
}

/** Simple wall with grain and optional horizontal courses / siding lines. */
export function wall(base, opts = {}) {
  const {
    alt = null, noise = 0.16, style = 'panel', seed = 1,
    course = 4, dirt = 0.0, jointLight = 1.1, jointDark = 0.86,
  } = opts;
  const b = base;
  const a = alt || mix(base, [0, 0, 0], 0.16);
  return (P, n, ctx) => {
    if (n[2] > 0.5) return b.slice();
    const v = P[2];
    let t = (surfHash(P, n, seed, 1) - 0.5) * noise + 0.5;
    if (style === 'brick') {
      const u = Math.abs(n[0]) > 0.5 ? P[1] : P[0];
      const courseIdx = Math.floor(v / course);
      const off = (courseIdx % 2) * 4;
      const brickIdx = Math.floor((u + off) / 8);
      t += (hash2(brickIdx, courseIdx, seed + 7) - 0.5) * 0.45;
      if ((v % course) < 1) return mul(mix(a, b, clamp01(t + 0.15)), jointDark);
      if (((u + off) % 8) < 1) return mul(mix(a, b, clamp01(t + 0.2)), jointDark * 1.06);
    } else if (style === 'siding') {
      if ((v % course) < 1) return mul(b, jointDark);
    } else {
      const u = Math.abs(n[0]) > 0.5 ? P[1] : P[0];
      if ((v % 16) < 1 || (u % 16) < 1) return mul(b, jointDark);
    }
    let c = mix(a, b, clamp01(t));
    if (dirt > 0) {
      const g = clamp01(1 - v / 40);
      c = mix(c, mix(c, [0, 0, 0], 0.35), dirt * g);
    }
    return c;
  };
}

/**
 * Facade with a window grid. Works on the four vertical face orientations.
 */
export function facade(opts = {}) {
  const {
    base = col(C.woodLight), alt = null, noise = 0.14, style = 'panel', seed = 1, dirt = 0,
    floorH = 16, pitch = 16, winW = 9, winH = 9, winOX = 3, winOY = 4,
    glassTop = col(C.cyan), glassMid = col(C.teal3), glassBot = col(C.teal1),
    frame = col(C.grey3), sill = col(C.grey5),
    lit = 0.55, litSeed = 3, litBrightProb = 0.4,
    litColors = [col(C.goldBright), col(C.amber), col(C.amberDark)],
    storefront = false, signBand = null,
  } = opts;

  const wallMat = wall(base, { alt, noise, style, seed, dirt });

  return (P, n, ctx) => {
    if (n[2] > 0.5) return base.slice();
    const u = Math.abs(n[0]) > 0.5 ? P[1] : P[0];
    const v = P[2];
    const cu = Math.floor(u / pitch);
    const cv = Math.floor(v / floorH);
    const lu = u - cu * pitch;
    const lv = v - cv * floorH;

    const isGround = cv === 0;
    let wx0 = winOX, wx1 = winOX + winW, wy0 = floorH - winOY - winH, wy1 = floorH - winOY;
    if (storefront && isGround) {
      wx0 = 2; wx1 = pitch - 2; wy0 = 2; wy1 = floorH - 3;
    }

    if (signBand && isGround && lv >= floorH - winOY - winH - 5 && lv < floorH - winOY - winH - 1) {
      return signBand(P, n, ctx);
    }
    if (lu >= wx0 && lu < wx1 && lv >= wy0 && lv < wy1) {
      const edge = lu === wx0 || lu === wx1 - 1 || lv === wy0 || lv === wy1 - 1;
      if (edge) return frame.slice();
      if (ctx.night) {
        const r = hash2(cu * 7 + 1, cv * 13 + 3, litSeed);
        if (r < lit * litBrightProb) return Object.assign(litColors[0].slice(), { 3: 'e' });
        if (r < lit) return Object.assign(litColors[1].slice(), { 3: 'e' });
        return [14, 18, 26];
      }
      const t = (lv - wy0) / winH;
      let g = t < 0.45 ? mix(glassTop, glassMid, t / 0.45) : mix(glassMid, glassBot, (t - 0.45) / 0.55);
      const sp = hash2(cu * 31 + lv, cv * 17 + lu, seed + 5);
      if (sp > 0.93) g = mix(g, [255, 255, 255], 0.55);
      else if (sp < 0.08) g = mul(g, 0.8);
      return g;
    }
    if (lv === wy0 - 1) return sill.slice();
    if (lv < 1) return mul(wallMat(P, n, ctx), 0.88);
    const w = wallMat(P, n, ctx);
    if (signBand && isGround && lv >= floorH - winOY - winH - 5 && lv < floorH - winOY - winH - 1) return w;
    return w;
  };
}

/** Gable / shed roof tiles: shaded bands following height + noise, ridge highlight. */
export function roofTiles(base, opts = {}) {
  const { alt = null, ridge = null, seed = 2, band = 4, noise = 0.3 } = opts;
  const a = alt || mul(base, 0.72);
  const r = ridge || mix(base, [255, 255, 255], 0.28);
  return (P, n, ctx) => {
    const t = hash2((P[0] / 2) | 0, ((P[1] + P[2] * 3) / 2) | 0, seed);
    let c = mix(a, base, clamp01(0.5 + t * noise - 0.15));
    if (((P[2] / band) | 0) % 2 === 0) c = mul(c, 0.92);
    if (n[2] < 0.2) c = mix(c, r, 0.35);
    return c;
  };
}

/** Flat roof: gravel / membrane with vents left to geometry. */
export function roofFlat(base = col(C.grey4), opts = {}) {
  const { seed = 4, noise = 0.35 } = opts;
  const a = mul(base, 0.8);
  return (P, n, ctx) => {
    const t = hash2((P[0] / 2) | 0, (P[1] / 2) | 0, seed);
    let c = mix(a, base, clamp01(t * noise + 0.3));
    const cx = ((P[0] - 16) % 32), cy = ((P[1] - 16) % 32);
    if (cx < 1 && cy > 6 && cy < 26) c = mul(c, 0.86);
    if (cy < 1 && cx > 6 && cx < 26) c = mul(c, 0.86);
    return c;
  };
}

/** Corrugated metal / ribbed cladding. */
export function metalRib(base, opts = {}) {
  const { rib = 4, seed = 8, dark = 0.82, light = 1.12 } = opts;
  return (P, n, ctx) => {
    if (n[2] > 0.5) {
      const t = hash2((P[0] / 3) | 0, (P[1] / 3) | 0, seed);
      return mul(base, 0.9 + t * 0.2);
    }
    const u = Math.abs(n[0]) > 0.5 ? P[1] : P[0];
    const k = ((u % rib) < rib / 2) ? light : dark;
    const g = hash2((u / 2) | 0, (P[2] / 6) | 0, seed) * 0.12 + 0.94;
    return mul(base, k * g);
  };
}

/** Striped awning, stripes run across `u`. */
export function awning(c1, c2, { stripe = 6 } = {}) {
  return (P, n, ctx) => {
    const u = Math.abs(n[0]) > 0.5 ? P[1] : P[0];
    const c = ((u / stripe) | 0) % 2 === 0 ? c1 : c2;
    return c.slice();
  };
}

/** Shop sign plate with fake lettering bars. */
export function signPlate(bg, fg, opts = {}) {
  const { seed = 6, text = true } = opts;
  return (P, n, ctx) => {
    if (!text) return bg.slice();
    const u = Math.abs(n[0]) > 0.5 ? P[1] : P[0];
    const v = P[2];
    const c = ((u / 3) | 0);
    const row = ((v - 2) / 3) | 0;
    if (row >= 0 && row < 2) {
      const on = hash2(c, row, seed) > 0.35;
      if (on) return fg.slice();
    }
    return bg.slice();
  };
}

/** Pavement / plaza slabs with joints. */
export function pavement(base = col(C.grey5), opts = {}) {
  const { joint = 16, seed = 9, noise = 0.22 } = opts;
  const a = mul(base, 0.78);
  return (P, n, ctx) => {
    const t = hash2((P[0] / 2) | 0, (P[1] / 2) | 0, seed);
    let c = mix(a, base, clamp01(t * noise + 0.35));
    const cx = P[0] % joint, cy = P[1] % joint;
    if (cx < 1 || cy < 1) c = mul(c, 0.85);
    if (ctx.night) c = mul(c, 0.86);
    return c;
  };
}

/** Ground / grass / dirt surfaces (top faces only). */
export function ground(base, opts = {}) {
  const { alt = null, seed = 3, noise = 0.3, tufts = false, night = [0.86, 0.89, 1.0] } = opts;
  const a = alt || mul(base, 0.84);
  return (P, n, ctx) => {
    const t = hash2((P[0] / 2) | 0, (P[1] / 2) | 0, seed);
    let c = mix(a, base, clamp01(t * noise + 0.4));
    if (tufts) {
      const t2 = hash2((P[0] / 5) | 0, (P[1] / 5) | 0, seed + 11);
      if (t2 > 0.9) c = mix(c, mul(base, 1.18), 0.6);
    }
    if (ctx.night) c = [c[0] * night[0], c[1] * night[1], c[2] * night[2]];
    return c;
  };
}

/** Animated water surface; pattern depends on frame + variant. */
export function water(frame = 0, variant = 0, opts = {}) {
  const { night = [0.88, 0.91, 1.0] } = opts;
  const deep = col(C.teal1);
  const mid = col(C.teal2);
  const lit = col(C.teal3);
  const glint = col(C.cyan);
  return (P, n, ctx) => {
    const u = P[0] + frame * 10 + variant * 37;
    const v = P[1];
    const w = Math.sin((u * 0.08) + Math.sin(v * 0.05) * 1.7) * 0.5 + 0.5;
    const q = Math.sin((u * 0.03 - v * 0.07) + frame * 1.3) * 0.5 + 0.5;
    let c = mix(deep, mid, clamp01(w * 0.8 + 0.1));
    c = mix(c, lit, clamp01(q * 0.5));
    const sp = hash2((u / 3) | 0, (v / 3) | 0, 21);
    if (sp > 0.965) c = mix(c, glint, 0.85);
    if (ctx.night) c = [c[0] * night[0], c[1] * night[1], c[2] * night[2]];
    return c;
  };
}

/** Rock strata for cliffs. */
export function rock(base = col(C.wood), opts = {}) {
  const { seed = 14, strata = 6 } = opts;
  const a = mul(base, 0.7);
  return (P, n, ctx) => {
    const v = P[2];
    const t = hash2((P[0] / 2) | 0, (P[1] / 2) | 0, seed + ((v / strata) | 0));
    let c = mix(a, base, clamp01(t * 0.6 + 0.25));
    if ((v % strata) < 1) c = mul(c, 0.8);
    if (ctx.night) c = [c[0] * 0.88, c[1] * 0.9, c[2] * 1.0];
    return c;
  };
}

/** Foliage blob canopy. */
export function foliage(base = col(C.green2), opts = {}) {
  const { seed = 17, noise = 0.6, highlight = 1.3 } = opts;
  const a = mul(base, 0.55);
  const b = mul(base, 1.15);
  return (P, n, ctx) => {
    const t = hash2((P[0] / 2) | 0, (P[1] * 0.4 + P[2] * 0.8 / 2) | 0, seed);
    let c = mix(a, base, clamp01(t * noise + 0.2));
    const t2 = hash2((P[0] / 4) | 0, (P[2] / 3) | 0, seed + 3);
    if (t2 > 0.8) c = mix(c, mul(base, highlight), 0.5);
    if (ctx.night) c = [c[0] * 0.84, c[1] * 0.88, c[2] * 1.0];
    return c;
  };
}

export function bark(base = col(C.wood)) {
  const a = mul(base, 0.72);
  return (P, n, ctx) => {
    const t = hash2((P[0] / 2) | 0, (P[2] / 3) | 0, 33);
    let c = mix(a, base, t);
    if (ctx.night) c = [c[0] * 0.86, c[1] * 0.88, c[2] * 1.0];
    return c;
  };
}

/** Emissive glow (night lamps, neon). */
export function emissive(color, opts = {}) {
  return () => Object.assign(color.slice(), { 3: 'e' });
}

/** Lamp head that is dark by day, emissive by night. */
export function lampHead(dayColor, nightColor) {
  return (P, n, ctx) => (ctx.night ? Object.assign(nightColor.slice(), { 3: 'e' }) : dayColor.slice());
}
