// Turns scouted enemy players into ban and team composition advice. Pure functions, no I/O.
//
// A player looks like:
//   { riotId: 'Name#TAG', rank: 'GOLD II' | null,
//     roles: [{ role: 'TOP', games: 30 }, ...],
//     champions: [{ name: 'Ahri', games: 25, wins: 15 }, ...] }

const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
const PRIOR_GAMES = 10; // pulls small samples towards a 50 % win rate
const MAX_BANS_PER_PLAYER = 3;

/** Win rate with a 50 % prior, so 3 wins in 3 games does not count as 100 %. */
function smoothedWinRate(wins, games) {
  return (wins + PRIOR_GAMES / 2) / (games + PRIOR_GAMES);
}

/** How dangerous a champion is in a player's hands: comfort (games, share of the pool) times performance. */
function threat(champion, totalGames) {
  const share = totalGames ? champion.games / totalGames : 0;
  return Math.sqrt(champion.games) * (1 + share) * (smoothedWinRate(champion.wins, champion.games) / 0.5);
}

const MIN_RECENT_WEIGHT = 0.25; // a season champion that was not played lately still counts a quarter
const FULL_RECENT_GAMES = 3; // recent games of a champion that make it fully current

/**
 * 0.25 to 1: how current a champion is, from its games among the player's recent matches.
 * 1 when the recent history is unknown, so players without it are not penalised.
 */
function recency(player, name) {
  if (!player.recent) return 1;
  const games = player.recent.find((c) => c.name === name)?.games ?? 0;
  return MIN_RECENT_WEIGHT + (1 - MIN_RECENT_WEIGHT) * Math.min(games / FULL_RECENT_GAMES, 1);
}

/** Season champions plus champions that only show up in the recent games (with their recent record). */
function poolOf(player) {
  const known = new Set(player.champions.map((c) => c.name));
  const fresh = (player.recent ?? []).filter((c) => c.games >= 2 && !known.has(c.name));
  return [...player.champions, ...fresh];
}

function winRate(champion) {
  return champion.games ? Math.round((champion.wins / champion.games) * 100) : 0;
}

/** Every champion of every player, scored (season comfort times how recently it was played) and sorted by threat. */
function rankThreats(players) {
  const threats = [];
  for (const player of players) {
    const total = player.champions.reduce((sum, c) => sum + c.games, 0);
    for (const champion of poolOf(player)) {
      if (!champion.games) continue;
      const score = threat(champion, total) * recency(player, champion.name);
      threats.push({ champion: champion.name, player: player.riotId, games: champion.games, winRate: winRate(champion), score });
    }
  }
  return threats.sort((a, b) => b.score - a.score || a.champion.localeCompare(b.champion));
}

/**
 * Picks the bans: first each player's most dangerous champion, so every lane gets at least one ban
 * (while there are bans left), then the most dangerous of the rest with at most MAX_BANS_PER_PLAYER
 * aimed at one player, plus the next best candidates as alternatives. Bans are sorted by threat.
 */
function recommendBans(players, { count = 5, alternatives = 3 } = {}) {
  const threats = rankThreats(players);
  const picked = [];
  const perPlayer = new Map();
  const seen = new Set();
  const take = (t) => {
    seen.add(t.champion);
    perPlayer.set(t.player, (perPlayer.get(t.player) ?? 0) + 1);
    picked.push(t);
  };
  // Most dangerous players first, in case there are more players than bans.
  for (const t of threats) {
    if (picked.length >= count) break;
    if (!perPlayer.has(t.player) && !seen.has(t.champion)) take(t);
  }
  for (const t of threats) {
    if (picked.length >= count + alternatives) break;
    if (seen.has(t.champion)) continue;
    if (picked.length < count && (perPlayer.get(t.player) ?? 0) >= MAX_BANS_PER_PLAYER) continue;
    take(t);
  }
  const bans = picked.slice(0, count).sort((x, y) => y.score - x.score);
  return { bans, alternatives: picked.slice(count) };
}

const RANK_WEIGHT = 2; // threat factor per tier: a Gold player's champion counts twice a Silver player's

/** Multiplies a champion's threat by the player's strength; Gold IV (3.25) is neutral. */
function playerWeight(player) {
  return RANK_WEIGHT ** ((rankValue(player.rank) ?? UNRANKED_VALUE) - 3.25);
}

const MIN_PRIORITY_WIN_RATE = 0.52; // smoothed win rate a champion needs to be a game-deciding ban
const MIN_PRIORITY_GAMES = 8; // season games needed, so a short lucky streak is not a win rate

