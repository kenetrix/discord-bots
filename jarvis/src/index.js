const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const { token } = require('./config');
const { db } = require('./db');
const { startScheduler } = require('./scheduler');
const commands = require('./commands');
const { logger, who } = require('./log');

const log = logger('bot');

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
  log.info(`Jarvis logged in as ${c.user.tag} on ${c.guilds.cache.size} server(s): ${c.guilds.cache.map(who).join(', ')}`);
  startScheduler(c);
});

client.on(Events.GuildCreate, async (guild) => {
  // Servers that become available again after an outage also arrive here; only welcome fresh joins.
  if (Date.now() - guild.joinedTimestamp > 60e3) return;
  log.info(`Joined server ${who(guild)} with ${guild.memberCount} member(s).`);
  await byName.get('config').welcome(guild).catch((err) => log.warn(`Welcome message failed in ${who(guild)}`, err));
});

client.on(Events.GuildDelete, (guild) => {
  if (guild.available) log.info(`Removed from server ${who(guild)}.`);
});

client.on(Events.Error, (err) => log.error('Discord client error', err));
client.on(Events.Warn, (message) => log.warn(message));
client.on(Events.ShardDisconnect, (event) => log.warn(`Disconnected from Discord (close code ${event.code}).`));
client.on(Events.ShardReconnecting, () => log.info('Reconnecting to Discord.'));
client.on(Events.ShardResume, (_id, replayed) => log.info(`Connection to Discord resumed (${replayed} event(s) replayed).`));

/** "/cleaner add" with the option names (not their values, which may hold reasons or names), for the log. */
function describeCommand(interaction) {
  const sub = [interaction.options.getSubcommandGroup(false), interaction.options.getSubcommand(false)].filter(Boolean);
  const flat = (options) => options.flatMap((o) => (o.options ? flat(o.options) : [o.name]));
  const names = flat(interaction.options.data);
  return `/${[interaction.commandName, ...sub].join(' ')}${names.length ? ` [${names.join(', ')}]` : ''}`;
}

client.on(Events.InteractionCreate, async (interaction) => {
  const started = Date.now();
  const where = interaction.guild ? `in ${who(interaction.guild)} ${who(interaction.channel ?? { id: interaction.channelId })}` : 'in a DM';
  const what = interaction.isChatInputCommand() ? describeCommand(interaction) : interaction.customId;
  try {
    if (interaction.isChatInputCommand()) {
      const command = byName.get(interaction.commandName);
      log.info(`${what} by ${who(interaction.user)} ${where}`);
      if (!command) return log.warn(`Unknown command /${interaction.commandName}; run deploy-commands.`);
      await command.execute(interaction);
      log.debug(`${what} done in ${Date.now() - started} ms`);
    } else if (interaction.isButton()) {
      log.debug(`Button ${what} by ${who(interaction.user)} ${where}`);
      for (const command of commands) {
        if (command.handleButton && (await command.handleButton(interaction))) break;
      }
    } else if (interaction.isAnySelectMenu()) {
      log.debug(`Select ${what} by ${who(interaction.user)} ${where}`);
      for (const command of commands) {
        if (command.handleSelect && (await command.handleSelect(interaction))) break;
      }
    }
  } catch (err) {
    log.error(`${what} by ${who(interaction.user)} ${where} failed after ${Date.now() - started} ms`, err);
    const content = 'Something went wrong. Check my permissions and the role order.';
    const reply = interaction.deferred || interaction.replied
      ? interaction.editReply({ content })
      : interaction.reply({ content, flags: MessageFlags.Ephemeral });
    await reply.catch(() => {});
  }
});

function shutdown(signal) {
  log.info(`${signal} received, shutting down.`);
  client.destroy();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => log.error('Unhandled promise rejection', err));

log.info(`Starting Jarvis (Node ${process.version}, log level ${process.env.LOG_LEVEL || 'info'}).`);
client.login(token).catch((err) => {
  log.error('Login to Discord failed; check DISCORD_TOKEN', err);
  process.exit(1);
});
