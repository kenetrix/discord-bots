const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { cleanChannel } = require('../cleanup');
const { modlog } = require('../modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Die letzten Nachrichten im aktuellen Kanal löschen')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((o) =>
      o.setName('anzahl').setDescription('Wie viele Nachrichten (1 bis 500)').setRequired(true).setMinValue(1).setMaxValue(500),
    )
    .addUserOption((o) => o.setName('nutzer').setDescription('Nur Nachrichten dieses Nutzers'))
    .addBooleanOption((o) => o.setName('angepinnte_behalten').setDescription('Angepinnte behalten (Standard: ja)')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const amount = interaction.options.getInteger('anzahl');
    const user = interaction.options.getUser('nutzer');

    const { deleted, skippedOld } = await cleanChannel(interaction.channel, {
      limit: amount,
      userId: user?.id,
      keepPinned: interaction.options.getBoolean('angepinnte_behalten') ?? true,
      maxScan: user ? 2000 : amount + 100,
      allowOld: false,
    });

    await modlog(interaction.guild, {
      action: 'Purge',
      moderator: interaction.user,
      fields: [
        { name: 'Kanal', value: `${interaction.channel}`, inline: true },
        { name: 'Gelöscht', value: String(deleted), inline: true },
        ...(user ? [{ name: 'Nur von', value: `${user}`, inline: true }] : []),
      ],
    });

    const note = skippedOld ? ` ${skippedOld} Nachricht(en) älter als 14 Tage übersprungen, dafür ist /cleaner gedacht.` : '';
    return interaction.editReply(`${deleted} Nachricht(en) gelöscht.${note}`);
  },
};
