// src/components/hub/profile/useHeroContests.js
//
// The three live contests the profile hero can show: weekly league placement,
// gym rival, and crew war.
//
// SELF ONLY — and that's a data constraint, not a design preference.
// getMyLeague, getMyGymRival and the crew-war lookup all resolve through
// auth.uid() or a "my" query; there is no server surface that exposes another
// user's rival pairing or their crew's active war, and there shouldn't be
// without a deliberate privacy decision. So the rail renders on your own
// profile and is simply absent on everyone else's.
//
// Every query is independently `enabled` and independently failure-tolerant.
// A crewless user, a user with no rival, and a user whose league RPC predates
// their deploy all get the same outcome: that pill doesn't render, and the
// other two still do.

import { useQuery } from '@tanstack/react-query';
import { getMyLeague } from '@/lib/data/leagues';
import { getMyGymRival, getWeeklyComparison, computeNetRating } from '@/lib/data/gymRival';
import { getMyCrews } from '@/lib/data/crews';
import { getActiveWarForCrew } from '@/lib/data/crewWars';

const FIVE_MIN = 5 * 60_000;

export function useHeroContests({ user, isSelf }) {
  const enabled = !!isSelf && !!user?.id;

  // ── League ────────────────────────────────────────────────────────────
  // getMyLeague runs ensure_my_league, which places the user into the current
  // week if they aren't already. That's a write, but an idempotent one the
  // Dashboard performs anyway — "ensure" is the contract. Long staleTime so
  // opening a profile repeatedly doesn't re-run it.
  const { data: league } = useQuery({
    queryKey: ['heroLeague', user?.id],
    queryFn: async () => {
      try {
        const res = await getMyLeague(user);
        if (!res?.myRank) return null;
        return { rank: res.myRank, total: res.totalMembers, tierLabel: res.tier?.label ?? null };
      } catch { return null; }
    },
    enabled,
    staleTime: FIVE_MIN,
  });

  // ── Gym rival ─────────────────────────────────────────────────────────
  const { data: rival } = useQuery({
    queryKey: ['heroRival', user?.id],
    queryFn: async () => {
      try {
        const assignment = await getMyGymRival();
        // Only an ACTIVE pairing is a live contest. pending/void/completed
        // rows are history and would show a frozen score forever.
        if (!assignment || assignment.status !== 'active') return null;

        // The row is stored one way round; either party may be viewing it.
        const opponentId = assignment.user_id === user.id
          ? assignment.rival_id
          : assignment.user_id;
        if (!opponentId) return null;

        const cmp = await getWeeklyComparison(user.id, opponentId);
        if (!cmp) return null;

        const type = assignment.type || 'gym';
        return {
          mine:   computeNetRating(cmp.user, type),
          theirs: computeNetRating(cmp.rival, type),
        };
      } catch { return null; }
    },
    enabled,
    staleTime: FIVE_MIN,
  });

  // ── Crew war ──────────────────────────────────────────────────────────
  const { data: war } = useQuery({
    queryKey: ['heroCrewWar', user?.id],
    queryFn: async () => {
      try {
        const crews = await getMyCrews(user.id);
        const crewId = crews?.[0]?.id ?? crews?.[0]?.crew_id ?? null;
        if (!crewId) return null;

        const active = await getActiveWarForCrew(crewId);
        if (!active) return null;

        // score_a/score_b are keyed to crew_a_id/crew_b_id, not to the viewer.
        const isCrewA = active.crew_a_id === crewId;
        return {
          crewId,
          mine:   Number(isCrewA ? active.score_a : active.score_b) || 0,
          theirs: Number(isCrewA ? active.score_b : active.score_a) || 0,
        };
      } catch { return null; }
    },
    enabled,
    staleTime: FIVE_MIN,
  });

  return {
    league: league ?? null,
    rival:  rival ?? null,
    war:    war ?? null,
  };
}
