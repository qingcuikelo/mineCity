/**
 * Decorative props: trees, bushes, rocks, street lamps.
 * All props are centred on the tile at (32, 32).
 */

import { Mesh } from '../raster.js';
import { C } from '../palette.js';
import * as M from './materials.js';

/**
 * Screen-aligned quad in world space (a glow disc seen by the fixed camera).
 * U = (1,-1,0) is screen +x, V = (2,2,0) is screen +y, so the quad maps to a
 * true screen circle of radius r.
 */
function glowQuad(m, cx, cy, cz, r, color, maxAlpha, soft = 1.2) {
  const mat = (P) => {
    const du = ((P[0] - cx) - (P[1] - cy)) / 2;
    const dv = ((P[0] - cx) + (P[1] - cy)) / 4;
    const d = Math.hypot(du, dv) / r;
    if (d >= 1) return null;
    const a = Math.pow(1 - d, soft) * maxAlpha;
    return [color[0], color[1], color[2], a];
  };
  m.quad(
    m.v(cx - 3 * r, cy - r, cz),
    m.v(cx - r, cy - 3 * r, cz),
    m.v(cx + 3 * r, cy + r, cz),
    m.v(cx + r, cy + 3 * r, cz),
    mat,
  );
}

function foliageMats(seed, base = C.green2, hi = C.green3) {
  return M.foliage(M.col(base), { seed });
}

function trunk(m, x, y, h, r = 3) {
  m.cylinder(x, y, 0, h, r, 7, { side: M.bark(M.col(C.wood)) });
}

export const PROPS = [
  {
    name: 'tree_a', label: '阔叶树',
    build(m) {
      trunk(m, 32, 32, 14, 3);
      m.cylinder(32, 32, 10, 20, 9, 9, { side: foliageMats(501) });
      m.cylinder(32, 32, 16, 26, 12, 11, { side: foliageMats(502) });
      m.cylinder(32, 32, 24, 32, 9, 10, { side: foliageMats(503, C.green3) });
      m.cone(32, 32, 30, 41, 9, 10, { side: foliageMats(504, C.green3) });
    },
  },
  {
    name: 'tree_b', label: '圆冠树',
    build(m) {
      trunk(m, 32, 32, 12, 2.6);
      m.cylinder(32, 32, 8, 16, 10, 9, { side: foliageMats(511) });
      m.cylinder(32, 32, 14, 22, 13, 11, { side: foliageMats(512) });
      m.cylinder(32, 32, 20, 27, 10, 11, { side: foliageMats(513, C.green3) });
      m.cone(32, 32, 25, 34, 8, 11, { side: foliageMats(514, C.green4) });
      m.cone(40, 26, 20, 28, 5, 8, { side: foliageMats(515, C.green3) });
    },
  },
  {
    name: 'pine_a', label: '松树',
    build(m) {
      trunk(m, 32, 32, 10, 2.4);
      m.cone(32, 32, 6, 22, 13, 10, { side: foliageMats(521, C.green1) });
      m.cone(32, 32, 18, 30, 10, 9, { side: foliageMats(522, C.green2) });
      m.cone(32, 32, 26, 38, 7, 9, { side: foliageMats(523, C.green3) });
    },
  },
  {
    name: 'pine_b', label: '杉树',
    build(m) {
      trunk(m, 32, 32, 8, 2.2);
      m.cone(32, 32, 4, 20, 11, 9, { side: foliageMats(531, C.green1) });
      m.cone(32, 32, 16, 30, 8, 9, { side: foliageMats(532, C.green2) });
      m.cone(32, 32, 26, 40, 5.5, 9, { side: foliageMats(533, C.green3) });
    },
  },
  {
    name: 'bush', label: '灌木',
    build(m) {
      m.cylinder(32, 32, 0, 6, 7, 9, { side: foliageMats(541, C.green2) });
      m.cylinder(32, 32, 4, 10, 9, 10, { side: foliageMats(542, C.green2) });
      m.cone(32, 32, 9, 15, 8, 10, { side: foliageMats(543, C.green3) });
      m.cylinder(24, 40, 0, 5, 4, 7, { side: foliageMats(544, C.green1) });
      m.cone(24, 40, 4, 9, 4.5, 7, { side: foliageMats(545, C.green2) });
    },
  },
  {
    name: 'rock', label: '岩石',
    build(m) {
      const rm = M.rock(M.col(C.grey4), { seed: 551 });
      m.cone(28, 34, 0, 9, 9, 7, { side: rm });
      m.cone(40, 38, 0, 7, 7, 6, { side: M.rock(M.col(C.grey3), { seed: 552 }) });
      m.cone(34, 26, 0, 5, 5, 6, { side: M.rock(M.col(C.grey5), { seed: 553 }) });
    },
  },
  {
    name: 'lamp', label: '路灯',
    build(m) {
      m.cylinder(32, 32, 0, 2, 3.5, 7, { side: M.flat(M.col(C.grey3)) });
      m.box(31, 31, 2, 33, 33, 28, M.flat(M.col(C.grey4)));
      m.box(32, 31.5, 28, 38, 32.5, 30, M.flat(M.col(C.grey4)));
      m.box(35, 30.5, 27, 39, 32.5, 30.5, M.lampHead(M.col(C.grey5), M.col(C.goldBright)));
      m.flatPoly([[29, 29], [35, 29], [35, 35], [29, 35]], 0.4, M.flat(M.col(C.grey3)));
      glowQuad(m, 37, 31.5, 30, 16, M.col(C.goldBright), 150, 1.6);
      glowQuad(m, 37, 31.5, 30, 7, M.col(C.goldBright), 220, 0.7);
    },
  },
];

export function buildProp(name) {
  const p = PROPS.find((x) => x.name === name);
  const m = new Mesh();
  p.build(m);
  return m;
}