/**
 * The game-deciding bans across all enemies, strongest first, with no limit per player, so they may all
 * belong to one player. A champion only qualifies with a smoothed win rate of 52 % or more, so a champion
 * that is merely played a lot never makes it. Ranked by that win rate, lowered when the player has not
 * played it lately and multiplied by the player's strength (rank), since the same champion is more
 * dangerous in the hands of a higher ranked player. May return fewer than `count` bans. Ties are broken by name.
 */
function priorityBans(players, count = 5) {
  const candidates = [];
  for (const player of players) {
    const weight = playerWeight(player);
    for (const champion of player.champions) {
      if (champion.games < MIN_PRIORITY_GAMES) continue;
      const rate = smoothedWinRate(champion.wins, champion.games);
      if (rate < MIN_PRIORITY_WIN_RATE) continue;
      const score = rate * 100 * recency(player, champion.name) * weight;
      candidates.push({ champion: champion.name, player: player.riotId, games: champion.games, winRate: winRate(champion), score });
    }
  }
  const seen = new Set();
  const ranked = [];
  for (const t of candidates.sort((x, y) => y.score - x.score || x.champion.localeCompare(y.champion))) {
    if (seen.has(t.champion)) continue;
    seen.add(t.champion);
    ranked.push(t);
    if (ranked.length >= count) break;
  }
  return ranked;
}

/** Assigns each player the role they play most, so that every role is taken at most once. */
function assignRoles(players) {
  const gamesIn = (player, role) => player.roles.find((r) => r.role === role)?.games ?? 0;
  let best = { score: -1, roles: [] };
  const permute = (index, used, roles, score) => {
    if (index === players.length) {
      if (score > best.score) best = { score, roles: [...roles] };
      return;
    }
    for (const role of ROLES) {
      if (used.has(role)) continue;
      used.add(role);
      roles.push(role);
      permute(index + 1, used, roles, score + gamesIn(players[index], role));
      roles.pop();
      used.delete(role);
    }
  };
  permute(0, new Set(), [], 0);
  return players.map((player, i) => ({ player, role: best.roles[i] }));
}

/**
 * The champion a player will most likely pick in `role`: their most dangerous season champion that is
 * played in that role (rolePools: Map of role -> Set of champion names, optional), else what they played
 * there recently, else their most dangerous champion at all.
 */
function likelyPick(player, role, banned, rolePools = null) {
  const total = player.champions.reduce((sum, c) => sum + c.games, 0);
  const available = player.champions.filter((c) => c.games && !banned.has(c.name));
  const pool = rolePools?.get(role);
  const inRole = pool ? available.filter((c) => pool.has(c.name)) : [];
  if (inRole.length) return inRole.sort((a, b) => threat(b, total) - threat(a, total))[0].name;
  const recent = player.roles.find((r) => r.role === role)?.champions?.find((c) => !banned.has(c.name));
  if (recent) return recent.name;
  return available.sort((a, b) => threat(b, total) - threat(a, total))[0]?.name ?? null;
}

const MIN_SECOND_ROLE_SHARE = 0.15;

/** The role a player plays most after `mainRole`, if it is more than a rare fill (2+ games, 15 %+ of games). */
function secondRole(player, mainRole) {
  const total = player.roles.reduce((sum, r) => sum + r.games, 0);
  const other = player.roles.filter((r) => r.role !== mainRole).sort((a, b) => b.games - a.games)[0];
  return other && other.games >= 2 && other.games >= total * MIN_SECOND_ROLE_SHARE ? other.role : null;
}

/**
 * The champion each enemy will most likely play once the bans are in, in their assigned role,
 * plus their second role and the pick there (second: null when they have none).
 */
function predictPicks(players, banned, rolePools = null) {
  return assignRoles(players).map(({ player, role }) => {
    const other = secondRole(player, role);
    return {
      player: player.riotId,
      role,
      champion: likelyPick(player, role, banned, rolePools),
      second: other ? { role: other, champion: likelyPick(player, other, banned, rolePools) } : null,
    };
  });
}

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVISION_STEP = { IV: 1, III: 2, II: 3, I: 4 };
const UNRANKED_VALUE = 2.5; // between Silver and Gold: no rank says little about skill

/** Rank as a number: the tier index plus a quarter per division, e.g. Silver IV = 2.25, Platinum IV = 4.25. */
function rankValue(rank) {
  const [tier, division] = (rank ?? '').split(/[ ,]/);
  const index = TIERS.indexOf(tier);
  if (index === -1) return null;
  return index + (DIVISION_STEP[division] ?? 4) / 4;
}

