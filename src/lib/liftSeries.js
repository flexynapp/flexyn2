// Per-lift series for the analytics sheet's weight chart. See AnalyticsTab
// in src/pages/Progress.jsx for why it charts one lift at a time.

/**
 * The best lift to chart when nothing is picked: the heaviest one with at
 * least two sessions (a line needs two points), else the heaviest overall.
 */
export function defaultLift(lifts) {
  const heaviest = (list) => list.reduce((best, l) => (l.max > (best?.max ?? -1) ? l : best), null);
  return heaviest(lifts.filter(l => l.sessions.length >= 2)) || heaviest(lifts);
}

/**
 * Per lift, the heaviest set of each session, oldest first. Only weighted
 * sets count, so a bodyweight movement never appears as a flat zero line.
 */
export function liftSeries(logs) {
  const byName = new Map();
  for (const log of logs) {
    if (!log.date) continue;
    const rawDate = String(log.date).slice(0, 10);
    for (const ex of log.exercises || []) {
      if (!ex.name) continue;
      const top = (ex.sets || []).reduce((m, st) => Math.max(m, Number(st.weight) || 0), 0);
      if (top <= 0) continue;
      if (!byName.has(ex.name)) byName.set(ex.name, new Map());
      const days = byName.get(ex.name);
      // Two logs on one day chart as that day's heavier one.
      days.set(rawDate, Math.max(days.get(rawDate) || 0, top));
    }
  }
  return [...byName.entries()].map(([name, days]) => {
    const sessions = [...days.entries()]
      .map(([rawDate, maxLbs]) => ({ rawDate, maxLbs }))
      .sort((x, y) => x.rawDate.localeCompare(y.rawDate));
    return { name, sessions, max: Math.max(...sessions.map(e => e.maxLbs)) };
  });
}
