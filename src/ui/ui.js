/** The DOS-style UI: status bar, tabbed toolbar, windows and modals. */

import { assets, sprite, hasSprite, hex } from '../assets.js';
import { font } from '../render/font.js';
import { VIEW_W, VIEW_H, LAYOUT, ZONE } from '../config.js';
import { TOOL_GROUPS, TOOLS, makePlopTool } from '../game/tools.js';
import * as W from './widgets.js';

const SYSTEM_ITEMS = [
  { id: 'newmap', label: '新建', icon: 'newmap' },
  { id: 'town', label: '一键城镇', icon: 'gen_town' },
  { id: 'save', label: '存档', icon: 'save' },
  { id: 'load', label: '读取', icon: 'load' },
  { id: 'help', label: '帮助', icon: 'help' },
  { id: 'grid', label: '网格', icon: 'grid' },
  { id: 'crt', label: 'CRT', icon: 'crt' },
  { id: 'auto', label: '自动', icon: 'clock' },
];

export class Ui {
  constructor(app) {
    this.app = app;
    this.group = 'terrain';
    this.tool = 'terra_up';
    this.brush = 1;
    this.hoverTarget = null;
    this.modal = null;
    this.slotInfo = {};
    this.log = [];
    this.minimap = document.createElement('canvas');
    this.minimap.width = 128;
    this.minimap.height = 128;
    this.minimapVersion = -1;
    this.newMapOpts = { seed: 20240927, water: 0.34, rough: 1 };
    this.buttons = [];
    this.plopCache = {};
    this.refreshSlots();
    this.relayout(VIEW_W, VIEW_H);
  }

  /** Recompute the chrome layout for a new logical resolution. */
  relayout(w, h) {
    this.W = w;
    this.H = h;
    this.rects = {
      status: { x: 0, y: 0, w, h: LAYOUT.statusH },
      tabs: { x: 0, y: h - LAYOUT.toolbarH, w, h: LAYOUT.tabH },
      bar: { x: 0, y: h - LAYOUT.toolbarH + LAYOUT.tabH, w, h: LAYOUT.toolbarH - LAYOUT.tabH },
      minimap: { x: w - 152, y: LAYOUT.statusH + 4, w: 148, h: 152 },
      rci: { x: w - 152, y: LAYOUT.statusH + 160, w: 148, h: 62 },
      log: { x: 4, y: h - LAYOUT.toolbarH - 46, w: 268, h: 42 },
      options: { x: 4, y: LAYOUT.statusH + 4, w: 208, h: 46 },
    };
  }

  fontRef() {
    return font();
  }

  icon(name, iconScale = 0.72) {
    if (!hasSprite(name)) return null;
    return { ...sprite(name), iconScale };
  }

  toolList() {
    const g = TOOL_GROUPS.find((x) => x.id === this.group);
    return g ? g.tools : [];
  }

  plopTool(id) {
    if (!this.plopCache[id]) {
      const label = assets.manifest.models.find((m) => m.name === id)?.label || id;
      this.plopCache[id] = makePlopTool(id, label);
    }
    return this.plopCache[id];
  }

  activeTool() {
    if (this.group === 'system') return null;
    if (TOOLS[this.tool]) return TOOLS[this.tool];
    return this.plopTool(this.tool);
  }

  setTool(id) {
    this.tool = id;
    const t = TOOLS[id];
    if (t && t.radiusDefault !== undefined) this.brush = t.radiusDefault;
  }

  refreshSlots() {
    this.slotInfo = {};
    for (let i = 1; i <= 4; i++) {
      try {
        const raw = localStorage.getItem('minecity.slot' + i);
        if (raw) this.slotInfo[i] = JSON.parse(raw).info || {};
      } catch (err) { /* ignore */ }
    }
  }

  pushLog(msg) {
    this.log.unshift(msg);
    this.log.length = Math.min(this.log.length, 3);
  }

