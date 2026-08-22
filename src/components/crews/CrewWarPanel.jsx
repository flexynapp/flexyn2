// src/components/crews/CrewWarPanel.jsx
// Live crew war scoreboard panel — shown on the Crews page when an active war exists.

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Clock, Crown, Trophy } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getActiveWarForCrew, getWarBreakdown, getWarScore, getOpponentScore } from '@/lib/data/crewWars';
import { fireCrewWinCelebration } from '@/lib/crewWinCelebration';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { formatDistanceToNow, differenceInHours } from 'date-fns';
import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';
import { useNumberFormatter } from '@/lib/intl';

function ScoreBar({ myScore, theirScore }) {
  const { tFallback } = useLanguage();
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
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{tFallback("crewWarPanel.yourCrew", "Your Crew")}</span>
        <span>{tFallback("crewWarPanel.rivalCrew", "Rival Crew")}</span>
      </div>
    </div>
  );
}

// One member's contribution. The tint carries "this is you" and the
// weight carries rank — no border, per docs/profile-ui-premium-research.md,
// which counted borders-as-separators as the thing that makes a screen read
// like settings. Names are real now: migration 249's breakdown RPC returns
// them in the same round trip, so this stopped rendering "Member" for
// everyone except the viewer.
function ContribRow({ rank, row, isCurrentUser, isMvp }) {
  const fmt = useNumberFormatter();
  const name = isCurrentUser
    ? 'You'
    : (row.username || row.full_name || 'Member');
  const idle = (row.score || 0) === 0;

  return (
    <div className={`flex items-center gap-2.5 py-2 px-2 -mx-2 rounded-lg ${isCurrentUser ? 'bg-primary/[0.07]' : ''}`}>
      <span className="text-xs w-5 text-center tabular-nums text-muted-foreground">
        {rank}
      </span>
      <p className={`flex-1 min-w-0 truncate text-xs ${idle ? 'text-muted-foreground' : ''} ${isCurrentUser ? 'font-bold' : ''}`}>
        {name}
        {row.days_active > 0 && (
          <span className="text-muted-foreground font-normal">
            {' · '}{row.days_active}d · {row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}
          </span>
        )}
      </p>
      {isMvp && (
        <span className="text-xs font-bold text-yellow-500 shrink-0">MVP</span>
      )}
      <span className={`text-xs font-bold tabular-nums shrink-0 ${idle ? 'text-muted-foreground' : ''}`}>
        {fmt(row.score || 0)}
      </span>
    </div>
  );
}

