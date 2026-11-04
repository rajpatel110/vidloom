import {selectedRoute, type ConnectionDetails} from './diagnostics';
import {receiveFile, sendFile} from './files';

export const rejoinStates = ['Room full', 'Disconnected', 'Channel closed', 'Connection failed', 'Negotiation failed'] as const;
type RoomState = typeof rejoinStates[number] | 'Joining' | 'Connected' | 'Waiting for peer' | 'Connecting';
export type {RoomState};

export type MediaState = { mic: boolean; video: 'off' | 'camera' | 'screen' };
const devicesOff: MediaState = {mic: false, video: 'off'};

export function joinRoom(id: string, status: (s: RoomState) => void, receive: (s: string) => void, remote: (stream: MediaStream | null) => void, route: (details: ConnectionDetails | null) => void, deliver: (file: File | null) => void, peerMedia: (state: MediaState | null) => void) {
  const url = new URL('/signal', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url);
  let pc: RTCPeerConnection | undefined;
  let data: RTCDataChannel | undefined;
  let presence: RTCDataChannel | undefined;
  let localMedia = devicesOff;
  function publishMedia() {
    if (presence?.readyState === 'open') presence.send(JSON.stringify(localMedia));
  }
  const senders = new Map<string, RTCRtpSender>();
  let session = '';
  let full = false;
  let disposed = false;
  let pending: RTCIceCandidateInit[] = [];
  let routeTimer: number | undefined;
  function reset() {
    window.clearInterval(routeTimer);
    route(null);
    session = '';
    remote(null);
    deliver(null);
    presence = undefined;
    localMedia = devicesOff;
    peerMedia(null);
    senders.clear();
    const previous = pc;
    pc = undefined;
    data?.close();
    previous?.close();
    data = undefined;
    pending = [];
  }
  function attach(channel: RTCDataChannel) {
    data = channel;
    channel.onopen = () => { if (channel === data) status('Connected'); };
    channel.onclose = () => { if (channel === data) status('Channel closed'); };
    channel.onmessage = event => {
      if (channel === data && typeof event.data === 'string') receive(event.data.slice(0, 2000));
    };
  }
  function signal(type: string, value: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type, value, session}));
  }
  ws.onopen = () => ws.send(JSON.stringify({type:'join', id}));
  ws.onclose = () => { if (disposed) return; reset(); if (!full) status('Disconnected'); };
  // Serialize async SDP changes and candidate processing in wire order.
  let queue = Promise.resolve();
  ws.onmessage = event => {
    queue = queue.then(async () => {
      if (disposed || ws.readyState !== WebSocket.OPEN && !event.data.includes('"full"')) return;
      const m = JSON.parse(event.data);
      if (m.type === 'full') { full = true; status('Room full'); return; }
      if (m.type === 'waiting') { reset(); status('Waiting for peer'); return; }
      if (m.type === 'pair') {
        reset();
        session = m.session;
        status('Connecting');
        const current = new RTCPeerConnection(m.configuration);
        pc = current;
        // Both peers reserve this SCTP stream explicitly. Chat stays plain text.
        const control = current.createDataChannel('media-state', {negotiated: true, id: 100});
        presence = control;
        control.onopen = () => { if (presence === control) publishMedia(); };
        control.onclose = () => { if (presence === control) peerMedia(null); };
        control.onmessage = ({data}) => {
          if (presence !== control || typeof data !== 'string' || data.length > 128) return;
          try {
            const state = JSON.parse(data);
            if (typeof state?.mic === 'boolean' && ['off','camera','screen'].includes(state.video)) {
              peerMedia({mic: state.mic, video: state.video});
            }
          } catch { /* Ignore malformed status updates. */ }
        };
        async function updateRoute() {
          let details: ConnectionDetails = {label: 'Route unavailable'};
          try {
            details = selectedRoute(await current.getStats());
          } catch { /* Statistics may be unavailable while closing. */ }
          if (pc === current && current.connectionState === 'connected') route(details);
        }
        const incoming = new MediaStream();
        current.ontrack = ({track}) => {
          if (pc !== current) return;
          incoming.addTrack(track);
          remote(incoming);
        };
        // Reserve both media sections so either peer can enable a device later.
        for (const kind of ['audio', 'video']) {
          const transceiver = current.addTransceiver(kind, {direction: 'sendrecv'});
          senders.set(kind, transceiver.sender);
        }
        current.onicecandidate = e => { if (pc === current && e.candidate) signal('candidate', e.candidate); };
        current.onconnectionstatechange = () => {
          if (pc !== current) return;
          window.clearInterval(routeTimer);
          route(null);
          if (current.connectionState === 'connected') {
            void updateRoute();
            routeTimer = window.setInterval(updateRoute, 3000);
          }
          if (current.connectionState === 'failed') status('Connection failed');
        };
        let incomingFile: RTCDataChannel | undefined;
        current.ondatachannel = ({channel}) => {
          if (pc !== current) return channel.close();
          if (channel.label === 'chat') return attach(channel);
          if (channel.label !== 'file' || (incomingFile && incomingFile.readyState !== 'closed')) return channel.close();
          incomingFile = channel;
          receiveFile(channel, file => { if (pc === current) deliver(file); });
        };
        if (m.initiator) {
          attach(current.createDataChannel('chat'));
          await current.setLocalDescription(await current.createOffer());
          signal('offer', current.localDescription);
        }
        return;
      }
      if (!pc || m.session !== session) return;
      if (m.type === 'candidate') {
        if (pc.remoteDescription) await pc.addIceCandidate(m.value);
        else pending.push(m.value);
      } else if (m.type === 'offer' || m.type === 'answer') {
        await pc.setRemoteDescription(m.value);
        for (const c of pending) await pc.addIceCandidate(c);
        pending = [];
        if (m.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          signal('answer', pc.localDescription);
        }
      }
    }).catch(() => { if (!disposed) status('Negotiation failed'); });
  };
  return {
    updateMedia(state: MediaState) {
      localMedia = state;
      publishMedia();
    },
    async setTrack(kind: string, track: MediaStreamTrack | null) {
      const sender = senders.get(kind);
      if (!sender) throw new Error('Peer disconnected');
      await sender.replaceTrack(track);
    },
    async transfer(file: File) {
      if (!pc || data?.readyState !== 'open') throw new Error('Connect to a peer first.');
      await sendFile(pc, file);
    },
    send(text: string) {
      if (data?.readyState !== 'open') return false;
      data.send(text);
      return true;
    },
    close() { disposed = true; reset(); ws.close(); }
  };
}
