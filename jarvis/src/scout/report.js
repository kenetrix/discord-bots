// Builds the /scout messages: a compact overview for the whole team and detail views behind buttons.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { opggUrl } = require('./opgg');

const PREFIX = 'scout:';
const ROLE_LABEL = { TOP: 'Top', JUNGLE: 'Jungle', MID: 'Mid', ADC: 'ADC', SUPPORT: 'Support' };
const ROLE_ICON = { TOP: '⛰️', JUNGLE: '🌲', MID: '✨', ADC: '🏹', SUPPORT: '🛡️' };
const ROLE_ORDER = Object.keys(ROLE_LABEL);
const COLOR = 0xc89b3c;

const escapeMarkdown = (text) => text.replace(/[\\[\]()*_~`|>]/g, '\\$&');
const role = (r) => `${ROLE_ICON[r] ?? ''} ${ROLE_LABEL[r] ?? '?'}`;
const winRate = (c) => (c.games ? Math.round((c.wins / c.games) * 100) : 0);
const link = (player, region) => `[${escapeMarkdown(player.riotId)}](${opggUrl(player.riotId, region)})${player.guessedTag ? '\\*' : ''}`;

/** "MASTER 26 LP, 51 % WR" -> "Master 26 LP": the rank without the record. */
function shortRank(rank) {
  if (!rank) return 'Unranked';
  const [tier, ...rest] = rank.split(',')[0].split(' ');
  return [tier.charAt(0) + tier.slice(1).toLowerCase(), ...rest].join(' ');
}

/** Five dots, filled in proportion to the player's threat compared with the most dangerous enemy. */
function threatDots(score, max) {
  const filled = max ? Math.max(1, Math.round((score / max) * 5)) : 0;
  return '●'.repeat(filled) + '○'.repeat(5 - filled);
}

/** "expect Kayle → pick Malphite or Yasuo", or what is known when data is missing. */
function matchup(against, pick, alternative) {
  if (!against) return 'no pick predicted';
  if (!pick) return `expect **${against}**, no counter data`;
  return `expect **${against}** → pick **${pick}**${alternative ? ` or ${alternative}` : ''}`;
}

/**
 * Puts the analysis into one object per enemy, sorted by role, so every view reads from the same place.
 * `players`, `picks`, `comp` and `flex` are the outputs of opgg.js and analysis.js.
 */
function buildReport({ id, region, players, picks, comp, flex, threats, bans, alternatives, plan, failed }) {
  const maxThreat = Math.max(0, ...[...threats.values()].map((t) => t.score));
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
        dots: threatDots(threats.get(player.riotId)?.score ?? 0, maxThreat),
      };
    })
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  return { id, region, enemies, bans, alternatives, plan, failed };
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

/** The message for the whole team: bans first, then one card per enemy, details behind the buttons. */
function overview(report, options) {
  const banList = report.bans.map((b) => `**${b.champion}**`).join(' · ') || 'not enough data';
  const backup = report.alternatives.length ? `\nBackup: ${report.alternatives.map((b) => b.champion).join(' · ')}` : '';
  const embed = new EmbedBuilder()
    .setTitle(`🔍 Clash scout · ${report.region}`)
    .setColor(COLOR)
    .setDescription(`🚫 **Ban:** ${banList}${backup}`)
    .addFields(
      report.enemies.map((e) => ({
        name: `${role(e.role)}  ${e.dots}`,
        value: [
          link(e.player, report.region),
          shortRank(e.player.rank),
          e.player.champions.slice(0, 3).map((c) => c.name).join(' · ') || 'no ranked games',
          e.second ? `2nd: ${role(e.second.role)}` : '2nd: none',
          e.champion ? `▶ After bans: **${e.champion}** → pick **${e.counter?.pick?.name ?? '?'}**` : '▶ no pick predicted',
        ].join('\n'),
        inline: true,
      })),
    );
  if (report.failed.length) embed.addFields({ name: 'Not scouted', value: report.failed.join('\n').slice(0, 1024) });
  const guessed = report.enemies.some((e) => e.player.guessedTag) ? ' · * tag guessed' : '';
  embed.setFooter({ text: `Tap a player or Bans for details · ● threat compared with the others${guessed}` });
  return { embeds: [embed], components: buttons(report, options) };
}

/** Everything about one enemy: roles, champion pool, expected picks and our answers. */
function playerView(report, index) {
  const e = report.enemies[index];
  const p = e.player;
  const roles = p.roles.length ? p.roles.map((r) => `${role(r.role)} ${r.games}`).join(' · ') : 'no recent games';
  const pool =
    p.champions
      .slice(0, 5)
      .map((c) => `**${c.name}** ${c.games} games · ${winRate(c)} %`)
      .join('\n') || 'no ranked games this season';
  const secondLine = e.second
    ? `${role(e.second.role)}: ${matchup(e.second.champion, e.flex?.pick?.name)}`
    : 'Plays only one role, so bans on them hit harder.';
  const aimed = report.bans.filter((b) => b.player === p.riotId).map((b) => b.champion);

  const embed = new EmbedBuilder()
    .setTitle(`${role(e.role)} · ${p.riotId}`)
    .setURL(opggUrl(p.riotId, report.region))
    .setColor(COLOR)
    .setDescription(`${[shortRank(p.rank), p.rank?.split(', ')[1]].filter(Boolean).join(' · ')}\nThreat ${e.dots}${p.guessedTag ? '\nTag guessed from the region.' : ''}`)
    .addFields(
      { name: 'Roles (last 20 games)', value: roles },
      { name: 'Most played this season', value: pool },
      { name: `Main role: ${role(e.role)}`, value: matchup(e.champion, e.counter?.pick?.name, e.counter?.alternative?.name) },
      { name: 'Second role', value: secondLine },
    );
  if (aimed.length) embed.addFields({ name: 'Our bans on them', value: aimed.join(' · ') });
  return { embeds: [embed], components: buttons(report, { back: true }) };
}

/** The bans with the reason for each, the backups and the tips from the enemy champion classes. */
function bansView(report) {
  const line = (b) => `**${b.champion}** · ${b.player.split('#')[0]} · ${b.games} games · ${b.winRate} %`;
  const embed = new EmbedBuilder()
    .setTitle(`🚫 Bans · ${report.region}`)
    .setColor(COLOR)
    .setDescription('Champions the enemies play most and win most with, at most three aimed at one player.')
    .addFields({ name: 'Ban', value: report.bans.map((b, i) => `${i + 1}. ${line(b)}`).join('\n') || 'not enough data' });
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

module.exports = { buildReport, overview, render, parseButton, shortRank, threatDots };
