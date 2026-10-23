const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const cron = require('node-cron');
const { stmts } = require('../db');
const { ephemeral } = require('../util');
const { scheduleJob, unscheduleJob, runJob } = require('../scheduler');
const { timezone } = require('../config');

// Shorthands so nobody has to know cron syntax.
const PRESETS = {
  hourly: '0 * * * *',
  daily: '0 4 * * *',
  weekly: '0 4 * * 1',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleaner')
    .setDescription('Clear channels on a schedule')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Create a new cleaner job')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel to clear')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice),
        )
        .addStringOption((o) =>
          o
            .setName('schedule')
            .setDescription('hourly, daily (04:00), weekly (Mon 04:00) or cron, e.g. "30 3 * * *"')
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('older_than_hours')
            .setDescription('Only delete messages older than X hours (default: 0 = all)')
            .setMinValue(0)
            .setMaxValue(8760),
        )
        .addBooleanOption((o) =>
          o.setName('keep_pinned').setDescription('Keep pinned messages (default: yes)'),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show all cleaner jobs of this server'))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Delete a cleaner job')
        .addIntegerOption((o) => o.setName('id').setDescription('Job ID').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('run')
        .setDescription('Run a cleaner job right now')
        .addIntegerOption((o) => o.setName('id').setDescription('Job ID').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'add') {
      const channel = interaction.options.getChannel('channel');
      const input = interaction.options.getString('schedule').trim();
      const expr = PRESETS[input.toLowerCase()] ?? input;
      if (!cron.validate(expr)) {
        return ephemeral(interaction, `Invalid schedule \`${input}\`. Use hourly, daily, weekly or cron syntax.`);
      }
      const perms = channel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages])) {
        return ephemeral(interaction, `I am missing permissions in ${channel}: View Channel, Read Message History or Manage Messages.`);
      }
      const maxAge = interaction.options.getInteger('older_than_hours') ?? 0;
      const keepPinned = interaction.options.getBoolean('keep_pinned') ?? true;
      const { lastInsertRowid } = stmts.addJob.run(guildId, channel.id, expr, maxAge, keepPinned ? 1 : 0, interaction.user.id);
      const job = stmts.getJob.get(guildId, lastInsertRowid);
      scheduleJob(interaction.client, job);
      return ephemeral(
        interaction,
        `Cleaner #${job.id} created: ${channel} will be cleared on \`${expr}\` (${timezone})` +
          (maxAge ? `, only messages older than ${maxAge} h.` : '.'),
      );
    }

    if (sub === 'list') {
      const jobs = stmts.listJobs.all(guildId);
      if (jobs.length === 0) return ephemeral(interaction, 'No cleaner jobs created.');
      const embed = new EmbedBuilder()
        .setTitle('Cleaner jobs')
        .setColor(0x5865f2)
        .setDescription(
          jobs
            .map(
              (j) =>
                `**#${j.id}** · <#${j.channel_id}> · \`${j.cron}\`` +
                (j.max_age_hours ? ` · older than ${j.max_age_hours} h` : '') +
                (j.keep_pinned ? '' : ' · incl. pinned') +
                `\nLast run: ${j.last_run_at ? `<t:${Math.floor(j.last_run_at / 1000)}:R>` : 'never'}`,
            )
            .join('\n\n'),
        )
        .setFooter({ text: `Time zone: ${timezone}` });
      return ephemeral(interaction, { embeds: [embed] });
    }

    const id = interaction.options.getInteger('id');
    const job = stmts.getJob.get(guildId, id);
    if (!job) return ephemeral(interaction, `Cleaner #${id} does not exist.`);

    if (sub === 'remove') {
      unscheduleJob(job.id);
      stmts.deleteJob.run(guildId, job.id);
      return ephemeral(interaction, `Deleted cleaner #${job.id}.`);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await runJob(interaction.client, job);
    if (!result) return interaction.editReply(`Cleaner #${job.id} is already running or failed (see log).`);
    return interaction.editReply(`Cleaner #${job.id}: deleted ${result.deleted} message(s).`);
  },
};
