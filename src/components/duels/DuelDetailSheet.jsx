// src/components/duels/DuelDetailSheet.jsx
// Bottom sheet showing duel details, session template (mirror), and result card when complete.

import React from 'react';
import { motion } from 'framer-motion';
import { X, Swords, Dumbbell, Timer, Trophy, Crown } from 'lucide-react';
import { useNumberFormatter } from '@/lib/intl';

const TYPE_ICON  = { mirror: Dumbbell, open: Timer, exercise: Trophy };
const TYPE_LABEL = { mirror: 'Mirror Duel', open: 'Open Duel', exercise: 'Exercise Duel' };

function StatPill({ label, value, highlight }) {
  return (
    <div className={`flex-1 rounded-xl p-3 text-center ${highlight ? 'bg-primary/10 border border-primary/30' : 'bg-secondary/50'}`}>
      <p className={`text-lg font-black tabular-nums ${highlight ? 'text-primary' : ''}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

export default function DuelDetailSheet({ duel, currentUserId, opponentProfile, onCancel, onClose }) {
  const fmt = useNumberFormatter();
  if (!duel) return null;

  const Icon         = TYPE_ICON[duel.type] || Swords;
  const isChallenger = duel.challenger_id === currentUserId;
  const myResult     = isChallenger ? duel.challenger_result : duel.opponent_result;
  const theirResult  = isChallenger ? duel.opponent_result   : duel.challenger_result;
  const won          = duel.winner_id === currentUserId;
  const lost         = duel.winner_id && duel.winner_id !== currentUserId;
  const tied         = duel.status === 'completed' && !duel.winner_id;
  const opponentName = opponentProfile?.username || 'Opponent';

  const fmtVol = (v) => v != null ? `${fmt(Number(v))} lbs` : '—';

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        className="relative w-full max-w-md bg-background border border-border rounded-t-2xl shadow-2xl overflow-hidden max-h-[85vh] overflow-y-auto"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.3 }}
        onDragEnd={(_e, info) => {
          if (info.velocity.y >= 300 || info.offset.y >= 80) onClose?.();
        }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-primary" />
            <span className="font-bold">{TYPE_LABEL[duel.type]}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-secondary">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 pb-6 space-y-5">
          {/* Completed — Result Card */}
          {duel.status === 'completed' && (
            <div className={`rounded-2xl border-2 p-4 ${won ? 'border-primary bg-primary/5' : lost ? 'border-border' : 'border-amber-500/30 bg-amber-500/5'}`}>
              <div className="flex items-center gap-2 mb-4">
                <Crown className={`w-5 h-5 ${won ? 'text-primary' : tied ? 'text-amber-500' : 'text-muted-foreground'}`} />
                <span className="font-black text-base">
                  {won ? 'You Won!' : tied ? "It's a Tie" : `@${opponentName} Won`}
                </span>
              </div>

              {/* Side-by-side scores */}
              <div className="flex gap-2">
                <div className="flex-1 rounded-xl bg-secondary/60 p-3 text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">You</p>
                  <p className="text-xl font-black tabular-nums">{fmtVol(myResult?.volume)}</p>
                  {myResult?.sets_completed != null && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {myResult.sets_completed}/{myResult.sets_prescribed} sets
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-center w-6 shrink-0">
                  <span className="text-xs font-black text-muted-foreground">VS</span>
                </div>
                <div className="flex-1 rounded-xl bg-secondary/60 p-3 text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">@{opponentName}</p>
                  <p className="text-xl font-black tabular-nums">{fmtVol(theirResult?.volume)}</p>
                  {theirResult?.sets_completed != null && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {theirResult.sets_completed}/{theirResult.sets_prescribed} sets
                    </p>
                  )}
                </div>
              </div>

              {won && myResult?.volume && theirResult?.volume && (
                <p className="text-center text-xs font-semibold text-primary mt-3">
                  Won by {fmt(myResult.volume - theirResult.volume)} lbs
                </p>
              )}

              {/* Share line */}
              {won && (
                <p className="text-center text-[10px] text-muted-foreground mt-2 italic">
                  "I beat @{opponentName} by {fmt((myResult?.volume || 0) - (theirResult?.volume || 0))} lbs. Flexyn."
                </p>
              )}
            </div>
          )}

          {/* Active / Pending — duel status */}
          {duel.status !== 'completed' && (
            <div className="rounded-xl bg-secondary/40 border border-border p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Status</span>
                <span className={`font-semibold capitalize ${duel.status === 'active' ? 'text-primary' : 'text-amber-500'}`}>
                  {duel.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Your result</span>
                <span className="font-semibold">{myResult ? fmtVol(myResult.volume) : 'Not submitted'}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">@{opponentName}</span>
                <span className="font-semibold">{theirResult ? fmtVol(theirResult.volume) : 'Waiting…'}</span>
              </div>
            </div>
          )}

          {/* Cancel — challenger can withdraw a still-pending challenge */}
          {isChallenger && duel.status === 'pending' && onCancel && (
            <button
              type="button"
              onClick={() => onCancel(duel.id)}
              className="w-full py-2.5 rounded-xl border border-rose-500/30 text-rose-500 text-sm font-semibold hover:bg-rose-500/10 transition-colors"
            >
              Cancel challenge
            </button>
          )}

          {/* Mirror — session template */}
          {duel.type === 'mirror' && duel.session_template?.exercises?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Session Template</p>
              <div className="space-y-1.5">
                {duel.session_template.exercises.map((ex, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/40 text-xs">
                    <span className="font-medium">{ex.name}</span>
                    <span className="text-muted-foreground">{ex.sets?.length || 0} sets</span>
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
