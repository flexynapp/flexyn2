// src/lib/conversationArchive.js
//
// Per-device "Archive" state for DM conversations. Mirrors the
// existing pin + mute localStorage pattern (fn_pinned_convs,
// fn_muted_convs) — single source of truth lives here so the inbox
// and any future surface read/write through the same helper.
//
// Behavior:
//   • archive(id)  — adds the id to the archived set
//   • unarchive(id) — removes it
//   • isArchived(id) — boolean
//   • partition(conversations) — splits a list into { active, archived }
//
// AUTO-UNARCHIVE: a conversation that receives a new message after
// the user archived it implicitly returns to the main inbox. The
// inbox tracks the last_message_at vs. archived_at timestamp and
// removes the id from the set when a fresher message lands.

const KEY = 'fn_archived_convs'; // { [convId]: archived_at ISO }

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeAll(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); }
  catch { /* best-effort */ }
}

export function archive(convId) {
  if (!convId) return;
  const all = readAll();
  all[convId] = new Date().toISOString();
  writeAll(all);
}

export function unarchive(convId) {
  if (!convId) return;
  const all = readAll();
  delete all[convId];
  writeAll(all);
}

export function isArchived(convId) {
  if (!convId) return false;
  return !!readAll()[convId];
}

/**
 * Split a conversations list into { active, archived }.
 *
 * A conversation auto-returns to active when a message arrives AFTER
 * the user archived it — that's the "no black-hole" promise. We detect
 * this by comparing each conversation's last_message_at against the
 * archived_at timestamp.
 */
export function partitionByArchive(conversations) {
  if (!Array.isArray(conversations)) return { active: [], archived: [] };
  const archivedMap = readAll();
  const active = [];
  const archived = [];
  for (const c of conversations) {
    const at = archivedMap[c.id];
    if (!at) { active.push(c); continue; }
    const lastMsg = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
    const archivedAt = new Date(at).getTime();
    if (lastMsg > archivedAt) {
      // Fresh activity — auto-unarchive and route to active.
      unarchive(c.id);
      active.push(c);
    } else {
      archived.push(c);
    }
  }
  return { active, archived };
}

export function clearAll() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
