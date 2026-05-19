// src/components/crews/CrewDMInviteCard.jsx
//
// Rendered inside HubChat when a DM body starts with [CREW_INVITE_V1].
// Parses the JSON payload and shows a styled invite card.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import * as crews from '@/lib/data/crews';

export const CREW_INVITE_PREFIX = '[CREW_INVITE_V1]';

export function parseCrewInvite(body) {
  if (!body?.startsWith(CREW_INVITE_PREFIX)) return null;
  try {
    return JSON.parse(body.slice(CREW_INVITE_PREFIX.length));
  } catch {
    return null;
  }
}

export function buildCrewInviteBody(crewId, crewName, inviterName, inviterAvatar) {
  return CREW_INVITE_PREFIX + JSON.stringify({ crewId, crewName, inviterName, inviterAvatar });
}

export default function CrewDMInviteCard({ payload, userId, isMine }) {
  const [state, setState] = useState('idle'); // idle | joining | joined | full

  if (!payload) return null;
  const { crewId, crewName, inviterName, inviterAvatar } = payload;

  const handleAccept = async () => {
    if (state !== 'idle') return;
    setState('joining');
    try {
      await crews.joinCrew(crewId, userId);
      setState('joined');
      toast.success(`You joined ${crewName}!`);
      // Navigate to Crews tab
      window.dispatchEvent(new CustomEvent('flexyn:open-crew', { detail: { crewId } }));
    } catch (err) {
      setState(err?.message?.includes('full') ? 'full' : 'idle');
      toast.error(err?.message || 'Could not join crew — try again.');
    }
  };

  return (
    <div className="my-1 max-w-[280px]">
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        {/* Orange header band */}
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: 'hsl(var(--primary))' }}>
          <Shield className="w-4 h-4 text-white shrink-0" />
          <span className="text-white text-xs font-bold tracking-wide uppercase">Crew Invite</span>
        </div>

        <div className="px-4 py-3">
          {/* Inviter */}
          <div className="flex items-center gap-2 mb-3">
            {inviterAvatar ? (
              <img src={inviterAvatar} className="w-8 h-8 rounded-full object-cover shrink-0" alt="" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                {(inviterName || '?').slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground leading-tight">invited you to join</p>
              <p className="text-sm font-bold text-foreground truncate">{crewName}</p>
            </div>
          </div>

          {/* Action */}
          {isMine ? (
            <p className="text-xs text-muted-foreground italic">You sent this invite.</p>
          ) : state === 'joined' ? (
            <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'hsl(var(--primary))' }}>
              <Check className="w-4 h-4" />
              Joined!
            </div>
          ) : state === 'full' ? (
            <p className="text-xs text-destructive font-medium">This Crew is full.</p>
          ) : (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleAccept}
              disabled={state === 'joining'}
              className="w-full py-2 rounded-xl text-sm font-bold text-white disabled:opacity-60 flex items-center justify-center gap-1.5"
              style={{ background: 'hsl(var(--primary))' }}
            >
              {state === 'joining' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {state === 'joining' ? 'Joining…' : 'Accept'}
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
