/** Build/edit tools and their application rules. */

import { ZONE, SURF, MAX_H, TILE_W } from '../config.js';
import { placeBuilding, removeBuilding, footprint, TREE_NAMES } from './world.js';

export const TOOL_GROUPS = [
  { id: 'terrain', label: '地形', tools: ['terra_up', 'terra_down', 'terra_level', 'surf_grass', 'surf_sand', 'surf_rock', 'surf_dirt'] },
  { id: 'nature', label: '自然', tools: ['water', 'forest', 'bush', 'rock_prop'] },
  { id: 'roads', label: '道路', tools: ['road'] },
  { id: 'zones', label: '分区', tools: ['zone_r', 'zone_c', 'zone_i'] },
  { id: 'build', label: '地标', tools: ['p_hall', 'p_church', 'p_school', 'p_park', 'p_plaza'] },
  { id: 'tools', label: '工具', tools: ['bulldoze'] },
];

export const TOOLS = {
  terra_up: {
    id: 'terra_up', label: '抬升', icon: 'terra_up', cursor: 'brush', desc: '抬高地形',
    apply(world, models, x, y) {
      if (!world.inB(x, y)) return false;
      clearPlot(world, models, x, y);
      const i = world.idx(x, y);
      if (world.water[i]) { world.water[i] = 0; world.height[i] = 1; world.surf[i] = SURF.GRASS; }
      else world.height[i] = Math.min(MAX_H, world.height[i] + 1);
      return true;
    },
  },
  terra_down: {
    id: 'terra_down', label: '降低', icon: 'terra_down', cursor: 'brush', desc: '降低地形',
    apply(world, models, x, y) {
      if (!world.inB(x, y)) return false;
      clearPlot(world, models, x, y);
      const i = world.idx(x, y);
      if (world.water[i]) return false;
      if (world.height[i] <= 1) { world.water[i] = 1; world.height[i] = 0; world.tree[i] = 0; }
      else world.height[i] -= 1;
      return true;
    },
  },
  terra_level: {
    id: 'terra_level', label: '整平', icon: 'terra_level', cursor: 'brush', desc: '整平到刷子中心高度',
    apply(world, models, x, y, ctx) {
      if (!world.inB(x, y)) return false;
      const target = ctx.level ?? world.height[world.idx(x, y)];
      clearPlot(world, models, x, y);
      const i = world.idx(x, y);
      world.water[i] = 0;
      world.height[i] = Math.max(1, Math.min(MAX_H, target));
      return true;
    },
  },
  surf_grass: { id: 'surf_grass', label: '草地', icon: 'grass', cursor: 'brush', desc: '草地', surf: SURF.GRASS },
  surf_sand: { id: 'surf_sand', label: '沙地', icon: 'sand', cursor: 'brush', desc: '沙地', surf: SURF.SAND },
  surf_rock: { id: 'surf_rock', label: '岩石', icon: 'rock', cursor: 'brush', desc: '岩石', surf: SURF.ROCK },
  surf_dirt: { id: 'surf_dirt', label: '泥地', icon: 'dirt', cursor: 'brush', desc: '泥地', surf: SURF.DIRT },

  water: {
    id: 'water', label: '水面', icon: 'water', cursor: 'brush', desc: '挖出水面',
    apply(world, models, x, y) {
      if (!world.inB(x, y)) return false;
      clearPlot(world, models, x, y);
      const i = world.idx(x, y);
      world.water[i] = 1;
      world.height[i] = 0;
      return true;
    },
  },
  forest: {
    id: 'forest', label: '森林', icon: 'forest', cursor: 'brush', desc: '种树',
    apply(world, models, x, y, ctx) {
      const i = world.idx(x, y);
      if (!world.isLand(x, y) || world.bld[i] || world.road[i]) return false;
      const r = ctx.rng ? Math.floor(ctx.rng() * 4) : 0;
      world.tree[i] = 1 + (r % 4);
      world.treeRot[i] = ctx.rng ? Math.floor(ctx.rng() * 4) : 0;
      return true;
    },
  },
  bush: {
    id: 'bush', label: '灌木', icon: 'bush_icon', cursor: 'brush', desc: '灌木',
    apply(world, models, x, y) {
      const i = world.idx(x, y);
      if (!world.isLand(x, y) || world.bld[i] || world.road[i]) return false;
      world.tree[i] = 5;
      world.treeRot[i] = 0;
      return true;
    },
  },
  rock_prop: {
    id: 'rock_prop', label: '岩石', icon: 'rock_icon', cursor: 'brush', desc: '石块',
    apply(world, models, x, y) {
      const i = world.idx(x, y);
      if (!world.isLand(x, y) || world.bld[i] || world.road[i]) return false;
      world.tree[i] = 6;
      world.treeRot[i] = 0;
      return true;
    },
  },

  road: {
    id: 'road', label: '道路', icon: 'road', cursor: 'line', desc: '拖拽修建道路',
    apply(world, models, x, y) {
      const i = world.idx(x, y);
      if (world.water[i]) return false;
      if (world.bld[i]) return false;
      if (!world.isFlat(x, y)) return false;
      if (world.road[i]) return false;
      world.tree[i] = 0;
      world.zone[i] = 0;
      world.road[i] = 1;
      world.growth[i] = 0;
      return true;
    },
  },

  zone_r: { id: 'zone_r', label: '住宅区', icon: 'zone_r', cursor: 'rect', desc: '住宅分区', zone: ZONE.R },
  zone_c: { id: 'zone_c', label: '商业区', icon: 'zone_c', cursor: 'rect', desc: '商业分区', zone: ZONE.C },
  zone_i: { id: 'zone_i', label: '工业区', icon: 'zone_i', cursor: 'rect', desc: '工业分区', zone: ZONE.I },

  bulldoze: {
    id: 'bulldoze', label: '推土机', icon: 'bulldoze', cursor: 'brush', radiusDefault: 0, desc: '清除建筑/道路/分区',
    apply(world, models, x, y) {
      let changed = false;
      if (removeBuilding(world, models, x, y)) changed = true;
      const i = world.idx(x, y);
      if (world.road[i]) { world.road[i] = 0; changed = true; }
      if (world.zone[i]) { world.zone[i] = 0; changed = true; }
      if (world.tree[i]) { world.tree[i] = 0; changed = true; }
      if (changed) world.growth[i] = 0;
      return changed;
    },
  },
};

