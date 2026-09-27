/** DOS-era UI widgets drawn with the game palette (no images needed). */

import { hex } from '../assets.js';
import { font } from '../render/font.js';

const FACE = 2, LIGHT = 6, SHADE = 1, INK = 0, TITLE = 29, TITLE_DARK = 28, TEXT = 7, DIM = 4, ACCENT = 21;

const patternCache = new Map();

/** 1px checkerboard pattern between two palette colours (dithered fills). */
export function checker(colorA, colorB = null) {
  const key = colorA + '|' + colorB;
  let p = patternCache.get(key);
  if (p) return p;
  const c = document.createElement('canvas');
  c.width = 2; c.height = 2;
  const g = c.getContext('2d');
  g.fillStyle = hex(colorA);
  g.fillRect(0, 0, 2, 2);
  if (colorB !== null) {
    g.fillStyle = hex(colorB);
    g.fillRect(0, 0, 1, 1);
    g.fillRect(1, 1, 1, 1);
  }
  p = c;
  patternCache.set(key, p);
  return p;
}

export function bevel(ctx, x, y, w, h, pressed = false, face = FACE) {
  ctx.fillStyle = hex(face);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = hex(pressed ? SHADE : LIGHT);
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = hex(pressed ? LIGHT : SHADE);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
  ctx.fillStyle = hex(INK);
  ctx.strokeStyle = hex(INK);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Classic window frame with title bar. Returns the client rect. */
export function panel(ctx, x, y, w, h, title = null) {
  bevel(ctx, x, y, w, h, false, FACE);
  let top = y + 2;
  if (title) {
    ctx.fillStyle = hex(TITLE);
    ctx.fillRect(x + 2, y + 2, w - 4, 12);
    ctx.fillStyle = hex(TITLE_DARK);
    ctx.fillRect(x + 2, y + 12, w - 4, 1);
    font().draw(ctx, title, x + 4, y + 12, hex(TEXT));
    top = y + 14;
  }
  return { x: x + 3, y: top + 1, w: w - 6, h: h - (top - y) - 3 };
}

export function text(ctx, str, x, y, color = TEXT, opts = {}) {
  return font().draw(ctx, str, x, y, hex(color), opts);
}

export function textShadow(ctx, str, x, y, color = TEXT, opts = {}) {
  return font().drawShadow(ctx, str, x, y, hex(color), hex(INK), opts);
}

export function button(ctx, rect, label, opts = {}) {
  const { pressed = false, disabled = false, hover = false, icon = null, iconScale = 0.72, color = TEXT } = opts;
  bevel(ctx, rect.x, rect.y, rect.w, rect.h, pressed, disabled ? 3 : FACE);
  if (hover && !disabled && !pressed) {
    ctx.fillStyle = hex(3);
    ctx.fillRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
  }
  if (icon) {
    const w = icon.w * iconScale, h = icon.h * iconScale;
    const ix = rect.x + (rect.w - w) / 2;
    ctx.globalAlpha = disabled ? 0.45 : 1;
    ctx.drawImage(icon.img, icon.x, icon.y, icon.w, icon.h, Math.round(ix), Math.round(rect.y + 2), Math.round(w), Math.round(h));
    ctx.globalAlpha = 1;
  }
  if (label) {
    const ly = icon ? rect.y + rect.h - 4 : rect.y + rect.h / 2 + 4;
    text(ctx, label, rect.x + rect.w / 2, ly, disabled ? DIM : color, { align: 'center' });
  }
}

export function meter(ctx, rect, value, onColor = 25, offColor = 3) {
  ctx.fillStyle = hex(offColor);
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const fill = Math.max(0, Math.min(1, value)) * rect.w;
  ctx.fillStyle = hex(onColor);
  ctx.fillRect(rect.x, rect.y, Math.round(fill), rect.h);
  // dithered leading edge
  ctx.fillStyle = checker(onColor);
  ctx.fillRect(rect.x + Math.round(fill), rect.y, 2, rect.h);
  ctx.strokeStyle = hex(INK);
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}

export function sliderTrack(ctx, rect, value, opts = {}) {
  const { marks = null } = opts;
  bevel(ctx, rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2, true, 3);
  const px = rect.x + 1 + Math.round((rect.w - 2 - 9) * Math.max(0, Math.min(1, value)));
  // track
  ctx.fillStyle = hex(1);
  ctx.fillRect(rect.x + 1, rect.y + Math.floor(rect.h / 2) - 1, rect.w - 2, 2);
  ctx.fillStyle = hex(ACCENT);
  ctx.fillRect(rect.x + 1, rect.y + Math.floor(rect.h / 2) - 1, Math.max(0, px - rect.x - 1), 2);
  // handle
  bevel(ctx, px, rect.y, 9, rect.h, false, 6);
  if (marks) {
    for (const m of marks) {
      const mx = rect.x + 1 + Math.round((rect.w - 2) * m);
      ctx.fillStyle = hex(1);
      ctx.fillRect(mx, rect.y + rect.h - 2, 1, 2);
    }
  }
}

export function checkbox(ctx, x, y, checked, label) {
  bevel(ctx, x, y, 11, 11, true, 7);
  if (checked) {
    ctx.fillStyle = hex(1);
    ctx.fillRect(x + 3, y + 3, 5, 5);
  }
  if (label) text(ctx, label, x + 15, y + 9, TEXT);
}

export function hline(ctx, x, y, w, color = SHADE) {
  ctx.fillStyle = hex(color);
  ctx.fillRect(x, y, w, 1);
}
