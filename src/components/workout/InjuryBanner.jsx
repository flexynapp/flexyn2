// src/components/workout/InjuryBanner.jsx
// Shows a compact "Recovery Mode On" banner in the Workout tab when the user
// has active injuries. Tapping it opens InjuryForm.
// Also handles the recovery check-in — the only thing in the app that offers a
// restricted muscle group BACK — plus the 3-day warning toast.

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import * as injuries from '@/lib/data/injuries';
import { useLanguage } from '@/lib/LanguageContext';

/** English label -> the muscle-group key `src/locales/*.json` publishes. */
const muscleKey = (name) => String(name || '').toLowerCase();

// The check-in. Reached by an explicit recovery date when one exists, and by
// the injury's AGE when it doesn't — which is every injury in production.
function ClearancePrompt({ injury, onClear, onSnooze, busy }) {
  const { tFallback } = useLanguage();
  const area = tFallback(muscleKey(injury.muscle_group), injury.muscle_group);
  // The copy can no longer say "your estimated recovery date has arrived",
  // because for every injury on file there isn't one — the prompt is now
  // reached by age. It says how long it has been instead, which is the fact
  // the user needs to answer the question.
  const daysOpen = differenceInCalendarDays(new Date(), parseISO(injury.injured_at));
  const hasEta = !!injury.estimated_recovery_date;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-3 mb-2"
    >
      <p className="text-sm font-semibold mb-0.5">
        {tFallback('injuries.checkIn.title', 'Still bothering you? — {area}', { area })}
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        {hasEta
          ? tFallback('injuries.checkIn.dateArrived', 'The date you set has arrived. Are you cleared to train?')
          : daysOpen === 1
            ? tFallback('injuries.checkIn.ageYesterday', "You logged this yesterday, and it's still coming out of your sessions.")
            : tFallback('injuries.checkIn.ageDays', "You logged this {days} days ago, and it's still coming out of your sessions.", { days: daysOpen })}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 h-8 text-xs gap-1"
          disabled={busy}
          onClick={() => onClear(injury.id)}
        >
          <CheckCircle2 className="w-3 h-3" /> {tFallback('injuries.checkIn.cleared', "I'm cleared")}
        </Button>
        {/* One tap. This was a date field, which is the same field nobody
            fills in on the way in — so deferring required typing a date, and
            reaching this prompt at all required having typed one already. */}
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-8 text-xs"
          disabled={busy}
          onClick={() => onSnooze(injury.id, injury.severity)}
        >
          {tFallback('injuries.checkIn.stillHurts', 'Still hurts')}
        </Button>
      </div>
    </motion.div>
  );
}

