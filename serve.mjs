import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { attachRooms } from './server.mjs';

const dist = new URL('./dist/', import.meta.url);
const assets = new Map();
const types = { '.js': 'text/javascript', '.css': 'text/css' };
try {
  assets.set('/', { body: await readFile(new URL('index.html', dist)), type: 'text/html' });
  for (const entry of await readdir(new URL('assets/', dist), { withFileTypes: true })) {
    const type = types[extname(entry.name)];
    if (!entry.isFile() || !type) continue;
    const path = '/assets/' + entry.name;
    assets.set(path, { body: await readFile(new URL(path.slice(1), dist)), type });
  }
} catch (cause) {
  throw new Error('Cannot load the client bundle. Run npm run build before npm start.', {cause});
}

const server = createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, {Allow: 'GET, HEAD'}).end();
    return;
  }
  const path = req.url.split('?')[0];
  if (path === '/healthz') {
    res.writeHead(200, {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'}).end('ok');
    return;
  }
  const asset = assets.get(path);
  if (!asset) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': asset.type + '; charset=utf-8',
    'Content-Length': asset.body.length,
    'Cache-Control': path === '/' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff'
  }).end(req.method === 'HEAD' ? undefined : asset.body);
});
attachRooms(server);
server.on('upgrade', (req, socket) => {
  if (req.url !== '/signal') socket.destroy();
});
const host = process.env.HOST || '127.0.0.1';
server.listen(Number(process.env.PORT ?? 3000), host, () => {
  console.log('Vidloom listening on port ' + server.address().port);
  process.send?.({port: server.address().port});
});
