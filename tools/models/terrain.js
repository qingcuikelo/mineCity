/**
 * Terrain sprites: every land surface is rendered once per height level (1..6)
 * as a complete "tile column" (top diamond + both visible cliff walls down to
 * z=0). Water is flat at z=0 with 4 animation frames x 3 variants.
 */

import { Mesh } from '../raster.js';
import { C } from '../palette.js';
import * as M from './materials.js';

export const MAX_H = 6;
const Z = 16;

const cliffBase = M.rock(M.col(C.wood), { seed: 401 });

function cliffWall(soil, zTop) {
  return (P, n, ctx) => {
    const c = cliffBase(P, n, ctx);
    if (P[2] > zTop - 5) {
      const s = soil(P, n, ctx);
      return [s[0] * 0.9, s[1] * 0.9, s[2] * 0.9];
    }
    const g = Math.min(1, P[2] / 10);
    const k = 0.62 + 0.38 * g;
    return [c[0] * k, c[1] * k, c[2] * k];
  };
}

export const SURFACES = [
  {
    id: 'grass',
    variants: 3,
    label: '草地',
    top: (v) => M.ground(M.col(C.green3), { alt: M.col(C.green2), seed: 410 + v, noise: 0.3, tufts: true }),
  },
  {
    id: 'sand',
    variants: 1,
    label: '沙地',
    top: (v) => M.ground(M.col(C.sand), { alt: M.col(C.tan), seed: 420 + v, noise: 0.4 }),
  },
  {
    id: 'rock',
    variants: 1,
    label: '岩石',
    top: (v) => M.ground(M.col(C.grey4), { alt: M.col(C.grey3), seed: 430 + v, noise: 0.55 }),
  },
  {
    id: 'dirt',
    variants: 1,
    label: '泥地',
    top: (v) => M.ground(M.col(C.wood), { alt: M.col(C.soil), seed: 440 + v, noise: 0.55 }),
  },
];

/** Build the tile column mesh for a land surface at height h. */
export function buildLandTile(surfaceId, variant, h) {
  const surf = SURFACES.find((s) => s.id === surfaceId);
  const topMat = surf.top(variant);
  const z = h * Z;
  const wallMat = cliffWall(topMat, z);
  const m = new Mesh();
  m.flatPoly([[0, 0], [64, 0], [64, 64], [0, 64]], z, topMat);
  m.quad(m.v(64, 0, 0), m.v(64, 64, 0), m.v(64, 64, z), m.v(64, 0, z), wallMat);
  m.quad(m.v(64, 64, 0), m.v(0, 64, 0), m.v(0, 64, z), m.v(64, 64, z), wallMat);
  return m;
}

/** Water tile mesh (flat, z=0). */
export function buildWaterTile(frame, variant) {
  const m = new Mesh();
  m.flatPoly([[0, 0], [64, 0], [64, 64], [0, 64]], 0, M.water(frame, variant));
  return m;
}

/** Zone designation overlays: translucent checker pattern over a tile. */
export const ZONE_COLORS = {
  r: [C.green3, C.green4],
  c: [C.teal3, C.cyan],
  i: [C.amber, C.gold],
};

export function buildZoneOverlay(zone) {
  const [a, b] = ZONE_COLORS[zone];
  const m = new Mesh();
  const ca = M.col(a);
  const cb = M.col(b);
  const mat = (P) => {
    const d = ((P[0] / 3) | 0) + ((P[1] / 3) | 0);
    return [d % 2 === 0 ? ca[0] : cb[0], d % 2 === 0 ? ca[1] : cb[1], d % 2 === 0 ? ca[2] : cb[2], 110];
  };
  m.flatPoly([[1, 1], [63, 1], [63, 63], [1, 63]], 0, mat);
  // diamond outline for readability
  const edge = M.flat(M.mul(cb, 0.8), { crisp: true });
  const w = 2;
  m.flatPoly([[0, 0], [64, 0], [64 - w, w], [w, w]], 0.2, edge);
  m.flatPoly([[64 - w, w], [64, 0], [64, 64], [64 - w, 64 - w]], 0.2, edge);
  m.flatPoly([[64, 64], [0, 64], [w, 64 - w], [64 - w, 64 - w]], 0.2, edge);
  m.flatPoly([[w, w], [w, 64 - w], [0, 64], [0, 0]], 0.2, edge);
  return m;
}

/** "No road access" marker: a red X in screen space (two plan-space bars). */
export function buildNoRoad() {
  const m = new Mesh();
  const red = M.flat(M.col(C.brickLight), { crisp: true });
  const red2 = M.flat(M.col(C.brick), { crisp: true });
  m.flatPoly([[4, 24], [60, 24], [60, 40], [4, 40]], 0.6, red);
  m.flatPoly([[24, 4], [40, 4], [40, 60], [24, 60]], 0.6, red2);
  return m;
}
