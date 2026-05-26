// src/components/dashboard/LogWeightModal.jsx
//
// One-tap weight entry from the Dashboard "Log weight" quick action.
//
// Previously: tap → /progress → tap Body Metrics tab → tap "Add entry"
// → fill multi-field form → save. Four navigations for what should be
// a number + save.
//
// This modal cuts that to two taps: open + save. Internally it writes
// the same row BodyMetricsTab would (db.entities.BodyMetric.create
// with date + weight_lbs) so the data shape stays consistent and the
// entry appears in the user's body-metrics history alongside fuller
// entries.
//
// It ALSO mirrors what BodyMetricsTab does on save: update
// user_profiles.weight_lbs so the global weight (used by XP
// formulas, leaderboards, and reveal-step display) stays current.
// Without this dual write, logging weight here would never propagate
// to the rest of the app.

import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { toLbs, fromLbs } from '@/lib/weightUnit';
import UnitPill from '@/components/UnitPill';
import { reportError } from '@/lib/reportError';

export default function LogWeightModal({ open, onOpenChange, profile }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const { weightUnit } = useWeightUnit();
  const queryClient = useQueryClient();
  const inputRef = useRef(null);

  const [value, setValue] = useState('');
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  // Pre-fill from the user's most recent profile weight so the first
  // logged entry doesn't ask them to type from zero.
  useEffect(() => {
    if (!open) return;
    setDate(format(new Date(), 'yyyy-MM-dd'));
    if (profile?.weight_lbs) {
      const displayValue = fromLbs(profile.weight_lbs, weightUnit);
      setValue(String(displayValue));
    } else {
      setValue('');
    }
    // Focus shortly after the dialog has animated in. Without the
    // delay, Radix Dialog steals focus back to its content node.
    const handle = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(handle);
  }, [open, profile?.weight_lbs, weightUnit]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = parseFloat(value);
      if (!isFinite(parsed)) throw new Error('invalid_number');
      const lbs = toLbs(parsed, weightUnit);
      // Realistic-range guard — matches the inline-edit guard in
      // BodyMetricsTab so the two paths reject the same fat-finger
      // values (50–700 lbs covers everyone from a toddler to a Strongman).
      if (lbs < 50 || lbs > 700) throw new Error('out_of_range');

      // Two writes: a BodyMetric row AND a mirror onto user_profiles.
      // Previously these ran SEQUENTIALLY with no compensation — if the
      // updateMe failed (network blip after the BodyMetric INSERT
      // landed), the user saw an error but the body-metric row was
      // already committed. Tapping Save again created a SECOND
      // body-metric row for the same date because there's no unique
      // constraint. (Audit 08 #3.)
      //
      // Fix: try the profile mirror FIRST (no row creation, just an
      // UPDATE — idempotent). Only if that succeeds, create the
      // BodyMetric row. If the row INSERT fails, the user can retry
      // and we'll only have one row. If the mirror fails, no row
      // exists yet so a retry doesn't duplicate.
      await db.auth.updateMe({ weight_lbs: lbs });
      await db.entities.BodyMetric.create({
        date,
        weight_lbs: lbs,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bodyMetrics', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      toast.success(tFallback('bodyMetrics.toast.saved', 'Weight saved'));
      onOpenChange?.(false);
    },
    onError: (err) => {
      if (err?.message === 'invalid_number') {
        toast.error(tFallback('bodyMetrics.errors.invalidNumber', 'Enter a valid number.'));
        return;
      }
      if (err?.message === 'out_of_range') {
        toast.error(tFallback('bodyMetrics.errors.outOfRange', 'That value looks off — double-check it.'));
        return;
      }
      reportError(err, { feature: 'dashboard.logWeight', userEmail: user?.email, value, date });
      toast.error(tFallback('bodyMetrics.errors.saveFailed', 'Could not save — try again.'));
    },
  });

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    if (saveMutation.isPending) return;
    if (!value || !date) return;
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading">
            <Scale className="w-5 h-5 text-primary" />
            {tFallback('dashboard.logWeight.title', 'Log weight')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-muted-foreground">
                {tFallback('dashboard.logWeight.weightLabel', 'Weight')}
              </label>
              {/* Inline unit-swap pill — one tap flips the whole app's
                  weight unit. Eliminates the Settings detour for users
                  switching units mid-flow (traveling, coaching, etc). */}
              <UnitPill />
            </div>
            <Input
              ref={inputRef}
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              // Mirror the server-side guard (50-700 lbs / 23-318 kg) on
              // the HTML5 input so iOS users see native validation
              // before submitting, and the input loses focus instead of
              // accepting a 4-digit junk value and showing a toast.
              max={weightUnit === 'kg' ? '318' : '700'}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={weightUnit === 'kg' ? '70.0' : '154.0'}
              className="text-lg font-semibold h-12"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {tFallback('workout.date', 'Date')}
            </label>
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              max={format(new Date(), 'yyyy-MM-dd')}
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange?.(false)}
              className="flex-1"
              disabled={saveMutation.isPending}
            >
              {tFallback('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={!value || !date || saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {tFallback('dashboard.logWeight.cta', 'Log weight')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
