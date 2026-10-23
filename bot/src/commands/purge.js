const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { cleanChannel } = require('../cleanup');
const { modlog } = require('../modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete the latest messages in the current channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('How many messages (1 to 500)').setRequired(true).setMinValue(1).setMaxValue(500),
    )
    .addUserOption((o) => o.setName('user').setDescription('Only messages from this user'))
    .addBooleanOption((o) => o.setName('keep_pinned').setDescription('Keep pinned messages (default: yes)')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const amount = interaction.options.getInteger('amount');
    const user = interaction.options.getUser('user');

    const { deleted, skippedOld } = await cleanChannel(interaction.channel, {
      limit: amount,
      userId: user?.id,
      keepPinned: interaction.options.getBoolean('keep_pinned') ?? true,
      maxScan: user ? 2000 : amount + 100,
      allowOld: false,
    });

    await modlog(interaction.guild, {
      action: 'Purge',
      moderator: interaction.user,
      fields: [
        { name: 'Channel', value: `${interaction.channel}`, inline: true },
        { name: 'Deleted', value: String(deleted), inline: true },
        ...(user ? [{ name: 'Only from', value: `${user}`, inline: true }] : []),
      ],
    });

    const note = skippedOld ? ` Skipped ${skippedOld} message(s) older than 14 days; use /cleaner for those.` : '';
    return interaction.editReply(`Deleted ${deleted} message(s).${note}`);
  },
};
