// src/components/crews/CrewWarsMenu.jsx
//
// The Crew Wars menu, opened from the Workout hero carousel.
//
// The card used to `navigate('/hub', { state: { openCrewWars: true } })`.
// Nothing in Hub.jsx has ever read `openCrewWars`, so the tap dropped the
// user on the Hub feed and the intent was lost — which is what "the Crew
// Wars button just leads to the Hub" was. It no longer navigates at all:
// the state a user wants after that tap is "is my crew fighting?", and
// that answer fits in a sheet.
//
// Three states, one chrome. Every state carries the same close button and
// the same primary button to the crew's own page, because the actions that
// CHANGE a war — entering matchmaking, leaving the queue — are crew-leader
// actions that already live on CrewBattleEntry there. This surface reports
// and routes; a second Enter Battle here would be a competing call to
// action on a control most members are not allowed to press.
//
// The design is the Penpot page "Crew Wars": boards A (no war), B (live),
// C (queued), D (no war, new crew). Board F is the spec.

import React from 'react';
import PlayerMenu from '@/components/report/PlayerMenu';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Swords, Loader2, ChevronRight, Radar } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import { RulesButton } from '@/components/competition/RulesSheet';
import { useLanguage } from '@/lib/LanguageContext';
import { timeLeft } from '@/lib/timeLeft';
import { useNumberFormatter } from '@/lib/intl';
import {
  getActiveWarForCrew,
  getQueuedWarForCrew,
  getWarBreakdown,
  getWarScore,
  getOpponentScore,
  getOpponentCrewId,
} from '@/lib/data/crewWars';
import { getCrewMemberCount, getCrew } from '@/lib/data/crews';

function Chrome({ children, crew, onGoToCrew, tFallback }) {
  return (
    <>
      <p className="text-caption text-muted-foreground -mt-1">
        {crew.name}{crew.tag ? ` · [${crew.tag}]` : ''}
      </p>
      <div className="h-px bg-border -mx-4 mt-2 mb-6" />

      {children}

      {/* The one primary action. Pinned below the content rather than
          floated: the sheet sizes to its content in every state, so there
          is nothing for a floating button to float over. */}
      <button
        type="button"
        onClick={onGoToCrew}
        className="w-full h-14 mt-6 rounded-2xl bg-primary text-primary-foreground font-heading font-bold text-body flex items-center justify-center gap-1.5 hover:bg-primary/90 active:bg-primary/90 transition-colors"
      >
        {tFallback('crewWars.goToCrew', 'Go to {name}', { name: crew.name })}
        <ChevronRight className="w-4 h-4" />
      </button>
    </>
  );
}

// A row of the crew's standing. Cells with nothing behind them are dropped
// rather than rendered as a zero — a crew that has never fought must not be
// shown "0–0", which reads as a loss it never took. See the "A section with
// no data must not render as zeros" rule.
//
// Every value here comes from a column getMyCrews already loaded, plus one
// head count. Division is deliberately NOT shown: it lives in
// crew_season_stats behind get_crew_division_standings, and one more RPC
// round trip is not worth a third cell on a sheet.
function Standing({ crew, memberCount, tFallback }) {
  const played = (crew.wars_won ?? 0) + (crew.wars_lost ?? 0) + (crew.wars_drawn ?? 0);
  const cells = [];

  if (crew.crew_level) {
    cells.push({
      k: tFallback('crewWars.level', 'LEVEL'),
      v: String(crew.crew_level),
    });
  }

  if (played > 0) {
    cells.push({
      k: tFallback('crewWars.record', 'RECORD'),
      v: `${crew.wars_won ?? 0}–${crew.wars_lost ?? 0}`,
      accent: true,
    });
  }

  if (memberCount != null) {
    cells.push({
      k: tFallback('crewWars.roster', 'ROSTER'),
      v: tFallback('crewWars.nLifters', '{n} lifters', { n: memberCount }),
    });
  }

  if (cells.length < 2) return null;

  return (
    <div className="mt-6 rounded-lg bg-muted flex items-stretch">
      {cells.map((c, i) => (
        <div
          key={c.k}
          className={`flex-1 py-2 text-center ${i > 0 ? 'border-s border-border' : ''}`}
        >
          <p className="text-micro font-bold text-muted-foreground tracking-wide">{c.k}</p>
          <p className={`font-heading font-bold text-body mt-0.5 ${c.accent ? 'text-success' : ''}`}>
            {c.v}
          </p>
        </div>
      ))}
    </div>
  );
}

