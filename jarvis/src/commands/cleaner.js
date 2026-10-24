const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const cron = require('node-cron');
const { stmts } = require('../db');
const { ephemeral } = require('../util');
const { ALL_VOICE, PRESETS, describeJob, scheduleJob, unscheduleJob, runJob } = require('../scheduler');
const { timezone } = require('../config');

/** The job number is its position in /cleaner list (1..n), not the database id, so deleting a job leaves no gaps. */
const numberOption = (o) =>
  o.setName('number').setDescription('Job number from /cleaner list').setRequired(true).setMinValue(1).setAutocomplete(true);

/** describeJob without channel mentions, which autocomplete choices cannot render. */
function plainJob(guild, job) {
  const channel = job.channel_id === ALL_VOICE ? null : guild.channels.cache.get(job.channel_id);
  return describeJob(job).replace(`<#${job.channel_id}>`, channel ? `#${channel.name}` : 'deleted channel');
}

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
        .addIntegerOption((o) =>
          o.setName('keep_latest').setDescription('Always keep the newest N messages (default: 0)').setMinValue(0).setMaxValue(500),
        )
        .addBooleanOption((o) =>
          o.setName('keep_pinned').setDescription('Keep pinned messages (default: yes)'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add-voice')
        .setDescription('Create a cleaner job that clears the chats of all voice channels')
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
        .addIntegerOption((o) =>
          o.setName('keep_latest').setDescription('Always keep the newest N messages (default: 0)').setMinValue(0).setMaxValue(500),
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
        .addIntegerOption(numberOption),
    )
    .addSubcommand((sub) =>
      sub
        .setName('run')
        .setDescription('Run a cleaner job right now')
        .addIntegerOption(numberOption),
    ),

  /** Offers the jobs with their list number, so the number picked is always the one /cleaner list shows. */
  async autocomplete(interaction) {
    const typed = String(interaction.options.getFocused()).trim();
    const choices = stmts.listJobs
      .all(interaction.guild.id)
      .map((job, i) => ({ name: `${i + 1} · ${plainJob(interaction.guild, job)}`.slice(0, 100), value: i + 1 }))
      .filter((c) => !typed || String(c.value).startsWith(typed));
    await interaction.respond(choices.slice(0, 25));
  },

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
      const keepLatest = interaction.options.getInteger('keep_latest') ?? 0;
      const { lastInsertRowid } = stmts.addJob.run(guildId, channel.id, expr, maxAge, keepPinned ? 1 : 0, keepLatest, interaction.user.id);
      const job = stmts.getJob.get(guildId, lastInsertRowid);
      scheduleJob(interaction.client, job);
      return ephemeral(
        interaction,
        `Cleaner ${stmts.listJobs.all(guildId).length} created: ${channel} will be cleared on \`${expr}\` (${timezone})` +
          (maxAge ? `, only messages older than ${maxAge} h` : '') +
          (keepLatest ? `, keeping the newest ${keepLatest}` : '') +
          '.',
      );
    }

    if (sub === 'add-voice') {
      const input = interaction.options.getString('schedule').trim();
      const expr = PRESETS[input.toLowerCase()] ?? input;
      if (!cron.validate(expr)) {
        return ephemeral(interaction, `Invalid schedule \`${input}\`. Use hourly, daily, weekly or cron syntax.`);
      }
      const maxAge = interaction.options.getInteger('older_than_hours') ?? 0;
      const keepPinned = interaction.options.getBoolean('keep_pinned') ?? true;
      const keepLatest = interaction.options.getInteger('keep_latest') ?? 0;
      const { lastInsertRowid } = stmts.addJob.run(guildId, ALL_VOICE, expr, maxAge, keepPinned ? 1 : 0, keepLatest, interaction.user.id);
      const job = stmts.getJob.get(guildId, lastInsertRowid);
      scheduleJob(interaction.client, job);
      return ephemeral(
        interaction,
        `Cleaner ${stmts.listJobs.all(guildId).length} created: all voice channels will be cleared on \`${expr}\` (${timezone})` +
          (maxAge ? `, only messages older than ${maxAge} h` : '') +
          (keepLatest ? `, keeping the newest ${keepLatest}` : '') +
          '.' +
          ' Voice channels where I lack View Channel, Read Message History or Manage Messages are skipped.',
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
              (j, i) =>
                `**${i + 1}** · ${describeJob(j)}` +
                `\nLast run: ${j.last_run_at ? `<t:${Math.floor(j.last_run_at / 1000)}:R>` : 'never'}`,
            )
            .join('\n\n'),
        )
        .setFooter({ text: `Time zone: ${timezone} · use these numbers with /cleaner remove and run` });
      return ephemeral(interaction, { embeds: [embed] });
    }

    const number = interaction.options.getInteger('number');
    const job = stmts.listJobs.all(guildId)[number - 1];
    if (!job) return ephemeral(interaction, `Cleaner ${number} does not exist. See /cleaner list.`);

    if (sub === 'remove') {
      unscheduleJob(job.id);
      stmts.deleteJob.run(guildId, job.id);
      return ephemeral(interaction, `Deleted cleaner ${number} (${describeJob(job)}). The jobs after it move up one number.`);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await runJob(interaction.client, job);
    if (!result) return interaction.editReply(`Cleaner ${number} is already running or failed (see log).`);
    return interaction.editReply(`Cleaner ${number} (${describeJob(job)}): deleted ${result.deleted} message(s).`);
  },
};
