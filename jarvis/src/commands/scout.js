const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { REGIONS, parseRiotId, opggUrl, getPlayer, getCounters, getRolePools, getChampionTags } = require('../scout/opgg');
const { recommendBans, predictPicks, playerThreats, suggestComp, suggestFlexCounters, gamePlan } = require('../scout/analysis');

const PLAYER_OPTIONS = ['player1', 'player2', 'player3', 'player4', 'player5'];
const DEFAULT_REGION = (process.env.SCOUT_REGION || 'EUW').toUpperCase();
const COOLDOWN_MS = 60e3; // per user, so one person cannot flood OP.GG
const lastScout = new Map(); // user id -> time of their last scout
const running = new Set(); // guild ids with a scout in progress

const ROLE_LABEL = { TOP: 'Top', JUNGLE: 'Jungle', MID: 'Mid', ADC: 'ADC', SUPPORT: 'Support' };

/** What went wrong for one player, in words a user can act on. */
function failureReason(err, region) {
  if (err.triedTags) return `no player with this name and tag ${err.triedTags.map((t) => `#${t}`).join(', ')} in ${region}. Add the tag (Name#TAG).`;
  if (err.kind === 'not_found') return `not found on OP.GG (${region}). Check the name, the tag and the region.`;
  if (err.kind === 'rate_limited') return 'OP.GG is limiting requests right now.';
  if (err.kind === 'unavailable') return 'OP.GG did not answer.';
  console.warn('Scout lookup failed:', err.message);
  return 'OP.GG could not look this player up.';
}

/** The reply when nobody could be scouted: one cause for all players if they share it, else the list. */
function nobodyFound(errors, failed) {
  if (errors.every((e) => e.kind === 'rate_limited')) return 'OP.GG is limiting requests right now. Try again in a minute.';
  if (errors.every((e) => e.kind === 'unavailable')) return 'OP.GG is not reachable right now. Try again in a few minutes.';
  return `Could not scout anyone.\n${failed.join('\n')}`;
}

const ROLE_ORDER = Object.keys(ROLE_LABEL);
const ROLE_ICON = { TOP: '⛰️', JUNGLE: '🌲', MID: '✨', ADC: '🏹', SUPPORT: '🛡️' };

