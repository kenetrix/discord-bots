// Parser for the compact text format the OP.GG MCP tools answer with instead of JSON:
//
//   class Summoner: game_name,tagline,league_stats
//   class LeagueStat: game_type,win
//
//   Summoner("Name","EUW",[LeagueStat("SOLORANKED",12)])
//
// Each "class" line names the fields of a constructor in order; the last block is one value
// built from constructors, arrays, JSON strings, numbers, true, false and null.

const TOKEN = /\s*(?:("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([[\](),]))/y;

/** Turns the text into plain objects and arrays. Throws on anything it does not understand. */
function parseNotation(text) {
  const split = text.indexOf('\n\n');
  if (!text.startsWith('class ') || split === -1) throw new Error('Not in OP.GG class notation');

  const classes = new Map();
  for (const line of text.slice(0, split).split('\n')) {
    const match = /^class (\w+):\s*(.*)$/.exec(line.trim());
    if (!match) throw new Error(`Bad class line: ${line}`);
    classes.set(match[1], match[2] ? match[2].split(',').map((f) => f.trim()) : []);
  }

  const body = text.slice(split + 2);
  let pos = 0;
  let peeked = null;
  const next = () => {
    if (peeked) {
      const token = peeked;
      peeked = null;
      return token;
    }
    TOKEN.lastIndex = pos;
    const match = TOKEN.exec(body);
    if (!match) throw new Error(`Unexpected input at ${pos}: ${body.slice(pos, pos + 20)}`);
    pos = TOKEN.lastIndex;
    const [, string, number, word, punct] = match;
    if (string) return { type: 'value', value: JSON.parse(string) };
    if (number) return { type: 'value', value: Number(number) };
    if (word) return { type: 'word', value: word };
    return { type: 'punct', value: punct };
  };
  const peek = () => (peeked ??= next());
  const expect = (punct) => {
    const token = next();
    if (token.type !== 'punct' || token.value !== punct) throw new Error(`Expected "${punct}" at ${pos}`);
  };

  const list = (close) => {
    const items = [];
    if (peek().value === close) {
      next();
      return items;
    }
    for (;;) {
      items.push(value());
      const token = next();
      if (token.value === close) return items;
      if (token.value !== ',') throw new Error(`Expected "," or "${close}" at ${pos}`);
    }
  };

  function value() {
    const token = next();
    if (token.type === 'value') return token.value;
    if (token.value === '[') return list(']');
    if (token.type === 'word') {
      if (token.value === 'null') return null;
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      const fields = classes.get(token.value);
      if (!fields) throw new Error(`Unknown class ${token.value}`);
      expect('(');
      const args = list(')');
      return Object.fromEntries(fields.map((field, i) => [field, args[i] ?? null]));
    }
    throw new Error(`Unexpected "${token.value}" at ${pos}`);
  }

  const result = value();
  if (body.slice(pos).trim()) throw new Error(`Trailing input at ${pos}`);
  return result;
}

module.exports = { parseNotation };
