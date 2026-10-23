const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { REGIONS, parseRiotId, opggUrl, getPlayer, getCounters, getRolePools, getChampionTags } = require('../scout/opgg');
const { recommendBans, predictPicks, suggestComp, gamePlan } = require('../scout/analysis');

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

const escapeMarkdown = (text) => text.replace(/[\\[\]()*_~`|>]/g, '\\$&');

/** "MASTER 26 LP, 51 % WR" -> "Master 26 LP": the rank without the record, which the report leaves out. */
function shortRank(rank) {
  if (!rank) return 'Unranked';
  const [tier, ...rest] = rank.split(',')[0].split(' ');
  return [tier.charAt(0) + tier.slice(1).toLowerCase(), ...rest].join(' ');
}

/** Two lines per player: role, linked name and rank, then the three most played champions. */
function playerLine(player, role, region) {
  const pool = [...player.champions]
    .sort((a, b) => b.games - a.games)
    .slice(0, 3)
    .map((c) => `${c.name} ${c.games}`)
    .join(' · ');
  const name = `[${escapeMarkdown(player.riotId)}](${opggUrl(player.riotId, region)})${player.guessedTag ? '\\*' : ''}`;
  return `**${ROLE_LABEL[role] ?? '?'}** · ${name} · ${shortRank(player.rank)}\n└ ${pool || 'no ranked games this season'}`;
}

function compLine(c) {
  const role = `**${ROLE_LABEL[c.role]}**`;
  if (!c.pick) return `${role} no counter data${c.against ? ` vs ${c.against}` : ''}`;
  return `${role} ${c.pick.name}${c.alternative ? ` or ${c.alternative.name}` : ''} *vs ${c.against}*`;
}

function buildEmbed({ region, players, picks, failed, bans, alternatives, comp, plan }) {
  const roleOf = new Map(picks.map((p) => [p.player, p.role]));
  const byRole = [...players].sort((a, b) => ROLE_ORDER.indexOf(roleOf.get(a.riotId)) - ROLE_ORDER.indexOf(roleOf.get(b.riotId)));
  const banList = bans.map((b) => `**${b.champion}**`).join(' · ') || 'not enough data';
  const backup = alternatives.length ? `\nBackup: ${alternatives.map((b) => b.champion).join(' · ')}` : '';

  const embed = new EmbedBuilder()
    .setTitle(`Clash scout · ${region}`)
    .setColor(0xc89b3c)
    .setDescription(`🚫 Ban: ${banList}${backup}`)
    .addFields(
      { name: 'Enemy team', value: byRole.map((p) => playerLine(p, roleOf.get(p.riotId), region)).join('\n') },
      { name: 'Pick against them', value: comp.map(compLine).join('\n') },
    );
  if (plan.length) embed.addFields({ name: 'Game plan', value: plan.slice(0, 2).map((p) => `• ${p}`).join('\n') });
  if (failed.length) embed.addFields({ name: 'Not scouted', value: failed.join('\n').slice(0, 1024) });
  const guessed = players.some((p) => p.guessedTag) ? ' · * tag guessed' : '';
  return embed.setFooter({ text: `OP.GG · numbers are ranked games this season${guessed}` }).setTimestamp();
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
  const plan = gamePlan(picks, (name) => tags.get(name));
  const embed = buildEmbed({ region, players, picks, failed, bans, alternatives, comp, plan });

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