  /* ------------------------------ drawing ------------------------------ */

  draw(ctx) {
    this.buttons = [];
    const R = this.rects;
    this.drawTabs(ctx, R.tabs);
    this.drawBar(ctx, R.bar);
    this.drawStatus(ctx, R.status);
    this.drawMinimap(ctx, R.minimap);
    this.drawRci(ctx, R.rci);
    this.drawLog(ctx, R.log);
    const tool = this.activeTool();
    if (tool && (tool.cursor === 'brush' || tool.cursor === 'rect')) this.drawOptions(ctx, R.options, tool);
    if (tool && tool.plop) this.drawPlopHint(ctx, R.options, tool);
    if (this.modal) this.drawModal(ctx);
  }

  isHover(id) {
    return !this.modal && this.hoverTarget === id;
  }

  hoverFill(ctx, rect, active = false) {
    ctx.fillStyle = hex(3);
    ctx.fillRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
    void active;
  }

  drawStatus(ctx, r) {
    W.bevel(ctx, r.x, r.y, r.w, r.h, false, 2);
    const app = this.app;
    W.textShadow(ctx, 'MineCity', 6, 11, 21);
    const stats = app.sim.stats;
    W.text(ctx, `人口 ${stats.pop}  商业 ${stats.jobsC}  工业 ${stats.jobsI}`, 66, 11, 7);
    W.text(ctx, app.sim.dateString(), 240, 11, 6);
    const t = app.clock / 24;
    const hh = String(Math.floor(app.clock)).padStart(2, '0');
    const mm = String(Math.floor((app.clock % 1) * 60)).padStart(2, '0');
    const isNight = app.clock < 6 || app.clock >= 19;
    W.text(ctx, `${hh}:${mm}`, 336, 11, isNight ? 30 : 21);
    W.text(ctx, isNight ? '夜' : '昼', 372, 11, isNight ? 30 : 21);
    const sl = { x: Math.max(390, this.W - 268), y: 4, w: 104, h: 7 };
    W.sliderTrack(ctx, sl, t);
    const slRect = { x: sl.x - 2, y: 1, w: sl.w + 4, h: 13 };
    if (this.isHover('timeslider')) {
      ctx.strokeStyle = hex(21);
      ctx.strokeRect(slRect.x + 0.5, slRect.y + 0.5, slRect.w - 1, slRect.h - 1);
    }
    this.buttons.push({ id: 'timeslider', rect: slRect });
    const bx = this.W - 100;
    const rPlay = { x: bx, y: 1, w: 22, h: 12 };
    const rSpeed = { x: bx + 24, y: 1, w: 24, h: 12 };
    const rCrt = { x: bx + 50, y: 1, w: 22, h: 12 };
    W.button(ctx, rPlay, app.paused ? '▶' : '❚❚', { hover: this.isHover('speed:play') });
    this.buttons.push({ id: 'speed:play', rect: rPlay, active: app.paused });
    W.button(ctx, rSpeed, app.speed === 3 ? '3x' : '1x', { hover: this.isHover('speed:toggle') });
    this.buttons.push({ id: 'speed:toggle', rect: rSpeed });
    W.button(ctx, rCrt, 'C', { pressed: app.crt.enabled, hover: this.isHover('toggle:crt') });
    this.buttons.push({ id: 'toggle:crt', rect: rCrt, active: app.crt.enabled });
  }

  drawTabs(ctx, r) {
    const groups = TOOL_GROUPS.concat([{ id: 'system', label: '系统' }]);
    const w = Math.floor(r.w / groups.length);
    groups.forEach((g, i) => {
      const rect = { x: r.x + i * w, y: r.y, w, h: r.h };
      const active = g.id === this.group;
      W.bevel(ctx, rect.x, rect.y, rect.w, rect.h, active, active ? 4 : 2);
      if (!active && this.isHover('tab:' + g.id)) this.hoverFill(ctx, rect);
      W.text(ctx, g.label, rect.x + rect.w / 2, rect.y + 11, active ? 21 : 7, { align: 'center' });
      this.buttons.push({ id: 'tab:' + g.id, rect, active });
    });
  }

