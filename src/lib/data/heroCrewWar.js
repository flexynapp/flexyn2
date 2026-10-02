// src/lib/data/heroCrewWar.js
//
// The viewer's crew's running war, in the one shape three surfaces share
// under the ['heroCrewWar', userId] key: Today's war line (CrewWarGlance),
// Today's hero carousel and the profile hero's pill (useHeroContests). One
// fetcher so the cached value has one shape whichever of them filled it.
// Null for no crew, no war, or a failed lookup; all three render nothing.

import { getMyCrews } from '@/lib/data/crews';
import { getActiveWarForCrew } from '@/lib/data/crewWars';

export async function fetchHeroCrewWar(userId) {
  try {
    const crews = await getMyCrews(userId);
    const crew = crews?.[0] ?? null;
    const crewId = crew?.id ?? crew?.crew_id ?? null;
    if (!crewId) return null;
    const active = await getActiveWarForCrew(crewId);
    if (!active) return null;
    // crew_a_score/crew_b_score are keyed to crew_a_id/crew_b_id, not to the viewer.
    const isCrewA = active.crew_a_id === crewId;
    return {
      crewId,
      crewName: crew?.name ?? null,
      mine:   Number(isCrewA ? active.crew_a_score : active.crew_b_score) || 0,
      theirs: Number(isCrewA ? active.crew_b_score : active.crew_a_score) || 0,
      endsAt: active.ends_at ?? null,
    };
  } catch { return null; }
}
