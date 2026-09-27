/** Isometric camera: fixed 2:1 projection, integer zoom, tile picking. */

import { TILE_W, TILE_H, Z_UNIT, MAX_H } from '../config.js';

export function projectX(X, Y) { return (X - Y) * 0.5; }
export function projectY(X, Y, Z) { return (X + Y) * 0.25 - Z; }

export class Camera {
  constructor(world) {
    this.world = world;
    this.ox = 0;
    this.oy = 0;
    this.zoom = 1;
  }

  centerOn(tileX, tileY, view) {
    const X = (tileX + 0.5) * TILE_W;
    const Y = (tileY + 0.5) * TILE_W;
    const z = 1.5 * Z_UNIT;
    this.ox = view.x + view.w / 2 - projectX(X, Y) * this.zoom;
    this.oy = view.y + view.h / 2 - projectY(X, Y, z) * this.zoom;
  }

  pan(dx, dy) {
    this.ox += dx;
    this.oy += dy;
  }

  worldToScreen(wx, wy, wz = 0, view = { x: 0, y: 0 }) {
    return {
      x: view.x + this.ox + projectX(wx, wy) * this.zoom,
      y: view.y + this.oy + projectY(wx, wy, wz) * this.zoom,
    };
  }

  /** Returns {x, y, h} of the topmost tile under a viewport-relative point. */
  tileAt(sx, sy, view) {
    const u = (sx - view.x - this.ox) / this.zoom;
    const v = (sy - view.y - this.oy) / this.zoom;
    for (let h = MAX_H; h >= 0; h--) {
      const Z = h * Z_UNIT;
      const X = u + 2 * (v + Z);
      const Y = 2 * (v + Z) - u;
      const tx = Math.floor(X / TILE_W);
      const ty = Math.floor(Y / TILE_W);
      if (tx < 0 || ty < 0 || tx >= this.world.w || ty >= this.world.h) continue;
      if (this.world.height[this.world.idx(tx, ty)] === h) return { x: tx, y: ty, h };
    }
    // fall back to the base plane clamped into the map
    const X = u + 2 * v;
    const Y = 2 * v - u;
    const tx = Math.max(0, Math.min(this.world.w - 1, Math.floor(X / TILE_W)));
    const ty = Math.max(0, Math.min(this.world.h - 1, Math.floor(Y / TILE_W)));
    return { x: tx, y: ty, h: this.world.height[this.world.idx(tx, ty)] };
  }

  /** Fractional tile coordinates (for smooth panning feel / brushes). */
  tileF(sx, sy, view) {
    const u = (sx - view.x - this.ox) / this.zoom;
    const v = (sy - view.y - this.oy) / this.zoom;
    return { x: u / TILE_W + v / (TILE_W / 2), y: v / (TILE_W / 2) - u / TILE_W };
  }

  /** Keep the map's isometric bounding box overlapping the viewport. */
  clamp(view) {
    const { world, zoom } = this;
    const m = 4 * TILE_W;
    const maxX = world.w * TILE_W;
    const maxY = world.h * TILE_W;
    const xmin = projectX(0, maxY);
    const xmax = projectX(maxX, 0);
    const ymin = projectY(0, 0, MAX_H * Z_UNIT);
    const ymax = projectY(maxX, maxY, 0);
    const loX = view.x + m - xmax * zoom;
    const hiX = view.x + view.w - m - xmin * zoom;
    const loY = view.y + m - ymax * zoom;
    const hiY = view.y + view.h - m - ymin * zoom;
    this.ox = Math.max(loX, Math.min(hiX, this.ox));
    this.oy = Math.max(loY, Math.min(hiY, this.oy));
  }
}
