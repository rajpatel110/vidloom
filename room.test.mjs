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
  const browser = await chromium.launch({executablePath:process.env.BROWSER_PATH || (existsSync(edge) ? edge : undefined)});
  t.after(() => browser.close());
  const context = await browser.newContext();
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
