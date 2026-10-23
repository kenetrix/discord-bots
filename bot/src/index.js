const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const { token } = require('./config');
const { db } = require('./db');
const { startScheduler } = require('./scheduler');
const commands = require('./commands');

const client = new Client({
  // No MessageContent intent needed: cleanup only reads metadata (author, time, pin).
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
});

const byName = new Map(commands.map((c) => [c.data.name, c]));

client.once(Events.ClientReady, (c) => {
  console.log(`Eingeloggt als ${c.user.tag} auf ${c.guilds.cache.size} Server(n).`);
  startScheduler(c);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = byName.get(interaction.commandName);
      if (command) await command.execute(interaction);
    } else if (interaction.isButton()) {
      for (const command of commands) {
        if (command.handleButton && (await command.handleButton(interaction))) break;
      }
    }
  } catch (err) {
    console.error(`Fehler bei ${interaction.commandName ?? interaction.customId}:`, err);
    const content = 'Da ist etwas schiefgelaufen. Prüfe meine Rechte und die Rollen-Reihenfolge.';
    const reply = interaction.deferred || interaction.replied
      ? interaction.editReply({ content })
      : interaction.reply({ content, flags: MessageFlags.Ephemeral });
    await reply.catch(() => {});
  }
});

function shutdown(signal) {
  console.log(`${signal} empfangen, fahre herunter.`);
  client.destroy();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(token);
