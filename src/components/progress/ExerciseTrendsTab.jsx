import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/lib/LanguageContext';
import { muscleKey } from '@/lib/exerciseTranslations';
import { parseLocalDate } from '@/lib/dateUtils';
// `workoutTitle` reads `title`, tolerating `regimen_name`. This file had
// its own copy of that expression, written when the read side was the
// only half that could be fixed from here — `workout_logs` has no
// `regimen_name` column, so db.js's strip-and-retry dropped it on every
// save and it was `undefined` on every row. The old filter compared
// against it directly, which is why picking any regimen filtered the tab
// to zero logs and showed "you have never logged a workout" to someone
// looking at their own training history. b5043ac5 fixed the write and
// gave the column ONE owner; a second local copy of the fallback is
// exactly the drift that module exists to prevent.
import { workoutTitle } from '@/lib/workoutTitle';
import ExerciseTrendRow from './ExerciseTrendRow';
import TrendFilterChip from './TrendFilterChip';

// The tab's own range, defaulting to all time. For a while it followed the
// page's period control instead, which defaulted to the week: a lifter who
// had not trained yet this week opened Trends and found it empty, with
// nothing on screen saying why (Progress audit, 2026-09-29). A trend is a
// long view, so it starts long, and the range sits with the other filters
// where its effect is visible. These are rolling windows and say so; the
// page's period section is the calendar one.
const RANGES = ['all', 'year', 'month', 'week'];
const RANGE_DAYS = { week: 7, month: 30, year: 365, all: Infinity };
const RANGE_FALLBACK = {
  all: 'All time', year: 'Last 12 months', month: 'Last 30 days', week: 'Last 7 days',
};

/**
 * The muscle group an exercise is filed under.
 *
 * The MOST COMMON first-listed group across the window, tie-broken
 * alphabetically — not the most recent session's, which is what this
 * used to be. That made an exercise silently migrate to a different
 * accordion the moment one log happened to list its muscles in a
 * different order.
 */
