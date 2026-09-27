/**
 * City world: typed-array tile grid + procedural map generation + draw buckets.
 */

import { MAP_W, MAP_H, MAX_H, TILE_W } from '../config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(seed) {
  const v = (ix, iy) => hash2(ix, iy, seed);
  const sample = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = v(ix, iy), b = v(ix + 1, iy), c = v(ix, iy + 1), d = v(ix + 1, iy + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
  return (x, y, octaves = 4, scale = 0.035) => {
    let sum = 0, amp = 1, norm = 0, f = scale;
    for (let o = 0; o < octaves; o++) {
      sum += sample(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.1;
    }
    return sum / norm;
  };
}

export const TREE_NAMES = ['tree_a', 'tree_b', 'pine_a', 'pine_b', 'bush', 'rock'];

export class World {
  constructor(w = MAP_W, h = MAP_H) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.height = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.surf = new Uint8Array(n);
    this.zone = new Uint8Array(n);
    this.road = new Uint8Array(n);
    this.bld = new Uint16Array(n);      // 0 = empty, 0xffff = part of another tile's building
    this.brot = new Uint8Array(n);
    this.tree = new Uint8Array(n);      // 0..3 => TREE_NAMES index+1
    this.treeRot = new Uint8Array(n);
    this.growth = new Float32Array(n);
    this.version = 0;
    this.buckets = null;
    this.dirtyBuckets = true;
    this.seed = 1;
  }

  idx(x, y) { return y * this.w + x; }
  inB(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  isLand(x, y) { return this.inB(x, y) && this.water[this.idx(x, y)] === 0; }
  isWater(x, y) { return this.inB(x, y) && this.water[this.idx(x, y)] === 1; }
  heightAt(x, y) { return this.inB(x, y) ? this.height[this.idx(x, y)] : 0; }
  isEmpty(x, y) {
    const i = this.idx(x, y);
    return this.bld[i] === 0 && this.tree[i] === 0 && this.road[i] === 0;
  }

  touch() {
    this.version++;
    this.dirtyBuckets = true;
  }

  /** Land tile with all four neighbours on the same level (buildable plot). */
  isFlat(x, y) {
    if (!this.isLand(x, y)) return false;
    const h = this.height[this.idx(x, y)];
    return this.heightAt(x + 1, y) === h && this.heightAt(x - 1, y) === h
      && this.heightAt(x, y + 1) === h && this.heightAt(x, y - 1) === h
      && this.isLand(x + 1, y) && this.isLand(x - 1, y)
      && this.isLand(x, y + 1) && this.isLand(x, y - 1);
  }

  /** Model index (1-based) of the building covering a tile, or 0. */
  buildingAt(x, y) {
    if (!this.inB(x, y)) return 0;
    const b = this.bld[this.idx(x, y)];
    if (b === 0) return 0;
    return b === 0xffff ? -1 : b;
  }

  /** Find the anchor tile of the building covering (x, y). */
  buildingAnchor(x, y, models) {
    for (let dy = 0; dy <= 4; dy++) {
      for (let dx = 0; dx <= 4; dx++) {
        const ax = x - dx, ay = y - dy;
        if (!this.inB(ax, ay)) continue;
        const b = this.bld[this.idx(ax, ay)];
        if (b === 0 || b === 0xffff) continue;
        const model = models[b - 1];
        if (!model) continue;
        const odd = this.brot[this.idx(ax, ay)] % 2 === 1;
        const fx = odd ? model.fy : model.fx;
        const fy = odd ? model.fx : model.fy;
        if (x >= ax && x < ax + fx && y >= ay && y < ay + fy) return { x: ax, y: ay, model: b - 1 };
      }
    }
    return null;
  }

  roadMask(x, y) {
    if (!this.inB(x, y) || this.road[this.idx(x, y)] === 0) return 0;
    let m = 0;
    if (this.inB(x + 1, y) && this.road[this.idx(x + 1, y)]) m |= 1;
    if (this.inB(x, y + 1) && this.road[this.idx(x, y + 1)]) m |= 2;
    if (this.inB(x - 1, y) && this.road[this.idx(x - 1, y)]) m |= 4;
    if (this.inB(x, y - 1) && this.road[this.idx(x, y - 1)]) m |= 8;
    return m || 0;
  }

  roadAdjacent(x, y) {
    return (this.inB(x + 1, y) && this.road[this.idx(x + 1, y)])
      || (this.inB(x - 1, y) && this.road[this.idx(x - 1, y)])
      || (this.inB(x, y + 1) && this.road[this.idx(x, y + 1)])
      || (this.inB(x, y - 1) && this.road[this.idx(x, y - 1)]);
  }

  /** Generate terrain from a seed. */
  generate(seed = 20240927, opts = {}) {
    const waterLevel = opts.waterLevel ?? 0.34;
    const rough = opts.rough ?? 1;
    const rng = mulberry32(seed);
    const noise = valueNoise(seed);
    this.seed = seed;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        let n = noise(x, y, 4, 0.032 * rough);
        n = Math.pow(n, 1.15);
        n += (hash2(x, y, seed + 5) - 0.5) * 0.03;
        if (n < waterLevel) {
          this.water[i] = 1;
          this.height[i] = 0;
        } else {
          this.water[i] = 0;
          const t = (n - waterLevel) / (1 - waterLevel);
          this.height[i] = Math.max(1, Math.min(MAX_H, 1 + Math.floor(t * MAX_H * 0.999)));
        }
        // surface
        if (this.water[i]) {
          this.surf[i] = 0;
        } else if (this.height[i] >= 5) {
          this.surf[i] = 2;
        } else if (this.height[i] === 1 && n < waterLevel + 0.07) {
          this.surf[i] = 1;
        } else if (hash2(x, y, seed + 9) > 0.93) {
          this.surf[i] = 3;
        } else {
          this.surf[i] = 0;
        }
        // forest
        this.tree[i] = 0;
        if (!this.water[i] && this.surf[i] === 0) {
          const forest = noise(x + 511, y + 917, 3, 0.06);
          const th = 0.62;
          if (forest > th && hash2(x, y, seed + 11) > 0.55) {
            this.tree[i] = 1 + Math.floor(hash2(x, y, seed + 13) * 4) % 4;
            this.treeRot[i] = Math.floor(hash2(x, y, seed + 17) * 4) % 4;
          } else if (hash2(x, y, seed + 19) > 0.9) {
            this.tree[i] = 1 + Math.floor(hash2(x, y, seed + 23) * 4) % 4;
            this.treeRot[i] = Math.floor(hash2(x, y, seed + 29) * 4) % 4;
          }
        }
        this.zone[i] = 0;
        this.road[i] = 0;
        this.bld[i] = 0;
        this.growth[i] = 0;
      }
    }
    this.touch();
  }

  /** Rebuild the diagonal draw buckets (buildings sorted by front diagonal). */
  buildBuckets(models) {
    const diag = [];
    const total = this.w + this.h;
    for (let i = 0; i < total * 2; i++) diag.push([]);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        if (this.tree[i]) {
          diag[x + y].push({ x, y, kind: 't', v: this.tree[i] - 1, rot: this.treeRot[i] });
        }
        const b = this.bld[i];
        if (b > 0 && b !== 0xffff) {
          const model = models[b - 1];
          if (!model) continue;
          const fx = model.fx, fy = model.fy;
          const odd = this.brot[i] === 1 || this.brot[i] === 3;
          const w = odd ? fy : fx;
          const d = odd ? fx : fy;
          diag[(x + w - 1) + (y + d - 1)].push({ x, y, kind: 'b', v: b - 1, rot: this.brot[i] });
        }
      }
    }
    for (const list of diag) list.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    this.buckets = diag;
    this.dirtyBuckets = false;
    return diag;
  }

  serialize() {
    const b64 = (arr, Type) => {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      let s = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
      return btoa(s);
    };
    return {
      w: this.w, h: this.h, seed: this.seed,
      height: b64(this.height), water: b64(this.water), surf: b64(this.surf),
      zone: b64(this.zone), road: b64(this.road), brot: b64(this.brot),
      tree: b64(this.tree), treeRot: b64(this.treeRot),
      bld: b64(new Uint8Array(this.bld.buffer)),
    };
  }

  deserialize(data) {
    const dec = (s, Type) => {
      const bin = atob(s);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Type(bytes.buffer);
    };
    this.w = data.w; this.h = data.h; this.seed = data.seed;
    this.height = dec(data.height, Uint8Array);
    this.water = dec(data.water, Uint8Array);
    this.surf = dec(data.surf, Uint8Array);
    this.zone = dec(data.zone, Uint8Array);
    this.road = dec(data.road, Uint8Array);
    this.brot = dec(data.brot, Uint8Array);
    this.tree = dec(data.tree, Uint8Array);
    this.treeRot = dec(data.treeRot, Uint8Array);
    this.bld = dec(data.bld, Uint16Array);
    this.growth = new Float32Array(this.w * this.h);
    this.touch();
  }
}

