const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ephemeral, checkRole } = require('../util');
const { modlog } = require('../modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Rollen von Mitgliedern verwalten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Einem Mitglied eine Rolle geben')
        .addUserOption((o) => o.setName('mitglied').setDescription('Mitglied').setRequired(true))
        .addRoleOption((o) => o.setName('rolle').setDescription('Rolle').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Einem Mitglied eine Rolle entziehen')
        .addUserOption((o) => o.setName('mitglied').setDescription('Mitglied').setRequired(true))
        .addRoleOption((o) => o.setName('rolle').setDescription('Rolle').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.options.getMember('mitglied');
    const role = interaction.options.getRole('rolle');
    if (!member) return ephemeral(interaction, 'Dieses Mitglied ist nicht auf dem Server.');

    const problem = checkRole(interaction, role);
    if (problem) return ephemeral(interaction, problem);

    const reason = `/role ${sub} durch ${interaction.user.tag}`;
    if (sub === 'add') {
      if (member.roles.cache.has(role.id)) return ephemeral(interaction, `${member} hat ${role} bereits.`);
      await member.roles.add(role, reason);
    } else {
      if (!member.roles.cache.has(role.id)) return ephemeral(interaction, `${member} hat ${role} nicht.`);
      await member.roles.remove(role, reason);
    }

    await modlog(interaction.guild, {
      action: sub === 'add' ? 'Rolle vergeben' : 'Rolle entzogen',
      target: member.user,
      moderator: interaction.user,
      fields: [{ name: 'Rolle', value: `${role}`, inline: true }],
    });
    return ephemeral(interaction, `${sub === 'add' ? 'Vergeben' : 'Entzogen'}: ${role} für ${member}.`);
  },
};
