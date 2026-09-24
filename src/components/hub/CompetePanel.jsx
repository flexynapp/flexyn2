// src/components/hub/CompetePanel.jsx
//
// Social › Compete (navigation redesign, phase 2). Every way to compete
// against another person, in one list. Before this they were scattered:
// the league behind the level pill's stats sheet, leaderboards one sheet
// deeper, crew wars on a Workout carousel slide, and Duels, Bounties and
// Gauntlet reachable only from cards on other pages. Competing is social,
// so it lives in Social.
//
// Rows navigate where the destination is a page and open the existing
// sheet where it is one; nothing here is a second implementation.

import React, { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Medal, Trophy, Swords, Target, Crosshair, Mountain } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import ErrorBoundary from '@/components/ErrorBoundary';

const LeagueStandingsModal = lazy(() => import('@/components/dashboard/LeagueStandingsModal'));
const LeaderboardsModal = lazy(() => import('@/components/LeaderboardsModal'));

function Row({ icon: Icon, label, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-12 flex items-center gap-2 px-4 py-3 text-start transition-colors hover:bg-secondary active:bg-secondary"
    >
      <Icon className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-label text-muted-foreground">{hint}</span>}
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
    </button>
  );
}

export default function CompetePanel({ onOpenCrews }) {
  const navigate = useNavigate();
  const { tFallback } = useLanguage();
  const [leagueOpen, setLeagueOpen] = useState(false);
  const [boardsOpen, setBoardsOpen] = useState(false);

  return (
    <div className="px-4 pt-2 pb-8 flex flex-col gap-6">
      <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
        <Row icon={Medal} label={tFallback('league.title', 'League')}
          hint={tFallback('compete.leagueHint', 'Your weekly bracket')}
          onClick={() => setLeagueOpen(true)} />
        <Row icon={Trophy} label={tFallback('compete.leaderboards', 'Leaderboards')}
          hint={tFallback('compete.leaderboardsHint', 'See where you rank')}
          onClick={() => setBoardsOpen(true)} />
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
        <Row icon={Swords} label={tFallback('crewWars.title', 'Crew Wars')}
          hint={tFallback('compete.crewWarsHint', 'Your crew against another for a week')}
          onClick={onOpenCrews} />
        <Row icon={Target} label={tFallback('duels.title', 'Duels')}
          hint={tFallback('compete.duelsHint', 'Challenge one person')}
          onClick={() => navigate('/duels')} />
        <Row icon={Crosshair} label={tFallback('bounties.title', 'Bounties')}
          hint={tFallback('compete.bountiesHint', 'Beat a posted record')}
          onClick={() => navigate('/bounties')} />
        <Row icon={Mountain} label={tFallback('compete.gauntlet', 'Gauntlet')}
          hint={tFallback('compete.gauntletHint', 'This week\'s challenge path')}
          onClick={() => navigate('/gauntlet')} />
      </div>

      <ErrorBoundary label="Compete sheets">
        <Suspense fallback={null}>
          {leagueOpen && <LeagueStandingsModal open={leagueOpen} onClose={() => setLeagueOpen(false)} />}
          {boardsOpen && <LeaderboardsModal open={boardsOpen} onClose={() => setBoardsOpen(false)} />}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
