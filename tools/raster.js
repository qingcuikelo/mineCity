/**
 * Minimal software rasteriser for the offline pre-render pipeline.
 *
 * World space is in "plan pixels": 1 tile = 64 x 64 plan px, 1 z unit = 16 px.
 * Fixed 2:1 isometric orthographic camera:
 *   sx = (X - Y) / 2
 *   sy = (X + Y) / 4 - Z
 * Depth (larger = closer to camera): W = X + Y + 2Z
 *
 * Flat-shaded only (no PBR): materials return continuous RGB, a fixed
 * directional shading term is applied, then ramp-aware ordered dithering
 * quantises everything to the 32 colour palette.
 */

import { quantize, BAYER4, PALETTE as paletteRef } from './palette.js';

export const TILE = 64;
export const ZUNIT = 16;

export function projectX(X, Y, scale = 1) { return (X - Y) * 0.5 * scale; }
export function projectY(X, Y, Z, scale = 1) { return ((X + Y) * 0.25 - Z) * scale; }
export function depthW(X, Y, Z) { return X + Y + 2 * Z; }

/** Fixed stylised light: +Y faces catch light, +X faces in shade, tops brightest. */
export function shadeOf(nx, ny, nz) {
  const s = 0.12 + 0.55 * nx + 0.75 * ny + 0.85 * nz;
  return Math.max(0.32, Math.min(1.0, s));
}

const NIGHT_MUL = [0.52, 0.57, 0.76];

export class Mesh {
  constructor() {
    this.verts = [];
    this.tris = [];
  }

  v(x, y, z) {
    this.verts.push([x, y, z]);
    return this.verts.length - 1;
  }

  tri(a, b, c, mat) { this.tris.push([a, b, c, mat]); }
  quad(a, b, c, d, mat) { this.tri(a, b, c, mat); this.tri(a, c, d, mat); }

  /** Flat polygon at height z; pts is a list of [x, y]. */
  flatPoly(pts, z, mat) {
    const idx = pts.map(([x, y]) => this.v(x, y, z));
    for (let i = 1; i < idx.length - 1; i++) this.tri(idx[0], idx[i], idx[i + 1], mat);
  }

  /**
   * Axis aligned box. `mats` may be a single material or an object with
   * { top, bottom, xp, xn, yp, yn } overrides.
   */
  box(x0, y0, z0, x1, y1, z1, mats) {
    const m = typeof mats === 'function' ? { top: mats, bottom: mats, xp: mats, xn: mats, yp: mats, yn: mats } : mats;
    const top = m.top || m.all, bottom = m.bottom || m.all;
    const xp = m.xp || m.all, xn = m.xn || m.all, yp = m.yp || m.all, yn = m.yn || m.all;
    const a0 = this.v(x0, y0, z0), b0 = this.v(x1, y0, z0), c0 = this.v(x1, y1, z0), d0 = this.v(x0, y1, z0);
    const a1 = this.v(x0, y0, z1), b1 = this.v(x1, y0, z1), c1 = this.v(x1, y1, z1), d1 = this.v(x0, y1, z1);
    if (top) this.quad(a1, b1, c1, d1, top);
    if (bottom) this.quad(a0, d0, c0, b0, bottom);
    if (xp) this.quad(b0, c0, c1, b1, xp);
    if (xn) this.quad(d0, a0, a1, d1, xn);
    if (yp) this.quad(c0, d0, d1, c1, yp);
    if (yn) this.quad(a0, b0, b1, a1, yn);
  }

