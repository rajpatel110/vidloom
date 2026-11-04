import { createServer } from 'node:http';
import { attachRooms } from '../server.mjs';

const server = createServer((_req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'}).end('ok');
});
attachRooms(server, ['/signal', '/api/signal']);
export default server;
