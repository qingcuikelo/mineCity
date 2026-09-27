/**
 * MineCity — retro pre-rendered isometric city sandbox.
 * Boots the asset pipeline output, runs the simulation clock and ties the
 * compositor, tools, growth simulation and DOS UI together.
 */

import { loadAssets, assets, hex } from './assets.js';
import { initFont } from './render/font.js';
import { Crt } from './render/crt.js';
import { Camera } from './render/camera.js';
import { drawCity, drawGrid, nightFactor, waterFrame, footprintPath } from './render/scene.js';
import { World, footprint } from './game/world.js';
import { TOOLS, TOOL_GROUPS, rotatePlop, getPlopRotation, setPlopRotation } from './game/tools.js';
import { makeSimState, indexModels, simStep, computeStats } from './game/growth.js';
import { generateTown } from './game/town.js';
import { saveToSlot, loadFromSlot, deleteSlot } from './game/save.js';
import { Ui } from './ui/ui.js';
import { VIEW_W, VIEW_H, LAYOUT } from './config.js';

const SIM_PERIOD = 1.5;

export async function boot() {
  await loadAssets();
  initFont();

  const low = document.createElement('canvas');
  low.width = VIEW_W;
  low.height = VIEW_H;
  const ctx = low.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const display = document.getElementById('display');
  const crt = new Crt(display);

  const app = {
    world: new World(),
    models: assets.manifest.models,
    camera: null,
    view: { x: 0, y: LAYOUT.statusH, w: VIEW_W, h: VIEW_H - LAYOUT.statusH - LAYOUT.toolbarH },
    sim: makeSimState(),
    crt,
    clock: 12,
    autoTime: true,
    showGrid: false,
    paused: false,
    speed: 1,
    hover: null,
    elapsed: 0,
  };
  app.world.generate(20240927);
  app.camera = new Camera(app.world);
  app.camera.centerOn(app.world.w / 2, app.world.h / 2, app.view);
  setPlopRotation(0);
  const byClass = indexModels(app.models);
  computeStats(app.world, app.models, app.sim);

  const ui = new Ui(app);
  ui.group = 'roads';
  ui.setTool('road');

  const fit = () => {
    const { w, h } = crt.fit(VIEW_W, VIEW_H, window.innerWidth - 16, window.innerHeight - 16);
    if (low.width !== w || low.height !== h) {
      low.width = w;
      low.height = h;
      ctx.imageSmoothingEnabled = false;
    }
    app.view = { x: 0, y: LAYOUT.statusH, w, h: h - LAYOUT.statusH - LAYOUT.toolbarH };
    ui.relayout(w, h);
    app.camera.clamp(app.view);
  };
  fit();
  app.camera.centerOn(app.world.w / 2, app.world.h / 2, app.view);
  window.addEventListener('resize', fit);

  /* ------------------------------- audio ------------------------------- */
  let audio = null;
  const sfx = (kind) => {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      const o = audio.createOscillator();
      const g = audio.createGain();
      const cfg = kind === 'place' ? [220, 0.05, 'square']
        : kind === 'ok' ? [440, 0.09, 'square']
          : kind === 'err' ? [110, 0.12, 'sawtooth']
            : [660, 0.03, 'square'];
      o.type = cfg[2];
      o.frequency.setValueAtTime(cfg[0], t);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, cfg[0] * 0.6), t + cfg[1]);
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + cfg[1]);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + cfg[1] + 0.02);
    } catch (err) { /* audio is optional */ }
  };

  /* ------------------------------ helpers ------------------------------ */
  const canvasPt = (e) => {
    const r = display.getBoundingClientRect();
    return { x: (e.clientX - r.left) / crt.scale, y: (e.clientY - r.top) / crt.scale };
  };
  const inView = (p) => p.x >= app.view.x && p.x < app.view.x + app.view.w
    && p.y >= app.view.y && p.y < app.view.y + app.view.h;

  const setWorld = (next) => {
    app.world = next;
    app.camera = new Camera(next);
    app.camera.centerOn(next.w / 2, next.h / 2, app.view);
    ui.minimapVersion = -1;
  };

  const applyTool = (x, y, toolCtx = {}) => {
    const tool = ui.activeTool();
    const world = app.world;
    if (!tool || !world.inB(x, y)) return false;
    const changed = tool.apply(world, app.models, x, y, toolCtx);
    if (changed) world.touch();
    return changed;
  };

  const brushTiles = (x, y) => {
    const r = ui.brush;
    const out = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + r + 0.5) continue;
        out.push([x + dx, y + dy]);
      }
    }
    return out;
  };

  const applyBrush = (x, y, toolCtx) => {
    let changed = false;
    const tool = ui.activeTool();
    const single = !tool || tool.cursor !== 'brush' || ui.brush === 0;
    const tiles = single ? [[x, y]] : brushTiles(x, y);
    for (const [tx, ty] of tiles) if (applyTool(tx, ty, toolCtx)) changed = true;
    return changed;
  };

  /* ------------------------------- input ------------------------------- */
  let drag = null;
  let panning = null;
  let uiPressedId = null;
  let sliderDrag = null;
  let spaceDown = false;
  let lastMouse = { x: 0, y: 0 };

  display.addEventListener('contextmenu', (e) => e.preventDefault());

  display.addEventListener('mousedown', (e) => {
    const p = canvasPt(e);
    lastMouse = p;
    if (e.button === 0) {
      const id = ui.onMouseDown(p);
      if (id) {
        uiPressedId = id;
        if (id === 'timeslider') sliderDrag = 'time';
        if (id === 'new:water' || id === 'new:rough') sliderDrag = 'modal';
        e.preventDefault();
        return;
      }
    }
    if (inView(p)) {
      if (e.button === 2 || e.button === 1 || spaceDown) {
        panning = p;
      } else if (e.button === 0) {
        const tile = app.camera.tileAt(p.x, p.y, app.view);
        if (!tile) return;
        const tool = ui.activeTool();
        if (!tool) return;
        if (tool.cursor === 'rect') {
          drag = { mode: 'rect', start: tile, end: tile, tool: tool.id };
        } else if (tool.cursor === 'line') {
          drag = { mode: 'line', last: tile, tool: tool.id };
          if (applyTool(tile.x, tile.y, { rng: Math.random })) sfx('place');
        } else {
          drag = { mode: 'brush', last: tile, tool: tool.id, level: tile.h };
          if (applyBrush(tile.x, tile.y, { rng: Math.random, level: tile.h })) sfx('place');
        }
      }
    }
    e.preventDefault();
  });

  window.addEventListener('mouseup', (e) => {
    const p = canvasPt(e);
    lastMouse = p;
    if (uiPressedId) {
      const id = ui.onMouseUp(p);
      uiPressedId = null;
      sliderDrag = null;
      if (id) handleUiAction(id);
      return;
    }
    if (panning) { panning = null; return; }
    if (drag) {
      if (drag.mode === 'rect') {
        const x0 = Math.min(drag.start.x, drag.end.x), x1 = Math.max(drag.start.x, drag.end.x);
        const y0 = Math.min(drag.start.y, drag.end.y), y1 = Math.max(drag.start.y, drag.end.y);
        let changed = false;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) if (applyTool(x, y)) changed = true;
        }
        if (changed) sfx('place');
      }
      drag = null;
    }
  });

  window.addEventListener('mousemove', (e) => {
    const p = canvasPt(e);
    lastMouse = p;
    ui.onMouseMove(p);
    if (sliderDrag === 'time') {
      const sl = ui.buttons.find((b) => b.id === 'timeslider');
      if (sl) app.clock = Math.max(0, Math.min(23.98, ((p.x - sl.rect.x) / sl.rect.w) * 24));
      return;
    }
    if (sliderDrag === 'modal') { ui.onDrag(p); return; }
    if (panning) {
      app.camera.pan(p.x - panning.x, p.y - panning.y);
      app.camera.clamp(app.view);
      panning = p;
      return;
    }
    if (inView(p)) app.hover = app.camera.tileAt(p.x, p.y, app.view);
    else app.hover = null;
    if (drag && app.hover) {
      if (drag.mode === 'line') {
        applyDragPath(drag.last, app.hover, (x, y) => { if (applyTool(x, y)) sfx('place'); });
        drag.last = app.hover;
      } else if (drag.mode === 'brush') {
        applyDragPath(drag.last, app.hover, (x, y) => applyBrush(x, y, { rng: Math.random, level: drag.level }));
        drag.last = app.hover;
      } else if (drag.mode === 'rect') {
        drag.end = app.hover;
      }
    }
  });

  function applyDragPath(from, to, fn) {
    let x0 = from.x, y0 = from.y;
    const dx = Math.abs(to.x - x0), dy = Math.abs(to.y - y0);
    const sx = x0 < to.x ? 1 : -1, sy = y0 < to.y ? 1 : -1;
    let err = dx - dy;
    let guard = 0;
    while (guard++ < 1024) {
      fn(x0, y0);
      if (x0 === to.x && y0 === to.y) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  display.addEventListener('wheel', (e) => {
    const p = canvasPt(e);
    if (!inView(p)) return;
    const before = {
      x: (p.x - app.view.x - app.camera.ox) / app.camera.zoom,
      y: (p.y - app.view.y - app.camera.oy) / app.camera.zoom,
    };
    app.camera.zoom = e.deltaY > 0 ? 1 : 2;
    app.camera.ox = p.x - app.view.x - before.x * app.camera.zoom;
    app.camera.oy = p.y - app.view.y - before.y * app.camera.zoom;
    app.camera.clamp(app.view);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const handled = ui.onKey(e);
    if (handled === true) { e.preventDefault(); return; }
    if (typeof handled === 'string') { handleUiAction(handled); e.preventDefault(); return; }
    if (e.key === ' ') spaceDown = true;
    switch (e.key) {
      case 'g': case 'G': app.showGrid = !app.showGrid; break;
      case 'r': case 'R': rotatePlop(); ui.pushLog('旋转地标 ' + (getPlopRotation() * 90) + '°'); break;
      case 'p': case 'P': app.paused = !app.paused; break;
      case '[': app.clock = (app.clock + 23) % 24; break;
      case ']': app.clock = (app.clock + 1) % 24; break;
      case 'n': case 'N': ui.modal = { kind: 'new' }; break;
      case 'k': case 'K': ui.modal = { kind: 'slots', mode: 'save' }; ui.refreshSlots(); break;
      case 'l': case 'L': ui.modal = { kind: 'slots', mode: 'load' }; ui.refreshSlots(); break;
      case 'h': case 'H': case 'F1': ui.modal = { kind: 'help' }; break;
      case 'c': case 'C': app.crt.enabled = !app.crt.enabled; break;
      case 'f': case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
        break;
      case 'Escape': ui.modal = null; break;
      default:
        if (/^[1-6]$/.test(e.key)) {
          const idx = Number(e.key) - 1;
          const groups = TOOL_GROUPS.concat([{ id: 'system' }]);
          if (groups[idx]) {
            ui.group = groups[idx].id;
            if (ui.group !== 'system') {
              const list = ui.toolList();
              if (!list.includes(ui.tool)) ui.setTool(list[0]);
            }
          }
        }
    }
    if (e.key === ' ') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });

  /* ---------------------------- UI actions ---------------------------- */
  function handleUiAction(id) {
    if (id.startsWith('tab:')) {
      const g = id.slice(4);
      ui.group = g;
      if (g !== 'system') {
        const list = ui.toolList();
        if (!list.includes(ui.tool)) ui.setTool(list[0]);
      }
      sfx('click');
      return;
    }
    if (id.startsWith('tool:')) {
      const t = id.slice(5);
      if (ui.group === 'system') {
        if (t === 'newmap') { ui.modal = { kind: 'new' }; ui.refreshSlots(); }
        else if (t === 'town') doGenerateTown();
        else if (t === 'save') { ui.modal = { kind: 'slots', mode: 'save' }; ui.refreshSlots(); }
        else if (t === 'load') { ui.modal = { kind: 'slots', mode: 'load' }; ui.refreshSlots(); }
        else if (t === 'help') ui.modal = { kind: 'help' };
        else if (t === 'grid') app.showGrid = !app.showGrid;
        else if (t === 'crt') app.crt.enabled = !app.crt.enabled;
        else if (t === 'auto') app.autoTime = !app.autoTime;
      } else {
        ui.setTool(t);
      }
      sfx('click');
      return;
    }
    if (id.startsWith('brush:')) { ui.brush = Number(id.slice(6)); sfx('click'); return; }
    if (id === 'speed:play') { app.paused = !app.paused; sfx('click'); return; }
    if (id === 'speed:toggle') { app.speed = app.speed === 1 ? 3 : 1; sfx('click'); return; }
    if (id === 'toggle:crt') { app.crt.enabled = !app.crt.enabled; sfx('click'); return; }
    if (id === 'timeslider') return;
    if (id === 'minimap') {
      const r = ui.rects.minimap;
      const mx = lastMouse.x - (r.x + 3);
      const my = lastMouse.y - (r.y + 15);
      if (mx >= 0 && my >= 0 && mx < 128 && my < 128) app.camera.centerOn(mx, my, app.view);
      return;
    }
    if (id === 'new:random') { ui.newMapOpts.seed = Math.floor(Math.random() * 99999999); sfx('click'); return; }
    if (id === 'new:cancel') { ui.modal = null; return; }
    if (id === 'new:ok') { doNewMap(); return; }
    if (id === 'slots:close') { ui.modal = null; return; }
    if (id === 'help:close') { ui.modal = null; return; }
    if (id.startsWith('slotdel:')) {
      deleteSlot(Number(id.slice(8)));
      ui.refreshSlots();
      ui.pushLog('已删除槽位 ' + id.slice(8));
      return;
    }
    if (id.startsWith('slot:')) {
      const slot = Number(id.slice(5));
      if (ui.modal && ui.modal.mode === 'save') {
        if (saveToSlot(app.world, app.sim, slot)) {
          ui.refreshSlots();
          ui.pushLog('已保存到槽位 ' + slot);
          sfx('ok');
        }
      } else {
        const loaded = loadFromSlot(slot);
        if (loaded) {
          app.sim.growthCount = loaded.sim.growthCount || 0;
          app.sim.day = loaded.sim.day || 0;
          if (loaded.sim.demand) app.sim.demand = loaded.sim.demand;
          setWorld(loaded.world);
          computeStats(app.world, app.models, app.sim);
          ui.modal = null;
          ui.pushLog('已读取槽位 ' + slot);
          sfx('ok');
        } else {
          ui.pushLog('槽位 ' + slot + ' 无存档');
          sfx('err');
        }
      }
      return;
    }
  }

  function doGenerateTown() {
    ui.pushLog('正在选址并建造城镇……');
    const info = generateTown(app.world, app.models, app.sim, byClass, { simSteps: 55 });
    if (!info) {
      ui.pushLog('没有找到足够的空地，试试新地图');
      sfx('err');
      return;
    }
    computeStats(app.world, app.models, app.sim);
    ui.minimapVersion = -1;
    app.camera.zoom = 1;
    app.camera.centerOn(info.x + info.w / 2, info.y + info.h / 2, app.view);
    app.camera.clamp(app.view);
    app.hover = null;
    ui.pushLog(`城镇已生成：${info.buildings} 栋建筑`);
    ui.pushLog('再点一次可在别处继续造镇');
    sfx('ok');
  }

  function doNewMap() {
    const opts = ui.newMapOpts;
    const next = new World();
    next.generate(opts.seed, { waterLevel: opts.water, rough: opts.rough });
    setWorld(next);
    app.sim = makeSimState();
    computeStats(app.world, app.models, app.sim);
    ui.modal = null;
    ui.pushLog('新的城市：种子 ' + opts.seed);
    ui.pushLog('用「道路」和「分区」开始建设');
    sfx('ok');
  }

  /* ------------------------------- loop ------------------------------- */
  let last = performance.now();
  let simAcc = 0;
  let fps = 0, fpsAcc = 0, fpsN = 0;

  const loop = (now) => {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    app.elapsed += dt;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

    if (app.autoTime) app.clock = (app.clock + dt * 0.15) % 24;
    if (!app.paused) {
      simAcc += dt * app.speed;
      while (simAcc >= SIM_PERIOD) {
        simAcc -= SIM_PERIOD;
        simStep(app.world, app.models, byClass, app.sim);
      }
    }

    ctx.fillStyle = hex(0);
    ctx.fillRect(0, 0, low.width, low.height);
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(app.view.x, app.view.y, app.view.w, app.view.h);
      ctx.clip();
      drawCity(ctx, app.world, app.camera, app.view, {
        models: app.models,
        night: nightFactor(app.clock),
        waterFrame: waterFrame(app.elapsed),
      });
      if (app.showGrid) drawGrid(ctx, app.world, app.camera, app.view);
      drawCursor(ctx);
    } finally {
      ctx.restore();
    }
    ui.draw(ctx);
    drawFps(ctx, fps);
    crt.present(low);
    requestAnimationFrame(loop);
  };

  function drawFps(ctx, fpsv) {
    const f = ui.fontRef();
    const label = `${fpsv} fps  ${app.camera.zoom}x`;
    const w = f.measure(label) + 6;
    const x = app.view.w - w - 4;
    const y = app.view.h + app.view.y - 4;
    ctx.fillStyle = 'rgba(5,7,10,0.45)';
    ctx.fillRect(x - 2, y - 10, w, 12);
    f.draw(ctx, label, x, y - 1, fpsv < 40 ? hex(17) : hex(23));
  }

  function drawCursor(ctx) {
    const tool = ui.activeTool();
    const world = app.world;
    if (!tool || !app.hover) return;
    const h = app.hover;
    ctx.save();
    try {
      ctx.lineWidth = 1;
      if (drag && drag.mode === 'rect') {
        const x0 = Math.min(drag.start.x, drag.end.x), y0 = Math.min(drag.start.y, drag.end.y);
        const x1 = Math.max(drag.start.x, drag.end.x), y1 = Math.max(drag.start.y, drag.end.y);
        const hh = world.height[world.idx(x0, y0)];
        ctx.strokeStyle = hex(21);
        footprintPath(ctx, app.camera, app.view, x0, y0, x1 - x0 + 1, y1 - y0 + 1, hh);
        ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = hex(0);
        ctx.stroke();
        return;
      }
      if (tool.cursor === 'single') {
        const model = app.models.find((m) => m.name === tool.plop);
        const rot = getPlopRotation();
        const { fx, fy } = model ? footprint(model, rot) : { fx: 1, fy: 1 };
        const ok = model && canPlaceAt(world, model, h.x, h.y, rot);
        ctx.strokeStyle = ok ? hex(25) : hex(17);
        footprintPath(ctx, app.camera, app.view, h.x, h.y, fx, fy, h.h);
        ctx.stroke();
        return;
      }
      const r = tool.cursor === 'brush' ? ui.brush : 0;
      const size = r * 2 + 1;
      ctx.strokeStyle = hex(21);
      footprintPath(ctx, app.camera, app.view, h.x - r, h.y - r, size, size, h.h);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = hex(0);
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  }

  function canPlaceAt(world, model, x, y, rot) {
    const { fx, fy } = footprint(model, rot);
    for (let dy = 0; dy < fy; dy++) {
      for (let dx = 0; dx < fx; dx++) {
        const tx = x + dx, ty = y + dy;
        if (!world.inB(tx, ty)) return false;
        const i = world.idx(tx, ty);
        if (world.water[i] || world.road[i] || world.bld[i]) return false;
        if (!world.isFlat(tx, ty)) return false;
      }
    }
    return true;
  }

  window.__mc = {
    app, models: app.models, ui, simStep, computeStats, setWorld, low, ctx,
    get world() { return app.world; },
    get camera() { return app.camera; },
    debug: {
      get drag() { return drag; },
      get panning() { return panning; },
      get uiPressedId() { return uiPressedId; },
    },
  };
  document.getElementById('boot').classList.add('hidden');
  requestAnimationFrame(loop);
}
