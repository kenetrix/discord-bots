const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
} = require('discord.js');
const { stmts } = require('../db');
const { ephemeral, missingPermissions, POST_PERMISSIONS } = require('../util');
const { logger, who } = require('../log');
const { describeJob } = require('../scheduler');
const { timezone } = require('../config');

const log = logger('config');

const MODLOG_SELECT = 'config:modlog';
const MODLOG_OFF = 'config:modlog-off';
const MODLOG_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const MAX_OPTIONS = 25; // Discord's limit for one select menu
const MAX_FIELD = 1024; // Discord's limit for one embed field value
const POST_PERMISSION_NAMES = new PermissionsBitField(POST_PERMISSIONS)
  .toArray()
  .map((name) => name.replace(/([a-z])([A-Z])/g, '$1 $2'))
  .join(', ');

/** Text channels of the server in their sidebar order, split by whether Jarvis can post log embeds there. */
function logChannels(guild) {
  const channels = guild.channels.cache.filter((c) => MODLOG_TYPES.includes(c.type)).sort((a, b) => a.rawPosition - b.rawPosition);
  const [usable, blocked] = channels.partition((c) => !missingPermissions(c));
  return { usable: [...usable.values()], blocked: [...blocked.values()] };
}

/** Cleaner jobs with their settings, cut to fit into one embed field. */
function jobList(jobs) {
  if (!jobs.length) return 'None (create them with /cleaner)';
  const lines = jobs.map((j) => `**#${j.id}** · ${describeJob(j)}`);
  const footer = `\nManage them with /cleaner (time zone ${timezone}).`;
  let text = '';
  for (const [i, line] of lines.entries()) {
    const more = `\n… and ${lines.length - i} more (see /cleaner list)`;
    if (text.length + line.length + 1 + more.length + footer.length > MAX_FIELD) return text + more + footer;
    text += (text ? '\n' : '') + line;
  }
  return text + footer;
}

/** Builds the dashboard message (embed plus controls) for a guild. */
function dashboard(guild) {
  const modlogId = stmts.getSettings.get(guild.id)?.modlog_channel_id ?? null;
  const modlogChannel = modlogId ? guild.channels.cache.get(modlogId) : null;
  const jobs = stmts.listJobs.all(guild.id);

  let modlogText = 'Disabled';
  if (modlogId) {
    modlogText = modlogChannel ? `${modlogChannel}` : `<#${modlogId}> (channel no longer exists)`;
    const missing = modlogChannel && missingPermissions(modlogChannel);
    if (missing) modlogText += `\n⚠️ I cannot post there: I am missing ${missing}. Allow it in the channel's permissions, or pick another channel.`;
  }

  // Discord's channel picker cannot hide channels, so the menu only offers the channels Jarvis can post in.
  const { usable, blocked } = logChannels(guild);
  if (blocked.length) modlogText += `\nℹ️ The menu only lists channels where I have ${POST_PERMISSION_NAMES}.`;
  const fields = [
    { name: 'Mod log channel', value: modlogText },
    { name: `Cleaner jobs (${jobs.length})`, value: jobList(jobs) },
  ];

  const embed = new EmbedBuilder().setTitle('Jarvis settings').setColor(0x5865f2).addFields(...fields);

  const offered = usable.slice(0, MAX_OPTIONS);
  const select = new StringSelectMenuBuilder()
    .setCustomId(MODLOG_SELECT)
    .setPlaceholder(offered.length ? 'Select the mod log channel' : 'No channel where I can post')
    .setDisabled(!offered.length)
    .addOptions(
      offered.length
        ? offered.map((c) => ({ label: `#${c.name}`.slice(0, 100), value: c.id, default: c.id === modlogId }))
        : [{ label: 'No channel available', value: 'none' }],
    );
  if (usable.length > MAX_OPTIONS) {
    embed.setFooter({ text: `The menu shows the first ${MAX_OPTIONS} of ${usable.length} channels I can post in.` });
  }

  const off = new ButtonBuilder()
    .setCustomId(MODLOG_OFF)
    .setLabel('Disable mod log')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!modlogId);

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(off)] };
}

function allowed(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

/** Channel for the welcome message: the system channel, else the first text channel the bot can post in. */
function welcomeChannel(guild) {
  const me = guild.members.me;
  const canPost = (c) => c?.permissionsFor(me)?.has(POST_PERMISSIONS);
  if (canPost(guild.systemChannel)) return guild.systemChannel;
  return guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildText && canPost(c))
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .first();
}

/** Posts the settings dashboard as the first message after the bot joined a server. */
async function welcome(guild) {
  const channel = welcomeChannel(guild);
  if (!channel) {
    log.warn(`No channel to post the settings dashboard in on ${who(guild)}; use /config there.`);
    return;
  }
  const { embeds, components } = dashboard(guild);
  await channel.send({
    content: 'Hi, I am Jarvis. Set me up here, or open this panel again any time with `/config`. Only members with Manage Server can change settings.',
    embeds,
    components,
  });
}

module.exports = {
  welcome,
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Open the settings dashboard of this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    return ephemeral(interaction, dashboard(interaction.guild));
  },

  async handleButton(interaction) {
    if (interaction.customId !== MODLOG_OFF) return false;
    if (!allowed(interaction)) {
      await ephemeral(interaction, 'You need the Manage Server permission for this.');
      return true;
    }
    stmts.setModlog.run(interaction.guild.id, null);
    log.info(`Mod log on ${who(interaction.guild)} disabled by ${who(interaction.user)}.`);
    await interaction.update(dashboard(interaction.guild));
    return true;
  },

  async handleSelect(interaction) {
    if (interaction.customId !== MODLOG_SELECT) return false;
    if (!allowed(interaction)) {
      await ephemeral(interaction, 'You need the Manage Server permission for this.');
      return true;
    }
    const channel = interaction.guild.channels.cache.get(interaction.values[0]);
    if (!channel) {
      await interaction.update(dashboard(interaction.guild));
      await interaction.followUp({ content: 'That channel no longer exists. Pick another one.', flags: MessageFlags.Ephemeral });
      return true;
    }
    // Permissions may have changed since the dashboard was opened.
    const missing = missingPermissions(channel);
    if (missing) {
      await interaction.update(dashboard(interaction.guild));
      await interaction.followUp({
        content: `I cannot use ${channel} as the mod log: I am missing ${missing} there. Allow it in the channel's permissions for my role, or pick another channel.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    stmts.setModlog.run(interaction.guild.id, channel.id);
    log.info(`Mod log channel on ${who(interaction.guild)} set to ${who(channel)} by ${who(interaction.user)}.`);
    await interaction.update(dashboard(interaction.guild));
    return true;
  },
};
