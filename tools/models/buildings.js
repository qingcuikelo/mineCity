/**
 * Parametric building models for the offline renderer. All coordinates are in
 * tile-local plan pixels: a 1x1 model occupies [0..64] x [0..64]; buildings are
 * inset from the tile edge so lots / sidewalks stay visible.
 *
 * Every model is a `build(m)` function that fills a Mesh. The pipeline renders
 * 4 rotations x day/night per model.
 */

import { Mesh } from '../raster.js';
import { C } from '../palette.js';
import * as M from './materials.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const c = (i) => M.col(i);

/* ------------------------------------------------------------------ */
/* shared materials                                                    */
/* ------------------------------------------------------------------ */

const MAT = {
  lot: M.ground(c(C.tan), { alt: c(C.wood), seed: 41, noise: 0.4 }),
  dirt: M.ground(c(C.wood), { alt: c(C.soil), seed: 42, noise: 0.55 }),
  pavement: M.pavement(c(C.grey5), { joint: 16, seed: 43 }),
  concrete: M.wall(c(C.grey5), { alt: c(C.grey4), style: 'panel', noise: 0.14, seed: 44 }),
  concreteDark: M.wall(c(C.grey4), { alt: c(C.grey3), style: 'panel', noise: 0.14, seed: 45 }),
  cream: M.wall(M.mix(c(C.grey6), c(C.tan), 0.5), { alt: c(C.grey5), style: 'siding', noise: 0.16, seed: 46 }),
  white: M.wall(c(C.paper), { alt: c(C.grey6), style: 'panel', noise: 0.1, seed: 47 }),
  brick: M.wall(c(C.brick), { alt: c(C.brickDark), style: 'brick', noise: 0.2, seed: 48 }),
  brickLight: M.wall(M.mix(c(C.brickLight), c(C.brick), 0.4), { alt: c(C.brick), style: 'brick', noise: 0.2, seed: 49 }),
  woodWall: M.wall(M.mix(c(C.woodLight), c(C.tan), 0.5), { alt: c(C.wood), style: 'siding', course: 4, noise: 0.2, seed: 50 }),
  metal: M.metalRib(c(C.grey5), { seed: 51 }),
  metalDark: M.metalRib(c(C.grey4), { seed: 52 }),
  tealRoof: M.roofTiles(c(C.teal2), { alt: c(C.teal1), seed: 53 }),
  brickRoof: M.roofTiles(c(C.brick), { alt: c(C.brickDark), ridge: c(C.brickLight), seed: 54 }),
  greyRoof: M.roofTiles(c(C.grey4), { alt: c(C.grey3), seed: 55 }),
  metalRoof: M.roofTiles(c(C.grey5), { alt: c(C.grey4), seed: 56 }),
  flatRoof: M.roofFlat(c(C.grey4), { seed: 57 }),
  flatRoofDark: M.roofFlat(c(C.grey3), { seed: 58 }),
  glassWall: (seed) => M.facade({
    base: c(C.grey4), alt: c(C.grey3), style: 'panel', noise: 0.1, seed,
    floorH: 16, pitch: 12, winW: 9, winH: 9, winOX: 2, winOY: 4,
    glassTop: c(C.cyan), glassMid: c(C.teal3), glassBot: c(C.teal1),
  }),
  darkPipe: M.flat(c(C.grey2)),
  darkTrim: M.flat(c(C.grey2)),
  gold: M.flat(c(C.gold)),
  amberGlow: M.emissive(c(C.goldBright)),
  lamp: M.lampHead(c(C.grey5), c(C.goldBright)),
};

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/** A quad glued to the outside of a wall face. face: 'xp'|'xn'|'yp'|'yn'. */
function wallQuad(m, face, fixed, u0, u1, z0, z1, mat, off = 0.6) {
  switch (face) {
    case 'xp':
      m.quad(m.v(fixed + off, u0, z0), m.v(fixed + off, u1, z0), m.v(fixed + off, u1, z1), m.v(fixed + off, u0, z1), mat);
      break;
    case 'xn':
      m.quad(m.v(fixed - off, u1, z0), m.v(fixed - off, u0, z0), m.v(fixed - off, u0, z1), m.v(fixed - off, u1, z1), mat);
      break;
    case 'yp':
      m.quad(m.v(u1, fixed + off, z0), m.v(u0, fixed + off, z0), m.v(u0, fixed + off, z1), m.v(u1, fixed + off, z1), mat);
      break;
    case 'yn':
      m.quad(m.v(u0, fixed - off, z0), m.v(u1, fixed - off, z0), m.v(u1, fixed - off, z1), m.v(u0, fixed - off, z1), mat);
      break;
  }
}

/** Parapet rim around a roof edge. */
function parapet(m, x0, y0, x1, y1, z, h, mat, w = 3) {
  m.box(x0, y0, z, x1, y0 + w, z + h, mat);
  m.box(x0, y1 - w, z, x1, y1, z + h, mat);
  m.box(x0, y0 + w, z, x0 + w, y1 - w, z + h, mat);
  m.box(x1 - w, y0 + w, z, x1, y1 - w, z + h, mat);
}

/** Rooftop clutter: AC units, vents, stair bulkhead, water tank. */
function rooftop(m, x0, y0, x1, y1, z, rng, opts = {}) {
  const { hvac = 2, tank = false, bulkhead = true, antenna = false, seedMats = MAT } = opts;
  if (bulkhead) {
    const bw = Math.min(26, (x1 - x0) * 0.35);
    const bx = x0 + 6, by = y0 + 6;
    m.box(bx, by, z, bx + bw, by + bw * 0.8, z + 10, {
      top: seedMats.flatRoofDark, xp: seedMats.concreteDark, xn: seedMats.concreteDark,
      yp: seedMats.concrete, yn: seedMats.concreteDark,
    });
  }
  for (let i = 0; i < hvac; i++) {
    const w = 10 + rng() * 8, d = 8 + rng() * 6, h = 4 + rng() * 4;
    const px = x0 + 8 + rng() * Math.max(1, x1 - x0 - 24);
    const py = y0 + 8 + rng() * Math.max(1, y1 - y0 - 26);
    m.box(px, py, z, px + w, py + d, z + h, { top: seedMats.metal, all: seedMats.metalDark });
  }
  if (tank) {
    const cx = x0 + (x1 - x0) * 0.62, cy = y0 + (y1 - y0) * 0.55;
    m.cylinder(cx, cy, z, z + 12, 9, 10, { side: seedMats.metal, top: seedMats.metalDark });
    m.box(cx - 1, cy - 1, z, cx + 1, cy + 1, z + 3, seedMats.darkPipe);
  }
  if (antenna) {
    const cx = x0 + (x1 - x0) * 0.7, cy = y0 + (y1 - y0) * 0.3;
    m.box(cx, cy, z, cx + 2, cy + 2, z + 22, seedMats.darkPipe);
    m.box(cx - 5, cy, z + 17, cx + 7, cy + 1, z + 18, seedMats.darkPipe);
  }
}

