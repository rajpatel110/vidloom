import {useEffect, useRef, useState} from 'react';
import type {joinRoom, MediaState} from './peer';

type Kind = 'audio' | 'video';

export function CallMedia({connection, remote, peerMedia}: {
  connection: ReturnType<typeof joinRoom>;
  remote: MediaStream | null;
  peerMedia: MediaState | null;
}) {
  const [local] = useState(() => new MediaStream());
  const [enabled, setEnabled] = useState({audio: false, video: false});
  const [busy, setBusy] = useState<Kind | null>(null);
  const [sharing, setSharing] = useState(false);
  const display = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(false);
  const preview = useRef<HTMLVideoElement>(null);
  const player = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    alive.current = true;
    if (preview.current) preview.current.srcObject = local;
    return () => {
      alive.current = false;
      display.current?.stop();
      display.current = null;
      for (const track of local.getTracks()) track.stop();
    };
  }, [local]);

  useEffect(() => {
    if (player.current) player.current.srcObject = remote;
  }, [remote]);

  useEffect(() => {
    connection.updateMedia({mic: enabled.audio, video: sharing ? 'screen' : enabled.video ? 'camera' : 'off'});
  }, [connection, enabled, sharing]);

  async function toggle(kind: Kind) {
    setBusy(kind);
    setError('');
    let acquired: MediaStreamTrack | undefined;
    try {
      const existing = local.getTracks().find(track => track.kind === kind);
      if (existing) {
        existing.stop();
        local.removeTrack(existing);
        setEnabled(old => ({...old, [kind]: false}));
        await connection.setTrack(kind, null);
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({[kind]: true});
        acquired = stream.getTracks()[0];
        if (!alive.current) { acquired.stop(); return; }
        await connection.setTrack(kind, acquired);
        if (!alive.current) { acquired.stop(); return; }
        local.addTrack(acquired);
        acquired.onended = () => {
          if (!alive.current || !acquired) return;
          local.removeTrack(acquired);
          setEnabled(old => ({...old, [kind]: false}));
        };
        setEnabled(old => ({...old, [kind]: true}));
      }
    } catch {
      acquired?.stop();
      if (alive.current) setError('Could not use this device. Check the browser permission and device connection, then try again.');
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function stopSharing() {
    const track = display.current;
    if (!track) return;
    display.current = null;
    track.onended = null;
    track.stop();
    setBusy('video');
    try {
      const camera = local.getVideoTracks().find(candidate => candidate.readyState === 'live');
      await connection.setTrack('video', camera ?? null);
    } catch {
      if (alive.current) setError('Screen sharing stopped. Toggle your camera to restore video.');
    } finally {
      if (alive.current) {
        if (preview.current) preview.current.srcObject = local;
        setSharing(false);
        setBusy(null);
      }
    }
  }

  async function startSharing() {
    setBusy('video');
    setError('');
    let track: MediaStreamTrack | undefined;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false});
      track = stream.getVideoTracks()[0];
      if (!alive.current) { track.stop(); return; }
      await connection.setTrack('video', track);
      if (!alive.current) { track.stop(); return; }
      display.current = track;
      track.onended = () => void stopSharing();
      if (track.readyState === 'ended') { await stopSharing(); return; }
      if (preview.current) preview.current.srcObject = stream;
      setSharing(true);
    } catch (cause) {
      track?.stop();
      if (alive.current && !(cause instanceof DOMException && cause.name === 'NotAllowedError')) {
        setError('Could not share this screen. Try another window or tab.');
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  return <div className="call">
    <figure><video ref={player} aria-label="Peer video" autoPlay playsInline controls/><figcaption>Peer</figcaption></figure>
    <figure className="preview"><video ref={preview} aria-label="Your preview" autoPlay muted playsInline/><figcaption>{sharing ? 'Your screen' : 'You'}</figcaption></figure>
    <p className="peer-devices" role="status" aria-label="Peer devices">
      {peerMedia ? <>
        <span>{peerMedia.mic ? 'Peer microphone on' : 'Peer microphone muted'}</span>
        <span>{peerMedia.video === 'screen' ? 'Peer sharing screen' : peerMedia.video === 'camera' ? 'Peer camera on' : 'Peer camera off'}</span>
      </> : 'Peer device status unavailable'}
    </p>
    <div className="devices">
      <button disabled={busy !== null} onClick={() => toggle('audio')}>{enabled.audio ? 'Mute microphone' : 'Enable microphone'}</button>
      <button disabled={busy !== null || sharing} onClick={() => toggle('video')}>{enabled.video ? 'Turn camera off' : 'Enable camera'}</button>
      {typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
        <button disabled={busy !== null} onClick={sharing ? stopSharing : startSharing}>
          {sharing ? 'Stop sharing' : 'Share screen'}
        </button>}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