function groupLabelFor(sessions) {
  const tally = new Map();
  for (const ex of sessions) {
    const label = ex?.muscle_groups?.[0] || ex?.muscle_group;
    if (!label) continue;
    tally.set(label, (tally.get(label) || 0) + 1);
  }
  if (!tally.size) return 'Other';
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/**
 * Progress → Trends.
 *
 * There used to be a MUSCLE_GROUP_COLORS map giving each of the twelve
 * groups its own hue, rendered as a 10px dot immediately to the LEFT of
 * the group's own name. It looked like a categorical encoding and could
 * not be one: the label is the identifier, so the dot carried nothing
 * the text didn't, and twelve hues is past what anyone can tell apart —
 * four of them (red / orange / amber / yellow for Chest, Triceps, Biceps,
 * Forearms) were adjacent on the wheel and identical at 10px. It was
 * decoration wearing the costume of data. The group header is now a
 * plain section label and carries no marker at all. If a real
 * muscle-group encoding is ever needed — a stacked chart, a legend that
 * appears away from the labels — build it deliberately with a palette
 * chosen for discriminability and validated, not restored from that map.
 */
export default function ExerciseTrendsTab({ logs }) {
  const { t, tFallback } = useLanguage();
  const [frame, setFrame] = useState('all');

  const [muscle, setMuscle] = useState('all');
  const [workout, setWorkout] = useState('all');
  // Collapsed rather than expanded, and that inversion is the fix for a
  // real bug: the old state was seeded from the groups present at mount
  // by a `useState` initialiser, which runs ONCE. A group label that
  // appeared later — exactly what changing the muscle filter produces —
  // was `undefined`, therefore falsy, therefore shut. So the filter's
  // payoff was a screen of closed drawers. Absence now means open.
  const [collapsed, setCollapsed] = useState(() => new Set());

  const sinceMs = useMemo(() => {
    const days = RANGE_DAYS[frame] ?? Infinity;
    if (!Number.isFinite(days)) return -Infinity;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - days);
    return d.getTime();
  }, [frame]);

  /** Logs inside the selected period. Everything else derives from this. */
  const windowLogs = useMemo(() => {
    if (!Number.isFinite(sinceMs)) return logs;
    return logs.filter((l) => {
      const d = parseLocalDate(l?.date);
      return d ? d.getTime() >= sinceMs : false;
    });
  }, [logs, sinceMs]);

  /**
   * Workout names that actually occur in the window.
   *
   * Derived from the LOGS, never from the regimens table. The old
   * dropdown listed all 27 of the user's regimen names whether or not a
   * single log carried one, so most options could only ever return
   * nothing. An option that cannot produce a result is not offered.
   */
  const workoutNames = useMemo(
    () => [...new Set(windowLogs.map(workoutTitle).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [windowLogs],
  );

  const namedLogs = useMemo(
    () => (workout === 'all' ? windowLogs : windowLogs.filter((l) => workoutTitle(l) === workout)),
    [windowLogs, workout],
  );

  /** Every exercise in scope → the exercise entries recorded for it. */
  const bySessions = useMemo(() => {
    const map = new Map();
    for (const log of namedLogs) {
      for (const ex of log.exercises || []) {
        if (!ex?.name || !ex.sets?.length) continue;
        if (!map.has(ex.name)) map.set(ex.name, []);
        map.get(ex.name).push(ex);
      }
    }
    return map;
  }, [namedLogs]);

  const muscleItems = useMemo(() => {
    const byKey = new Map();
    for (const sessions of bySessions.values()) {
      for (const ex of sessions) {
        const arr = ex.muscle_groups?.length ? ex.muscle_groups : (ex.muscle_group ? [ex.muscle_group] : []);
        for (const g of arr) {
          if (g && !byKey.has(muscleKey(g))) byKey.set(muscleKey(g), g);
        }
      }
    }
    return [...byKey.entries()]
      .map(([key, raw]) => ({ value: raw, label: tFallback(`muscleGroups.${key}`, raw) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [bySessions, tFallback]);

  /** Grouped, filtered, sorted — what actually renders. */
  const groups = useMemo(() => {
    const out = new Map();

    for (const [name, sessions] of bySessions) {
      if (muscle !== 'all') {
        const hit = sessions.some((ex) =>
          ex.muscle_groups?.includes(muscle) || ex.muscle_group === muscle);
        if (!hit) continue;
      }
      const label = groupLabelFor(sessions);
      if (!out.has(label)) out.set(label, []);
      out.get(label).push(name);
    }

    const sorted = [...out.entries()].sort(([a], [b]) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });
    sorted.forEach(([, names]) => names.sort());
    return new Map(sorted);
  }, [bySessions, muscle]);

  const exerciseCount = useMemo(
    () => [...groups.values()].reduce((n, names) => n + names.length, 0),
    [groups],
  );

  const filtered = muscle !== 'all' || workout !== 'all';

  const toggleGroup = (label) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });

  // THREE empty states, and they used to be one. "No exercise data yet"
  // plus four steps on how to log a workout is the right thing to say to
  // someone who has never logged one, and exactly the wrong thing to say
  // to someone whose filter excluded everything — which, with the broken
  // regimen filter, is what most people got — or to someone who simply
  // trained nothing in the last seven days.
  const neverLogged = logs.length === 0;
  const empty = exerciseCount === 0;

  return (
    <div>
      <h2 className="sr-only">{t('progress.exerciseTrends')}</h2>
      {exerciseCount > 0 && (
        <p className="text-micro text-muted-foreground mt-0.5">
          {tFallback(
            exerciseCount === 1 ? 'trends.exercises_one' : 'trends.exercises_other',
            exerciseCount === 1 ? '{n} exercise' : '{n} exercises',
            { n: exerciseCount },
          )}
          {' · '}
          {tFallback(`trends.range.${frame}`, RANGE_FALLBACK[frame])}
        </p>
      )}

      {/* Controls sit UNDER the heading they qualify. The old filter
          button rendered above it. */}
      {!neverLogged && (
        // One row that scrolls sideways rather than wrapping: on an SE the
        // three chips wrapped to two rows, pushing the list down and
        // leaving one chip alone on a line.
        <div className="flex gap-2 mt-2 overflow-x-auto [&>*]:shrink-0">
          {/* Always shown once anything is logged, so a short range that
              filters to nothing can be widened again from the same place. */}
          <TrendFilterChip
            label={tFallback('trends.rangeLabel', 'Range')}
            value={frame}
            onChange={setFrame}
            items={RANGES.map((r) => ({ value: r, label: tFallback(`trends.range.${r}`, RANGE_FALLBACK[r]) }))}
          />
          {muscleItems.length > 1 && (
            <TrendFilterChip
              label={tFallback('trends.muscleLabel', 'Muscle group')}
              value={muscle}
              onChange={setMuscle}
              items={[
                { value: 'all', label: tFallback('trends.muscleAll', 'All muscle groups') },
                ...muscleItems,
              ]}
            />
          )}
          {/* Only when a log actually carries a name — see the workoutTitle note above. */}
          {workoutNames.length > 0 && (
            <TrendFilterChip
              label={tFallback('trends.workoutLabel', 'Workout')}
              value={workout}
              onChange={setWorkout}
              items={[
                { value: 'all', label: tFallback('trends.workoutAll', 'All workouts') },
                ...workoutNames.map((n) => ({ value: n, label: n })),
              ]}
            />
          )}
        </div>
      )}

      {empty ? (
        !neverLogged ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {filtered
                ? tFallback('trends.noMatch', 'No exercises match these filters in this period.')
                : tFallback('trends.noneInPeriod', 'No exercises logged in this period.')}
            </p>
            {filtered && (
              <button
                onClick={() => { setMuscle('all'); setWorkout('all'); }}
                className="mt-2 text-sm font-bold text-primary hover:text-primary/80 active:text-primary/80 transition-colors"
              >
                {tFallback('trends.clearFilters', 'Clear filters')}
              </button>
            )}
          </div>
        ) : (
          <Card className="p-10 text-center border-dashed mt-4">
            <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-heading font-semibold">{t('progress.noExerciseData')}</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">{t('progress.noExerciseDataDesc')}</p>
            <div className="mt-4 p-4 bg-secondary rounded-xl text-start text-sm text-muted-foreground max-w-xs mx-auto space-y-1.5">
              <p className="font-medium text-foreground mb-2">{t('progress.howToLog')}</p>
              <p>1. {t('progress.howToLog.step1').split('{workout}')[0]}<span className="text-primary font-medium">{t('nav.train')}</span>{t('progress.howToLog.step1').split('{workout}')[1]}</p>
              <p>2. {t('progress.howToLog.step2')}</p>
              <p>3. {t('progress.howToLog.step3')}</p>
              <p>4. {t('progress.howToLog.step4').split('{save}')[0]}<span className="text-primary font-medium">{t('workout.finish')}</span>{t('progress.howToLog.step4').split('{save}')[1]}</p>
            </div>
          </Card>
        )
      ) : (
        <div className="mt-4">
          {[...groups].map(([label, names], i) => {
            const isOpen = !collapsed.has(label);
            return (
              <motion.section
                key={label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(i, 6) * 0.04 }}
                style={{ marginTop: i === 0 ? 0 : 'var(--fluid-section)' }}
              >
                {/* A section label on a hairline, not a filled card.
                    Read-only groupings are not user-arranged objects, so
                    per CLAUDE.md they get a rule, not a surface — and a
                    card wrapping a list of cards was two surfaces deep. */}
                <button
                  onClick={() => toggleGroup(label)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-2 min-h-[44px] pb-1.5 border-b border-border text-start"
                >
                  <span className="kicker">
                    {tFallback(`muscleGroups.${muscleKey(label)}`, label)}
                    <span className="ms-2 normal-case tracking-normal font-medium">
                      {names.length}
                    </span>
                  </span>
                  <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                  >
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </motion.div>
                </button>

                {/* Rendered only when open. That is affordable now that a
                    collapsed row is text and an SVG sparkline — it used
                    to mount a recharts LineChart per exercise, expanded,
                    on tab entry, on screen or not. */}
                {isOpen && (
                  <div>
                    {names.map((name) => (
                      <ExerciseTrendRow
                        key={name}
                        exerciseName={name}
                        logs={namedLogs}
                        sinceMs={sinceMs}
                      />
                    ))}
                  </div>
                )}
              </motion.section>
            );
          })}
        </div>
      )}
    </div>
  );
}
