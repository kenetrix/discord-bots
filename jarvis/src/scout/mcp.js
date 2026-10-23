// Minimal client for the public OP.GG MCP server (Streamable HTTP transport, no API key).
const ENDPOINT = process.env.OPGG_MCP_URL || 'https://mcp-api.op.gg/mcp';
const PROTOCOL_VERSION = '2025-03-26';
const TIMEOUT_MS = 20e3;

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
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', ...body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404 && sessionId) {
    const err = new Error('OP.GG session expired');
    err.expired = true;
    throw err;
  }
  if (!res.ok) throw new Error(`OP.GG ${body.method}: HTTP ${res.status}`);
  sessionId = res.headers.get('mcp-session-id') ?? sessionId;
  if (body.id === undefined) return null;
  const message = await readResponse(res, body.id);
  if (!message) throw new Error(`OP.GG ${body.method}: empty response`);
  if (message.error) throw new Error(`OP.GG ${body.method}: ${message.error.message}`);
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

/** Calls an OP.GG tool and returns its result, parsed as JSON when possible. */
async function callTool(name, args, retry = true) {
  await (ready ?? connect());
  try {
    const result = await post({ id: nextId++, method: 'tools/call', params: { name, arguments: args } });
    const text = (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (result.isError) throw new Error(`OP.GG ${name}: ${text || 'tool error'}`);
    if (result.structuredContent) return result.structuredContent;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    if (!err.expired || !retry) throw err;
    ready = null;
    return callTool(name, args, false);
  }
}

module.exports = { callTool };
