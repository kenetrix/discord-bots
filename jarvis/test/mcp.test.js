const test = require('node:test');
const assert = require('node:assert/strict');
const { callTool } = require('../src/scout/mcp');

const rpc = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** Answers initialize and the notification, then hands tools/call to `onCall`. */
function fakeOpgg(onCall) {
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === 'initialize') return rpc({ jsonrpc: '2.0', id: body.id, result: {} });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return onCall(body);
  };
}

test('failures carry a kind the command can explain', async (t) => {
  const realFetch = global.fetch;
  t.after(() => {
    global.fetch = realFetch;
  });

  fakeOpgg((body) => rpc({ jsonrpc: '2.0', id: body.id, error: { code: -32600, message: 'Summoner not found' } }));
  await assert.rejects(callTool('lol_get_summoner_profile', {}), { kind: 'not_found' });

  fakeOpgg(() => new Response('slow down', { status: 429 }));
  await assert.rejects(callTool('lol_get_summoner_profile', {}), { kind: 'rate_limited' });

  fakeOpgg(() => new Response('bad gateway', { status: 502 }));
  await assert.rejects(callTool('lol_get_summoner_profile', {}), { kind: 'unavailable' });

  fakeOpgg(() => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(callTool('lol_get_summoner_profile', {}), { kind: 'unavailable' });

  fakeOpgg((body) => rpc({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'class A: x\n\nA(1)' }] } }));
  assert.deepEqual(await callTool('lol_get_summoner_profile', {}), { x: 1 });
});
