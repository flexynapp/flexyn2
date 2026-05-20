// src/components/duels/DuelBanner.jsx
// Persistent banner shown at top of Workout tab when user has a pending/active duel.

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Swords, Clock, ChevronRight, Check, X } from 'lucide-react';
import { acceptDuel, declineDuel } from '@/lib/data/duels';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import DuelDetailSheet from './DuelDetailSheet';

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
  const [showDetail, setShowDetail] = useState(false);
  const [remaining,  setRemaining]  = useState(() => timeRemaining(duel?.expires_at));
  const [acting,     setActing]     = useState(false);

  useEffect(() => {
    if (!duel?.expires_at) return;
    const iv = setInterval(() => setRemaining(timeRemaining(duel.expires_at)), 60_000);
    return () => clearInterval(iv);
  }, [duel?.expires_at]);

  if (!duel) return null;

  const isChallenger = duel.challenger_id === currentUserId;
  const isPending    = duel.status === 'pending';
  const isActive     = duel.status === 'active';

  const opponentName = opponentProfile?.username || 'Opponent';
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
          className="w-full flex items-center justify-between px-3 py-2.5 text-left"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <Swords className="w-3.5 h-3.5 text-primary" />
            </div>
            <div>
              <p className="text-xs font-bold">
                {isPending && !isChallenger
                  ? `@${opponentName} challenged you`
                  : `Active Duel vs. @${opponentName}`}
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
            <span className="text-xs font-bold">{targetVolume.toLocaleString()} lbs</span>
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