  drawBar(ctx, r) {
    W.bevel(ctx, r.x, r.y, r.w, r.h, false, 2);
    const items = this.group === 'system' ? SYSTEM_ITEMS : this.toolList().map((id) => {
      const t = TOOLS[id] || this.plopTool(id);
      return { id, label: t.label, icon: t.icon || id };
    });
    const bw = 46, bh = r.h - 4;
    items.forEach((it, i) => {
      const rect = { x: r.x + 4 + i * (bw + 2), y: r.y + 2, w: bw, h: bh };
      let active = false;
      if (this.group === 'system') {
        active = it.id === 'grid' ? this.app.showGrid
          : it.id === 'crt' ? this.app.crt.enabled
            : it.id === 'auto' ? this.app.autoTime : false;
      } else {
        active = this.tool === it.id;
      }
      W.button(ctx, rect, it.label, {
        icon: this.icon('icon/' + it.icon, 0.66),
        pressed: active,
        hover: this.isHover('tool:' + it.id),
      });
      this.buttons.push({ id: 'tool:' + it.id, rect, active });
    });
  }

  drawOptions(ctx, r, tool) {
    const client = W.panel(ctx, r.x, r.y, r.w, r.h, '工具');
    W.text(ctx, tool.label, client.x + 2, client.y + 11, 7);
    let bx = client.x + 2;
    if (tool.cursor === 'brush') {
      for (const [label, rad] of [['1', 0], ['3', 1], ['5', 2]]) {
        const rect = { x: bx, y: client.y + 16, w: 24, h: 13 };
        W.button(ctx, rect, label, { pressed: this.brush === rad, hover: this.isHover('brush:' + rad) });
        this.buttons.push({ id: 'brush:' + rad, rect, active: this.brush === rad });
        bx += 26;
      }
      W.text(ctx, '笔刷大小', bx + 6, client.y + 27, 4);
    } else {
      W.text(ctx, '按住左键拖拽划定区域', client.x + 2, client.y + 27, 4);
    }
  }

  drawPlopHint(ctx, r, tool) {
    const client = W.panel(ctx, r.x, r.y, r.w, r.h, '地标');
    W.text(ctx, tool.label, client.x + 2, client.y + 11, 7);
    W.text(ctx, '点击放置   R 旋转', client.x + 2, client.y + 26, 4);
  }

  drawMinimap(ctx, r) {
    const world = this.app.world;
    if (this.minimapVersion !== world.version) {
      this.renderMinimap();
      this.minimapVersion = world.version;
    }
    const hovered = this.isHover('minimap');
    const client = W.panel(ctx, r.x, r.y, r.w, r.h, hovered ? '小地图 (点击跳转)' : '小地图');
    ctx.drawImage(this.minimap, client.x, client.y, 128, 128);
    ctx.strokeStyle = hovered ? hex(21) : hex(0);
    ctx.strokeRect(client.x + 0.5, client.y + 0.5, 127, 127);
    const cam = this.app.camera, view = this.app.view;
    const corners = [
      [view.x, view.y], [view.x + view.w, view.y],
      [view.x, view.y + view.h], [view.x + view.w, view.y + view.h],
    ];
    const zoom = cam.zoom;
    const ox = view.x + cam.ox, oy = view.y + cam.oy;
    let tx0 = 1e9, ty0 = 1e9, tx1 = -1e9, ty1 = -1e9;
    for (const [sx, sy] of corners) {
      const u = (sx - ox) / zoom;
      const v = (sy - oy) / zoom;
      const X = (u + 2 * v) / 64;
      const Y = (2 * v - u) / 64;
      tx0 = Math.min(tx0, X); tx1 = Math.max(tx1, X);
      ty0 = Math.min(ty0, Y); ty1 = Math.max(ty1, Y);
    }
    ctx.strokeStyle = hex(21);
    ctx.strokeRect(
      client.x + Math.max(0, tx0), client.y + Math.max(0, ty0),
      Math.max(2, Math.min(128, tx1) - Math.max(0, tx0)),
      Math.max(2, Math.min(128, ty1) - Math.max(0, ty0)),
    );
    this.buttons.push({ id: 'minimap', rect: { x: client.x, y: client.y, w: 128, h: 128 } });
  }

