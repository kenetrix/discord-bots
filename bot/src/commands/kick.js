const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ephemeral, checkHierarchy } = require('../util');
const { modlog } = require('../modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400)),

  async execute(interaction) {
    const member = interaction.options.getMember('member');
    const reason = interaction.options.getString('reason') ?? 'No reason given';
    if (!member) return ephemeral(interaction, 'This member is not on the server.');

    const problem = checkHierarchy(interaction, member);
    if (problem) return ephemeral(interaction, problem);

    await member.user
      .send(`You were kicked from **${interaction.guild.name}**. Reason: ${reason}`)
      .catch(() => {});
    await member.kick(`${reason} (by ${interaction.user.tag})`);
    await modlog(interaction.guild, {
      action: 'Kick',
      target: member.user,
      moderator: interaction.user,
      reason,
      color: 0xf0b232,
    });
    return ephemeral(interaction, `${member.user.tag} was kicked.`);
  },
};
