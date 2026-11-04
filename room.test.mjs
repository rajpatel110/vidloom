import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

test('two peers exchange messages, enforce capacity and reconnect', {timeout: 90000}, async t => {
  const server = await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
  await server.listen();
  t.after(() => server.close());
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({args: ['--use-fake-device-for-media-stream', '--allow-loopback-in-peer-connection'], executablePath:process.env.BROWSER_PATH || (existsSync(edge) ? edge : undefined)});
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
  await first.goto(server.resolvedUrls.local[0]);
  await first.getByRole('button',{name:'Create room'}).click();
  const wait = (page, text) => page.getByText(text,{exact:true}).waitFor({timeout:10000});
  await wait(first,'Waiting for peer');
  const invite = first.url();
  const second = await context.newPage();
  await second.goto(invite);
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
  }
  for (const page of [first, second]) {
    await page.waitForFunction(async () => {
      const reports = [...(await window.roomPeer.getStats()).values()];
      const inbound = reports.filter(report => report.type === 'inbound-rtp');
      return inbound.some(report => report.kind === 'audio' && report.totalSamplesReceived > 0)
        && inbound.some(report => report.kind === 'video' && report.framesDecoded > 0);
    }, null, {timeout: 12000});
  }
  for (const name of ['Mute microphone', 'Turn camera off']) {
    await first.getByRole('button',{name}).click();
  }
  await first.waitForFunction(() => window.roomPeer.getSenders().every(sender => !sender.track));
  await exchange(first, second, 'chat after stopping devices');
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
