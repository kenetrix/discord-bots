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
  .setDescription('Panel mit Buttons posten, über die sich Mitglieder Rollen selbst geben')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .setDMPermission(false)
  .addStringOption((o) => o.setName('titel').setDescription('Überschrift des Panels').setRequired(true))
  .addRoleOption((o) => o.setName('rolle1').setDescription('Rolle 1').setRequired(true));
for (let i = 2; i <= MAX_ROLES; i++) {
  data.addRoleOption((o) => o.setName(`rolle${i}`).setDescription(`Rolle ${i}`));
}
data
  .addStringOption((o) => o.setName('text').setDescription('Beschreibung unter dem Titel'))
  .addChannelOption((o) =>
    o
      .setName('kanal')
      .setDescription('Kanal für das Panel (Standard: aktueller Kanal)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

module.exports = {
  data,

  async execute(interaction) {
    const roles = [];
    for (let i = 1; i <= MAX_ROLES; i++) {
      const role = interaction.options.getRole(`rolle${i}`);
      if (role && !roles.some((r) => r.id === role.id)) roles.push(role);
    }
    for (const role of roles) {
      const problem = checkRole(interaction, role);
      if (problem) return ephemeral(interaction, problem);
    }

    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    const embed = new EmbedBuilder()
      .setTitle(interaction.options.getString('titel'))
      .setDescription(
        interaction.options.getString('text') ?? 'Klicke auf einen Button, um die Rolle zu erhalten oder wieder abzugeben.',
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
    return ephemeral(interaction, `Panel in ${channel} gepostet.`);
  },

  /** Button click: toggle the role. The role id is encoded in the customId, so no DB is needed. */
  async handleButton(interaction) {
    if (!interaction.customId.startsWith(PREFIX)) return false;
    const role = interaction.guild.roles.cache.get(interaction.customId.slice(PREFIX.length));
    if (!role) {
      await ephemeral(interaction, 'Diese Rolle gibt es nicht mehr.');
      return true;
    }
    // Only the bot's hierarchy matters here; the member needs no permissions.
    if (role.position >= interaction.guild.members.me.roles.highest.position || role.managed) {
      await ephemeral(interaction, `Ich kann ${role} nicht vergeben. Bitte wende dich an die Moderation.`);
      return true;
    }

    const member = interaction.member;
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Rollen-Panel');
      await ephemeral(interaction, `${role} entfernt.`);
    } else {
      await member.roles.add(role, 'Rollen-Panel');
      await ephemeral(interaction, `${role} erhalten.`);
    }
    return true;
  },
};
