/**
 * Zone growth: zoned lots adjacent to roads slowly develop, first as a
 * construction site, then as a real building. Density tiers rise with the
 * number of developed neighbours. Purely cosmetic "demand" meters modulate
 * growth speed - there is no economy.
 */

import { ZONE } from '../config.js';
import { placeBuilding, removeBuilding, footprint } from './world.js';

export function indexModels(models) {
  const byClass = { r: {}, c: {}, i: {} };
  for (const m of models) {
    if (!byClass[m.cls]) continue;
    (byClass[m.cls][m.tier] = byClass[m.cls][m.tier] || []).push(m);
  }
  return byClass;
}

const ZONE_CLASS = { [ZONE.R]: 'r', [ZONE.C]: 'c', [ZONE.I]: 'i' };
const CONSTRUCTION_TIME = 2;

const CAPACITY = {
  r: [0, 14, 48, 110, 220],
  c: [0, 10, 30, 80, 180],
  i: [0, 12, 36, 90, 200],
};

export function makeSimState() {
  const sim = {
    demand: { r: 0.6, c: 0.5, i: 0.45 },
    log: [],
    growthCount: 0,
    paused: false,
    speed: 1,
    day: 0,
    stats: { pop: 0, jobsC: 0, jobsI: 0 },
  };
  sim.dateString = () => {
    const d = new Date(1996, 0, 1 + Math.floor(sim.day));
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  };
  return sim;
}

export function computeStats(world, models, sim) {
  let pop = 0, jobsC = 0, jobsI = 0;
  for (let i = 0; i < world.bld.length; i++) {
    const b = world.bld[i];
    if (b === 0 || b === 0xffff) continue;
    const model = models[b - 1];
    if (!model || model.cls === 'x') continue;
    const tier = Math.max(1, Math.min(4, model.tier || 1));
    if (model.cls === 'r') pop += CAPACITY.r[tier];
    else if (model.cls === 'c') jobsC += CAPACITY.c[tier];
    else if (model.cls === 'i') jobsI += CAPACITY.i[tier];
  }
  sim.stats = { pop, jobsC, jobsI };
}

function demandFor(zoneCount, builtCount) {
  return Math.max(0.12, Math.min(1.3, 0.35 + (zoneCount * 0.6 - builtCount) * 0.05));
}

function terrainFlatFor(world, x, y, fx, fy) {
  for (let dy = 0; dy < fy; dy++) {
    for (let dx = 0; dx < fx; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!world.inB(tx, ty)) return false;
      const i = world.idx(tx, ty);
      if (world.water[i] || world.road[i] || world.bld[i]) return false;
      if (!world.isFlat(tx, ty)) return false;
    }
  }
  return true;
}

function placeZoneBuilding(world, models, x, y, model, rot) {
  const { fx, fy } = footprint(model, rot);
  if (!terrainFlatFor(world, x, y, fx, fy)) return false;
  return !!placeBuilding(world, models, x, y, model.name, rot);
}

function developedNeighbours(world, x, y, radius = 2) {
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const tx = x + dx, ty = y + dy;
      if (!world.inB(tx, ty)) continue;
      const i = world.idx(tx, ty);
      const b = world.bld[i];
      if (b > 0 && b !== 0xffff && world.zone[i] !== 0) n++;
    }
  }
  return n;
}

function pickTier(world, x, y, rng) {
  const dev = developedNeighbours(world, x, y);
  const tiers = [1];
  if (dev >= 3) tiers.push(2);
  if (dev >= 7) tiers.push(3);
  if (dev >= 12) tiers.push(4);
  const top = tiers[tiers.length - 1];
  const roll = rng();
  if (top >= 4 && roll < 0.25) return 4;
  if (top >= 3 && roll < 0.5) return 3;
  if (top >= 2 && roll < 0.75) return 2;
  return 1;
}

