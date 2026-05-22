// src/components/crews/CrewWarPanel.jsx
// Live crew war scoreboard panel — shown on the Crews page when an active war exists.

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Flame, Shield, Clock, Crown, Trophy } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getActiveWarForCrew, getWarContributions, getWarScore, getOpponentScore } from '@/lib/data/crewWars';
import { fireCrewWinCelebration } from '@/lib/crewWinCelebration';
import { useAuth } from '@/lib/AuthContext';
import { formatDistanceToNow, differenceInHours } from 'date-fns';

function ScoreBar({ myScore, theirScore }) {
  const total = myScore + theirScore || 1;
  const myPct = Math.round((myScore / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-bold tabular-nums">
        <span className="text-primary">{myScore.toLocaleString()}</span>
        <span className="text-muted-foreground">{theirScore.toLocaleString()}</span>
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
        <span className="text-xs font-bold tabular-nums">{xp.toLocaleString()} XP</span>
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

export default function CrewWarPanel({ crewId, currentUserId }) {
  const { user } = useAuth();
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
    });
    markCelebrated(user.id, war.id);
  }, [war, user?.id, user?.email, crewId, currentUserId, contributions]);

  if (!war) return null;

  const myScore    = getWarScore(war, crewId);
  const theirScore = getOpponentScore(war, crewId);
  const hoursLeft  = differenceInHours(new Date(war.ends_at), new Date());
  const winning    = myScore >= theirScore;

  const myContribs    = contributions.filter(c => c.crew_id === crewId).sort((a, b) => b.xp_contributed - a.xp_contributed);
  const theirContribs = contributions.filter(c => c.crew_id !== crewId).sort((a, b) => b.xp_contributed - a.xp_contributed);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border overflow-hidden mb-4"
    >
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${winning ? 'bg-primary/8' : 'bg-rose-500/5'}`}>
        <div className="flex items-center gap-2">
          <Shield className={`w-4 h-4 ${winning ? 'text-primary' : 'text-rose-500'}`} />
          <span className="font-black text-sm">Crew War</span>
          {winning && <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">Leading</span>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>{hoursLeft > 0 ? `${hoursLeft}h left` : 'Ending soon'}</span>
        </div>
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

        {/* End date */}
        <p className="text-[10px] text-muted-foreground text-center">
          War ends {formatDistanceToNow(new Date(war.ends_at), { addSuffix: true })} · XP earned this week counts
        </p>
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
