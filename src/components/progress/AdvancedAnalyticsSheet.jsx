// Advanced Analytics, as a bottom sheet.
//
// Replaces a centered Radix Dialog (max-w-2xl, max-h-[80vh]) that read as a
// desktop modal on a phone — no grab handle, never touching the bottom edge.
// Design: Penpot page "Analytics + Personal Bests — as sheets", boards A→B,
// with the ledger on board E. Spec: docs/analytics-personal-bests-sheets.md
//
// THE THREE THINGS THAT ARE NOT JUST A NEW SHELL
//
// 1. Nine rows in three labelled groups, not ten flat ones. The old list
//    gave every figure an identical card and a 40px icon tile, so "Total
//    Workouts" read exactly like "Most Reps" — ten bare numbers in ten
//    identical boxes. The group labels ARE the hierarchy: they say what
//    KIND of question each number answers, which no amount of restyling
//    ten identical rows can do.
//
// 2. One hue. The old rows carried primary x4, accent, success, info x3 and
//    destructive x1, assigned per row with nothing behind the assignment —
//    `text-destructive` on "Top Muscle Group" rendered a neutral fact as a
//    warning. Only the hero figure takes a colour now. That resolves it by
//    DELETION rather than by re-deciding: there is no per-row hue left to
//    get wrong. ("Four hues, no exceptions.")
//
// 3. A row with no data is DROPPED, not rendered as zero. "A section with
//    no data must not render as zeros — a 0 reads as a failure the user did
//    not commit." Total Time and Avg Session showed "0 min" to everyone for
//    months because the client wrote `duration_minutes` and the column is
//    `duration_min` (fixed, d0a15d2b). Sessions saved before that fix carry
//    no duration and cannot be backfilled, so those two rows still have to
//    be able to disappear rather than lie.
//
// NO DIAL, DELIBERATELY (kegan, 2026-08-10). QuestsSheet and ReadinessSheet
// both lead with a ReadinessRing. This is lifetime reference data with no
// number that belongs in a ring, so the dial's slot holds the one figure
// someone opens this sheet to see. The precedent for differing below shared
// chrome is QuestsSheet's own head comment, which distinguishes itself from
// Readiness as "a reading surface" against one that "owns their forms".

import React, { useMemo } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight, fromLbs } from '@/lib/weightUnit';
import { translateExerciseName } from '@/lib/exerciseTranslations';
import { useNumberFormatter } from '@/lib/intl';
import { workoutDurationMin } from '@/lib/workoutDuration';
import { PERIODS } from '@/lib/progressPeriod';
import SheetShell from '@/components/sheets/SheetShell';

const PERIOD_LABEL_FALLBACK = { week: 'This week', month: 'This month', year: 'This year', all: 'All time' };
const PERIOD_SHORT_FALLBACK = { week: 'Week', month: 'Month', year: 'Year', all: 'All' };

