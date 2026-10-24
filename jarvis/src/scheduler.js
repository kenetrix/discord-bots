const cron = require('node-cron');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { stmts } = require('./db');
const { cleanChannel } = require('./cleanup');
const { modlog } = require('./modlog');
const { timezone } = require('./config');
const { logger, who, timestamp } = require('./log');

const log = logger('cleaner');

/** Running cron tasks, keyed by job id. */
const tasks = new Map();
const running = new Set();

/** Stored as channel_id of jobs that clear every voice channel of the server. */
const ALL_VOICE = 'all-voice';

// Shorthands so nobody has to know cron syntax.
const PRESETS = {
  hourly: '0 * * * *',
  daily: '0 4 * * *',
  weekly: '0 4 * * 1',
};
const PRESET_NAMES = {
  [PRESETS.hourly]: 'hourly',
  [PRESETS.daily]: 'daily 04:00',
  [PRESETS.weekly]: 'weekly Mon 04:00',
};

/** One-line summary of a job's settings, e.g. "<#123> · daily 04:00 · older than 24 h". */
function describeJob(job) {
  return (
    `${job.channel_id === ALL_VOICE ? 'all voice channels' : `<#${job.channel_id}>`} · ${PRESET_NAMES[job.cron] ?? `\`${job.cron}\``}` +
    (job.max_age_hours ? ` · older than ${job.max_age_hours} h` : '') +
    (job.keep_latest ? ` · keeps newest ${job.keep_latest}` : '') +
    (job.keep_pinned ? '' : ' · incl. pinned')
  );
}

const NEEDED_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages];

/** Clears all voice channels of a guild; channels the bot may not manage are skipped. */
async function runAllVoice(client, job) {
  const guild = await client.guilds.fetch(job.guild_id).catch(() => null);
  if (!guild) {
    log.warn(`#${job.id}: server ${job.guild_id} not found (Jarvis removed from it?).`);
    return null;
  }
  const channels = await guild.channels.fetch();
  const total = { deleted: 0, skippedOld: 0 };
  const skipped = [];
  const touched = [];
  for (const channel of channels.values()) {
    if (channel?.type !== ChannelType.GuildVoice) continue;
    if (!channel.permissionsFor(guild.members.me)?.has(NEEDED_PERMISSIONS)) {
      skipped.push(channel.name);
      continue;
    }
    try {
      const result = await cleanChannel(channel, {
        maxAgeMs: job.max_age_hours * 36e5,
        keepPinned: Boolean(job.keep_pinned),
        keepLatest: job.keep_latest,
      });
      total.deleted += result.deleted;
      total.skippedOld += result.skippedOld;
      if (result.deleted > 0) touched.push(`${channel} (${result.deleted})`);
    } catch (err) {
      log.error(`#${job.id} failed in ${who(channel)} on ${who(guild)}`, err);
    }
  }
  stmts.touchJob.run(Date.now(), job.id);
  if (skipped.length) {
    log.warn(`#${job.id}: skipped ${skipped.length} voice channel(s) on ${who(guild)} without View Channel, Read Message History or Manage Messages: ${skipped.join(', ')}`);
  }
  log.info(`#${job.id}: deleted ${total.deleted} message(s) in ${touched.length} voice channel(s) on ${who(guild)}${oldNote(total)}.`);
  if (total.deleted > 0) {
    await modlog(guild, {
      action: `Scheduled cleanup #${job.id}`,
      moderator: client.user,
      fields: [
        { name: 'Channels', value: touched.join(', ').slice(0, 1024), inline: true },
        { name: 'Deleted', value: String(total.deleted), inline: true },
      ],
    });
  }
  return total;
}

/** Note for messages older than 14 days that were left for the next run (rate limits). */
const oldNote = (result) => (result.skippedOld ? `, ${result.skippedOld} old message(s) left for the next run` : '');

async function runJob(client, job) {
  if (running.has(job.id)) {
    log.warn(`#${job.id}: previous run has not finished yet, skipped.`);
    return null;
  }
  running.add(job.id);
  const started = Date.now();
  log.info(`#${job.id}: run started.`);
  try {
    if (job.channel_id === ALL_VOICE) return await runAllVoice(client, job);
    const channel = await client.channels.fetch(job.channel_id).catch(() => null);
    if (!channel?.isTextBased()) {
      log.warn(`#${job.id}: channel ${job.channel_id} not found or not a text channel (deleted, or Jarvis may not see it).`);
      return null;
    }
    const result = await cleanChannel(channel, {
      maxAgeMs: job.max_age_hours * 36e5,
      keepPinned: Boolean(job.keep_pinned),
      keepLatest: job.keep_latest,
    });
    stmts.touchJob.run(Date.now(), job.id);
    log.info(`#${job.id}: deleted ${result.deleted} message(s) in ${who(channel)} on ${who(channel.guild)}${oldNote(result)} (${Date.now() - started} ms).`);
    if (result.deleted > 0) {
      await modlog(channel.guild, {
        action: `Scheduled cleanup #${job.id}`,
        moderator: client.user,
        fields: [
          { name: 'Channel', value: `${channel}`, inline: true },
          { name: 'Deleted', value: String(result.deleted), inline: true },
        ],
      });
    }
    return result;
  } catch (err) {
    log.error(`#${job.id} failed after ${Date.now() - started} ms`, err);
    return null;
  } finally {
    running.delete(job.id);
  }
}

function scheduleJob(client, job) {
  unscheduleJob(job.id);
  const task = cron.schedule(job.cron, () => runJob(client, job), { timezone, name: `cleaner-${job.id}` });
  tasks.set(job.id, task);
  const next = task.getNextRun?.();
  const guild = who(client.guilds.cache.get(job.guild_id) ?? { id: job.guild_id });
  const channel = job.channel_id === ALL_VOICE ? 'all voice channels' : who(client.channels.cache.get(job.channel_id) ?? { id: job.channel_id });
  log.info(`#${job.id}: "${job.cron}" in ${channel} on ${guild}, next run ${next ? timestamp(next) : 'unknown'}.`);
}

function unscheduleJob(id) {
  if (!tasks.has(id)) return;
  tasks.get(id).stop();
  tasks.delete(id);
  log.info(`#${id}: unscheduled.`);
}

function startScheduler(client) {
  const jobs = stmts.allJobs.all();
  for (const job of jobs) scheduleJob(client, job);
  log.info(`Scheduled ${jobs.length} cleaner job(s) (time zone ${timezone}).`);
}

module.exports = { ALL_VOICE, PRESETS, describeJob, startScheduler, scheduleJob, unscheduleJob, runJob };
