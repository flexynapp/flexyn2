// Crash-recovery for live cardio sessions.
//
// The key is PER USER. It used to be a single global
// `fn-cardio-active-session`, which meant the snapshot outlived the account
// that made it. CardioSection offers any snapshot under 12h old on mount
// with no check that it belongs to the person looking at it, so on a shared
// phone User A abandoning a run (app kill, crash, dead battery) left a
// snapshot that User B was offered on their next visit to Cardio — and
// accepting it wrote A's distance and duration into B's cardio logs, which
// also feed distance totals, XP and quest progress.
//
// Same `flexyn.<feature>.<userId>` convention as the rest of the app.
const SESSION_KEY = (userId) => `flexyn.cardioActiveSession.${userId || 'anon'}`;

// The pre-per-user key. We only ever REMOVE this, never read it. Migrating
// it forward would hand exactly one more session across an account switch,
// which is the bug being closed. A user mid-recovery at deploy time loses
// one recovery prompt; that is strictly safer than the alternative.
const LEGACY_KEY = 'fn-cardio-active-session';

export function snapshot(userId, state) {
  try {
    localStorage.setItem(SESSION_KEY(userId), JSON.stringify(state));
  } catch {}
}

export function readSnapshot(userId) {
  // Drop the legacy global snapshot if one is still lying around, so no
  // future code path can read it back.
  try { localStorage.removeItem(LEGACY_KEY); } catch {}
  try {
    const v = localStorage.getItem(SESSION_KEY(userId));
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export function clearSnapshot(userId) {
  try {
    localStorage.removeItem(SESSION_KEY(userId));
  } catch {}
}
