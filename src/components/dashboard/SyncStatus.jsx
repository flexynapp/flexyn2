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
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';

export default function SyncStatus({ dataUpdatedAt }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { tFallback, language } = useLanguage();
  const dateLocale = getDateLocale(language);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  // Re-render every 30 seconds so the relative time stays accurate
  // without being expensive. Visibility-gated — no point ticking a
  // background tab's "last synced" label; refresh on visibility
  // restore catches the user up.
  useEffect(() => {
    let id = null;
    // Track unmount so a queued visibilitychange handler that fires
    // AFTER cleanup ran can't start an orphaned setInterval. Without
    // this guard, a tab returning to visibility during the
    // teardown window would leave the interval ticking forever.
    let unmounted = false;
    const start = () => {
      if (unmounted) return;
      if (id) clearInterval(id);
      id = setInterval(() => setNow(Date.now()), 30_000);
    };
    const stop = () => { if (id) { clearInterval(id); id = null; } };
    const onVis = () => {
      if (unmounted) return;
      if (document.visibilityState === 'visible') { setNow(Date.now()); start(); }
      else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      unmounted = true;
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!dataUpdatedAt) return null;

  const ageMs = now - dataUpdatedAt;
  const ageMin = ageMs / 60_000;

  // Color cue scales with staleness.
  let color = 'text-muted-foreground/70';
  if (ageMin > 30) color = 'text-destructive';
  else if (ageMin > 5) color = 'text-primary';

  // formatDistanceToNow rounds awkwardly for very-recent timestamps
  // ("less than a minute ago" vs "just now"); hand-format the < 1m case.
  // Pass `locale` so the relative phrase renders in the user's language.
  const relative = ageMs < 60_000
    ? tFallback('sync.justNow', 'just now')
    : formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true, locale: dateLocale });

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { navigator.vibrate?.(8); } catch { /* ignore */ }
    // Query keys must match what the consuming queries actually use.
    // Audit on 2026-05-23 caught two typos here that silently no-op'd
    // the refresh:
    //   • 'workouts'    — every consumer uses 'workoutLogs'
    //     (Dashboard.jsx:297, Workout.jsx:277, Progress.jsx:331, etc)
    //   • 'cardio_logs' — every consumer uses 'cardioLogs'
    //     (CardioDetailModal.jsx:125, CardioGoals.jsx:229, etc)
    // The button still spun + showed "Synced just now", but the
    // workout + cardio caches never actually re-fetched. Fixed below.
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ['workoutLogs', user?.email] }),
      queryClient.invalidateQueries({ queryKey: ['cardioLogs', user?.email] }),
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
      className={`inline-flex items-center gap-1 text-micro ${color} hover:text-foreground transition-colors disabled:opacity-50`}
      aria-label={tFallback('sync.refreshAria', 'Refresh dashboard data')}
    >
      <RefreshCw className={`w-2.5 h-2.5 ${refreshing ? 'animate-spin' : ''}`} />
      <span>{tFallback('sync.syncedPrefix', 'Synced')} {relative}</span>
    </button>
  );
}
