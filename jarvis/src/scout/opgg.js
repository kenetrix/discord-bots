// Fetches scouting data from OP.GG and maps it to the shapes used in analysis.js.
const { callTool } = require('./mcp');

const REGIONS = ['EUW', 'EUNE', 'NA', 'KR', 'BR', 'LAN', 'LAS', 'OCE', 'TR', 'RU', 'JP', 'ME', 'SEA', 'TW', 'VN'];

const POSITION_ALIASES = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MID: 'MID',
  MIDDLE: 'MID',
  ADC: 'ADC',
  BOTTOM: 'ADC',
  BOT: 'ADC',
  SUPPORT: 'SUPPORT',
  UTILITY: 'SUPPORT',
};

/** Splits "Name#TAG" (spaces around # allowed) into its parts, or returns null. */
function parseRiotId(input) {
  const match = /^\s*(.{3,16}?)\s*#\s*([^\s#]{2,5})\s*$/u.exec(input ?? '');
  return match ? { gameName: match[1], tagLine: match[2] } : null;
}

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const pick = (obj, ...keys) => keys.map((k) => obj?.[k]).find((v) => v !== undefined && v !== null);

function normalizeRank(leagueStats = []) {
  const solo = leagueStats.find((s) => /SOLO/i.test(pick(s, 'game_type', 'queue_type') ?? '')) ?? leagueStats[0];
  const tier = pick(solo?.tier_info ?? solo, 'tier');
  if (!tier) return null;
  const division = pick(solo.tier_info ?? solo, 'division');
  const lp = pick(solo.tier_info ?? solo, 'lp');
  const wins = num(pick(solo, 'win', 'wins'));
  const losses = num(pick(solo, 'lose', 'losses'));
  const record = wins + losses ? `, ${Math.round((wins / (wins + losses)) * 100)} % WR` : '';
  return `${tier}${division ? ` ${division}` : ''}${lp !== undefined ? ` ${lp} LP` : ''}${record}`;
}

function normalizeChampions(list = []) {
  return list
    .map((c) => {
      const games = num(pick(c, 'play', 'games', 'game_count'));
      const wins = num(pick(c, 'win', 'wins'));
      return { name: pick(c, 'champion_name', 'name', 'champion'), games, wins };
    })
    .filter((c) => c.name && c.games);
}

function normalizeRoles(list = []) {
  return list
    .map((p) => ({ role: POSITION_ALIASES[String(pick(p, 'position', 'role') ?? '').toUpperCase()], games: num(pick(p, 'play', 'games', 'game_count')) }))
    .filter((p) => p.role);
}

/** Rank, role stats and champion pool of one player. */
async function getPlayer(riotId, region) {
  const id = parseRiotId(riotId);
  if (!id) throw new Error(`"${riotId}" is not a Riot ID like Name#TAG.`);
  const data = await callTool('lol_get_summoner_profile', {
    game_name: id.gameName,
    tag_line: id.tagLine,
    region,
    desired_output_fields: [
      'data.summoner.{game_name,tagline}',
      'data.summoner.league_stats[].{game_type,win,lose}',
      'data.summoner.league_stats[].tier_info.{tier,division,lp}',
      'data.summoner.most_champions.champion_stats[].{champion_name,play,win,lose}',
      'data.summoner.most_champions.position_stats[].{position,play,win,lose}',
    ],
  });
  const summoner = data?.data?.summoner;
  if (!summoner) throw new Error(`OP.GG has no profile for ${riotId} in ${region}.`);
  return {
    riotId: `${pick(summoner, 'game_name') ?? id.gameName}#${pick(summoner, 'tagline', 'tag_line') ?? id.tagLine}`,
    rank: normalizeRank(summoner.league_stats),
    roles: normalizeRoles(summoner.most_champions?.position_stats),
    champions: normalizeChampions(summoner.most_champions?.champion_stats),
  };
}

const ROLE_TO_POSITION = { TOP: 'top', JUNGLE: 'jungle', MID: 'mid', ADC: 'adc', SUPPORT: 'support' };

/** Champions that beat `champion` in `role`, best first. */
async function getCounters(champion, role) {
  const data = await callTool('lol_get_champion_analysis', {
    champion: champion.toUpperCase().replace(/[^A-Z]/g, ''),
    position: ROLE_TO_POSITION[role],
    game_mode: 'ranked',
    desired_output_fields: ['data.weak_counters[].{champion_name,win_rate,play}'],
  });
  const counters = data?.data?.weak_counters ?? data?.data?.weakCounters ?? [];
  return counters
    .map((c) => ({ name: pick(c, 'champion_name', 'name'), winRate: num(pick(c, 'win_rate', 'winRate')) }))
    .filter((c) => c.name);
}

let tagCache = null;

/** Champion classes (Assassin, Tank, ...) by champion name; empty when OP.GG does not provide them. */
async function getChampionTags() {
  if (tagCache) return tagCache;
  const data = await callTool('lol_list_champions', { desired_output_fields: ['data.champions[].{name,tags}'] }).catch(() => null);
  const map = new Map((data?.data?.champions ?? []).map((c) => [c.name, c.tags ?? []]));
  if (map.size) tagCache = map;
  return map;
}

module.exports = { REGIONS, parseRiotId, getPlayer, getCounters, getChampionTags };
