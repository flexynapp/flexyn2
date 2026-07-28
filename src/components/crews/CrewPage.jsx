// src/components/crews/CrewPage.jsx
//
// The Crew page — what tapping a Crew opens.
//
// It used to open CrewChat directly, so a Crew was a message thread and
// everything describing it (level, division, war, treasury, roster) lived
// behind a slide-in panel or on a different tab. Migrations 248-251 gave a
// Crew a lot of state and none of it was visible from the Crew itself; a
// member three days into a war their crew was losing saw no sign of it.
//
// Both references in docs/crew-page-research.md open the group as a subject:
// Habitica leads with an h1 of the group name and the leader beneath it,
// with chat as a section inside the page; Voyager opens with identity, one
// stats line and a description. Chat is now a tab here for the same reason.
//
// Built to docs/profile-ui-premium-research.md: the crest is punched over
// the banner seam and ringed in the page background rather than a border
// colour, metrics are one text row taking hierarchy from weight and colour
// instead of tiles, the type scale is four sizes, counts go through
// useNumberFormatter, and one control is primary.

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Shield } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import * as crewsData from '@/lib/data/crews';
import { getDivisionStandings, placingFor, crewLevelProgress } from '@/lib/data/crewSeasons';
import { getTreasury } from '@/lib/data/crewTreasury';
import ChatViewportFrame from '@/components/ChatViewportFrame';
import CrewChat from './CrewChat';
import CrewBattleEntry from './CrewBattleEntry';
import CrewChallengeCard from './CrewChallengeCard';
import CrewLeaguePanel from './CrewLeaguePanel';
import CrewMemberDirectory from './CrewMemberDirectory';

const TABS = [
  { key: 'home',   label: 'Home' },
  { key: 'roster', label: 'Roster' },
  { key: 'chat',   label: 'Chat' },
  { key: 'league', label: 'League' },
];

const ORDINAL = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
function ordinal(n) {
  if (!Number.isFinite(n)) return null;
  try {
    return `${n}${ORDINAL[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(n)] ?? 'th'}`;
  } catch {
    return String(n);
  }
}

