const cron = require('node-cron');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { stmts } = require('./db');
const { cleanChannel } = require('./cleanup');
const { modlog } = require('./modlog');
const { timezone } = require('./config');

/** Running cron tasks, keyed by job id. */
const tasks = new Map();
const running = new Set();

/** Stored as channel_id of jobs that clear every voice channel of the server. */
const ALL_VOICE = 'all-voice';

const NEEDED_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages];

/** Clears all voice channels of a guild; channels the bot may not manage are skipped. */
async function runAllVoice(client, job) {
  const guild = await client.guilds.fetch(job.guild_id).catch(() => null);
  if (!guild) {
    console.warn(`Cleaner #${job.id}: guild ${job.guild_id} not found.`);
    return null;
  }
  const channels = await guild.channels.fetch();
  const total = { deleted: 0, skippedOld: 0 };
  const touched = [];
  for (const channel of channels.values()) {
    if (channel?.type !== ChannelType.GuildVoice) continue;
    if (!channel.permissionsFor(guild.members.me)?.has(NEEDED_PERMISSIONS)) {
      console.warn(`Cleaner #${job.id}: missing permissions in #${channel.name}, skipped.`);
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
      console.error(`Cleaner #${job.id} failed in #${channel.name}:`, err);
    }
  }
  stmts.touchJob.run(Date.now(), job.id);
  console.log(`Cleaner #${job.id}: deleted ${total.deleted} message(s) in all voice channels.`);
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

async function runJob(client, job) {
  if (running.has(job.id)) return null; // Previous run has not finished yet
  running.add(job.id);
  try {
    if (job.channel_id === ALL_VOICE) return await runAllVoice(client, job);
    const channel = await client.channels.fetch(job.channel_id).catch(() => null);
    if (!channel?.isTextBased()) {
      console.warn(`Cleaner #${job.id}: channel ${job.channel_id} not found.`);
      return null;
    }
    const result = await cleanChannel(channel, {
      maxAgeMs: job.max_age_hours * 36e5,
      keepPinned: Boolean(job.keep_pinned),
      keepLatest: job.keep_latest,
    });
    stmts.touchJob.run(Date.now(), job.id);
    console.log(`Cleaner #${job.id}: deleted ${result.deleted} message(s) in #${channel.name}.`);
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
    console.error(`Cleaner #${job.id} failed:`, err);
    return null;
  } finally {
    running.delete(job.id);
  }
}

function scheduleJob(client, job) {
  unscheduleJob(job.id);
  const task = cron.schedule(job.cron, () => runJob(client, job), { timezone, name: `cleaner-${job.id}` });
  tasks.set(job.id, task);
}

function unscheduleJob(id) {
  tasks.get(id)?.stop();
  tasks.delete(id);
}

function startScheduler(client) {
  const jobs = stmts.allJobs.all();
  for (const job of jobs) scheduleJob(client, job);
  console.log(`Scheduled ${jobs.length} cleaner job(s) (time zone ${timezone}).`);
}

module.exports = { ALL_VOICE, startScheduler, scheduleJob, unscheduleJob, runJob };
