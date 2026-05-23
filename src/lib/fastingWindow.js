// src/lib/fastingWindow.js
//
// Pure helpers for the intermittent-fasting tracker. Per-device
// localStorage backed (no DB) — IF is a personal preference, not
// a competitive feature.
//
// State shape stored under `flexyn.fastingWindow.<userEmail>`:
//   { startedAt: ISO, targetHours: number }  — when in a fast
//   null                                     — not fasting
//
// We expose helpers for:
//   • formatRemaining(ms)  → "12:34" left of fast / "OPEN" if done
//   • computeProgress(startedAt, targetHours, now) → { elapsedMs,
//       targetMs, remainingMs, pct, done }

const LS_KEY = (email) => `flexyn.fastingWindow.${email || 'anon'}`;

export function readState(userEmail) {
  try {
    const raw = localStorage.getItem(LS_KEY(userEmail));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.startedAt || !Number.isFinite(Number(parsed.targetHours))) return null;
    return { startedAt: parsed.startedAt, targetHours: Number(parsed.targetHours) };
  } catch { return null; }
}

export function startFast(userEmail, targetHours = 16, now = new Date()) {
  const state = { startedAt: now.toISOString(), targetHours: Number(targetHours) || 16 };
  try { localStorage.setItem(LS_KEY(userEmail), JSON.stringify(state)); } catch { /* ignore */ }
  return state;
}

export function endFast(userEmail) {
  try { localStorage.removeItem(LS_KEY(userEmail)); } catch { /* ignore */ }
}

export function computeProgress(startedAtIso, targetHours, now = Date.now()) {
  const start = startedAtIso ? Date.parse(startedAtIso) : NaN;
  const targetMs = (Number(targetHours) || 16) * 3600_000;
  if (!Number.isFinite(start)) {
    return { elapsedMs: 0, targetMs, remainingMs: targetMs, pct: 0, done: false };
  }
  const elapsedMs = Math.max(0, now - start);
  const remainingMs = Math.max(0, targetMs - elapsedMs);
  const pct = targetMs > 0 ? Math.min(100, (elapsedMs / targetMs) * 100) : 0;
  return { elapsedMs, targetMs, remainingMs, pct, done: elapsedMs >= targetMs };
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
