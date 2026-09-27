// src/hooks/useSaveWeight.js
//
// Saving a body weight. Lifted out of LogWeightModal so the + sheet's
// inline weight row (navigation redesign, phase 4) writes exactly what the
// modal writes, in the same order, with the same guard. Call
// `mutate({ value, date, weightUnit })` with the value as typed.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { toast } from '@/lib/toast';
import * as quests from '@/lib/data/quests';
import * as bodyMetrics from '@/lib/data/bodyMetrics';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { toLbs } from '@/lib/weightUnit';
import { reportError } from '@/lib/reportError';

// The realistic-range guard, in the stored unit. The modal's native `max`
// reads MAX_LBS too, so the browser and this guard cannot disagree.
export const MIN_LBS = 70;
export const MAX_LBS = 700;

export function useSaveWeight({ onSaved, errorContext } = {}) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ value, date, weightUnit }) => {
      const parsed = parseFloat(value);
      if (!isFinite(parsed)) throw new Error('invalid_number');
      const lbs = toLbs(parsed, weightUnit);
      if (lbs < MIN_LBS || lbs > MAX_LBS) throw new Error('out_of_range');

      // Two writes: the profile mirror FIRST, then the body_metrics row.
      // The mirror is an idempotent UPDATE, so a failure there leaves no
      // row behind and a retry cannot duplicate. The other order left a
      // committed row on a failed mirror, and Save again made a second
      // one for the same date (audit 08 #3; there is no unique constraint).
      await db.auth.updateMe({ weight_lbs: lbs });
      await bodyMetrics.create({ date, weight_lbs: lbs });
      return lbs;
    },
    onSuccess: (lbs) => {
      queryClient.invalidateQueries({ queryKey: ['bodyMetrics', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      // Target is 1 and recordAction skips rows already at target, so a
      // correction later in the day does not credit the quest twice.
      quests.recordAction(user, ACTION_TYPES.BODY_METRIC_LOGGED, 1)
        .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
        .catch(() => {});
      toast.success(tFallback('bodyMetrics.toast.saved', 'Weight saved'));
      onSaved?.(lbs);
    },
    onError: (err) => {
      if (err?.message === 'invalid_number') {
        toast.error(tFallback('bodyMetrics.errors.invalidNumber', 'Enter a valid number.'));
        return;
      }
      if (err?.message === 'out_of_range') {
        toast.error(tFallback('bodyMetrics.errors.outOfRange', 'That value looks off, double-check it.'));
        return;
      }
      reportError(err, { feature: 'dashboard.logWeight', userEmail: user?.email, ...(errorContext?.() || {}) });
      toast.error(tFallback('bodyMetrics.errors.saveFailed', 'Could not save. Try again.'));
    },
  });
}
