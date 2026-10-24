// Name search on the OP.GG website: finds the tags of the accounts with a given game name in a region.
// The OP.GG MCP server has no name search, so this reads the search page op.gg serves its own site, asked for
// as a React Server Components payload. That page is unofficial and undocumented: any failure or change in its
// shape only means "no suggestions", and the caller falls back to guessing the tag.
const { TtlCache } = require('./cache');

const SEARCH_URL = process.env.OPGG_SEARCH_URL || 'https://op.gg/lol/summoners/search';
const TIMEOUT_MS = 8e3;
const MAX_LENGTH = 5e6; // characters; a normal answer is about 300 000
const ACTIVE_MS = 30 * 24 * 60 * 60e3; // accounts that played in the last 30 days come first
const searchCache = new TtlCache(30 * 60e3);

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

/** Riot compares names without case and spaces: "Hide on bush" and "hideonbush" are the same name. */
const sameName = (a, b) => normalize(a) === normalize(b);
const normalize = (name) => name.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** Solo queue rank as one number for sorting; unranked is -1. */
function rankKey(account) {
  const index = TIERS.indexOf(account.tier);
  if (index === -1) return -1;
  return index * 1e5 + (5 - (account.division ?? 1)) * 1e4 + account.lp;
}

/**
 * Every account object (anything with game_name and tagline) in a React Server Components payload,
 * one per Riot ID. The payload has one "id:json" row per line; rows that are not JSON are skipped.
 */
function parseSearch(text) {
  const accounts = new Map();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (typeof value.game_name === 'string' && typeof value.tagline === 'string' && value.game_name && value.tagline) {
      const tier = value.solo_tier_info?.tier ?? null;
      const account = {
        gameName: value.game_name,
        tagLine: value.tagline,
        tier: TIERS.includes(tier) ? tier : null,
        division: Number(value.solo_tier_info?.division) || null,
        lp: Number(value.solo_tier_info?.lp) || 0,
        activeAt: Date.parse(value.revision_at) || null,
      };
      const key = `${account.gameName}#${account.tagLine}`.toLowerCase();
      if (!accounts.has(key)) accounts.set(key, account);
    }
    Object.values(value).forEach(walk);
  };
  for (const line of text.split('\n')) {
    const split = line.indexOf(':');
    if (split === -1) continue;
    try {
      walk(JSON.parse(line.slice(split + 1)));
    } catch {
      // Text rows, module rows and anything else that is not JSON.
    }
  }
  return [...accounts.values()];
}

/**
 * Accounts with exactly this name (or, if none, whatever OP.GG matched), best first: accounts active in the last
 * 30 days, then by solo queue rank, then the most recently active. A Clash player plays now, and a smurf with
 * the same name is usually lower ranked than the main account.
 */
function rankAccounts(accounts, gameName, now = Date.now()) {
  const exact = accounts.filter((a) => sameName(a.gameName, gameName));
  const active = (a) => (a.activeAt && now - a.activeAt < ACTIVE_MS ? 1 : 0);
  return [...(exact.length ? exact : accounts)].sort(
    (a, b) => active(b) - active(a) || rankKey(b) - rankKey(a) || (b.activeAt ?? 0) - (a.activeAt ?? 0),
  );
}

async function fetchSearch(gameName, region) {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(gameName)}&region=${region.toLowerCase()}`;
  // RSC: 1 asks the Next.js site for its data payload instead of the HTML page.
  const res = await fetch(url, { headers: { RSC: '1', accept: 'text/x-component' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OP.GG search: HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_LENGTH) throw new Error('OP.GG search: answer too large');
  return rankAccounts(parseSearch(text), gameName);
}

/** Accounts named `gameName` in `region`, best guess first, cached for 30 minutes. Throws when the search fails. */
function searchPlayers(gameName, region) {
  return searchCache.get(`${region}:${normalize(gameName)}`, () => fetchSearch(gameName, region));
}

module.exports = { parseSearch, rankAccounts, searchPlayers };
