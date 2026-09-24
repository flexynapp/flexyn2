// src/lib/todaysPlan.js
//
// Which regimen is due today. Lifted out of TodaysPlanCard so the Today
// screen's hero can make it the one next action (navigation redesign,
// phase 3) without a second copy of the rotation logic.
//
// Returns null when there is no rotation to infer: no regimens, or fewer
// than two that are not archived. Otherwise the regimen used least
// recently (never used counts as due), and whether it was already done
// today.

import { startOfDay } from 'date-fns';
import { parseLocalDate } from '@/lib/dateUtils';
import { workoutTitle } from '@/lib/workoutTitle';

export function findDueRegimen(regimens = [], logs = [], now = new Date()) {
  if (!regimens.length) return null;
  const active = regimens.filter(r => !r.archived);
  if (active.length < 2) return null;

  const today = startOfDay(now).getTime();

  // regimen name → last date a log carried that title
  const lastUsed = {};
  logs.forEach(log => {
    const name = workoutTitle(log);
    if (!name) return;
    const d = parseLocalDate(log.date);
    if (!d || isNaN(d.getTime())) return;
    const ts = d.getTime();
    if (!lastUsed[name] || ts > lastUsed[name]) lastUsed[name] = ts;
  });

  const scored = active.map(r => ({ regimen: r, last: lastUsed[r.name] ?? 0 }));
  scored.sort((a, b) => a.last - b.last);
  // Guard the corrupt-data case where a row has no regimen.
  const top = scored[0];
  if (!top || !top.regimen) return null;
  const last = Number.isFinite(top.last) ? top.last : 0;
  return { regimen: top.regimen, doneToday: last >= today };
}
