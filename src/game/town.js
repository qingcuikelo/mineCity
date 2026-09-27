/**
 * One-click town generator: finds a free plot, levels it, lays a road grid,
 * paints zones, drops a few landmarks and runs the growth simulation so a
 * whole neighbourhood appears immediately.
 */

import { MAX_H, ZONE } from '../config.js';
import { TOOLS } from './tools.js';
import { placeBuilding, removeBuilding, mulberry32 } from './world.js';
import { simStep } from './growth.js';

const SPACING = 5;         // a road every 5 tiles => 4x4 buildable lots
const BLOCKS_X = 4;
const BLOCKS_Y = 3;
export const TOWN_W = BLOCKS_X * SPACING + 1;   // 21
export const TOWN_H = BLOCKS_Y * SPACING + 1;   // 16

/** Score a candidate site: prefer land, empty, already-flat areas. */
function scoreSite(world, x0, y0, w, h) {
  let land = 0, empty = 0, flat = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!world.inB(x, y)) return -1;
      const i = world.idx(x, y);
      if (!world.water[i]) land++;
      if (!world.road[i] && world.bld[i] === 0 && world.zone[i] === 0) empty++;
      if (world.isLand(x, y)) {
        const hh = world.height[i];
        let same = 0;
        if (world.heightAt(x + 1, y) === hh) same++;
        if (world.heightAt(x - 1, y) === hh) same++;
        if (world.heightAt(x, y + 1) === hh) same++;
        if (world.heightAt(x, y - 1) === hh) same++;
        flat += same / 4;
      }
    }
  }
  const cells = w * h;
  const landFrac = land / cells;
  const emptyFrac = empty / cells;
  if (landFrac < 0.55 || emptyFrac < 0.9) return -1;
  return landFrac * 140 + emptyFrac * 60 + (flat / cells) * 40;
}

export function findTownSite(world, w = TOWN_W, h = TOWN_H, margin = 1) {
  const W = w + margin * 2;
  const H = h + margin * 2;
  let best = null;
  let bestScore = -1;
  for (let y = 2; y < world.h - H - 2; y += 2) {
    for (let x = 2; x < world.w - W - 2; x += 2) {
      const s = scoreSite(world, x, y, W, H);
      if (s > bestScore) { bestScore = s; best = { x: x + margin, y: y + margin }; }
    }
  }
  return bestScore > 0 ? best : null;
}

/** Level and clear a rectangle so lots and roads can be placed. */
function levelArea(world, x0, y0, w, h) {
  const heights = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!world.inB(x, y)) continue;
      const i = world.idx(x, y);
      if (!world.water[i]) heights.push(world.height[i]);
    }
  }
  heights.sort((a, b) => a - b);
  const target = heights.length
    ? Math.max(1, Math.min(MAX_H, heights[Math.floor(heights.length / 2)]))
    : 2;
  for (let y = y0 - 1; y < y0 + h + 1; y++) {
    for (let x = x0 - 1; x < x0 + w + 1; x++) {
      if (!world.inB(x, y)) continue;
      const i = world.idx(x, y);
      world.water[i] = 0;
      world.height[i] = target;
      world.tree[i] = 0;
      world.road[i] = 0;
      world.zone[i] = 0;
      world.growth[i] = 0;
      if (world.surf[i] === 2) world.surf[i] = 0;
      world.bld[i] = 0;
    }
  }
  return target;
}

/**
 * Generate a town. Returns { x, y, w, h, target, buildings } or null when no
 * suitable site exists.
 */
