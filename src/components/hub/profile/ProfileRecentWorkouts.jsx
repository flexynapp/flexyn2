import { useMemo } from 'react';
import { Dumbbell } from 'lucide-react';
import { workoutTitle } from '@/lib/workoutTitle';
import { totalVolume } from '@/lib/workoutVolume';
import { bestOneRepMax } from '@/lib/oneRepMax';
import { useDateFormatter, useNumberFormatter } from '@/lib/intl';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';

const SHOWN = 4;

// Counts the exercises in each log whose estimated 1RM beat every EARLIER
// log. Walked oldest to newest so a PR is judged against what came before it
// and not against a later, heavier session. A first attempt at a lift is not
// a PR, matching detectPRsInWorkout.
export function prCounts(logs) {
  const best = {};
  const out = new Map();
  const ordered = [...(logs || [])].sort((a, b) => String(a?.date).localeCompare(String(b?.date)));
  for (const log of ordered) {
    let n = 0;
    for (const ex of log?.exercises || []) {
      const name = (ex?.name || ex?.displayName || '').trim().toLowerCase();
      if (!name) continue;
      const rm = bestOneRepMax(ex?.sets);
      if (rm <= 0) continue;
      if (best[name] && rm > best[name]) n += 1;
      if (!best[name] || rm > best[name]) best[name] = rm;
    }
    out.set(log, n);
  }
  return out;
}

function workingSets(log) {
  let n = 0;
  for (const ex of log?.exercises || []) {
    for (const s of ex?.sets || []) if (!s?.is_warmup) n += 1;
  }
  return n;
}

// Own profile only: workout_logs has a single owner policy, so there is no
// way to read anyone else's sessions and this list is never handed theirs.
// Volume is RAW (no bar weight), the same number the leaderboards use.
export default function ProfileRecentWorkouts({ logs, tFallback }) {
  const fmtDate = useDateFormatter();
  const fmt = useNumberFormatter();
  const { weightUnit } = useWeightUnit();
  const prs = useMemo(() => prCounts(logs), [logs]);
  const recent = (logs || []).slice(0, SHOWN);
  if (recent.length === 0) return null;
  const unit = weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lb';

  return (
    <div className="flex flex-col gap-2">
      <span className="eyebrow">{tFallback('profile.recentWorkouts', 'Recent workouts')}</span>
      <div className="flex flex-col divide-y divide-border">
        {recent.map((log) => {
          const title = workoutTitle(log) || tFallback('profile.workoutFallback', 'Workout');
          const exercises = (log?.exercises || []).length;
          const sets = workingSets(log);
          const vol = Math.round(fromLbs(totalVolume(log?.exercises, { includeBarWeight: false }), weightUnit));
          const pr = prs.get(log) || 0;
          const date = log?.date ? fmtDate(new Date(`${String(log.date).slice(0, 10)}T12:00:00`), { month: 'short', day: 'numeric' }) : null;
          const detail = [
            date,
            exercises ? tFallback('profile.exerciseCount', '{n} exercises', { n: exercises }) : null,
            sets ? tFallback('profile.setCount', '{n} sets', { n: sets }) : null,
          ].filter(Boolean).join(' · ');
          return (
            <div key={log.id || `${log.date}-${title}`} className="flex items-center gap-3 py-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Dumbbell className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-sm font-semibold truncate">{title}</span>
                  {pr > 0 && (
                    <span className="text-xs font-semibold text-primary shrink-0">
                      {pr === 1
                        ? tFallback('profile.prOne', '1 PR')
                        : tFallback('profile.prMany', '{n} PRs', { n: pr })}
                    </span>
                  )}
                </div>
                {detail && <p className="text-xs text-muted-foreground truncate">{detail}</p>}
              </div>
              {vol > 0 && (
                <span className="text-sm tabular-nums text-muted-foreground shrink-0">{fmt(vol)} {unit}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
