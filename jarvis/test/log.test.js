const test = require('node:test');
const assert = require('node:assert');
const { logger, who, describeError, timestamp } = require('../src/log');

function capture(t) {
  const lines = [];
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write;
    stream.write = (chunk) => lines.push(String(chunk)) && true;
    t.after(() => {
      stream.write = write;
    });
  }
  return lines;
}

test('log lines have a timestamp, the level and the scope', (t) => {
  const level = process.env.LOG_LEVEL;
  t.after(() => {
    process.env.LOG_LEVEL = level ?? '';
  });
  process.env.LOG_LEVEL = 'info';
  const lines = capture(t);
  const log = logger('test');
  log.debug('hidden');
  log.info('shown');
  log.warn('failed', new Error('Missing Access'));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d INFO {2}\[test\] shown\n$/);
  assert.match(lines[1], /WARN {2}\[test\] failed: Missing Access\n$/);

  process.env.LOG_LEVEL = 'debug';
  log.debug('now shown');
  assert.match(lines[2], /DEBUG \[test\] now shown/);
});

test('errors carry the Discord code, status and route', () => {
  const err = Object.assign(new Error('Missing Access'), { code: 50001, status: 403, method: 'get', url: 'https://discord.com/api/v10/channels/42?x=1' });
  assert.equal(describeError(err, false), 'Missing Access (code 50001, HTTP 403) [GET /api/v10/channels/42]');
  assert.match(describeError(err, true), /^Error: Missing Access \(code 50001, HTTP 403\) \[GET \/api\/v10\/channels\/42\]\n {4}at /);
  assert.equal(describeError('plain'), 'plain');
});

test('names come with their ids', () => {
  assert.equal(who({ tag: 'user', id: '1' }), 'user (1)');
  assert.equal(who({ name: 'Server', id: '2' }), 'Server (2)');
  assert.equal(who({ name: 'mod-log', id: '3', type: 0 }), '#mod-log (3)');
  assert.equal(who({ id: '4' }), '4');
  assert.equal(who(null), 'unknown');
  assert.equal(timestamp(new Date(2026, 0, 2, 3, 4, 5)), '2026-01-02 03:04:05');
});
