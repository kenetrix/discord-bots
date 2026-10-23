// Fetches scouting data from OP.GG and maps it to the shapes used in analysis.js.
const { OpggError, callTool } = require('./mcp');
const { TtlCache } = require('./cache');

// A player's data hardly changes during one Clash day; matchup stats change with the patch.
const playerCache = new TtlCache(30 * 60e3);
const counterCache = new TtlCache(6 * 60 * 60e3);

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
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

/** OP.GG's champion id: "Miss Fortune" -> MISS_FORTUNE, "Kai'Sa" -> KAISA, "Nunu & Willump" -> NUNU_WILLUMP. */
function championKey(name) {
  return name
    .toUpperCase()
    .replace(/['.]/g, '')
    .replace(/[^A-Z]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** "MASTER 333 LP, 49 % WR" or "GOLD II 40 LP, 52 % WR" from the solo queue entry, else the first ranked one. */
function normalizeRank(leagueStats) {
  const ranked = (leagueStats ?? []).filter((s) => s?.tier_info?.tier);
  const solo = ranked.find((s) => s.game_type === 'SOLORANKED') ?? ranked[0];
  if (!solo) return null;
  const { tier, division, lp } = solo.tier_info;
  const queue = solo.game_type === 'SOLORANKED' ? '' : ` (${solo.game_type === 'FLEXRANKED' ? 'Flex' : solo.game_type})`;
  const roman = APEX_TIERS.has(tier) ? '' : ` ${ROMAN[division] ?? division ?? ''}`.trimEnd();
  const wins = num(solo.win);
  const games = wins + num(solo.lose);
  const record = games ? `, ${Math.round((wins / games) * 100)} % WR` : '';
  return `${tier}${roman}${lp !== null && lp !== undefined ? ` ${lp} LP` : ''}${record}${queue}`;
}

function normalizeChampions(list) {
  return (list ?? [])
    .map((c) => ({ name: c?.champion_name, games: num(c?.play), wins: num(c?.win) }))
    .filter((c) => c.name && c.games);
}

/** Games per role in the player's recent matches (OP.GG lists only the requested player in each match). */
function normalizeRoles(games) {
  const counts = new Map();
  for (const game of games ?? []) {
    const role = POSITION_ALIASES[String(game?.participants?.[0]?.position ?? '').toUpperCase()];
    if (role) counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return [...counts].map(([role, count]) => ({ role, games: count }));
}

/** Rank, role stats and champion pool of one player, cached for 30 minutes. Throws an OpggError when OP.GG does not know them. */
async function getPlayer(riotId, region) {
  const id = parseRiotId(riotId);
  if (!id) throw new Error(`"${riotId}" is not a Riot ID like Name#TAG.`);
  return playerCache.get(`${region}:${id.gameName}#${id.tagLine}`.toLowerCase(), () => fetchPlayer(id, region));
}

async function fetchPlayer(id, region) {
  const account = { game_name: id.gameName, tag_line: id.tagLine, region };
  const [profile, matches] = await Promise.all([
    callTool('lol_get_summoner_profile', {
      ...account,
      desired_output_fields: [
        'data.summoner.{game_name,tagline}',
        'data.summoner.league_stats[].{game_type,win,lose}',
        'data.summoner.league_stats[].tier_info.{tier,division,lp}',
        'data.summoner.most_champions.champion_stats[].{champion_name,play,win,lose}',
      ],
    }),
    // Roles are not part of the profile; recent games tell them. Missing history only costs the role.
    callTool('lol_list_summoner_matches', {
      ...account,
      limit: 20,
      desired_output_fields: ['data.game_history[].participants[].{champion_name,position}'],
    }).catch((err) => {
      if (err.kind === 'not_found') return null;
      throw err;
    }),
  ]);
  const summoner = profile?.data?.summoner;
  if (!summoner) throw new OpggError('not_found', 'Summoner not found');
  return {
    riotId: `${summoner.game_name ?? id.gameName}#${summoner.tagline ?? id.tagLine}`,
    rank: normalizeRank(summoner.league_stats),
    roles: normalizeRoles(matches?.data?.game_history),
    champions: normalizeChampions(summoner.most_champions?.champion_stats),
  };
}

const ROLE_TO_POSITION = { TOP: 'top', JUNGLE: 'jungle', MID: 'mid', ADC: 'adc', SUPPORT: 'support' };

/** Champions that beat `champion` in `role`, best first, cached for 6 hours. Empty when OP.GG has too few games for the matchup. */
function getCounters(champion, role) {
  return counterCache.get(`${championKey(champion)}:${role}`, () => fetchCounters(champion, role));
}

async function fetchCounters(champion, role) {
  const data = await callTool('lol_get_champion_analysis', {
    champion: championKey(champion),
    position: ROLE_TO_POSITION[role],
    game_mode: 'ranked',
    desired_output_fields: ['data.weak_counters[].{champion_name,win_rate,play}'],
  });
  return (data?.data?.weak_counters ?? [])
    .map((c) => ({ name: c?.champion_name, winRate: num(c?.win_rate), games: num(c?.play) }))
    .filter((c) => c.name)
    .sort((a, b) => b.winRate - a.winRate);
}

const POOL_TTL_MS = 6 * 60 * 60e3;
const MIN_ROLE_RATE = 0.1; // share of a champion's games in that role
let poolCache = null;

/** Champions OP.GG sees in each role (Map of role -> Set of names); null when OP.GG does not answer. */
async function getRolePools() {
  if (poolCache && Date.now() - poolCache.at < POOL_TTL_MS) return poolCache.pools;
  const positions = Object.values(ROLE_TO_POSITION);
  const data = await callTool('lol_list_lane_meta_champions', {
    position: 'all',
    desired_output_fields: positions.map((p) => `data.positions.${p}[].{champion,role_rate}`),
  }).catch(() => null);
  const byPosition = data?.data?.positions;
  if (!byPosition) return poolCache?.pools ?? null;
  const pools = new Map(
    Object.entries(ROLE_TO_POSITION).map(([role, position]) => [
      role,
      new Set((byPosition[position] ?? []).filter((c) => num(c?.role_rate) >= MIN_ROLE_RATE).map((c) => c.champion)),
    ]),
  );
  poolCache = { at: Date.now(), pools };
  return pools;
}

const tagCache = new Map();

/** Champion classes (Assassin, Tank, ...) by champion name; champions OP.GG does not know are left out. */
async function getChampionTags(names) {
  const missing = [...new Set(names)].filter((name) => !tagCache.has(name));
  // One call takes up to ten champions, and one unknown name fails the whole call, so ask one by one.
  await Promise.all(
    missing.map((name) =>
      callTool('lol_list_champion_details', { champions: [championKey(name)], desired_output_fields: ['data.champions[].{name,tags[]}'] })
        .then((data) => tagCache.set(name, data?.data?.champions?.[0]?.tags ?? []))
        .catch(() => {}),
    ),
  );
  return new Map(names.filter((name) => tagCache.has(name)).map((name) => [name, tagCache.get(name)]));
}

module.exports = { REGIONS, parseRiotId, championKey, normalizeRank, normalizeRoles, normalizeChampions, getPlayer, getCounters, getRolePools, getChampionTags };
