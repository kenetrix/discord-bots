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

function winRate(champion) {
  return champion.games ? Math.round((champion.wins / champion.games) * 100) : 0;
}

/** Every champion of every player, scored and sorted by threat. */
function rankThreats(players) {
  const threats = [];
  for (const player of players) {
    const total = player.champions.reduce((sum, c) => sum + c.games, 0);
    for (const champion of player.champions) {
      if (!champion.games) continue;
      threats.push({ champion: champion.name, player: player.riotId, games: champion.games, winRate: winRate(champion), score: threat(champion, total) });
    }
  }
  return threats.sort((a, b) => b.score - a.score);
}

/**
 * Picks the bans: the most dangerous champions, at most MAX_BANS_PER_PLAYER aimed at one player,
 * plus the next best candidates as alternatives.
 */
function recommendBans(players, { count = 5, alternatives = 3 } = {}) {
  const picked = [];
  const perPlayer = new Map();
  const seen = new Set();
  for (const t of rankThreats(players)) {
    if (seen.has(t.champion)) continue;
    const aimed = perPlayer.get(t.player) ?? 0;
    if (picked.length < count && aimed >= MAX_BANS_PER_PLAYER) continue;
    seen.add(t.champion);
    perPlayer.set(t.player, aimed + 1);
    picked.push(t);
    if (picked.length >= count + alternatives) break;
  }
  return { bans: picked.slice(0, count), alternatives: picked.slice(count) };
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

/** The champion each enemy will most likely play once the bans are in. */
function predictPicks(players, banned) {
  return assignRoles(players).map(({ player, role }) => {
    const total = player.champions.reduce((sum, c) => sum + c.games, 0);
    const pick = player.champions
      .filter((c) => c.games && !banned.has(c.name))
      .sort((a, b) => threat(b, total) - threat(a, total))[0];
    return { player: player.riotId, role, champion: pick?.name ?? null };
  });
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
 * countersOf(champion, role) returns champions that beat it, best first.
 */
async function suggestComp(picks, banned, countersOf) {
  const counters = await Promise.all(
    picks.map(({ role, champion }) => (champion ? countersOf(champion, role).catch(() => []) : [])),
  );
  const taken = new Set(banned);
  const comp = [];
  for (const [i, { role, champion }] of picks.entries()) {
    const [pick, alt] = counters[i].filter((c) => !taken.has(c.name));
    if (pick) taken.add(pick.name);
    comp.push({ role, against: champion, pick: pick ?? null, alternative: alt ?? null });
  }
  return comp;
}

module.exports = { ROLES, smoothedWinRate, rankThreats, recommendBans, assignRoles, predictPicks, gamePlan, suggestComp };
