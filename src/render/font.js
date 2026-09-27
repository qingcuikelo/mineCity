/**
 * Bitmap font renderer. Glyphs come from tools/font-bakery.html as 1-bit
 * bitmaps; they are packed into a white atlas once, and tinted copies are
 * cached per colour so drawing text is just a series of drawImage calls.
 */

import { assets } from '../assets.js';

const MAX_W = 512;

export class BitmapFont {
  constructor(data) {
    this.glyphs = {};
    this.alt = {};
    const prim = data.ascii || data.asciiAlt || {};
    const alt = data.asciiAlt || {};
    for (const [ch, g] of Object.entries(data.cjk || {})) this.glyphs[ch] = g;
    for (const [ch, g] of Object.entries(prim)) this.glyphs[ch] = g;
    for (const [ch, g] of Object.entries(alt)) if (!this.glyphs[ch]) this.alt[ch] = g;
    this.lineH = 13;
    this.baseline = 10;
    this._pack();
  }

  _pack() {
    const names = Object.keys(this.glyphs);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let x = 0, y = 0, rowH = 0;
    const layout = {};
    // measure pass to size the atlas
    let w = MAX_W;
    const place = (store) => {
      for (const ch of names) {
        const g = store[ch];
        if (!g) continue;
        if (x + g.w + 1 > w) { x = 0; y += rowH + 1; rowH = 0; }
        layout[ch] = { ...g, ax: x, ay: y };
        x += g.w + 1;
        if (g.h > rowH) rowH = g.h;
      }
    };
    place(this.glyphs);
    const h = y + rowH + 2;
    canvas.width = w;
    canvas.height = Math.max(16, h);
    ctx.fillStyle = '#fff';
    for (const ch of names) {
      const l = layout[ch];
      for (let iy = 0; iy < l.h; iy++) {
        for (let ix = 0; ix < l.w; ix++) {
          if (l.bits[iy * l.w + ix] === '1') ctx.fillRect(l.ax + ix, l.ay + iy, 1, 1);
        }
      }
    }
    this.white = canvas;
    this.layout = layout;
    this.tinted = new Map();
  }

  _tint(color) {
    let c = this.tinted.get(color);
    if (c) return c;
    const cv = document.createElement('canvas');
    cv.width = this.white.width;
    cv.height = this.white.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(this.white, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, cv.width, cv.height);
    this.tinted.set(color, cv);
    return cv;
  }

  advanceOf(ch) {
    if (ch === ' ' || ch === '\t') return 4;
    const g = this.layout[ch];
    if (g) return g.adv;
    const q = this.layout['?'];
    return q ? q.adv : 6;
  }

  measure(text, scale = 1) {
    let w = 0;
    for (const ch of text) w += this.advanceOf(ch) * scale;
    return w;
  }

  /** Draw text with y as the baseline. align: left | center | right. */
  draw(ctx, text, x, y, color = '#dde4ea', opts = {}) {
    const scale = opts.scale || 1;
    const align = opts.align || 'left';
    const w = this.measure(text, scale);
    let sx = align === 'center' ? Math.round(x - w / 2) : align === 'right' ? Math.round(x - w) : Math.round(x);
    const atlas = this._tint(color);
    const q = this.layout['?'];
    for (const ch of text) {
      let g = this.layout[ch];
      if (!g && ch !== ' ' && ch !== '\t' && q) g = q;
      if (g) {
        ctx.drawImage(atlas, g.ax, g.ay, g.w, g.h, sx + g.dx * scale, y + g.dy * scale, g.w * scale, g.h * scale);
      }
      sx += this.advanceOf(ch) * scale;
    }
    return w;
  }

  /** Draw with a hard 1px drop shadow (very DOS). */
  drawShadow(ctx, text, x, y, color = '#dde4ea', shadow = '#05070a', opts = {}) {
    this.draw(ctx, text, x + 1, y + 1, shadow, opts);
    return this.draw(ctx, text, x, y, color, opts);
  }
}

let fontInstance = null;

export function initFont() {
  fontInstance = new BitmapFont(assets.font || {});
  return fontInstance;
}

export function font() {
  return fontInstance;
}
