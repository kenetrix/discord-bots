const { EmbedBuilder } = require('discord.js');
const { stmts } = require('./db');

/**
 * Schreibt einen Eintrag in den Mod-Log-Kanal des Servers, falls einer gesetzt ist.
 * Fehler werden nur geloggt, damit eine Moderationsaktion nie am Log scheitert.
 */
async function modlog(guild, { action, target, moderator, reason, color = 0x5865f2, fields = [] }) {
  const settings = stmts.getSettings.get(guild.id);
  if (!settings?.modlog_channel_id) return;

  try {
    const channel = await guild.channels.fetch(settings.modlog_channel_id);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(action)
      .setColor(color)
      .setTimestamp()
      .addFields(
        ...(target ? [{ name: 'Mitglied', value: `${target} (${target.id})`, inline: true }] : []),
        { name: 'Moderator', value: `${moderator}`, inline: true },
        ...(reason ? [{ name: 'Grund', value: reason }] : []),
        ...fields,
      );
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.warn(`Mod-Log fehlgeschlagen in ${guild.id}:`, err.message);
  }
}

module.exports = { modlog };