/** Rows of balconies on one face. u0/u1 are along the face axis. */
function balconies(m, face, fixed, u0, u1, floors, matSlab, matRail) {
  for (let f = 1; f < floors; f++) {
    const z = f * 16;
    const inner = face === 'xp' || face === 'xn';
    const depth = 7;
    if (face === 'xp') {
      m.box(fixed, u0, z, fixed + depth, u1, z + 2, matSlab);
      m.box(fixed + depth - 2, u0, z + 2, fixed + depth, u1, z + 9, matRail);
    } else if (face === 'xn') {
      m.box(fixed - depth, u0, z, fixed, u1, z + 2, matSlab);
      m.box(fixed - depth, u0, z + 2, fixed - depth + 2, u1, z + 9, matRail);
    } else if (face === 'yp') {
      m.box(u0, fixed, z, u1, fixed + depth, z + 2, matSlab);
      m.box(u0, fixed + depth - 2, z + 2, u1, fixed + depth, z + 9, matRail);
    } else {
      m.box(u0, fixed - depth, z, u1, fixed, z + 2, matSlab);
      m.box(u0, fixed - depth, z + 2, u1, fixed - depth + 2, z + 9, matRail);
    }
    void inner;
  }
}

function plinth(m, x0, y0, x1, y1, h = 2, mat = MAT.concrete) {
  m.box(x0 - 2, y0 - 2, 0, x1 + 2, y1 + 2, h, { top: mat, all: mat });
}

/* ------------------------------------------------------------------ */
/* models                                                              */
/* ------------------------------------------------------------------ */

