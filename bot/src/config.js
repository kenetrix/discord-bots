const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Fehlende Umgebungsvariable: ${name} (siehe .env.example)`);
    process.exit(1);
  }
  return value;
}

module.exports = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  // Optional: mit GUILD_ID werden Slash-Commands sofort nur auf diesem Server registriert.
  guildId: process.env.GUILD_ID || null,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot.db'),
  timezone: process.env.TZ || 'Europe/Berlin',
};
