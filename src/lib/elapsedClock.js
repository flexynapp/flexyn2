// src/lib/elapsedClock.js
//
// Tiny pure helper for the live workout-elapsed chip + duration
// auto-fill. Separate from formatRelativeDate / formatTimeUntil
// because the rendering rules differ:
//   • Always count UP from the start
//   • Always render H:MM:SS once the gap exceeds an hour, MM:SS below
//   • Negative gap (clock skew) clamps to 0:00

export function elapsedSeconds(startedAtIso, now = Date.now()) {
  if (!startedAtIso) return 0;
  const start = typeof startedAtIso === 'string'
    ? Date.parse(startedAtIso)
    : new Date(startedAtIso).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((now - start) / 1000));
}

export function formatElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Round elapsed seconds to whole minutes for the duration_minutes save field. */
export function elapsedMinutes(startedAtIso, now = Date.now()) {
  return Math.max(0, Math.round(elapsedSeconds(startedAtIso, now) / 60));
}
