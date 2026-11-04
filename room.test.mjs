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
  for (const page of [first, second]) {
    if (process.env.ICE_TRANSPORT_POLICY === 'relay') await wait(page, 'Relayed via TURN');
    else if (!process.env.TURN_URLS) await wait(page, 'Direct peer connection');
    else await wait(page, /^(Direct peer connection|Relayed via TURN)$/);
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
  await exchange(first, second, 'chat during screen share');
  await first.getByRole('button', {name:'Stop sharing'}).click();
  await first.waitForFunction(() => window.displayTrack.readyState === 'ended' &&
    window.roomPeer.getSenders().some(s => s.track === window.originalCamera));
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
  await third.reload();
  await exchange(third,second,'slot reused');
});
