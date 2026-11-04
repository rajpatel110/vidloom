import { defineConfig } from 'vite';
import { attachRooms } from './server.mjs';
export default defineConfig({ plugins: [{
  name: 'vidloom-signaling',
  configureServer(server) { attachRooms(server.httpServer); },
  configurePreviewServer(server) { attachRooms(server.httpServer); }
}] });
