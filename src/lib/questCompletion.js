// src/lib/questCompletion.js
//
// App-wide "a quest just completed" signal.
//
// Completion used to be noticed only by DailyQuestsCard, by diffing the rows
// its query returned. That card lives on Today, so a quest finished anywhere
// else (three Hub reactions, a crew message, a water tap in the + sheet) said
// nothing until the user went back to Today and the card's next refetch saw
// the change. Kegan, 2026-09-29: "quest completion should be visible
// regardless of page or menu".
//
// The moment a quest completes is known exactly: recordActions is the only
// writer of `completed_at`, and it knows which rows it just pushed over their
// target. It announces them here, and QuestCompletionWatcher (mounted once, at
// App level beside the feedback pill) turns each into the cue.
//
// The card still announces what it sees, because a quest completed on another
// device reaches this one only through its refetch. Both paths go through the
// same de-dup set keyed on the quest ROW id, so a completion is shown once no
// matter how many of them notice it.
//
// Plain module state, no React and no imports, so the data layer can call it
// from tests that stub everything else.

const seen = new Set();
const listeners = new Set();
// Announcements that arrive before the watcher has subscribed (it mounts with
// the app, but a save can resolve during that first render) wait here rather
// than being dropped.
let pending = [];

/**
 * Record rows whose completion the user has already been told about, or that
 * were complete before this session noticed them. They will never announce.
 */
export function markQuestsSeen(rows) {
  for (const r of rows || []) {
    if (r?.id && r.completed_at) seen.add(r.id);
  }
}

/**
 * A quest row crossed into completed. Announced at most once per row id.
 * Returns true when this call is the one that announced it.
 */
export function announceQuestCompleted(row) {
  if (!row?.id || seen.has(row.id)) return false;
  seen.add(row.id);
  if (listeners.size === 0) {
    pending.push(row);
    return true;
  }
  for (const l of listeners) l(row);
  return true;
}

/** Subscribe to completions. Flushes anything announced before subscribing. */
export function subscribeQuestCompleted(fn) {
  listeners.add(fn);
  if (pending.length) {
    const queued = pending;
    pending = [];
    for (const row of queued) fn(row);
  }
  return () => { listeners.delete(fn); };
}

/** Test-only: forget everything. */
export function _resetQuestCompletion() {
  seen.clear();
  listeners.clear();
  pending = [];
}
