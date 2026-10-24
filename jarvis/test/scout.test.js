const test = require('node:test');
const assert = require('node:assert/strict');
const { recommendBans, assignRoles, secondRole, predictPicks, playerThreats, rankValue, suggestComp, suggestFlexCounters, gamePlan } = require('../src/scout/analysis');
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

test('parseRiotId accepts Name#TAG with spaces and a bare name', () => {
  assert.deepEqual(parseRiotId('Some Name # EUW'), { gameName: 'Some Name', tagLine: 'EUW' });
  assert.deepEqual(parseRiotId(' NoTag '), { gameName: 'NoTag', tagLine: null });
  assert.equal(parseRiotId('ab'), null);
  assert.equal(parseRiotId('a#b#c'), null);
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

test('predicted picks stay in the role when OP.GG knows the role pool', () => {
  const flex = player('Flex#EUW', { ADC: 20 }, [['Shen', 30, 20], ['Jinx', 10, 5]]);
  const pools = new Map([['ADC', new Set(['Jinx'])]]);
  assert.equal(predictPicks([flex], new Set(), pools)[0].champion, 'Jinx');
  assert.equal(predictPicks([flex], new Set())[0].champion, 'Shen');
});

test('comp prefers counters that are played in the role', async () => {
  const picks = [{ role: 'ADC', champion: 'Jinx' }];
  const countersOf = async () => [{ name: 'Yasuo' }, { name: 'Draven' }, { name: 'Ashe' }];
  const pools = new Map([['ADC', new Set(['Draven', 'Ashe'])]]);
  const [adc] = await suggestComp(picks, new Set(), countersOf, pools);
  assert.equal(adc.pick.name, 'Draven');
  assert.equal(adc.alternative.name, 'Ashe');
});

test('second role needs real games, not a single fill', () => {
  const flex = player('Flex#EUW', { TOP: 12, JUNGLE: 6, SUPPORT: 1 }, [['Garen', 30, 16]]);
  assert.equal(secondRole(flex, 'TOP'), 'JUNGLE');
  assert.equal(secondRole(player('Otp#EUW', { MID: 19, TOP: 1 }, []), 'MID'), null);
});

test('picks include the second role with a champion played there', () => {
  const flex = player('Flex#EUW', { TOP: 12, JUNGLE: 6 }, [['Garen', 30, 16], ['JarvanIV', 10, 6]]);
  const pools = new Map([['TOP', new Set(['Garen'])], ['JUNGLE', new Set(['JarvanIV'])]]);
  const [pick] = predictPicks([flex], new Set(), pools);
  assert.equal(pick.champion, 'Garen');
  assert.deepEqual(pick.second, { role: 'JUNGLE', champion: 'JarvanIV' });
});

test('flex counters avoid bans and picks already suggested', async () => {
  const picks = [{ player: 'Flex#EUW', role: 'TOP', champion: 'Garen', second: { role: 'JUNGLE', champion: 'JarvanIV' } }];
  const comp = [{ role: 'TOP', pick: { name: 'Rammus' } }];
  const countersOf = async () => [{ name: 'Rammus' }, { name: 'Udyr' }, { name: 'Vi' }];
  const [flex] = await suggestFlexCounters(picks, new Set(['Udyr']), comp, countersOf);
  assert.equal(flex.pick.name, 'Vi');
});

test('threat puts rank first: a Platinum player outranks a Silver one-trick', () => {
  const silver = { ...player('Silver#EUW', { MID: 14 }, [['ChoGath', 89, 45], ['Yone', 73, 36]]), rank: 'SILVER IV 14 LP, 49 % WR' };
  const plat = { ...player('Plat#EUW', { ADC: 9 }, [['Syndra', 25, 10], ['Ziggs', 14, 9]]), rank: 'PLATINUM IV 87 LP, 51 % WR' };
  const threats = playerThreats([silver, plat]);
  assert.equal(threats.get('Silver#EUW').level, 'low');
  assert.equal(threats.get('Plat#EUW').level, 'medium');
  assert.ok(threats.get('Plat#EUW').score > threats.get('Silver#EUW').score);
  assert.equal(threats.get('Silver#EUW').champion, 'ChoGath');
});

test('threat levels follow the rank, a strong main lifts it', () => {
  const at = (rank, champions = [['A', 10, 5]]) => playerThreats([{ ...player('X#EUW', { MID: 10 }, champions), rank }]).get('X#EUW');
  assert.equal(rankValue('SILVER IV 14 LP, 49 % WR'), 2.25);
  assert.equal(rankValue('MASTER 26 LP, 51 % WR'), 8);
  assert.equal(rankValue(null), null);
  assert.equal(at('DIAMOND IV 0 LP').level, 'high');
  assert.equal(at('EMERALD IV 0 LP').level, 'medium');
  assert.equal(at('EMERALD II 0 LP', [['A', 200, 130]]).level, 'high');
  assert.equal(at('GOLD IV 0 LP').level, 'low');
  assert.equal(at(null).ranked, false);
});
