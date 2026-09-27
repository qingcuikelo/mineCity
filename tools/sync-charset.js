/**
 * Keeps the font bakery char set in sync with what the UI actually uses.
 *
 *   node tools/sync-charset.js      # scan src/ + extra list -> tools/font-bakery.html
 *
 * After running, re-bake at http://localhost:8123/tools/font-bakery.html
 */

import fs from 'node:fs';
import path from 'node:path';

const files = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(f)) files.push(p);
  }
};
walk('src');

const re = /[\u3000-\u303f\u4e00-\u9fff\uff01-\uff60\u2014\u2026\u00b7\u00d7\u00b0\u2190-\u2193\u221a\u25b6\u25aa\u25cf\u25a1\u00bb]/;
const set = new Set();

// extra characters present in docs/planned strings
const extraFile = 'tools/cjk-charset.txt';
for (const ch of fs.readFileSync(extraFile, 'utf8')) set.add(ch);

for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const ch of s) if (re.test(ch)) set.add(ch);
}

const chars = [...set].sort().join('');
fs.writeFileSync(extraFile, chars, 'utf8');

let html = fs.readFileSync('tools/font-bakery.html', 'utf8');
const before = html;
html = html.replace(/const CJK = "[^"]*";/, 'const CJK = ' + JSON.stringify(chars) + ';');
if (html === before) {
  console.error('CJK declaration not found in font-bakery.html');
  process.exit(1);
}
fs.writeFileSync('tools/font-bakery.html', html);
console.log(`[charset] ${chars.length} chars synced (${files.length} source files scanned)`);