/** One simulation step (roughly every 1.5 s at speed 1). */
export function simStep(world, models, byClass, sim) {
  const rng = mulberry32((world.seed ^ (sim.growthCount * 2654435761)) >>> 0);
  let zoneCount = { r: 0, c: 0, i: 0 };
  let builtCount = { r: 0, c: 0, i: 0 };
  for (let i = 0; i < world.zone.length; i++) {
    const z = world.zone[i];
    if (!z) continue;
    const cls = ZONE_CLASS[z];
    zoneCount[cls]++;
    const b = world.bld[i];
    if (b > 0 && b !== 0xffff && !isCons(models[b - 1])) builtCount[cls]++;
  }
  for (const cls of ['r', 'c', 'i']) {
    const d = demandFor(zoneCount[cls], builtCount[cls]);
    sim.demand[cls] += (d - sim.demand[cls]) * 0.15 + (rng() - 0.5) * 0.05;
    sim.demand[cls] = Math.max(0.1, Math.min(1.3, sim.demand[cls]));
  }

  const events = [];
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const i = world.idx(x, y);
      const z = world.zone[i];
      if (!z) continue;
      const cls = ZONE_CLASS[z];
      const b = world.bld[i];
      const hasRoad = world.roadAdjacent(x, y);

      if (b === 0) {
        if (!hasRoad) { world.growth[i] = Math.max(0, world.growth[i] - 0.5); continue; }
        world.growth[i] += (0.35 + sim.demand[cls] * 0.9) * sim.speed;
        if (world.growth[i] >= 1) {
          world.growth[i] = 0;
          const consName = (x + y) % 5 === 0 ? 'cons_2' : 'cons_1';
          const cons = models.find((m) => m.name === consName);
          if (cons && placeZoneBuilding(world, models, x, y, cons, 0)) {
            const ii = world.idx(x, y);
            world.bld[ii] = models.indexOf(cons) + 1;
            world.growth[ii] = -CONSTRUCTION_TIME;
            world.touch();
          }
        }
      } else if (b !== 0xffff) {
        const model = models[b - 1];
        if (isCons(model)) {
          world.growth[i] -= sim.speed;
          if (world.growth[i] <= -CONSTRUCTION_TIME) {
            const tier = pickTier(world, x, y, rng);
            const list = byClass[cls][tier] || byClass[cls][1] || [];
            const pick = list[Math.floor(rng() * list.length)];
            const rot = Math.floor(rng() * 4);
            const zone = z;
            removeBuilding(world, models, x, y);
            const ok = pick && placeZoneBuilding(world, models, x, y, pick, rot);
            const ii = world.idx(x, y);
            if (ok) {
              world.zone[ii] = zone;
              events.push(`${labelOf(cls)}落成`);
            } else {
              world.zone[ii] = zone;
            }
          }
        } else {
          // upgrade pressure
          world.growth[i] += 0.12 * sim.speed;
          const { fx, fy } = footprint(model, world.brot[i]);
          const tier = model.tier || 1;
          if (world.growth[i] > 2.2 && tier < 4 && developedNeighbours(world, x, y) >= tier * 3 + 2) {
            world.growth[i] = 0;
            const list = byClass[cls][tier + 1] || [];
            const pick = list[Math.floor(rng() * list.length)];
            if (pick) {
              const rot = Math.floor(rng() * 4);
              const { fx: nfx, fy: nfy } = footprint(pick, rot);
              const zone = z;
              const fits = nfx <= fx && nfy <= fy;
              if (fits) {
                removeBuilding(world, models, x, y);
                const ok = placeZoneBuilding(world, models, x, y, pick, rot);
                const ii = world.idx(x, y);
                world.zone[ii] = zone;
                if (ok) events.push(`${labelOf(cls)}升级`);
              }
            }
          }
        }
      }
    }
  }
  sim.growthCount++;
  sim.day += 0.25;
  if (events.length) {
    sim.log.unshift(events[0]);
    sim.log.length = Math.min(sim.log.length, 6);
  }
  computeStats(world, models, sim);
}

function isCons(model) {
  return model && model.cls === 'x';
}

function labelOf(cls) {
  return cls === 'r' ? '住宅' : cls === 'c' ? '商业' : '工业';
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