export { TILE_W };

/** Footprint of a model for a given rotation (in tiles). */
export function footprint(model, rot) {
  const odd = rot % 2 === 1;
  return { fx: odd ? model.fy : model.fx, fy: odd ? model.fx : model.fy };
}

/**
 * Place a building if every footprint tile is flat land and free.
 * Trees are cleared automatically. Returns the model index or 0.
 */
export function placeBuilding(world, models, x, y, name, rot = 0) {
  const mi = models.findIndex((m) => m.name === name);
  if (mi < 0) return 0;
  const model = models[mi];
  const { fx, fy } = footprint(model, rot);
  if (x < 0 || y < 0 || x + fx > world.w || y + fy > world.h) return 0;
  for (let dy = 0; dy < fy; dy++) {
    for (let dx = 0; dx < fx; dx++) {
      const i = world.idx(x + dx, y + dy);
      if (!world.isLand(x + dx, y + dy)) return 0;
      if (!world.isFlat(x + dx, y + dy)) return 0;
      if (world.bld[i] || world.road[i]) return 0;
    }
  }
  for (let dy = 0; dy < fy; dy++) {
    for (let dx = 0; dx < fx; dx++) {
      const i = world.idx(x + dx, y + dy);
      world.tree[i] = 0;
      world.bld[i] = 0xffff;
    }
  }
  const i0 = world.idx(x, y);
  world.bld[i0] = mi + 1;
  world.brot[i0] = rot % 4;
  world.touch();
  return mi + 1;
}

/** Remove any building covering (x, y). Returns true if one was removed. */
export function removeBuilding(world, models, x, y) {
  const hit = world.buildingAnchor(x, y, models);
  if (!hit) return false;
  const model = models[hit.model];
  const { fx, fy } = footprint(model, world.brot[world.idx(hit.x, hit.y)]);
  for (let dy = 0; dy < fy; dy++) {
    for (let dx = 0; dx < fx; dx++) {
      const i = world.idx(hit.x + dx, hit.y + dy);
      world.bld[i] = 0;
      world.brot[i] = 0;
      world.growth[i] = 0;
    }
  }
  world.touch();
  return true;
}
