// src/lib/exerciseTrend.js
//
// The numbers behind Progress → Trends. Pure: no React, no I/O, no
// formatting — callers own units and language.
//
// This module exists mainly to make ONE rule testable: **which metric a
// given exercise is allowed to plot.** The old card plotted max weight
// and max reps together on two y-axes, which is the chart mistake the
// dataviz reference names first — two scales make the crossings, the
// gaps and the relative slopes artefacts of two arbitrary domains. The
// fix is one series on one axis, so something has to decide *which*.
//
// It can't be a fixed choice, because the data won't support one.
// Measured against production on 2026-08-10, the entire database held
// two exercise rows:
//
//   Bench Press  [{ reps: 45, weight: 111 }]
//   Push-Up      [{ reps:  5, weight:   0 }]
//
// A weight line is meaningless for the Push-Up. An estimated-1RM line is
// zero for BOTH — `epleyOneRepMax` returns 0 above 12 reps and 0 at zero
// weight — so defaulting to it would have drawn a flat zero on 100% of
// real data. CLAUDE.md: a section with no data must not render as zeros.
//
// So the metric is derived from the sets, and a metric that would draw
// zeros is never offered. Two thresholds, and the difference between
// them is deliberate:
//
//   • the PRIMARY metric needs ONE resolving session — enough to print a
//     headline number, which is worth showing even with no trend yet.
//   • an ALTERNATIVE metric needs TWO — offering a switch that lands on
//     a single dot is offering nothing.

import { bestOneRepMax } from '@/lib/oneRepMax';
import { parseLocalDate } from '@/lib/dateUtils';

/**
 * Metric ids, in the order they are offered. Labels and units live at
 * the call site (i18n + the user's weight unit); this file only ever
 * deals in pounds, the unit everything is stored in.
 */
export const TREND_METRICS = ['weight', 'e1rm', 'volume', 'reps'];

/** Whether a point carries a real value for a metric. */
const RESOLVES = {
  weight: (p) => p.weight > 0,
  e1rm: (p) => p.e1rm > 0,
  volume: (p) => p.volume > 0,
  reps: (p) => p.reps > 0,
};

/** True when the metric is a weight, i.e. needs unit conversion + a unit suffix. */
export const METRIC_IS_WEIGHT = { weight: true, e1rm: true, volume: true, reps: false };

/**
 * One point per session that contains the exercise, oldest first.
 *
 * `sinceMs` is a lower bound on the session date; pass -Infinity for
 * "all time". Dates go through `parseLocalDate` — the `date` column is a
 * Postgres DATE delivered as 'YYYY-MM-DD', and `new Date()` reads that as
 * UTC midnight, which is the previous local day for every user west of
 * UTC. The old card used the bare constructor and labelled every point
 * one day early.
 *
 * @param {Array} logs      workout_logs rows
 * @param {string} exerciseName
 * @param {number} sinceMs
 * @returns {Array<{ t:number, weight:number, reps:number, volume:number, e1rm:number, sets:Array }>}
 */
export function buildTrendPoints(logs = [], exerciseName, sinceMs = -Infinity) {
  const points = [];

  for (const log of logs) {
    const d = parseLocalDate(log?.date);
    if (!d) continue;
    const t = d.getTime();
    if (t < sinceMs) continue;

    const ex = log.exercises?.find((e) => e?.name === exerciseName);
    const sets = ex?.sets;
    if (!sets?.length) continue;

    let weight = 0;
    let reps = 0;
    let volume = 0;
    for (const s of sets) {
      const w = Number(s?.weight) || 0;
      const r = Number(s?.reps) || 0;
      if (w > weight) weight = w;
      if (r > reps) reps = r;
      volume += w * r;
    }

    points.push({ t, weight, reps, volume, e1rm: bestOneRepMax(sets), sets });
  }

  points.sort((a, b) => a.t - b.t);
  return points;
}

/**
 * Which metrics this exercise may plot, in offer order. First entry is
 * the default. Empty when there is nothing real to show at all.
 *
 * An exercise whose every set is unweighted is bodyweight work: reps are
 * the only honest measure, and weight / volume / 1RM are all identically
 * zero, so it gets exactly one metric and no switch.
 */
export function metricsFor(points = []) {
  const resolving = (m) => points.filter(RESOLVES[m]).length;

  if (resolving('weight') === 0) {
    return resolving('reps') > 0 ? ['reps'] : [];
  }

  return [
    'weight',
    ...['e1rm', 'volume'].filter((m) => resolving(m) >= 2),
  ];
}

/**
 * The series for one metric: every point in the window, with `value`
 * null where the metric doesn't resolve.
 *
 * Nulls are kept rather than filtered so the line BREAKS across a
 * session that has no value for this metric, instead of drawing a
 * straight segment over it as though nothing happened.
 */
export function seriesFor(points = [], metric) {
  const resolves = RESOLVES[metric];
  if (!resolves) return [];
  return points.map((p) => ({ t: p.t, value: resolves(p) ? p[metric] : null, point: p }));
}

/**
 * Headline for a metric: its most recent real value, the one before it,
 * and the change between them.
 *
 * Both are drawn from RESOLVING points, so a session that skipped this
 * metric neither becomes the headline nor fakes a crash to zero in the
 * delta.
 *
 * `delta` is null when there is no earlier value to compare against — a
 * first session has no trend, and saying "+205" would be a claim about a
 * comparison that doesn't exist.
 */
export function headlineFor(points = [], metric) {
  const resolves = RESOLVES[metric];
  if (!resolves) return { latest: null, previous: null, delta: null, sessions: 0 };

  const real = points.filter(resolves);
  const latest = real.length ? real[real.length - 1] : null;
  const previous = real.length > 1 ? real[real.length - 2] : null;

  return {
    latest,
    previous,
    delta: latest && previous ? latest[metric] - previous[metric] : null,
    sessions: real.length,
  };
}

/**
 * Up to `max` x-axis ticks, every one of them a real session date.
 *
 * Recharts' automatic ticks on a numeric axis land on round numbers of
 * milliseconds, which are arbitrary instants — so the labels would name
 * days the user did not train. Sampling the points instead means every
 * tick is a session.
 */
export function tickTimes(points = [], max = 4) {
  if (points.length <= max) return points.map((p) => p.t);
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)].t);
  return [...new Set(out)];
}

/**
 * A padded [min, max] for the value axis.
 *
 * Deliberately NOT zero-based. This chart answers "did it go up", and a
 * zero baseline flattens 185 → 195 into a straight line. That is the
 * labelled-non-zero-baseline case: legitimate for a line over time
 * PROVIDED the axis shows its real bounds, which is why `axisTicks`
 * below always includes both ends.
 *
 * A flat series pads by 10% of its own value so it renders as a line
 * through the middle rather than clinging to an edge.
 */
export function valueDomain(values = []) {
  const real = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!real.length) return [0, 1];

  const min = Math.min(...real);
  const max = Math.max(...real);
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return [min - pad, max + pad];
  }

  const pad = (max - min) * 0.18;
  return [min - pad, max + pad];
}

/** Value-axis ticks: the real low and high, plus the midpoint. */
export function axisTicks(values = []) {
  const real = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!real.length) return [];
  const min = Math.min(...real);
  const max = Math.max(...real);
  if (min === max) return [min];
  return [min, (min + max) / 2, max];
}
