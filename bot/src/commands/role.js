const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ephemeral, checkRole } = require('../util');
const { modlog } = require('../modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Manage members\' roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Give a member a role')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Take a role from a member')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.options.getMember('member');
    const role = interaction.options.getRole('role');
    if (!member) return ephemeral(interaction, 'This member is not on the server.');

    const problem = checkRole(interaction, role);
    if (problem) return ephemeral(interaction, problem);

    const reason = `/role ${sub} by ${interaction.user.tag}`;
    if (sub === 'add') {
      if (member.roles.cache.has(role.id)) return ephemeral(interaction, `${member} already has ${role}.`);
      await member.roles.add(role, reason);
    } else {
      if (!member.roles.cache.has(role.id)) return ephemeral(interaction, `${member} does not have ${role}.`);
      await member.roles.remove(role, reason);
    }

    await modlog(interaction.guild, {
      action: sub === 'add' ? 'Role assigned' : 'Role removed',
      target: member.user,
      moderator: interaction.user,
      fields: [{ name: 'Role', value: `${role}`, inline: true }],
    });
    return ephemeral(interaction, `${sub === 'add' ? 'Assigned' : 'Removed'} ${role} ${sub === 'add' ? 'to' : 'from'} ${member}.`);
  },
};
