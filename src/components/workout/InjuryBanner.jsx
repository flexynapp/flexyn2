// src/components/workout/InjuryBanner.jsx
// Shows a compact "Recovery Mode On" banner in the Workout tab when the user
// has active injuries. Tapping it opens InjuryForm.
// Also handles client-side recovery date checks (3-day warning + clearance prompt).

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { differenceInCalendarDays, format, addDays } from 'date-fns';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import * as injuries from '@/lib/data/injuries';

// Clearance prompt shown when an injury's estimated_recovery_date is reached
function ClearancePrompt({ injury, onClear, onExtend, onDismiss }) {
  const [extendDate, setExtendDate] = useState('');
  const [mode, setMode] = useState(null); // null | 'extend'

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 mb-2"
    >
      <p className="text-sm font-semibold mb-0.5">
        Recovery check-in — {injury.muscle_group}
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        Your estimated recovery date has arrived. Are you cleared to train?
      </p>
      {!mode && (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-8 text-xs gap-1" onClick={() => onClear(injury.id)}>
            <CheckCircle2 className="w-3 h-3" /> Yes, I'm cleared
          </Button>
          <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => setMode('extend')}>
            Not yet
          </Button>
        </div>
      )}
      {mode === 'extend' && (
        <div className="flex gap-2">
          <input
            type="date"
            value={extendDate}
            onChange={e => setExtendDate(e.target.value)}
            min={format(addDays(new Date(), 1), 'yyyy-MM-dd')}
            className="flex-1 text-xs h-8 rounded-md border border-border bg-background px-2"
          />
          <Button size="sm" className="h-8 text-xs" onClick={() => { if (extendDate) onExtend(injury.id, extendDate); }}>
            Update
          </Button>
        </div>
      )}
    </motion.div>
  );
}

export default function InjuryBanner({ onOpenForm }) {
  const { user } = useAuth();
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
    onSuccess: () => { invalidate(); toast.success('Injury cleared. Volume reintroduction starts at 50% for 2 weeks.'); },
    onError: (err) => {
      reportError(err, { feature: 'injuries.clear', level: 'warning', userEmail: user?.email });
      toast.error('Could not clear injury. Try again.');
    },
  });

  const extendMutation = useMutation({
    mutationFn: ({ id, date }) => injuries.extendRecovery(id, date),
    onSuccess: () => { invalidate(); toast.success('Recovery date updated.'); },
    onError: (err) => {
      reportError(err, { feature: 'injuries.extend', level: 'warning', userEmail: user?.email });
      toast.error('Could not update recovery date. Try again.');
    },
  });

  // Injuries whose estimated_recovery_date has arrived (≤ today) — show clearance prompt
  const today = new Date().toISOString().split('T')[0];
  const dueForClearance = activeInjuries.filter(
    i => i.estimated_recovery_date && i.estimated_recovery_date <= today
  );

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
        toast.info(`${inj.muscle_group} recovery date in 3 days. How are you feeling?`);
        warned = warned ? warned + inj.id + ',' : ',' + inj.id + ',';
        sessionStorage.setItem(upcomingKey, warned);
      }
    }
  }, [activeInjuries]);

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
            onClear={id => clearMutation.mutate(id)}
            onExtend={(id, date) => extendMutation.mutate({ id, date })}
          />
        ))}
      </AnimatePresence>

      <motion.button
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={onOpenForm}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/25 hover:bg-orange-500/15 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-orange-500 shrink-0" />
          <span className="text-sm font-medium text-orange-500">
            {distinctInjuries.length === 1
              ? `Recovery Mode — ${distinctInjuries[0].muscle_group}`
              : `Recovery Mode — ${distinctInjuries.length} active injuries`}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">Manage →</span>
      </motion.button>
    </div>
  );
}
