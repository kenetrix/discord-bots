#!/usr/bin/env node
// Web interface for botctl: manage the bots of the bot machine from a browser.
// No dependencies, only Node built-ins. Runs as root inside the container (botctl needs it),
// so it is protected by a password and meant for a trusted network only.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const PORT = Number(process.env.WEBUI_PORT) || 8080;
const HOST = process.env.WEBUI_HOST || '0.0.0.0';
const BOTCTL = process.env.BOTCTL || 'botctl';
const BOTS_DIR = process.env.BOTS_DIR || '/opt/bots';
const LOG_DIR = process.env.LOG_DIR || '/var/log/bots';
const INIT_DIR = process.env.INIT_DIR || '/etc/init.d';
const PASSWORD_FILE = process.env.WEBUI_PASSWORD_FILE || '/etc/botctl-web/password';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const PATH_RE = /^[A-Za-z0-9._/-]*$/;

const sessions = new Map(); // token -> expiry
const failures = new Map(); // ip -> { count, until }

function readPassword() {
  return fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// botctl runs one command at a time; the web interface queues requests the same way.
let queue = Promise.resolve();
function botctl(args, { input, timeout = 10 * 60 * 1000 } = {}) {
  const run = () =>
    new Promise((resolve) => {
      const child = execFile(BOTCTL, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ ok: !error, output: `${stdout}${stderr}`.trim() });
      });
      if (input !== undefined) child.stdin.end(input);
      else child.stdin.end();
    });
  const result = queue.then(run, run);
  queue = result.then(() => undefined);
  return result;
}

function listBots() {
  return botctl(['list']).then(({ ok, output }) => {
    if (!ok) return [];
    return output
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols.length >= 4)
      .map(([name, status, version, ...dir]) => ({ name, status, version, directory: dir.join(' ') }));
  });
}

function botDir(name) {
  const initFile = path.join(INIT_DIR, `bot.${name}`);
  const match = fs.readFileSync(initFile, 'utf8').match(/^directory="(.*)"$/m);
  return match ? match[1] : null;
}

function readEnvKeys(name) {
  const dir = botDir(name);
  if (!dir) return [];
  const file = path.join(dir, '.env');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map(([, key, value]) => ({ key, set: value.length > 0 }));
}

function tailLog(name, lines) {
  const file = path.join(LOG_DIR, `${name}.log`);
  if (!fs.existsSync(file)) return '';
  const size = fs.statSync(file).size;
  const length = Math.min(size, 256 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8').split('\n').slice(-lines).join('\n');
  } finally {
    fs.closeSync(fd);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string';
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair.length === 2),
  );
}

function isAuthenticated(req) {
  const token = parseCookies(req).sid;
  const expiry = token && sessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function login(req, res, body) {
  const ip = req.socket.remoteAddress || 'unknown';
  const entry = failures.get(ip);
  if (entry && entry.count >= 5 && entry.until > Date.now()) {
    return send(res, 429, { error: 'Too many failed attempts, try again in a few minutes.' });
  }
  if (typeof body.password !== 'string' || !safeEqual(body.password, readPassword())) {
    const count = entry && entry.until > Date.now() ? entry.count + 1 : 1;
    failures.set(ip, { count, until: Date.now() + 5 * 60 * 1000 });
    return send(res, 401, { error: 'Wrong password.' });
  }
  failures.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}` });
}

const result = (res, { ok, output }) => send(res, ok ? 200 : 500, { ok, output });

async function api(req, res, url) {
  const method = req.method;
  if (method !== 'GET' && req.headers['x-requested-with'] !== 'botctl-web') {
    return send(res, 403, { error: 'Forbidden' });
  }
  const body = method === 'GET' ? {} : await readBody(req);

  if (method === 'POST' && url.pathname === '/api/login') return login(req, res, body);
  if (!isAuthenticated(req)) return send(res, 401, { error: 'Not logged in.' });

  if (method === 'POST' && url.pathname === '/api/logout') {
    sessions.delete(parseCookies(req).sid);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (method === 'GET' && url.pathname === '/api/bots') return send(res, 200, await listBots());
  if (method === 'POST' && url.pathname === '/api/update-all') return result(res, await botctl(['update-all']));

  if (method === 'POST' && url.pathname === '/api/bots') {
    const { name, url: repo, path: sub = '' } = body;
    if (!NAME_RE.test(name || '')) return send(res, 400, { error: 'Invalid name (a-z, 0-9, -).' });
    if (!/^https:\/\/[^\s]+$/.test(repo || '')) return send(res, 400, { error: 'The Git URL must start with https://.' });
    if (!PATH_RE.test(sub) || sub.includes('..')) return send(res, 400, { error: 'Invalid subfolder.' });
    return result(res, await botctl(['add', name, repo, ...(sub ? ['--path', sub] : [])]));
  }

  const match = url.pathname.match(/^\/api\/bots\/([^/]+)(?:\/([a-z]+))?$/);
  if (!match || !NAME_RE.test(match[1])) return send(res, 404, { error: 'Not found' });
  const [, name, action] = match;
  if (!fs.existsSync(path.join(INIT_DIR, `bot.${name}`))) return send(res, 404, { error: `Bot ${name} does not exist.` });

  if (method === 'GET' && action === 'logs') {
    const lines = Math.min(Math.max(Number(url.searchParams.get('lines')) || 200, 10), 2000);
    return send(res, 200, { output: tailLog(name, lines) });
  }
  if (method === 'GET' && action === 'env') return send(res, 200, readEnvKeys(name));
  if (method === 'POST' && action === 'env') {
    if (!KEY_RE.test(body.key || '')) return send(res, 400, { error: 'Invalid key.' });
    if (typeof body.value !== 'string' || /[\r\n]/.test(body.value)) return send(res, 400, { error: 'Invalid value.' });
    return result(res, await botctl(['set', name, body.key], { input: `${body.value}\n` }));
  }
  if (method === 'POST' && ['start', 'stop', 'restart', 'update'].includes(action)) {
    return result(res, await botctl([action, name]));
  }
  if (method === 'DELETE' && !action) return result(res, await botctl(['remove', name], { input: `${name}\n` }));
  return send(res, 404, { error: 'Not found' });
}

const PAGE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method === 'GET' && url.pathname === '/') {
      const nonce = crypto.randomBytes(16).toString('base64');
      return send(res, 200, PAGE.replaceAll('{{NONCE}}', nonce), {
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'`,
      });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
});

server.listen(PORT, HOST, () => console.log(`botctl web interface on http://${HOST}:${PORT}`));
