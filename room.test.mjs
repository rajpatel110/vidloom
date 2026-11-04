import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fork } from 'node:child_process';


test('two peers exchange messages, enforce capacity and reconnect', {timeout: 90000}, async t => {
  const server = fork(new URL('./serve.mjs', import.meta.url), {
    env: {...process.env, HOST: '127.0.0.1', PORT: '0'}
  });
  t.after(() => server.kill());
  const ready = new Promise((resolve, reject) => {
    server.once('message', resolve);
    server.once('error', reject);
    server.once('exit', code => reject(new Error('Server exited: ' + code)));
  });
  const {port} = await ready;
  const origin = 'http://127.0.0.1:' + port;
  assert.equal(await (await fetch(origin + '/healthz')).text(), 'ok');
  assert.equal((await fetch(origin + '/server.mjs')).status, 404);
  assert.equal((await fetch(origin, {method:'POST'})).status, 405);
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--allow-loopback-in-peer-connection'], executablePath:process.env.BROWSER_PATH || (existsSync(edge) ? edge : undefined)});
  t.after(() => browser.close());
  const context = await browser.newContext();
  await context.grantPermissions(['camera', 'microphone']);
  await context.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) { super(...args); window.signalingSocket = this; }
    };
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(...args) { super(...args); window.roomPeer = this; }
    };
  });
  const first = await context.newPage();
  await first.goto(origin);
  await first.getByRole('button',{name:'Create room'}).click();
  const wait = (page, text) => page.getByText(text,{exact:true}).waitFor({timeout:10000});
  await wait(first,'Waiting for peer');
  const invite = first.url();
  const second = await context.newPage();
  await second.setViewportSize({width: 360, height: 800});
  await second.goto(origin);
  assert.ok(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await second.getByLabel('Have an invite?').fill(invite);
  await second.getByRole('button', {name: 'Join room'}).click();
  async function exchange(sender, receiver, text) {
    await Promise.all([wait(sender,'Connected'),wait(receiver,'Connected')]);
    await sender.getByLabel('Message',{exact:true}).fill(text);
    await sender.getByRole('button',{name:'Send',exact:true}).click();
    await receiver.getByRole('log').getByText(text,{exact:false}).waitFor({timeout:5000});
  }
  await exchange(first,second,'hello');
  await wait(second,'Peer microphone muted');
  await wait(second,'Peer camera off');
  const payload = randomBytes(1024 * 1024 + 17);
  const fileInput = first.getByLabel('Send a file', {exact:false});
  await fileInput.setInputFiles({name:'sample.bin', mimeType:'application/octet-stream', buffer:payload});
  await exchange(first, second, 'chat alongside file transfer');
  const downloadEvent = second.waitForEvent('download');
  await second.getByRole('link', {name:'Download sample.bin'}).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'sample.bin');
  assert.deepEqual(await readFile(await download.path()), payload);
  await wait(first, 'Peer received sample.bin');
  await fileInput.setInputFiles({name:'oversized.bin', mimeType:'application/octet-stream', buffer:Buffer.alloc(8*1024*1024 + 1)});
  await wait(first, 'Choose a file up to 8 MiB.');
  await second.getByLabel('Send a file', {exact:false}).setInputFiles({
    name:'empty.txt', mimeType:'text/plain', buffer:Buffer.alloc(0)
  });
  await wait(first, 'Download empty.txt');
  await wait(second, 'Peer received empty.txt');
  for (const page of [first, second]) {
    if (process.env.ICE_TRANSPORT_POLICY === 'relay') await wait(page, 'Relayed via TURN');
    else if (!process.env.TURN_URLS) await wait(page, 'Direct peer connection');
    else await wait(page, /^(Direct peer connection|Relayed via TURN)$/);
    await page.getByText('Connection details', {exact:true}).click();
    const fields = page.locator('.diagnostics dd');
    const actual = await page.evaluate(async () => {
      const stats = await window.roomPeer.getStats();
      const transport = [...stats.values()].find(s => s.selectedCandidatePairId);
      const pair = stats.get(transport.selectedCandidatePairId);
      const local = stats.get(pair.localCandidateId);
      return [local.candidateType, stats.get(pair.remoteCandidateId).candidateType, local.protocol.toUpperCase()];
    });
    assert.deepEqual((await fields.allTextContents()).slice(0,3), actual);
    await page.locator('.diagnostics dd').filter({hasText:/^\d+ ms$/}).waitFor();
    await page.getByRole('button',{name:'Enable microphone'}).click();
    await page.getByRole('button',{name:'Enable camera'}).click();
    await page.getByRole('button',{name:'Turn camera off'}).waitFor();
  }
  for (const page of [first, second]) {
    await page.waitForFunction(async () => {
      const reports = [...(await window.roomPeer.getStats()).values()];
      const inbound = reports.filter(report => report.type === 'inbound-rtp');
      return inbound.some(report => report.kind === 'audio' && report.totalSamplesReceived > 0)
        && inbound.some(report => report.kind === 'video' && report.framesDecoded > 0);
    }, null, {timeout: 12000});
  }
  for (const page of [first,second]) {
    await wait(page,'Peer microphone on');
    await wait(page,'Peer camera on');
  }
  // A solid green synthetic display lets the receiver prove which source it decoded.
  await first.evaluate(() => {
    window.originalCamera = window.roomPeer.getSenders().find(s => s.track?.kind === 'video').track;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      function draw() { ctx.fillStyle = 'lime'; ctx.fillRect(0, 0, 320, 180); }
      draw();
      const stream = canvas.captureStream(10);
      window.displayTrack = stream.getVideoTracks()[0];
      const timer = setInterval(() => {
        if (window.displayTrack.readyState === 'ended') clearInterval(timer);
        else draw();
      }, 100);
      return stream;
    };
  });
  await first.getByRole('button', {name:'Share screen'}).click();
  await second.waitForFunction(() => {
    const video = document.querySelector('video[aria-label="Peer video"]');
    if (video?.videoWidth !== 320) return false;
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.drawImage(video, 0, 0, 1, 1);
    const [r,g,b] = ctx.getImageData(0,0,1,1).data;
    return g > 180 && r < 60 && b < 60;
  }, null, {timeout:12000});
  await wait(second,'Peer sharing screen');
  await exchange(first, second, 'chat during screen share');
  await first.getByRole('button', {name:'Stop sharing'}).click();
  await first.waitForFunction(() => window.displayTrack.readyState === 'ended' &&
    window.roomPeer.getSenders().some(s => s.track === window.originalCamera));
  await wait(second,'Peer camera on');
  for (const name of ['Mute microphone', 'Turn camera off']) {
    await first.getByRole('button',{name}).click();
  }
  await first.waitForFunction(() => window.roomPeer.getSenders().every(sender => !sender.track));
  await first.getByRole('button', {name:'Share screen'}).click();
  await first.getByRole('button', {name:'Stop sharing'}).waitFor();
  await first.evaluate(() => {
    window.displayTrack.stop();
    window.displayTrack.dispatchEvent(new Event('ended'));
  });
  await first.getByRole('button', {name:'Share screen'}).waitFor();
  await first.waitForFunction(() => window.roomPeer.getSenders().every(sender => !sender.track));
  await wait(second,'Peer microphone muted');
  await wait(second,'Peer camera off');
  await exchange(first, second, 'chat after stopping devices');
  assert.ok(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const third = await context.newPage();
  await third.goto(invite);
  await wait(third,'Room full');
  assert.equal(await third.getByLabel('Message',{exact:true}).isDisabled(),true);
  await first.reload();
  await exchange(first,second,'first rejoined');
  await second.reload();
  await exchange(second,first,'second rejoined');
  await first.close();
  await wait(second,'Waiting for peer');
  await third.getByRole('button', {name:'Rejoin room'}).click();
  await exchange(third,second,'slot reused');
  await wait(third,'Peer microphone muted');
  await wait(third,'Peer camera off');
  await third.evaluate(() => {
    window.beforeRejoin = true;
    window.signalingSocket.close();
  });
  await wait(third, 'Disconnected');
  await wait(second, 'Waiting for peer');
  await third.getByRole('button', {name:'Rejoin room'}).click();
  await exchange(second,third,'recovered after signaling loss');
  assert.equal(await third.evaluate(() => window.beforeRejoin), true);
});
