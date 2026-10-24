// Line-based logger: "2026-10-24 09:35:12 INFO  [scope] message".
// botctl writes stdout and stderr to /var/log/bots/<name>.log, which has no timestamps of its own.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
// Read on each line, so LOG_LEVEL from .env counts even if this module loads before dotenv.
const threshold = () => LEVELS[String(process.env.LOG_LEVEL).toLowerCase()] ?? LEVELS.info;

const pad = (n) => String(n).padStart(2, '0');

/** Local time (TZ from .env), as in the cleaner schedules. */
function timestamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** An error in one line: Discord's error code and HTTP status help most; the stack only at error level. */
function describeError(err, withStack) {
  if (!(err instanceof Error)) return String(err);
  const code = err.code !== undefined ? ` (code ${err.code}${err.status ? `, HTTP ${err.status}` : ''})` : '';
  const where = err.method && err.url ? ` [${err.method.toUpperCase()} ${String(err.url).replace(/^\w+:\/\/[^/]+|\?.*$/g, '')}]` : '';
  if (withStack && err.stack) return `${err.stack.replace(/^[^\n]*/, `${err.name}: ${err.message}${code}${where}`)}`;
  return `${err.message}${code}${where}`;
}

function write(level, scope, message, err) {
  if (LEVELS[level] < threshold()) return;
  const suffix = err === undefined ? '' : `: ${describeError(err, level === 'error')}`;
  const line = `${timestamp()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${suffix}\n`;
  (LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout).write(line);
}

/** A logger for one part of the bot; every method takes a message and an optional error. */
function logger(scope) {
  return Object.fromEntries(Object.keys(LEVELS).map((level) => [level, (message, err) => write(level, scope, message, err)]));
}

/** "Name (id)" for users, guilds and channels, so a log line can be read without looking ids up. */
function who(thing) {
  if (!thing) return 'unknown';
  if (thing.tag !== undefined) return `${thing.tag} (${thing.id})`;
  if (thing.name !== undefined) return `${thing.isTextBased?.() || thing.type !== undefined ? '#' : ''}${thing.name} (${thing.id})`;
  return String(thing.id ?? thing);
}

module.exports = { logger, who, describeError, timestamp };
