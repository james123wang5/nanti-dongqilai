// 极简静态服务：打开打包好的播放器
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try { const body = await readFile(join(root, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': types[extname(path)] ?? (path === '/' ? types['.html'] : 'application/octet-stream'), 'cache-control': path.includes('/assets/') ? 'max-age=31536000, immutable' : 'no-cache' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(5180, '127.0.0.1', () => console.log('难题动起来：http://localhost:5180/'));
