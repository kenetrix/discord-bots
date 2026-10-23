const { Collection } = require('discord.js');

// bulkDelete geht nur für Nachrichten jünger als 14 Tage; etwas Puffer gegen Grenzfälle.
const BULK_MAX_AGE = 14 * 864e5 - 60e3;

/**
 * Löscht Nachrichten in einem Kanal.
 * @param {import('discord.js').TextBasedChannel} channel
 * @param {object} opts
 * @param {number}  [opts.maxAgeMs=0]       Nur Nachrichten älter als diese Zeit löschen (0 = alle)
 * @param {boolean} [opts.keepPinned=true]  Angepinnte Nachrichten behalten
 * @param {string}  [opts.userId]           Nur Nachrichten dieses Nutzers
 * @param {number}  [opts.limit=Infinity]   Höchstens so viele Nachrichten löschen
 * @param {number}  [opts.maxScan=5000]     Höchstens so viele Nachrichten durchsuchen
 * @param {boolean} [opts.allowOld=true]    Nachrichten älter als 14 Tage einzeln löschen
 * @param {number}  [opts.maxSingle=300]    Obergrenze für Einzel-Löschungen pro Lauf (Rate-Limits)
 * @returns {Promise<{deleted: number, skippedOld: number}>}
 */
async function cleanChannel(channel, opts = {}) {
  const {
    maxAgeMs = 0,
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
    scanned += batch.size;
    before = batch.last().id;

    const now = Date.now();
    const candidates = batch.filter(
      (m) =>
        (!keepPinned || !m.pinned) &&
        (!userId || m.author.id === userId) &&
        now - m.createdTimestamp >= maxAgeMs &&
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
  }

  return { deleted, skippedOld };
}

module.exports = { cleanChannel };
