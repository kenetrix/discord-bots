const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { REGIONS, parseRiotId, getPlayer, getCounters, getRolePools, getChampionTags } = require('../scout/opgg');
const { recommendBans, predictPicks, suggestComp, gamePlan } = require('../scout/analysis');

const PLAYER_OPTIONS = ['player1', 'player2', 'player3', 'player4', 'player5'];
const DEFAULT_REGION = (process.env.SCOUT_REGION || 'EUW').toUpperCase();
const ROLE_LABEL = { TOP: 'Top', JUNGLE: 'Jungle', MID: 'Mid', ADC: 'ADC', SUPPORT: 'Support' };

/** What went wrong for one player, in words a user can act on. */
function failureReason(err, region) {
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

function playerLine(player, role) {
  const pool = [...player.champions]
    .sort((a, b) => b.games - a.games)
    .slice(0, 3)
    .map((c) => `${c.name} ${c.games}g/${Math.round((c.wins / c.games) * 100)}%`)
    .join(', ');
  return `**${player.riotId}** (${ROLE_LABEL[role] ?? '?'}, ${player.rank ?? 'unranked'})\n${pool || 'No recent games'}`;
}

function buildEmbed({ region, players, picks, failed, bans, alternatives, comp, plan }) {
  const roleOf = new Map(picks.map((p) => [p.player, p.role]));
  const banLine = (b, i) => `${i + 1}. **${b.champion}** (${b.player}: ${b.games} games, ${b.winRate} % WR)`;
  const compLine = (c) => {
    if (!c.pick) return `${ROLE_LABEL[c.role]}: no counter data${c.against ? ` vs ${c.against}` : ''}`;
    const alt = c.alternative ? `, alt. ${c.alternative.name}` : '';
    return `${ROLE_LABEL[c.role]}: **${c.pick.name}**${alt} (vs ${c.against})`;
  };

  const embed = new EmbedBuilder()
    .setTitle('Clash scouting report')
    .setColor(0xc89b3c)
    .addFields(
      { name: 'Enemy team', value: players.map((p) => playerLine(p, roleOf.get(p.riotId))).join('\n') },
      { name: 'Ban these', value: bans.map(banLine).join('\n') || 'Not enough data' },
    )
    .setFooter({ text: `Data: OP.GG (${region}). Ranked games of this season; draft carefully.` })
    .setTimestamp();
  if (alternatives.length) {
    embed.addFields({ name: 'Alternative bans', value: alternatives.map((b) => `**${b.champion}** (${b.player})`).join(', ') });
  }
  embed.addFields({ name: 'Suggested team', value: comp.map(compLine).join('\n') });
  if (plan.length) embed.addFields({ name: 'Game plan', value: plan.map((p) => `- ${p}`).join('\n') });
  if (failed.length) embed.addFields({ name: 'Not scouted', value: failed.join('\n') });
  return embed;
}

module.exports = {
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('scout')
      .setDescription('Scout a Clash enemy team and post ban and pick advice in your voice channel')
      .setDMPermission(false);
    PLAYER_OPTIONS.forEach((name, i) =>
      builder.addStringOption((o) => o.setName(name).setDescription(`Riot ID of enemy ${i + 1}, e.g. Name#EUW`).setRequired(i === 0).setMaxLength(30)),
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
      return interaction.reply({ content: `Not a Riot ID like Name#TAG: ${invalid.join(', ')}`, flags: MessageFlags.Ephemeral });
    }
    const region = interaction.options.getString('region') ?? DEFAULT_REGION;
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
  },
};
