/** Shelf sprite packer + manifest writer. */

export function packSprites(sprites, maxSize = 2048) {
  const order = sprites.map((s, i) => i).sort((a, b) => sprites[b].h - sprites[a].h);
  const pages = [];
  const entries = {};
  let page = null;
  let x = 0, y = 0, rowH = 0;
  const newPage = () => {
    page = { w: maxSize, h: maxSize, data: new Uint8ClampedArray(maxSize * maxSize * 4), usedH: 0 };
    pages.push(page);
    x = 0; y = 0; rowH = 0;
  };
  newPage();
  for (const i of order) {
    const s = sprites[i];
    if (s.w > maxSize || s.h > maxSize) throw new Error(`sprite too large: ${s.name} ${s.w}x${s.h}`);
    if (x + s.w > maxSize) { x = 0; y += rowH + 1; rowH = 0; }
    if (y + s.h > maxSize) { newPage(); }
    for (let ry = 0; ry < s.h; ry++) {
      const src = ry * s.w * 4;
      const dst = ((y + ry) * maxSize + x) * 4;
      page.data.set(s.data.subarray(src, src + s.w * 4), dst);
    }
    entries[s.name] = { p: pages.length - 1, x, y, w: s.w, h: s.h, ax: s.ax, ay: s.ay };
    x += s.w + 1;
    if (s.h > rowH) rowH = s.h;
    if (y + rowH > page.usedH) page.usedH = y + rowH;
  }
  return { pages, entries };
}
