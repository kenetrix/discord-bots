const { MessageFlags, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

/** What the bot needs to post log embeds in a channel. */
const POST_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

/** Replies visibly only to the user who ran the command. */
function ephemeral(interaction, content) {
  const payload = typeof content === 'string' ? { content } : content;
  const reply = { ...payload, flags: MessageFlags.Ephemeral };
  return interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(reply);
}

/**
 * Checks whether moderator and bot may act on a member (role hierarchy).
 * Returns an error message, or null if everything is fine.
 */
function checkHierarchy(interaction, member) {
  const me = interaction.guild.members.me;
  if (member.id === interaction.user.id) return 'You cannot moderate yourself.';
  if (member.id === interaction.guild.ownerId) return 'The server owner cannot be moderated.';
  if (member.id === me.id) return 'I cannot moderate myself.';
  const isOwner = interaction.user.id === interaction.guild.ownerId;
  if (!isOwner && member.roles.highest.position >= interaction.member.roles.highest.position) {
    return 'This member has a role equal to or higher than yours.';
  }
  if (member.roles.highest.position >= me.roles.highest.position) {
    return 'My highest role is not above this member\'s highest role.';
  }
  return null;
}

/** Checks whether the bot (and the moderator) may assign a role. */
function checkRole(interaction, role) {
  const me = interaction.guild.members.me;
  if (role.managed) return `${role} is managed by an integration and cannot be assigned.`;
  if (role.id === interaction.guild.id) return '@everyone cannot be assigned.';
  if (role.position >= me.roles.highest.position) return `${role} is above my highest role.`;
  const isOwner = interaction.user.id === interaction.guild.ownerId;
  if (interaction.member && !isOwner && role.position >= interaction.member.roles.highest.position) {
    return `${role} is above your highest role.`;
  }
  return null;
}

/** Parses durations like "10m", "2h", "1d", "1w" into milliseconds. */
function parseDuration(input) {
  const match = /^(\d+)\s*([smhdw])$/i.exec(input.trim());
  if (!match) return null;
  const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[match[2].toLowerCase()];
  return Number(match[1]) * unit;
}

/** The permissions the bot lacks in a channel, as readable names ("View Channel, Send Messages"); empty if none. */
function missingPermissions(channel, permissions = POST_PERMISSIONS) {
  const have = channel.permissionsFor(channel.guild.members.me);
  const missing = have ? have.missing(permissions) : new PermissionsBitField(permissions).toArray();
  return missing.map((name) => name.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', ');
}

module.exports = { POST_PERMISSIONS, missingPermissions, ephemeral, checkHierarchy, checkRole, parseDuration };
