const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNotation } = require('../src/scout/notation');
const { parseText } = require('../src/scout/mcp');
const { championKey, normalizeRank, normalizeRoles, normalizeChampions } = require('../src/scout/opgg');

// Shapes copied from real mcp-api.op.gg answers; names and ids replaced.
const PROFILE = `class LolGetSummonerProfile: data
class Data: summoner
class Summoner: game_name,tagline,league_stats,most_champions
class LeagueStat: game_type,tier_info,win,lose
class TierInfo: tier,division,lp
class MostChampions: champion_stats
class ChampionStat: play,win,lose,champion_name

LolGetSummonerProfile(Data(Summoner("Enemy One","EUW",[LeagueStat("SOLORANKED",TierInfo("MASTER",1,333),602,630),LeagueStat("FLEXRANKED",TierInfo(null,null,null),null,null)],MostChampions([ChampionStat(1158,575,583,"Ahri"),ChampionStat(53,22,31,"Lux"),ChampionStat(1,0,1,"Miss Fortune")]))))`;

const MATCHES = `class LolListSummonerMatches: data
class Data: game_history
class GameHistory: participants
class Participant: champion_name,position

LolListSummonerMatches(Data([GameHistory([Participant("Ahri","MID")]),GameHistory([Participant("Ahri","ADC")]),GameHistory([Participant("Lux","MID")])]))`;

const COUNTERS_EMPTY = `class LolGetChampionAnalysis: data
class Data: counters_meta
class CountersMeta: message

LolGetChampionAnalysis(Data(CountersMeta("Insufficient matchup sample.")))`;

test('class notation becomes plain objects', () => {
  const summoner = parseNotation(PROFILE).data.summoner;
  assert.equal(summoner.game_name, 'Enemy One');
  assert.deepEqual(summoner.league_stats[0].tier_info, { tier: 'MASTER', division: 1, lp: 333 });
  assert.equal(summoner.league_stats[1].win, null);
  assert.deepEqual(summoner.most_champions.champion_stats[2], { play: 1, win: 0, lose: 1, champion_name: 'Miss Fortune' });
  assert.equal(parseNotation(COUNTERS_EMPTY).data.counters_meta.message, 'Insufficient matchup sample.');
});

test('class notation handles escapes, empty lists and booleans', () => {
  const text = 'class A: s,l,b,n\n\nA("Rek\'Sai \\"x\\"",[],true,-1.5e2)';
  assert.deepEqual(parseNotation(text), { s: 'Rek\'Sai "x"', l: [], b: true, n: -150 });
  assert.throws(() => parseNotation('class A: x\n\nB(1)'), /Unknown class/);
  assert.throws(() => parseNotation('A(1)'), /class notation/);
});

test('tool text is read as JSON first, then as class notation', () => {
  assert.deepEqual(parseText('{"data":{"ok":1}}'), { data: { ok: 1 } });
  assert.equal(parseText(MATCHES).data.game_history.length, 3);
});

test('profile and match data map to the scouting shapes', () => {
  const summoner = parseNotation(PROFILE).data.summoner;
  assert.equal(normalizeRank(summoner.league_stats), 'MASTER 333 LP, 49 % WR');
  assert.equal(normalizeRank([{ game_type: 'SOLORANKED', tier_info: { tier: 'GOLD', division: 2, lp: 40 }, win: 13, lose: 12 }]), 'GOLD II 40 LP, 52 % WR');
  assert.equal(normalizeRank([{ game_type: 'SOLORANKED', tier_info: { tier: null } }]), null);
  assert.deepEqual(normalizeChampions(summoner.most_champions.champion_stats)[0], { name: 'Ahri', games: 1158, wins: 575 });
  assert.deepEqual(normalizeRoles(parseNotation(MATCHES).data.game_history), [{ role: 'MID', games: 2 }, { role: 'ADC', games: 1 }]);
});

test('champion names become OP.GG keys', () => {
  assert.equal(championKey('Miss Fortune'), 'MISS_FORTUNE');
  assert.equal(championKey("Kai'Sa"), 'KAISA');
  assert.equal(championKey('Nunu & Willump'), 'NUNU_WILLUMP');
  assert.equal(championKey('Dr. Mundo'), 'DR_MUNDO');
});

test('cache shares loads, keeps results and forgets failures', async () => {
  const { TtlCache } = require('../src/scout/cache');
  const cache = new TtlCache(60e3, 2);
  let loads = 0;
  const load = async () => ++loads;
  assert.deepEqual(await Promise.all([cache.get('a', load), cache.get('a', load)]), [1, 1]);
  assert.equal(await cache.get('a', load), 1);
  await assert.rejects(cache.get('b', async () => Promise.reject(new Error('down'))));
  assert.equal(await cache.get('b', load), 2);
  await cache.get('c', load);
  assert.equal(await cache.get('a', load), 4, 'oldest entry is dropped beyond maxEntries');
});
