/**
 * Scene compositor. Draws terrain, zone overlays, props and buildings in
 * isometric painter order (by diagonal, ties by y) into the logical buffer.
 */

import { assets, sprite } from '../assets.js';
import { projectX, projectY } from './camera.js';
import { TILE_W, Z_UNIT, MAX_H } from '../config.js';
import { TREE_NAMES } from '../game/world.js';

const cache = new Map();

function spr(name) {
  let e = cache.get(name);
  if (!e) {
    e = sprite(name);
    cache.set(name, e);
  }
  return e;
}

/** 0 = full day, 1 = full night. */
export function nightFactor(time) {
  const t = ((time % 24) + 24) % 24;
  if (t >= 8 && t < 17) return 0;
  if (t >= 17 && t < 19.5) return (t - 17) / 2.5;
  if (t >= 19.5 || t < 5) return 1;
  return 1 - (t - 5) / 3;
}

export function waterFrame(clock) {
  return ((Math.floor(Math.max(0, clock) * 1.6) % 4) + 4) % 4;
}

export function drawCity(ctx, world, camera, view, opts = {}) {
  const { models } = opts;
  const nf = opts.night ?? 0;
  const dnIdx = nf >= 0.5 ? 1 : 0;
  const dn = dnIdx ? 'night' : 'day';
  const frame = opts.waterFrame ?? 0;
  const zoom = camera.zoom;
  const ox = view.x + camera.ox;
  const oy = view.y + camera.oy;

  const place = (name, tx, ty, alpha = 1, z = 0) => {
    const e = spr(name);
    const sx = ox + projectX(tx * TILE_W, ty * TILE_W) * zoom;
    const sy = oy + projectY(tx * TILE_W, ty * TILE_W, z) * zoom;
    const dx = sx - e.ax * zoom;
    const dy = sy - e.ay * zoom;
    const w = e.w * zoom, h = e.h * zoom;
    if (dx > view.x + view.w || dy > view.y + view.h || dx + w < view.x || dy + h < view.y) return;
    if (nf > 0 && nf < 1) {
      const day = spr(name.replace(/\/(day|night)$/, '/day'));
      const night = spr(name.replace(/\/(day|night)$/, '/night'));
      ctx.globalAlpha = alpha;
      ctx.drawImage(day.img, day.x, day.y, day.w, day.h, dx, dy, w, h);
      ctx.globalAlpha = alpha * nf;
      ctx.drawImage(night.img, night.x, night.y, night.w, night.h, dx, dy, w, h);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = alpha;
      ctx.drawImage(e.img, e.x, e.y, e.w, e.h, dx, dy, w, h);
      ctx.globalAlpha = 1;
    }
  };

  // visible tile range
  const corners = [
    [view.x, view.y], [view.x + view.w, view.y],
    [view.x, view.y + view.h], [view.x + view.w, view.y + view.h],
  ];
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const [sx, sy] of corners) {
    for (const z of [0, MAX_H * Z_UNIT]) {
      const u = (sx - ox) / zoom;
      const v = (sy - oy) / zoom + z;
      const X = u + 2 * v;
      const Y = 2 * v - u;
      minX = Math.min(minX, X); maxX = Math.max(maxX, X);
      minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
    }
  }
  const margin = 5 * TILE_W;
  const tx0 = Math.max(0, Math.floor((minX - margin) / TILE_W));
  const tx1 = Math.min(world.w - 1, Math.ceil((maxX + margin) / TILE_W));
  const ty0 = Math.max(0, Math.floor((minY - margin) / TILE_W));
  const ty1 = Math.min(world.h - 1, Math.ceil((maxY + margin) / TILE_W));

  const buckets = world.dirtyBuckets || !world.buckets
    ? world.buildBuckets(models)
    : world.buckets;

  const sMin = tx0 + ty0;
  const sMax = tx1 + ty1;
  for (let s = sMin; s <= sMax; s++) {
    const xA = Math.max(tx0, s - ty1);
    const xB = Math.min(tx1, s - ty0);
    for (let x = xA; x <= xB; x++) {
      const y = s - x;
      const i = world.idx(x, y);
      const h = world.height[i];
      if (world.water[i]) {
        const variant = Math.floor(
          (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 27,
        ) % 3;
        place(`w/${frame}/${variant}/${dn}`, x, y);
      } else {
        const surfName = assets.manifest.terrain.surfaces[world.surf[i]];
        const variants = surfName.variants;
        const variant = variants > 1
          ? (Math.imul(x, 2654435761) >>> 28) % variants
          : 0;
        place(`t/${surfName.id}/${variant}/h${h}/${dn}`, x, y);
      }
      if (world.road[i]) place(`road/${world.roadMask(x, y)}/${dn}`, x, y, 1, h * Z_UNIT);
      // zone overlay on empty zoned lots
      const zone = world.zone[i];
      if (zone && world.bld[i] === 0) {
        place(`zone/${['r', 'c', 'i'][zone - 1]}`, x, y, 1 - nf * 0.55, h * Z_UNIT);
        if (!world.roadAdjacent(x, y) && !world.road[i]) place('ui/noroad', x, y, 1 - nf * 0.4, h * Z_UNIT);
      }
    }
    const list = buckets[s];
    for (let k = 0; k < list.length; k++) {
      const o = list[k];
      const oz = world.height[world.idx(o.x, o.y)] * Z_UNIT;
      if (o.kind === 't') {
        place(`pr/${TREE_NAMES[o.v]}/${o.rot}/${dn}`, o.x, o.y, 1, oz);
      } else if (o.kind === 'b') {
        const model = models[o.v];
        place(`b/${model.name}/${o.rot}/${dn}`, o.x, o.y, 1, oz);
      }
    }
  }
}

/** Optional editor grid overlay. */
export function drawGrid(ctx, world, camera, view, color = 'rgba(221,228,234,0.16)') {
  const zoom = camera.zoom;
  const ox = view.x + camera.ox;
  const oy = view.y + camera.oy;
  const pt = (x, y) => [
    ox + projectX(x * TILE_W, y * TILE_W) * zoom,
    oy + projectY(x * TILE_W, y * TILE_W, 0) * zoom,
  ];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = Math.max(1, Math.round(8 / zoom));
  for (let y = 0; y <= world.h; y += step) {
    const a = pt(0, y), b = pt(world.w, y);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  for (let x = 0; x <= world.w; x += step) {
    const a = pt(x, 0), b = pt(x, world.h);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
  ctx.restore();
}

/** Diamond outline covering the tile rectangle [x, x+fx] x [y, y+fy]. */
export function footprintPath(ctx, camera, view, tx, ty, fx = 1, fy = 1, h = 0) {
  const zoom = camera.zoom;
  const ox = view.x + camera.ox;
  const oy = view.y + camera.oy;
  const z = h * Z_UNIT;
  const P = (x, y) => [
    ox + projectX(x, y) * zoom,
    oy + projectY(x, y, z) * zoom,
  ];
  const x0 = tx * TILE_W, y0 = ty * TILE_W;
  const x1 = (tx + fx) * TILE_W, y1 = (ty + fy) * TILE_W;
  const a = P((x0 + x1) / 2, y0);
  const b = P(x1, (y0 + y1) / 2);
  const c = P((x0 + x1) / 2, y1);
  const d = P(x0, (y0 + y1) / 2);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.lineTo(d[0], d[1]);
  ctx.closePath();
}