/** 0 to 1.5 on top of the rank for a main champion with many games and a good win rate. */
function comfort(champion) {
  if (!champion?.games) return 0;
  const volume = Math.min(champion.games / 100, 1);
  const performance = Math.min(Math.max((smoothedWinRate(champion.wins, champion.games) - 0.45) / 0.1, 0), 1);
  return 1.5 * volume * performance;
}

const THREAT_LEVELS = [
  { min: 6, level: 'high' }, // Diamond and up, or Emerald with a strong main
  { min: 3.5, level: 'medium' }, // Platinum, or Gold with a strong main
  { min: -Infinity, level: 'low' },
];

/**
 * How dangerous each player is on an absolute scale, by Riot ID: their rank first, then games and
 * win rate on their most dangerous champion. Also returns that champion and the parts of the score.
 */
function playerThreats(players) {
  const best = new Map();
  for (const t of rankThreats(players)) if (!best.has(t.player)) best.set(t.player, t);
  return new Map(
    players.map((player) => {
      const top = best.get(player.riotId) ?? null;
      const rank = rankValue(player.rank);
      const main = top && player.champions.find((c) => c.name === top.champion);
      const score = (rank ?? UNRANKED_VALUE) + comfort(main);
      const { level } = THREAT_LEVELS.find((l) => score >= l.min);
      return [player.riotId, { ...top, player: player.riotId, ranked: rank !== null, score, level }];
    }),
  );
}

const PLAN_RULES = [
  { tag: 'Assassin', min: 2, advice: 'Two or more assassins: pick tanky frontline or peel supports and buy defensive items early.' },
  { tag: 'Tank', min: 2, advice: 'Tank-heavy: bring percent-health or true damage and avoid short burst fights.' },
  { tag: 'Mage', min: 3, advice: 'Mostly magic damage: stack magic resist and favour hard engage over long poke battles.' },
  { tag: 'Marksman', min: 2, advice: 'Two marksmen: dive the backline and pick champions that punish low mobility.' },
  { tag: 'Fighter', min: 3, advice: 'Fighter-heavy: kite them with range and slows instead of trading in melee.' },
];

/** Short game plan from the champion classes of the predicted enemy picks. */
function gamePlan(picks, tagsOf) {
  const counts = new Map();
  for (const { champion } of picks) {
    for (const tag of (champion && tagsOf(champion)) ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return PLAN_RULES.filter((rule) => (counts.get(rule.tag) ?? 0) >= rule.min).map((rule) => rule.advice);
}

/**
 * Suggests one pick (and one alternative) per role against the predicted enemy picks.
 * countersOf(champion, role) returns champions that beat it, best first; rolePools as in predictPicks
 * moves counters that are played in that role to the front.
 */
async function suggestComp(picks, banned, countersOf, rolePools = null) {
  const counters = await Promise.all(
    picks.map(({ role, champion }) => (champion ? countersOf(champion, role).catch(() => []) : [])),
  );
  const taken = new Set(banned);
  const comp = [];
  for (const [i, { role, champion }] of picks.entries()) {
    const pool = rolePools?.get(role);
    const free = counters[i].filter((c) => !taken.has(c.name));
    const [pick, alt] = pool ? [...free.filter((c) => pool.has(c.name)), ...free.filter((c) => !pool.has(c.name))] : free;
    if (pick) taken.add(pick.name);
    comp.push({ role, against: champion, pick: pick ?? null, alternative: alt ?? null });
  }
  return comp;
}

/**
 * Counter picks in case an enemy swaps to their second role: one per player that has one,
 * avoiding bans and the picks already in `comp`.
 */
async function suggestFlexCounters(picks, banned, comp, countersOf, rolePools = null) {
  const taken = new Set([...banned, ...comp.flatMap((c) => (c.pick ? [c.pick.name] : []))]);
  const flex = picks.filter((p) => p.second?.champion);
  const counters = await Promise.all(flex.map((p) => countersOf(p.second.champion, p.second.role).catch(() => [])));
  return flex.map((p, i) => {
    const pool = rolePools?.get(p.second.role);
    const free = counters[i].filter((c) => !taken.has(c.name));
    const pick = (pool && free.find((c) => pool.has(c.name))) ?? free[0] ?? null;
    return { player: p.player, role: p.second.role, against: p.second.champion, pick };
  });
}

module.exports = {
  ROLES,
  smoothedWinRate,
  rankThreats,
  recommendBans,
  priorityBans,
  assignRoles,
  secondRole,
  predictPicks,
  rankValue,
  playerThreats,
  gamePlan,
  suggestComp,
  suggestFlexCounters,
};
