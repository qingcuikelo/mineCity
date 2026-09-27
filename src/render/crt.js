/**
 * CRT post-processing. The game renders into a 640x400 logical buffer; this
 * class upscales it with nearest neighbour and applies scanlines, phosphor
 * bloom, RGB subpixel spread and a vignette - all in plain Canvas 2D so the
 * whole presentation stack stays dependency free.
 */

export class Crt {
  constructor(display) {
    this.display = display;
    this.ctx = display.getContext('2d');
    this.scale = 2;
    this.enabled = true;
    this.curvature = 0;
    this._up = document.createElement('canvas');
    this._small = document.createElement('canvas');
    this._channelA = document.createElement('canvas');
    this._channelB = document.createElement('canvas');
    this._scan = null;
    this._vignette = null;
  }

  /**
   * Fit the logical buffer into the available window area.
   * The scale stays an integer (crisp pixels); the logical resolution then
   * grows to fill the whole window, so the picture is never letterboxed.
   * Returns the logical size the game should render at.
   */
  fit(minW, minH, availW, availH) {
    let scale = Math.floor(Math.min(availW / minW, availH / minH));
    scale = Math.max(1, Math.min(4, scale));
    this.scale = scale;
    const w = Math.max(minW, Math.floor(availW / scale) * scale);
    const h = Math.max(minH, Math.floor(availH / scale) * scale);
    this.display.width = w;
    this.display.height = h;
    this.display.style.width = w + 'px';
    this.display.style.height = h + 'px';
    for (const c of [this._up, this._channelA, this._channelB]) {
      c.width = w; c.height = h;
    }
    this._small.width = Math.max(1, w >> 2);
    this._small.height = Math.max(1, h >> 2);
    this._scan = null;
    this._vignette = null;
    return { w: Math.round(w / scale), h: Math.round(h / scale), scale };
  }

  _scanPattern() {
    if (this._scan) return this._scan;
    const c = document.createElement('canvas');
    c.width = 1; c.height = 3;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.30)';
    g.fillRect(0, 0, 1, 1);
    g.fillStyle = 'rgba(0,0,0,0.10)';
    g.fillRect(0, 1, 1, 1);
    this._scan = this.ctx.createPattern(c, 'repeat');
    return this._scan;
  }

  _vignetteGradient(w, h) {
    if (this._vignette) return this._vignette;
    const g = this.ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    this._vignette = g;
    return g;
  }

  present(low) {
    const ctx = this.ctx;
    const w = this.display.width, h = this.display.height;
    if (!this.enabled) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(low, 0, 0, w, h);
      return;
    }
    const up = this._up.getContext('2d');
    up.imageSmoothingEnabled = false;
    up.clearRect(0, 0, w, h);
    up.drawImage(low, 0, 0, w, h);

    // phosphor bloom
    const small = this._small.getContext('2d');
    small.imageSmoothingEnabled = true;
    small.clearRect(0, 0, this._small.width, this._small.height);
    small.drawImage(low, 0, 0, this._small.width, this._small.height);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._up, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.20;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._small, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    // RGB subpixel spread
    const a = this._channelA.getContext('2d');
    const b = this._channelB.getContext('2d');
    a.globalCompositeOperation = 'source-over';
    a.globalAlpha = 1;
    a.clearRect(0, 0, w, h);
    a.drawImage(this._up, 0, 0);
    a.globalCompositeOperation = 'multiply';
    a.fillStyle = '#ff4040';
    a.fillRect(0, 0, w, h);
    b.globalCompositeOperation = 'source-over';
    b.globalAlpha = 1;
    b.clearRect(0, 0, w, h);
    b.drawImage(this._up, 0, 0);
    b.globalCompositeOperation = 'multiply';
    b.fillStyle = '#4060ff';
    b.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16;
    ctx.drawImage(this._channelA, -1, 0);
    ctx.drawImage(this._channelB, 1, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // scanlines
    ctx.fillStyle = this._scanPattern();
    ctx.fillRect(0, 0, w, h);

    // vignette
    ctx.fillStyle = this._vignetteGradient(w, h);
    ctx.fillRect(0, 0, w, h);
  }
}