export function generateTown(world, models, sim, byClass, opts = {}) {
  const rng = mulberry32(opts.seed ?? ((Math.random() * 0x7fffffff) | 0));
  const site = findTownSite(world, TOWN_W, TOWN_H);
  if (!site) return null;
  const { x: x0, y: y0 } = site;
  const target = levelArea(world, x0, y0, TOWN_W, TOWN_H);

  // ---- roads -----------------------------------------------------------
  for (let bx = 0; bx <= BLOCKS_X; bx++) {
    const x = x0 + bx * SPACING;
    for (let y = y0; y < y0 + TOWN_H; y++) TOOLS.road.apply(world, models, x, y, {});
  }
  for (let by = 0; by <= BLOCKS_Y; by++) {
    const y = y0 + by * SPACING;
    for (let x = x0; x < x0 + TOWN_W; x++) TOOLS.road.apply(world, models, x, y, {});
  }

  // ---- zones -----------------------------------------------------------
  const centerBx = Math.floor(BLOCKS_X / 2);
  const centerBy = Math.floor(BLOCKS_Y / 2);
  const industrialBx = BLOCKS_X - 1;
  const industrialBy = 0;
  for (let by = 0; by < BLOCKS_Y; by++) {
    for (let bx = 0; bx < BLOCKS_X; bx++) {
      const isCenter = bx === centerBx && by === centerBy;
      const isIndustry = bx === industrialBx && by === industrialBy;
      const lots = SPACING - 1;
      for (let ly = 0; ly < lots; ly++) {
        for (let lx = 0; lx < lots; lx++) {
          const x = x0 + bx * SPACING + 1 + lx;
          const y = y0 + by * SPACING + 1 + ly;
          if (isCenter && lx < 2 && ly < 2) continue;      // park / plaza corner
          const onStreet = lx === 0 || ly === 0 || lx === lots - 1 || ly === lots - 1;
          if (!onStreet) {
            // back yards: greenery instead of lots that could never reach a road
            const roll = rng();
            if (roll < 0.45) TOOLS.forest.apply(world, models, x, y, { rng });
            else if (roll < 0.6) TOOLS.bush.apply(world, models, x, y, {});
            else if (roll < 0.68) TOOLS.rock_prop.apply(world, models, x, y, {});
            continue;
          }
          let tool;
          if (isIndustry) tool = TOOLS.zone_i;
          else if (isCenter) tool = TOOLS.zone_c;
          else {
            const roll = rng();
            tool = roll < 0.55 ? TOOLS.zone_r : roll < 0.8 ? TOOLS.zone_c : TOOLS.zone_i;
          }
          tool.apply(world, models, x, y, {});
        }
      }
      // a pocket park in the corner of a residential block
      if (!isCenter && !isIndustry && rng() < 0.5) {
        const px = x0 + bx * SPACING + 1 + (rng() < 0.5 ? 0 : 1);
        const py = y0 + by * SPACING + 1 + (rng() < 0.5 ? 0 : 1);
        TOOLS.forest.apply(world, models, px, py, { rng });
        TOOLS.bush.apply(world, models, px + 1, py, {});
      }
    }
  }

  // ---- landmarks --------------------------------------------------------
  const cx = x0 + centerBx * SPACING + 1;
  const cy = y0 + centerBy * SPACING + 1;
  const plops = [
    ['p_park', cx, cy, 0],
    ['p_plaza', cx + 2, cy, 0],
    ['p_hall', x0 + 1, y0 + SPACING + 1, 0],
    ['p_church', x0 + (BLOCKS_X - 1) * SPACING + 1, y0 + (BLOCKS_Y - 1) * SPACING + 1, 0],
    ['p_school', x0 + 2 * SPACING + 1, y0 + 1, 0],
  ];
  for (const [name, px, py, rot] of plops) placeBuilding(world, models, px, py, name, rot);

  // ---- greenery on the outskirts ---------------------------------------
  for (let k = 0; k < 26; k++) {
    const onX = rng() < 0.5;
    const x = onX ? x0 - 2 + Math.floor(rng() * (TOWN_W + 4)) : (rng() < 0.5 ? x0 - 2 : x0 + TOWN_W + 1);
    const y = onX ? (rng() < 0.5 ? y0 - 2 : y0 + TOWN_H + 1) : y0 - 2 + Math.floor(rng() * (TOWN_H + 4));
    TOOLS.forest.apply(world, models, x, y, { rng });
  }

  world.touch();

  // ---- let it grow ------------------------------------------------------
  const steps = opts.simSteps ?? 55;
  const day0 = sim.day;
  for (let k = 0; k < steps; k++) simStep(world, models, byClass, sim);
  sim.day = day0;

  let buildings = 0;
  for (let y = y0 - 2; y < y0 + TOWN_H + 2; y++) {
    for (let x = x0 - 2; x < x0 + TOWN_W + 2; x++) {
      if (!world.inB(x, y)) continue;
      const b = world.bld[world.idx(x, y)];
      if (b > 0 && b !== 0xffff) buildings++;
    }
  }
  return { x: x0, y: y0, w: TOWN_W, h: TOWN_H, target, buildings };
}
