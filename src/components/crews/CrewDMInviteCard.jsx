// src/components/crews/CrewDMInviteCard.jsx
//
// Rendered inside HubChat when a DM body starts with [CREW_INVITE_V1].
// Parses the JSON payload and shows a styled invite card.

import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Shield, Loader2, Check } from 'lucide-react';
import { toast } from '@/lib/toast';
import * as crews from '@/lib/data/crews';
import { useLanguage } from '@/lib/LanguageContext';

// The wire format moved to src/lib/crewInviteBody.js. Re-exported here so
// HubChat — which needs this component AND the parser — keeps one import,
// while the two SENDERS import the pure module instead and no longer drag
// framer-motion, this card and `@/lib/data/crews` (hence `@/api/db` and its
// module-scope auth listener) into a call that builds a string.
export { CREW_INVITE_PREFIX, parseCrewInvite, buildCrewInviteBody } from '@/lib/crewInviteBody';

export default function CrewDMInviteCard({ payload, userId, isMine }) {
  const { tFallback } = useLanguage();
  const [state, setState] = useState('idle'); // idle | joining | joined | requested | full
  // Synchronous double-tap guard. The state-only `if (state !== 'idle')`
  // gate is async — fast double-tap fires joinCrew twice. The RPC is
  // idempotent (returns already_member) so it's not destructive, but
  // it's still a wasted RPC + the second tap shows a misleading toast.
  // Wave 57 (Crews audit) caught this.
  const joiningRef = useRef(false);

  if (!payload) return null;
  const { crewId, crewName, inviterName, inviterAvatar } = payload;

  const handleAccept = async () => {
    if (state !== 'idle' || joiningRef.current) return;
    joiningRef.current = true;
    setState('joining');
    try {
      const res = await crews.joinCrew(crewId, userId);

      // join_crew_atomic does NOT always join you. A crew that is not public
      // and has no live crew_invites row files a REQUEST instead and returns
      // status 'requested' (or 'pending' if one was already open) with no
      // error. Claiming "you joined" and then showing an empty Crews tab is
      // the worst of both, so both branches are handled.
      //
      // This USED TO BE the branch every DM invite took, because nothing
      // called invite_to_crew and crew_invites had never held a row.
      // CrewCreationFlow now writes the invite before sending this card, so
      // an invited friend takes the 'joined' branch. The request branch is
      // still reachable and still correct: the invite expires after 14 days,
      // the founder's invite call can fail while the DM still arrives, and
      // this card can be forwarded to somebody who was never invited — which
      // is the case migration 250 made the ROW, not the message body, the
      // thing that grants entry.
      if (res?.status === 'requested' || res?.status === 'pending') {
        setState('requested');
        toast.success(tFallback('crewDMInviteCard.requestSent', 'Request sent'), {
          description: tFallback('crewDMInviteCard.requestBody',
            'A crew leader or moderator will review it.'),
        });
        return;
      }

      setState('joined');
      toast.success(tFallback('notice.joinedCrew', 'You joined {name}!', { name: crewName }));
      // Navigate to Crews tab
      window.dispatchEvent(new CustomEvent('flexyn:open-crew', { detail: { crewId } }));
    } catch (err) {
      setState(err?.message?.includes('full') ? 'full' : 'idle');
      toast.error(err?.message || tFallback('crewInvite.joinFailed', 'Could not join crew. Try again.'));
    } finally {
      joiningRef.current = false;
    }
  };

  return (
    <div className="my-1 max-w-[280px]">
      <div className="rounded-2xl bg-card overflow-hidden shadow-sm">
        {/* Orange header band */}
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: 'hsl(var(--primary))' }}>
          <Shield className="w-4 h-4 text-white shrink-0" />
          <span className="text-white text-xs font-bold">{tFallback("crewDMInviteCard.crewInvite", "Crew Invite")}</span>
        </div>

        <div className="px-4 py-3">
          {/* Inviter */}
          <div className="flex items-center gap-2 mb-3">
            {inviterAvatar ? (
              <img loading="lazy" src={inviterAvatar} className="w-8 h-8 rounded-full object-cover shrink-0" alt="" />
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
            <p className="text-xs text-muted-foreground italic">{tFallback('crewInvite.youSent', 'You sent this invite.')}</p>
          ) : state === 'requested' ? (
            <div className="w-full py-2 text-center text-xs font-bold text-muted-foreground">
              {tFallback('crewDMInviteCard.requestPending', 'Request sent, awaiting review')}
            </div>
          ) : state === 'joined' ? (
            <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'hsl(var(--primary))' }}>
              <Check className="w-4 h-4" />
              {tFallback("crewDMInviteCard.joined", "Joined!")}
            </div>
          ) : state === 'full' ? (
            <p className="text-xs text-destructive font-medium">{tFallback('crewInvite.crewFull', 'This Crew is full.')}</p>
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
