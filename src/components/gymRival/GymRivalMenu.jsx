// src/components/gymRival/GymRivalMenu.jsx
//
// Full-screen Gym Rival menu. Designed in Penpot — page "Gym Rival",
// boards B–K; board L carries the evidence each decision rests on.
//
// Flow:
//   reveal (once per match) → then one of:
//     • pending  → confirm view (both must opt in; AFK-proofing)
//     • stalled  → an active row that can never settle (see below)
//     • active   → live head-to-head + the 48h AFK gate
//     • void     → "someone went AFK" + reset timer until the next roll
//     • settled  → win / loss / the empty week
//
// Three things this screen used to get wrong, all fixed here:
//
//   1. The rival's number was structurally always 0. It read their
//      workout_logs from the browser, and that table is owner-only RLS, so
//      the right-hand column could never be anything else — and the screen
//      printed "0 — 0 · Dead even" on top of it. Totals now come from
//      gym_rival_week_state (migration 363), server-side and participant-
//      gated, and when that call is unavailable the screen SAYS the total
//      isn't known rather than showing a zero.
//   2. The countdown was msUntilWeekEnd() — pure calendar arithmetic that
//      never read the assignment. A match assigned in June and never
//      accepted still rendered "14h 18m left", re-arming every Monday
//      forever. The clock is now the settler's own window, and a match that
//      cannot settle gets its own state instead of a fake countdown.
//   3. Net rating IS volume / 100, so the big "0 — 0" and the VOLUME row
//      below it were one metric drawn twice. There is now one figure, in the
//      metric's own units, and the sentence under it states the GAP — which
//      is the number a user can act on.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Target, Swords, RefreshCw, Loader2, Dumbbell, Footprints, Trophy, Check, AlertTriangle, Award } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import {
  getRivalProfile, isThisWeek, computeRivalReward,
  confirmGymRival, voidStaleGymRival, getGymRivalRecord,
  getGymRivalWeekState, rivalMetric, matchQuality,
} from '@/lib/data/gymRival';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance } from '@/lib/distanceUnit';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight } from '@/lib/weightUnit';
import { useNumberFormatter, useDateFormatter, formatDuration } from '@/lib/intl';
import { useLanguage } from '@/lib/LanguageContext';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { getCrewBadges } from '@/lib/data/crews';
import { RulesButton } from '@/components/competition/RulesSheet';

// Higher of two numbers: true = user wins, false = rival, null = tie.
const cmp = (a, b) => { const x = Number(a) || 0, y = Number(b) || 0; return x === y ? null : x > y; };
// Win rate from a {wins, losses} record (0 when no games played).
const winRate = (rec) => { const w = rec?.wins || 0, l = rec?.losses || 0; return (w + l) ? w / (w + l) : 0; };

const revealedKey = (id) => `flexyn.gymRival.revealed.${id}`;

function Avatar({ profile, size = 'w-20 h-20', ring = 'ring-primary/40' }) {
  const name = profile?.username || '';
  return profile?.avatar_url ? (
    <img loading="lazy" src={profile.avatar_url} alt={name}
      className={`${size} rounded-full object-cover ring-2 ${ring} shrink-0`} />
  ) : (
    <div className={`${size} rounded-full bg-primary/20 ring-2 ${ring} flex items-center justify-center shrink-0`}>
      <span className="text-2xl font-black text-primary">{name[0]?.toUpperCase() || '?'}</span>
    </div>
  );
}

/** One dot + label. The 48h gate decides most matches, so it gets a real
 *  affordance rather than a line of warning text. */
