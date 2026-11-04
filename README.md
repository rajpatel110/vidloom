# Vidloom

Vidloom is a browser-based calling app for two people. Share a room link to talk, present a screen, chat, or transfer a file. The React and TypeScript client carries media and data over WebRTC. A Node.js WebSocket server pairs participants and handles signaling.

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open the printed localhost URL, create a room and open its invite link in another tab. Once both tabs show Connected, send a message or enable your camera and microphone independently. Both start off. Use the peer video playback controls if your browser blocks autoplay. Leave room ends the call. After either peer rejoins, devices require fresh opt-in.

In a connected room, choose **Share screen** and select a tab, window or display in the browser picker. The selected video replaces the outgoing camera track. Your microphone keeps its current setting. Stop sharing in the room or in the browser to return to the previous camera state. This control appears on browsers that support display capture.

**Send a file** shares one file up to 8 MiB with the connected peer. Vidloom sends 16 KiB chunks on a dedicated ordered WebRTC data channel, pauses when the outgoing buffer fills, and confirms delivery after the receiver assembles the declared number of bytes. The receiver can download the latest file until the pairing ends or another file arrives. Files stay in browser memory during transfer.

## Run the production build

Run `npm ci`, `npm run build`, then `npm start`. Open http://127.0.0.1:3000. One Node process serves the built frontend, handles WebSocket upgrades at `/signal` and answers health checks at `/healthz`. The browser test exercises this entry point with an ephemeral port.

For hosting, set `HOST=0.0.0.0` and the port supplied by your host. Put HTTPS in front of the Node process and forward WebSocket upgrades to the same port, preserving the public Host header. Use a single instance because room membership is in memory. Configure the ICE variables below on the server before running a cross-network call.

## Architecture

The browser connects to the same origin at `/signal` via WebSocket. The Node server keeps room membership in memory. When two peers have joined, the server designates the first as the offerer so both peers cannot initiate negotiation at once. Each pairing gets a new session ID so the server can discard signaling messages from a previous connection. [Signaling server](./server.mjs)

The first peer creates a chat channel and sends an SDP offer over WebSocket. The other peer applies the offer and returns an SDP answer. Both trickle ICE candidates over WebSocket and queue incoming candidates until the remote description is ready. [Peer connection](./peer.ts)

Peers reserve audio and video transceivers during initial negotiation. Device controls attach or detach a capture track using `replaceTrack()` without renegotiation. Turning a device off stops capture. Media travels over the same peer connection as chat.

The Connected state follows the data channel's open event. Messages travel over that channel. A full room rejects further joins. On disconnect the server invalidates the pairing, frees the slot and deletes an empty room. A returning browser negotiates a new connection. There is no persistent message history.

## Verification

Run `npm run build` for type checking and a production client bundle. Run `npm test` to exercise real tabs with headless Chromium. The test uses Microsoft Edge at its standard Windows location, or set BROWSER_PATH to a Chromium executable. The test starts its own local server. [Browser test suite](./room.test.mjs)

Local tests have exercised both direct and forced-TURN calls. They check decoded video frames, received audio samples, screen sharing with a synthetic display, and byte-for-byte file delivery. A Wi-Fi-to-cellular call between physical devices remains unverified.

## Direct and relayed connections

With no ICE environment variables the app works locally with host candidates. To enable NAT traversal, set the following variables in the shell that runs the Node server. Restart the server after changes.

| Variable | Purpose |
| --- | --- |
| STUN_URLS | Comma-separated STUN endpoints for public address discovery. |
| TURN_URLS | Comma-separated TURN endpoints, such as turn:relay.example.org:3478?transport=udp and turns:relay.example.org:5349?transport=tcp. Supply your own reachable service. |
| TURN_SHARED_SECRET | Server-side coturn REST authentication secret. Each pairing receives separate one-hour credentials. |
| TURN_USERNAME, TURN_PASSWORD | Alternative credentials for a local fixture or a provider issuing temporary user credentials. Admitted browsers receive these values. |
| ICE_TRANSPORT_POLICY | Defaults to all. Set relay to require a TURN path on both peers. |

Use shell environment variables for secrets. The server sends the browser its ICE configuration when the second peer joins. The shared secret stays on the server. While connected, the client checks the selected ICE pair every three seconds. If either candidate is a relay candidate, the UI shows **Relayed via TURN**.

### Verify the network path

1. Run npm test without ICE settings for the direct-path check.
2. With an authenticated TURN service running, set TURN_URLS, its credentials and ICE_TRANSPORT_POLICY=relay, then run npm test again. Both tabs must report a relayed path, exchange chat, receive audio samples and decode video frames. The browser test enables loopback ICE for a local TURN fixture.
3. For a separate-network check, serve the app and signaling over HTTPS/WSS and use a TURN address reachable from both networks. Open one invite on Wi-Fi and another on cellular, enable both devices and check media and chat. Repeat with the relay policy and confirm the route label on both devices.


