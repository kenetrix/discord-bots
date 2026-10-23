// Schnelltest ohne Discord-Verbindung: lädt alle Commands und validiert ihre Definitionen.
process.env.DISCORD_TOKEN ||= 'test';
process.env.CLIENT_ID ||= '1';
process.env.DB_PATH ||= ':memory:';
const commands = require('../src/commands');
const names = commands.map((c) => c.data.toJSON().name);
console.log(`OK: ${names.length} Commands (${names.join(', ')})`);