export const BUILDINGS = [
  /* ---------------- residential ---------------- */
  {
    name: 'r_house_a', cls: 'r', tier: 1, fx: 1, fy: 1, label: '小屋',
    build(m) {
      const x0 = 8, y0 = 8, x1 = 56, y1 = 56, z = 28;
      m.flatPoly([[0, 0], [64, 0], [64, 64], [0, 64]], 0, MAT.lot);
      const facadeWall = M.facade({
        base: M.mix(c(C.woodLight), c(C.tan), 0.45), alt: c(C.wood), style: 'siding', noise: 0.18, seed: 101,
        floorH: 14, pitch: 14, winW: 8, winH: 8, winOX: 3, winOY: 3,
        frame: c(C.paper), sill: c(C.wood), lit: 0.7, litSeed: 11,
      });
      m.box(x0, y0, 0, x1, y1, z, { top: null, xp: facadeWall, xn: facadeWall, yp: facadeWall, yn: facadeWall });
      m.gable(x0 - 2, y0 - 2, z, x1 + 2, y1 + 2, z + 14, 'x', { roof: MAT.brickRoof, end: MAT.woodWall });
      m.box(12, 44, 0, 20, 56, z + 2, MAT.brick);
      m.box(40, 12, z - 2, 50, 22, z + 20, MAT.brick);
      m.box(40, 12, z + 20, 50, 22, z + 23, MAT.darkTrim);
      wallQuad(m, 'yp', y1, 24, 40, 0, 20, M.flat([26, 20, 14], { crisp: true }), 0.7);
      wallQuad(m, 'yp', y1, 26, 38, 0, 18, M.flat([58, 40, 24]), 0.9);
      wallQuad(m, 'xp', x1, 20, 30, 14, 22, M.flat([40, 52, 60], { crisp: true }), 0.7);
      m.box(x1 + 2, 8, 0, x1 + 8, 40, 3, MAT.pavement);
      m.box(8, y1 + 2, 0, 40, y1 + 8, 3, MAT.pavement);
    },
  },
  {
    name: 'r_house_b', cls: 'r', tier: 1, fx: 1, fy: 1, label: '平顶住宅',
    build(m) {
      const x0 = 7, y0 = 9, x1 = 57, y1 = 55, z = 32;
      m.flatPoly([[0, 0], [64, 0], [64, 64], [0, 64]], 0, MAT.lot);
      const f = M.facade({
        base: c(C.grey6), alt: c(C.grey5), style: 'panel', noise: 0.12, seed: 102,
        floorH: 16, pitch: 15, winW: 8, winH: 8, winOX: 3, winOY: 4,
        frame: c(C.grey4), lit: 0.6, litSeed: 12,
      });
      m.box(x0, y0, 0, x1, y1, z, { xp: f, xn: f, yp: f, yn: f });
      parapet(m, x0, y0, x1, y1, z, 4, M.wall(c(C.grey5), { alt: c(C.grey4), style: 'panel', seed: 103 }));
      m.box(x0 + 6, y0 + 6, z, x0 + 18, y0 + 16, z + 6, MAT.metalDark);
      m.box(x1 - 14, y1 - 12, z, x1 - 6, y1 - 5, z + 4, MAT.metal);
      wallQuad(m, 'yn', y0, 22, 34, 0, 20, M.flat([24, 22, 20], { crisp: true }), 0.7);
      wallQuad(m, 'yn', y0, 24, 32, 0, 18, M.flat([72, 50, 30]), 0.9);
      m.box(x0 - 6, y0 - 6, 0, x1 - 10, y0 - 1, 5, MAT.woodWall);
      m.box(x0 - 6, y0 - 6, 5, x1 - 10, y0 - 1, 7, MAT.greyRoof);
      m.box(x0, y1 + 2, 0, x1, y1 + 7, 2, MAT.pavement);
    },
  },
  {
    name: 'r_row', cls: 'r', tier: 2, fx: 2, fy: 1, label: '联排住宅',
    build(m) {
      const y0 = 12, y1 = 52;
      m.flatPoly([[0, 0], [128, 0], [128, 64], [0, 64]], 0, MAT.lot);
      const mkf = (seed) => M.facade({
        base: M.mix(c(C.brickLight), c(C.brick), 0.3), alt: c(C.brick), style: 'brick', noise: 0.2, seed,
        floorH: 14, pitch: 13, winW: 7, winH: 8, winOX: 3, winOY: 3,
        frame: c(C.paper), lit: 0.65, litSeed: seed,
      });
      const segs = [
        { x0: 6, x1: 46, z: 26, roof: MAT.brickRoof },
        { x0: 46, x1: 84, z: 30, roof: MAT.tealRoof },
        { x0: 84, x1: 122, z: 26, roof: MAT.brickRoof },
      ];
      segs.forEach((s, i) => {
        const f = mkf(110 + i);
        m.box(s.x0, y0, 0, s.x1, y1, s.z, { xp: f, xn: f, yp: f, yn: f });
        m.gable(s.x0, y0 - 2, s.z, s.x1, y1 + 2, s.z + 12, 'x', { roof: s.roof, end: MAT.brickLight });
      });
      m.box(20, y1 - 12, 26, 30, y1 - 4, 44, MAT.brick);
      m.box(96, y1 - 12, 26, 104, y1 - 4, 42, MAT.brick);
      [14, 42, 70, 98].forEach((dx) => {
        wallQuad(m, 'yp', y1, dx, dx + 9, 0, 18, M.flat([28, 20, 12], { crisp: true }), 0.7);
        m.box(dx + 1, y1 + 1, 0, dx + 8, y1 + 4, 1, MAT.pavement);
      });
      m.box(4, y1 + 4, 0, 124, y1 + 9, 2, MAT.pavement);
    },
  },
  {
    name: 'r_apart_a', cls: 'r', tier: 2, fx: 2, fy: 2, label: '公寓楼',
    build(m) {
      const x0 = 10, y0 = 10, x1 = 118, y1 = 118, floors = 4, z = floors * 16;
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, MAT.lot);
      plinth(m, x0, y0, x1, y1, 2);
      const f = M.facade({
        base: M.mix(c(C.tan), c(C.brickLight), 0.35), alt: c(C.tan), style: 'panel', noise: 0.14, seed: 120,
        floorH: 16, pitch: 16, winW: 9, winH: 9, winOX: 3, winOY: 4,
        frame: c(C.paper), sill: c(C.woodLight), lit: 0.6, litSeed: 21,
      });
      m.box(x0, y0, 0, x1, y1, z, { top: null, xp: f, xn: f, yp: f, yn: f });
      m.box(x0 - 2, y0 - 2, z, x1 + 2, y1 + 2, z + 3, { top: MAT.flatRoof, all: MAT.concrete });
      parapet(m, x0 - 2, y0 - 2, x1 + 2, y1 + 2, z + 3, 3, MAT.cream);
      const slab = M.flat(M.mix(c(C.paper), c(C.grey6), 0.4));
      const rail = M.metalRib(c(C.grey5), { seed: 121 });
      balconies(m, 'yp', y1 + 2, 20, 52, floors, slab, rail);
      balconies(m, 'yp', y1 + 2, 66, 98, floors, slab, rail);
      balconies(m, 'xp', x1 + 2, 20, 52, floors, slab, rail);
      balconies(m, 'xp', x1 + 2, 66, 98, floors, slab, rail);
      rooftop(m, x0, y0, x1, y1, z + 3, mulberry32(122), { hvac: 2, tank: true, bulkhead: true });
      wallQuad(m, 'yp', y1, 56, 72, 0, 22, M.flat([30, 22, 16], { crisp: true }), 0.7);
    },
  },
  {
    name: 'r_apart_b', cls: 'r', tier: 3, fx: 2, fy: 2, label: '高层公寓',
    build(m) {
      const x0 = 12, y0 = 12, x1 = 116, y1 = 116, floors = 6, z = floors * 16;
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, MAT.lot);
      plinth(m, x0, y0, x1, y1, 2);
      const f = M.facade({
        base: M.mix(c(C.grey6), c(C.tan), 0.3), alt: c(C.grey5), style: 'panel', noise: 0.12, seed: 130,
        floorH: 16, pitch: 14, winW: 9, winH: 9, winOX: 2, winOY: 4,
        frame: c(C.grey5), lit: 0.62, litSeed: 31,
      });
      const glassStair = M.facade({
        base: c(C.teal1), alt: c(C.tealDark), style: 'panel', noise: 0.08, seed: 131,
        floorH: 16, pitch: 16, winW: 12, winH: 13, winOX: 2, winOY: 2,
        frame: c(C.teal2), lit: 0.8, litSeed: 32,
      });
      m.box(x0, y0, 0, x1, y1, z, { xp: f, xn: f, yp: f, yn: glassStair });
      m.box(x0 - 2, y0 - 2, z, x1 + 2, y1 + 2, z + 3, { top: MAT.flatRoofDark, all: MAT.concreteDark });
      parapet(m, x0 - 2, y0 - 2, x1 + 2, y1 + 2, z + 3, 3, MAT.cream);
      const slab = M.flat(M.mix(c(C.paper), c(C.grey5), 0.3));
      const rail = M.metalRib(c(C.grey5), { seed: 132 });
      balconies(m, 'yp', y1 + 2, 16, 48, floors, slab, rail);
      balconies(m, 'yp', y1 + 2, 64, 96, floors, slab, rail);
      balconies(m, 'xp', x1 + 2, 16, 48, floors, slab, rail);
      balconies(m, 'xp', x1 + 2, 64, 96, floors, slab, rail);
      rooftop(m, x0, y0, x1, y1, z + 3, mulberry32(133), { hvac: 3, tank: true, bulkhead: true, antenna: true });
      wallQuad(m, 'yp', y1, 52, 68, 0, 24, M.flat([26, 30, 34], { crisp: true }), 0.7);
    },
  },
  {
    name: 'r_tower', cls: 'r', tier: 4, fx: 2, fy: 2, label: '住宅塔楼',
    build(m) {
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, MAT.lot);
      const steps = [
        { i: 14, z0: 0, z1: 96 },
        { i: 26, z0: 96, z1: 144 },
        { i: 38, z0: 144, z1: 176 },
      ];
      const f = M.facade({
        base: M.mix(c(C.grey6), c(C.tan), 0.22), alt: c(C.grey5), style: 'panel', noise: 0.1, seed: 140,
        floorH: 16, pitch: 13, winW: 8, winH: 10, winOX: 2, winOY: 3,
        frame: c(C.grey5), lit: 0.55, litSeed: 41,
      });
      steps.forEach((s, i) => {
        const x0 = s.i, y0 = s.i, x1 = 128 - s.i, y1 = 128 - s.i;
        m.box(x0, y0, s.z0, x1, y1, s.z1, { xp: f, xn: f, yp: f, yn: f });
        if (i > 0) {
          m.box(x0 - 3, y0 - 3, s.z0, x1 + 3, y1 + 3, s.z0 + 3, { top: MAT.flatRoofDark, all: MAT.concreteDark });
        }
      });
      const top = 176;
      m.box(52, 52, top, 76, 76, top + 8, MAT.concreteDark);
      m.box(62, 62, top + 8, 66, 66, top + 46, MAT.darkPipe);
      m.box(58, 63, top + 40, 70, 65, top + 42, MAT.darkPipe);
      m.box(14, 14, 4, 44, 40, 26, MAT.brickLight);
      m.gable(14, 12, 26, 44, 42, 36, 'y', { roof: MAT.tealRoof, end: MAT.brickLight });
    },
  },
  /* ---------------- commercial ---------------- */
  {
    name: 'c_shop_a', cls: 'c', tier: 1, fx: 1, fy: 1, label: '商铺',
    build(m) {
      const x0 = 6, y0 = 8, x1 = 58, y1 = 56, z = 30;
      m.flatPoly([[0, 0], [64, 0], [64, 64], [0, 64]], 0, MAT.pavement);
      const upper = M.facade({
        base: c(C.brick), alt: c(C.brickDark), style: 'brick', noise: 0.18, seed: 150,
        floorH: 16, pitch: 15, winW: 9, winH: 9, winOX: 3, winOY: 4,
        frame: c(C.paper), lit: 0.5, litSeed: 51,
      });
      m.box(x0, y0, 0, x1, y1, z, {
        xp: upper, xn: upper, yn: upper,
        yp: M.facade({
          base: c(C.brick), alt: c(C.brickDark), style: 'brick', noise: 0.18, seed: 151,
          floorH: 16, pitch: 11, winW: 8, winH: 10, winOX: 1, winOY: 3, storefront: true,
          frame: c(C.grey2), lit: 0.85, litBrightProb: 0.7, litSeed: 52,
        }),
      });
      parapet(m, x0, y0, x1, y1, z, 4, MAT.brick);
      m.box(x0 - 4, y1, z - 12, x1 + 4, y1 + 8, z - 9, M.awning(c(C.brickLight, ), c(C.paper), { stripe: 5 }));
      m.box(x0 - 4, y1 + 8, z - 12, x1 + 4, y1 + 9, z - 9, M.flat(c(C.brickDark)));
      wallQuad(m, 'yp', y1, 14, 50, z - 8, z - 1, M.signPlate(c(C.nearBlack), c(C.goldBright), { seed: 53 }), 0.8);
      m.box(x0 + 20, y1 + 9, 0, x0 + 42, y1 + 14, 1, MAT.pavement);
    },
  },
  {
    name: 'c_shop_b', cls: 'c', tier: 2, fx: 1, fy: 1, label: '咖啡馆',
    build(m) {
      const x0 = 8, y0 = 8, x1 = 56, y1 = 56, z = 44;
      m.flatPoly([[0, 0], [64, 0], [64, 64], [0, 64]], 0, MAT.pavement);
      const f = M.facade({
        base: c(C.grey6), alt: c(C.grey5), style: 'panel', noise: 0.1, seed: 160,
        floorH: 15, pitch: 14, winW: 9, winH: 9, winOX: 2, winOY: 3,
        frame: c(C.teal2), lit: 0.55, litSeed: 61,
      });
      const front = M.facade({
        base: c(C.grey6), alt: c(C.grey5), style: 'panel', noise: 0.1, seed: 161,
        floorH: 15, pitch: 14, winW: 9, winH: 9, winOX: 2, winOY: 3, storefront: true,
        frame: c(C.teal2), lit: 0.9, litBrightProb: 0.75, litSeed: 62,
      });
      m.box(x0, y0, 0, x1, y1, z, { xp: f, xn: f, yn: f, yp: front });
      m.box(x0 - 2, y0 - 2, z, x1 + 2, y1 + 2, z + 3, { top: MAT.tealRoof, all: MAT.concrete });
      parapet(m, x0 - 2, y0 - 2, x1 + 2, y1 + 2, z + 3, 3, M.wall(c(C.teal2), { alt: c(C.teal1), seed: 163 }));
      m.box(x0 - 5, y1 + 1, z - 10, x1 + 5, y1 + 7, z - 7, M.awning(c(C.teal2), c(C.paper), { stripe: 6 }));
      wallQuad(m, 'yp', y1, 16, 48, z - 14, z - 11, M.signPlate(c(C.grey2), c(C.goldBright), { seed: 63 }), 0.8);
      m.box(x0, y1 + 7, 0, x1, y1 + 12, 1, MAT.pavement);
      m.box(x0 + 4, y1 + 8, 1, x0 + 12, y1 + 12, 4, MAT.woodWall);
      m.box(x1 - 12, y1 + 8, 1, x1 - 4, y1 + 12, 4, MAT.woodWall);
    },
  },
  {
    name: 'c_office_a', cls: 'c', tier: 2, fx: 2, fy: 2, label: '写字楼',
    build(m) {
      const x0 = 12, y0 = 12, x1 = 116, y1 = 116, floors = 5, z = floors * 16;
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, MAT.pavement);
      plinth(m, x0, y0, x1, y1, 2, MAT.pavement);
      const fbase = {
        floorH: 16, pitch: 12, winW: 9, winH: 10, winOX: 2, winOY: 3, lit: 0.5, litBrightProb: 0.3,
      };
      const f = M.facade({
        ...fbase, base: c(C.grey4), alt: c(C.grey3), style: 'panel', noise: 0.08, seed: 170,
        glassTop: c(C.cyan), glassMid: c(C.teal3), glassBot: c(C.teal2), frame: c(C.grey5), litSeed: 71,
      });
      const entry = M.facade({
        ...fbase, floorH: 16, storefront: true, base: c(C.grey4), style: 'panel', seed: 171,
        glassTop: c(C.cyan), glassMid: c(C.teal3), glassBot: c(C.teal1), frame: c(C.grey5), litSeed: 72,
      });
      m.box(x0, y0, 0, x1, y1, z, { xp: f, xn: f, yp: entry, yn: f });
      m.box(x0 - 3, y0 - 3, z, x1 + 3, y1 + 3, z + 4, { top: MAT.flatRoof, all: MAT.concrete });
      parapet(m, x0 - 3, y0 - 3, x1 + 3, y1 + 3, z + 4, 4, MAT.greyRoof);
      rooftop(m, x0, y0, x1, y1, z + 4, mulberry32(172), { hvac: 3, tank: true, bulkhead: true, antenna: true });
      m.box(x0 - 6, y1 + 2, 0, x1 + 6, y1 + 8, 3, MAT.pavement);
    },
  },
  {
    name: 'c_office_b', cls: 'c', tier: 3, fx: 2, fy: 2, label: '商务楼',
    build(m) {
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, MAT.pavement);
      const f = M.facade({
        base: M.mix(c(C.brickLight), c(C.tan), 0.4), alt: c(C.tan), style: 'panel', noise: 0.12, seed: 180,
        floorH: 16, pitch: 12, winW: 9, winH: 10, winOX: 2, winOY: 3,
        frame: c(C.paper), lit: 0.55, litSeed: 81,
      });
      const glass = M.facade({
        base: c(C.tealDark), alt: c(C.teal1), style: 'panel', noise: 0.06, seed: 181,
        floorH: 16, pitch: 10, winW: 8, winH: 12, winOX: 1, winOY: 2,
        frame: c(C.teal1), lit: 0.7, litBrightProb: 0.5, litSeed: 82,
      });
      m.box(14, 14, 0, 114, 114, 96, { xp: f, xn: f, yp: f, yn: f });
      m.box(14 - 3, 14 - 3, 96, 114 + 3, 114 + 3, 100, { top: MAT.flatRoof, all: MAT.concrete });
      m.box(30, 30, 100, 98, 82, 148, { xp: glass, xn: glass, yp: glass, yn: glass });
      m.box(27, 27, 148, 101, 85, 152, { top: MAT.flatRoofDark, all: MAT.concreteDark });
      parapet(m, 27, 27, 101, 85, 152, 3, MAT.cream);
      rooftop(m, 30, 30, 98, 82, 152, mulberry32(182), { hvac: 2, tank: true, bulkhead: true, antenna: true });
      wallQuad(m, 'yp', 114, 46, 82, 0, 26, M.flat([22, 30, 36], { crisp: true }), 0.7);
      m.box(14 - 4, 114 + 1, 0, 114 + 4, 114 + 7, 2, MAT.pavement);
      const sign = M.signPlate(c(C.brick), c(C.goldBright), { seed: 83 });
      m.box(40, 118, 118, 88, 121, 134, { yp: sign, top: M.flat(c(C.grey2)), xp: M.flat(c(C.grey2)), all: M.flat(c(C.grey2)) });
    },
  },
  {
    name: 'c_tower', cls: 'c', tier: 4, fx: 2, fy: 2, label: '商业大厦',
    build(m) {
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, MAT.pavement);
      const f = M.facade({
        base: c(C.tealDark), alt: c(C.teal1), style: 'panel', noise: 0.05, seed: 190,
        floorH: 16, pitch: 8, winW: 7, winH: 13, winOX: 0, winOY: 1,
        frame: c(C.teal2), glassTop: c(C.cyan), glassMid: c(C.teal3), glassBot: c(C.teal1),
        lit: 0.6, litBrightProb: 0.4, litSeed: 91,
      });
      const dark = M.facade({
        base: c(C.grey3), alt: c(C.grey2), style: 'panel', noise: 0.08, seed: 191,
        floorH: 16, pitch: 16, winW: 10, winH: 11, winOX: 2, winOY: 3, frame: c(C.grey4), lit: 0.4, litSeed: 92,
      });
      m.box(14, 14, 0, 114, 114, 60, { xp: dark, xn: dark, yp: dark, yn: dark });
      m.box(10, 10, 60, 118, 118, 64, { top: MAT.flatRoofDark, all: MAT.concreteDark });
      parapet(m, 10, 10, 118, 118, 64, 3, MAT.concreteDark);
      m.box(20, 20, 64, 108, 108, 160, { xp: f, xn: f, yp: f, yn: f });
      m.box(17, 17, 160, 111, 111, 164, { top: MAT.flatRoof, all: MAT.concrete });
      parapet(m, 17, 17, 111, 111, 164, 3, MAT.metal);
      m.box(56, 56, 164, 72, 72, 178, MAT.metalDark);
      m.box(62, 62, 178, 66, 66, 208, MAT.darkPipe);
      const logo = M.emissive(c(C.goldBright));
      m.box(34, 108, 118, 94, 112, 130, {
        yp: M.signPlate(c(C.maroon), c(C.goldBright), { seed: 93 }),
        top: M.flat(c(C.grey2)), xp: M.flat(c(C.grey2)), all: M.flat(c(C.grey2)),
      });
      m.box(56, 56, 176, 72, 72, 178, logo);
      m.box(20, 20, 4, 40, 40, 30, M.flat(c(C.grey3)));
    },
  },
  /* ---------------- industrial ---------------- */
  {
    name: 'i_warehouse', cls: 'i', tier: 1, fx: 2, fy: 1, label: '仓库',
    build(m) {
      const x0 = 6, y0 = 10, x1 = 122, y1 = 54, z = 30;
      m.flatPoly([[0, 0], [128, 0], [128, 64], [0, 64]], 0, MAT.dirt);
      m.box(x0, y0, 0, x1, y1, z, {
        xp: MAT.metal, xn: MAT.metal, yp: MAT.metal,
        yn: M.facade({
          base: c(C.grey5), alt: c(C.grey4), style: 'panel', noise: 0.12, seed: 200,
          floorH: 16, pitch: 20, winW: 12, winH: 6, winOX: 4, winOY: 8, frame: c(C.grey3), lit: 0.4, litSeed: 101,
        }),
      });
      m.gable(x0, y0 - 2, z, x1, y1 + 2, z + 12, 'y', { roof: MAT.metalRoof, end: MAT.metal });
      m.box(24, y1, 0, 56, y1 + 3, 22, M.flat(c(C.grey3)));
      m.box(26, y1 - 1, 0, 54, y1 + 1, 20, M.flat(c(C.grey2)));
      m.box(24, y1 + 1, 22, 56, y1 + 4, 24, M.flat(c(C.grey4)));
      m.box(88, y1, 0, 108, y1 + 3, 20, M.flat(c(C.grey3)));
      m.box(90, y1 - 1, 0, 106, y1 + 1, 18, M.flat(c(C.grey2)));
      m.box(x0 + 8, y0 + 8, z, x0 + 28, y0 + 24, z + 6, MAT.metalDark);
      m.box(x1 - 30, y0 + 8, z, x1 - 12, y0 + 26, z + 8, MAT.metal);
      m.box(60, y0 + 12, z, 68, y0 + 20, z + 14, MAT.metalDark);
      m.box(4, y1 + 4, 0, 124, y1 + 9, 1, MAT.pavement);
    },
  },
  {
    name: 'i_factory', cls: 'i', tier: 2, fx: 2, fy: 2, label: '工厂',
    build(m) {
      const x0 = 10, y0 = 12, x1 = 118, y1 = 116, z = 40;
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, MAT.dirt);
      const f = M.facade({
        base: M.mix(c(C.brick), c(C.wood), 0.25), alt: c(C.brickDark), style: 'brick', noise: 0.22, seed: 210,
        floorH: 16, pitch: 18, winW: 12, winH: 10, winOX: 3, winOY: 3,
        frame: c(C.grey2), lit: 0.5, litBrightProb: 0.2, litSeed: 111,
      });
      m.box(x0, y0, 0, x1, y1, z, { xp: f, xn: f, yp: f, yn: f });
      // monitor roof
      m.box(x0, y0, z, x1, y1, z + 2, { top: MAT.flatRoofDark, all: MAT.concreteDark });
      const glass = M.facade({
        base: c(C.grey3), alt: c(C.grey2), style: 'panel', noise: 0.05, seed: 211,
        floorH: 10, pitch: 12, winW: 10, winH: 8, winOX: 1, winOY: 1, frame: c(C.grey4), lit: 0.75, litSeed: 112,
      });
      m.box(28, 40, z + 2, 100, 88, z + 12, { xp: glass, xn: glass, yp: glass, yn: glass, top: MAT.metalRoof });
      // chimneys
      m.cylinder(26, 26, 0, 78, 9, 10, { side: MAT.brickLight, top: M.flat(c(C.grey2)) });
      m.cylinder(26, 26, 78, 82, 11, 10, { side: MAT.brick, top: M.flat(c(C.nearBlack)) });
      m.cylinder(102, 102, 0, 64, 7, 10, { side: MAT.metalDark, top: M.flat(c(C.grey2)) });
      // silo
      m.cylinder(100, 26, 0, 52, 14, 12, { side: MAT.metal, top: MAT.metalDark });
      m.cone(100, 26, 52, 66, 14, 12, { side: MAT.metalDark });
      m.cylinder(44, 100, 0, 30, 10, 10, { side: MAT.metalDark, top: M.flat(c(C.grey3)) });
      m.box(60, 100, 0, 96, 108, 8, MAT.metal);
      m.box(x0 - 4, y0 + 30, 0, x0, y0 + 44, 26, M.flat(c(C.grey3)));
    },
  },
  {
    name: 'i_tanks', cls: 'i', tier: 3, fx: 2, fy: 2, label: '储罐区',
    build(m) {
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, MAT.dirt);
      const side = M.metalRib(c(C.grey6), { rib: 5, seed: 220 });
      const top = M.flat(c(C.grey3));
      const pos = [[36, 36], [92, 36], [36, 92], [92, 92]];
      pos.forEach(([cx, cy], i) => {
        const h = 44 + (i % 2) * 8;
        m.cylinder(cx, cy, 0, h, 22, 14, { side, top });
        m.cylinder(cx, cy, h, h + 2, 23, 14, { side: MAT.metalDark, top: MAT.metalDark });
        m.box(cx - 1, cy - 24, 0, cx + 1, cy + 24, h, M.flat(c(C.grey4)));
        m.box(cx + 18, cy - 2, 0, cx + 24, cy + 2, 2, MAT.darkPipe);
      });
      m.box(58, 58, 0, 70, 70, 18, { xp: MAT.metal, xn: MAT.metal, yp: MAT.metal, yn: MAT.metal, top: MAT.metalDark });
      m.box(58, 62, 18, 70, 66, 22, MAT.metalDark);
      m.box(6, 116, 0, 122, 122, 1, MAT.pavement);
    },
  },
  {
    name: 'i_yard', cls: 'i', tier: 1, fx: 1, fy: 1, label: '堆场',
    build(m) {
      m.flatPoly([[0, 0], [64, 0], [64, 64], [0, 64]], 0, MAT.dirt);
      const crates = [
        [8, 10, 26, 24, 12, c(C.teal2)], [30, 12, 48, 26, 10, c(C.brick)],
        [8, 32, 24, 46, 14, c(C.amber)], [28, 34, 52, 52, 8, c(C.grey4)],
      ];
      crates.forEach(([x0, y0, x1, y1, h, cc]) => {
        const mat = M.metalRib(cc, { rib: 6, seed: 230 + x0 });
        m.box(x0, y0, 0, x1, y1, h, mat);
        m.box(x0 + 1, y0 + 1, h, x1 - 1, y1 - 1, h + 2, M.flat(c(C.grey3)));
      });
      m.cylinder(52, 56, 0, 12, 5, 10, { side: M.metalRib(c(C.brick), { seed: 231 }), top: M.flat(c(C.brickDark)) });
      m.cylinder(44, 58, 0, 12, 5, 10, { side: M.metalRib(c(C.grey5), { seed: 232 }), top: M.flat(c(C.grey4)) });
      m.box(6, 52, 0, 30, 60, 6, MAT.metalDark);
    },
  },
  /* ---------------- civic / landmarks ---------------- */
  {
    name: 'p_hall', cls: 'p', tier: 1, fx: 2, fy: 2, label: '市政厅',
    build(m) {
      const x0 = 16, y0 = 16, x1 = 112, y1 = 112, z = 52;
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, MAT.pavement);
      const f = M.facade({
        base: c(C.paper), alt: c(C.grey6), style: 'panel', noise: 0.08, seed: 240,
        floorH: 16, pitch: 14, winW: 8, winH: 10, winOX: 3, winOY: 3,
        frame: c(C.grey4), glassTop: c(C.cyan), lit: 0.6, litSeed: 121,
      });
      m.box(x0, y0, 0, x1, y1, z, { xp: f, xn: f, yp: f, yn: f });
      m.box(x0 - 4, y0 - 4, z, x1 + 4, y1 + 4, z + 4, { top: MAT.flatRoof, all: MAT.cream });
      parapet(m, x0 - 4, y0 - 4, x1 + 4, y1 + 4, z + 4, 4, MAT.cream);
      // portico
      m.box(28, y1, 0, 100, y1 + 6, z + 4, { top: MAT.white, all: MAT.white });
      for (let i = 0; i < 4; i++) {
        const cx = 34 + i * 20;
        m.cylinder(cx, y1 + 3, 0, z + 4, 3.2, 8, { side: MAT.white, top: MAT.white });
      }
      m.box(24, y1, z + 4, 104, y1 + 7, z + 8, { top: MAT.white, all: MAT.cream });
      m.gable(24, y1 - 1, z + 8, 104, y1 + 7, z + 22, 'x', { roof: MAT.white, end: MAT.cream });
      // clock tower
      m.box(56, 40, z + 4, 72, 56, z + 40, { xp: MAT.white, xn: MAT.white, yp: MAT.white, yn: MAT.white });
      m.box(54, 38, z + 40, 74, 58, z + 44, { top: MAT.flatRoof, all: MAT.cream });
      const clock = (P, n) => {
        const u = Math.abs(n[0]) > 0.5 ? P[1] : P[0];
        const v = P[2];
        const du = u - ((Math.abs(n[0]) > 0.5 ? 48 : 64)) , dv = v - (z + 52);
        if (du * du + dv * dv < 30) return c(C.paper);
        return c(C.grey2);
      };
      wallQuad(m, 'yp', 58, 58, 70, z + 46, z + 58, clock, 0.8);
      wallQuad(m, 'xp', 74, 42, 54, z + 46, z + 58, clock, 0.8);
      m.pyramid(54, 38, z + 44, 74, 58, z + 64, { roof: MAT.tealRoof });
      m.box(62, 47, z + 64, 66, 49, z + 74, M.flat(c(C.gold)));
      m.cylinder(64, 48, z + 74, z + 77, 2.5, 6, { side: M.flat(c(C.gold)), top: M.flat(c(C.goldBright)) });
      // steps
      m.box(24, y1 + 7, 0, 104, y1 + 12, 4, MAT.pavement);
      m.box(28, y1 + 12, 0, 100, y1 + 16, 2, MAT.pavement);
      m.box(18, 8, 0, 30, 20, 26, MAT.brickLight);
      m.gable(18, 6, 26, 30, 22, 36, 'y', { roof: MAT.brickRoof, end: MAT.brickLight });
      m.box(98, 8, 0, 110, 20, 26, MAT.brickLight);
      m.gable(98, 6, 26, 110, 22, 36, 'y', { roof: MAT.brickRoof, end: MAT.brickLight });
    },
  },
  {
    name: 'p_church', cls: 'p', tier: 1, fx: 2, fy: 2, label: '教堂',
    build(m) {
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, MAT.pavement);
      const stone = M.wall(c(C.grey6), { alt: c(C.grey5), style: 'panel', noise: 0.14, seed: 250 });
      const gwin = M.facade({
        base: c(C.grey6), alt: c(C.grey5), style: 'panel', noise: 0.1, seed: 251,
        floorH: 22, pitch: 18, winW: 10, winH: 16, winOX: 4, winOY: 3,
        frame: c(C.grey5), glassTop: c(C.amber), glassMid: c(C.gold), glassBot: c(C.amberDark),
        lit: 0.9, litBrightProb: 0.8, litSeed: 131,
      });
      // nave
      m.box(20, 34, 0, 108, 106, 44, { xp: gwin, xn: gwin, yp: stone, yn: stone });
      m.gable(19, 33, 44, 109, 107, 62, 'x', { roof: MAT.brickRoof, end: stone });
      // tower + spire
      m.box(24, 30, 0, 56, 62, 84, { xp: stone, xn: stone, yp: gwin, yn: stone });
      m.box(22, 28, 84, 58, 64, 88, { top: MAT.flatRoof, all: stone });
      const clock = (P, n) => {
        const u = Math.abs(n[0]) > 0.5 ? P[1] : P[0];
        const v = P[2];
        const du = u - (Math.abs(n[0]) > 0.5 ? 46 : 40), dv = v - 96;
        if (du * du + dv * dv < 24) return c(C.paper);
        return c(C.grey5);
      };
      wallQuad(m, 'yp', 62, 26, 54, 90, 102, clock, 0.8);
      wallQuad(m, 'xn', 24, 34, 58, 90, 102, clock, 0.8);
      m.pyramid(22, 28, 88, 58, 64, 128, { roof: MAT.tealRoof });
      wallQuad(m, 'yp', 64, 4, 8, 40, 44, M.flat(c(C.gold), { crisp: true }), 0.8);
      m.box(40, 60, 0, 48, 68, 2, MAT.pavement);
      // entrance
      wallQuad(m, 'yp', 106, 54, 74, 0, 30, M.flat([30, 24, 18], { crisp: true }), 0.7);
      wallQuad(m, 'yp', 106, 56, 72, 0, 28, M.flat([70, 50, 28]), 0.9);
      m.box(46, 108, 0, 82, 114, 2, MAT.pavement);
      // buttresses
      [20, 40, 88, 108].forEach((bx) => m.box(bx - 3, 30, 0, bx + 3, 38, 34, stone));
    },
  },
  {
    name: 'p_school', cls: 'p', tier: 1, fx: 3, fy: 2, label: '学校',
    build(m) {
      const x0 = 12, y0 = 14, x1 = 180, y1 = 112, z = 36;
      m.flatPoly([[0, 0], [192, 0], [192, 128], [0, 128]], 0, M.ground(c(C.green3), { alt: c(C.green2), seed: 260, noise: 0.5 }));
      const f = M.facade({
        base: M.mix(c(C.brick), c(C.brickLight), 0.4), alt: c(C.brick), style: 'brick', noise: 0.2, seed: 261,
        floorH: 16, pitch: 13, winW: 9, winH: 11, winOX: 2, winOY: 2,
        frame: c(C.paper), lit: 0.5, litBrightProb: 0.2, litSeed: 141,
      });
      m.box(x0, y0, 0, x1, y1, z, { xp: f, xn: f, yp: f, yn: f });
      m.box(x0 - 3, y0 - 3, z, x1 + 3, y1 + 3, z + 4, { top: MAT.flatRoof, all: MAT.cream });
      parapet(m, x0 - 3, y0 - 3, x1 + 3, y1 + 3, z + 4, 4, MAT.cream);
      m.box(70, 30, z + 4, 122, 70, z + 22, { xp: MAT.greyRoof, xn: MAT.greyRoof, yp: MAT.greyRoof, yn: MAT.greyRoof, top: MAT.greyRoof });
      m.box(20, y1 + 2, 0, 44, y1 + 12, 6, MAT.pavement);
      m.box(148, y1 + 2, 0, 172, y1 + 12, 6, MAT.pavement);
      wallQuad(m, 'yp', y1, 88, 104, 0, 24, M.flat([30, 24, 16], { crisp: true }), 0.7);
      m.box(164, 20, 0, 168, 24, 62, MAT.darkPipe);
      m.box(166, 22, 44, 188, 24, 58, { xp: M.flat(c(C.brick)), xn: M.flat(c(C.brick)), yp: M.flat(c(C.brick)), yn: M.flat(c(C.maroon)) });
      m.box(96, 116, 0, 104, 122, 2, MAT.pavement);
      m.box(126, 116, 0, 134, 122, 2, MAT.pavement);
      m.box(156, 116, 0, 164, 122, 2, MAT.pavement);
      m.box(96, 116, 2, 164, 118, 3, MAT.darkPipe);
      m.box(96, 120, 2, 164, 122, 3, MAT.darkPipe);
    },
  },
  {
    name: 'p_park', cls: 'p', tier: 1, fx: 2, fy: 2, label: '公园',
    build(m) {
      const lawn = M.ground(c(C.green3), { alt: c(C.green2), seed: 270, noise: 0.5, tufts: true });
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, lawn);
      m.flatPoly([[56, 0], [72, 0], [72, 128], [56, 128]], 0.4, MAT.pavement);
      m.flatPoly([[0, 56], [128, 56], [128, 72], [0, 72]], 0.4, MAT.pavement);
      // fountain
      m.cylinder(64, 64, 0, 6, 22, 14, { side: MAT.pavement, top: M.flat(c(C.grey5)) });
      m.cylinder(64, 64, 6, 7, 17, 14, { side: M.flat(c(C.teal2)), top: M.water(0, 3) });
      m.cylinder(64, 64, 7, 16, 4, 10, { side: M.flat(c(C.grey6)), top: M.flat(c(C.grey6)) });
      m.cylinder(64, 64, 16, 18, 7, 12, { side: M.flat(c(C.grey5)), top: M.water(1, 4) });
      // trees
      const t = (x, y, s) => {
        m.cylinder(x, y, 0, 12 * s, 2.5 * s, 8, { side: M.bark(c(C.wood)) });
        m.cylinder(x, y, 8 * s, 18 * s, 9 * s, 9, { side: M.foliage(c(C.green2), { seed: x + y }), top: M.foliage(c(C.green3), { seed: x + y + 1 }) });
        m.cone(x, y, 18 * s, 26 * s, 9 * s, 9, { side: M.foliage(c(C.green3), { seed: x + y + 2 }) });
      };
      [[26, 26, 1], [102, 24, 1.1], [24, 104, 1.05], [104, 104, 1], [40, 84, 0.9], [88, 40, 0.95]].forEach(([x, y, s]) => t(x, y, s));
      // benches + lamps
      [[46, 50], [82, 50], [46, 78], [82, 78]].forEach(([x, y]) => {
        m.box(x, y, 0, x + 10, y + 3, 4, MAT.woodWall);
      });
      [[50, 60], [78, 60], [60, 50], [68, 78]].forEach(([x, y]) => {
        m.box(x, y, 0, x + 2, y + 2, 18, MAT.darkPipe);
        m.box(x - 1, y - 1, 18, x + 3, y + 3, 21, MAT.lamp);
      });
    },
  },
  {
    name: 'p_plaza', cls: 'p', tier: 1, fx: 2, fy: 2, label: '广场',
    build(m) {
      m.flatPoly([[0, 0], [128, 0], [128, 128], [0, 128]], 0, MAT.pavement);
      m.flatPoly([[8, 8], [120, 8], [120, 120], [8, 120]], 0.3, M.pavement(c(C.grey6), { joint: 8, seed: 280 }));
      // statue
      m.box(56, 56, 0, 72, 72, 4, MAT.white);
      m.box(58, 58, 4, 70, 70, 10, MAT.white);
      m.cylinder(64, 64, 10, 34, 4, 8, { side: M.flat(c(C.teal3)), top: M.flat(c(C.teal3)) });
      m.box(60, 62, 30, 68, 66, 34, M.flat(c(C.teal3)));
      m.cylinder(64, 64, 46, 50, 3, 8, { side: M.flat(c(C.gold)), top: M.flat(c(C.goldBright)) });
      // hedges
      [[16, 16, 48, 24], [80, 16, 112, 24], [16, 104, 48, 112], [80, 104, 112, 112]].forEach(([x0, y0, x1, y1]) => {
        m.box(x0, y0, 0, x1, y1, 10, { top: M.foliage(c(C.green4), { seed: x0 }), all: M.foliage(c(C.green2), { seed: x0 + 1 }) });
      });
      [[30, 50], [98, 50], [30, 78], [98, 78]].forEach(([x, y]) => {
        m.box(x, y, 0, x + 2, y + 2, 20, MAT.darkPipe);
        m.box(x - 1, y - 1, 20, x + 3, y + 3, 23, MAT.lamp);
      });
      m.box(16, 16, 10, 48, 24, 12, M.flat(c(C.green3)));
      m.box(80, 104, 10, 112, 112, 12, M.flat(c(C.green3)));
    },
  },
  /* ---------------- construction stages ---------------- */
  {
    name: 'cons_1', cls: 'x', tier: 0, fx: 1, fy: 1, label: '工地',
    build(m) {
      m.flatPoly([[2, 2], [62, 2], [62, 62], [2, 62]], 0, M.ground(c(C.wood), { alt: c(C.soil), seed: 300, noise: 0.6 }));
      m.box(6, 6, 0, 58, 58, 3, M.flat(c(C.grey4)));
      m.box(10, 10, 3, 54, 54, 5, M.flat(c(C.grey3)));
      [[8, 8], [50, 8], [8, 50], [50, 50]].forEach(([x, y]) => m.box(x, y, 0, x + 5, y + 5, 26, M.flat(c(C.amberDark))));
      m.cylinder(44, 22, 0, 10, 4, 8, { side: M.flat(c(C.brick)), top: M.flat(c(C.brickLight)) });
      m.cone(24, 34, 0, 12, 4.5, 8, { side: M.flat(c(C.gold)) });
      m.box(12, 40, 0, 34, 48, 4, MAT.woodWall);
      m.box(14, 42, 4, 32, 46, 7, MAT.woodWall);
    },
  },
  {
    name: 'cons_2', cls: 'x', tier: 0, fx: 2, fy: 2, label: '工地',
    build(m) {
      m.flatPoly([[4, 4], [124, 4], [124, 124], [4, 124]], 0, M.ground(c(C.wood), { alt: c(C.soil), seed: 301, noise: 0.6 }));
      m.box(10, 10, 0, 118, 118, 3, M.flat(c(C.grey4)));
      m.box(14, 14, 3, 114, 114, 5, M.flat(c(C.grey3)));
      // foundation walls
      const cf = M.wall(c(C.grey4), { alt: c(C.grey3), style: 'panel', seed: 302 });
      [[14, 14, 114, 22], [14, 106, 114, 114], [14, 22, 22, 106], [106, 22, 114, 106]].forEach(([x0, y0, x1, y1]) => {
        m.box(x0, y0, 5, x1, y1, 14, { top: cf, all: cf });
      });
      [[10, 10], [106, 10], [10, 106], [106, 106]].forEach(([x, y]) => m.box(x, y, 0, x + 6, y + 6, 30, M.flat(c(C.amberDark))));
      m.cylinder(96, 30, 0, 14, 6, 8, { side: M.flat(c(C.brick)), top: M.flat(c(C.brickLight)) });
      m.cone(50, 96, 0, 14, 5, 8, { side: M.flat(c(C.gold)) });
      m.cone(70, 100, 0, 14, 5, 8, { side: M.flat(c(C.gold)) });
      m.box(24, 30, 0, 60, 40, 6, MAT.woodWall);
      m.box(26, 32, 6, 58, 38, 10, MAT.woodWall);
      m.box(70, 60, 0, 74, 108, 40, M.flat(c(C.amberDark)));
      m.box(66, 60, 40, 96, 64, 43, M.flat(c(C.amberDark)));
      m.box(92, 60, 40, 96, 64, 52, M.flat(c(C.grey3)));
    },
  },
];

export function buildModelMesh(model) {
  const m = new Mesh();
  model.build(m);
  return m;
}