function LogDot({ on, label, unknown }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
        unknown ? 'bg-muted-foreground/40' : on ? 'bg-success' : 'bg-primary/30'}`} />
      <span className={`text-micro font-bold truncate ${on && !unknown ? 'text-success' : 'text-muted-foreground'}`}>
        {label}
      </span>
    </span>
  );
}

/**
 * The hero: one metric, one divided track, one sentence stating the gap.
 * `them` is null when the server-side total isn't available — the remainder
 * of the track is then hatched and the screen says so, because a zero there
 * would be a claim we cannot make.
 */
function HeadToHead({ label, youLabel, you, them, youText, themText, rivalName, gapText, gapTone, absentText }) {
  const known = them != null;
  const total = known ? (you + them) : 0;
  // Floor and cap the fill so a tiny lead is still visible and a shutout
  // doesn't read as a full bar with no opponent.
  const pct = known && total > 0 ? Math.min(92, Math.max(8, (you / total) * 100)) : 42;
  const toneClass = gapTone === 'ahead' ? 'text-success' : gapTone === 'behind' ? 'text-primary' : 'text-foreground';

  return (
    <div className="mb-6">
      <p className="text-micro font-black uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex items-end justify-between gap-2 mt-2">
        <span className="text-micro font-black uppercase tracking-wider text-success">{youLabel}</span>
        <span className="text-micro font-black uppercase tracking-wider text-primary truncate max-w-[55%]">@{rivalName}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-heading font-black text-3xl tabular-nums text-success">{youText}</span>
        {known
          ? <span className="font-heading font-black text-3xl tabular-nums">{themText}</span>
          : <span className="text-xs font-bold text-muted-foreground text-end max-w-[50%]">{absentText}</span>}
      </div>
      <div className="mt-2 h-2.5 rounded-full bg-secondary overflow-hidden flex" aria-hidden="true">
        <span className="h-full bg-success rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <p className={`text-sm font-black mt-2 ${toneClass}`}>{gapText}</p>
    </div>
  );
}

/**
 * The crew under a username. Renders nothing when the lifter is in no crew,
 * and drops the bracket when the crew has no tag — `crews.tag` is NULL on
 * every production crew, so "Iron Legion []" is the default case, not an edge
 * one.
 */
function CrewLine({ crew, className = '' }) {
  if (!crew?.name) return null;
  return (
    <span className={`block text-micro text-muted-foreground truncate ${className}`}>
      {crew.tag ? `${crew.name} · [${crew.tag}]` : crew.name}
    </span>
  );
}

/** A hairline key/value row — the size-up table and the why-ledger. */
function Row({ label, children, valueClass = '' }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold text-end ${valueClass}`}>{children}</span>
    </div>
  );
}

function StatRow({ icon: Icon, label, userVal, rivalVal, userWins }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-border last:border-b-0">
      <span className={`flex-1 text-end text-sm font-bold tabular-nums ${userWins === true ? 'text-success' : 'text-foreground'}`}>{userVal}</span>
      <span className="flex items-center gap-1 w-28 justify-center text-micro font-bold uppercase tracking-wider text-muted-foreground shrink-0">
        <Icon className="w-3 h-3" /> {label}
      </span>
      <span className={`flex-1 text-start text-sm font-bold tabular-nums ${userWins === false ? 'text-success' : 'text-foreground'}`}>{rivalVal}</span>
    </div>
  );
}