  renderMinimap() {
    const world = this.app.world;
    const c = this.minimap.getContext('2d');
    const img = c.createImageData(world.w, world.h);
    const palette = assets.palette;
    const put = (i, ci) => {
      const p = palette[ci];
      img.data[i * 4] = p[0];
      img.data[i * 4 + 1] = p[1];
      img.data[i * 4 + 2] = p[2];
      img.data[i * 4 + 3] = 255;
    };
    for (let i = 0; i < world.w * world.h; i++) {
      let ci = 25;
      if (world.water[i]) ci = 28;
      else {
        const h = world.height[i];
        ci = h >= 5 ? 4 : h >= 3 ? 24 : 25;
        if (world.surf[i] === 1) ci = 13;
        if (world.surf[i] === 2) ci = 5;
        if (world.surf[i] === 3) ci = 10;
      }
      if (world.road[i]) ci = 3;
      if (world.bld[i] > 0 && world.bld[i] !== 0xffff) ci = 7;
      if (world.zone[i] && world.bld[i] === 0) ci = world.zone[i] === ZONE.R ? 26 : world.zone[i] === ZONE.C ? 31 : 20;
      put(i, ci);
    }
    c.putImageData(img, 0, 0);
  }

  drawRci(ctx, r) {
    const client = W.panel(ctx, r.x, r.y, r.w, r.h, '需求');
    const d = this.app.sim.demand;
    const items = [['住宅', d.r, 25], ['商业', d.c, 30], ['工业', d.i, 19]];
    items.forEach(([label, v, col], i) => {
      const y = client.y + 2 + i * 14;
      W.text(ctx, label, client.x + 2, y + 10, 7);
      W.meter(ctx, { x: client.x + 34, y: y + 2, w: 98, h: 9 }, v / 1.3, col, 1);
    });
  }

  drawLog(ctx, r) {
    W.bevel(ctx, r.x, r.y, r.w, r.h, true, 2);
    const lines = this.log.concat(this.app.sim.log).slice(0, 3);
    if (!lines.length) lines.push('欢迎来到 MineCity!');
    lines.forEach((line, i) => {
      W.text(ctx, '» ' + line, r.x + 4, r.y + 12 + i * 12, i === 0 ? 7 : 4);
    });
  }

  drawModal(ctx) {
    ctx.fillStyle = 'rgba(5,7,10,0.6)';
    ctx.fillRect(0, 0, this.W, this.H);
    const m = this.modal;
    if (m.kind === 'new') this.drawNewModal(ctx);
    else if (m.kind === 'slots') this.drawSlotsModal(ctx, m);
    else if (m.kind === 'help') this.drawHelpModal(ctx);
  }

