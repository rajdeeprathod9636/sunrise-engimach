// Minimal static server for previewing and rendering the site locally.
// Usage: node tools/serve.mjs [root] [port]   (defaults: the site folder, 8765)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const port = Number(process.argv[3] || 8765);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.md': 'text/plain; charset=utf-8',
};

export function startServer(p = port, r = root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let file = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (file.endsWith('/')) file += 'index.html';
      const abs = path.join(r, file);
      if (!abs.startsWith(r)) return res.writeHead(403).end();
      fs.stat(abs, (err, st) => {
        if (err || !st.isFile()) return res.writeHead(404).end('not found');
        const type = types[path.extname(abs).toLowerCase()] || 'application/octet-stream';
        const range = req.headers.range;
        if (range) {
          const [s, e] = range.replace('bytes=', '').split('-');
          const start = Number(s);
          const end = e ? Number(e) : st.size - 1;
          res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
          fs.createReadStream(abs, { start, end }).pipe(res);
        } else {
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
          fs.createReadStream(abs).pipe(res);
        }
      });
    });
    server.listen(p, () => resolve(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer().then(() => console.log(`Serving ${root} at http://localhost:${port}`));
}
