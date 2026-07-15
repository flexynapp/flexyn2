// src/lib/microBatcher.js
//
// Tiny dataloader-style request coalescer. Callers ask for one key at a
// time; calls that land within the same `windowMs` tick are collapsed
// into a single batchFn(uniqueKeys) round-trip. Built for the Hub feed,
// where N post cards each fire per-post reaction queries on mount —
// 3 × N round-trips per feed page collapse into 3.
//
// Deliberately NOT a cache: every call reaches batchFn (via its batch).
// TanStack Query owns caching/staleness above this layer, so mutation
// invalidations keep their exact per-post semantics.

/**
 * @param {(keys: any[]) => Promise<Map<any, any>>} batchFn — receives the
 *   deduped keys from one window, resolves to a Map of key → result.
 *   Keys absent from the Map resolve as undefined (callers default them).
 * @param {{ windowMs?: number, maxBatch?: number }} [opts]
 * @returns {(key: any) => Promise<any>} single-key loader
 */
export function createBatcher(batchFn, { windowMs = 10, maxBatch = 100 } = {}) {
  let queue = [];
  let timer = null;

  const flush = () => {
    const items = queue;
    queue = [];
    if (timer) { clearTimeout(timer); timer = null; }
    const keys = [...new Set(items.map((it) => it.key))];
    Promise.resolve()
      .then(() => batchFn(keys))
      .then((resultMap) => {
        for (const it of items) it.resolve(resultMap?.get(it.key));
      })
      .catch((err) => {
        for (const it of items) it.reject(err);
      });
  };

  return (key) =>
    new Promise((resolve, reject) => {
      queue.push({ key, resolve, reject });
      if (queue.length >= maxBatch) {
        flush();
        return;
      }
      if (!timer) timer = setTimeout(flush, windowMs);
    });
}
