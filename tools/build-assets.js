/**
 * Offline asset build: renders every sprite with the software rasteriser,
 * quantises to the 32 colour palette and packs everything into atlas pages.
 *
 *   node tools/build-assets.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.js';
import { packSprites } from './atlas.js';
import { renderSprite, addShadow, Mesh } from './raster.js';
import { PALETTE } from './palette.js';
import { BUILDINGS, buildModelMesh } from './models/buildings.js';
import {
  SURFACES, MAX_H, buildLandTile, buildWaterTile, buildZoneOverlay, buildNoRoad, ZONE_COLORS,
} from './models/terrain.js';
import { ROAD_MASKS, buildRoadTile } from './models/roads.js';
import { PROPS, buildProp } from './models/props.js';
import { GLYPHS, glyphSprite, buildDozerIcon } from './models/icons.js';
import { writePreview } from './preview.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets');

const sprites = [];
const push = (name, spr) => sprites.push({ name, ...spr });

const t0 = Date.now();

/* ---------------- buildings: 4 rotations x day/night ---------------- */
for (const model of BUILDINGS) {
  for (let rot = 0; rot < 4; rot++) {
    const m = buildModelMesh(model);
    for (let i = 0; i < rot; i++) m.rotate90();
    addShadow(m);
    for (const dn of ['day', 'night']) {
      push(`b/${model.name}/${rot}/${dn}`, renderSprite(m, { night: dn === 'night', seed: rot * 7 + 1 }));
    }
  }
}

/* ---------------- terrain ---------------- */
for (const surf of SURFACES) {
  for (let v = 0; v < surf.variants; v++) {
    for (let h = 1; h <= MAX_H; h++) {
      const m = buildLandTile(surf.id, v, h);
      for (const dn of ['day', 'night']) {
        push(`t/${surf.id}/${v}/h${h}/${dn}`, renderSprite(m, { night: dn === 'night' }));
      }
    }
  }
}
for (let f = 0; f < 4; f++) {
  for (let v = 0; v < 3; v++) {
    const m = buildWaterTile(f, v);
    for (const dn of ['day', 'night']) {
      push(`w/${f}/${v}/${dn}`, renderSprite(m, { night: dn === 'night' }));
    }
  }
}

/* ---------------- roads ---------------- */
for (const mask of ROAD_MASKS) {
  const m = buildRoadTile(mask);
  for (const dn of ['day', 'night']) {
    push(`road/${mask}/${dn}`, renderSprite(m, { night: dn === 'night' }));
  }
}

/* ---------------- props ---------------- */
for (const prop of PROPS) {
  for (let rot = 0; rot < 4; rot++) {
    const m = buildProp(prop.name);
    for (let i = 0; i < rot; i++) m.rotate90About(32, 32);
    for (const dn of ['day', 'night']) {
      push(`pr/${prop.name}/${rot}/${dn}`, renderSprite(m, { night: dn === 'night' }));
    }
  }
}

/* ---------------- overlays ---------------- */
for (const z of ['r', 'c', 'i']) push(`zone/${z}`, renderSprite(buildZoneOverlay(z), {}));
push('ui/noroad', renderSprite(buildNoRoad(), {}));

/* ---------------- icons ---------------- */
const ICON_BOX = 44;

function fitIcon(spr) {
  const out = { w: ICON_BOX, h: ICON_BOX, ax: ICON_BOX / 2, ay: ICON_BOX / 2, data: new Uint8ClampedArray(ICON_BOX * ICON_BOX * 4) };
  const ox = Math.floor((ICON_BOX - spr.w) / 2);
  const oy = Math.floor((ICON_BOX - spr.h) / 2);
  for (let y = 0; y < spr.h; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= ICON_BOX) continue;
    for (let x = 0; x < spr.w; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= ICON_BOX) continue;
      const s = (y * spr.w + x) * 4;
      const d = (ty * ICON_BOX + tx) * 4;
      out.data[d] = spr.data[s];
      out.data[d + 1] = spr.data[s + 1];
      out.data[d + 2] = spr.data[s + 2];
      out.data[d + 3] = spr.data[s + 3];
    }
  }
  return out;
}

function modelIcon(mesh, scale = 0.42) {
  let spr = renderSprite(mesh, { scale });
  while ((spr.w > ICON_BOX || spr.h > ICON_BOX) && scale > 0.15) {
    scale *= 0.85;
    spr = renderSprite(mesh, { scale });
  }
  return fitIcon(spr);
}

