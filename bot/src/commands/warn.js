const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { stmts } = require('../db');
const { ephemeral } = require('../util');
const { modlog } = require('../modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Verwarnungen verwalten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Mitglied verwarnen')
        .addUserOption((o) => o.setName('mitglied').setDescription('Mitglied').setRequired(true))
        .addStringOption((o) => o.setName('grund').setDescription('Grund').setRequired(true).setMaxLength(400)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Verwarnungen eines Mitglieds anzeigen')
        .addUserOption((o) => o.setName('mitglied').setDescription('Mitglied').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Eine Verwarnung löschen')
        .addIntegerOption((o) => o.setName('id').setDescription('ID der Verwarnung').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Alle Verwarnungen eines Mitglieds löschen')
        .addUserOption((o) => o.setName('mitglied').setDescription('Mitglied').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'add') {
      const user = interaction.options.getUser('mitglied');
      const reason = interaction.options.getString('grund');
      if (user.bot) return ephemeral(interaction, 'Bots können nicht verwarnt werden.');
      stmts.addWarning.run(guildId, user.id, interaction.user.id, reason, Date.now());
      const { n } = stmts.countWarnings.get(guildId, user.id);
      await user.send(`Du wurdest auf **${interaction.guild.name}** verwarnt. Grund: ${reason}`).catch(() => {});
      await modlog(interaction.guild, {
        action: 'Verwarnung',
        target: user,
        moderator: interaction.user,
        reason,
        color: 0xf0b232,
        fields: [{ name: 'Verwarnungen gesamt', value: String(n), inline: true }],
      });
      return ephemeral(interaction, `${user} wurde verwarnt (insgesamt ${n}).`);
    }

    if (sub === 'list') {
      const user = interaction.options.getUser('mitglied');
      const rows = stmts.listWarnings.all(guildId, user.id);
      if (rows.length === 0) return ephemeral(interaction, `${user} hat keine Verwarnungen.`);
      const embed = new EmbedBuilder()
        .setTitle(`Verwarnungen von ${user.tag}`)
        .setColor(0xf0b232)
        .setDescription(
          rows
            .map((w) => `**#${w.id}** · <t:${Math.floor(w.created_at / 1000)}:d> · von <@${w.moderator_id}>\n${w.reason}`)
            .join('\n\n'),
        );
      return ephemeral(interaction, { embeds: [embed] });
    }

    if (sub === 'remove') {
      const id = interaction.options.getInteger('id');
      const { changes } = stmts.deleteWarning.run(guildId, id);
      return ephemeral(interaction, changes ? `Verwarnung #${id} gelöscht.` : `Verwarnung #${id} gibt es nicht.`);
    }

    const user = interaction.options.getUser('mitglied');
    const { changes } = stmts.clearWarnings.run(guildId, user.id);
    await modlog(interaction.guild, {
      action: 'Verwarnungen gelöscht',
      target: user,
      moderator: interaction.user,
      color: 0x23a55a,
      fields: [{ name: 'Anzahl', value: String(changes), inline: true }],
    });
    return ephemeral(interaction, `${changes} Verwarnung(en) von ${user} gelöscht.`);
  },
};
