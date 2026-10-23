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

// Databases created before keep_latest existed get the column added.
if (!db.prepare('PRAGMA table_info(cleaner_jobs)').all().some((c) => c.name === 'keep_latest')) {
  db.exec('ALTER TABLE cleaner_jobs ADD COLUMN keep_latest INTEGER NOT NULL DEFAULT 0');
}

const stmts = {
  getSettings: db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?'),
  setModlog: db.prepare(`
    INSERT INTO guild_settings (guild_id, modlog_channel_id) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET modlog_channel_id = excluded.modlog_channel_id
  `),
  addJob: db.prepare(`
    INSERT INTO cleaner_jobs (guild_id, channel_id, cron, max_age_hours, keep_pinned, keep_latest, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getJob: db.prepare('SELECT * FROM cleaner_jobs WHERE guild_id = ? AND id = ?'),
  listJobs: db.prepare('SELECT * FROM cleaner_jobs WHERE guild_id = ? ORDER BY id'),
  allJobs: db.prepare('SELECT * FROM cleaner_jobs'),
  deleteJob: db.prepare('DELETE FROM cleaner_jobs WHERE guild_id = ? AND id = ?'),
  touchJob: db.prepare('UPDATE cleaner_jobs SET last_run_at = ? WHERE id = ?'),
};

module.exports = { db, stmts };
