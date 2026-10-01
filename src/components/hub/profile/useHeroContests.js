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
import { getMyGymRival, getGymRivalWeekState, computeNetRating } from '@/lib/data/gymRival';
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
        // Not placed before the first workout: the plate stays neutral.
        if (res?.unrevealed) return { unrevealed: true };
        if (!res?.league) return null;
        // Unranked until you have trained enough days this week. That used
        // to return null, which removed the League row and the plate's tap
        // to the standings every Monday, for exactly the people the row
        // should be nudging.
        const daysToRank = res.myRank
          ? 0
          : Math.max(1, (Number(res.tier?.minWorkouts) || 1) - (Number(res.myActiveDays) || 0));
        return {
          rank: res.myRank ?? null,
          total: res.totalMembers,
          daysToRank,
          tierId: res.tier?.id ?? null,
          tierLabel: res.tier?.label ?? null,
        };
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
        // An active row that was never accepted can never settle, so it is
        // not a contest either.
        if (!assignment || assignment.status !== 'active' || !assignment.accepted_at) return null;

        // The server's own window and scoring, the numbers the payout uses.
        // This used to read the rival's workout_logs from the client, which
        // RLS returns empty for another user, so the rival always read 0,
        // and it scored a cardio match as volume (`type` is not a column;
        // `rival_type` is).
        const week = await getGymRivalWeekState(assignment.id);
        if (!week) return null;

        const type = assignment.rival_type === 'cardio' ? 'cardio' : 'gym';
        return {
          mine:   computeNetRating({ volume: week.youVolume,  distanceMeters: week.youDistance },  type),
          theirs: computeNetRating({ volume: week.themVolume, distanceMeters: week.themDistance }, type),
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

        // crew_a_score/crew_b_score are keyed to crew_a_id/crew_b_id, not to the viewer.
        const isCrewA = active.crew_a_id === crewId;
        return {
          crewId,
          mine:   Number(isCrewA ? active.crew_a_score : active.crew_b_score) || 0,
          theirs: Number(isCrewA ? active.crew_b_score : active.crew_a_score) || 0,
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
