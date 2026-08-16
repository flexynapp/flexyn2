// src/components/crews/CrewBattleEntry.jsx
//
// One crew's war status: the three mutually exclusive states of a Crew War
// — no battle, queued for a rival, or a live war — with the action for each
// one inline.
//
// Extracted from CrewsSection so the Crew page and the Battles tab can both
// render it. It lives in its own file rather than being exported from
// CrewsSection because CrewPage is imported BY CrewsSection, and importing
// back the other way would close a cycle. Circular imports are how the
// production Hub crash of 2026-05-23 happened (see the TDZ section of
// CLAUDE.md) — a shared leaf module has no such failure mode.
//
// Keeping all three states together is the pattern Habitica uses for a party
// quest (questSidebarSection.vue renders no-quest, invited and active in one
// block). See docs/crew-page-research.md.

import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { Shield, Loader2, Swords, Trophy, Crown, History } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { useNumberFormatter } from '@/lib/intl';
import { toast } from '@/lib/toast';
import {
  getActiveWarForCrew,
  getCrewWarHistory,
  getWarScore,
  getOpponentScore,
  joinWarMatchmaking,
  leaveWarMatchmaking,
  getQueuedWarForCrew,
} from '@/lib/data/crewWars';
import CrewWarPanel from './CrewWarPanel';
import { can, RANK } from '@/lib/crewPermissions';
import { useLanguage } from '@/lib/LanguageContext';

