const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { logger } = require('./log');

function required(name) {
  const value = process.env[name];
  if (!value) {
    logger('config').error(`Missing environment variable: ${name} (see .env.example)`);
    process.exit(1);
  }
  return value;
}

module.exports = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  // Optional: with GUILD_ID, slash commands are registered instantly, on that server only.
  guildId: process.env.GUILD_ID || null,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot.db'),
  timezone: process.env.TZ || 'Europe/Berlin',
};
