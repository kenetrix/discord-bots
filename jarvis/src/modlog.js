const { EmbedBuilder } = require('discord.js');
const { stmts } = require('./db');

/**
 * Posts an entry to the server's mod log channel, if one is set.
 * Errors are only logged so a moderation action never fails because of the log.
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
        ...(target ? [{ name: 'Member', value: `${target} (${target.id})`, inline: true }] : []),
        { name: 'Moderator', value: `${moderator}`, inline: true },
        ...(reason ? [{ name: 'Reason', value: reason }] : []),
        ...fields,
      );
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.warn(`Mod log failed in ${guild.id}:`, err.message);
  }
}

module.exports = { modlog };
