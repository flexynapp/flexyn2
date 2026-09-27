// src/lib/glanceStats.js
//
// Pure derivations for the quiet stat row under each page's focal goal
// (Progress, Nutrition). No React, no `@/api/db`: callers pass rows they
// already fetched.
//
// Nothing here computes XP, coins or anything the server owns. Level and XP
// are read straight off the profile by the caller; these helpers only count
// and sum the user's own logs for display.
//
// Volume is RAW (weight x reps) on purpose. The bar-weight preference is a
// display choice for a single session's pill, not for a figure that sits one
// tap from the gym and crew boards (CLAUDE.md, "Stored volume is RAW").

import { parseLocalDate, toLocalDateString } from '@/lib/dateUtils';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight of the Monday that starts `now`'s week. */
export function startOfWeekMonday(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const back = (d.getDay() + 6) % 7; // Mon = 0 … Sun = 6
  d.setDate(d.getDate() - back);
  return d;
}

function topOf(ex) {
  let w = 0;
  let r = 0;
  for (const s of ex?.sets || []) {
    w = Math.max(w, Number(s?.weight) || 0);
    r = Math.max(r, Number(s?.reps) || 0);
  }
  return { w, r };
}

/**
 * Every personal best the logs contain, oldest first.
 *
 * A best is a session that beats every EARLIER session of the same exercise:
 * a heavier top set for a loaded lift, more reps for a bodyweight one. The
 * first time an exercise is ever logged is not a best, because there was
 * nothing to beat; counting it would make a new user's first workout read as
 * six personal bests.
 *
 * `reps` on a loaded best is the reps done AT the new top weight, which is
 * what "185 × 5" means to a lifter.
 *
 * @param {Array<{date: string, exercises?: Array}>} logs  any order
 * @returns {Array<{name: string, date: string, weight: number, reps: number}>}
 */
export function personalBestEvents(logs = []) {
  const dated = (logs || [])
    .filter((l) => l && l.date)
    .map((l) => ({ key: String(l.date).slice(0, 10), log: l }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const best = new Map(); // exercise → { weight, reps }
  const events = [];
  for (const { key, log } of dated) {
    for (const ex of log.exercises || []) {
      if (!ex?.name) continue;
      const { w, r } = topOf(ex);
      if (w <= 0 && r <= 0) continue;
      const prev = best.get(ex.name);
      if (prev) {
        const beat = w > 0 ? w > prev.weight : prev.weight === 0 && r > prev.reps;
        if (beat) {
          const repsAtTop = w > 0
            ? Math.max(0, ...(ex.sets || []).filter((s) => (Number(s?.weight) || 0) === w).map((s) => Number(s?.reps) || 0))
            : r;
          events.push({ name: ex.name, date: key, weight: w, reps: repsAtTop });
        }
        best.set(ex.name, { weight: Math.max(prev.weight, w), reps: Math.max(prev.reps, r) });
      } else {
        best.set(ex.name, { weight: w, reps: r });
      }
    }
  }
  return events;
}

/**
 * Personal bests set this month and this (Monday-based) week.
 * @returns {{ month: number, week: number }}
 */
export function personalBestCounts(events = [], now = new Date()) {
  const monthKey = toLocalDateString(now).slice(0, 7);
  const weekKey = toLocalDateString(startOfWeekMonday(now));
  let month = 0;
  let week = 0;
  for (const e of events || []) {
    if (!e?.date) continue;
    if (e.date.slice(0, 7) === monthKey) month += 1;
    if (e.date >= weekKey) week += 1;
  }
  return { month, week };
}

/** Raw lifted volume (weight × reps), never the bar-weight display preference. */
export function rawVolume(logs = []) {
  let v = 0;
  for (const log of logs || []) {
    for (const ex of log?.exercises || []) {
      for (const s of ex?.sets || []) v += (Number(s?.weight) || 0) * (Number(s?.reps) || 0);
    }
  }
  return v;
}

/**
 * Raw volume per Monday-based week, oldest first, ending with the current
 * week. The sparkline under the Volume figure is this series, so the number
 * always has its own history beside it.
 */
export function weeklyVolumeSeries(logs = [], now = new Date(), weeks = 8) {
  const thisMonday = startOfWeekMonday(now).getTime();
  const out = new Array(weeks).fill(0);
  for (const log of logs || []) {
    const d = parseLocalDate(log?.date);
    if (!d) continue;
    // Round, not floor: a DST change makes one week 23 or 25 hours long.
    const idx = Math.floor(Math.round((startOfWeekMonday(d).getTime() - thisMonday) / DAY_MS) / 7);
    const slot = weeks - 1 + idx;
    if (slot < 0 || slot >= weeks) continue;
    out[slot] += rawVolume([log]);
  }
  return out;
}