function NoWar({ crew, memberCount, tFallback }) {
  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
        <Swords className="w-7 h-7 text-primary" />
      </div>
      <h3 className="font-heading font-bold text-title mt-6">
        {tFallback('crewWars.noActiveWars', 'No Active Wars')}
      </h3>
      <p className="text-label text-muted-foreground mt-2 leading-relaxed max-w-[300px] mx-auto">
        {tFallback(
          'crewWars.noWarBody',
          "Your crew isn't in a war right now. Open your crew page to enter matchmaking, and you'll be paired against a crew of similar strength, size and age.",
        )}
      </p>
      <Standing crew={crew} memberCount={memberCount} tFallback={tFallback} />
    </div>
  );
}

function Queued({ tFallback }) {
  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
        <Radar className="w-7 h-7 text-primary" />
      </div>
      <h3 className="font-heading font-bold text-title mt-6">
        {tFallback('crewWars.findingRival', 'Find A Rival Crew')}
      </h3>
      <p className="text-label text-muted-foreground mt-2 leading-relaxed max-w-[310px] mx-auto">
        {tFallback(
          'crewWars.queuedBody',
          "You're in the queue. We're looking for a crew about as strong as yours, with a similar roster. The war starts the moment we find one.",
        )}
      </p>

      {/* What the pairing is actually matched on. A queue that says
          nothing reads as a hang; naming the dimensions is also the only
          honest answer to "why did we get them?" once a war starts. */}
      <p className="text-micro font-bold text-muted-foreground tracking-wide mt-6">
        {tFallback('crewWars.matchedOn', 'MATCHED ON')}
      </p>
      <div className="flex flex-wrap justify-center gap-2 mt-2">
        {[
          // Strength leads: it is the main key since the skill matchmaking
          // migration (20261001030000); the rest refine inside it.
          tFallback('crewWars.matchStrength', 'Strength'),
          tFallback('crewWars.matchSize',     'Roster size'),
          tFallback('crewWars.matchCadence',  'Cadence'),
          tFallback('crewWars.matchAge',      'Age band'),
        ].map(label => (
          <span
            key={label}
            className="px-2.5 py-1 rounded-full bg-muted border border-border text-micro font-semibold"
          >
            {label}
          </span>
        ))}
      </div>
      <p className="text-micro text-muted-foreground mt-6 leading-relaxed">
        {tFallback('crewWars.queueWidens', 'If nobody close is waiting, the search widens every 12 hours. Crews far apart in strength are never paired.')}
      </p>
    </div>
  );
}

