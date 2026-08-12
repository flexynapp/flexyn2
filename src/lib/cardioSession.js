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

// localStorage is a ~5 MB budget shared with the rest of the app, and the
// outdoor tracker writes a snapshot every 10 seconds carrying the whole GPS
// track so far. The track only grows: production stores a point roughly
// every 5 m of movement, so an hour's run is a couple of thousand points
// and a long one is more. Left alone, a snapshot eventually exceeds the
// quota — on exactly the long sessions where losing the run hurts most —
// and the old `catch {}` swallowed that in silence, so recovery simply
// stopped working with nothing to show for it.
//
// 1500 points is the cap. At ~48 bytes a point that is ~72 KB of track,
// comfortably inside the budget while still drawing a recognisable route.
const MAX_SNAPSHOT_POINTS = 1500;

/**
 * Thin the track to at most `max` points, ALWAYS keeping the first and the
 * last. Even stride, so the shape of the route survives; the endpoints are
 * pinned because the last fix is what `lastAccepted` is compared against on
 * resume, and dropping it would restart distance accumulation from an older
 * position and double-count the gap.
 */
export function thinTrack(track, max = MAX_SNAPSHOT_POINTS) {
  if (!Array.isArray(track) || track.length <= max) return track;
  const out = [];
  const stride = (track.length - 1) / (max - 1);
  for (let i = 0; i < max - 1; i++) out.push(track[Math.floor(i * stride)]);
  out.push(track[track.length - 1]);
  return out;
}

/**
 * Persist a recovery snapshot.
 *
 * @returns {'ok'|'thinned'|'dropped-track'|'failed'} what actually got
 *   stored. Callers are not required to act on it, but it exists so the
 *   failure is observable at all — the previous version returned nothing
 *   and swallowed every error, which is why this was invisible.
 */
export function snapshot(userId, state) {
  const key = SESSION_KEY(userId);
  const write = (payload) => {
    localStorage.setItem(key, JSON.stringify(payload));
  };

  // 1. Thin a long track up front rather than waiting to be told no.
  const thinned = Array.isArray(state?.track) && state.track.length > MAX_SNAPSHOT_POINTS;
  const first = thinned ? { ...state, track: thinTrack(state.track) } : state;
  try {
    write(first);
    return thinned ? 'thinned' : 'ok';
  } catch {
    // 2. Out of room anyway. The NUMBERS are what recovery needs — start
    //    time, paused time, accumulated distance — so drop the route and
    //    keep the session. A recovered run that has lost its map is a far
    //    better outcome than a recovered run that never appears.
    try {
      write({ ...first, track: [], trackDropped: true });
      return 'dropped-track';
    } catch {
      return 'failed';
    }
  }
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
