// src/lib/conversationArchive.js
//
// Per-device "Archive" state for DM conversations. Mirrors the
// existing pin + mute localStorage pattern (which HubMessages.jsx
// already namespaces per-user) — single source of truth lives here
// so the inbox and any future surface read/write through the same
// helper.
//
// Per CLAUDE.md, per-device UX state must be namespaced
// `flexyn.<feature>.<userId>`. The previous bare key
// 'fn_archived_convs' was missed during the audit-07 namespace
// sweep; Wave 57 (Messages audit) caught it. On shared devices,
// User A's archive list bled into User B's session (mostly cosmetic
// since B doesn't have A's conv ids, but it's an inconsistency
// with the pin/mute keys that survives across sign-outs).
//
// All helpers accept an optional `userId`. When omitted, the
// best-effort getCurrentUserId() reads the supabase session out of
// localStorage (same pattern as ProgressPhotoCapture) so the
// synchronous helper signatures stay intact for existing callers.
// A one-time migration moves any legacy `fn_archived_convs` data
// into the per-user slot for the FIRST user to load post-deploy.
//
// Behavior:
//   • archive(id, userId?)  — adds the id to the archived set
//   • unarchive(id, userId?) — removes it
//   • isArchived(id, userId?) — boolean
//   • partition(conversations, userId?) — splits a list

const LEGACY_KEY = 'fn_archived_convs';
const keyFor = (userId) => `flexyn.archivedConvs.${userId || 'anon'}`;

function getCurrentUserId() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      return parsed?.user?.id || parsed?.currentSession?.user?.id || null;
    }
  } catch { /* ignore */ }
  return null;
}

function migrateLegacyIfNeeded(uid) {
  if (!uid) return;
  try {
    const userKey = keyFor(uid);
    if (localStorage.getItem(userKey)) return;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    localStorage.setItem(userKey, legacy);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* ignore */ }
}

function readAll(userId) {
  const uid = userId || getCurrentUserId();
  migrateLegacyIfNeeded(uid);
  try {
    const raw = localStorage.getItem(keyFor(uid));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeAll(obj, userId) {
  const uid = userId || getCurrentUserId();
  try { localStorage.setItem(keyFor(uid), JSON.stringify(obj)); }
  catch { /* best-effort */ }
}

export function archive(convId, userId) {
  if (!convId) return;
  const all = readAll(userId);
  all[convId] = new Date().toISOString();
  writeAll(all, userId);
}

export function unarchive(convId, userId) {
  if (!convId) return;
  const all = readAll(userId);
  delete all[convId];
  writeAll(all, userId);
}

export function isArchived(convId, userId) {
  if (!convId) return false;
  return !!readAll(userId)[convId];
}

/**
 * Split a conversations list into { active, archived }.
 *
 * A conversation auto-returns to active when a message arrives AFTER
 * the user archived it — that's the "no black-hole" promise. We detect
 * this by comparing each conversation's last_message_at against the
 * archived_at timestamp.
 */
export function partitionByArchive(conversations, userId) {
  if (!Array.isArray(conversations)) return { active: [], archived: [] };
  const archivedMap = readAll(userId);
  const active = [];
  const archived = [];
  for (const c of conversations) {
    const at = archivedMap[c.id];
    if (!at) { active.push(c); continue; }
    const lastMsg = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
    const archivedAt = new Date(at).getTime();
    if (lastMsg > archivedAt) {
      // Fresh activity — auto-unarchive and route to active.
      unarchive(c.id, userId);
      active.push(c);
    } else {
      archived.push(c);
    }
  }
  return { active, archived };
}

export function clearAll(userId) {
  const uid = userId || getCurrentUserId();
  try { localStorage.removeItem(keyFor(uid)); } catch { /* ignore */ }
}
