const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ChannelSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { stmts } = require('../db');
const { ephemeral } = require('../util');
const { logger, who } = require('../log');

const log = logger('config');

const MODLOG_SELECT = 'config:modlog';
const MODLOG_OFF = 'config:modlog-off';
const MODLOG_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const LOG_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

/** Builds the dashboard message (embed plus controls) for a guild. */
function dashboard(guild) {
  const modlogId = stmts.getSettings.get(guild.id)?.modlog_channel_id ?? null;
  const modlogChannel = modlogId ? guild.channels.cache.get(modlogId) : null;
  const jobs = stmts.listJobs.all(guild.id).length;

  let modlogText = 'Disabled';
  if (modlogId) {
    modlogText = modlogChannel ? `${modlogChannel}` : `<#${modlogId}> (channel no longer exists)`;
    if (modlogChannel && !modlogChannel.permissionsFor(guild.members.me)?.has(LOG_PERMISSIONS)) {
      modlogText += '\nI am missing View Channel, Send Messages or Embed Links there.';
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('Jarvis settings')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Mod log channel', value: modlogText },
      { name: 'Cleaner jobs', value: jobs ? `${jobs} (manage them with /cleaner)` : 'None (create them with /cleaner)' },
    );

  const select = new ChannelSelectMenuBuilder()
    .setCustomId(MODLOG_SELECT)
    .setPlaceholder('Select the mod log channel')
    .setChannelTypes(...MODLOG_TYPES);
  if (modlogChannel) select.setDefaultChannels(modlogChannel.id);

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
  const canPost = (c) => c?.permissionsFor(me)?.has([...LOG_PERMISSIONS]);
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
    await interaction.update(dashboard(interaction.guild));
    return true;
  },

  async handleSelect(interaction) {
    if (interaction.customId !== MODLOG_SELECT) return false;
    if (!allowed(interaction)) {
      await ephemeral(interaction, 'You need the Manage Server permission for this.');
      return true;
    }
    const channel = interaction.channels.first();
    if (!channel.permissionsFor(interaction.guild.members.me)?.has(LOG_PERMISSIONS)) {
      await ephemeral(interaction, `I am missing View Channel, Send Messages or Embed Links in ${channel}.`);
      return true;
    }
    stmts.setModlog.run(interaction.guild.id, channel.id);
    await interaction.update(dashboard(interaction.guild));
    return true;
  },
};