function LiveWar({ crew, war, currentUserId, tFallback, language }) {
  const fmt = useNumberFormatter();

  const { data: breakdown } = useQuery({
    queryKey:  ['warBreakdown', war.id],
    queryFn:   () => getWarBreakdown(war.id),
    enabled:   !!war.id,
    staleTime: 60_000,
  });

  // Who you are actually fighting. The war row carries only crew ids, and
  // "Rival crew" is a worse answer than a name on the one screen whose
  // subject is the opponent. `crews` is readable by any authenticated
  // user (migration 311), so this needs no new server surface.
  const rivalId = getOpponentCrewId(war, crew.id);
  const { data: rival } = useQuery({
    queryKey:  ['crew', rivalId],
    queryFn:   () => getCrew(rivalId),
    enabled:   !!rivalId,
    staleTime: 5 * 60_000,
  });

  const mine   = getWarScore(war, crew.id);
  const theirs = getOpponentScore(war, crew.id);
  const total  = mine + theirs;
  const myPct  = total > 0 ? Math.round((mine / total) * 100) : 50;
  const left   = timeLeft(war.ends_at, new Date(), language);

  const members = breakdown?.members ?? [];
  const me      = members.find(m => m.user_id === currentUserId);

  // Migration 360 returns BOTH rosters. One ranked list rather than two
  // columns: at 390px a pair of columns gives each name about 14
  // characters, and the question a head-to-head board answers is "who is
  // actually carrying this war", which is a single ordering. The crew a
  // row belongs to is carried by tint and by the tag, not by position.
  //
  // Members on zero are kept HERE, unlike the old own-crew-only list —
  // on a versus board an absent rival is information, and dropping them
  // would make a five-person crew look like a three-person one.
  const board = [...members].sort((a, b) => (b.score || 0) - (a.score || 0));

  const diff = Math.abs(mine - theirs);

  return (
    <div>
      {/* Live strip */}
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-micro font-bold text-success tracking-wide">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          {tFallback('crewWars.live', 'LIVE')}
        </span>
        {left && (
          <span className="text-micro font-semibold text-muted-foreground">
            {tFallback('crewWars.timeLeft', '{t} left', { t: left })}
          </span>
        )}
      </div>

      {/* Head to head */}
      <div className="flex items-start justify-between mt-6">
        <div className="min-w-0 flex-1">
          <p className="text-label font-bold truncate">{crew.name}</p>
          <p className="font-heading font-bold text-display text-primary tabular-nums leading-none mt-1">
            {fmt(mine)}
          </p>
        </div>
        <span className="text-caption font-bold text-muted-foreground tracking-wide px-2 pt-1.5">
          {tFallback('crewWars.vs', 'VS')}
        </span>
        <div className="min-w-0 flex-1 text-end">
          <p className="text-label font-bold truncate">
            {rival?.name || tFallback('crewWars.rival', 'Rival crew')}
          </p>
          <p className="font-heading font-bold text-display tabular-nums leading-none mt-1">
            {fmt(theirs)}
          </p>
        </div>
      </div>

      <div className="h-2 rounded-full bg-secondary overflow-hidden mt-2">
        <div className="h-full bg-primary rounded-full transition-[width] duration-700" style={{ width: `${myPct}%` }} />
      </div>
      {/* Two lines on purpose. As one sentence this wrapped with a single
          word orphaned on the second line, and the two halves are doing
          different jobs anyway: the standing, then the rule that produced
          it. A score that is not a plain sum has to say so somewhere. */}
      <p className="text-caption font-semibold text-center mt-2">
        {diff === 0
          ? tFallback('crewWars.levelPegging', 'Level pegging')
          : mine > theirs
            ? tFallback('crewWars.aheadBy', 'Ahead by {n}', { n: fmt(diff) })
            : tFallback('crewWars.behindBy', 'Behind by {n}', { n: fmt(diff) })}
      </p>
      <p className="text-micro text-muted-foreground text-center mt-0.5">
        {tFallback('crewWars.sameLifters', 'Both crews score the same number of lifters')}
      </p>

      {/* Your contribution — the three things that are actually scored */}
      {me && (
        <>
          <p className="text-micro font-bold text-muted-foreground tracking-wide mt-6">
            {tFallback('crewWars.yourContribution', 'YOUR CONTRIBUTION')}
          </p>
          <div className="mt-2 rounded-lg bg-muted flex items-stretch">
            {[
              { k: tFallback('crewWars.volume',   'VOLUME'),       v: tFallback('crewWars.lbs', '{n} lb', { n: fmt(me.volume_lbs || 0) }) },
              { k: tFallback('crewWars.sessions', 'SESSIONS'),     v: fmt(me.sessions || 0) },
              { k: tFallback('crewWars.days',     'DAYS TRAINED'), v: `${me.days_active || 0} / 7` },
            ].map((c, i) => (
              <div key={c.k} className={`flex-1 py-2 text-center ${i > 0 ? 'border-s border-border' : ''}`}>
                <p className="font-heading font-bold text-body">{c.v}</p>
                <p className="text-micro font-semibold text-muted-foreground mt-0.5">{c.k}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Head to head — every lifter on both sides, ranked. */}
      {board.length > 0 && (
        <>
          <div className="flex items-baseline justify-between mt-6">
            <p className="text-micro font-bold text-muted-foreground tracking-wide">
              {tFallback('crewWars.headToHead', 'HEAD TO HEAD')}
            </p>
            <p className="text-micro text-muted-foreground">
              {tFallback('crewWars.everyLifter', 'every lifter, both crews')}
            </p>
          </div>
          <div className="mt-2">
            {board.map((m, i) => {
              const isMe   = m.user_id === currentUserId;
              const isOurs = !!m.is_mine;
              const name   = isMe
                ? tFallback('crewWars.you', 'You')
                : (m.username || m.full_name || tFallback('crewWars.member', 'Member'));
              return (
                <div
                  key={m.user_id}
                  className={`flex items-center gap-2 py-1.5 ${isMe ? 'bg-primary/[0.07] -mx-2 px-2 rounded-lg' : ''}`}
                >
                  <span className="text-micro tabular-nums text-muted-foreground w-4 shrink-0">
                    {i + 1}
                  </span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOurs ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                    aria-hidden="true"
                  />
                  <span className={`flex-1 min-w-0 truncate text-label ${isMe ? 'font-bold' : ''}`}>
                    {name}
                    {/* Own crew only — `days_active` is null for a rival
                        by design, so this renders nothing for them
                        rather than "null d". */}
                    {isOurs && m.days_active > 0 && (
                      <span className="text-muted-foreground font-normal">
                        {' · '}{m.days_active}d
                      </span>
                    )}
                  </span>
                  <span className={`font-heading font-bold text-label tabular-nums shrink-0 ${(m.score || 0) === 0 ? 'text-muted-foreground' : ''}`}>
                    {fmt(m.score || 0)}
                  </span>
                  <PlayerMenu userId={m.user_id} currentUserId={currentUserId} username={m.username} context="crew_war" contextId={war.id} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function CrewWarsMenu({ open, onClose, crew, currentUserId }) {
  const navigate = useNavigate();
  const { tFallback, language } = useLanguage();

  const { data: war, isLoading: warLoading } = useQuery({
    queryKey:  ['activeWar', crew?.id],
    queryFn:   () => getActiveWarForCrew(crew.id),
    enabled:   open && !!crew?.id,
    staleTime: 60_000,
  });

  // Only asked once we know there is no live war — a crew cannot be both.
  const { data: queued, isLoading: queuedLoading } = useQuery({
    queryKey:  ['queuedWar', crew?.id],
    queryFn:   () => getQueuedWarForCrew(crew.id),
    enabled:   open && !!crew?.id && !warLoading && !war,
    staleTime: 15_000,
  });

  const { data: memberCount } = useQuery({
    queryKey:  ['crewMemberCount', crew?.id],
    queryFn:   () => getCrewMemberCount(crew.id),
    enabled:   open && !!crew?.id,
    staleTime: 5 * 60_000,
  });

  if (!crew) return null;

  // Hub is not mounted when this fires, so the `flexyn:open-crew` event
  // the other two callers use would be dispatched into nothing. Router
  // state survives the transition; Hub consumes `openCrewId` on mount.
  const goToCrew = () => {
    onClose();
    navigate('/hub', { state: { openCrewId: crew.id } });
  };

  const loading = warLoading || (!war && queuedLoading);

  return (
    <BottomSheet open={open} onClose={onClose} title={tFallback('crewWars.title', 'Crew Wars')} headerAction={<RulesButton ruleset="crewWars" />}>
      <Chrome crew={crew} onGoToCrew={goToCrew} tFallback={tFallback}>
        {loading ? (
          <div className="flex items-center justify-center py-14">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : war ? (
          <LiveWar crew={crew} war={war} currentUserId={currentUserId} tFallback={tFallback} language={language} />
        ) : queued ? (
          <Queued tFallback={tFallback} />
        ) : (
          <NoWar crew={crew} memberCount={memberCount} tFallback={tFallback} />
        )}
      </Chrome>
    </BottomSheet>
  );
}
