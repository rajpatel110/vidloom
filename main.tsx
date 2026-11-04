import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {joinRoom} from './peer';
import {CallMedia} from './CallMedia';
import './style.css';

function Room({id}: {id: string}) {
  const [state, status] = useState('Joining');
  const [messages, setMessages] = useState<{from:string, text:string}[]>([]);
  const [route, setRoute] = useState('');
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState('');
  const peer = useRef<ReturnType<typeof joinRoom> | null>(null);
  function add(from:string, text:string) {
    setMessages(old => [...old.slice(-99), {from, text}]);
  }
  useEffect(() => {
    const connection = joinRoom(id, status, text => add('Peer', text), setRemote, setRoute);
    peer.current = connection;
    return () => connection.close();
  }, [id]);
  return <><header><Brand/><a href="/">Leave room</a></header>
    <div className="room-title"><h1>Call room</h1><p className="status" role="status">{state}</p>{state === 'Connected' && <p>{route || 'Checking connection route…'}</p>}</div>
    <div className="invite"><label>Invite link<input readOnly value={location.href} onFocus={e => e.target.select()}/></label>
    <button onClick={async () => {try {await navigator.clipboard.writeText(location.href); setCopied('Copied');} catch {setCopied('Select the link above to copy it');}}}>Copy link</button> <small role="status">{copied}</small></div>
    <div className="room-grid"><div className="stage">
      {state === 'Connected' && peer.current ? <CallMedia connection={peer.current} remote={remote}/> :
        <div className="standby"><SignalArt/><p>{state === 'Waiting for peer' ? 'Share the invite link to bring someone in.' : 'Video stage'}</p></div>}
    </div><aside><h2>Room chat</h2>
    <section role="log" aria-label="Chat messages">{messages.length ? messages.map((m,i) => <p key={i}><b>{m.from}</b> {m.text}</p>) : <p>Messages appear here once you and your peer connect.</p>}</section>
    <form onSubmit={e => {e.preventDefault(); const text = draft.trim(); if (text && peer.current?.send(text)) {add('You',text); setDraft('');}}}>
    <label>Message<input maxLength={2000} disabled={state !== 'Connected'} value={draft} onChange={e => setDraft(e.target.value)}/></label>
    <button disabled={state !== 'Connected' || !draft.trim()}>Send</button></form></aside></div></>;
}
function Brand() {
  return <span className="brand"><i aria-hidden="true">≈</i> Vidloom</span>;
}

function SignalArt() {
  return <svg className="signal" viewBox="0 0 440 260" aria-hidden="true" focusable="false">
    {Array.from({length: 20}, (_, i) =>
      <path key={i} d={`M -20 ${60+i*7} C 80 ${250+i*3}, 135 ${-90+i*6}, 220 ${75+i*6} S 330 ${340-i*4}, 460 ${90+i*5}`}/>
    )}
  </svg>;
}

const validRoom = /^[a-zA-Z0-9_-]{1,64}$/;
function Landing() {
  const [invite, setInvite] = useState('');
  const [error, setError] = useState('');
  function join(event: React.FormEvent) {
    event.preventDefault();
    let id = invite.trim();
    if (!validRoom.test(id)) {
      try {
        const link = new URL(id);
        id = link.origin === location.origin ? link.searchParams.get('room') || '' : '';
      } catch { id = ''; }
    }
    if (validRoom.test(id)) location.search = '?room=' + id;
    else setError('Enter a room ID or an invite link from this Vidloom site.');
  }
  return <><header><Brand/><span className="eyebrow">Peer-to-peer studio</span></header>
    <div className="landing"><section className="intro"><span className="eyebrow">01 / The lobby</span>
    <h1>A room<br/>for <em>two.</em></h1><p>Start a video call, share a thought, or just chat. One invite brings the other person in.</p>
    <button onClick={() => location.search = '?room=' + crypto.randomUUID()}>Create room <span aria-hidden="true">↗</span></button></section>
    <div className="panel"><div className="art"><span className="eyebrow">Signal study / 01</span><SignalArt/><span className="legend">You <span>⟷</span> Peer</span></div>
    <form className="join" onSubmit={join}><label htmlFor="invite">Have an invite?</label>
    <div className="input-row"><input id="invite" placeholder="Room link or ID" value={invite} onChange={e => {setInvite(e.target.value); setError('');}}/><button>Join room</button></div>
    {error && <small role="alert">{error}</small>}</form></div></div>
    <footer><span>VIDLOOM</span><span>Video · Audio · Data</span></footer></>;
}

function App() {
  const id = new URLSearchParams(location.search).get('room');
  return <main>{id && validRoom.test(id) ? <Room id={id}/> : <Landing/>}</main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
