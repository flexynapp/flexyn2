// src/components/duels/DuelBanner.jsx
// Persistent banner shown at top of Workout tab when user has a pending/active duel.

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Swords, Clock, ChevronRight, Check, X } from 'lucide-react';
import { acceptDuel, declineDuel } from '@/lib/data/duels';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import DuelDetailSheet from './DuelDetailSheet';
import { useNumberFormatter } from '@/lib/intl';

function timeRemaining(expiresAt) {
  const diff = new Date(expiresAt) - new Date();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 1) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}

export default function DuelBanner({ duel, currentUserId, opponentProfile }) {
  const qc = useQueryClient();
  const fmt = useNumberFormatter();
  const [showDetail, setShowDetail] = useState(false);
  const [remaining,  setRemaining]  = useState(() => timeRemaining(duel?.expires_at));
  const [acting,     setActing]     = useState(false);

  useEffect(() => {
    if (!duel?.expires_at) return;
    // Dynamic tick rate — coarse 60s ticks while there's plenty of
    // time left, but 5s ticks in the last 5 minutes so a user finishing
    // a duel at T-30s doesn't see "1m remaining" frozen until the
    // banner suddenly vanishes at the next minute boundary.
    // (Audit 15 #M19.)
    let iv = null;
    const tick = () => {
      const next = timeRemaining(duel.expires_at);
      setRemaining(next);
      const msLeft = new Date(duel.expires_at).getTime() - Date.now();
      const desiredMs = msLeft < 5 * 60_000 ? 5_000 : 60_000;
      // Reschedule if we crossed the threshold so the cadence speeds up.
      if (!iv || iv.delay !== desiredMs) {
        if (iv?.id) clearInterval(iv.id);
        const id = setInterval(tick, desiredMs);
        iv = { id, delay: desiredMs };
      }
    };
    tick();
    return () => { if (iv?.id) clearInterval(iv.id); };
  }, [duel?.expires_at]);

  if (!duel) return null;

  // Defensive belt — even though getActiveDuel filters by expires_at,
  // a stale React Query cache or a clock skew could still hand us an
  // expired row. Hide the banner so the user never sees "Active Duel ·
  // Expired" again (which was the bug captured in the 2026-05-25
  // overnight audit screenshot).
  if (duel.expires_at && new Date(duel.expires_at) <= new Date()) return null;

  const isChallenger = duel.challenger_id === currentUserId;
  const isPending    = duel.status === 'pending';
  const isActive     = duel.status === 'active';

  // Use the username when we have it, fall back to a friendly generic
  // when the profile hasn't loaded yet. The previous "Opponent" fallback
  // rendered as the literal string "@Opponent" in the UI — ugly +
  // confusing.
  const hasOpponentName = !!opponentProfile?.username;
  const opponentName    = opponentProfile?.username || null;
  const challengerAlreadyDone = !!duel.challenger_result;
  const targetVolume = isChallenger ? duel.opponent_result?.volume : duel.challenger_result?.volume;

  const handleAccept = async () => {
    setActing(true);
    try {
      await acceptDuel(duel.id);
      toast.success('Duel accepted! Game on.');
      qc.invalidateQueries({ queryKey: ['activeDuel'] });
    } catch {
      toast.error('Failed to accept duel');
    } finally {
      setActing(false);
    }
  };

  const handleDecline = async () => {
    setActing(true);
    try {
      await declineDuel(duel.id);
      toast.info('Duel declined.');
      qc.invalidateQueries({ queryKey: ['activeDuel'] });
    } catch {
      toast.error('Failed to decline duel');
    } finally {
      setActing(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-primary/30 bg-primary/5 overflow-hidden mb-3"
      >
        {/* Top row */}
        <button
          onClick={() => setShowDetail(true)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-start"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <Swords className="w-3.5 h-3.5 text-primary" />
            </div>
            <div>
              <p className="text-xs font-bold">
                {isPending && !isChallenger
                  ? (hasOpponentName ? `@${opponentName} challenged you` : 'You were challenged to a duel')
                  : (hasOpponentName ? `Active Duel vs. @${opponentName}` : 'Active Duel')}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">{remaining}</span>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[10px] text-muted-foreground capitalize">{duel.type} duel</span>
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>

        {/* Target line — shown when opponent already finished */}
        {isActive && targetVolume > 0 && (
          <div className="px-3 pb-2.5 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">Target:</span>
            <span className="text-xs font-bold">{fmt(targetVolume)} lbs</span>
            <span className="text-[10px] text-muted-foreground">total volume to beat</span>
          </div>
        )}

        {/* Accept / Decline — only for opponent on pending duels */}
        {isPending && !isChallenger && (
          <div className="flex gap-2 px-3 pb-3">
            <button
              onClick={handleDecline}
              disabled={acting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs font-semibold hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <X className="w-3 h-3" /> Decline
            </button>
            <button
              onClick={handleAccept}
              disabled={acting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Check className="w-3 h-3" /> Accept
            </button>
          </div>
        )}
      </motion.div>

      {showDetail && (
        <DuelDetailSheet
          duel={duel}
          currentUserId={currentUserId}
          opponentProfile={opponentProfile}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  );
}