/** 96 h 20 m — minutes are noise past a few hours, hours alone are a lie under one. */
function formatDuration(totalMin, tFallback) {
  const mins = Math.round(totalMin);
  if (mins < 60) return tFallback('analyticsSheet.minutes', '{n} min', { n: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0
    ? tFallback('analyticsSheet.hours', '{h} h', { h })
    : tFallback('analyticsSheet.hoursMinutes', '{h} h {m} m', { h, m });
}

// FOLLOWS THE PAGE'S PERIOD (Progress audit round 2, 2026-09-30). The sheet
// is opened from inside the period section, under "This week", and used to
// answer for all time regardless. `logs` is the period's logs now, and the
// period control is repeated in the sheet so it can be widened without
// closing it; both write the same state.
export default function AdvancedAnalyticsSheet({
  open, onClose, logs = [], period = 'all', onPeriodChange, children,
}) {
  const { t, tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const nf = useNumberFormatter();

  const model = useMemo(() => {
    if (!Array.isArray(logs) || logs.length === 0) return null;

    const byExercise = new Map();
    let totalVolume = 0;
    let totalMinutes = 0;
    let sessionsWithDuration = 0;

    logs.forEach((log) => {
      // Only sessions that actually carry a duration feed the averages.
      // Dividing by logs.length would drag every average toward zero using
      // rows that simply predate the column fix.
      const mins = workoutDurationMin(log);
      if (mins > 0) { totalMinutes += mins; sessionsWithDuration += 1; }

      (log.exercises || []).forEach((ex) => {
        let exVolume = 0;
        (ex.sets || []).forEach((s) => {
          exVolume += (Number(s.weight) || 0) * (Number(s.reps) || 0);
        });
        totalVolume += exVolume;

        if (!ex.name) return;
        if (!byExercise.has(ex.name)) byExercise.set(ex.name, { maxWeight: 0, maxReps: 0, timesPerformed: 0 });
        const rec = byExercise.get(ex.name);
        rec.timesPerformed += 1;
        (ex.sets || []).forEach((s) => {
          const w = Number(s.weight) || 0;
          const r = Number(s.reps) || 0;
          if (w > rec.maxWeight) rec.maxWeight = w;
          if (r > rec.maxReps) rec.maxReps = r;
        });
      });
    });

    const all = [...byExercise.entries()].map(([name, v]) => ({ name, ...v }));
    // reduce, not Math.max(...spread) — the spread put one argument on the
    // stack per exercise, which is fine at 34 and not at 10k. (Audit 11 #32.)
    const strongest = all.reduce((best, e) => (e.maxWeight > (best?.maxWeight ?? -1) ? e : best), null);
    const mostReps = all.reduce((best, e) => (e.maxReps > (best?.maxReps ?? -1) ? e : best), null);
    const mostPerformed = all.reduce((best, e) => (e.timesPerformed > (best?.timesPerformed ?? -1) ? e : best), null);

    return {
      totalVolume,
      workouts: logs.length,
      totalMinutes,
      avgMinutes: sessionsWithDuration > 0 ? totalMinutes / sessionsWithDuration : 0,
      hasDuration: sessionsWithDuration > 0,
      uniqueExercises: byExercise.size,
      strongest,
      mostReps,
      mostPerformed,
    };
  }, [logs]);

  const kicker = tFallback('analyticsSheet.kicker', 'Charts and analytics');
  const periodLabel = tFallback(`progress.period.${period}`, PERIOD_LABEL_FALLBACK[period] || PERIOD_LABEL_FALLBACK.all);

  if (!open) return null;

  const periodControl = onPeriodChange && (
    <div className="mt-3 flex rounded-lg bg-secondary/60 p-0.5" role="group" aria-label={tFallback('progress.period.pick', 'Period')}>
      {PERIODS.map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={period === f}
          onClick={() => onPeriodChange(f)}
          className={`flex-1 min-h-[44px] px-2.5 rounded-md text-label font-semibold transition-colors ${period === f ? 'bg-background text-foreground' : 'text-muted-foreground'}`}
        >
          {tFallback(`progress.periodShort.${f}`, PERIOD_SHORT_FALLBACK[f])}
        </button>
      ))}
    </div>
  );

  if (!model) {
    return (
      <SheetShell open={open} onClose={onClose} kicker={kicker} labelledBy="analytics-sheet-title">
        {periodControl}
        <p className="text-sm text-muted-foreground mt-6 mb-4">
          {period === 'all'
            ? t('progress.noDataDesc')
            : tFallback('analyticsSheet.emptyPeriod', 'No workouts logged {period}.', { period: periodLabel.toLowerCase() })}
        </p>
      </SheetShell>
    );
  }

  // Every row is { label, value } and any row may be null — a null is
  // dropped, never rendered as a zero. See the head comment.
  const groups = [
    {
      label: tFallback('analyticsSheet.group.load', 'Load'),
      rows: [
        model.strongest && model.strongest.maxWeight > 0 && {
          label: tFallback('analyticsSheet.strongestLift', 'Strongest lift'),
          value: `${formatWeight(model.strongest.maxWeight, weightUnit)} · ${translateExerciseName(model.strongest.name, language)}`,
        },
        model.mostReps && model.mostReps.maxReps > 0 && {
          label: tFallback('analyticsSheet.mostReps', 'Most reps'),
          value: `${model.mostReps.maxReps} · ${translateExerciseName(model.mostReps.name, language)}`,
        },
        // No "Total volume" row: the hero above IS lifetime volume, so the
        // row restated the same number 250px lower — and rendered it
        // ungrouped ("592195 lbs") next to the hero's "592,195", which is
        // how the duplication got noticed. A figure that has already been
        // given the largest type on the sheet has been said.
      ],
    },
    {
      label: tFallback('analyticsSheet.group.consistency', 'Consistency'),
      rows: [
        // No "Total workouts" row: the line under the hero says it.
        // Both duration rows vanish together when nothing carries a
        // duration, rather than reporting a confident 0 min each.
        model.hasDuration && {
          label: tFallback('analyticsSheet.totalTime', 'Total time'),
          value: formatDuration(model.totalMinutes, tFallback),
        },
        model.hasDuration && {
          label: tFallback('analyticsSheet.avgSession', 'Avg session'),
          value: formatDuration(model.avgMinutes, tFallback),
        },
      ],
    },
    {
      label: tFallback('analyticsSheet.group.range', 'Variety'),
      rows: [
        {
          label: tFallback('analyticsSheet.uniqueExercises', 'Unique exercises'),
          value: String(model.uniqueExercises),
        },
        model.mostPerformed && {
          label: tFallback('analyticsSheet.mostPerformed', 'Most performed'),
          value: `${translateExerciseName(model.mostPerformed.name, language)} · ${tFallback('analyticsSheet.timesX', '{n}×', { n: model.mostPerformed.timesPerformed })}`,
        },
        // No "Top muscle group" row: it is the first bar of the volume
        // chart below, with its number beside it.
      ],
    },
  ]
    .map(g => ({ ...g, rows: g.rows.filter(Boolean) }))
    .filter(g => g.rows.length > 0);

  return (
    <SheetShell open={open} onClose={onClose} kicker={kicker} labelledBy="analytics-sheet-title">
      {periodControl}
      {/* The dial's slot. One figure, the one this sheet exists to report.
          Foreground, not primary: the orange is kept for actions. */}
      <div className="mt-5">
        {/* The number alone, grouped for the locale; the unit is the line
            below rather than a suffix, so the figure reads as the headline
            it is. formatWeight would re-attach the unit here. */}
        <p className="font-heading font-black text-display leading-none tabular-nums text-foreground">
          {nf(Math.round(fromLbs(model.totalVolume, weightUnit)))}
        </p>
        <p className="text-sm text-muted-foreground mt-1.5">
          {tFallback('analyticsSheet.heroCaptionUnit', '{unit} lifted', { unit: weightUnit })}
        </p>
        <p className="text-micro text-muted-foreground mt-0.5">
          {periodLabel}
          {' · '}
          {tFallback(
            model.workouts === 1 ? 'analyticsSheet.heroSub_one' : 'analyticsSheet.heroSub_other',
            model.workouts === 1 ? '{n} workout' : '{n} workouts',
            { n: model.workouts },
          )}
        </p>
      </div>

      {groups.map(group => (
        <section key={group.label} className="mt-6">
          <h3 className="text-micro font-bold text-muted-foreground mb-2">{group.label}</h3>
          {group.rows.map(row => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 py-2 border-b border-border">
              <span className="text-sm text-muted-foreground shrink-0">{row.label}</span>
              <span className="text-sm font-bold text-end break-words">{row.value}</span>
            </div>
          ))}
        </section>
      ))}

      {/* The charts that used to hang off the old dialog's children prop. */}
      {children && (
        <section className="mt-6">
          <h3 className="text-micro font-bold text-muted-foreground pb-2 mb-2 border-b border-border">
            {tFallback('analyticsSheet.group.charts', 'Charts')}
          </h3>
          {children}
        </section>
      )}
    </SheetShell>
  );
}

export { formatDuration };
