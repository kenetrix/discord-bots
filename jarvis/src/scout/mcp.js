// Minimal client for the public OP.GG MCP server (Streamable HTTP transport, no API key).
const { parseNotation } = require('./notation');

const ENDPOINT = process.env.OPGG_MCP_URL || 'https://mcp-api.op.gg/mcp';
const PROTOCOL_VERSION = '2025-03-26';
const TIMEOUT_MS = 20e3;

/**
 * An OP.GG failure with a kind the command can explain to users:
 * 'not_found' (unknown player or champion), 'rate_limited', 'unavailable' (down, slow or unreachable)
 * or 'rejected' (OP.GG refused the request).
 */
class OpggError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** Sorts a JSON-RPC error message from OP.GG into one of the OpggError kinds. */
function kindOf(message) {
  if (/not found|unknown champion|invalid champion/i.test(message)) return 'not_found';
  if (/rate limit|too many/i.test(message)) return 'rate_limited';
  return 'rejected';
}

let sessionId = null;
let ready = null;
let nextId = 1;

/** Reads one JSON-RPC response, either plain JSON or a server-sent event stream. */
async function readResponse(res, id) {
  const text = await res.text();
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) return text ? JSON.parse(text) : null;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const message = JSON.parse(line.slice(5));
    if (message.id === id) return message;
  }
  return null;
}

async function post(body) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new OpggError('unavailable', `OP.GG ${body.method}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  }
  if (res.status === 404 && sessionId) {
    const err = new OpggError('unavailable', 'OP.GG session expired');
    err.expired = true;
    throw err;
  }
  if (res.status === 429) throw new OpggError('rate_limited', `OP.GG ${body.method}: HTTP 429`);
  if (!res.ok) throw new OpggError('unavailable', `OP.GG ${body.method}: HTTP ${res.status}`);
  sessionId = res.headers.get('mcp-session-id') ?? sessionId;
  if (body.id === undefined) return null;
  let message;
  try {
    message = await readResponse(res, body.id);
  } catch (err) {
    throw new OpggError('unavailable', `OP.GG ${body.method}: unreadable response (${err.message})`);
  }
  if (!message) throw new OpggError('unavailable', `OP.GG ${body.method}: empty response`);
  if (message.error) throw new OpggError(kindOf(message.error.message ?? ''), message.error.message ?? 'unknown error');
  return message.result;
}

function connect() {
  sessionId = null;
  ready = (async () => {
    await post({
      id: nextId++,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'jarvis', version: '1.0' } },
    });
    await post({ method: 'notifications/initialized' });
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

/** Parses a tool's text output: JSON for some tools, OP.GG's class notation for most. */
function parseText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return parseNotation(text);
  }
}

/** Calls an OP.GG tool and returns its result as plain objects. */
async function callTool(name, args, retry = true) {
  await (ready ?? connect());
  try {
    const result = await post({ id: nextId++, method: 'tools/call', params: { name, arguments: args } });
    const text = (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (result.isError) throw new OpggError(kindOf(text), text || `OP.GG ${name}: tool error`);
    if (result.structuredContent) return result.structuredContent;
    try {
      return parseText(text);
    } catch (err) {
      throw new OpggError('unavailable', `OP.GG ${name}: unexpected answer (${err.message})`);
    }
  } catch (err) {
    if (!err.expired || !retry) throw err;
    ready = null;
    return callTool(name, args, false);
  }
}

module.exports = { OpggError, callTool, parseText };
