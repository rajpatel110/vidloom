export function joinRoom(id: string, status: (s: string) => void, receive: (s: string) => void, remote: (stream: MediaStream | null) => void) {
  const url = new URL('/signal', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url);
  let pc: RTCPeerConnection | undefined;
  let data: RTCDataChannel | undefined;
  const senders = new Map<string, RTCRtpSender>();
  let session = '';
  let full = false;
  let disposed = false;
  let pending: RTCIceCandidateInit[] = [];
  function reset() {
    session = '';
    remote(null);
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
  ws.onclose = () => { reset(); if (!disposed && !full) status('Disconnected · refresh to rejoin'); };
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
        const current = new RTCPeerConnection();
        pc = current;
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
          if (pc === current && current.connectionState === 'failed') status('Connection failed · refresh to retry');
        };
        current.ondatachannel = e => attach(e.channel);
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
    }).catch(() => { if (!disposed) status('Negotiation failed · refresh to retry'); });
  };
  return {
    async setTrack(kind: string, track: MediaStreamTrack | null) {
      const sender = senders.get(kind);
      if (!sender) throw new Error('Peer disconnected');
      await sender.replaceTrack(track);
    },
    send(text: string) {
      if (data?.readyState !== 'open') return false;
      data.send(text);
      return true;
    },
    close() { disposed = true; reset(); ws.close(); }
  };
}
