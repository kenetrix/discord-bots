const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');
const { ephemeral, checkRole } = require('../util');

const MAX_ROLES = 10;
const PREFIX = 'rolepanel:';

const data = new SlashCommandBuilder()
  .setName('rolepanel')
  .setDescription('Post a panel with buttons that let members assign roles to themselves')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .setDMPermission(false)
  .addStringOption((o) => o.setName('title').setDescription('Panel heading').setRequired(true))
  .addRoleOption((o) => o.setName('role1').setDescription('Role 1').setRequired(true));
for (let i = 2; i <= MAX_ROLES; i++) {
  data.addRoleOption((o) => o.setName(`role${i}`).setDescription(`Role ${i}`));
}
data
  .addStringOption((o) => o.setName('text').setDescription('Description below the title'))
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Channel for the panel (default: current channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

module.exports = {
  data,

  async execute(interaction) {
    const roles = [];
    for (let i = 1; i <= MAX_ROLES; i++) {
      const role = interaction.options.getRole(`role${i}`);
      if (role && !roles.some((r) => r.id === role.id)) roles.push(role);
    }
    for (const role of roles) {
      const problem = checkRole(interaction, role);
      if (problem) return ephemeral(interaction, problem);
    }

    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const embed = new EmbedBuilder()
      .setTitle(interaction.options.getString('title'))
      .setDescription(
        interaction.options.getString('text') ?? 'Click a button to get the role or give it back.',
      )
      .setColor(0x5865f2);

    const rows = [];
    for (let i = 0; i < roles.length; i += 5) {
      rows.push(
        new ActionRowBuilder().addComponents(
          roles
            .slice(i, i + 5)
            .map((role) =>
              new ButtonBuilder().setCustomId(PREFIX + role.id).setLabel(role.name).setStyle(ButtonStyle.Secondary),
            ),
        ),
      );
    }

    await channel.send({ embeds: [embed], components: rows });
    return ephemeral(interaction, `Panel posted in ${channel}.`);
  },

  /** Button click: toggle the role. The role id is encoded in the customId, so no DB is needed. */
  async handleButton(interaction) {
    if (!interaction.customId.startsWith(PREFIX)) return false;
    const role = interaction.guild.roles.cache.get(interaction.customId.slice(PREFIX.length));
    if (!role) {
      await ephemeral(interaction, 'This role no longer exists.');
      return true;
    }
    // Only the bot's hierarchy matters here; the member needs no permissions.
    if (role.position >= interaction.guild.members.me.roles.highest.position || role.managed) {
      await ephemeral(interaction, `I cannot assign ${role}. Please contact the moderators.`);
      return true;
    }

    const member = interaction.member;
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Role panel');
      await ephemeral(interaction, `Removed ${role}.`);
    } else {
      await member.roles.add(role, 'Role panel');
      await ephemeral(interaction, `Got ${role}.`);
    }
    return true;
  },
};
