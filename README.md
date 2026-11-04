# Vidloom

A two-person WebRTC audio/video call with data-channel chat built with React, TypeScript and Node.js. Run locally in two browser tabs.

## Run locally

Use Node.js 22.12 or newer. Run `npm ci`, then `npm run dev`. Open the printed localhost URL, create a room and open its invite link in another tab. Once both tabs show Connected, send a message or enable your camera and microphone independently. Both start off. Use the peer video playback controls if your browser blocks autoplay. Leave room ends the call. After either peer rejoins, devices require fresh opt-in.

## Signaling flow

The browser connects to the same origin at `/signal` via WebSocket. The Node server keeps room membership in memory. When two peers have joined, the server assigns a fresh session ID and tells the first peer to create a data channel and an SDP offer. The other peer applies the offer and returns an SDP answer. Both trickle ICE candidates over WebSocket and queue incoming candidates until the remote description is ready.

Peers reserve audio and video transceivers during initial negotiation. Device controls attach or detach a capture track using replaceTrack without renegotiation. Turning a device off stops capture. Media travels over the same peer connection as chat.

The Connected state follows the data channel's open event. Messages travel over that channel. A full room rejects further joins. On disconnect the server invalidates the pairing, frees the slot and deletes an empty room. A returning browser negotiates a new connection. There is no persistent message history.

## Verification

Run `npm run build` for type checking and a production client bundle. Run `npm test` to exercise real tabs with headless Chromium. The test uses Microsoft Edge at its standard Windows location, or set BROWSER_PATH to a Chromium executable. The test starts its own local server.

## Scope

Local host ICE candidates only for this milestone. STUN configuration and verified TURN relay connectivity are subsequent milestones. Browser tests use synthetic camera and microphone input and verify decoded video frames and received audio samples at both ends. The standalone client bundle requires a signaling service. Locally, both Vite dev and preview attach the Node WebSocket handler.

Architecture reference: [ChandraPratap01/Vidloom](https://github.com/ChandraPratap01/Vidloom).
