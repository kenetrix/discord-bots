const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { cleanChannel } = require('../cleanup');
const { modlog } = require('../modlog');
const { logger, who } = require('../log');

const log = logger('clean');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clean')
    .setDescription('Delete messages in the current channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('How many messages (1 to 500, default: all from the last 14 days)').setMinValue(1).setMaxValue(500),
    )
    .addUserOption((o) => o.setName('user').setDescription('Only messages from this user'))
    .addIntegerOption((o) =>
      o
        .setName('later_than')
        .setDescription('Only delete messages from the last X hours')
        .setMinValue(1)
        .setMaxValue(336),
    )
    .addIntegerOption((o) =>
      o.setName('keep_latest').setDescription('Always keep the newest N messages of the channel').setMinValue(0).setMaxValue(500),
    )
    .addBooleanOption((o) => o.setName('keep_pinned').setDescription('Keep pinned messages (default: yes)')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const amount = interaction.options.getInteger('amount');
    const user = interaction.options.getUser('user');
    const laterThan = interaction.options.getInteger('later_than');
    const keepLatest = interaction.options.getInteger('keep_latest') ?? 0;

    const { deleted, skippedOld } = await cleanChannel(interaction.channel, {
      limit: amount ?? Infinity,
      userId: user?.id,
      newerThanMs: laterThan ? laterThan * 36e5 : 0,
      keepLatest,
      keepPinned: interaction.options.getBoolean('keep_pinned') ?? true,
      maxScan: user || !amount ? 2000 + keepLatest : amount + keepLatest + 100,
      allowOld: false,
    });

    log.info(`${who(interaction.user)} deleted ${deleted} message(s) in ${who(interaction.channel)} on ${who(interaction.guild)}${skippedOld ? `, skipped ${skippedOld} older than 14 days` : ''}.`);

    await modlog(interaction.guild, {
      action: 'Clean',
      moderator: interaction.user,
      fields: [
        { name: 'Channel', value: `${interaction.channel}`, inline: true },
        { name: 'Deleted', value: String(deleted), inline: true },
        ...(user ? [{ name: 'Only from', value: `${user}`, inline: true }] : []),
        ...(laterThan ? [{ name: 'Later than', value: `${laterThan} h`, inline: true }] : []),
        ...(keepLatest ? [{ name: 'Kept newest', value: String(keepLatest), inline: true }] : []),
      ],
    });

    const note = skippedOld ? ` Skipped ${skippedOld} message(s) older than 14 days; a /cleaner job deletes those.` : '';
    return interaction.editReply(`Deleted ${deleted} message(s).${note}`);
  },
};
