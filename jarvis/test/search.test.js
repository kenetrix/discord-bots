const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSearch, rankAccounts } = require('../src/scout/search');

// Shape copied from a real op.gg search answer (React Server Components rows); names, tags and ids replaced.
const account = (name, tag, tier, division, lp, revision) =>
  JSON.stringify({
    data: {
      id: 1,
      puuid: `${name}-${tag}`,
      game_name: name,
      tagline: tag,
      region: null,
      level: 300,
      updated_at: '2026-10-24T09:24:03+09:00',
      revision_at: revision,
      solo_tier_info: tier ? { tier, division, lp, level: null, tier_image_url: 'x' } : null,
      player: null,
    },
    region: '$4a:props:children:1',
    index: 0,
  });

const SEARCH = [
  '0:{"P":null,"b":"1","c":["","lol","summoners","search?q=Enemy"]}',
  '2:I[12345,["static/chunks/1.js"],"default"]',
  `5e:["$","div",null,{"className":"flex","children":[["$","$L72","a",${account('Enemy One', 'OLD', 'CHALLENGER', 1, 900, '2025-01-01T00:00:00+09:00')}],["$","$L72","b",${account('Enemy One', 'MAIN', 'DIAMOND', 2, 50, '2026-10-20T00:00:00+09:00')}]]}]`,
  `73:["$","$L72","c",${account('enemyone', 'SMURF', 'GOLD', 1, 10, '2026-10-23T00:00:00+09:00')}]`,
  `74:["$","$L72","d",${account('Enemy One', 'NEW', null, null, null, '2026-10-23T00:00:00+09:00')}]`,
  `75:["$","$L72","e",${account('Enemy Ones', 'OTHER', 'MASTER', 1, 10, '2026-10-23T00:00:00+09:00')}]`,
  `76:["$","$L72","a2",${account('Enemy One', 'OLD', 'CHALLENGER', 1, 900, '2025-01-01T00:00:00+09:00')}]`,
  '77:T42,not json at all',
].join('\n');

const NOW = Date.parse('2026-10-24T00:00:00Z');

test('search answers become accounts, one per Riot ID', () => {
  const accounts = parseSearch(SEARCH);
  assert.equal(accounts.length, 5);
  assert.deepEqual(accounts[1], { gameName: 'Enemy One', tagLine: 'MAIN', tier: 'DIAMOND', division: 2, lp: 50, activeAt: Date.parse('2026-10-20T00:00:00+09:00') });
  assert.equal(accounts[3].tier, null);
  assert.deepEqual(parseSearch('<!DOCTYPE html><html></html>'), []);
});

test('exact name matches come first: active accounts, then by rank', () => {
  const ranked = rankAccounts(parseSearch(SEARCH), 'enemy one', NOW);
  assert.deepEqual(ranked.map((a) => a.tagLine), ['MAIN', 'SMURF', 'NEW', 'OLD']);
  assert.deepEqual(rankAccounts(parseSearch(SEARCH), 'Enemy', NOW).map((a) => a.tagLine), ['OTHER', 'MAIN', 'SMURF', 'NEW', 'OLD'], 'no exact match keeps what OP.GG found');
});

test('a bare name is looked up with the name search, then with default tags', async (t) => {
  const { getPlayer } = require('../src/scout/opgg');
  const realFetch = global.fetch;
  const realWarn = console.warn;
  t.after(() => {
    global.fetch = realFetch;
    console.warn = realWarn;
  });
  console.warn = () => {};
  const rpc = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const known = new Set(['Enemy One#MAIN', 'Enemy One#SMURF', 'Solo#EUW']);
  const asked = [];
  let search = (name) => (name === 'Enemy One' ? SEARCH : '0:{}');
  global.fetch = async (url, init) => {
    if (String(url).includes('/summoners/search')) {
      const q = new URL(url).searchParams.get('q');
      const text = search(q);
      return text === null ? new Response('busy', { status: 429 }) : new Response(text, { headers: { 'content-type': 'text/x-component' } });
    }
    const body = JSON.parse(init.body);
    if (body.method === 'initialize') return rpc({ jsonrpc: '2.0', id: body.id, result: {} });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const { name, arguments: args } = body.params;
    const riotId = `${args.game_name}#${args.tag_line}`;
    if (name === 'lol_get_summoner_profile') asked.push(riotId);
    if (!known.has(riotId)) return rpc({ jsonrpc: '2.0', id: body.id, error: { code: -32600, message: 'Summoner not found' } });
    const text = name === 'lol_get_summoner_profile' ? JSON.stringify({ data: { summoner: { game_name: args.game_name, tagline: args.tag_line } } }) : '{"data":{"game_history":[]}}';
    return rpc({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text }] } });
  };

  // Several accounts: the active one with the highest rank (by exact name, case and spaces ignored).
  const player = await getPlayer('Enemy One', 'EUW');
  assert.equal(player.riotId, 'Enemy One#MAIN');
  assert.equal(player.guessedTag, true);
  assert.deepEqual(player.namesakes, ['SMURF', 'NEW', 'OLD']);

  // The search is down: back to the default tags, without marking namesakes.
  search = () => null;
  const solo = await getPlayer('Solo', 'EUW');
  assert.equal(solo.riotId, 'Solo#EUW');
  assert.equal(solo.guessedTag, true);
  assert.equal(solo.namesakes, undefined);

  // One account with that name is not a guess.
  search = () => `1:["$","$L72","a",${account('Single', 'X1', 'GOLD', 2, 0, '2026-10-23T00:00:00+09:00')}]`;
  known.add('Single#X1');
  const single = await getPlayer('Single', 'EUW');
  assert.equal(single.riotId, 'Single#X1');
  assert.equal(single.guessedTag, false);

  // Accounts the search knows but OP.GG does not are skipped, and every tried tag is reported.
  search = () => `1:["$","$L72","a",${account('Ghost', 'GONE', 'GOLD', 2, 0, '2026-10-23T00:00:00+09:00')}]`;
  asked.length = 0;
  await assert.rejects(getPlayer('Ghost', 'EUW'), (err) => err.kind === 'not_found' && err.triedTags.join() === 'GONE,EUW,EUW1');
  assert.deepEqual(asked, ['Ghost#GONE', 'Ghost#EUW', 'Ghost#EUW1']);
});
