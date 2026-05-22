// src/components/dashboard/SyncStatus.jsx
//
// Subtle "Last synced: 2m ago" indicator on the Dashboard. Trust signal —
// users learn to glance here when something looks stale. Auto-updates the
// relative time every 30s. Tap → manually invalidates the Dashboard's
// primary queries (workouts/cardio/profile) and re-fetches.
//
// Color codes by staleness:
//   < 5 min  → muted (everything fine)
//   5-30 min → amber (might be worth a refresh)
//   > 30 min → red (probably offline or stuck)

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';

export default function SyncStatus({ dataUpdatedAt }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  // Re-render every 30 seconds so the relative time stays accurate
  // without being expensive. (1-minute granularity is plenty for a
  // status indicator; we don't need per-second updates.)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!dataUpdatedAt) return null;

  const ageMs = now - dataUpdatedAt;
  const ageMin = ageMs / 60_000;

  // Color cue scales with staleness.
  let color = 'text-muted-foreground/70';
  if (ageMin > 30) color = 'text-rose-500';
  else if (ageMin > 5) color = 'text-amber-500';

  // formatDistanceToNow rounds awkwardly for very-recent timestamps
  // ("less than a minute ago" vs "just now"); hand-format the < 1m case.
  const relative = ageMs < 60_000
    ? 'just now'
    : formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true });

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { navigator.vibrate?.(8); } catch { /* ignore */ }
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ['workouts', user?.email] }),
      queryClient.invalidateQueries({ queryKey: ['cardio_logs', user?.email] }),
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] }),
      queryClient.invalidateQueries({ queryKey: ['goals', user?.email] }),
    ]);
    setRefreshing(false);
  };

  return (
    <button
      type="button"
      onClick={handleRefresh}
      disabled={refreshing}
      className={`inline-flex items-center gap-1 text-[10px] ${color} hover:text-foreground transition-colors disabled:opacity-50`}
      aria-label="Refresh dashboard data"
    >
      <RefreshCw className={`w-2.5 h-2.5 ${refreshing ? 'animate-spin' : ''}`} />
      <span>Synced {relative}</span>
    </button>
  );
}
