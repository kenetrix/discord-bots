const { Collection } = require('discord.js');

// bulkDelete only works for messages younger than 14 days; small buffer for edge cases.
const BULK_MAX_AGE = 14 * 864e5 - 60e3;

/**
 * Deletes messages in a channel.
 * @param {import('discord.js').TextBasedChannel} channel
 * @param {object} opts
 * @param {number}  [opts.maxAgeMs=0]       Only delete messages older than this (0 = all)
 * @param {number}  [opts.newerThanMs=0]    Only delete messages newer than this (0 = all)
 * @param {number}  [opts.keepLatest=0]     Keep the newest N messages of the channel
 * @param {boolean} [opts.keepPinned=true]  Keep pinned messages
 * @param {string}  [opts.userId]           Only messages by this user
 * @param {number}  [opts.limit=Infinity]   Delete at most this many messages
 * @param {number}  [opts.maxScan=5000]     Scan at most this many messages
 * @param {boolean} [opts.allowOld=true]    Delete messages older than 14 days one by one
 * @param {number}  [opts.maxSingle=300]    Cap on single deletes per run (rate limits)
 * @returns {Promise<{deleted: number, skippedOld: number}>}
 */
async function cleanChannel(channel, opts = {}) {
  const {
    maxAgeMs = 0,
    newerThanMs = 0,
    keepLatest = 0,
    keepPinned = true,
    userId,
    limit = Infinity,
    maxScan = 5000,
    allowOld = true,
    maxSingle = 300,
  } = opts;

  let before;
  let scanned = 0;
  let deleted = 0;
  let single = 0;
  let skippedOld = 0;

  while (deleted < limit && scanned < maxScan) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before && { before }) });
    if (batch.size === 0) break;
    const offset = scanned;
    scanned += batch.size;
    before = batch.last().id;

    const now = Date.now();
    // Messages arrive newest first, so the position in the channel is offset + index.
    const positions = new Map([...batch.keys()].map((id, i) => [id, offset + i]));
    const candidates = batch.filter(
      (m) =>
        positions.get(m.id) >= keepLatest &&
        (!keepPinned || !m.pinned) &&
        (!userId || m.author.id === userId) &&
        now - m.createdTimestamp >= maxAgeMs &&
        (!newerThanMs || now - m.createdTimestamp <= newerThanMs) &&
        !m.system,
    );

    const recent = new Collection();
    const old = [];
    for (const m of candidates.values()) {
      if (deleted + recent.size + old.length >= limit) break;
      if (now - m.createdTimestamp < BULK_MAX_AGE) recent.set(m.id, m);
      else old.push(m);
    }

    if (recent.size === 1) {
      await recent.first().delete();
      deleted += 1;
    } else if (recent.size > 1) {
      const result = await channel.bulkDelete(recent, true);
      deleted += result.size;
    }

    for (const m of old) {
      if (!allowOld || single >= maxSingle) {
        skippedOld += 1;
        continue;
      }
      await m.delete().catch(() => {});
      single += 1;
      deleted += 1;
    }

    if (batch.size < 100) break;
    // Everything further back is older than the window, nothing left to delete.
    if (newerThanMs && now - batch.last().createdTimestamp > newerThanMs) break;
  }

  return { deleted, skippedOld };
}

module.exports = { cleanChannel };
