// src/lib/recentExerciseUsage.js
//
// Tracks per-user exercise frequency + recency in localStorage so the
// autocomplete can promote recently-used exercises to the top of
// results. After a week of training, a user typing "b" sees their
// Bench Press above the alphabetical baseline.
//
// Storage shape (per user):
//   flexyn.exerciseUsage.<email> → {
//     'bench press': { count: 12, lastUsedAt: '2026-05-22T...' },
//     'squat':       { count: 8,  lastUsedAt: '2026-05-21T...' },
//     ...
//   }
//
// Capped at 100 entries; LRU-evicted when over cap. Decays so an
// exercise unused for >60 days stops influencing rankings (effective
// score → 0).

const STORAGE_KEY = (email) => `flexyn.exerciseUsage.${email || 'anon'}`;
const MAX_ENTRIES = 100;
const DECAY_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function safeRead(email) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(email));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function safeWrite(email, data) {
  try {
    localStorage.setItem(STORAGE_KEY(email), JSON.stringify(data));
  } catch { /* quota / private mode — best-effort */ }
}

/**
 * Increment usage for one exercise. Called from workout-save paths.
 *
 * @param {string} email
 * @param {string} name  Exercise name (case-insensitive internally;
 *                       stored lowercase).
 */
export function recordExerciseUse(email, name) {
  if (!email || !name) return;
  const key = name.trim().toLowerCase();
  if (!key) return;
  const data = safeRead(email);
  const now = new Date().toISOString();
  data[key] = {
    count: (data[key]?.count || 0) + 1,
    lastUsedAt: now,
  };
  // LRU eviction when over cap.
  const entries = Object.entries(data);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => new Date(b[1].lastUsedAt) - new Date(a[1].lastUsedAt));
    const kept = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    safeWrite(email, kept);
  } else {
    safeWrite(email, data);
  }
}

/**
 * Bulk-record usage from a full workout's exercises array. Call after
 * a successful workout save.
 */
export function recordWorkoutExercises(email, exercises = []) {
  if (!email || !Array.isArray(exercises)) return;
  for (const ex of exercises) {
    recordExerciseUse(email, ex?.name || ex?.displayName);
  }
}

/**
 * Compute a per-exercise score for ranking autocomplete results.
 * Higher is better. Returns 0 for never-used or decayed-out entries.
 *
 * Score blend:
 *   recency  (0..1)   how recently last used vs 60-day window
 *   frequency (0..1)   log-scaled count
 * Weighted 60% recency, 40% frequency. Recency matters more — what
 * the user trained YESTERDAY is more relevant than what they grinded
 * a month ago.
 *
 * @returns {Record<string, number>} lowercase-name → score
 */
export function getUsageScores(email) {
  const data = safeRead(email);
  const now = Date.now();
  const scores = {};
  let maxCount = 1;
  for (const entry of Object.values(data)) {
    if ((entry?.count || 0) > maxCount) maxCount = entry.count;
  }
  for (const [name, entry] of Object.entries(data)) {
    const last = new Date(entry.lastUsedAt).getTime();
    const age = now - last;
    if (!Number.isFinite(last) || age > DECAY_MS) {
      scores[name] = 0;
      continue;
    }
    const recencyScore = 1 - (age / DECAY_MS);
    const frequencyScore = Math.log(1 + entry.count) / Math.log(1 + maxCount);
    scores[name] = recencyScore * 0.6 + frequencyScore * 0.4;
  }
  return scores;
}
