// src/components/duels/DuelDetailSheet.jsx
// Bottom sheet showing a duel: live scores while it runs, the session to beat
// (Mirror and Session duels), and the result card when it is over.

import React, { useState } from 'react';
import { motion, useDragControls, useReducedMotion } from 'framer-motion';
import { haptic } from '@/lib/haptic';
import { X, Swords, Dumbbell, Timer, Trophy, Target, Crown, Check, Loader2, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { useNumberFormatter, formatDuration } from '@/lib/intl';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { acceptDuel, declineDuel, duelErrorMessage } from '@/lib/data/duels';
import { duelTypeName, duelStatusName, templateSetCount, templateExercises } from '@/components/duels/duelLabels';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

const TYPE_ICON  = { mirror: Dumbbell, open: Timer, exercise: Trophy };

export default function DuelDetailSheet({ duel, currentUserId, opponentProfile, onCancel, onClose }) {
  const { tFallback, language } = useLanguage();
  const navigate = useNavigate();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(!!duel);
  // Above the `if (!duel) return null` below, because hooks cannot sit behind
  // an early return.
  const dragControls = useDragControls();
  const reduceMotion = useReducedMotion();
  const tap = reduceMotion ? undefined : { scale: 0.97 };
  const fmt = useNumberFormatter();
  const { weightUnit } = useWeightUnit();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(null); // 'accept' | 'decline'
  if (!duel) return null;

  const session      = duel.mode === 'session';
  const Icon         = session ? Target : (TYPE_ICON[duel.type] || Swords);
  const isChallenger = duel.challenger_id === currentUserId;
  const myResult     = isChallenger ? duel.challenger_result : duel.opponent_result;
  const theirResult  = isChallenger ? duel.opponent_result   : duel.challenger_result;
  const won          = duel.winner_id === currentUserId;
  const lost         = duel.winner_id && duel.winner_id !== currentUserId;
  const tied         = duel.status === 'completed' && !duel.winner_id;
  // The expiry sweep completes a duel only one side trained for as a win for
  // that side, so a completed duel with one result is a walkover.
  const walkover     = duel.status === 'completed' && (!myResult || !theirResult);
  const prescribed   = duel.type === 'mirror' ? templateSetCount(duel.session_template) : 0;
  // When the opponent profile fails to load (deleted account, RLS
  // scoping, network blip) we previously rendered the literal string
  // "@Opponent Won" which read as a bug. Track whether the username is
  // real so the result line can switch to "Your rival won". (Audit 15 #M2.)
  const opponentName = opponentProfile?.username || null;

  // Duel volumes are stored in pounds. Rendering them as "lbs" regardless of
  // preference meant a kilograms user read every duel result in the wrong
  // unit — including the share text below, which then travelled off-app.
  const unitSuffix = weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lbs';
  const fmtVol = (v) => v != null
    ? `${fmt(Math.round(fromLbs(Number(v), weightUnit)))} ${unitSuffix}`
    : '—';
  // A Mirror is won on sets finished as well as weight, so a lead shown as
  // weight alone can read backwards. Show both.
  const fmtSide = (r) => {
    if (!r) return tFallback('duelDetailSheet.noWorkoutYet', 'No workout yet');
    if (prescribed > 0 && r.sets_completed != null) {
      return `${fmtVol(r.volume)} · ${tFallback('duelDetailSheet.setsOf', '{done} of {total} sets', { done: r.sets_completed, total: prescribed })}`;
    }
    return fmtVol(r.volume);
  };
  const fmtVolDelta = (lbs) => `${fmt(Math.round(fromLbs(Number(lbs) || 0, weightUnit)))} ${unitSuffix}`;

  // Scores come from the server (a trigger on workout_logs keeps each side's
  // best session in the window), so there is nothing to submit: the one
  // action is to go and train. In a session duel only the challenger trains;
  // the opponent's side is the session being taken on.
  const canTrain   = duel.status === 'active' && (!session || isChallenger);
  const myScore    = myResult?.score != null ? Number(myResult.score) : null;
  const theirScore = theirResult?.score != null ? Number(theirResult.score) : null;
  const lead = myScore != null && theirScore != null
    ? (myScore > theirScore ? 'me' : theirScore > myScore ? 'them' : 'even')
    : null;
  const msLeft = duel.expires_at ? new Date(duel.expires_at) - Date.now() : 0;
  const theirLabel = opponentName ? `@${opponentName}` : tFallback('duelDetailSheet.rival', 'Rival');
  const canRespond = !isChallenger && duel.status === 'pending';
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['activeDuel'] });
    qc.invalidateQueries({ queryKey: ['myDuels'] });
  };
  const run = async (kind, fn, success) => {
    if (busy) return;
    setBusy(kind);
    haptic('primary');
    try {
      await fn();
      refresh();
      haptic('success');
      toast.success(success);
      onClose?.();
    } catch (err) {
      haptic('warning');
      toast.error(duelErrorMessage(err, tFallback));
    } finally {
      setBusy(null);
    }
  };
  const handleTrain = () => {
    haptic('primary');
    onClose?.();
    navigate('/workout');
  };
  const handleAccept = () => run('accept', () => acceptDuel(duel.id),
    tFallback('duelInviteCard.accepted', 'Duel accepted! Game on. 🔥'));
  const handleDecline = () => run('decline', () => declineDuel(duel.id),
    tFallback('duelInviteCard.declined', 'Duel declined.'));

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <motion.div
        className="relative w-full max-w-md bg-background border border-border rounded-t-2xl shadow-md overflow-hidden max-h-[85vh] overflow-y-auto"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        drag="y"
        // Handle-only, because THIS element is also the scroller
        // (`max-h-[85vh] overflow-y-auto` above). A live drag listener makes
        // framer write `touch-action: pan-x` onto it, which forbids the very
        // vertical pan the overflow exists for — so a duel longer than 85vh
        // could not be read on a phone at all. See BottomSheet.jsx for the
        // full mechanism.
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.3 }}
        onDragEnd={(_e, info) => {
          if (info.velocity.y >= 300 || info.offset.y >= 80) onClose?.();
        }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      >
        {/* Handle — the only thing that starts the dismiss drag, so it owns
            the gesture (`touch-none`) and gets a real tap target around the
            1px pill rather than just the pill's own height. */}
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing touch-none select-none"
        >
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-primary" />
            <span className="font-bold">
              {session && opponentName && isChallenger
                ? tFallback('duelDetailSheet.sessionTitle', "Beat @{name}'s session", { name: opponentName })
                : duelTypeName(duel.type, tFallback, duel.mode)}
            </span>
          </div>
          <motion.button type="button" whileTap={tap} onClick={onClose} aria-label={tFallback('common.close', 'Close')} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-secondary active:bg-secondary">
            <X className="w-4 h-4 text-muted-foreground" />
          </motion.button>
        </div>

        <div className="px-5 pb-6 space-y-5">
          {/* Completed — Result Card */}
          {duel.status === 'completed' && (
            <div className={`rounded-2xl border-2 p-4 ${won ? 'border-success bg-success/5' : 'border-border'}`}>
              <div className="flex items-center gap-2 mb-4">
                <Crown className={`w-5 h-5 ${won ? 'text-success' : 'text-muted-foreground'}`} />
                <span className="font-black text-base">
                  {session
                    ? (isChallenger
                        ? (won
                            ? tFallback('duelDetailSheet.beatSession', "You beat @{name}'s session", { name: opponentName || '' })
                            : tFallback('duelDetailSheet.sessionHeld', 'Their session held'))
                        : (lost
                            ? tFallback('duelDetailSheet.yourSessionBeaten', '@{name} beat your session', { name: opponentName || '' })
                            : tFallback('duelDetailSheet.yourSessionHeld', 'Your session held')))
                    : won
                    ? (walkover
                        ? tFallback('duelDetailSheet.wonWalkover', 'You won. Your rival never trained.')
                        : tFallback('duelDetailSheet.youWon', 'You won'))
                    : tied
                      ? tFallback('duelDetailSheet.tie', 'It is a tie')
                      : walkover
                        ? tFallback('duelDetailSheet.lostWalkover', 'You lost. No workout was submitted in time.')
                        : opponentName
                          ? tFallback('duelDetailSheet.theyWon', '@{name} won', { name: opponentName })
                          : tFallback('duelDetailSheet.rivalWon', 'Your rival won')}
                </span>
              </div>

              {/* Side-by-side scores */}
              <div className="flex gap-2">
                <div className="flex-1 rounded-xl bg-secondary/60 p-3 text-center">
                  <p className="text-micro text-muted-foreground mb-1">{tFallback("friendLeaderboard.you", "You")}</p>
                  <p className="text-xl font-black tabular-nums">{fmtVol(myResult?.volume)}</p>
                  {prescribed > 0 && myResult?.sets_completed != null && (
                    <p className="text-micro text-muted-foreground mt-1">
                      {tFallback('duelDetailSheet.setsOf', '{done} of {total} sets', { done: myResult.sets_completed, total: prescribed })}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-center w-6 shrink-0">
                  <span className="text-xs font-black text-muted-foreground">{tFallback('duelDetailSheet.vs', 'VS')}</span>
                </div>
                <div className="flex-1 rounded-xl bg-secondary/60 p-3 text-center">
                  <p className="text-micro text-muted-foreground mb-1">{opponentName ? `@${opponentName}` : tFallback('duelDetailSheet.rival', 'Rival')}</p>
                  <p className="text-xl font-black tabular-nums">{fmtVol(theirResult?.volume)}</p>
                  {prescribed > 0 && theirResult?.sets_completed != null && (
                    <p className="text-micro text-muted-foreground mt-1">
                      {tFallback('duelDetailSheet.setsOf', '{done} of {total} sets', { done: theirResult.sets_completed, total: prescribed })}
                    </p>
                  )}
                </div>
              </div>

              {/* Volume margin only on an Open duel: a Mirror duel is scored on
                  completion as well, so its winner can have lifted less. */}
              {won && !walkover && duel.type === 'open' && myResult.volume > theirResult.volume && (
                <p className="text-center text-xs font-semibold text-success mt-3">
                  {tFallback('duelDetailSheet.wonBy', 'Won by {amount}', { amount: fmtVolDelta(myResult.volume - theirResult.volume) })}
                </p>
              )}
            </div>
          )}

          {/* Active / Pending — duel status */}
          {duel.status !== 'completed' && (
            <div className="rounded-xl bg-secondary/40 border border-border p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{tFallback("hub.share.status", "Status")}</span>
                <span className={`font-semibold ${duel.status === 'active' ? 'text-primary' : 'text-muted-foreground'}`}>
                  {duelStatusName(duel.status, tFallback)}
                </span>
              </div>
              {['active', 'pending'].includes(duel.status) && msLeft > 60_000 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{tFallback('duelDetailSheet.timeLeft', 'Time left')}</span>
                  <span className="font-semibold tabular-nums">{formatDuration(msLeft, language)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {session && !isChallenger ? tFallback('duelDetailSheet.yourSession', 'Your session') : tFallback('duelDetailSheet.yourBest', 'Your best')}
                </span>
                <span className="font-semibold tabular-nums">{fmtSide(myResult)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {session && isChallenger ? tFallback('duelDetailSheet.theirSession', 'Their session') : theirLabel}
                </span>
                <span className="font-semibold tabular-nums">{fmtSide(theirResult)}</span>
              </div>
              {duel.status === 'active' && lead && (
                <motion.p
                  key={lead}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`pt-1 text-xs font-bold ${lead === 'me' ? 'text-success' : lead === 'them' ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {lead === 'me'
                    ? tFallback('duelDetailSheet.youLead', 'You lead')
                    : lead === 'them'
                      ? (session
                          ? tFallback('duelDetailSheet.notYet', 'Not beaten yet')
                          : tFallback('duelDetailSheet.theyLead', '{name} leads', { name: theirLabel }))
                      : tFallback('duelDetailSheet.even', 'Even so far')}
                </motion.p>
              )}
            </div>
          )}

          {duel.status === 'active' && (
            <p className="text-xs text-muted-foreground">
              {session
                ? (isChallenger
                    ? tFallback('duelDetailSheet.sessionHint', 'Finish every set and lift more in total than their session. Your best workout counts automatically.')
                    : tFallback('duelDetailSheet.sessionOpponentHint', '{name} is trying to beat your last workout. Nothing to do on your side.', { name: theirLabel }))
                : tFallback('duelDetailSheet.autoScore', 'Your best workout before time runs out counts automatically. No need to submit.')}
            </p>
          )}

          {/* The opponent answers here. The invite push says "Tap to accept or
              decline" and lands on this sheet; it had no buttons, so the only
              way to accept was the DM card. */}
          {canRespond && (
            <div className="flex gap-2">
              <motion.button
                type="button"
                whileTap={tap}
                onClick={handleDecline}
                disabled={!!busy}
                className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-secondary active:bg-secondary transition-colors"
              >
                {busy === 'decline' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                {tFallback('duelInviteCard.decline', 'Decline')}
              </motion.button>
              <motion.button
                type="button"
                whileTap={tap}
                onClick={handleAccept}
                disabled={!!busy}
                className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {busy === 'accept' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {tFallback('duelInviteCard.accept', 'Accept')}
              </motion.button>
            </div>
          )}

          {canTrain && (
            <motion.button
              type="button"
              whileTap={tap}
              onClick={handleTrain}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Play className="w-4 h-4" />
              {tFallback('duelDetailSheet.startWorkout', 'Start a workout')}
            </motion.button>
          )}

          {/* Cancel — challenger can withdraw a still-pending challenge */}
          {isChallenger && duel.status === 'pending' && onCancel && (
            <motion.button
              type="button"
              whileTap={tap}
              onClick={() => onCancel(duel.id)}
              className="w-full py-2.5 rounded-xl border border-destructive/30 text-destructive text-sm font-semibold hover:bg-destructive/10 active:bg-destructive/10 transition-colors"
            >
              {tFallback("duelDetailSheet.cancelChallenge", "Cancel challenge")}
            </motion.button>
          )}

          {/* Mirror — session template */}
          {duel.type === 'mirror' && templateExercises(duel.session_template).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{session
                ? tFallback('duelDetailSheet.sessionToBeat', 'Session to beat')
                : tFallback("duelDetailSheet.sessionTemplate", "Session Template")}</p>
              <div className="space-y-1.5">
                {templateExercises(duel.session_template).map((ex, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/40 text-xs">
                    <span className="font-medium">{ex.name}</span>
                    <span className="text-muted-foreground">{tFallback('duelDetailSheet.setCount', '{n} sets', { n: ex.sets })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