export default function CrewPage({ crew, onBack, onViewProfile }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const [tab, setTab] = useState('home');

  const crewId = crew?.id;

  const { data: members = [] } = useQuery({
    queryKey: ['crewMembers', crewId],
    queryFn:  () => crewsData.getCrewMembers(crewId),
    enabled:  !!crewId,
    staleTime: 30_000,
  });

  const { data: standings } = useQuery({
    queryKey: ['crewStandings', crewId],
    queryFn:  () => getDivisionStandings(crewId),
    enabled:  !!crewId,
    staleTime: 60_000,
  });

  const { data: treasury } = useQuery({
    queryKey: ['crewTreasury', crewId],
    queryFn:  () => getTreasury(crewId),
    enabled:  !!crewId,
    staleTime: 60_000,
  });

  if (!crew) return null;

  const myMember   = members.find(m => m.user_id === user?.id);
  const myRole     = myMember?.role ?? (crew.is_admin ? 'leader' : 'member');
  const isLeader   = myRole === 'leader' || !!crew.is_admin;
  const leader     = members.find(m => (m.role ?? (m.is_admin ? 'leader' : 'member')) === 'leader');
  const leaderName = leader?.username || leader?.profile?.username || null;
  const placing    = placingFor(standings, crewId);
  const { pct: levelPct } = crewLevelProgress(crew);
  const capacity   = treasury?.maxCapacity ?? crew.max_capacity ?? 16;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col h-full min-h-0"
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="shrink-0">
        <div className="relative h-24 overflow-hidden">
          {crew.avatar_url ? (
            <img
              loading="lazy"
              src={crew.avatar_url}
              alt=""
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <div
              className="w-full h-full"
              style={{ background: 'linear-gradient(122deg, hsl(var(--primary) / 0.55), hsl(var(--primary) / 0.15))' }}
            />
          )}
          {/* Scrim so the back control stays legible on any banner. */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(to top, hsl(var(--background)), transparent 62%)' }}
          />
          <button
            onClick={onBack}
            className="absolute top-3 start-3 w-8 h-8 rounded-full bg-background/70 backdrop-blur flex items-center justify-center"
            aria-label={tFallback('crew.back', 'Back')}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Crest punched over the seam. The ring is the page background,
            not a border colour — that's what makes it read as cut out of
            the banner rather than placed on it. */}
        <div className="px-4 h-0 relative z-10">
          <div
            className="w-16 h-16 rounded-2xl -mt-8 flex items-center justify-center overflow-hidden"
            style={{
              border: '3px solid hsl(var(--background))',
              background: 'hsl(var(--primary) / 0.15)',
            }}
          >
            {crew.avatar_url
              ? <img loading="lazy" src={crew.avatar_url} alt="" className="w-full h-full object-cover" draggable={false} />
              : <Shield className="w-7 h-7" style={{ color: 'hsl(var(--primary))' }} />}
          </div>
        </div>

        <div className="px-4 pt-2">
          <h2 className="font-heading font-bold text-xl leading-tight truncate">{crew.name}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {leaderName
              ? <>{tFallback('crew.ledBy', 'Led by')} {leaderName} · </>
              : null}
            {fmt(members.length)} {tFallback('crew.of', 'of')} {fmt(capacity)}
          </p>

          {/* One metric row. Text, not tiles. */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-sm text-muted-foreground">
            {Number.isFinite(Number(crew.crew_level)) && (
              <span><b className="text-foreground font-bold">Lvl {crew.crew_level}</b></span>
            )}
            {placing && standings?.division != null && (
              <span>
                <b className="text-foreground font-bold tabular-nums">{ordinal(placing)}</b>
                {' '}{tFallback('crew.inDivision', 'in Division')} {standings.division}
              </span>
            )}
            {Number.isFinite(Number(crew.wars_won)) && (
              <span className="tabular-nums">
                <b className="text-foreground font-bold">{crew.wars_won}</b>–
                <b className="text-foreground font-bold">{crew.wars_lost ?? 0}</b>
              </span>
            )}
            {treasury && (
              <span>
                <b className="text-foreground font-bold tabular-nums">{fmt(treasury.balance)}</b>
                {' '}{tFallback('crew.coins', 'coins')}
              </span>
            )}
          </div>

          {levelPct != null && (
            <div className="mt-2 h-[3px] rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round(levelPct * 100)}%`, background: 'hsl(var(--primary))' }}
              />
            </div>
          )}
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <div className="flex gap-5 px-4 pt-4 border-b border-border">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-sm font-semibold pb-2.5 transition-colors ${
                tab === t.key
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              style={tab === t.key
                ? { boxShadow: 'inset 0 -2px 0 hsl(var(--primary))' }
                : undefined}
              aria-current={tab === t.key ? 'page' : undefined}
            >
              {tFallback(`crew.tab.${t.key}`, t.label)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {tab === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full overflow-y-auto px-4 py-4"
            >
              {/* War first: all three states with the action inline. A crew
                  at war shouldn't have to go looking for its war. */}
              <CrewBattleEntry crew={crew} currentUserId={user?.id} />
              <CrewChallengeCard crewId={crewId} isAdmin={isLeader} />
            </motion.div>
          )}

          {tab === 'roster' && (
            <motion.div
              key="roster"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full min-h-0"
            >
              <CrewMemberDirectory
                crewId={crewId}
                members={members}
                currentUserId={user?.id}
                isCurrentAdmin={isLeader}
                maxCapacity={capacity}
                inline
                onViewProfile={onViewProfile}
              />
            </motion.div>
          )}

          {tab === 'chat' && (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full min-h-0"
            >
              <ChatViewportFrame>
                <CrewChat
                  crew={crew}
                  embedded
                  onBack={onBack}
                  onViewProfile={onViewProfile}
                />
              </ChatViewportFrame>
            </motion.div>
          )}

          {tab === 'league' && (
            <motion.div
              key="league"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full overflow-y-auto px-4 py-4"
            >
              <CrewLeaguePanel crewId={crewId} crewName={crew.name} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
