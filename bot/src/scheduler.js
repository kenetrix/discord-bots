const cron = require('node-cron');
const { stmts } = require('./db');
const { cleanChannel } = require('./cleanup');
const { modlog } = require('./modlog');
const { timezone } = require('./config');

/** Running cron tasks, keyed by job id. */
const tasks = new Map();
const running = new Set();

async function runJob(client, job) {
  if (running.has(job.id)) return null; // Previous run has not finished yet
  running.add(job.id);
  try {
    const channel = await client.channels.fetch(job.channel_id).catch(() => null);
    if (!channel?.isTextBased()) {
      console.warn(`Cleaner #${job.id}: channel ${job.channel_id} not found.`);
      return null;
    }
    const result = await cleanChannel(channel, {
      maxAgeMs: job.max_age_hours * 36e5,
      keepPinned: Boolean(job.keep_pinned),
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

module.exports = { startScheduler, scheduleJob, unscheduleJob, runJob };