// Where the points actually came from, for the viewer's own crew. Text
// only — the metric name, how it's weighted, and what it produced.
function MetricBreakdown({ totals, myCrewId }) {
  const { tFallback } = useLanguage();
  const fmt  = useNumberFormatter();
  const mine = (totals || []).find(t => t.crew_id === myCrewId);
  if (!mine) return null;

  const vol  = Number(mine.volume_lbs)  || 0;
  const sess = Number(mine.sessions)    || 0;
  const days = Number(mine.days_active) || 0;
  if (vol === 0 && sess === 0 && days === 0) return null;

  const lines = [
    { label: tFallback('hero.tele.volume.title', 'Volume lifted'), detail: `${fmt(vol)} lb`, points: Math.floor(vol / 100) },
    { label: tFallback('crewWar.line.sessions', 'Sessions logged'), detail: fmt(sess), points: sess * 50 },
    { label: tFallback('crewWar.line.days', 'Days active'), detail: fmt(days), points: days * 100 },
  ];

  return (
    <div>
      <p className="text-xs font-semibold mb-1">{tFallback("crewWarPanel.whereYourPointsCameFrom", "Where your points came from")}</p>
      {lines.map(l => (
        <div key={l.label} className="flex items-center gap-2 py-1 text-xs">
          <span className="flex-1 text-muted-foreground">
            {l.label} <span className="text-muted-foreground/70">· {l.detail}</span>
          </span>
          <span className="font-bold tabular-nums">{fmt(l.points)}</span>
        </div>
      ))}
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
  const { language, tFallback } = useLanguage();
  const { data: war } = useQuery({
    queryKey:  ['activeWar', crewId],
    queryFn:   () => getActiveWarForCrew(crewId),
    enabled:   !!crewId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  // Migration 249's breakdown: per-side metric totals plus my crew's ranked
  // members, with display names, in one round trip. The RPC deliberately
  // returns only my own crew's member rows — the scoreboard is public, but
  // which of your rivals trained on which day is not.
  const { data: breakdown } = useQuery({
    queryKey:  ['warBreakdown', war?.id],
    queryFn:   () => getWarBreakdown(war?.id),
    enabled:   !!war?.id,
    staleTime: 60_000,
  });

  const contributions = breakdown?.members ?? [];

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
    // 249 renamed the per-member figure: the breakdown RPC returns `score`
    // (the volume/sessions/days blend), not the old raw `xp_contributed`.
    // A member who was in the crew but never trained now has a row with a
    // zero score, so "did you contribute" is a value test rather than a
    // row-exists test — otherwise everyone gets the contributor toast.
    const myContribution = contributions.find(c => c.user_id === currentUserId);
    const myScoreShare   = Number(myContribution?.score) || 0;
    fireCrewWinCelebration({
      crewName: war.winner_crew_name,
      xpGained: myScoreShare,
      finalScore: getWarScore(war, crewId),
      wasContributor: myScoreShare > 0,
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

  // Already my crew only, and already ranked, server-side.
  const myContribs = contributions;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border overflow-hidden mb-4"
    >
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${winning ? 'bg-primary/10' : tied ? 'bg-amber-500/5' : 'bg-rose-500/5'}`}>
        <div className="flex items-center gap-2">
          <Shield className={`w-4 h-4 ${winning ? 'text-primary' : tied ? 'text-amber-500' : 'text-rose-500'}`} />
          <span className="font-black text-sm">{tFallback("crewWarPanel.crewWar", "Crew War")}</span>
          {winning && <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">{tFallback("crewWarPanel.leading", "Leading")}</span>}
          {tied && !completed && <span className="text-xs font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">{tFallback("crewWarPanel.tied", "Tied")}</span>}
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

        {/* Where the points came from — the case for the new scoring. */}
        <MetricBreakdown totals={breakdown?.totals} myCrewId={breakdown?.myCrewId ?? crewId} />

        {/* My crew's ranked members */}
        <div>
          <p className="text-xs font-semibold mb-1">{tFallback("crewWarPanel.whoSCarrying", "Who's carrying")}</p>
          {myContribs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nobody has trained toward this yet — log a session to put your crew on the board.
            </p>
          ) : (
            <div>
              {myContribs.slice(0, 6).map((c, i) => (
                <ContribRow
                  key={c.user_id}
                  rank={i + 1}
                  row={c}
                  isCurrentUser={c.user_id === currentUserId}
                  isMvp={completed && war.mvp_user_id === c.user_id}
                />
              ))}
            </div>
          )}
        </div>

        {/* End date — only show while the war is in flight. */}
        {!completed && (
          <p className="text-xs text-muted-foreground text-center">
            Ends {formatDistanceToNow(new Date(war.ends_at), { addSuffix: true })} · volume, sessions and days trained all score
          </p>
        )}
      </div>

      {/* Completed state */}
      {war.status === 'completed' && (
        <div className={`px-4 py-3 border-t border-border text-center ${war.winner_crew_id === crewId ? 'bg-primary/10' : 'bg-secondary/60'}`}>
          <div className="flex items-center justify-center gap-2">
            {war.winner_crew_id === crewId ? (
              <>
                <Crown className="w-4 h-4 text-yellow-500" />
                <span className="font-black text-sm text-primary">{tFallback("crewWarPanel.victory", "Victory!")}</span>
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
