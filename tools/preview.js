/** Generates assets/preview.html: a QA contact sheet for every generated sprite. */

import fs from 'node:fs';

export function writePreview(manifest, outPath) {
  const data = JSON.stringify(manifest);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>minecity asset preview</title>
<style>
  body { background:#1a1f26; color:#dde4ea; font:12px monospace; margin:12px; }
  h2 { color:#f2d65a; border-bottom:1px solid #4b5766; padding-bottom:4px; margin-top:24px; }
  .row { display:flex; flex-wrap:wrap; gap:6px; }
  .cell { background:#12161b; border:1px solid #313a44; padding:4px; text-align:center; }
  .cell div { font-size:10px; color:#8d99a6; margin-top:2px; }
  canvas { image-rendering: pixelated; display:block; }
  .checker { background-image:
      linear-gradient(45deg,#2a303a 25%,transparent 25%,transparent 75%,#2a303a 75%),
      linear-gradient(45deg,#2a303a 25%,transparent 25%,transparent 75%,#2a303a 75%);
    background-size:16px 16px; background-position:0 0,8px 8px; }
  #pal { display:flex; }
  #pal span { width:20px; height:20px; display:block; }
  button { background:#313a44; color:#dde4ea; border:2px outset #5b6674; font:12px monospace; padding:4px 10px; cursor:pointer; }
</style></head><body>
<h1>MineCity — 离线预渲染精灵表</h1>
<p><button id="toggle">切换 昼/夜</button> <span id="stat"></span></p>
<h2>调色板 (32)</h2><div id="pal"></div>
<div id="groups"></div>
<script>
const MANIFEST = ${data};
let night = false;
const images = [];
const start = async () => {
  for (const p of MANIFEST.pages) {
    images.push(await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = p.file; }));
  }
  draw();
};
const pal = document.getElementById('pal');
for (const [r,g,b] of MANIFEST.palette) {
  const s = document.createElement('span');
  s.style.background = 'rgb(' + r + ',' + g + ',' + b + ')';
  s.title = r + ',' + g + ',' + b;
  pal.appendChild(s);
}
function cellFor(name) {
  const e = MANIFEST.sprites[name];
  if (!e) return null;
  const c = document.createElement('canvas');
  c.width = e.w; c.height = e.h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(images[e.p], e.x, e.y, e.w, e.h, 0, 0, e.w, e.h);
  return c;
}
function add(group, name, scale = 1) {
  const c = cellFor(name);
  if (!c) return;
  const holder = document.createElement('div');
  holder.className = 'cell checker';
  if (scale !== 1) { c.style.transform = 'scale(' + scale + ')'; c.style.transformOrigin = 'top left';
    holder.style.width = (c.width * scale) + 'px'; holder.style.height = (c.height * scale) + 'px'; }
  holder.appendChild(c);
  const lab = document.createElement('div');
  lab.textContent = name;
  holder.appendChild(lab);
  group.appendChild(holder);
}
function draw() {
  document.getElementById('groups').innerHTML = '';
  const dn = night ? 'night' : 'day';
  const g1 = document.createElement('h2'); g1.textContent = '地形 — 高度 1..' + MANIFEST.terrain.maxH + ' (' + dn + ')';
  document.getElementById('groups').appendChild(g1);
  const r1 = document.createElement('div'); r1.className = 'row'; document.getElementById('groups').appendChild(r1);
  for (const s of MANIFEST.terrain.surfaces)
    for (let v = 0; v < s.variants; v++)
      for (let h = 1; h <= MANIFEST.terrain.maxH; h++) add(r1, 't/' + s.id + '/' + v + '/h' + h + '/' + dn, 0.7);
  const g2 = document.createElement('h2'); g2.textContent = '水面 4 帧 (' + dn + ')';
  document.getElementById('groups').appendChild(g2);
  const r2 = document.createElement('div'); r2.className = 'row'; document.getElementById('groups').appendChild(r2);
  for (let f = 0; f < MANIFEST.terrain.water.frames; f++) add(r2, 'w/' + f + '/0/' + dn, 0.9);
  const g3 = document.createElement('h2'); g3.textContent = '道路 16 mask (' + dn + ')';
  document.getElementById('groups').appendChild(g3);
  const r3 = document.createElement('div'); r3.className = 'row'; document.getElementById('groups').appendChild(r3);
  for (let m = 0; m < 16; m++) add(r3, 'road/' + m + '/' + dn, 0.9);
  const g4 = document.createElement('h2'); g4.textContent = '建筑 (' + dn + ')';
  document.getElementById('groups').appendChild(g4);
  for (const m of MANIFEST.models) {
    const gh = document.createElement('h3'); gh.textContent = m.name + ' — ' + m.label + ' [' + m.cls + m.tier + '] ' + m.fx + 'x' + m.fy;
    document.getElementById('groups').appendChild(gh);
    const gr = document.createElement('div'); gr.className = 'row'; document.getElementById('groups').appendChild(gr);
    for (let rot = 0; rot < 4; rot++) add(gr, 'b/' + m.name + '/' + rot + '/' + dn, 0.62);
  }
  const g5 = document.createElement('h2'); g5.textContent = '道具 (' + dn + ')';
  document.getElementById('groups').appendChild(g5);
  const r5 = document.createElement('div'); r5.className = 'row'; document.getElementById('groups').appendChild(r5);
  for (const p of MANIFEST.props) for (let rot = 0; rot < 4; rot++) add(r5, 'pr/' + p.name + '/' + rot + '/' + dn, 0.8);
  const g6 = document.createElement('h2'); g6.textContent = '图标 / 叠加';
  document.getElementById('groups').appendChild(g6);
  const r6 = document.createElement('div'); r6.className = 'row'; document.getElementById('groups').appendChild(r6);
  for (const i of MANIFEST.icons) add(r6, 'icon/' + i, 1.2);
  for (const z of MANIFEST.zones) add(r6, 'zone/' + z, 1);
  add(r6, 'ui/noroad', 1);
  let n = 0; for (const k in MANIFEST.sprites) n++;
  document.getElementById('stat').textContent = n + ' sprites, ' + MANIFEST.pages.length + ' page(s)';
}
document.getElementById('toggle').onclick = () => { night = !night; draw(); };
start();
</script></body></html>`;
  fs.writeFileSync(outPath, html);
}
