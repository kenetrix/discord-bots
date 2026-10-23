const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { stmts } = require('../db');
const { ephemeral } = require('../util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Bot settings for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('modlog')
        .setDescription('Set the moderation log channel (leave empty to disable)')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText),
        ),
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    stmts.setModlog.run(interaction.guild.id, channel?.id ?? null);
    return ephemeral(interaction, channel ? `The mod log now goes to ${channel}.` : 'Mod log disabled.');
  },
};
