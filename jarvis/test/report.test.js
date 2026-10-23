const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, overview, render, parseButton, shortRank, threatDots } = require('../src/scout/report');

const player = (riotId, role, champion) => ({
  riotId,
  rank: 'GOLD II 40 LP, 52 % WR',
  roles: [{ role, games: 15, champions: [{ name: champion, games: 15 }] }],
  champions: [{ name: 'Other', games: 5, wins: 2 }, { name: champion, games: 50, wins: 30 }],
});

const report = buildReport({
  id: 'abc123',
  region: 'EUW',
  players: [player('Sup#EUW', 'SUPPORT', 'Thresh'), player('Top One#EUW', 'TOP', 'Garen')],
  picks: [
    { player: 'Sup#EUW', role: 'SUPPORT', champion: 'Thresh', second: null },
    { player: 'Top One#EUW', role: 'TOP', champion: 'Garen', second: { role: 'JUNGLE', champion: 'Wukong' } },
  ],
  comp: [{ role: 'TOP', against: 'Garen', pick: { name: 'Vayne' }, alternative: { name: 'Teemo' } }],
  flex: [{ player: 'Top One#EUW', role: 'JUNGLE', against: 'Wukong', pick: { name: 'Rammus' } }],
  threats: new Map([['Sup#EUW', { score: 2 }], ['Top One#EUW', { score: 4 }]]),
  bans: [{ champion: 'Garen', player: 'Top One#EUW', games: 50, winRate: 60 }],
  alternatives: [],
  plan: [],
  failed: [],
});

test('report sorts enemies by role and sorts their champions', () => {
  assert.deepEqual(report.enemies.map((e) => e.role), ['TOP', 'SUPPORT']);
  assert.equal(report.enemies[0].player.champions[0].name, 'Garen');
  assert.equal(report.enemies[0].dots, '●●●●●');
  assert.equal(report.enemies[1].dots, '●●●○○');
});

test('overview links every player and has a button per player plus Bans', () => {
  const message = overview(report);
  const embed = message.embeds[0].toJSON();
  assert.equal(embed.fields.length, 2);
  assert.match(embed.fields[0].value, /\[Top One#EUW\]\(https:\/\/op\.gg\/lol\/summoners\/euw\/Top%20One-EUW\)/);
  assert.match(embed.fields[0].value, /After bans: \*\*Garen\*\* → pick \*\*Vayne\*\*/);
  const ids = message.components.flatMap((row) => row.toJSON().components.map((c) => c.custom_id));
  assert.deepEqual(ids, ['scout:abc123:p0', 'scout:abc123:p1', 'scout:abc123:bans']);
});

test('detail views carry an Overview button and show the second role', () => {
  const view = render(report, 'p0');
  const fields = view.embeds[0].toJSON().fields;
  assert.match(fields.find((f) => f.name === 'Second role').value, /Wukong.*Rammus/);
  assert.ok(view.components[1].toJSON().components.some((c) => c.custom_id === 'scout:abc123:back'));
  assert.ok(render(report, 'bans'));
  assert.equal(render(report, 'back').components[1].toJSON().components.length, 1);
  assert.equal(render(report, 'p7'), null);
});

test('button ids and small helpers', () => {
  assert.deepEqual(parseButton('scout:abc123:p1'), { id: 'abc123', view: 'p1' });
  assert.equal(parseButton('rolepanel:1'), null);
  assert.equal(shortRank('GRANDMASTER 1806 LP, 52 % WR'), 'Grandmaster 1806 LP');
  assert.equal(shortRank(null), 'Unranked');
  assert.equal(threatDots(0, 0), '○○○○○');
});