/** Auto-clear the plot (buildings / roads / zones / trees) before terraforming. */
function clearPlot(world, models, x, y) {
  if (!world.inB(x, y)) return;
  removeBuilding(world, models, x, y);
  const i = world.idx(x, y);
  world.road[i] = 0;
  world.zone[i] = 0;
  world.tree[i] = 0;
  world.growth[i] = 0;
}

/** Surface paint tools share one implementation. */
for (const t of ['surf_grass', 'surf_sand', 'surf_rock', 'surf_dirt']) {
  TOOLS[t].apply = (world, models, x, y) => {
    const i = world.idx(x, y);
    if (world.water[i]) return false;
    if (world.surf[i] === TOOLS[t].surf) return false;
    if (world.bld[i]) return false;
    world.surf[i] = TOOLS[t].surf;
    return true;
  };
}

/** Zone paint tools. */
for (const t of ['zone_r', 'zone_c', 'zone_i']) {
  TOOLS[t].apply = (world, models, x, y) => {
    const i = world.idx(x, y);
    if (world.water[i] || world.road[i] || world.bld[i]) return false;
    if (!world.isFlat(x, y)) return false;
    if (world.zone[i] === TOOLS[t].zone) return false;
    world.tree[i] = 0;
    world.zone[i] = TOOLS[t].zone;
    world.growth[i] = 0;
    return true;
  };
}

export function makePlopTool(name, label) {
  return {
    id: name, label, icon: name, cursor: 'single', plop: name, desc: '放置 ' + label,
    apply(world, models, x, y) {
      return !!placeBuilding(world, models, x, y, name, getPlopRotation());
    },
  };
}

let plopRotation = 0;
export function getPlopRotation() { return plopRotation; }
export function rotatePlop() { plopRotation = (plopRotation + 1) % 4; }
export function setPlopRotation(r) { plopRotation = ((r % 4) + 4) % 4; }

export function toolById(id) {
  if (TOOLS[id]) return TOOLS[id];
  return null;
}

export function footprintOf(models, name, rot) {
  const model = models.find((m) => m.name === name);
  return model ? footprint(model, rot) : { fx: 1, fy: 1 };
}

export { TILE_W };
