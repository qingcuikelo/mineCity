/** Asset loading: manifest, atlas pages, baked bitmap font. */

export const assets = {
  manifest: null,
  atlas: [],
  font: null,
  palette: [],
  ready: false,
};

export function hex(index) {
  const [r, g, b] = assets.palette[index];
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function rgb(index) {
  const p = assets.palette[index];
  return `rgb(${p[0]},${p[1]},${p[2]})`;
}

export function sprite(name) {
  const e = assets.manifest.sprites[name];
  if (!e) throw new Error('missing sprite: ' + name);
  return { img: assets.atlas[e.p], x: e.x, y: e.y, w: e.w, h: e.h, ax: e.ax, ay: e.ay };
}

export function hasSprite(name) {
  return !!assets.manifest.sprites[name];
}

export async function loadAssets(base = 'assets/') {
  const manifest = await (await fetch(base + 'manifest.json')).json();
  assets.manifest = manifest;
  assets.palette = manifest.palette;
  assets.atlas = [];
  for (const page of manifest.pages) {
    const img = new Image();
    img.src = base + page.file;
    await img.decode();
    assets.atlas.push(img);
  }
  try {
    const fontData = await (await fetch(base + 'font-glyphs.json')).json();
    assets.font = fontData;
  } catch (err) {
    console.warn('font glyphs missing, run the bakery', err);
    assets.font = { ascii: {}, cjk: {} };
  }
  assets.ready = true;
  return assets;
}
