// Registers the slash commands with Discord. Run once after every change to a command.
const { REST, Routes } = require('discord.js');
const { token, clientId, guildId } = require('./config');
const commands = require('./commands');

const body = commands.map((c) => c.data.toJSON());
const rest = new REST().setToken(token);

(async () => {
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  const result = await rest.put(route, { body });
  console.log(`Registered ${result.length} slash command(s) ${guildId ? `on server ${guildId}` : 'globally'}.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
