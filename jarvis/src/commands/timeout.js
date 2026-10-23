const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ephemeral, checkHierarchy, parseDuration } = require('../util');
const { modlog } = require('../modlog');

const MAX_TIMEOUT = 28 * 864e5; // Discord limit: 28 days

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Time out a member or lift a timeout')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Set a timeout')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) =>
          o.setName('duration').setDescription('e.g. 10m, 2h, 1d (max. 28d)').setRequired(true),
        )
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Lift a timeout')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.options.getMember('member');
    if (!member) return ephemeral(interaction, 'This member is not on the server.');

    const problem = checkHierarchy(interaction, member);
    if (problem) return ephemeral(interaction, problem);

    if (sub === 'remove') {
      if (!member.isCommunicationDisabled()) return ephemeral(interaction, `${member} is not timed out.`);
      await member.timeout(null, `Lifted by ${interaction.user.tag}`);
      await modlog(interaction.guild, {
        action: 'Timeout lifted',
        target: member.user,
        moderator: interaction.user,
        color: 0x23a55a,
      });
      return ephemeral(interaction, `Lifted the timeout for ${member}.`);
    }

    const input = interaction.options.getString('duration');
    const ms = parseDuration(input);
    if (!ms || ms > MAX_TIMEOUT) return ephemeral(interaction, 'Invalid duration. Examples: 10m, 2h, 1d (max. 28d).');

    const reason = interaction.options.getString('reason') ?? 'No reason given';
    await member.timeout(ms, `${reason} (by ${interaction.user.tag})`);
    await modlog(interaction.guild, {
      action: 'Timeout',
      target: member.user,
      moderator: interaction.user,
      reason,
      color: 0xf0b232,
      fields: [{ name: 'Duration', value: input, inline: true }],
    });
    return ephemeral(interaction, `${member} is timed out for ${input}.`);
  },
};
