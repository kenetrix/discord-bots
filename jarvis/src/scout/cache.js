// Small in-memory cache with expiry, so repeated scouts do not ask OP.GG again.

class TtlCache {
  constructor(ttlMs, maxEntries = 500) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  /**
   * Returns the cached value for `key`, or runs `load` and keeps its result for ttlMs.
   * Concurrent calls for the same key share one load; failures are not cached.
   */
  get(key, load) {
    const hit = this.entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = Promise.resolve().then(load);
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    // Maps keep insertion order, so the first entries are the oldest.
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(oldest);
    }
    return value;
  }

  clear() {
    this.entries.clear();
  }
}

module.exports = { TtlCache };
