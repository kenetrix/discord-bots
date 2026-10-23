const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ephemeral, checkHierarchy } = require('../util');
const { modlog } = require('../modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban or unban a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Ban a user')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400))
        .addIntegerOption((o) =>
          o
            .setName('delete_days')
            .setDescription('Delete messages from the last X days (0 to 7)')
            .setMinValue(0)
            .setMaxValue(7),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Lift a ban')
        .addStringOption((o) => o.setName('user_id').setDescription('Discord ID of the user').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const reason = interaction.options.getString('reason') ?? 'No reason given';

    if (sub === 'remove') {
      const userId = interaction.options.getString('user_id').trim();
      const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
      if (!ban) return ephemeral(interaction, 'There is no ban for this ID.');
      await interaction.guild.bans.remove(userId, `${reason} (by ${interaction.user.tag})`);
      await modlog(interaction.guild, {
        action: 'Unban',
        target: ban.user,
        moderator: interaction.user,
        reason,
        color: 0x23a55a,
      });
      return ephemeral(interaction, `${ban.user.tag} was unbanned.`);
    }

    const user = interaction.options.getUser('user');
    const member = interaction.options.getMember('user');
    // Users who are not (or no longer) on the server can be banned without a hierarchy check.
    if (member) {
      const problem = checkHierarchy(interaction, member);
      if (problem) return ephemeral(interaction, problem);
      await user.send(`You were banned from **${interaction.guild.name}**. Reason: ${reason}`).catch(() => {});
    }

    const days = interaction.options.getInteger('delete_days') ?? 0;
    await interaction.guild.bans.create(user.id, {
      reason: `${reason} (by ${interaction.user.tag})`,
      deleteMessageSeconds: days * 86400,
    });
    await modlog(interaction.guild, {
      action: 'Ban',
      target: user,
      moderator: interaction.user,
      reason,
      color: 0xda373c,
    });
    return ephemeral(interaction, `${user.tag} was banned.`);
  },
};