  /** Gable roof prism on top of a box between z1 and z2, ridge along `axis`. */
  gable(x0, y0, z1, x1, y1, z2, axis, mats) {
    const roof = mats.roof || mats.all;
    const end = mats.end || mats.all || roof;
    if (axis === 'x') {
      const cy = (y0 + y1) / 2;
      const r0 = this.v(x0, cy, z2), r1 = this.v(x1, cy, z2);
      const g0 = this.v(x0, y1, z1), g1 = this.v(x1, y1, z1);
      const f0 = this.v(x0, y0, z1), f1 = this.v(x1, y0, z1);
      this.quad(g0, g1, r1, r0, roof);
      this.quad(f1, f0, r0, r1, roof);
      this.tri(g0, r0, f0, end);
      this.tri(f1, r1, g1, end);
    } else {
      const cx = (x0 + x1) / 2;
      const r0 = this.v(cx, y0, z2), r1 = this.v(cx, y1, z2);
      const g0 = this.v(x0, y0, z1), g1 = this.v(x0, y1, z1);
      const f0 = this.v(x1, y0, z1), f1 = this.v(x1, y1, z1);
      this.quad(g0, g1, r1, r0, roof);
      this.quad(f1, f0, r0, r1, roof);
      this.tri(g0, r0, f0, end);
      this.tri(f1, r1, g1, end);
    }
  }

  /** Pyramid (hip) roof: apex above the centre of the rectangle. */
  pyramid(x0, y0, z1, x1, y1, z2, mats) {
    const roof = mats.roof || mats.all;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const a = this.v(x0, y0, z1), b = this.v(x1, y0, z1), c = this.v(x1, y1, z1), d = this.v(x0, y1, z1);
    const apex = this.v(cx, cy, z2);
    this.tri(a, b, apex, roof);
    this.tri(b, c, apex, roof);
    this.tri(c, d, apex, roof);
    this.tri(d, a, apex, roof);
  }

  /** Vertical cylinder. */
  cylinder(cx, cy, z0, z1, r, segs, mats) {
    const side = mats.side || mats.all;
    const top = mats.top || mats.all;
    const ring0 = [], ring1 = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      ring0.push(this.v(x, y, z0));
      ring1.push(this.v(x, y, z1));
    }
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      this.quad(ring0[i], ring0[j], ring1[j], ring1[i], side);
    }
    if (top) {
      const c = this.v(cx, cy, z1);
      for (let i = 0; i < segs; i++) this.tri(ring1[i], ring1[(i + 1) % segs], c, top);
    }
  }

  /** Cone. */
  cone(cx, cy, z0, z1, r, segs, mats) {
    const side = mats.side || mats.all;
    const ring = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      ring.push(this.v(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z0));
    }
    const apex = this.v(cx, cy, z1);
    for (let i = 0; i < segs; i++) this.tri(ring[i], ring[(i + 1) % segs], apex, side);
  }

  bounds() {
    let mx = 0, my = 0, mz = 0;
    for (const [x, y, z] of this.verts) {
      if (x > mx) mx = x;
      if (y > my) my = y;
      if (z > mz) mz = z;
    }
    return { maxX: mx, maxY: my, maxZ: mz };
  }

  /** Rotate 90 degrees clockwise in plan space, keeping the min corner at origin. */
  rotate90() {
    const { maxX } = this.bounds();
    for (const p of this.verts) p.splice(0, 2, p[1], maxX - p[0]);
  }

  /** Rotate 90 degrees in plan space around a centre point (for centred props). */
  rotate90About(cx, cy) {
    for (const p of this.verts) p.splice(0, 2, cx + (p[1] - cy), cy - (p[0] - cx));
  }
}

/**
 * Rasterise a mesh into a sprite.
 * @returns {{data: Uint8ClampedArray, w: number, h: number, ax: number, ay: number}}
 */
