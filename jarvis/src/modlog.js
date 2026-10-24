const { EmbedBuilder, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { stmts } = require('./db');
const { logger, who } = require('./log');

const log = logger('modlog');
const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

/** "View Channel, Send Messages" from permission flags. */
function permissionNames(flags) {
  return new PermissionsBitField(flags).toArray().map((name) => name.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', ');
}

/**
 * Posts an entry to the server's mod log channel, if one is set.
 * Errors are only logged so a moderation action never fails because of the log.
 */
async function modlog(guild, { action, target, moderator, reason, color = 0x5865f2, fields = [] }) {
  const settings = stmts.getSettings.get(guild.id);
  if (!settings?.modlog_channel_id) return;

  const id = settings.modlog_channel_id;
  // The cache knows every channel of the server, also those Jarvis may not see; fetching those fails with Missing Access.
  const channel = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
  if (!channel) {
    log.warn(`Mod log channel ${id} in ${who(guild)} was not found (deleted?). Set a new one with /config.`);
    return;
  }
  if (!channel.isTextBased()) {
    log.warn(`Mod log channel ${who(channel)} in ${who(guild)} is not a text channel. Set a new one with /config.`);
    return;
  }
  const missing = channel.permissionsFor(guild.members.me)?.missing(NEEDED) ?? NEEDED;
  if (missing.length) {
    log.warn(
      `Cannot post "${action}" in mod log channel ${who(channel)} on ${who(guild)}: Jarvis is missing ${permissionNames(missing)} there. ` +
        'Allow it in the channel settings (Permissions) for the Jarvis role, or pick another channel with /config.',
    );
    return;
  }

  try {
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
    log.warn(`Could not post "${action}" in mod log channel ${who(channel)} on ${who(guild)}`, err);
  }
}

module.exports = { modlog };
