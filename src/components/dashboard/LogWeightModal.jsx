// src/components/dashboard/LogWeightModal.jsx
//
// One-tap weight entry from the Dashboard "Log weight" quick action.
//
// Previously: tap → /progress → tap Body Metrics tab → tap "Add entry"
// → fill multi-field form → save. Four navigations for what should be
// a number + save.
//
// This modal cuts that to two taps: open + save.
//
// It is now the ONLY client-side writer of a body_metrics row. The Body
// tab's measurement form was removed per product direction (see the header
// of BodyMetricsTab.jsx) and onboarding's weight seed writes once, at
// signup — so the sentences above describe a flow that no longer exists,
// and are kept only because they explain why this modal is shaped the way
// it is. Anything that needs a body_metrics row comes through here.
//
// It writes TWO places on save: a body_metrics row (the history the
// Progress → Insights projection reads) and user_profiles.weight_lbs (the
// global weight used by XP formulas, leaderboards, and the reveal step).
// Without that second write, logging weight here would never propagate to
// the rest of the app. See the mutation for why the order is what it is.

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Scale } from 'lucide-react';
import { format } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs, formatWeightNumber } from '@/lib/weightUnit';
import { useSaveWeight, MAX_LBS } from '@/hooks/useSaveWeight';
import UnitPill from '@/components/UnitPill';

// The realistic-range guard, in the stored unit. Named because the JS check
// in the mutation and the native `max` on the input have to be the same
// number — they were restated separately per unit and drifted apart for
// `stone`. Anything reading these must convert with fromLbs/toLbs.
// A neutral example weight for the placeholder, shown in the user's unit
// (154 lb = 70.0 kg = 11.0 stone).
const PLACEHOLDER_LBS = 154;

export default function LogWeightModal({ open, onOpenChange, profile }) {
  const { t, tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const inputRef = useRef(null);

  const [value, setValue] = useState('');
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  // Pre-fill from the user's most recent profile weight so the first
  // logged entry doesn't ask them to type from zero. Effect deps are
  // ONLY `open` — a background profile refetch (which can land while
  // the modal is open) was previously stomping the user's typed value
  // back to the server number and re-stealing focus. The prefill
  // captures `profile.weight_lbs` from the closure at open-time; a
  // staleness window the size of one modal session is fine, since the
  // user is here to write a new entry, not read the latest.
  useEffect(() => {
    if (!open) return;
    setDate(format(new Date(), 'yyyy-MM-dd'));
    if (profile?.weight_lbs) {
      setValue(formatWeightNumber(profile.weight_lbs, weightUnit));
    } else {
      setValue('');
    }
    // Focus shortly after the dialog has animated in. Without the
    // delay, Radix Dialog steals focus back to its content node.
    const handle = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The save lives in useSaveWeight so the + sheet's inline weight row
  // writes exactly the same two rows in the same order.
  const saveMutation = useSaveWeight({
    onSaved: () => onOpenChange?.(false),
    errorContext: () => ({ value, date }),
  });

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    if (saveMutation.isPending) return;
    if (!value || !date) return;
    saveMutation.mutate({ value, date, weightUnit });
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
              // Mirror the JS guard (70–700 lbs) on the HTML5 input so iOS
              // users see native validation before submitting, and the input
              // loses focus instead of accepting a 4-digit junk value and
              // showing a toast.
              //
              // Both of these used to branch on kg alone, so `stone` — the
              // third member of VALID in WeightUnitContext, selectable in
              // Settings — fell to the lbs arm: a 700 max (49,000 lb once
              // converted) and a placeholder suggesting 154 stone. Every
              // value the native control accepted above 50 was then rejected
              // by the JS guard as "looks off", which is the browser and the
              // app disagreeing about the same field. Derive both from the
              // guard instead of restating it per unit.
              max={String(Math.floor(fromLbs(MAX_LBS, weightUnit)))}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={fromLbs(PLACEHOLDER_LBS, weightUnit).toFixed(1)}
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
