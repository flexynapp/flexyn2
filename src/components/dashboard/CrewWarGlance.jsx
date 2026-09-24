// src/components/dashboard/CrewWarGlance.jsx
//
// Your crew's live war score on the Today screen (navigation redesign,
// phase 3). A war lasts a week and is decided by who trains, so the score
// belongs where you decide whether to train today. Renders nothing unless
// a war is actually running: no crew, no war, or a failed lookup all look
// the same, which is no card at all.
//
// The query shares its key and shape with the profile hero's crew-war pill
// (useHeroContests), so the two never disagree and one fetch serves both.
// Tapping opens the crew in Social through router state, the hand-off Hub
// already consumes (location.state.openCrewId).

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Swords, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { getMyCrews } from '@/lib/data/crews';
import { getActiveWarForCrew } from '@/lib/data/crewWars';

export function warLine(war, tFallback, fmt) {
  const vars = { mine: fmt(war.mine), theirs: fmt(war.theirs) };
  if (war.mine > war.theirs) return tFallback('today.war.leading', 'You lead {mine} to {theirs}', vars);
  if (war.mine < war.theirs) return tFallback('today.war.trailing', 'You trail {mine} to {theirs}', vars);
  return tFallback('today.war.tied', 'Tied at {mine}', vars);
}

export default function CrewWarGlance() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const navigate = useNavigate();

  const { data: war } = useQuery({
    queryKey: ['heroCrewWar', user?.id],
    queryFn: async () => {
      try {
        const crews = await getMyCrews(user.id);
        const crewId = crews?.[0]?.id ?? crews?.[0]?.crew_id ?? null;
        if (!crewId) return null;
        const active = await getActiveWarForCrew(crewId);
        if (!active) return null;
        const isCrewA = active.crew_a_id === crewId;
        return {
          crewId,
          mine:   Number(isCrewA ? active.score_a : active.score_b) || 0,
          theirs: Number(isCrewA ? active.score_b : active.score_a) || 0,
        };
      } catch { return null; }
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  if (!war) return null;

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => navigate('/hub?feed=crews', { state: { openCrewId: war.crewId } })}
        className="w-full flex items-center gap-2 px-4 py-4 text-start transition-colors hover:bg-secondary active:bg-secondary"
      >
        <Swords className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold">{tFallback('crewWars.title', 'Crew Wars')}</span>
          <span className="block text-label text-muted-foreground tabular-nums">{warLine(war, tFallback, fmt)}</span>
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rtl:scale-x-[-1]" aria-hidden="true" />
      </button>
    </Card>
  );
}
