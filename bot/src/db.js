const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { dbPath } = require('./config');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    modlog_channel_id TEXT
  );
  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings (guild_id, user_id);
  CREATE TABLE IF NOT EXISTS cleaner_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    cron TEXT NOT NULL,
    max_age_hours INTEGER NOT NULL DEFAULT 0,
    keep_pinned INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    last_run_at INTEGER
  );
`);

const stmts = {
  getSettings: db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?'),
  setModlog: db.prepare(`
    INSERT INTO guild_settings (guild_id, modlog_channel_id) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET modlog_channel_id = excluded.modlog_channel_id
  `),
  addWarning: db.prepare(
    'INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?)',
  ),
  listWarnings: db.prepare(
    'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 25',
  ),
  countWarnings: db.prepare('SELECT COUNT(*) AS n FROM warnings WHERE guild_id = ? AND user_id = ?'),
  deleteWarning: db.prepare('DELETE FROM warnings WHERE guild_id = ? AND id = ?'),
  clearWarnings: db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?'),
  addJob: db.prepare(`
    INSERT INTO cleaner_jobs (guild_id, channel_id, cron, max_age_hours, keep_pinned, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getJob: db.prepare('SELECT * FROM cleaner_jobs WHERE guild_id = ? AND id = ?'),
  listJobs: db.prepare('SELECT * FROM cleaner_jobs WHERE guild_id = ? ORDER BY id'),
  allJobs: db.prepare('SELECT * FROM cleaner_jobs'),
  deleteJob: db.prepare('DELETE FROM cleaner_jobs WHERE guild_id = ? AND id = ?'),
  touchJob: db.prepare('UPDATE cleaner_jobs SET last_run_at = ? WHERE id = ?'),
};

module.exports = { db, stmts };
