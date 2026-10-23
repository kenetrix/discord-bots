const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const cron = require('node-cron');
const { stmts } = require('../db');
const { ephemeral } = require('../util');
const { scheduleJob, unscheduleJob, runJob } = require('../scheduler');
const { timezone } = require('../config');

// Kurzformen, damit niemand Cron-Syntax kennen muss.
const PRESETS = {
  stündlich: '0 * * * *',
  täglich: '0 4 * * *',
  wöchentlich: '0 4 * * 1',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleaner')
    .setDescription('Zeitgesteuertes Leeren von Kanälen')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Neuen Cleaner-Job anlegen')
        .addChannelOption((o) =>
          o
            .setName('kanal')
            .setDescription('Kanal, der geleert wird')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice),
        )
        .addStringOption((o) =>
          o
            .setName('zeitplan')
            .setDescription('stündlich, täglich (04:00), wöchentlich (Mo 04:00) oder Cron, z.B. "30 3 * * *"')
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('aelter_als_stunden')
            .setDescription('Nur Nachrichten löschen, die älter sind als X Stunden (Standard: 0 = alle)')
            .setMinValue(0)
            .setMaxValue(8760),
        )
        .addBooleanOption((o) =>
          o.setName('angepinnte_behalten').setDescription('Angepinnte Nachrichten behalten (Standard: ja)'),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Alle Cleaner-Jobs dieses Servers anzeigen'))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Cleaner-Job löschen')
        .addIntegerOption((o) => o.setName('id').setDescription('Job-ID').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('run')
        .setDescription('Cleaner-Job sofort ausführen')
        .addIntegerOption((o) => o.setName('id').setDescription('Job-ID').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'add') {
      const channel = interaction.options.getChannel('kanal');
      const input = interaction.options.getString('zeitplan').trim();
      const expr = PRESETS[input.toLowerCase()] ?? input;
      if (!cron.validate(expr)) {
        return ephemeral(interaction, `Ungültiger Zeitplan \`${input}\`. Nutze stündlich, täglich, wöchentlich oder Cron-Syntax.`);
      }
      const perms = channel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages])) {
        return ephemeral(interaction, `Mir fehlen in ${channel} die Rechte „Kanal ansehen“, „Nachrichtenverlauf lesen“ oder „Nachrichten verwalten“.`);
      }
      const maxAge = interaction.options.getInteger('aelter_als_stunden') ?? 0;
      const keepPinned = interaction.options.getBoolean('angepinnte_behalten') ?? true;
      const { lastInsertRowid } = stmts.addJob.run(guildId, channel.id, expr, maxAge, keepPinned ? 1 : 0, interaction.user.id);
      const job = stmts.getJob.get(guildId, lastInsertRowid);
      scheduleJob(interaction.client, job);
      return ephemeral(
        interaction,
        `Cleaner #${job.id} angelegt: ${channel} wird nach \`${expr}\` (${timezone}) geleert` +
          (maxAge ? `, nur Nachrichten älter als ${maxAge} h.` : '.'),
      );
    }

    if (sub === 'list') {
      const jobs = stmts.listJobs.all(guildId);
      if (jobs.length === 0) return ephemeral(interaction, 'Keine Cleaner-Jobs angelegt.');
      const embed = new EmbedBuilder()
        .setTitle('Cleaner-Jobs')
        .setColor(0x5865f2)
        .setDescription(
          jobs
            .map(
              (j) =>
                `**#${j.id}** · <#${j.channel_id}> · \`${j.cron}\`` +
                (j.max_age_hours ? ` · älter als ${j.max_age_hours} h` : '') +
                (j.keep_pinned ? '' : ' · inkl. angepinnter') +
                `\nLetzter Lauf: ${j.last_run_at ? `<t:${Math.floor(j.last_run_at / 1000)}:R>` : 'noch nie'}`,
            )
            .join('\n\n'),
        )
        .setFooter({ text: `Zeitzone: ${timezone}` });
      return ephemeral(interaction, { embeds: [embed] });
    }

    const id = interaction.options.getInteger('id');
    const job = stmts.getJob.get(guildId, id);
    if (!job) return ephemeral(interaction, `Cleaner #${id} gibt es nicht.`);

    if (sub === 'remove') {
      unscheduleJob(job.id);
      stmts.deleteJob.run(guildId, job.id);
      return ephemeral(interaction, `Cleaner #${job.id} gelöscht.`);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await runJob(interaction.client, job);
    if (!result) return interaction.editReply(`Cleaner #${job.id} läuft gerade schon oder ist fehlgeschlagen (siehe Log).`);
    return interaction.editReply(`Cleaner #${job.id}: ${result.deleted} Nachricht(en) gelöscht.`);
  },
};