const escapeMarkdown = (text) => text.replace(/[\\[\]()*_~`|>]/g, '\\$&');

/** "MASTER 26 LP, 51 % WR" -> "Master 26 LP": the rank without the record, which the report leaves out. */
function shortRank(rank) {
  if (!rank) return 'Unranked';
  const [tier, ...rest] = rank.split(',')[0].split(' ');
  return [tier.charAt(0) + tier.slice(1).toLowerCase(), ...rest].join(' ');
}

const link = (player, region) =>
  `[${escapeMarkdown(player.riotId)}](${opggUrl(player.riotId, region)})${player.guessedTag ? '\\*' : ''}`;

/** Five dots, filled in proportion to the player's threat compared with the most dangerous enemy. */
function threatDots(score, max) {
  const filled = max ? Math.max(1, Math.round((score / max) * 5)) : 0;
  return '●'.repeat(filled) + '○'.repeat(5 - filled);
}

/** One card per enemy: link, rank, main pool and second role. */
function playerCard(player, pick, threat, maxThreat, region) {
  const pool = [...player.champions]
    .sort((a, b) => b.games - a.games)
    .slice(0, 3)
    .map((c) => c.name)
    .join(' · ');
  const second = pick.second
    ? `2nd: ${ROLE_ICON[pick.second.role]} ${ROLE_LABEL[pick.second.role]}${pick.second.champion ? ` (${pick.second.champion})` : ''}`
    : '2nd: none';
  return {
    name: `${ROLE_ICON[pick.role] ?? ''} ${ROLE_LABEL[pick.role] ?? '?'}  ${threatDots(threat?.score ?? 0, maxThreat)}`,
    value: [link(player, region), shortRank(player.rank), pool || 'no ranked games', second].join('\n'),
    inline: true,
  };
}

const cell = (text, width) => {
  const value = text ?? '-';
  return (value.length > width ? `${value.slice(0, width - 1)}…` : value).padEnd(width);
};

/** The draft as an aligned table: enemy pick, our counter and an alternative per role. */
function draftTable(comp) {
  const rows = comp.map((c) => `${cell(ROLE_LABEL[c.role], 8)}${cell(c.against, 12)}${cell(c.pick?.name, 12)}${c.alternative?.name ?? '-'}`);
  return ['```', `${cell('Role', 8)}${cell('Enemy', 12)}${cell('Counter', 12)}Alt`, ...rows, '```'].join('\n');
}

function summary({ region, players, picks, flex, plan, threats }) {
  const byId = new Map(players.map((p) => [p.riotId, p]));
  const lines = [];
  const top = [...threats.values()].sort((a, b) => b.score - a.score)[0];
  if (top) lines.push(`🎯 Biggest threat: ${link(byId.get(top.player), region)} on **${top.champion}** (${top.games} games, ${top.winRate} % WR)`);
  for (const f of flex) {
    const role = `${ROLE_ICON[f.role]} ${ROLE_LABEL[f.role]}`;
    const counter = f.pick ? `, answer with **${f.pick.name}**` : '';
    lines.push(`🔁 ${link(byId.get(f.player), region)} can swap to ${role} (${f.against})${counter}`);
  }
  const noSecond = picks.filter((p) => !p.second).length;
  if (noSecond) lines.push(`📌 ${noSecond} of ${picks.length} play only one role: their bans hit harder.`);
  lines.push(...plan.slice(0, 2).map((p) => `💡 ${p}`));
  // Embed field values hold at most 1024 characters; drop lines from the end rather than cut a link.
  while (lines.join('\n').length > 1024) lines.pop();
  return lines.join('\n');
}

function buildEmbed({ region, players, picks, failed, bans, alternatives, comp, flex, plan, threats }) {
  const pickOf = new Map(picks.map((p) => [p.player, p]));
  const byRole = [...players].sort((a, b) => ROLE_ORDER.indexOf(pickOf.get(a.riotId).role) - ROLE_ORDER.indexOf(pickOf.get(b.riotId).role));
  const maxThreat = Math.max(0, ...[...threats.values()].map((t) => t.score));
  const banList = bans.map((b) => `**${b.champion}**`).join(' · ') || 'not enough data';
  const backup = alternatives.length ? `\n↪️ Backup: ${alternatives.map((b) => b.champion).join(' · ')}` : '';

  const embed = new EmbedBuilder()
    .setTitle(`🔍 Clash scout · ${region}`)
    .setColor(0xc89b3c)
    .setDescription(`🚫 **Ban:** ${banList}${backup}`)
    .addFields(byRole.map((p) => playerCard(p, pickOf.get(p.riotId), threats.get(p.riotId), maxThreat, region)))
    .addFields({ name: '⚔️ Draft', value: draftTable(comp) }, { name: '📋 Summary', value: summary({ region, players, picks, flex, plan, threats }) });
  if (failed.length) embed.addFields({ name: 'Not scouted', value: failed.join('\n').slice(0, 1024) });
  const guessed = players.some((p) => p.guessedTag) ? ' · * tag guessed' : '';
  return embed.setFooter({ text: `OP.GG · ● threat compared with the others${guessed}` }).setTimestamp();
}

/** Looks the players up and posts the report. */
async function scout(interaction, ids, region) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [results, rolePools] = await Promise.all([Promise.allSettled(ids.map((id) => getPlayer(id, region))), getRolePools()]);
  const players = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
  const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${ids[i]}: ${failureReason(r.reason, region)}`] : []));
  if (!players.length) return interaction.editReply(nobodyFound(errors, failed));

  const { bans, alternatives } = recommendBans(players);
  const banned = new Set(bans.map((b) => b.champion));
  const picks = predictPicks(players, banned, rolePools);
  const [comp, tags] = await Promise.all([
    suggestComp(picks, banned, getCounters, rolePools),
    getChampionTags(picks.map((p) => p.champion).filter(Boolean)),
  ]);
  const flex = await suggestFlexCounters(picks, banned, comp, getCounters, rolePools);
  const plan = gamePlan(picks, (name) => tags.get(name));
  const threats = playerThreats(players);
  const embed = buildEmbed({ region, players, picks, failed, bans, alternatives, comp, flex, plan, threats });

  // Post into the text chat of the caller's voice channel, so the whole team sees it; else into this channel.
  const voice = interaction.member.voice?.channel;
  const canPost = voice
    ?.permissionsFor(interaction.guild.members.me)
    .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  const target = canPost ? voice : interaction.channel;
  await target.send({ content: `Scouting report requested by ${interaction.user}`, embeds: [embed], allowedMentions: { parse: [] } });

  const where = voice && !canPost ? ` I may not write in ${voice}, so I posted it here.` : '';
  return interaction.editReply(`Posted the report in ${target}.${where}`);
}

module.exports = {
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('scout')
      .setDescription('Scout a Clash enemy team and post ban and pick advice in your voice channel')
      .setDMPermission(false);
    PLAYER_OPTIONS.forEach((name, i) =>
      builder.addStringOption((o) => o.setName(name).setDescription(`Riot ID of enemy ${i + 1}, e.g. Name#EUW (tag optional)`).setRequired(i === 0).setMaxLength(30)),
    );
    builder.addStringOption((o) =>
      o
        .setName('region')
        .setDescription(`Server of the players (default: ${DEFAULT_REGION})`)
        .addChoices(...REGIONS.map((r) => ({ name: r, value: r }))),
    );
    return builder;
  })(),

  async execute(interaction) {
    const ids = PLAYER_OPTIONS.map((name) => interaction.options.getString(name)).filter(Boolean);
    const invalid = ids.filter((id) => !parseRiotId(id));
    if (invalid.length) {
      return interaction.reply({ content: `Not a Riot ID like Name#TAG or a name of 3 to 16 characters: ${invalid.join(', ')}`, flags: MessageFlags.Ephemeral });
    }
    const region = interaction.options.getString('region') ?? DEFAULT_REGION;

    const wait = (lastScout.get(interaction.user.id) ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) {
      return interaction.reply({ content: `You can scout again in ${Math.ceil(wait / 1e3)} s.`, flags: MessageFlags.Ephemeral });
    }
    if (running.has(interaction.guildId)) {
      return interaction.reply({ content: 'A scout is already running on this server. Try again in a few seconds.', flags: MessageFlags.Ephemeral });
    }
    running.add(interaction.guildId);
    lastScout.set(interaction.user.id, Date.now());
    try {
      return await scout(interaction, ids, region);
    } finally {
      running.delete(interaction.guildId);
    }
  },
};
