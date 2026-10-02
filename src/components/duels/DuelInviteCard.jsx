// src/components/duels/DuelInviteCard.jsx
//
// Renders inside HubChat when a DM body starts with [DUEL_INVITE_V1].
// Shows challenger, duel type, and Accept / Decline buttons.
// Mirrors the CrewDMInviteCard pattern exactly.

import React, { useState } from 'react';
import { Swords, Dumbbell, Timer, Trophy, Check, X, Loader2 } from 'lucide-react';
import { acceptDuel, declineDuel, getDuel, duelErrorMessage } from '@/lib/data/duels';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/LanguageContext';

// ── Protocol helpers (imported by HubChat) ────────────────────────────────────

export const DUEL_INVITE_PREFIX = '[DUEL_INVITE_V1]';

export function parseDuelInvite(body) {
  if (!body?.startsWith(DUEL_INVITE_PREFIX)) return null;
  try {
    return JSON.parse(body.slice(DUEL_INVITE_PREFIX.length));
  } catch {
    return null;
  }
}

// ── Type display config ───────────────────────────────────────────────────────

const TYPE_META = {
  open: {
    label:       'Open Duel',
    icon:        Timer,
    color:       'text-primary',
    bg:          'bg-primary/10',
    description: 'Most weight in one workout wins',
  },
  mirror: {
    label:       'Mirror Duel',
    icon:        Dumbbell,
    color:       'text-primary',
    bg:          'bg-primary/10',
    description: 'Both redo the same workout',
  },
  exercise: {
    label:       'Exercise Duel',
    icon:        Trophy,
    color:       'text-primary',
    bg:          'bg-primary/10',
    description: 'Single exercise showdown',
  },
};

// ── Card ──────────────────────────────────────────────────────────────────────

export default function DuelInviteCard({ payload, isMine }) {
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [state, setState] = useState('idle'); // idle | accepting | declining | accepted | declined

  const duelId = payload?.duelId;
  // The DM is a snapshot from when it was sent. Read the duel itself so a
  // card reopened later shows what happened instead of offering an Accept
  // that fails ("duel_not_pending") on an expired or answered duel.
  const { data: live } = useQuery({
    queryKey: ['duel', duelId],
    queryFn:  () => getDuel(duelId),
    enabled:  !!duelId,
    staleTime: 30_000,
  });

  if (!payload) return null;

  const { challengerUsername, challengerAvatar, type = 'open', windowHours = 24 } = payload;
  const meta   = TYPE_META[type] || TYPE_META.open;
  const Icon   = meta.icon;
  // A pending duel past its deadline is expired even before the sweep marks
  // it. Anything that is not pending is answered: withdrawn by the challenger
  // is stored as declined, so every ended state lands in one of three words.
  const lapsed = live?.status === 'pending' && live.expires_at && new Date(live.expires_at) <= new Date();
  const liveEnded = !live ? null
    : lapsed ? 'expired'
    : live.status === 'active' || live.status === 'completed' ? 'accepted'
    : live.status === 'pending' ? null
    : live.status === 'expired' ? 'expired' : 'declined';
  const shown  = state === 'accepted' || state === 'declined' ? state : (liveEnded || state);
  const isDone = shown === 'accepted' || shown === 'declined' || shown === 'expired';

  const handleAccept = async () => {
    if (isDone) return;
    setState('accepting');
    try {
      await acceptDuel(duelId);
      setState('accepted');
      toast.success(tFallback('duelInviteCard.accepted', 'Duel accepted! Game on. 🔥'));
      qc.invalidateQueries({ queryKey: ['activeDuel'] });
      qc.invalidateQueries({ queryKey: ['myDuels'] });
      qc.invalidateQueries({ queryKey: ['duel', duelId] });
    } catch (err) {
      setState('idle');
      toast.error(tFallback("duelInviteCard.couldNotAcceptDuel", "Could not accept duel"), { description: duelErrorMessage(err, tFallback) });
    }
  };

  const handleDecline = async () => {
    if (isDone) return;
    setState('declining');
    try {
      await declineDuel(duelId);
      setState('declined');
      toast.info(tFallback('duelInviteCard.declined', 'Duel declined.'));
      qc.invalidateQueries({ queryKey: ['activeDuel'] });
      qc.invalidateQueries({ queryKey: ['myDuels'] });
      qc.invalidateQueries({ queryKey: ['duel', duelId] });
    } catch (err) {
      setState('idle');
      toast.error(tFallback("duelInviteCard.couldNotDeclineDuel", "Could not decline duel"), { description: duelErrorMessage(err, tFallback) });
    }
  };

  return (
    <div className="my-1 w-[260px]">
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">

        {/* Header band */}
        <div className="px-4 py-2.5 flex items-center gap-2 bg-primary">
          <Swords className="w-4 h-4 text-primary-foreground shrink-0" />
          <span className="kicker text-primary-foreground">{tFallback("duelInviteCard.duelChallenge", "Duel Challenge")}</span>
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* Challenger */}
          <div className="flex items-center gap-2.5">
            {challengerAvatar ? (
              <img loading="lazy" src={challengerAvatar} className="w-9 h-9 rounded-full object-cover shrink-0" alt={challengerUsername} />
            ) : (
              <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <span className="text-sm font-black text-primary">
                  {challengerUsername?.[0]?.toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">{tFallback("duelInviteCard.challengeFrom", "Challenge from")}</p>
              <p className="text-sm font-bold">@{challengerUsername}</p>
            </div>
          </div>

          {/* Duel type */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${meta.bg}`}>
            <Icon className={`w-4 h-4 shrink-0 ${meta.color}`} />
            <div>
              <p className={`text-xs font-bold ${meta.color}`}>
                {tFallback(`duel.type.${type in TYPE_META ? type : 'open'}.name`, meta.label)}
              </p>
              <p className="text-micro text-muted-foreground">
                {tFallback(`duel.type.${type in TYPE_META ? type : 'open'}.rulesShort`, meta.description)}
              </p>
            </div>
          </div>

          {/* Window */}
          <p className="text-micro text-muted-foreground text-center">
            {tFallback('duelInviteCard.windowAfterAccept', '{n}h to complete after accepting', { n: windowHours })}
          </p>

          {/* Actions */}
          {isDone ? (
            <div className={`py-2 rounded-xl text-center text-xs font-bold ${
              shown === 'accepted'
                ? 'bg-success/10 text-success'
                : 'bg-secondary text-muted-foreground'
            }`}>
              {shown === 'accepted'
                ? tFallback('duelInviteCard.acceptedGoTrain', 'Accepted. Go train.')
                : shown === 'expired'
                  ? tFallback('duels.status.expired', 'Expired')
                  : tFallback('duels.status.declined', 'Declined')}
            </div>
          ) : isMine ? (
            /* Sender sees a "waiting" state — they can't accept their own challenge */
            <div className="py-2 rounded-xl text-center text-xs font-semibold bg-secondary text-muted-foreground">
              {tFallback('duelInviteCard.waiting', 'Waiting for their answer')}
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleDecline}
                disabled={state !== 'idle'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border text-xs font-semibold hover:bg-secondary active:bg-secondary transition-colors disabled:opacity-50"
              >
                {state === 'declining'
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <X className="w-3 h-3" />
                }
                {tFallback('duelInviteCard.decline', 'Decline')}
              </button>
              <button
                onClick={handleAccept}
                disabled={state !== 'idle'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 active:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {state === 'accepting'
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Check className="w-3 h-3" />
                }
                {tFallback('duelInviteCard.accept', 'Accept')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
