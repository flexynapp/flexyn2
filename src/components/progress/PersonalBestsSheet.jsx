// Personal Bests, as a bottom sheet.
//
// Design: Penpot page "Analytics + Personal Bests — as sheets", boards C→D,
// ledger on board E. Spec: docs/analytics-personal-bests-sheets.md
//
// This one did NOT change presentation the way Advanced Analytics did — it
// already used the generic BottomSheet, so it already slid up and
// swipe-dismissed. What it lacked was the bespoke chrome (kicker, hero,
// resting-fill close) and, more importantly, an order and a way to search.
//
// FOUR CHANGES, EACH AGAINST SOMETHING MEASURED
//
// 1. HEAVIEST FIRST. The list was sorted by `name.localeCompare` —
//    alphabetical, in a list you open to see your heaviest lifts. There is
//    no sort toggle and that is deliberate: this list has never had a
//    defensible order at all, so it gets one good one before it gets a
//    control. Add the toggle when someone asks for a second order, not in
//    anticipation of them.
//
// 2. ROWS ON HAIRLINES, NOT CARDS. Each PR was a Card holding two nested
//    tinted boxes — surfaces inside a surface, for data nobody arranged.
//    "Cards mark discrete, user-arranged objects. Read-only data that is
//    not a widget gets hairline dividers instead."
//
// 3. NO PER-ROW ANIMATION. Every row ran a Trophy on `repeat: Infinity`,
//    plus a staggered mount spring and a `whileHover` scale that a
//    touchscreen can never trigger. Forty exercises meant forty perpetual loops.
//
// 4. A FILTER, once the list is long enough to need one. Client-side over
//    rows already in hand — no query, no network. A lifter with sixty
//    exercises had no way to find one.
//
// Reps move to the secondary line rather than getting a box of their own.
// The old two-box layout gave reps equal billing with load, and they are
// not the same kind of achievement.

import React, { useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { format } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight } from '@/lib/weightUnit';
import { getDateLocale } from '@/lib/dateLocales';
import { parseLocalDate } from '@/lib/dateUtils';
import { translateExerciseName } from '@/lib/exerciseTranslations';
import SheetShell from '@/components/sheets/SheetShell';

// Past this many exercises the list stops being scannable and the filter
// earns its row. Below it, a search box over six items is furniture.
const FILTER_THRESHOLD = 12;