export default function InjuryBanner({ onOpenForm }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();

  // Key MUST be distinct from InjuryForm's ['injuries','all',uid] query.
  // They previously shared ['injuries', uid] with DIFFERENT queryFns
  // (active-only here vs. all-including-cleared in the form), so the
  // form's full list would land in the shared cache and the banner would
  // count cleared injuries as active ("3 active injuries" after clearing
  // all of them). Distinct keys + prefix invalidation fixes it.
  const { data: activeInjuries = [] } = useQuery({
    queryKey: ['injuries', 'active', user?.id],
    queryFn: injuries.listActiveInjuries,
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['injuries'] });

  const clearMutation = useMutation({
    mutationFn: injuries.clearInjury,
    onSuccess: () => {
      invalidate();
      toast.success(tFallback('injuries.toast.clearedVolume', 'Injury cleared. Volume reintroduction starts at 50% for 2 weeks.'));
    },
    onError: (err) => {
      reportError(err, { feature: 'injuries.clear', level: 'warning', userEmail: user?.email });
      toast.error(tFallback('injuries.toast.clearFailed', 'Could not clear injury. Try again.'));
    },
  });

  // "Not yet" is one tap now. It used to open a date field, which is the same
  // field nobody fills in on the way in — so the only way to defer a check-in
  // was to type a date, and the only way to reach the check-in at all was to
  // have typed one already. `snoozeCheckIn` pushes it out by the injury's own
  // interval and, as a side effect, finally gives the countdown and the 3-day
  // warning a date to work from.
  const snoozeMutation = useMutation({
    mutationFn: ({ id, severity }) => injuries.snoozeCheckIn(id, severity),
    onSuccess: (_data, { severity }) => {
      invalidate();
      toast.success(tFallback(
        'injuries.toast.snoozed',
        "Keeping it out of your sessions. We'll ask again in {days} days.",
        { days: injuries.checkInIntervalDays(severity) },
      ));
    },
    onError: (err) => {
      reportError(err, { feature: 'injuries.snooze', level: 'warning', userEmail: user?.email });
      toast.error(tFallback('injuries.toast.snoozeFailed', 'Could not update. Try again.'));
    },
  });

  // Injuries due a check-in. `isCheckInDue` prefers an explicit recovery date
  // and falls back to the injury's AGE when there isn't one — which is every
  // injury in production, all six of them. The old filter required
  // `estimated_recovery_date`, so this prompt had never once rendered for
  // anybody, and an injury logged without a date restricted training forever
  // with nothing ever offering it back.
  const dueForClearance = activeInjuries.filter(i => injuries.isCheckInDue(i));

  // Injuries 3 days from recovery date — show warning toast once per session
  useEffect(() => {
    const upcomingKey = 'fn_injury_warned';
    // Store as a comma-separated list with sentinel commas at the
    // boundaries so `id1` can't false-positive-match `id1xyz` (which
    // the previous raw substring match did). (Audit 09 #L-6.)
    const rawWarned = sessionStorage.getItem(upcomingKey) || '';
    let warned = rawWarned;
    if (warned && !warned.startsWith(',')) warned = ',' + warned + ',';
    for (const inj of activeInjuries) {
      if (!inj.estimated_recovery_date) continue;
      // Use calendar-day comparison rather than 24-hour rounding so users
      // in negative UTC offsets don't see an off-by-one countdown when
      // the recovery date is stored as UTC midnight (e.g., '2026-05-21').
      const daysLeft = differenceInCalendarDays(new Date(inj.estimated_recovery_date), new Date());
      const idMarker = ',' + inj.id + ',';
      if (daysLeft === 3 && !warned.includes(idMarker)) {
        toast.info(tFallback('injuries.toast.warnThreeDays', '{area} recovery date in 3 days. How are you feeling?', {
          area: tFallback(muscleKey(inj.muscle_group), inj.muscle_group),
        }));
        warned = warned ? warned + inj.id + ',' : ',' + inj.id + ',';
        sessionStorage.setItem(upcomingKey, warned);
      }
    }
    // tFallback is in here rather than suppressed: it changes identity when
    // the user switches language, and re-running is harmless — the
    // sessionStorage marker above means an id can only ever be warned once.
  }, [activeInjuries, tFallback]);

  // De-dupe the DISPLAY count by muscle group so the same body part
  // logged more than once (or stale duplicate rows) doesn't inflate the
  // banner to "3 active injuries" when it's really one bad shoulder.
  // (Exclusion logic in getExcludedMuscleGroups already works off the
  // full set — this only affects what the banner shows.)
  const distinctInjuries = [];
  const seenGroups = new Set();
  for (const inj of activeInjuries) {
    const key = (inj.muscle_group || inj.id || '').toString().toLowerCase();
    if (seenGroups.has(key)) continue;
    seenGroups.add(key);
    distinctInjuries.push(inj);
  }

  if (distinctInjuries.length === 0) return null;

  return (
    <div className="mb-3">
      <AnimatePresence>
        {dueForClearance.map(inj => (
          <ClearancePrompt
            key={inj.id}
            injury={inj}
            busy={clearMutation.isPending || snoozeMutation.isPending}
            onClear={id => clearMutation.mutate(id)}
            onSnooze={(id, severity) => snoozeMutation.mutate({ id, severity })}
          />
        ))}
      </AnimatePresence>

      <motion.button
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={onOpenForm}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/25 hover:bg-primary/15 active:bg-primary/15 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-primary">
            {distinctInjuries.length === 1
              ? tFallback('injuries.banner.recoveryMode', 'Recovery Mode — {area}', {
                  area: tFallback(muscleKey(distinctInjuries[0].muscle_group), distinctInjuries[0].muscle_group),
                })
              : tFallback('injuries.banner.recoveryCount', 'Recovery Mode — {count} active injuries', {
                  count: distinctInjuries.length,
                })}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{tFallback('injuries.banner.manage', 'Manage →')}</span>
      </motion.button>
    </div>
  );
}
