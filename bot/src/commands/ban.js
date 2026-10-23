const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ephemeral, checkHierarchy } = require('../util');
const { modlog } = require('../modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Nutzer bannen oder entbannen')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Nutzer bannen')
        .addUserOption((o) => o.setName('nutzer').setDescription('Nutzer').setRequired(true))
        .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(400))
        .addIntegerOption((o) =>
          o
            .setName('nachrichten_tage')
            .setDescription('Nachrichten der letzten X Tage löschen (0 bis 7)')
            .setMinValue(0)
            .setMaxValue(7),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Ban aufheben')
        .addStringOption((o) => o.setName('nutzer_id').setDescription('Discord-ID des Nutzers').setRequired(true))
        .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(400)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const reason = interaction.options.getString('grund') ?? 'Kein Grund angegeben';

    if (sub === 'remove') {
      const userId = interaction.options.getString('nutzer_id').trim();
      const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
      if (!ban) return ephemeral(interaction, 'Für diese ID gibt es keinen Ban.');
      await interaction.guild.bans.remove(userId, `${reason} (durch ${interaction.user.tag})`);
      await modlog(interaction.guild, {
        action: 'Unban',
        target: ban.user,
        moderator: interaction.user,
        reason,
        color: 0x23a55a,
      });
      return ephemeral(interaction, `${ban.user.tag} wurde entbannt.`);
    }

    const user = interaction.options.getUser('nutzer');
    const member = interaction.options.getMember('nutzer');
    // Users who are not (or no longer) on the server can be banned without a hierarchy check.
    if (member) {
      const problem = checkHierarchy(interaction, member);
      if (problem) return ephemeral(interaction, problem);
      await user.send(`Du wurdest von **${interaction.guild.name}** gebannt. Grund: ${reason}`).catch(() => {});
    }

    const days = interaction.options.getInteger('nachrichten_tage') ?? 0;
    await interaction.guild.bans.create(user.id, {
      reason: `${reason} (durch ${interaction.user.tag})`,
      deleteMessageSeconds: days * 86400,
    });
    await modlog(interaction.guild, {
      action: 'Ban',
      target: user,
      moderator: interaction.user,
      reason,
      color: 0xda373c,
    });
    return ephemeral(interaction, `${user.tag} wurde gebannt.`);
  },
};
