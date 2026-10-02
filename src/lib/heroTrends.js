// src/lib/heroTrends.js
//
// The numbers behind the trend slides in Today's hero carousel. Pure: no
// React, no I/O, no formatting. Everything is in pounds and epoch ms; the
// slide owns units, language and dates.
//
// Two trends, each from something the user logged themselves:
//
//   • strength: estimated 1RM on their most-trained lift, one point per
//     session (the session's best set, Epley, via exerciseTrend.js)
//   • body weight: their weigh-ins from body_metrics
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a line is drawn only from real
// points, and a projection only from a trend those points support. Nothing
// is padded, smoothed into existence or seeded. Below the minimum the slide
// says how many more entries it needs instead of drawing anything that
// looks like a trend.
//
// The projection is a least-squares line through the points, continued from
// the LAST REAL POINT (not from the fitted line, which would detach the
// dashed segment from the solid one) for a horizon no longer than the span
// the data covers, capped at four weeks. Three sessions over ten days do not
// get to forecast a quarter. A falling strength trend gets no projection:
// extrapolating a bad fortnight is a forecast nobody asked for, and the
// sentence already says it dipped.

import { buildTrendPoints } from '@/lib/exerciseTrend';
import { parseLocalDate } from '@/lib/dateUtils';

const DAY_MS = 86_400_000;

/** Fewest points that may draw a line, and the shortest span they must cover. */
export const MIN_POINTS = 3;
export const MIN_SPAN_DAYS = { strength: 10, weight: 7 };

/** Only sessions this recent count toward choosing and drawing a lift. */
export const WINDOW_DAYS = 180;

/** Longest projection, in days. Also capped at the data's own span. */
export const MAX_HORIZON_DAYS = 28;

/**
 * Below this share of the current value over the horizon the trend reads as
 * steady rather than up or down. 1% of a 225 lb max is about 2 lb, which is
 * inside one plate of noise.
 */
export const STEADY_SHARE = 0.01;

/** Least squares over [{ x, y }]. Null when x has no variance. */
export function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0; let sy = 0; let sxy = 0; let sxx = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

/**
 * The lift to chart: the exercise with the most sessions that resolve an
 * estimated max inside the window. Ties go to the one trained most recently,
 * so the slide follows what the user is doing now.
 *
 * @returns {{ name: string, sessions: number } | null}
 */
export function pickLift(logs = [], now = new Date()) {
  const since = now.getTime() - WINDOW_DAYS * DAY_MS;
  const tally = new Map();
  for (const log of logs) {
    const d = parseLocalDate(log?.date);
    if (!d || d.getTime() < since) continue;
    const seen = new Set();
    for (const ex of log.exercises || []) {
      const name = ex?.name;
      if (!name || seen.has(name)) continue;
      const resolves = (ex.sets || []).some((s) => Number(s?.weight) > 0 && Number(s?.reps) > 0 && Number(s?.reps) <= 12);
      if (!resolves) continue;
      seen.add(name);
      const row = tally.get(name) || { name, sessions: 0, last: 0 };
      row.sessions += 1;
      row.last = Math.max(row.last, d.getTime());
      tally.set(name, row);
    }
  }
  let best = null;
  for (const row of tally.values()) {
    if (!best || row.sessions > best.sessions || (row.sessions === best.sessions && row.last > best.last)) best = row;
  }
  return best ? { name: best.name, sessions: best.sessions } : null;
}

/**
 * Shared tail: given real points, decide whether a trend exists and where it
 * is heading.
 *
 * @param {Array<{ t:number, v:number }>} points  oldest first
 * @param {'strength'|'weight'} kind
 */
export function summarize(points, kind) {
  const have = points.length;
  const first = points[0] ?? null;
  const last = points[have - 1] ?? null;
  const spanDays = first && last ? Math.round((last.t - first.t) / DAY_MS) : 0;
  const ready = have >= MIN_POINTS && spanDays >= MIN_SPAN_DAYS[kind];

  const base = { kind, points, have, need: MIN_POINTS, spanDays, ready, first, last };
  if (!ready) return { ...base, delta: null, direction: null, projection: null };

  const delta = last.v - first.v;
  const reg = linearRegression(points.map((p) => ({ x: (p.t - first.t) / DAY_MS, y: p.v })));
  const horizonDays = Math.min(MAX_HORIZON_DAYS, spanDays);
  const slope = reg?.slope ?? 0;
  const projectedChange = slope * horizonDays;
  const steady = Math.abs(projectedChange) < Math.abs(last.v) * STEADY_SHARE;

  // The headline direction comes from first to latest, which is what the
  // user can see on the line. The projection comes from the fit.
  const direction = Math.abs(delta) < Math.abs(first.v) * STEADY_SHARE ? 'steady' : delta > 0 ? 'up' : 'down';

  let projection = null;
  if (reg && !(kind === 'strength' && slope < 0)) {
    projection = {
      t: last.t + horizonDays * DAY_MS,
      v: steady ? last.v : last.v + projectedChange,
      steady,
    };
  }
  return { ...base, delta, direction, projection };
}

/** Estimated-max trend on the user's most-trained lift. */
export function strengthTrend(logs = [], now = new Date()) {
  const lift = pickLift(logs, now);
  if (!lift) return { ...summarize([], 'strength'), lift: null };
  return liftTrend(logs, lift.name, now);
}

/** Estimated-max trend on one named lift, same rules as the hero's. */
export function liftTrend(logs = [], name, now = new Date()) {
  const since = now.getTime() - WINDOW_DAYS * DAY_MS;
  const points = buildTrendPoints(logs, name, since)
    .filter((p) => p.e1rm > 0)
    .map((p) => ({ t: p.t, v: Math.round(p.e1rm) }));
  return { ...summarize(dedupeByDay(points, Math.max), 'strength'), lift: name };
}

/** Body weight trend from weigh-ins. Same-day entries keep the latest one. */
export function weightTrend(bodyMetrics = [], now = new Date()) {
  const since = now.getTime() - WINDOW_DAYS * DAY_MS;
  const points = [];
  // body_metrics.list() is newest first, so the first entry seen for a day
  // is the latest one on it.
  const seen = new Set();
  for (const m of bodyMetrics) {
    const d = parseLocalDate(m?.date);
    const v = Number(m?.weight_lbs);
    if (!d || !Number.isFinite(v) || v <= 0 || d.getTime() < since) continue;
    const t = d.getTime();
    if (seen.has(t)) continue;
    seen.add(t);
    points.push({ t, v });
  }
  points.sort((a, b) => a.t - b.t);
  return summarize(points, 'weight');
}

// Two sessions of the same lift on one day draw as one point: the better one.
function dedupeByDay(points, pick) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.t === p.t) prev.v = pick(prev.v, p.v);
    else out.push({ ...p });
  }
  return out;
}

/**
 * Which trend slides Today shows, in order. A trend that is ready earns a
 * slide. When none is, one honest "not yet" slide stands in for strength, so
 * the carousel still says what it will show and what it needs, rather than a
 * new user never learning the slide exists. Weight never gets a "not yet"
 * slide of its own: plenty of lifters do not weigh in, and nagging them for
 * it is not the hero's job.
 */
export function heroTrendSlides({ logs = [], bodyMetrics = [], now = new Date() } = {}) {
  const strength = strengthTrend(logs, now);
  const weight = weightTrend(bodyMetrics, now);
  const ready = [strength, weight].filter((s) => s.ready);
  if (ready.length) return ready;
  return [strength];
}
