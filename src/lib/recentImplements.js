// src/lib/recentImplements.js
//
// Remembers which specific implements a user actually picks, so the
// equipment dropdown leads with their real gear instead of an
// alphabetical catalog dump. After a couple of sessions the Hammer
// Strength row they always use sits at the top of the list.
//
// Storage shape (per user, matching the flexyn.<feature>.<userId>
// namespace convention):
//
//   flexyn.implements.<userId> → {
//     '<implementType>': [
//       { brand, line, model, label, count, lastUsedAt },
//       ...
//     ]
//   }
//
// ── Why localStorage and not the database ────────────────────────────
// This is a personal recall list: per-device, never shared, which is
// exactly right for "what do I reach for" and exactly wrong for a gym's
// shared floor. Those are different questions, so they stayed different
// stores — the gym floor lives in space_equipment (migration 268).
//
// The picker shows this list ABOVE the gym floor. A machine you have
// picked three times is a stronger signal than one that merely exists
// somewhere on the floor.
//
// Capped per implement type; LRU-evicted. Mirrors
// src/lib/recentExerciseUsage.js.

const STORAGE_KEY = (userId) => `flexyn.implements.${userId || 'anon'}`;
const MAX_PER_TYPE = 12;

function safeRead(userId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

function safeWrite(userId, data) {
  try {
    localStorage.setItem(STORAGE_KEY(userId), JSON.stringify(data));
  } catch { /* quota / private mode — best-effort, never throw */ }
}

/**
 * Identity for an implement choice. Two picks are "the same implement"
 * when brand + line + model match; the human label is display-only and
 * deliberately excluded so a translation or relabel doesn't fork the
 * entry.
 */
export function implementKey(implement) {
  if (!implement) return '';
  const { brand = '', line = '', model = '' } = implement;
  return `${brand}|${line}|${model}`.toLowerCase();
}

/**
 * Implements this user has picked for a given type, best-first.
 *
 * Ranked by recency over raw count — someone who switched gyms last
 * month should see their NEW leg press first, not the one they used
 * fifty times last year.
 */
export function getRecentImplements(userId, implementType) {
  if (!implementType) return [];
  const all = safeRead(userId);
  const list = Array.isArray(all[implementType]) ? all[implementType] : [];
  return [...list].sort((a, b) => {
    const at = Date.parse(a?.lastUsedAt || 0) || 0;
    const bt = Date.parse(b?.lastUsedAt || 0) || 0;
    if (bt !== at) return bt - at;
    return (b?.count || 0) - (a?.count || 0);
  });
}

/** Record that the user picked this implement. Returns the new list. */
export function recordImplementUse(userId, implementType, implement) {
  if (!implementType || !implement) return [];
  const all = safeRead(userId);
  const list = Array.isArray(all[implementType]) ? [...all[implementType]] : [];
  const key = implementKey(implement);

  const idx = list.findIndex(e => implementKey(e) === key);
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      ...implement,
      count: (list[idx].count || 0) + 1,
      lastUsedAt: new Date().toISOString(),
    };
  } else {
    list.unshift({ ...implement, count: 1, lastUsedAt: new Date().toISOString() });
  }

  // LRU evict — drop the least-recently-used beyond the cap.
  const trimmed = list
    .sort((a, b) => (Date.parse(b?.lastUsedAt || 0) || 0) - (Date.parse(a?.lastUsedAt || 0) || 0))
    .slice(0, MAX_PER_TYPE);

  all[implementType] = trimmed;
  safeWrite(userId, all);
  return trimmed;
}

/** Forget one implement (user removed it from their gear). */
export function forgetImplement(userId, implementType, implement) {
  if (!implementType || !implement) return [];
  const all = safeRead(userId);
  const list = Array.isArray(all[implementType]) ? all[implementType] : [];
  const key = implementKey(implement);
  const next = list.filter(e => implementKey(e) !== key);
  all[implementType] = next;
  safeWrite(userId, all);
  return next;
}

/**
 * The single most likely implement for this type, or null.
 * Phase 5 uses this to prefill the picker.
 */
export function bestGuessImplement(userId, implementType) {
  return getRecentImplements(userId, implementType)[0] || null;
}
