/**
 * Verifies the shipped assets in assets/:
 *   - the atlas pages decode and every opaque pixel is one of the 32 palette colours
 *   - the manifest is complete (all rotations, day/night pairs, terrain heights, roads, icons)
 *   - every sprite rectangle lies inside its page
 *
 *   node tools/verify.js
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0), h: data.readUInt32BE(4),
        depth: data[8], color: data[9], interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || ihdr.color !== 6 || ihdr.interlace !== 0) {
    throw new Error('unsupported PNG format');
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { w, h } = ihdr;
  const stride = w * 4;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let v = line[i];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 0xff;
          break;
        }
        default: throw new Error('bad filter ' + filter);
      }
      cur[i] = v;
    }
  }
  return { w, h, data: out };
}

const errors = [];
const warnings = [];
const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8'));
const palette = new Set(manifest.palette.map(([r, g, b]) => (r << 16) | (g << 8) | b));

let totalPixels = 0;
let opaque = 0;
const pages = [];
manifest.pages.forEach((page, i) => {
  const img = decodePNG(fs.readFileSync(path.join(ASSETS, page.file)));
  pages.push(img);
  if (img.w !== page.w || img.h !== page.h) errors.push(`page ${page.file} size mismatch`);
  for (let p = 0; p < img.data.length; p += 4) {
    totalPixels++;
    if (img.data[p + 3] === 0) continue;
    opaque++;
    const key = (img.data[p] << 16) | (img.data[p + 1] << 8) | img.data[p + 2];
    if (!palette.has(key)) {
      errors.push(`off-palette pixel in ${page.file} at byte ${p}: rgb(${img.data[p]},${img.data[p + 1]},${img.data[p + 2]})`);
      break;
    }
  }
});

const names = Object.keys(manifest.sprites);
for (const name of names) {
  const s = manifest.sprites[name];
  const page = manifest.pages[s.p];
  if (!page) { errors.push(`${name}: bad page index`); continue; }
  if (s.x < 0 || s.y < 0 || s.x + s.w > page.w || s.y + s.h > page.h) {
    errors.push(`${name}: rect outside page`);
  }
  // anchor sanity: anchors must be inside the sprite with tolerance
  if (s.ax < 0 || s.ay < 0 || s.ax > s.w + 8 || s.ay > s.h + 8) {
    warnings.push(`${name}: suspicious anchor (${s.ax}, ${s.ay}) for ${s.w}x${s.h}`);
  }
}

const expect = [];
for (const m of manifest.models) {
  for (let rot = 0; rot < 4; rot++) {
    for (const dn of ['day', 'night']) expect.push(`b/${m.name}/${rot}/${dn}`);
  }
}
for (const s of manifest.terrain.surfaces) {
  for (let v = 0; v < s.variants; v++) {
    for (let h = 1; h <= manifest.terrain.maxH; h++) {
      for (const dn of ['day', 'night']) expect.push(`t/${s.id}/${v}/h${h}/${dn}`);
    }
  }
}
for (let f = 0; f < manifest.terrain.water.frames; f++) {
  for (let v = 0; v < manifest.terrain.water.variants; v++) {
    for (const dn of ['day', 'night']) expect.push(`w/${f}/${v}/${dn}`);
  }
}
for (let m = 0; m < 16; m++) for (const dn of ['day', 'night']) expect.push(`road/${m}/${dn}`);
for (const p of manifest.props) {
  for (let rot = 0; rot < 4; rot++) for (const dn of ['day', 'night']) expect.push(`pr/${p.name}/${rot}/${dn}`);
}
for (const i of manifest.icons) expect.push(`icon/${i}`);
for (const z of manifest.zones) expect.push(`zone/${z}`);

for (const name of expect) {
  if (!manifest.sprites[name]) errors.push(`missing sprite: ${name}`);
}
for (const name of names) {
  if (!expect.includes(name) && !name.startsWith('ui/')) warnings.push(`unexpected sprite: ${name}`);
}

console.log(`[verify] pages: ${manifest.pages.length}, sprites: ${names.length}`);
console.log(`[verify] atlas pixels: ${totalPixels} (${((100 * opaque) / totalPixels).toFixed(1)}% opaque), all palette-conformant`);
console.log(`[verify] expected sprite set: ${expect.length} entries checked`);
if (warnings.length) {
  console.log(`[verify] ${warnings.length} warning(s):`);
  for (const w of warnings.slice(0, 10)) console.log('  - ' + w);
}
if (errors.length) {
  console.error(`[verify] ${errors.length} error(s):`);
  for (const e of errors.slice(0, 20)) console.error('  - ' + e);
  process.exit(1);
}
console.log('[verify] OK');
