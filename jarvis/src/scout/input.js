// Reads the enemy team from the one text option of /scout. Order does not matter, so the result is sorted.

const MAX_PLAYERS = 5;

// Lines the League client writes into the lobby chat, e.g. "Name#TAG joined the lobby".
const LOBBY_TEXT = /\s+(?:joined|left) the lobby\.?/giu;
// Characters Riot IDs cannot contain, used between players.
const SEPARATORS = /[,;\n\r+|]+/u;
// One "Name#TAG"; the tag has no spaces, so the next name starts after it.
const TAGGED = /[^#]+?#\s*[^\s#]{2,5}(?=\s|$)/gu;

/** "Name #TAG" -> "Name#TAG", so the same player typed twice is found once. */
const tidy = (id) => id.replace(/\s*#\s*/u, '#').replace(/\s+/gu, ' ').trim();

/**
 * Splits pasted text into Riot IDs: separated by commas, semicolons, new lines or "+", or one after
 * another when each has a tag ("A#EUW B#EUW"). Text without separators or tags is split at spaces, so a
 * name with spaces needs its tag or a comma. Returns the unique IDs, sorted case-insensitively.
 */
function parsePlayers(text) {
  const cleaned = (text ?? '').replace(LOBBY_TEXT, '\n');
  const segments = cleaned.split(SEPARATORS).map((s) => s.trim()).filter(Boolean);
  const ids = segments.flatMap((segment) => {
    if (segment.includes('#')) {
      const tagged = segment.match(TAGGED) ?? [];
      const rest = tagged.reduce((left, id) => left.replace(id, ' '), segment).trim();
      return [...tagged, ...(rest ? [rest] : [])];
    }
    return segments.length === 1 ? segment.split(/\s+/u) : [segment];
  });

  const unique = new Map();
  for (const id of ids.map(tidy).filter(Boolean)) unique.set(id.toLowerCase(), unique.get(id.toLowerCase()) ?? id);
  return [...unique.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

module.exports = { MAX_PLAYERS, parsePlayers };