export function renderSprite(mesh, opts = {}) {
  const scale = opts.scale ?? 1;
  const night = !!opts.night;
  const seed = opts.seed ?? 1;
  const pad = opts.pad ?? 2;

  const n = mesh.verts.length;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pw = new Float32Array(n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const [X, Y, Z] = mesh.verts[i];
    const sx = projectX(X, Y, scale);
    const sy = projectY(X, Y, Z, scale);
    px[i] = sx; py[i] = sy; pw[i] = depthW(X, Y, Z);
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  if (!isFinite(minX)) {
    return { data: new Uint8ClampedArray(4), w: 1, h: 1, ax: 0, ay: 0 };
  }
  const ox = -minX + pad;
  const oy = -minY + pad;
  const w = Math.round(maxX - minX) + pad * 2;
  const h = Math.round(maxY - minY) + pad * 2;
  const data = new Uint8ClampedArray(w * h * 4);
  const zbuf = new Float32Array(w * h).fill(-Infinity);
  const ctx = { night, seed, scale };
  const N = [0, 0, 0];

  for (const [ia, ib, ic, mat] of mesh.tris) {
    if (!mat) continue;
    const ax = px[ia] + ox, ay = py[ia] + oy;
    const bx = px[ib] + ox, by = py[ib] + oy;
    const cx = px[ic] + ox, cy = py[ic] + oy;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    const inv = 1 / area;

    // face normal from world space
    const va = mesh.verts[ia], vb = mesh.verts[ib], vc = mesh.verts[ic];
    const e1x = vb[0] - va[0], e1y = vb[1] - va[1], e1z = vb[2] - va[2];
    const e2x = vc[0] - va[0], e2y = vc[1] - va[1], e2z = vc[2] - va[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    N[0] = nx / nl; N[1] = ny / nl; N[2] = nz / nl;
    const shade = shadeOf(N[0], N[1], N[2]);

    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    const wa = pw[ia], wb = pw[ib], wc = pw[ic];
    const PA = mesh.verts[ia], PB = mesh.verts[ib], PC = mesh.verts[ic];
    const P = [0, 0, 0];

    for (let y = y0; y <= y1; y++) {
      const fy = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const fx = x + 0.5;
        const w0 = ((bx - fx) * (cy - fy) - (by - fy) * (cx - fx)) * inv;
        if (w0 < 0) continue;
        const w1 = ((cx - fx) * (ay - fy) - (cy - fy) * (ax - fx)) * inv;
        if (w1 < 0) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < 0) continue;
        const depth = w0 * wa + w1 * wb + w2 * wc;
        const idx = y * w + x;
        if (depth <= zbuf[idx]) continue;

        P[0] = w0 * PA[0] + w1 * PB[0] + w2 * PC[0];
        P[1] = w0 * PA[1] + w1 * PB[1] + w2 * PC[1];
        P[2] = w0 * PA[2] + w1 * PB[2] + w2 * PC[2];
        const col = mat(P, N, ctx);
        if (!col) continue;
        const emissive = col[3] === 'e';
        let a = typeof col[3] === 'number' ? col[3] : 255;
        if (!emissive && a === 255) {
          const ao = 0.84 + 0.16 * Math.min(1, P[2] / 48);
          const mul = night ? [NIGHT_MUL[0] * ao, NIGHT_MUL[1] * ao, NIGHT_MUL[2] * ao] : [shade * ao, shade * ao, shade * ao];
          col[0] *= mul[0]; col[1] *= mul[1]; col[2] *= mul[2];
        }
        if (a < 255) {
          const threshold = (BAYER4[y & 3][x & 3] + 0.5) / 16;
          if (threshold >= a / 255) continue;
          a = 255;
        }
        const ci = quantize(col[0], col[1], col[2], x, y, !!col.crisp);
        const p = idx * 4;
        const pc = paletteRef[ci];
        data[p] = pc[0]; data[p + 1] = pc[1]; data[p + 2] = pc[2]; data[p + 3] = a;
        zbuf[idx] = depth;
      }
    }
  }
  return { data, w, h, ax: ox, ay: oy };
}

/** Attach an automatically derived ground shadow to a mesh (fixed light, +X direction). */
export function addShadow(mesh, opts = {}) {
  const { maxX, maxY, maxZ } = mesh.bounds();
  if (maxX <= 0 || maxY <= 0 || maxZ <= 0) return;
  const off = opts.off ?? maxZ * 0.55;
  const grow = opts.grow ?? 2;
  const x0 = -grow, y0 = -grow;
  const x1 = maxX + grow, y1 = maxY + grow;
  const alpha = opts.alpha ?? 120;
  const mat = (P) => {
    const t = Math.min(1, P[0] / (x1 + off));
    return [10, 12, 16, alpha * (0.65 + 0.35 * t)];
  };
  mesh.quad(
    mesh.v(x0, y0, 0), mesh.v(x1, y0, 0),
    mesh.v(x1 + off, y1, 0), mesh.v(x0 + off, y1, 0),
    mat,
  );
}
