// src/hooks/useGlobalRank.js
//
// The caller's position on a global all-time board, plus the athlete
// immediately ahead of them.
//
// Backed by get_leaderboard_around_me (migrations 257 / 259). Shared by
// every surface that wants to show rank without opening the leaderboard —
// the level badge and the Dashboard league card today.
//
// Deliberately one query key for all of them: React Query dedupes, so N
// surfaces reading the same board cost one round trip.

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { getLeaderboardAroundMe } from '@/lib/data/periodLeaderboard';

/**
 * @param {object}  [opts]
 * @param {'xp'|'volume'|'achievements'|'distance'} [opts.board='xp']
 * @param {boolean} [opts.enabled=true]
 * @returns {{
 *   rank: number|null,          // global rank, or null if unranked / unavailable
 *   value: number|null,         // the caller's own metric value
 *   ahead: object|null,         // the row directly above them, if any
 *   gap: number|null,           // how far behind `ahead` they are
 *   isLoading: boolean,
 *   supported: boolean          // false on a host without the RPC
 * }}
 */
export function useGlobalRank({ board = 'xp', enabled = true } = {}) {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['globalRank', board, user?.id],
    queryFn:  () => getLeaderboardAroundMe({ board, radius: 1 }),
    enabled:  enabled && !!user?.id,
    // Ranks shift as other people train. Long enough not to hammer the RPC
    // on every remount, short enough that reopening the app feels current.
    staleTime: 120_000,
  });

  const rows = data?.rows ?? [];
  const supported = data?.supported ?? true;

  // `is_me` is authoritative — matching on id would break for a caller who
  // isn't on the board at all, where the RPC returns the head of the list.
  const meIdx = rows.findIndex(r => r?.is_me);
  const me = meIdx >= 0 ? rows[meIdx] : null;
  const ahead = meIdx > 0 ? rows[meIdx - 1] : null;

  const value = me ? Number(me.value) || 0 : null;
  const gap = me && ahead ? Math.max(0, (Number(ahead.value) || 0) - value) : null;

  return {
    rank: me ? Number(me.rank) || null : null,
    value,
    ahead,
    gap,
    isLoading,
    supported,
  };
}
