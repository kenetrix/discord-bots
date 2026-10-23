const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const { token } = require('./config');
const { db } = require('./db');
const { startScheduler } = require('./scheduler');
const commands = require('./commands');

const client = new Client({
  // No MessageContent intent needed: cleanup only reads metadata (author, time, pin).
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    // Needed to find the voice channel of whoever runs /scout.
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const byName = new Map(commands.map((c) => [c.data.name, c]));

client.once(Events.ClientReady, (c) => {
  console.log(`Jarvis logged in as ${c.user.tag} on ${c.guilds.cache.size} server(s).`);
  startScheduler(c);
});

client.on(Events.GuildCreate, async (guild) => {
  // Servers that become available again after an outage also arrive here; only welcome fresh joins.
  if (Date.now() - guild.joinedTimestamp > 60e3) return;
  await byName.get('config').welcome(guild).catch((err) => console.warn(`Welcome message failed in ${guild.id}:`, err.message));
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
    } else if (interaction.isChannelSelectMenu()) {
      for (const command of commands) {
        if (command.handleSelect && (await command.handleSelect(interaction))) break;
      }
    }
  } catch (err) {
    console.error(`Error in ${interaction.commandName ?? interaction.customId}:`, err);
    const content = 'Something went wrong. Check my permissions and the role order.';
    const reply = interaction.deferred || interaction.replied
      ? interaction.editReply({ content })
      : interaction.reply({ content, flags: MessageFlags.Ephemeral });
    await reply.catch(() => {});
  }
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  client.destroy();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(token);
