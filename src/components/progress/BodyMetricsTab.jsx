import React, { useMemo } from 'react';
import { filterAfterReset } from '@/lib/accountReset';
import { LOG_FETCH_LIMIT } from '@/lib/constants';
import CycleTrackerCard from '@/components/wellness/CycleTrackerCard';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import MuscleGroupHeatmap from '@/components/progress/MuscleGroupHeatmap';

// The Body tab is intentionally minimal: just the body heat map (plus
// the opt-in cycle tracker, which self-hides when disabled). Height,
// weight, and age are edited in Settings; body-measurement logging was
// removed here per product direction — the heat map is the whole page.
export default function BodyMetricsTab() {
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });

  // Same queryKey as Progress.jsx, so React Query serves both from one
  // cache entry and whichever mounts first supplies the queryFn. The two
  // therefore have to request the SAME limit — they carried 200 and 1000
  // for a moment, which makes the row count depend on mount order.
  const { data: rawLogs = [] } = useQuery({
    queryKey: ['workoutLogs', user?.email],
    queryFn: () => db.entities.WorkoutLog.filter({ created_by: user.email }, '-date', LOG_FETCH_LIMIT),
    enabled: !!user?.email,
  });

  const logs = useMemo(() => filterAfterReset(rawLogs, profile), [rawLogs, profile]);

  return (
    <div className="space-y-6">
      {/* Cycle tracker — opt-in, owner-only. Renders nothing unless the
          user has enabled it in Settings. */}
      <CycleTrackerCard profile={profile} />

      {/* Body Heat Map — front/back anatomical figure coloured by
          per-muscle recovery / training volume (wired to real logs).
          Renders even with no logs (all-fresh + a hint). */}
      <MuscleGroupHeatmap logs={logs} />
    </div>
  );
}
