// Registriert die Slash-Commands bei Discord. Nach jeder Änderung an Commands einmal ausführen.
const { REST, Routes } = require('discord.js');
const { token, clientId, guildId } = require('./config');
const commands = require('./commands');

const body = commands.map((c) => c.data.toJSON());
const rest = new REST().setToken(token);

(async () => {
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  const result = await rest.put(route, { body });
  console.log(`${result.length} Slash-Command(s) ${guildId ? `auf Server ${guildId}` : 'global'} registriert.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
