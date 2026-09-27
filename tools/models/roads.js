/**
 * Road tiles: 16 auto-tiling connection masks.
 * bit 1 = +X open, bit 2 = +Y open, bit 4 = -X open, bit 8 = -Y open.
 * One flat diamond per tile; the material decides asphalt / sidewalk / curb /
 * markings from the mask.
 */

import { Mesh } from '../raster.js';
import { C } from '../palette.js';
import * as M from './materials.js';

const BAND0 = 18;
const BAND1 = 46;

const asphalt = M.col(C.grey3);
const asphaltDark = M.col(C.grey2);
const sidewalk = M.col(C.grey5);
const sidewalkDark = M.col(C.grey4);
const curb = M.col(C.grey6);
const paint = M.col(C.paper);

function roadMaterial(mask) {
  const openX = (mask & 1) || (mask & 4);
  const openY = (mask & 2) || (mask & 8);
  const deg = ((mask & 1) ? 1 : 0) + ((mask & 2) ? 1 : 0) + ((mask & 4) ? 1 : 0) + ((mask & 8) ? 1 : 0);
  const crosswalk = deg >= 3;

  return (P, n, ctx) => {
    if (n[2] < 0.5) return asphaltDark;
    const x = P[0], y = P[1];
    const pad = mask === 0 && x >= BAND0 && x < BAND1 && y >= BAND0 && y < BAND1;
    const inX = (openX || mask === 0) && y >= BAND0 && y < BAND1;
    const inY = (openY || mask === 0) && x >= BAND0 && x < BAND1;
    const isRoad = pad || (openX && inX) || (openY && inY);

    if (isRoad) {
      // asphalt with noise + tyre tracks
      const t = M.hash2((x / 2) | 0, (y / 2) | 0, 601);
      let c = M.mix(asphaltDark, asphalt, 0.35 + t * 0.5);
      const dy = Math.abs(y - 32);
      const dx = Math.abs(x - 32);
      if ((openX && dy > 6 && dy < 10) || (openY && dx > 6 && dx < 10)) c = M.mul(c, 0.92);

      // markings
      const nearX = openX && dx < 14 && (openX ? dy < 14 : true);
      const nearY = openY && Math.abs(y - 32) < 14;
      const intersect = openX && openY && dx < 13 && dy < 13;
      if (!intersect) {
        if (openX && dy <= 1 && ((x + 4) % 14) < 7) return ctx.night ? paint : paint;
        if (openY && dx <= 1 && ((y + 4) % 14) < 7) return ctx.night ? paint : paint;
      }

      // crosswalks on 3+ way intersections
      if (crosswalk) {
        if ((mask & 4) && x < 15 && x >= 3 && y >= BAND0 && y < BAND1 && ((x - 3) % 5) < 3) return paint;
        if ((mask & 1) && x > 49 && x <= 61 && y >= BAND0 && y < BAND1 && ((x - 49) % 5) < 3) return paint;
        if ((mask & 8) && y < 15 && y >= 3 && x >= BAND0 && x < BAND1 && ((y - 3) % 5) < 3) return paint;
        if ((mask & 2) && y > 49 && y <= 61 && x >= BAND0 && x < BAND1 && ((y - 49) % 5) < 3) return paint;
      }

      // manhole
      const mx = 20 + ((mask * 37) % 24), my = 20 + ((mask * 53) % 24);
      const d2 = (x - mx) * (x - mx) + (y - my) * (y - my);
      if (d2 < 16) return M.col(C.grey2);

      if (ctx.night) c = M.mul(c, 0.78);
      return c;
    }

    // curb ring right next to asphalt
    const curbs = [];
    if (openX || mask === 0) curbs.push(Math.abs(y - BAND0) < 2 || Math.abs(y - BAND1) < 2);
    if (openY || mask === 0) curbs.push(Math.abs(x - BAND0) < 2 || Math.abs(x - BAND1) < 2);
    if (curbs.some(Boolean)) return ctx.night ? M.mul(curb, 0.8) : curb;

    // sidewalk with paving joints
    const t = M.hash2((x / 2) | 0, (y / 2) | 0, 602);
    let c = M.mix(sidewalkDark, sidewalk, 0.3 + t * 0.55);
    if ((x % 16) < 1 || (y % 16) < 1) c = M.mul(c, 0.88);
    if (ctx.night) c = M.mul(c, 0.8);
    return c;
  };
}

export function buildRoadTile(mask) {
  const m = new Mesh();
  const mat = roadMaterial(mask);
  m.flatPoly([[0, 0], [64, 0], [64, 64], [0, 64]], 0, mat);
  return m;
}

export const ROAD_MASKS = Array.from({ length: 16 }, (_, i) => i);
export { roadMaterial };
