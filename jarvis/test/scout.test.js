const test = require('node:test');
const assert = require('node:assert/strict');
const { recommendBans, assignRoles, predictPicks, suggestComp, gamePlan } = require('../src/scout/analysis');
const { parseRiotId } = require('../src/scout/opgg');

const player = (riotId, roles, champions) => ({
  riotId,
  rank: 'GOLD II',
  roles: Object.entries(roles).map(([role, games]) => ({ role, games })),
  champions: champions.map(([name, games, wins]) => ({ name, games, wins })),
});

const team = [
  player('Top#EUW', { TOP: 40, MID: 5 }, [['Darius', 30, 20], ['Garen', 5, 2]]),
  player('Jungle#EUW', { JUNGLE: 50 }, [['LeeSin', 25, 14], ['Viego', 20, 11]]),
  player('Mid#EUW', { MID: 30, TOP: 20 }, [['Ahri', 40, 24], ['Syndra', 3, 3]]),
  player('Adc#EUW', { ADC: 45 }, [['Jinx', 15, 7], ['Caitlyn', 10, 5]]),
  player('Sup#EUW', { SUPPORT: 35, ADC: 10 }, [['Thresh', 20, 12], ['Nautilus', 12, 6]]),
];

test('parseRiotId accepts Name#TAG with spaces', () => {
  assert.deepEqual(parseRiotId('Some Name # EUW'), { gameName: 'Some Name', tagLine: 'EUW' });
  assert.equal(parseRiotId('NoTag'), null);
});

test('bans target comfort picks, not small lucky samples', () => {
  const { bans, alternatives } = recommendBans(team);
  assert.equal(bans.length, 5);
  assert.equal(alternatives.length, 3);
  assert.ok(bans.some((b) => b.champion === 'Ahri'));
  assert.ok(bans.some((b) => b.champion === 'Darius'));
  assert.ok(!bans.some((b) => b.champion === 'Syndra'));
});

test('one player gets at most three bans', () => {
  const oneTrick = player('Otp#EUW', { MID: 50 }, [['A', 50, 35], ['B', 45, 30], ['C', 40, 28], ['D', 35, 25], ['E', 30, 20]]);
  const { bans } = recommendBans([oneTrick, team[3]]);
  assert.equal(bans.filter((b) => b.player === 'Otp#EUW').length, 3);
});

test('roles are unique and follow the most played position', () => {
  const roles = assignRoles(team).map((r) => r.role);
  assert.deepEqual(roles, ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']);
});

test('predicted picks skip banned champions', () => {
  const picks = predictPicks(team, new Set(['Ahri']));
  assert.equal(picks.find((p) => p.role === 'MID').champion, 'Syndra');
});

test('comp avoids bans and duplicates', async () => {
  const picks = predictPicks(team, new Set());
  const countersOf = async () => [{ name: 'Malphite' }, { name: 'Ahri' }, { name: 'Vex' }];
  const comp = await suggestComp(picks, new Set(['Ahri']), countersOf);
  assert.equal(comp[0].pick.name, 'Malphite');
  assert.equal(comp[0].alternative.name, 'Vex');
  assert.equal(comp[1].pick.name, 'Vex');
});

test('game plan reacts to champion classes', () => {
  const tags = { Darius: ['Fighter'], LeeSin: ['Fighter'], Ahri: ['Mage', 'Assassin'], Jinx: ['Marksman'], Thresh: ['Support', 'Fighter'] };
  const plan = gamePlan(predictPicks(team, new Set()), (name) => tags[name]);
  assert.equal(plan.length, 1);
  assert.match(plan[0], /Fighter-heavy/);
});
