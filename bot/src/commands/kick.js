const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ephemeral, checkHierarchy } = require('../util');
const { modlog } = require('../modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Mitglied vom Server werfen')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('mitglied').setDescription('Mitglied').setRequired(true))
    .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(400)),

  async execute(interaction) {
    const member = interaction.options.getMember('mitglied');
    const reason = interaction.options.getString('grund') ?? 'Kein Grund angegeben';
    if (!member) return ephemeral(interaction, 'Dieses Mitglied ist nicht auf dem Server.');

    const problem = checkHierarchy(interaction, member);
    if (problem) return ephemeral(interaction, problem);

    await member.user
      .send(`Du wurdest von **${interaction.guild.name}** gekickt. Grund: ${reason}`)
      .catch(() => {});
    await member.kick(`${reason} (durch ${interaction.user.tag})`);
    await modlog(interaction.guild, {
      action: 'Kick',
      target: member.user,
      moderator: interaction.user,
      reason,
      color: 0xf0b232,
    });
    return ephemeral(interaction, `${member.user.tag} wurde gekickt.`);
  },
};