export default function GymRivalMenu({ open, onClose, assignment, currentUserId, onReroll, rerolling, onDecline, declining, onChallenge }) {
  const { tFallback, language } = useLanguage();
  const fmtDuration = (ms) => formatDuration(ms, language);
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { distanceUnit } = useDistanceUnit();
  const { weightUnit } = useWeightUnit();
  const fmt = useNumberFormatter();
  const fmtDate = useDateFormatter();

  // Which side am I, and who's my rival?
  const iAmInitiator  = assignment ? assignment.user_id === currentUserId : true;
  const otherId       = assignment ? (iAmInitiator ? assignment.rival_id : assignment.user_id) : null;
  const iConfirmed    = assignment ? (iAmInitiator ? assignment.initiator_confirmed : assignment.rival_confirmed) : false;
  const otherConfirmed = assignment ? (iAmInitiator ? assignment.rival_confirmed : assignment.initiator_confirmed) : false;
  const status = assignment?.status;
  // A void no longer locks anyone out until Monday: gym_rival_roll only
  // refuses while a match is pending or active, so the void screen offers the
  // next roll straight away.
  const isVoid = status === 'void';
  const settledRecent = status === 'completed' && assignment?.settled_at
    && (Date.now() - new Date(assignment.settled_at).getTime() < 2 * 86400_000);
  const myResult = assignment?.winner_id
    ? (assignment.winner_id === currentUserId ? 'win' : 'loss')
    : 'draw';

  const { data: rival } = useQuery({
    queryKey: ['gymRivalProfile', otherId],
    queryFn:  () => getRivalProfile(otherId),
    enabled:  open && !!otherId,
    staleTime: 5 * 60_000,
  });
  const { data: me } = useQuery({
    queryKey: ['gymRivalProfile', currentUserId],
    queryFn:  () => getRivalProfile(currentUserId),
    enabled:  open && !!currentUserId,
    staleTime: 5 * 60_000,
  });
  // The match week, server-side. Replaces the client-side cross-user read,
  // which RLS made structurally empty. Settled matches too, so the result
  // screen can show a final scoreline rather than only a verdict, and voided
  // ones so the void screen can say who logged.
  const { data: week } = useQuery({
    queryKey: ['gymRivalWeek', assignment?.id],
    queryFn:  () => getGymRivalWeekState(assignment.id),
    enabled:  open && !!assignment?.id && (status === 'active' || status === 'completed' || status === 'void'),
    staleTime: 60_000,
  });
  // Crew identity for both lifters, in one round trip.
  const { data: crews } = useQuery({
    queryKey: ['crewBadges', currentUserId, otherId],
    queryFn:  () => getCrewBadges([currentUserId, otherId]),
    enabled:  open && !!currentUserId && !!otherId,
    staleTime: 5 * 60_000,
  });

  const { data: myRecord } = useQuery({
    queryKey: ['gymRivalRecord', currentUserId],
    queryFn:  () => getGymRivalRecord(currentUserId),
    enabled:  open && !!currentUserId,
    staleTime: 5 * 60_000,
  });
  const { data: rivalRecord } = useQuery({
    queryKey: ['gymRivalRecord', otherId],
    queryFn:  () => getGymRivalRecord(otherId),
    enabled:  open && !!otherId,
    staleTime: 5 * 60_000,
  });

  // An active row with no accepted_at can never be settled — the settler and
  // the AFK voider both require accepted_at IS NOT NULL. The server tells us;
  // the assignment column is the fallback when the RPC isn't deployed yet.
  const isStalled = status === 'active'
    && (week ? week.isStalled : (!assignment?.accepted_at && !isThisWeek(assignment?.assigned_at)));

  // Lazy AFK void check when opening an active match.
  useEffect(() => {
    if (!open || status !== 'active' || !assignment?.id) return;
    voidStaleGymRival(assignment.id).then((row) => {
      if (row?.status === 'void') qc.invalidateQueries({ queryKey: ['myGymRival'] });
    });
  }, [open, status, assignment?.id, qc]);

  const confirmMut = useMutation({
    mutationFn: () => confirmGymRival(assignment.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['myGymRival'] }),
    onError: () => toast.error(tFallback('gymRivalMenu.confirmFailed', 'Could not confirm. Try again.')),
  });

  // Reveal once per assignment (read fresh each open — the instance persists).
  const [stage, setStage] = useState('done');
  useEffect(() => {
    if (!open || !rival || !assignment?.id) return;
    let revealed = false;
    try { revealed = !!localStorage.getItem(revealedKey(assignment.id)); } catch { /* ignore */ }
    if (revealed) { setStage('done'); return; }
    setStage('searching');
    const t1 = setTimeout(() => setStage('revealing'), 1400);
    return () => { clearTimeout(t1); };
  }, [open, rival, assignment?.id]);

  const finishReveal = () => {
    setStage('done');
    try { localStorage.setItem(revealedKey(assignment.id), '1'); } catch { /* ignore */ }
  };

  // Ticking clock (1/min) for the countdowns.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [open]);
  // The clock is the SETTLER's window, not the calendar week. Without the
  // server's answer there is no honest countdown, so none is rendered.
  const weekLeft = useMemo(
    () => (week?.endsAt ? week.endsAt.getTime() - Date.now() : null),
    [week?.endsAt, nowTick],
  );
  const afkMsLeft = useMemo(
    () => (week?.afkDeadline ? week.afkDeadline.getTime() - Date.now() : null),
    [week?.afkDeadline, nowTick],
  );

  if (!open) return null;

  const rivalType = assignment?.rival_type || 'gym';
  const isCardio = rivalType === 'cardio';
  const typeLabel = isCardio
    ? tFallback('gymRivalCard.cardioRival', 'Cardio Rival')
    : tFallback('gymRivalCard.gymRival', 'Gym Rival');
  const rivalName = rival?.username || '—';
  const myCrew    = crews?.[currentUserId] || null;
  const rivalCrew = otherId ? (crews?.[otherId] || null) : null;
  const reward = computeRivalReward();
  // I won and the rival never logged: the settler paid the walkover prize.
  const paidOut = computeRivalReward({ walkover: myResult === 'win' && !!week && !week.themLogged });
  const dist = (m) => formatDistance(m || 0, distanceUnit, m >= 1000 ? 1 : 2);
  const metric = rivalMetric(week, rivalType);
  const metricText = (v) => (isCardio ? dist(v) : formatWeight(v, weightUnit));

  // The gap, in the metric's own units — the actionable number.
  const gap = metric ? metric.you - metric.them : null;
  const gapTone = gap == null ? 'even' : gap > 0 ? 'ahead' : gap < 0 ? 'behind' : 'even';
  const gapText = !metric
    ? tFallback('gymRivalMenu.yourTotalSoFar', 'Your total so far')
    : gap > 0
      ? tFallback('gymRivalMenu.youLeadBy', 'You lead by {v}', { v: metricText(Math.abs(gap)) })
      : gap < 0
        ? tFallback('gymRivalMenu.youTrailBy', "You're {v} behind", { v: metricText(Math.abs(gap)) })
        : tFallback('gymRivalMenu.levelWith', 'Level with @{n}', { n: rivalName });

  const metricLabel = isCardio
    ? tFallback('gymRivalMenu.metricDistance', 'Total distance this week')
    : tFallback('gymRivalMenu.metricVolume', 'Total volume this week');
  const absentText = tFallback('gymRivalMenu.scoredAtSettlement', 'scored at settlement');
  const quality = matchQuality(assignment?.match_gap);
  const metricNoun = isCardio
    ? tFallback('cardio.field.distance', 'Distance').toLowerCase()
    : tFallback('bodyMap.mode.volume', 'Volume').toLowerCase();

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-background overflow-y-auto safe-page"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 h-14 bg-background/90 backdrop-blur-md border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Target className="w-4 h-4 text-primary shrink-0" />
            <h2 className="font-heading font-black text-base truncate">
              {assignment ? typeLabel : tFallback('gymRivalMenu.rivals', 'Rivals')}
            </h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <RulesButton ruleset="rival" />
            <button onClick={onClose} aria-label={tFallback('common.close', 'Close')} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-secondary active:bg-secondary transition-colors shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 pt-6 pb-24">
          <AnimatePresence mode="wait">
            {stage !== 'done' ? (
              // ── Reveal (board B) ────────────────────────────────────
              <motion.div key="reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }}
                className="min-h-[60vh] flex flex-col items-center justify-center text-center">
                <motion.div
                  animate={stage === 'searching' ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={{ duration: 1.1, repeat: stage === 'searching' ? Infinity : 0 }}
                  className="relative mb-6"
                >
                  {stage === 'searching' ? (
                    <div className="w-24 h-24 rounded-full border-2 border-dashed border-primary/50 flex items-center justify-center">
                      <Target className="w-10 h-10 text-primary" />
                    </div>
                  ) : (
                    <motion.div initial={{ filter: 'blur(14px)', scale: 0.8, opacity: 0.4 }} animate={{ filter: 'blur(0px)', scale: 1, opacity: 1 }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}>
                      <Avatar profile={rival} size="w-24 h-24" />
                    </motion.div>
                  )}
                </motion.div>
                {stage === 'searching' ? (
                  <motion.p animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.4, repeat: Infinity }} className="text-sm font-bold text-muted-foreground">
                    {tFallback('gymRivalMenu.finding', 'Finding your rival for this week…')}
                  </motion.p>
                ) : (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="w-full">
                    <p className="text-micro font-black uppercase tracking-[0.2em] text-primary mb-1">
                      {tFallback('gymRivalMenu.yourRivalThisWeek', 'Your rival this week')}
                    </p>
                    <p className="font-heading font-black text-2xl">@{rivalName}</p>
                    <CrewLine crew={rivalCrew} className="mt-0.5" />
                    <p className="text-xs text-muted-foreground mt-1">
                      {tFallback('gymRivalMenu.levelAndRecord', 'Lv. {lv} · {w}–{l} record', {
                        lv: String(rival?.current_level ?? '—'),
                        w: String(rivalRecord?.wins ?? 0),
                        l: String(rivalRecord?.losses ?? 0),
                      })}
                    </p>
                    {/* A timed wait you cannot skip is a wait, not a reveal. */}
                    <button onClick={finishReveal}
                      className="mt-7 w-full py-3.5 rounded-xl bg-primary text-white font-black text-sm hover:bg-primary active:scale-[0.98] transition-all">
                      {tFallback('gymRivalMenu.seeMatchup', 'See the matchup')}
                    </button>
                  </motion.div>
                )}
              </motion.div>
            ) : settledRecent ? (
              // ── Settled (boards H / I) ──────────────────────────────
              <motion.div key="result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="text-center mb-6">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 ${myResult === 'win' ? 'bg-success/10' : myResult === 'loss' ? 'bg-primary/10' : 'bg-secondary'}`}>
                    {myResult === 'win' ? <Trophy className="w-7 h-7 text-success" />
                      : myResult === 'loss' ? <Swords className="w-7 h-7 text-primary" />
                      : <Target className="w-7 h-7 text-muted-foreground" />}
                  </div>
                  <p className="font-heading font-black text-2xl">
                    {myResult === 'win' ? tFallback('gymRivalMenu.youWonTheWeek', 'You won the week')
                      : myResult === 'loss' ? tFallback('gymRivalMenu.theyTookTheWeek', '@{n} took the week', { n: rivalName })
                      // A true tie needs identical volume to the nearest 100 lb,
                      // which is vanishingly rare — in practice a draw is the
                      // empty week, and "dead even" flatters it.
                      : (metric && metric.you === 0 && metric.them === 0)
                        ? tFallback('gymRivalMenu.neitherLogged', 'Neither of you logged')
                        : tFallback('gymRivalMenu.deadEven', 'Dead even')}
                  </p>
                </div>

                {metric && (
                  <HeadToHead
                    label={tFallback('gymRivalMenu.finalLabel', 'Final · {m}', { m: metricLabel })}
                    you={metric.you} them={metric.them}
                    youText={metricText(metric.you)} themText={metricText(metric.them)}
                    youLabel={tFallback("friendLeaderboard.you", "You")} rivalName={rivalName} absentText={absentText}
                    gapTone={myResult === 'win' ? 'ahead' : myResult === 'loss' ? 'behind' : 'even'}
                    gapText={myResult === 'win'
                      ? tFallback('gymRivalMenu.wonBy', 'Won by {v}', { v: metricText(Math.abs(gap || 0)) })
                      : myResult === 'loss'
                        ? tFallback('gymRivalMenu.shortBy', '{v} short', { v: metricText(Math.abs(gap || 0)) })
                        : tFallback('gymRivalMenu.noWinnerNoRewards', 'No winner, and no rewards.')}
                  />
                )}

                {myResult === 'win' && (
                  <div className="mb-6">
                    <p className="text-micro font-black uppercase tracking-wider text-success mb-2">
                      {tFallback('gymRivalMenu.paidOut', 'Paid out')}
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-center border-y border-border py-3">
                      <div><p className="font-heading font-black text-lg tabular-nums">{fmt(paidOut.xp)}</p><p className="text-micro text-muted-foreground uppercase tracking-wider">XP</p></div>
                      <div><p className="font-heading font-black text-lg tabular-nums">{fmt(paidOut.coins)}</p><p className="text-micro text-muted-foreground uppercase tracking-wider">{tFallback('gymRivalMenu.coins', 'Coins')}</p></div>
                      <div><p className="font-heading font-black text-lg tabular-nums">{paidOut.capsules}</p><p className="text-micro text-muted-foreground uppercase tracking-wider">{tFallback('gymRivalMenu.capsules', 'Capsules')}</p></div>
                    </div>
                  </div>
                )}

                <p className="text-sm font-bold mb-5">
                  {tFallback('gymRivalMenu.yourRecord', 'Your rival record: {w}–{l}', {
                    w: String(myRecord?.wins ?? 0), l: String(myRecord?.losses ?? 0),
                  })}
                </p>

                <button onClick={onReroll} disabled={rerolling}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-white font-black text-sm hover:bg-primary active:scale-[0.98] disabled:opacity-50 transition-all">
                  {rerolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                  {rerolling ? tFallback('gymRival.searching', 'Searching…') : tFallback('gymRivalMenu.findNewRival', 'Find a new rival')}
                </button>
              </motion.div>
            ) : isStalled ? (
              // ── Stalled (board F) ───────────────────────────────────
              <motion.div key="stalled" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="text-center mb-7">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="w-7 h-7 text-primary" />
                  </div>
                  <p className="font-heading font-black text-xl">
                    {tFallback('gymRivalMenu.stalledTitle', "This match can't finish")}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {tFallback('gymRivalMenu.stalledDesc', 'It was never accepted by both sides, so the weekly settlement skips it. Nothing you log will score against it.')}
                  </p>
                </div>
                <p className="text-micro font-black uppercase tracking-wider text-muted-foreground mb-1">
                  {tFallback('gymRivalMenu.why', 'Why')}
                </p>
                <div className="mb-6">
                  <Row label={tFallback('gymRivalMenu.assigned', 'Assigned')}>
                    {assignment?.assigned_at ? fmtDate(new Date(assignment.assigned_at), { dateStyle: 'medium' }) : '—'}
                  </Row>
                  <Row label={tFallback('gymRivalMenu.accepted', 'Accepted')} valueClass="text-primary">
                    {tFallback('gymRivalMenu.never', 'never')}
                  </Row>
                  <Row label={tFallback('gymRivalMenu.settles', 'Settles')} valueClass="text-primary">
                    {tFallback('gymRivalMenu.never', 'never')}
                  </Row>
                </div>
                <button onClick={onReroll} disabled={rerolling}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-white font-black text-sm hover:bg-primary active:scale-[0.98] disabled:opacity-50 transition-all">
                  {rerolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {tFallback('gymRivalMenu.clearAndReroll', 'Clear it and find a new rival')}
                </button>
              </motion.div>
            ) : isVoid ? (
              // ── Void / AFK (board G) ────────────────────────────────
              <motion.div key="void" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="text-center mb-7">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="w-7 h-7 text-primary" />
                  </div>
                  <p className="font-heading font-black text-xl">
                    {tFallback('gymRivalCard.challengeVoided', 'Challenge voided')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {tFallback('gymRivalMenu.voidDesc', 'Neither of you logged a session within 48 hours of accepting, so the match was cancelled. No rewards for either side.')}
                  </p>
                </div>
                {week && (
                  <>
                    <p className="text-micro font-black uppercase tracking-wider text-muted-foreground mb-1">
                      {tFallback('gymRivalMenu.whoLogged', 'Who logged')}
                    </p>
                    <div className="mb-4">
                      <Row label={tFallback('friendLeaderboard.you', 'You')} valueClass={week.youLogged ? 'text-success' : 'text-muted-foreground'}>
                        {week.youLogged ? tFallback('gymRivalMenu.logged', 'Logged') : tFallback('gymRivalMenu.never', 'never')}
                      </Row>
                      <Row label={`@${rivalName}`} valueClass={week.themLogged ? 'text-success' : 'text-muted-foreground'}>
                        {week.themLogged ? tFallback('gymRivalMenu.logged', 'Logged') : tFallback('gymRivalMenu.never', 'never')}
                      </Row>
                    </div>
                  </>
                )}
                {/* A voided match is not a voided workout — say so, or the
                    screen reads as if the session was wasted. */}
                <p className="text-xs text-muted-foreground mb-6">
                  {tFallback('gymRivalMenu.voidStillCounts', 'Your sessions still count for XP, quests and your league. Only the rival match was cancelled.')}
                </p>
                <button onClick={onReroll} disabled={rerolling}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-white font-black text-sm hover:bg-primary active:scale-[0.98] disabled:opacity-50 transition-all">
                  {rerolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                  {rerolling ? tFallback('gymRival.searching', 'Searching…') : tFallback('gymRivalMenu.findNewRival', 'Find a new rival')}
                </button>
              </motion.div>
            ) : status === 'pending' ? (
              // ── Pending confirmation (board C) ──────────────────────
              <motion.div key="pending" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex items-stretch justify-between gap-3 mb-6">
                  <div className="flex-1 flex flex-col items-center text-center">
                    <Avatar profile={me} ring="ring-success/40" />
                    <p className="mt-2 text-sm font-black">{tFallback('friendLeaderboard.you', 'You')}</p>
                    <CrewLine crew={myCrew} className="max-w-full" />
                    <p className={`text-micro font-bold ${iConfirmed ? 'text-success' : 'text-muted-foreground'}`}>
                      {iConfirmed ? tFallback('gymRivalMenu.ready', 'Ready') : tFallback('gymRivalMenu.notYet', 'Not yet')}
                    </p>
                  </div>
                  <div className="flex flex-col items-center justify-center shrink-0">
                    <span className="font-heading font-black text-lg text-muted-foreground">VS</span>
                    <Swords className="w-4 h-4 text-primary mt-1" />
                  </div>
                  <div className="flex-1 flex flex-col items-center text-center">
                    <Avatar profile={rival} />
                    <p className="mt-2 text-sm font-black truncate max-w-full">@{rivalName}</p>
                    <CrewLine crew={rivalCrew} className="max-w-full" />
                    <p className={`text-micro font-bold ${otherConfirmed ? 'text-success' : 'text-muted-foreground'}`}>
                      {otherConfirmed ? tFallback('gymRivalMenu.ready', 'Ready') : tFallback('gymRivalMenu.notYet', 'Not yet')}
                    </p>
                  </div>
                </div>

                {/* Read-only data gets hairlines, not a card. */}
                <p className="text-micro font-black uppercase tracking-wider text-muted-foreground">
                  {tFallback('gymRivalMenu.sizeThemUp', 'Size them up')}
                </p>
                <div className="mb-2">
                  <div className="flex items-center gap-2 pt-2 pb-1">
                    <span className="flex-1 text-end text-micro font-black uppercase tracking-wider text-success">{tFallback('friendLeaderboard.you', 'You')}</span>
                    <span className="w-28" />
                    <span className="flex-1 text-start text-micro font-black uppercase tracking-wider text-primary truncate">@{rivalName}</span>
                  </div>
                  <StatRow icon={Award} label={tFallback('gymRivalMenu.level', 'Level')} userVal={me?.current_level ?? '—'} rivalVal={rival?.current_level ?? '—'} userWins={cmp(me?.current_level, rival?.current_level)} />
                  <StatRow icon={Swords} label={tFallback('gymRivalMenu.record', 'W / L')} userVal={`${myRecord?.wins ?? 0}–${myRecord?.losses ?? 0}`} rivalVal={`${rivalRecord?.wins ?? 0}–${rivalRecord?.losses ?? 0}`} userWins={cmp(winRate(myRecord), winRate(rivalRecord))} />
                  {isCardio ? (
                    <StatRow icon={Footprints} label={tFallback('cardio.field.distance', 'Distance')} userVal={dist(me?.total_distance_meters)} rivalVal={dist(rival?.total_distance_meters)} userWins={cmp(me?.total_distance_meters, rival?.total_distance_meters)} />
                  ) : (
                    <StatRow icon={Dumbbell} label={tFallback('bodyMap.mode.volume', 'Volume')} userVal={formatWeight(me?.total_volume_lbs || 0, weightUnit)} rivalVal={formatWeight(rival?.total_volume_lbs || 0, weightUnit)} userWins={cmp(me?.total_volume_lbs, rival?.total_volume_lbs)} />
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-6">
                  {tFallback('gymRivalMenu.lifetimeNote', 'Lifetime figures. The match starts level when you both accept.')}
                </p>

                {/* Say how close the matchup is rather than asserting it is
                    fair. Absent on rows rolled before migration 364. */}
                {quality && (
                  <div className="mb-6">
                    <p className="text-micro font-black uppercase tracking-wider text-muted-foreground">
                      {tFallback('gymRivalMenu.matchQuality', 'Match quality')}
                    </p>
                    <p className="text-sm font-bold mt-1">
                      {quality === 'very-close' ? tFallback('gymRivalMenu.qualityVeryClose', 'Very close match')
                        : quality === 'close' ? tFallback('gymRivalMenu.qualityClose', 'Close match')
                        : quality === 'fair' ? tFallback('gymRivalMenu.qualityFair', 'Fair match')
                        : tFallback('gymRivalMenu.qualityWidest', 'Closest available right now')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tFallback('gymRivalMenu.qualityBasis', 'Matched on recent weekly {m}, training days, level, strength and age.', { m: metricNoun })}
                    </p>
                  </div>
                )}

                <p className="text-micro font-black uppercase tracking-wider text-primary">
                  {tFallback('gymRivalMenu.howItStarts', 'How it starts')}
                </p>
                <p className="text-sm text-muted-foreground mt-1 mb-6">
                  {tFallback('gymRivalMenu.howItStartsDesc', 'Both of you accept, then the match runs seven days from that moment. If neither of you logs a session in the first 48 hours it voids. If only one does, the match goes on.')}
                </p>

                {!iConfirmed ? (
                  <button
                    onClick={() => confirmMut.mutate()}
                    disabled={confirmMut.isPending}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-white font-black text-sm hover:bg-primary active:bg-primary active:scale-[0.98] transition-all disabled:opacity-60"
                  >
                    {confirmMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {tFallback('gymRivalMenu.acceptChallenge', 'Accept challenge')}
                  </button>
                ) : (
                  <div className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-secondary/60 border border-border text-sm font-bold text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {tFallback('gymRivalMenu.waitingFor', 'Waiting for @{n}…', { n: rivalName })}
                  </div>
                )}
                <div className="flex gap-2 mt-2">
                  <button onClick={onDecline} disabled={declining || rerolling} className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-bold border border-border text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary/60 active:bg-secondary/60 disabled:opacity-50 transition-colors">
                    {declining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    {tFallback('gymRivalMenu.decline', 'Decline')}
                  </button>
                  {/* Reroll disappears once you're in — you already committed. */}
                  {!iConfirmed && (
                    <button onClick={onReroll} disabled={rerolling || declining} className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-bold border border-border text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary/60 active:bg-secondary/60 disabled:opacity-50 transition-colors">
                      {rerolling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      {tFallback('gymRivalMenu.reroll', 'Reroll')}
                    </button>
                  )}
                </div>
              </motion.div>
            ) : (
              // ── Active (boards D / E) ───────────────────────────────
              <motion.div key="compare" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                {/* The 48h gate, with a dot each — the rule that decides most
                    matches is not a footnote. */}
                {/* Only while it can still bite: once either side has logged,
                    the match can no longer void and the banner would read
                    as a threat that no longer applies. */}
                {afkMsLeft != null && afkMsLeft > 0 && !(week?.youLogged || week?.themLogged) && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 mb-6">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <LogDot on={week?.youLogged}
                        label={week?.youLogged ? tFallback('gymRivalMenu.youLogged', 'You logged') : tFallback('gymRivalMenu.youHaventLogged', "You haven't")} />
                      <LogDot on={week?.themLogged} unknown={!week}
                        label={week?.themLogged ? tFallback('gymRivalMenu.theyLogged', 'They logged') : tFallback('gymRivalMenu.theyHaventLogged', "They haven't")} />
                    </div>
                    <p className="text-micro text-muted-foreground font-semibold">
                      {tFallback('gymRivalMenu.afkRule', 'If neither of you logs within {t}, the match voids.', { t: fmtDuration(afkMsLeft) })}
                    </p>
                  </div>
                )}

                <button type="button" onClick={() => rival?.id && navigate(`/hub?profile=${encodeURIComponent(rival.id)}`)}
                  className="flex items-center gap-2 mb-5 text-start">
                  <Avatar profile={rival} size="w-9 h-9" />
                  <span className="min-w-0">
                    <span className="block text-sm font-black truncate">@{rivalName}</span>
                    <CrewLine crew={rivalCrew} />
                    <span className="block text-micro text-muted-foreground">
                      {tFallback('gymRivalMenu.levelN', 'Lv. {lv}', { lv: String(rival?.current_level ?? '—') })}
                    </span>
                  </span>
                </button>

                <HeadToHead
                  label={metricLabel}
                  you={metric ? metric.you : 0}
                  them={metric ? metric.them : null}
                  youText={metric ? metricText(metric.you) : '—'}
                  themText={metric ? metricText(metric.them) : ''}
                  youLabel={tFallback("friendLeaderboard.you", "You")} rivalName={rivalName} absentText={absentText}
                  gapText={gapText} gapTone={gapTone}
                />

                {!metric && (
                  <p className="text-xs text-muted-foreground -mt-4 mb-6">
                    {tFallback('gymRivalMenu.themUnavailable', 'Their total is scored server-side when the week settles.')}
                  </p>
                )}

                {/* Shown only when it costs this athlete something: they
                    logged calisthenics this week and have no bodyweight on
                    file, so migration 373 scored those sets at zero. Without
                    this line the screen shows a total they cannot explain and
                    gives them no way to fix it. A barbell lifter, and anyone
                    who has entered a weight, never sees it. */}
                {week?.youBwMissing && (
                  <p className="text-xs text-muted-foreground -mt-4 mb-6">
                    {tFallback(
                      'gymRivalMenu.bodyweightMissing',
                      'Your bodyweight sets are not counted yet. Add your weight in Settings and calisthenics counts toward this total.',
                    )}
                  </p>
                )}

                {/* The clock is the settler's window. With no server answer
                    there is no honest countdown, so none is drawn. */}
                {week?.endsAt && (
                  <div className="mb-6">
                    <Row label={tFallback('gymRivalMenu.ends', 'Ends')}>{fmtDate(week.endsAt, { dateStyle: 'medium' })}</Row>
                    <Row label={tFallback('gymRivalMenu.remaining', 'Remaining')}>
                      {weekLeft > 0 ? fmtDuration(weekLeft) : tFallback('gymRivalMenu.settlingNow', 'settling now')}
                    </Row>
                  </div>
                )}

                <div className="mb-6">
                  <p className="text-micro font-black uppercase tracking-wider text-primary">
                    {tFallback('gymRivalMenu.winnerTakes', 'Winner takes')}
                  </p>
                  <p className="font-heading font-black text-base mt-1 tabular-nums">
                    {tFallback('gymRivalMenu.prizeLine', '{xp} XP · {coins} coins · {caps} capsules', {
                      xp: fmt(reward.xp), coins: fmt(reward.coins), caps: String(reward.capsules),
                    })}
                  </p>
                </div>

                {/* The action that wins this match is training. The duel — a
                    different feature — used to be the only button here. */}
                <button onClick={() => { onClose?.(); navigate(isCardio ? '/workout?openCardio=1' : '/workout?freestyle=1'); }}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-white font-black text-sm hover:bg-primary active:scale-[0.98] transition-all">
                  {isCardio ? <Footprints className="w-4 h-4" /> : <Dumbbell className="w-4 h-4" />}
                  {isCardio
                    ? tFallback('gymRivalMenu.startCardio', 'Start a cardio session')
                    : tFallback('gymRivalMenu.logWorkout', 'Log a workout')}
                </button>
                <button onClick={onChallenge}
                  className="mt-2 w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-border text-sm font-bold hover:bg-secondary/60 active:bg-secondary/60 transition-colors">
                  <Swords className="w-4 h-4" />
                  {tFallback('gymRivalMenu.challengeToDuel', 'Challenge @{n} to a duel', { n: rivalName })}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
