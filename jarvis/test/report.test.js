const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, overview, render, parseButton, shortRank, poolText } = require('../src/scout/report');

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
  threats: new Map([
    ['Sup#EUW', { level: 'medium', ranked: true, champion: 'Thresh', games: 50, winRate: 60 }],
    ['Top One#EUW', { level: 'high', ranked: true, champion: 'Garen', games: 50, winRate: 60 }],
  ]),
  bans: [{ champion: 'Garen', player: 'Top One#EUW', games: 50, winRate: 60 }],
  alternatives: [],
  plan: [],
  failed: [],
});

const withMissing = { ...report, failed: ['Ghost: no player with this name and tag #EUW, #EUW1 in EUW. Add the tag (Name#TAG).'] };

test('report sorts enemies by role and sorts their champions', () => {
  assert.deepEqual(report.enemies.map((e) => e.role), ['TOP', 'SUPPORT']);
  assert.equal(report.enemies[0].player.champions[0].name, 'Garen');
  assert.equal(report.enemies[0].threat, '🔴 High threat');
  assert.equal(report.enemies[1].threat, '🟠 Medium threat');
});

test('overview shows only bans, lanes and counter picks, with a button per player plus Bans', () => {
  const message = overview(report);
  const embed = message.embeds[0].toJSON();
  assert.equal(embed.description, '🚫 All bans: Garen');
  assert.deepEqual(
    embed.fields.map((f) => [f.name, f.value]),
    [
      ['🏝️ Top vs Top One', '🚫 Ban: **Garen**\n🎯 Our pick: **Vayne** or Teemo'],
      ['🛡️ Support vs Sup', '🚫 Ban: none\n🎯 Our pick: no counter data'],
    ],
  );
  assert.doesNotMatch(JSON.stringify(embed), /Gold|threat|Thresh/);
  const ids = message.components.flatMap((row) => row.toJSON().components.map((c) => c.custom_id));
  assert.deepEqual(ids, ['scout:abc123:p0', 'scout:abc123:p1', 'scout:abc123:bans']);
});

test('detail views carry an Overview button and show the second role', () => {
  const view = render(report, 'p0');
  const fields = view.embeds[0].toJSON().fields;
  assert.match(fields.find((f) => f.name.startsWith('Second role')).value, /Wukong.*Rammus/);
  assert.ok(view.components[1].toJSON().components.some((c) => c.custom_id === 'scout:abc123:back'));
  assert.equal(view.embeds[0].toJSON().description, 'Gold II 40 LP · 52 % WR\n🔴 High threat: Gold II · best on Garen (50 games, 60 %)');
  assert.ok(render(report, 'bans'));
  assert.equal(render(report, 'back').components[1].toJSON().components.length, 1);
  assert.equal(render(report, 'p7'), null);
});

test('button ids and small helpers', () => {
  assert.deepEqual(parseButton('scout:abc123:p1'), { id: 'abc123', view: 'p1' });
  assert.equal(parseButton('rolepanel:1'), null);
  assert.equal(shortRank('GRANDMASTER 1806 LP, 52 % WR'), 'Grandmaster 1806 LP');
  assert.equal(shortRank(null), 'Unranked');
});

test('players that could not be scouted are named at the top of the overview', () => {
  const description = overview(withMissing).embeds[0].toJSON().description;
  assert.match(description, /^⚠️ \*\*Not scouted:\*\*\n• Ghost: no player/);
  assert.match(description, /🚫 All bans: Garen$/);
});

test('pool marks bans and the likely pick in one list', () => {
  const champions = [
    { name: 'A', games: 30, wins: 15 },
    { name: 'B', games: 20, wins: 12 },
    { name: 'C', games: 10, wins: 5 },
    { name: 'D', games: 5, wins: 4 },
  ];
  assert.equal(poolText(champions, new Set(['A', 'B']), 'D', { limit: 3, stats: false }), '🚫 A · 🚫 B · C · ➜ **D**');
  assert.equal(poolText(champions, new Set(), 'Z', { limit: 1, stats: true }), 'A · 30 games · 50 %\n➜ **Z** (recent games)');
  assert.equal(poolText([], new Set(), null, { limit: 3, stats: false }), 'no ranked games this season');
});