  drawNewModal(ctx) {
    const r = { x: (this.W - 340) / 2 | 0, y: 64, w: 340, h: 212 };
    const c = W.panel(ctx, r.x, r.y, r.w, r.h, '新的城市');
    W.text(ctx, '种子', c.x + 4, c.y + 16, 7);
    W.text(ctx, String(this.newMapOpts.seed), c.x + 52, c.y + 16, 21);
    W.button(ctx, { x: c.x + 170, y: c.y + 3, w: 74, h: 16 }, '随机', { hover: this.isHover('new:random') });
    this.buttons.push({ id: 'new:random', rect: { x: c.x + 170, y: c.y + 3, w: 74, h: 16 } });
    W.text(ctx, '水位', c.x + 4, c.y + 42, 7);
    W.sliderTrack(ctx, { x: c.x + 60, y: c.y + 34, w: 180, h: 10 }, this.newMapOpts.water);
    this.buttons.push({ id: 'new:water', rect: { x: c.x + 58, y: c.y + 32, w: 184, h: 14 } });
    W.text(ctx, '起伏', c.x + 4, c.y + 66, 7);
    W.sliderTrack(ctx, { x: c.x + 60, y: c.y + 58, w: 180, h: 10 }, (this.newMapOpts.rough - 0.6) / 1.2);
    this.buttons.push({ id: 'new:rough', rect: { x: c.x + 58, y: c.y + 56, w: 184, h: 14 } });
    W.hline(ctx, c.x, c.y + 80, c.w);
    W.text(ctx, '生成随机地貌并重置城市（未保存的进度会丢失）。', c.x + 4, c.y + 96, 4);
    W.text(ctx, '数字键输入种子，R 随机，回车生成。', c.x + 4, c.y + 108, 4);
    W.button(ctx, { x: c.x + 60, y: c.y + 130, w: 90, h: 22 }, '生成', { hover: this.isHover('new:ok') });
    this.buttons.push({ id: 'new:ok', rect: { x: c.x + 60, y: c.y + 130, w: 90, h: 22 } });
    W.button(ctx, { x: c.x + 190, y: c.y + 130, w: 90, h: 22 }, '取消', { hover: this.isHover('new:cancel') });
    this.buttons.push({ id: 'new:cancel', rect: { x: c.x + 190, y: c.y + 130, w: 90, h: 22 } });
    this.sliderRects = {
      water: { x: c.x + 60, y: c.y + 34, w: 180, h: 10 },
      rough: { x: c.x + 60, y: c.y + 58, w: 180, h: 10 },
    };
  }

  drawSlotsModal(ctx, m) {
    const r = { x: (this.W - 360) / 2 | 0, y: 76, w: 360, h: 200 };
    const c = W.panel(ctx, r.x, r.y, r.w, r.h, m.mode === 'save' ? '保存城市' : '读取城市');
    for (let i = 1; i <= 4; i++) {
      const info = this.slotInfo[i];
      const y = c.y + 6 + (i - 1) * 32;
      W.button(ctx, { x: c.x + 2, y, w: 240, h: 26 }, info ? `槽位 ${i}  ${info.date || ''}  ${info.city || ''}` : `槽位 ${i}  空闲`, { hover: this.isHover(`slot:${i}`) });
      this.buttons.push({ id: `slot:${i}`, rect: { x: c.x + 2, y, w: 240, h: 26 } });
      W.button(ctx, { x: c.x + 248, y, w: 60, h: 26 }, '删除', { disabled: !info, hover: this.isHover(`slotdel:${i}`) });
      this.buttons.push({ id: `slotdel:${i}`, rect: { x: c.x + 248, y, w: 60, h: 26 }, disabled: !info });
    }
    W.button(ctx, { x: c.x + 120, y: c.y + 142, w: 110, h: 22 }, '关闭', { hover: this.isHover('slots:close') });
    this.buttons.push({ id: 'slots:close', rect: { x: c.x + 120, y: c.y + 142, w: 110, h: 22 } });
  }