const iconNames = [];
for (const model of BUILDINGS) {
  const m = buildModelMesh(model);
  m.rotate90();
  const spr = modelIcon(m);
  push(`icon/${model.name}`, spr);
  iconNames.push(model.name);
}
{
  const spr = modelIcon(buildDozerIcon(), 0.5);
  push('icon/bulldoze', spr);
  iconNames.push('bulldoze');
  const road = modelIcon(buildRoadTile(5), 0.62);
  push('icon/road', road);
  iconNames.push('road');
  for (const surf of SURFACES) {
    const spr2 = modelIcon(buildLandTile(surf.id, 0, 3), 0.62);
    push(`icon/${surf.id}`, spr2);
    iconNames.push(surf.id);
  }
  for (const p of ['bush', 'rock', 'tree_a', 'pine_a']) {
    const prop = PROPS.find((x) => x.name === p);
    const mesh = new Mesh();
    prop.build(mesh);
    const spr2 = modelIcon(mesh, 0.62);
    push(`icon/${p}_icon`, spr2);
    iconNames.push(`${p}_icon`);
  }
}
for (const name of Object.keys(GLYPHS)) {
  push(`icon/${name}`, glyphSprite(name));
  iconNames.push(name);
}

/* ---------------- glyph validation ---------------- */
for (const [name, rows] of Object.entries(GLYPHS)) {
  rows.forEach((row, i) => {
    if (row.length !== 16) throw new Error(`glyph ${name} row ${i} has length ${row.length}, expected 16`);
    for (const ch of row) {
      if (ch !== '.' && !/[0-9A-P]/.test(ch)) throw new Error(`glyph ${name} row ${i}: bad char '${ch}'`);
    }
  });
}

/* ---------------- palette conformance ---------------- */
const lut = new Set(PALETTE.map(([r, g, b]) => (r << 16) | (g << 8) | b));
let badPixels = 0;
let opaquePixels = 0;
for (const s of sprites) {
  for (let i = 0; i < s.data.length; i += 4) {
    if (s.data[i + 3] === 0) continue;
    opaquePixels++;
    const key = (s.data[i] << 16) | (s.data[i + 1] << 8) | s.data[i + 2];
    if (!lut.has(key)) {
      badPixels++;
      if (badPixels < 5) console.error(`off-palette pixel in ${s.name}`);
    }
  }
}

/* ---------------- pack + write ---------------- */
const { pages, entries } = packSprites(sprites, 2048);
fs.mkdirSync(OUT, { recursive: true });
const pageMeta = [];
pages.forEach((pg, i) => {
  const h = Math.min(pg.h, pg.usedH + 2);
  const trimmed = new Uint8ClampedArray(pg.w * h * 4);
  trimmed.set(pg.data.subarray(0, pg.w * h * 4));
  const file = `atlas${i}.png`;
  fs.writeFileSync(path.join(OUT, file), encodePNG(pg.w, h, trimmed));
  pageMeta.push({ file, w: pg.w, h });
});

const manifest = {
  version: 1,
  generated: new Date().toISOString(),
  palette: PALETTE.map(([r, g, b]) => [r, g, b]),
  pages: pageMeta,
  sprites: entries,
  models: BUILDINGS.map((b) => ({ name: b.name, cls: b.cls, tier: b.tier, fx: b.fx, fy: b.fy, label: b.label || b.name })),
  terrain: {
    maxH: MAX_H,
    surfaces: SURFACES.map((s) => ({ id: s.id, variants: s.variants, label: s.label })),
    water: { frames: 4, variants: 3 },
  },
  props: PROPS.map((p) => ({ name: p.name, label: p.label })),
  zones: Object.keys(ZONE_COLORS),
  icons: iconNames,
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

writePreview(manifest, path.join(OUT, 'preview.html'));

const ms = Date.now() - t0;
console.log(`[assets] ${sprites.length} sprites -> ${pages.length} page(s), ${(pageMeta[0]?.w)}x${pageMeta[0]?.h}`);
console.log(`[assets] opaque px: ${opaquePixels}, off-palette px: ${badPixels}`);
console.log(`[assets] done in ${ms} ms`);
if (badPixels > 0) process.exitCode = 1;
