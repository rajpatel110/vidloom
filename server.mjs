import { iceConfig } from './ice.mjs';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

export function attachRooms(server, paths = ['/signal']) {
  const configuration = iceConfig();
  const rooms = new Map();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  server.on('upgrade', (req, socket, head) => {
    if (!paths.includes(req.url.split('?')[0])) return;
    if (req.headers.origin !== 'http://' + req.headers.host &&
        req.headers.origin !== 'https://' + req.headers.host) return socket.destroy();
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
  });
  const send = (ws, msg) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  sockets.on('connection', ws => {
    let room, id;
    ws.on('error', () => ws.terminate());
    ws.on('message', raw => {
      let m;
      try { m = JSON.parse(raw); } catch { return ws.close(1008); }
      if (!m || typeof m !== 'object') return ws.close(1008);
      if (!room) {
        if (m.type !== 'join' || typeof m.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(m.id)) return ws.close(1008);
        id = m.id;
        const next = rooms.get(id) ?? { peers: new Set(), session: null };
        if (next.peers.size === 2) {
          send(ws, { type: 'full' });
          return ws.close(1000);
        }
        room = next;
        rooms.set(id, room);
        room.peers.add(ws);
        send(ws, { type: 'waiting' });
        if (room.peers.size === 2) {
          room.session = randomUUID();
          for (const peer of room.peers) send(peer, { type: 'pair', session: room.session, initiator: peer !== ws, configuration: configuration() });
        }
        return;
      }
      if (!room.session || m.session !== room.session || !['offer','answer','candidate'].includes(m.type)) return;
      for (const peer of room.peers) if (peer !== ws) send(peer, { type: m.type, session: room.session, value: m.value });
    });
    ws.on('close', () => {
      if (!room) return;
      room.peers.delete(ws);
      room.session = null;
      for (const peer of room.peers) send(peer, { type: 'waiting' });
      if (!room.peers.size) rooms.delete(id);
    });
  });
  server.on('close', () => sockets.close());
}
