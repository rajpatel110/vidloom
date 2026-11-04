import {useEffect, useRef, useState} from 'react';
import type {joinRoom} from './peer';

type Kind = 'audio' | 'video';

export function CallMedia({connection, remote}: {
  connection: ReturnType<typeof joinRoom>;
  remote: MediaStream | null;
}) {
  const [local] = useState(() => new MediaStream());
  const [enabled, setEnabled] = useState({audio: false, video: false});
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(false);
  const preview = useRef<HTMLVideoElement>(null);
  const player = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    alive.current = true;
    if (preview.current) preview.current.srcObject = local;
    return () => {
      alive.current = false;
      for (const track of local.getTracks()) track.stop();
    };
  }, [local]);

  useEffect(() => {
    if (player.current) player.current.srcObject = remote;
  }, [remote]);

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

  return <div className="call">
    <figure><video ref={player} aria-label="Peer video" autoPlay playsInline controls/><figcaption>Peer</figcaption></figure>
    <figure className="preview"><video ref={preview} aria-label="Your preview" autoPlay muted playsInline/><figcaption>You</figcaption></figure>
    <div className="devices">
      <button disabled={busy !== null} onClick={() => toggle('audio')}>{enabled.audio ? 'Mute microphone' : 'Enable microphone'}</button>
      <button disabled={busy !== null} onClick={() => toggle('video')}>{enabled.video ? 'Turn camera off' : 'Enable camera'}</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
