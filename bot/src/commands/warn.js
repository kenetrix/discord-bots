const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { stmts } = require('../db');
const { ephemeral } = require('../util');
const { modlog } = require('../modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Manage warnings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Warn a member')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(400)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Show a member\'s warnings')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Delete a warning')
        .addIntegerOption((o) => o.setName('id').setDescription('Warning ID').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Delete all warnings of a member')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'add') {
      const user = interaction.options.getUser('member');
      const reason = interaction.options.getString('reason');
      if (user.bot) return ephemeral(interaction, 'Bots cannot be warned.');
      stmts.addWarning.run(guildId, user.id, interaction.user.id, reason, Date.now());
      const { n } = stmts.countWarnings.get(guildId, user.id);
      await user.send(`You were warned on **${interaction.guild.name}**. Reason: ${reason}`).catch(() => {});
      await modlog(interaction.guild, {
        action: 'Warning',
        target: user,
        moderator: interaction.user,
        reason,
        color: 0xf0b232,
        fields: [{ name: 'Total warnings', value: String(n), inline: true }],
      });
      return ephemeral(interaction, `${user} was warned (${n} in total).`);
    }

    if (sub === 'list') {
      const user = interaction.options.getUser('member');
      const rows = stmts.listWarnings.all(guildId, user.id);
      if (rows.length === 0) return ephemeral(interaction, `${user} has no warnings.`);
      const embed = new EmbedBuilder()
        .setTitle(`Warnings for ${user.tag}`)
        .setColor(0xf0b232)
        .setDescription(
          rows
            .map((w) => `**#${w.id}** · <t:${Math.floor(w.created_at / 1000)}:d> · by <@${w.moderator_id}>\n${w.reason}`)
            .join('\n\n'),
        );
      return ephemeral(interaction, { embeds: [embed] });
    }

    if (sub === 'remove') {
      const id = interaction.options.getInteger('id');
      const { changes } = stmts.deleteWarning.run(guildId, id);
      return ephemeral(interaction, changes ? `Deleted warning #${id}.` : `Warning #${id} does not exist.`);
    }

    const user = interaction.options.getUser('member');
    const { changes } = stmts.clearWarnings.run(guildId, user.id);
    await modlog(interaction.guild, {
      action: 'Warnings deleted',
      target: user,
      moderator: interaction.user,
      color: 0x23a55a,
      fields: [{ name: 'Count', value: String(changes), inline: true }],
    });
    return ephemeral(interaction, `Deleted ${changes} warning(s) for ${user}.`);
  },
};