export default function CrewBattleEntry({ crew, currentUserId, myRank }) {
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const fmt = useNumberFormatter();

  // Starting or cancelling a war is rank 2+, enforced server-side in
  // join_crew_war_queue / leave_crew_war_queue (migration 357). Falls back
  // to the crew's is_admin flag when no rank was passed, so an older caller
  // keeps the leader-only behaviour rather than silently opening it up.
  const rank = myRank ?? (crew?.is_admin ? RANK.LEADER : RANK.MEMBER);
  const canStartWar = can(rank, 'START_WAR');

  const { data: war, isLoading: warLoading } = useQuery({
    queryKey:  ['activeWar', crew.id],
    queryFn:   () => getActiveWarForCrew(crew.id),
    enabled:   !!crew.id,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: history = [] } = useQuery({
    queryKey:  ['warHistory', crew.id],
    queryFn:   () => getCrewWarHistory(crew.id, 3),
    enabled:   !!crew.id,
    staleTime: 5 * 60_000,
  });

  // A crew waiting in the queue with no rival yet. Polls a little faster
  // than the active-war query because the pairing can land at any moment
  // — the RPC matches on arrival, so the wait ends when some other crew
  // presses Enter Battle, not on a fixed schedule.
  const { data: queued } = useQuery({
    queryKey:  ['queuedWar', crew.id],
    queryFn:   () => getQueuedWarForCrew(crew.id),
    enabled:   !!crew.id,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Synchronous double-tap guard. `enterMut.isPending` is async, so a
  // fast double-tap fires joinWarMatchmaking twice. The cross-session
  // case (two leaders, two devices) that this ref cannot see is now
  // closed on the server: migration 247 adds a partial UNIQUE index on
  // crew_wars (crew_a_id) WHERE crew_b_id IS NULL, and the RPC returns
  // 'already_queued' rather than creating a second entry.
  const enteringRef = useRef(false);
  const enterMut = useMutation({
    mutationFn: () => joinWarMatchmaking(crew.id),
    onMutate: () => { enteringRef.current = true; },
    onSuccess: (res) => {
      if (res?.status === 'matched') {
        toast.success(tFallback("crewBattleEntry.rivalFoundTheBattle", "Rival found — the battle is live!"), {
          description: 'Seven days. Most XP wins.',
        });
      } else if (res?.status === 'already_queued') {
        toast.info('Already in the queue.');
      } else {
        toast.success('In the queue — we\'ll pair you with the next crew in.');
      }
      qc.invalidateQueries({ queryKey: ['activeWar', crew.id] });
      qc.invalidateQueries({ queryKey: ['queuedWar', crew.id] });
    },
    onError: (err) => toast.error(tFallback("crewBattleEntry.couldNotEnterBattle", "Could not enter battle"), { description: err.message }),
    onSettled: () => { enteringRef.current = false; },
  });
  const handleEnter = () => {
    if (enteringRef.current || enterMut.isPending) return;
    enterMut.mutate();
  };

  const leaveMut = useMutation({
    mutationFn: () => leaveWarMatchmaking(crew.id),
    onSuccess: () => {
      toast.success('Left the queue.');
      qc.invalidateQueries({ queryKey: ['queuedWar', crew.id] });
    },
    onError: (err) => toast.error(tFallback("crewBattleEntry.couldNotLeaveTheQueue", "Could not leave the queue"), { description: err.message }),
  });

  if (warLoading) {
    return (
      <div className="rounded-2xl border border-border p-4 animate-pulse mb-4">
        <div className="h-4 w-28 rounded bg-secondary mb-2" />
        <div className="h-2.5 w-full rounded bg-secondary" />
      </div>
    );
  }

  if (war) {
    return <CrewWarPanel crewId={crew.id} currentUserId={currentUserId} />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-card overflow-hidden mb-4"
    >
      {/* Says what the card IS, not where you are. This header used to repeat
          crew.name, which is already the page title two rows above it — so
          "Admin Grind" rendered twice within one screen and the card, whose
          whole subject is the war, never said so. CrewWarPanel labels the
          active-war state the same way; these two are mutually exclusive
          states of one feature, so sharing the label is the point. */}
      <div className="px-4 py-3 flex items-center gap-2 border-b border-border bg-secondary/30">
        <Shield className="w-4 h-4 text-muted-foreground" />
        <span className="font-bold text-sm truncate">
          {tFallback('crew.war.title', 'Crew War')}
        </span>
      </div>

      <div className="p-4 space-y-4">
        <div className="text-center py-2">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center mx-auto mb-3">
            <Swords className="w-6 h-6 text-rose-500" />
          </div>
          {queued ? (
            <>
              <p className="text-sm font-bold mb-1">{tFallback("crewBattleEntry.waitingForARival", "Waiting for a rival")}</p>
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                You're in the queue. The next crew to enter gets matched against you,
                and the battle starts the moment they do.
              </p>
              {canStartWar && <button
                onClick={() => leaveMut.mutate()}
                disabled={leaveMut.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-secondary active:bg-secondary disabled:opacity-50 transition-colors"
              >
                {leaveMut.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Swords className="w-4 h-4" />
                }
                Leave queue
              </button>}
            </>
          ) : (
            <>
              <p className="text-sm font-bold mb-1">{tFallback("crewBattleEntry.noActiveBattle", "No Active Battle")}</p>
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                Enter matchmaking to get paired with a rival crew in your division. Wars run
                for 7 days, scored on volume lifted, sessions logged and days trained.
              </p>
              {/* Starting a war is a rank-2 act, enforced in
                  join_crew_war_queue (migration 357). A member who taps this
                  gets 42501 and a toast, which reads as the app being
                  broken — so the control is replaced by the reason rather
                  than greyed out. A disabled button is a dead end; a
                  sentence is information. */}
              {canStartWar ? (
                <button
                  onClick={handleEnter}
                  disabled={enterMut.isPending}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-bold hover:bg-rose-600 active:bg-rose-600 disabled:opacity-50 transition-colors"
                >
                  {enterMut.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Swords className="w-4 h-4" />
                  }
                  {enterMut.isPending ? 'Finding rival…' : 'Enter Battle'}
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {tFallback(
                    'crewBattleEntry.leaderStarts',
                    'A leader or moderator starts the war. You fight in it either way.',
                  )}
                </p>
              )}
            </>
          )}
        </div>

        {history.length > 0 && (
          <div>
            <p className="text-xs font-semiboldr text-muted-foreground flex items-center gap-1.5 mb-2">
              <History className="w-3 h-3" />
              {tFallback("crewBattleEntry.pastBattles", "Past Battles")}
            </p>
            <div className="space-y-2">
              {history.map(w => {
                const won = w.winner_crew_id === crew.id;
                const myScore    = getWarScore(w, crew.id);
                const theirScore = getOpponentScore(w, crew.id);
                return (
                  <div key={w.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-secondary/40">
                    <div className="flex items-center gap-2">
                      {won
                        ? <Crown className="w-3.5 h-3.5 text-yellow-500" />
                        : <Trophy className="w-3.5 h-3.5 text-muted-foreground" />
                      }
                      <span className={`text-xs font-bold ${won ? 'text-primary' : 'text-muted-foreground'}`}>
                        {won ? 'Victory' : 'Defeat'}
                      </span>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {fmt(myScore)} – {fmt(theirScore)} XP
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(w.ends_at), { addSuffix: true })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
