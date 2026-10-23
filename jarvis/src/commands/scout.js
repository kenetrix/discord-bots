const { randomUUID } = require('node:crypto');
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { REGIONS, parseRiotId, getPlayer, getCounters, getRolePools, getChampionTags } = require('../scout/opgg');
const { recommendBans, predictPicks, playerThreats, suggestComp, suggestFlexCounters, gamePlan } = require('../scout/analysis');
const { buildReport, overview, render, parseButton } = require('../scout/report');
const { TtlCache } = require('../scout/cache');

const PLAYER_OPTIONS = ['player1', 'player2', 'player3', 'player4', 'player5'];
const DEFAULT_REGION = (process.env.SCOUT_REGION || 'EUW').toUpperCase();
const COOLDOWN_MS = 60e3; // per user, so one person cannot flood OP.GG
const lastScout = new Map(); // user id -> time of their last scout
const running = new Set(); // guild ids with a scout in progress

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

// Reports stay clickable for three hours; after that the buttons answer that the report expired.
const reports = new TtlCache(3 * 60 * 60e3, 100);

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
  const id = randomUUID().slice(0, 8);
  const report = buildReport({ id, region, players, picks, comp, flex, threats, bans, alternatives, plan, failed });
  reports.get(id, () => report);

  // Post into the text chat of the caller's voice channel, so the whole team sees it; else into this channel.
  const voice = interaction.member.voice?.channel;
  const canPost = voice
    ?.permissionsFor(interaction.guild.members.me)
    .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  const target = canPost ? voice : interaction.channel;
  await target.send({ content: `Scouting report requested by ${interaction.user}`, ...overview(report), allowedMentions: { parse: [] } });

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

  // A button on the team's report opens the view just for the clicker; buttons in that view switch it in place.
  async handleButton(interaction) {
    const button = parseButton(interaction.customId);
    if (!button) return false;
    const report = await reports.peek(button.id);
    const view = report && render(report, button.view);
    if (!view) {
      await interaction.reply({ content: 'This report has expired. Run /scout again.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.update(view);
    else await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
    return true;
  },
};
