// src/components/crews/CrewWarPanel.jsx
// Live crew war scoreboard panel — shown on the Crews page when an active war exists.

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Flame, Shield, Clock, Crown, Trophy } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getActiveWarForCrew, getWarContributions, getWarScore, getOpponentScore } from '@/lib/data/crewWars';
import { fireCrewWinCelebration } from '@/lib/crewWinCelebration';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { formatDistanceToNow, differenceInHours } from 'date-fns';
import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';
import { useNumberFormatter } from '@/lib/intl';

function ScoreBar({ myScore, theirScore }) {
  const fmt = useNumberFormatter();
  const total = myScore + theirScore || 1;
  const myPct = Math.round((myScore / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-bold tabular-nums">
        <span className="text-primary">{fmt(myScore)}</span>
        <span className="text-muted-foreground">{fmt(theirScore)}</span>
      </div>
      <div className="h-2.5 rounded-full bg-secondary overflow-hidden flex">
        <motion.div
          className="h-full bg-primary rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${myPct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Your Crew</span>
        <span>Rival Crew</span>
      </div>
    </div>
  );
}

function ContribRow({ rank, userId, xp, isCurrentUser }) {
  const fmt = useNumberFormatter();
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg ${isCurrentUser ? 'bg-primary/8 border border-primary/20' : ''}`}>
      <span className={`text-xs font-black w-5 text-center ${rank === 1 ? 'text-yellow-500' : rank === 2 ? 'text-slate-400' : rank === 3 ? 'text-amber-700' : 'text-muted-foreground'}`}>
        {rank}
      </span>
      <div className="flex-1">
        <p className="text-xs font-semibold truncate">{isCurrentUser ? 'You' : `Member`}</p>
      </div>
      <div className="flex items-center gap-1">
        <Flame className="w-3 h-3 text-orange-500" />
        <span className="text-xs font-bold tabular-nums">{fmt(xp)} XP</span>
      </div>
    </div>
  );
}

// Local-storage key recording which crew wars we've already celebrated
// for this user. Without this, the celebration would re-fire every
// time the user opens the Crews tab on a panel showing a past win.
// localStorage is per-device but that's OK — re-firing on a second
// device is a minor annoyance compared to celebrating once per device
// (which is actually warmer).
const CELEBRATED_KEY = (userId) => `flexyn.celebratedCrewWars.${userId || 'anon'}`;
function readCelebrated(userId) {
  try {
    const raw = localStorage.getItem(CELEBRATED_KEY(userId));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function markCelebrated(userId, warId) {
  try {
    const set = readCelebrated(userId);
    set.add(warId);
    // Cap at last 50 to keep the key from growing unbounded.
    const trimmed = Array.from(set).slice(-50);
    localStorage.setItem(CELEBRATED_KEY(userId), JSON.stringify(trimmed));
  } catch { /* best-effort */ }
}

// Separate localStorage key for the SERVER-side push notification
// dispatch. We dedup independently from the celebration so that:
//   • A user who clears celebration history (or switches devices)
//     doesn't re-fire pushes to every member of both crews.
//   • If the celebration ever moves server-side, the push tracking
//     here doesn't have to follow.
// The notify_crew_war_resolved_for RPC fans out to ALL members of
// BOTH crews — so the FIRST crew member to open the panel after the
// war completes triggers the push for everyone. Subsequent viewers
// see this localStorage flag and skip the call.
//
// Cross-device note: another member opening the app first will fire
// the push. If THIS device opens first AND a second member also
// opens before any device-sync, the RPC will be called twice and
// every member gets two push notifications. The cost is low (a
// duplicate "your crew won!" push) and the alternative — a
// server-side war_status trigger — requires refactoring the RPC's
// auth.uid() check, which is a larger change.
const NOTIFIED_KEY = (userId) => `flexyn.notifiedCrewWars.${userId || 'anon'}`;
function readNotified(userId) {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY(userId));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function markNotified(userId, warId) {
  try {
    const set = readNotified(userId);
    set.add(warId);
    const trimmed = Array.from(set).slice(-50);
    localStorage.setItem(NOTIFIED_KEY(userId), JSON.stringify(trimmed));
  } catch { /* best-effort */ }
}

export default function CrewWarPanel({ crewId, currentUserId }) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { data: war } = useQuery({
    queryKey:  ['activeWar', crewId],
    queryFn:   () => getActiveWarForCrew(crewId),
    enabled:   !!crewId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: contributions = [] } = useQuery({
    queryKey:  ['warContributions', war?.id],
    queryFn:   () => getWarContributions(war?.id),
    enabled:   !!war?.id,
    staleTime: 60_000,
  });

  // Auto-fire the crew-win celebration the first time we see a
  // completed war this user's crew won. Per-device localStorage gate
  // ensures we don't re-celebrate every panel render. The user's
  // personal contribution drives whether the toast credits them with
  // XP — passive members still see the celebration but without a
  // wasn't-theirs XP claim.
  useEffect(() => {
    if (!war || !user?.id || !crewId) return;
    if (war.status !== 'completed' || war.winner_crew_id !== crewId) return;
    const alreadyCelebrated = readCelebrated(user.id).has(war.id);
    if (alreadyCelebrated) return;
    const myContribution = contributions.find(c => c.user_id === currentUserId);
    fireCrewWinCelebration({
      crewName: war.winner_crew_name,
      xpGained: myContribution?.xp_contributed ?? 0,
      finalScore: getWarScore(war, crewId),
      wasContributor: !!myContribution,
      userEmail: user.email,
      language,
    });
    markCelebrated(user.id, war.id);
  }, [war, user?.id, user?.email, crewId, currentUserId, contributions]);

  // Dispatch server-side push notifications when this user is the
  // first member to observe a completed war. The RPC fans out to ALL
  // members of BOTH crews (winners get a 🏆 push, losers get a
  // good-fight 💪 push), so we only need ONE caller to fire it. The
  // localStorage flag means subsequent panel renders on this device
  // skip the RPC.
  //
  // Independent from the celebration effect above:
  //   • Fires for BOTH winners and losers (celebration is winners only).
  //   • Doesn't depend on contribution state.
  //   • Tolerates RPC failure silently — push is best-effort; the
  //     in-app notification still lands via the normal trigger if
  //     other paths insert notification rows for this war.
  useEffect(() => {
    if (!war || !user?.id || !crewId) return;
    if (war.status !== 'completed') return;
    const alreadyNotified = readNotified(user.id).has(war.id);
    if (alreadyNotified) return;

    // Optimistically mark BEFORE the RPC. If two tabs fire the effect
    // back-to-back, the second one sees the localStorage flag and
    // skips. The RPC itself is idempotent at the application level
    // (it inserts new notification rows each call), so this dedup
    // matters — without it we'd send Nx pushes to every crew member.
    markNotified(user.id, war.id);

    (async () => {
      try {
        const { error } = await supabase.rpc('notify_crew_war_resolved_for', {
          p_war_id: war.id,
        });
        if (error) {
          // 42883 / 42P01 → pre-migration host (069 not applied).
          // Silently skip; the celebration still fires for the winner.
          if (error.code !== '42883' && error.code !== '42P01') {
            reportError(error, {
              feature: 'crewWars.notifyResolved',
              level: 'warning',
              userEmail: user.email,
              warId: war.id,
            });
          }
        }
      } catch (err) {
        if (err?.code !== '42883' && err?.code !== '42P01') {
          reportError(err, {
            feature: 'crewWars.notifyResolved.throw',
            level: 'warning',
            userEmail: user.email,
            warId: war.id,
          });
        }
      }
    })();
  }, [war, user?.id, user?.email, crewId]);

  if (!war) return null;

  const myScore    = getWarScore(war, crewId);
  const theirScore = getOpponentScore(war, crewId);
  const hoursLeft  = differenceInHours(new Date(war.ends_at), new Date());
  // Distinguish leading from tied so a 1000-vs-1000 score doesn't
  // render the "Leading" badge + primary-color score bar. (Audit 15 #M6.)
  const winning    = myScore >  theirScore;
  const tied       = myScore === theirScore;
  const completed  = war.status === 'completed';

  const myContribs    = contributions.filter(c => c.crew_id === crewId).sort((a, b) => b.xp_contributed - a.xp_contributed);
  const theirContribs = contributions.filter(c => c.crew_id !== crewId).sort((a, b) => b.xp_contributed - a.xp_contributed);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border overflow-hidden mb-4"
    >
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${winning ? 'bg-primary/8' : tied ? 'bg-amber-500/5' : 'bg-rose-500/5'}`}>
        <div className="flex items-center gap-2">
          <Shield className={`w-4 h-4 ${winning ? 'text-primary' : tied ? 'text-amber-500' : 'text-rose-500'}`} />
          <span className="font-black text-sm">Crew War</span>
          {winning && <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">Leading</span>}
          {tied && !completed && <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">Tied</span>}
        </div>
        {/* Hide the running countdown on completed wars — otherwise
            "5h left" and "Victory!" both render simultaneously and
            read as broken. (Audit 15 #M7.) */}
        {!completed && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{hoursLeft > 0 ? `${hoursLeft}h left` : 'Ending soon'}</span>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Score bar */}
        <ScoreBar myScore={myScore} theirScore={theirScore} />

        {/* My crew contribution leaderboard */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Your Squad</p>
          {myContribs.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-1">No contributions yet — complete a workout to score!</p>
          ) : (
            <div className="space-y-1">
              {myContribs.slice(0, 5).map((c, i) => (
                <ContribRow
                  key={c.user_id}
                  rank={i + 1}
                  userId={c.user_id}
                  xp={c.xp_contributed}
                  isCurrentUser={c.user_id === currentUserId}
                />
              ))}
            </div>
          )}
        </div>

        {/* End date — only show while the war is in flight. */}
        {!completed && (
          <p className="text-[10px] text-muted-foreground text-center">
            War ends {formatDistanceToNow(new Date(war.ends_at), { addSuffix: true })} · XP earned this week counts
          </p>
        )}
      </div>

      {/* Completed state */}
      {war.status === 'completed' && (
        <div className={`px-4 py-3 border-t border-border text-center ${war.winner_crew_id === crewId ? 'bg-primary/8' : 'bg-secondary/60'}`}>
          <div className="flex items-center justify-center gap-2">
            {war.winner_crew_id === crewId ? (
              <>
                <Crown className="w-4 h-4 text-yellow-500" />
                <span className="font-black text-sm text-primary">Victory!</span>
              </>
            ) : (
              <>
                <Trophy className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-sm text-muted-foreground">Defeated — good fight</span>
              </>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