export default function PersonalBestsSheet({ open, onClose, logs = [], onViewHistory }) {
  const { t, tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);
  const [query, setQuery] = useState('');

  const bests = useMemo(() => {
    const map = {};
    (logs || []).forEach((log) => {
      if (!log?.date) return;
      (log.exercises || []).forEach((ex) => {
        if (!ex?.name || !ex.sets?.length) return;
        if (!map[ex.name]) map[ex.name] = { name: ex.name, weight: 0, weightDate: null, reps: 0, sessions: 0 };
        const rec = map[ex.name];
        rec.sessions += 1;
        ex.sets.forEach((s) => {
          const w = Number(s.weight) || 0;
          const r = Number(s.reps) || 0;
          if (w > rec.weight) { rec.weight = w; rec.weightDate = log.date; }
          if (r > rec.reps) rec.reps = r;
        });
      });
    });
    return Object.values(map)
      // Loaded lifts first, heaviest down; then the bodyweight ones, most
      // reps down. Sorting on the stored lbs is safe in every unit — order
      // is invariant under a positive scalar conversion — so this does not
      // need to know what the user reads in.
      //
      // Bodyweight work is not "0 lb and therefore last". A pull-up has no
      // number on the bar and the achievement is the rep count, so it gets
      // ranked by the thing it actually measures rather than tying at zero
      // with everything else and falling back to the alphabet.
      .sort((a, b) => {
        const aLoaded = a.weight > 0, bLoaded = b.weight > 0;
        if (aLoaded !== bLoaded) return aLoaded ? -1 : 1;
        if (aLoaded) return b.weight - a.weight || a.name.localeCompare(b.name);
        return b.reps - a.reps || a.name.localeCompare(b.name);
      });
  }, [logs]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bests;
    // Match the TRANSLATED name too — filtering a Spanish list by the
    // English column value is a search box that does not work in Spanish.
    return bests.filter(pb =>
      pb.name.toLowerCase().includes(q) ||
      translateExerciseName(pb.name, language).toLowerCase().includes(q));
  }, [bests, query, language]);

  const kicker = tFallback('pbSheet.kicker', 'PERSONAL BESTS');
  // The headline best. When it carries no load — a pull-up, a dip, anyone
  // training entirely bodyweight — the figure is the REP COUNT, not "0 lbs".
  // formatWeight(0) is a finite number and renders a confident zero, which
  // on the largest type on the sheet reads as "your best lift is nothing".
  // (kegan, 2026-08-10.)
  const heaviest = bests[0];
  const heroIsReps = !!heaviest && heaviest.weight <= 0;

  if (!open) return null;

  return (
    <SheetShell open={open} onClose={onClose} kicker={kicker} labelledBy="pb-sheet-title">
      {bests.length === 0 ? (
        <div className="mt-8 mb-6 text-center">
          <Trophy className="w-9 h-9 text-muted-foreground mx-auto mb-3" />
          <p className="font-heading font-semibold">{t('progress.noData')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('progress.logWorkoutsForAnalytics')}</p>
        </div>
      ) : (
        <>
          {/* The dial's slot — the single fact this sheet exists to report. */}
          <div className="mt-3">
            <p className="font-heading font-black text-display leading-none tabular-nums text-primary">
              {heroIsReps
                ? tFallback(
                    heaviest.reps === 1 ? 'pbSheet.heroReps_one' : 'pbSheet.heroReps_other',
                    heaviest.reps === 1 ? '{n} rep' : '{n} reps',
                    { n: heaviest.reps },
                  )
                : formatWeight(heaviest.weight, weightUnit)}
            </p>
            <p className="text-sm text-muted-foreground mt-1.5">
              {heroIsReps
                ? tFallback('pbSheet.heroCaptionReps', '{exercise}, your best set', {
                    exercise: translateExerciseName(heaviest.name, language),
                  })
                : tFallback('pbSheet.heroCaption', '{exercise}, your heaviest lift', {
                    exercise: translateExerciseName(heaviest.name, language),
                  })}
            </p>
            <p className="text-micro text-muted-foreground mt-0.5">
              {tFallback(
                bests.length === 1 ? 'pbSheet.count_one' : 'pbSheet.count_other',
                bests.length === 1 ? '{n} exercise with a recorded best' : '{n} exercises with a recorded best',
                { n: bests.length },
              )}
            </p>
          </div>

          {bests.length > FILTER_THRESHOLD && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tFallback('pbSheet.filterPlaceholder', 'Filter exercises')}
              aria-label={tFallback('pbSheet.filterPlaceholder', 'Filter exercises')}
              className="mt-5 w-full h-9 px-3 rounded-lg bg-background border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}

          <div className="mt-5">
            {shown.map((pb) => {
              // Same rule as the hero: a best with no load is measured in
              // reps. The row headline becomes the rep count, and the
              // secondary line drops the "best N reps" it would otherwise
              // repeat — saying "24 reps" twice on one row is worse than
              // the "0 lbs" it replaced.
              const isReps = pb.weight <= 0;
              const row = (
                <>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-tight truncate">
                      {translateExerciseName(pb.name, language)}
                    </p>
                    <p className="text-micro text-muted-foreground mt-0.5">
                      {isReps
                        ? tFallback('pbSheet.bodyweight', 'bodyweight')
                        : (pb.reps > 0 && tFallback(
                            pb.reps === 1 ? 'pbSheet.bestReps_one' : 'pbSheet.bestReps_other',
                            pb.reps === 1 ? 'best {n} rep' : 'best {n} reps',
                            { n: pb.reps },
                          ))}
                      {(isReps || pb.reps > 0) && pb.weightDate ? '  ·  ' : ''}
                      {pb.weightDate && format(parseLocalDate(pb.weightDate), 'd MMM', { locale: dateLocale })}
                    </p>
                  </div>
                  <span className="font-heading font-black text-sm text-primary shrink-0 tabular-nums ms-3">
                    {isReps
                      ? tFallback(
                          pb.reps === 1 ? 'pbSheet.heroReps_one' : 'pbSheet.heroReps_other',
                          pb.reps === 1 ? '{n} rep' : '{n} reps',
                          { n: pb.reps },
                        )
                      : formatWeight(pb.weight, weightUnit)}
                  </span>
                </>
              );

              // The whole row is the affordance, not a "History ›" link in
              // the corner — the old card put a 10px target next to a 358px
              // one that did nothing.
              return onViewHistory ? (
                <button
                  key={pb.name}
                  onClick={() => onViewHistory(pb.name)}
                  className="w-full flex items-baseline justify-between py-2.5 border-b border-border text-start hover:bg-secondary/40 active:bg-secondary/40 transition-colors"
                >
                  {row}
                </button>
              ) : (
                <div key={pb.name} className="flex items-baseline justify-between py-2.5 border-b border-border">
                  {row}
                </div>
              );
            })}

            {shown.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">
                {tFallback('pbSheet.noMatches', 'No exercises match “{query}”.', { query: query.trim() })}
              </p>
            )}
          </div>
        </>
      )}
    </SheetShell>
  );
}
