import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8123);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Dev-only endpoint used by the font bakery page to persist generated atlases.
  if (req.method === 'POST' && url.pathname === '/__bakery/save') {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const name = String(body.file || '');
        if (!/^[a-z0-9._-]+$/i.test(name)) throw new Error('bad file name');
        const outDir = path.join(ROOT, 'assets');
        fs.mkdirSync(outDir, { recursive: true });
        if (body.base64) {
          fs.writeFileSync(path.join(outDir, name), Buffer.from(body.base64, 'base64'));
        } else {
          fs.writeFileSync(path.join(outDir, name), String(body.text ?? ''));
        }
        console.log('[bakery] wrote assets/' + name);
        send(res, 200, JSON.stringify({ ok: true, file: name }), 'application/json');
      } catch (err) {
        send(res, 400, JSON.stringify({ ok: false, error: String(err) }), 'application/json');
      }
    });
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found: ' + rel);
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(PORT, () => {
  console.log(`minecity dev server: http://localhost:${PORT}/`);
});