  drawHelpModal(ctx) {
    const r = { x: (this.W - 440) / 2 | 0, y: 40, w: 440, h: 320 };
    const c = W.panel(ctx, r.x, r.y, r.w, r.h, '帮助 — MineCity');
    const lines = [
      [7, '复古等距城市沙盒：建筑与地形均为离线预渲染精灵'],
      [7, '（32 色调色板 + 有序抖动 + 扫描线 CRT 后处理）。'],
      [0, ''],
      [21, '操作'],
      [4, '  左键        使用当前工具'],
      [4, '  右键 / 空格 拖拽平移地图'],
      [4, '  滚轮        1x / 2x 缩放'],
      [4, '  R           旋转待放置的地标'],
      [4, '  G           显示/隐藏网格'],
      [4, '  空格        暂停 / 继续模拟'],
      [4, '  [ ]         调整时间'],
      [0, ''],
      [21, '玩法'],
      [4, '  1. 用「地形」工具塑造地貌'],
      [4, '  2. 「道路」拖拽修路'],
      [4, '  3. 「分区」划定住宅/商业/工业'],
      [4, '  4. 邻路分区地块会自动长出建筑并升级'],
      [4, '  5. 「地标」直接放置公园/教堂等'],
      [4, '  6. 「一键城镇」自动生成整座小镇'],
    ];
    lines.forEach(([col, line], i) => W.text(ctx, line, c.x + 6, c.y + 16 + i * 14, col || 4));
    W.button(ctx, { x: c.x + 160, y: c.y + 262, w: 110, h: 22 }, '关闭', { hover: this.isHover('help:close') });
    this.buttons.push({ id: 'help:close', rect: { x: c.x + 160, y: c.y + 262, w: 110, h: 22 } });
  }

  /* ------------------------------ input ------------------------------ */

  /** Returns the clicked button id, or null. */
  onMouseDown(p) {
    this.pressedId = null;
    for (const b of this.buttons) {
      if (b.disabled) continue;
      if (this.modal && !isModalId(b.id)) continue;
      const r = b.rect;
      if (p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) {
        this.pressedId = b.id;
        return b.id;
      }
    }
    return null;
  }

  /** Returns the id that was pressed (released anywhere), or null. */
  onMouseUp() {
    const id = this.pressedId;
    this.pressedId = null;
    return id;
  }

  onMouseMove(p) {
    this.hoverTarget = null;
    for (const b of this.buttons) {
      if (this.modal && !isModalId(b.id)) continue;
      const r = b.rect;
      if (p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) {
        this.hoverTarget = b.id;
        break;
      }
    }
    return this.hoverTarget;
  }

  /** Slider dragging inside the new-map modal. Returns true when consumed. */
  onDrag(p) {
    if (!this.modal || this.modal.kind !== 'new' || !this.sliderRects) return false;
    const { water, rough } = this.sliderRects;
    const v = (rect) => Math.max(0, Math.min(1, (p.x - rect.x) / rect.w));
    if (p.y >= water.y - 3 && p.y <= water.y + water.h + 3) {
      this.newMapOpts.water = v(water);
      return true;
    }
    if (p.y >= rough.y - 3 && p.y <= rough.y + rough.h + 3) {
      this.newMapOpts.rough = 0.6 + 1.2 * v(rough);
      return true;
    }
    return false;
  }

  onKey(e) {
    if (!this.modal) return false;
    if (e.key === 'Escape') {
      if (this.modal.kind === 'new') this.modal.holdCancel = true;
      this.modal = null;
      return true;
    }
    if (this.modal.kind === 'new') {
      if (/^[0-9]$/.test(e.key)) {
        const n = this.newMapOpts.seed;
        this.newMapOpts.seed = Math.min(999999999, n * 10 + Number(e.key));
        return true;
      }
      if (e.key === 'Backspace') {
        this.newMapOpts.seed = Math.floor(this.newMapOpts.seed / 10);
        return true;
      }
      if (e.key === 'r' || e.key === 'R') {
        this.newMapOpts.seed = Math.floor(Math.random() * 99999999);
        return true;
      }
      if (e.key === 'Enter') return 'new:ok';
    }
    return false;
  }
}

function isModalId(id) {
  return id.startsWith('new:') || id.startsWith('slot:') || id.startsWith('slotdel:') || id.startsWith('slots:') || id.startsWith('help:');
}
