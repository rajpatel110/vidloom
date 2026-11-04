import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {joinRoom} from './peer';
import {CallMedia} from './CallMedia';
import './style.css';

function Room({id}: {id: string}) {
  const [state, status] = useState('Joining');
  const [messages, setMessages] = useState<{from:string, text:string}[]>([]);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState('');
  const peer = useRef<ReturnType<typeof joinRoom> | null>(null);
  function add(from:string, text:string) {
    setMessages(old => [...old.slice(-99), {from, text}]);
  }
  useEffect(() => {
    const connection = joinRoom(id, status, text => add('Peer', text), setRemote);
    peer.current = connection;
    return () => connection.close();
  }, [id]);
  return <><header><span>PEER ROOM</span><a href="/">Leave room</a></header>
    <h1>Call room</h1><p role="status">{state}</p>
    <label>Invite link<input readOnly value={location.href} onFocus={e => e.target.select()}/></label>
    <button onClick={async () => {try {await navigator.clipboard.writeText(location.href); setCopied('Copied');} catch {setCopied('Select the link above to copy it');}}}>Copy link</button> <small role="status">{copied}</small>
    {state === 'Connected' && peer.current && <CallMedia connection={peer.current} remote={remote}/>}
    <section role="log" aria-label="Chat messages">{messages.length ? messages.map((m,i) => <p key={i}><b>{m.from}</b> {m.text}</p>) : <p>Messages appear here once you and your peer connect.</p>}</section>
    <form onSubmit={e => {e.preventDefault(); const text = draft.trim(); if (text && peer.current?.send(text)) {add('You',text); setDraft('');}}}>
    <label>Message<input maxLength={2000} disabled={state !== 'Connected'} value={draft} onChange={e => setDraft(e.target.value)}/></label>
    <button disabled={state !== 'Connected' || !draft.trim()}>Send</button></form></>;
}
function App() {
  const id = new URLSearchParams(location.search).get('room');
  if (id && /^[a-zA-Z0-9_-]{1,64}$/.test(id)) return <main><Room id={id}/></main>;
  return <main><header>VIDLOOM / WEBRTC</header><h1>A room for two.</h1><p>Create a room and share its link to start a peer-to-peer call or chat.</p><button onClick={() => location.search = '?room=' + crypto.randomUUID()}>Create room</button></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
