const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { stmts } = require('../db');
const { ephemeral } = require('../util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Bot-Einstellungen für diesen Server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('modlog')
        .setDescription('Kanal für das Moderations-Log setzen (leer lassen zum Abschalten)')
        .addChannelOption((o) =>
          o.setName('kanal').setDescription('Log-Kanal').addChannelTypes(ChannelType.GuildText),
        ),
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('kanal');
    stmts.setModlog.run(interaction.guild.id, channel?.id ?? null);
    return ephemeral(interaction, channel ? `Mod-Log geht ab jetzt nach ${channel}.` : 'Mod-Log abgeschaltet.');
  },
};
