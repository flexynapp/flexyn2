// src/components/duels/DuelInviteCard.jsx
//
// Renders inside HubChat when a DM body starts with [DUEL_INVITE_V1].
// Shows challenger, duel type, and Accept / Decline buttons.
// Mirrors the CrewDMInviteCard pattern exactly.

import React, { useState } from 'react';
import { Swords, Dumbbell, Timer, Trophy, Check, X, Loader2 } from 'lucide-react';
import { acceptDuel, declineDuel } from '@/lib/data/duels';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

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
    description: 'Most total volume wins',
  },
  mirror: {
    label:       'Mirror Duel',
    icon:        Dumbbell,
    color:       'text-violet-500',
    bg:          'bg-violet-500/10',
    description: 'Complete the same session',
  },
  exercise: {
    label:       'Exercise Duel',
    icon:        Trophy,
    color:       'text-amber-500',
    bg:          'bg-amber-500/10',
    description: 'Single exercise showdown',
  },
};

// ── Card ──────────────────────────────────────────────────────────────────────

export default function DuelInviteCard({ payload, isMine }) {
  const qc = useQueryClient();
  const [state, setState] = useState('idle'); // idle | accepting | declining | accepted | declined

  if (!payload) return null;

  const { duelId, challengerUsername, challengerAvatar, type = 'open', windowHours = 24 } = payload;
  const meta   = TYPE_META[type] || TYPE_META.open;
  const Icon   = meta.icon;
  const isDone = state === 'accepted' || state === 'declined';

  const handleAccept = async () => {
    if (isDone) return;
    setState('accepting');
    try {
      await acceptDuel(duelId);
      setState('accepted');
      toast.success('Duel accepted! Game on. 🔥');
      qc.invalidateQueries({ queryKey: ['activeDuel'] });
      qc.invalidateQueries({ queryKey: ['myDuels'] });
    } catch (err) {
      setState('idle');
      toast.error('Could not accept duel', { description: err.message });
    }
  };

  const handleDecline = async () => {
    if (isDone) return;
    setState('declining');
    try {
      await declineDuel(duelId);
      setState('declined');
      toast.info('Duel declined.');
      qc.invalidateQueries({ queryKey: ['activeDuel'] });
      qc.invalidateQueries({ queryKey: ['myDuels'] });
    } catch (err) {
      setState('idle');
      toast.error('Could not decline duel', { description: err.message });
    }
  };

  return (
    <div className="my-1 w-[260px]">
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">

        {/* Rose header band */}
        <div className="px-4 py-2.5 flex items-center gap-2 bg-rose-500">
          <Swords className="w-4 h-4 text-white shrink-0" />
          <span className="text-white text-xs font-bold tracking-wide uppercase">Duel Challenge</span>
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* Challenger */}
          <div className="flex items-center gap-2.5">
            {challengerAvatar ? (
              <img src={challengerAvatar} className="w-9 h-9 rounded-full object-cover shrink-0" alt={challengerUsername} />
            ) : (
              <div className="w-9 h-9 rounded-full bg-rose-500/15 flex items-center justify-center shrink-0">
                <span className="text-sm font-black text-rose-500">
                  {challengerUsername?.[0]?.toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Challenge from</p>
              <p className="text-sm font-bold">@{challengerUsername}</p>
            </div>
          </div>

          {/* Duel type */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${meta.bg}`}>
            <Icon className={`w-4 h-4 shrink-0 ${meta.color}`} />
            <div>
              <p className={`text-xs font-bold ${meta.color}`}>{meta.label}</p>
              <p className="text-[10px] text-muted-foreground">{meta.description}</p>
            </div>
          </div>

          {/* Window */}
          <p className="text-[10px] text-muted-foreground text-center">
            {windowHours}h to complete after accepting
          </p>

          {/* Actions */}
          {isMine ? (
            /* Sender sees a "waiting" state — they can't accept their own challenge */
            <div className="py-2 rounded-xl text-center text-xs font-semibold bg-secondary text-muted-foreground">
              ⏳ Waiting for their response…
            </div>
          ) : isDone ? (
            <div className={`py-2 rounded-xl text-center text-xs font-bold ${
              state === 'accepted'
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-secondary text-muted-foreground'
            }`}>
              {state === 'accepted' ? '✓ Duel Accepted — Go train!' : 'Declined'}
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleDecline}
                disabled={state !== 'idle'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border text-xs font-semibold hover:bg-secondary transition-colors disabled:opacity-50"
              >
                {state === 'declining'
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <X className="w-3 h-3" />
                }
                Decline
              </button>
              <button
                onClick={handleAccept}
                disabled={state !== 'idle'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-rose-500 text-white text-xs font-bold hover:bg-rose-600 transition-colors disabled:opacity-50"
              >
                {state === 'accepting'
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Check className="w-3 h-3" />
                }
                Accept
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
