// Builds the /scout messages: a compact overview for the whole team and detail views behind buttons.
// Cards and detail views use the same building blocks (header, pool, matchup), the detail view just shows more.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { opggUrl } = require('./opgg');

const PREFIX = 'scout:';
const ROLE_LABEL = { TOP: 'Top', JUNGLE: 'Jungle', MID: 'Mid', ADC: 'ADC', SUPPORT: 'Support' };
const ROLE_ICON = { TOP: '🏝️', JUNGLE: '🌲', MID: '✨', ADC: '🏹', SUPPORT: '🛡️' };
const ROLE_ORDER = Object.keys(ROLE_LABEL);
const COLOR = 0xc89b3c;
const LEGEND = '🚫 = we ban it · ➜ = likely pick after our bans';

const escapeMarkdown = (text) => text.replace(/[\\[\]()*_~`|>]/g, '\\$&');
const role = (r) => `${ROLE_ICON[r] ?? ''} ${ROLE_LABEL[r] ?? '?'}`;
const winRate = (c) => (c.games ? Math.round((c.wins / c.games) * 100) : 0);

/** "MASTER 26 LP, 51 % WR" -> "Master 26 LP": the rank without the record. */
function shortRank(rank) {
  if (!rank) return 'Unranked';
  const [tier, ...rest] = rank.split(',')[0].split(' ');
  return [tier.charAt(0) + tier.slice(1).toLowerCase(), ...rest].join(' ');
}

/** "Master 26 LP · 51 % WR", or "Unranked". */
const rankLine = (rank) => [shortRank(rank), rank?.split(', ')[1]].filter(Boolean).join(' · ');

const THREAT_LABEL = { high: '🔴 High threat', medium: '🟠 Medium threat', low: '🟢 Low threat' };

/** "Platinum IV · best on Syndra (25 games, 40 %)": what the threat level is based on. */
function threatReason(threat, rank) {
  const base = threat?.ranked ? shortRank(rank).replace(/ \d+ LP$/, '') : 'unranked';
  return threat?.champion ? `${base} · best on ${threat.champion} (${threat.games} games, ${threat.winRate} %)` : base;
}

/**
 * The champion pool in one line or one line per champion: champions we ban are marked with 🚫 and
 * the likely pick after the bans is marked, so both read as one list. A likely pick from recent games
 * that is not in the season pool is added at the end.
 */
function poolText(champions, banned, likely, { limit, stats }) {
  const shown = champions.slice(0, limit);
  if (likely && !shown.some((c) => c.name === likely)) {
    shown.push(champions.find((c) => c.name === likely) ?? { name: likely, games: 0, wins: 0, recent: true });
  }
  const entries = shown.map((c) => {
    const name = banned.has(c.name) ? `🚫 ${c.name}` : c.name === likely ? `➜ **${c.name}**` : c.name;
    if (!stats) return name;
    return c.recent ? `${name} (recent games)` : `${name} · ${c.games} games · ${winRate(c)} %`;
  });
  if (!entries.length) return 'no ranked games this season';
  return entries.join(stats ? '\n' : ' · ');
}

/** "➜ Veigar · our pick LeBlanc or Syndra", or what is known when data is missing. */
function matchupText(likely, pick, alternative) {
  if (!likely) return 'no pick predicted';
  if (!pick) return `➜ **${likely}** · no counter data`;
  return `➜ **${likely}** · our pick **${pick}**${alternative ? ` or ${alternative}` : ''}`;
}

/**
 * Puts the analysis into one object per enemy, sorted by role, so every view reads from the same place.
 * `players`, `picks`, `comp` and `flex` are the outputs of opgg.js and analysis.js.
 */
function buildReport({ id, region, players, picks, comp, flex, threats, priority = [], bans, alternatives, plan, failed }) {
  const enemies = players
    .map((player) => {
      const pick = picks.find((p) => p.player === player.riotId);
      return {
        player: { ...player, champions: [...player.champions].sort((a, b) => b.games - a.games) },
        role: pick.role,
        champion: pick.champion,
        counter: comp.find((c) => c.role === pick.role) ?? null,
        second: pick.second,
        flex: flex.find((f) => f.player === player.riotId) ?? null,
        threat: THREAT_LABEL[threats.get(player.riotId)?.level ?? 'low'],
        threatReason: threatReason(threats.get(player.riotId), player.rank),
      };
    })
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  return { id, region, enemies, banned: new Set(bans.map((b) => b.champion)), priority, bans, alternatives, plan, failed };
}

function buttons(report, { back = false } = {}) {
  const players = new ActionRowBuilder().addComponents(
    report.enemies.map((e, i) =>
      new ButtonBuilder()
        .setCustomId(`${PREFIX}${report.id}:p${i}`)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(ROLE_ICON[e.role] ?? '❔')
        .setLabel(e.player.riotId.split('#')[0].slice(0, 20)),
    ),
  );
  const more = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}${report.id}:bans`).setStyle(ButtonStyle.Primary).setEmoji('🚫').setLabel('Bans'),
  );
  if (back) {
    more.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}${report.id}:back`).setStyle(ButtonStyle.Secondary).setEmoji('◀️').setLabel('Overview'));
  }
  return [players, more];
}

/** Players that could not be scouted, named first so nobody misses them. */
const notScouted = (failed) => (failed.length ? `⚠️ **Not scouted:**\n${failed.map((f) => `• ${f}`).join('\n')}\n\n` : '');

/** One lane: who we face there, which of our bans are aimed at them and what our player there should pick. */
function laneField(e, report) {
  const name = `${escapeMarkdown(e.player.riotId.split('#')[0])}${e.player.guessedTag ? '*' : ''}`;
  const mine = (list) => list.filter((b) => b.player === e.player.riotId).map((b) => b.champion);
  const bans = mine(report.bans);
  const backup = mine(report.alternatives);
  const banText = bans.length ? bans.map((c) => `**${c}**`).join(' · ') : 'none';
  const backupText = backup.length ? ` (backup: ${backup.join(', ')})` : '';
  const counter = e.counter?.pick ? `**${e.counter.pick.name}**${e.counter.alternative ? ` or ${e.counter.alternative.name}` : ''}` : 'no counter data';
  return { name: `${role(e.role)} vs ${name}`, value: `🚫 Ban: ${banText}${backupText}\n🎯 Our pick: ${counter}` };
}

/** The message for the whole team: missing players, then per lane the bans and our counter pick. Everything else is behind the buttons. */
function overview(report, options) {
  const total = report.priority.length
    ? `🔥 **Priority bans:** ${report.priority.map((b) => b.champion).join(' · ')}\nThe most dangerous champions of all enemies. Below: at least one ban per lane.`
    : 'Not enough data for bans.';
  const embed = new EmbedBuilder()
    .setTitle(`🔍 Clash scout · ${report.region}`)
    .setColor(COLOR)
    .setDescription(`${notScouted(report.failed)}${total}`.slice(0, 4096))
    .addFields(report.enemies.map((e) => laneField(e, report)));
  const guessed = report.enemies.some((e) => e.player.guessedTag) ? ' · * tag guessed' : '';
  embed.setFooter({ text: `Our picks counter the champion each enemy most likely plays after our bans. Tap a player for details, or Bans for the reasons${guessed}.` });
  return { embeds: [embed], components: buttons(report, options) };
}

/** Everything about one enemy, in the same order as their card: rank, pool, matchups, roles. */
function playerView(report, index) {
  const e = report.enemies[index];
  const p = e.player;
  const roleGames = (r) => p.roles.find((x) => x.role === r)?.games ?? 0;
  const recentGames = p.roles.reduce((sum, r) => sum + r.games, 0);
  const roles = p.roles.length ? p.roles.map((r) => `${role(r.role)} ${r.games}`).join(' · ') : 'no recent games';
  const aimed = report.bans.filter((b) => b.player === p.riotId).map((b) => b.champion);

  const embed = new EmbedBuilder()
    .setTitle(`${role(e.role)} · ${p.riotId}`)
    .setURL(opggUrl(p.riotId, report.region))
    .setColor(COLOR)
    .setDescription(`${rankLine(p.rank)}\n${e.threat}: ${e.threatReason}${p.guessedTag ? '\nTag guessed from the region.' : ''}`)
    .addFields(
      { name: 'Champion pool (ranked, this season)', value: poolText(p.champions, report.banned, e.champion, { limit: 6, stats: true }) },
      {
        name: `Main role: ${role(e.role)} (${roleGames(e.role)} of ${recentGames} recent games)`,
        value: matchupText(e.champion, e.counter?.pick?.name, e.counter?.alternative?.name),
      },
      {
        name: e.second ? `Second role: ${role(e.second.role)} (${roleGames(e.second.role)} of ${recentGames} recent games)` : 'Second role',
        value: e.second ? matchupText(e.second.champion, e.flex?.pick?.name) : 'none, so our bans hit harder',
      },
      { name: 'Roles in the last 20 games', value: roles },
    );
  if (aimed.length) embed.addFields({ name: 'Our bans on them', value: aimed.join(' · ') });
  embed.setFooter({ text: LEGEND });
  return { embeds: [embed], components: buttons(report, { back: true }) };
}

/** The bans with the reason for each, the backups and the tips from the enemy champion classes. */
function bansView(report) {
  const line = (b) => `**${b.champion}** · ${b.player.split('#')[0]} · ${b.games} games · ${b.winRate} %`;
  const embed = new EmbedBuilder()
    .setTitle(`🚫 Bans · ${report.region}`)
    .setColor(COLOR)
    .setDescription('Priority bans rank every champion of every enemy by threat, weighted by the player\'s rank. Bans per lane give each enemy at least one ban, at most three.')
    .addFields(
      { name: '🔥 Priority bans (by threat, any player)', value: report.priority.map((b, i) => `${i + 1}. ${line(b)}`).join('\n') || 'not enough data' },
      { name: '🚫 Bans per lane (at least one per enemy)', value: report.bans.map((b, i) => `${i + 1}. ${line(b)}`).join('\n') || 'not enough data' },
    );
  if (report.alternatives.length) embed.addFields({ name: 'Backup', value: report.alternatives.map(line).join('\n') });
  if (report.plan.length) embed.addFields({ name: 'Tips', value: report.plan.map((t) => `• ${t}`).join('\n') });
  return { embeds: [embed], components: buttons(report, { back: true }) };
}

/** Reads a button id back into the report id and the view ('p0'..'p4', 'bans', 'back'); null for other buttons. */
function parseButton(customId) {
  if (!customId.startsWith(PREFIX)) return null;
  const [id, view] = customId.slice(PREFIX.length).split(':');
  return id && view ? { id, view } : null;
}

/** The message for a view, or null when the view does not exist in this report. */
function render(report, view) {
  if (view === 'back') return overview(report, { back: false });
  if (view === 'bans') return bansView(report);
  const index = /^p(\d)$/.exec(view)?.[1];
  return index !== undefined && report.enemies[index] ? playerView(report, Number(index)) : null;
}

module.exports = { buildReport, overview, render, parseButton, shortRank, poolText };
