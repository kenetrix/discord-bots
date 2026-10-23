const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ephemeral, checkHierarchy, parseDuration } = require('../util');
const { modlog } = require('../modlog');

const MAX_TIMEOUT = 28 * 864e5; // Discord-Limit: 28 Tage

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Mitglied stummschalten (Timeout) oder Timeout aufheben')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Timeout setzen')
        .addUserOption((o) => o.setName('mitglied').setDescription('Mitglied').setRequired(true))
        .addStringOption((o) =>
          o.setName('dauer').setDescription('z.B. 10m, 2h, 1d (max. 28d)').setRequired(true),
        )
        .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(400)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Timeout aufheben')
        .addUserOption((o) => o.setName('mitglied').setDescription('Mitglied').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.options.getMember('mitglied');
    if (!member) return ephemeral(interaction, 'Dieses Mitglied ist nicht auf dem Server.');

    const problem = checkHierarchy(interaction, member);
    if (problem) return ephemeral(interaction, problem);

    if (sub === 'remove') {
      if (!member.isCommunicationDisabled()) return ephemeral(interaction, `${member} hat keinen Timeout.`);
      await member.timeout(null, `Aufgehoben durch ${interaction.user.tag}`);
      await modlog(interaction.guild, {
        action: 'Timeout aufgehoben',
        target: member.user,
        moderator: interaction.user,
        color: 0x23a55a,
      });
      return ephemeral(interaction, `Timeout für ${member} aufgehoben.`);
    }

    const input = interaction.options.getString('dauer');
    const ms = parseDuration(input);
    if (!ms || ms > MAX_TIMEOUT) return ephemeral(interaction, 'Ungültige Dauer. Beispiele: 10m, 2h, 1d (max. 28d).');

    const reason = interaction.options.getString('grund') ?? 'Kein Grund angegeben';
    await member.timeout(ms, `${reason} (durch ${interaction.user.tag})`);
    await modlog(interaction.guild, {
      action: 'Timeout',
      target: member.user,
      moderator: interaction.user,
      reason,
      color: 0xf0b232,
      fields: [{ name: 'Dauer', value: input, inline: true }],
    });
    return ephemeral(interaction, `${member} ist für ${input} im Timeout.`);
  },
};
