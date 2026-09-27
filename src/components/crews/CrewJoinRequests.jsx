// src/components/crews/CrewJoinRequests.jsx
//
// The pending-approval queue a crew leader sees (migration 250).
//
// Only rendered for leaders, and self-hiding when the queue is empty — a
// permanently visible "0 requests" header is noise on a screen that already
// has a member list under it.
//
// Built to docs/profile-ui-premium-research.md: rows separated by a hairline
// rather than each being a filled, bordered card; no icon above a count; the
// four-size type scale; and exactly one primary control per row, with the
// decline action styled as the quiet one. Approving is the action a leader
// came here to take, so it's the one that gets the weight.

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/LanguageContext';
import { listJoinRequests, decideJoinRequest } from '@/lib/data/crewMembership';

function Avatar({ row }) {
  const label = (row.username || row.full_name || '?').slice(0, 1).toUpperCase();
  if (row.avatar_url) {
    return (
      <img
        src={row.avatar_url}
        alt=""
        className="w-8 h-8 rounded-xl object-cover shrink-0"
        loading="lazy"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-xs font-bold bg-secondary text-muted-foreground">
      {label}
    </div>
  );
}

// `canReview` is moderator-or-leader. It was `isLeader` — rank 3 only — which
// matched the old server gate on the legacy is_admin boolean. Migration 368
// moved both to crew_rank() >= 2; this is the UI half of that change.
export default function CrewJoinRequests({ crewId, canReview }) {
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState(null);

  const { data: requests = [] } = useQuery({
    queryKey: ['crewJoinRequests', crewId],
    queryFn:  () => listJoinRequests(crewId),
    enabled:  !!crewId && !!canReview,
    staleTime: 30_000,
  });

  const decide = useMutation({
    mutationFn: ({ userId, approve }) => decideJoinRequest(crewId, userId, approve),
    onMutate:   ({ userId }) => setBusyId(userId),
    onSettled:  () => setBusyId(null),
    onSuccess: (res, { approve }) => {
      if (!res?.ok) {
        // crew_full is the interesting failure: the seat can go between the
        // request landing and the leader tapping approve, and the server
        // re-checks capacity under a lock rather than trusting this screen.
        const msg = res?.reason === 'crew_full'
          ? tFallback('crew.fullNow', 'Your crew filled up. Free a seat first.')
          : res?.reason === 'not_leader'
            ? tFallback('crew.notLeader', 'Only a crew leader can do that.')
            : tFallback('crew.decideFailed', 'Could not update that request.');
        toast.error(msg);
        return;
      }
      toast.success(approve
        ? tFallback('crew.approved', 'Approved. They\'re in.')
        : tFallback('crew.declined', 'Request declined.'));
      qc.invalidateQueries({ queryKey: ['crewJoinRequests', crewId] });
      if (approve) {
        qc.invalidateQueries({ queryKey: ['crewMembers', crewId] });
      }
    },
    onError: () => toast.error(tFallback('crew.decideFailed', 'Could not update that request.')),
  });

  if (!canReview || requests.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="px-4 pt-3"
      aria-label={tFallback('crew.requestsAria', 'Pending join requests')}
    >
      {/* Section label above the count, per Penpot board C — the queue is a
          named part of the roster screen, not an unlabelled list. */}
      <p className="text-micro font-black uppercase tracking-wider text-primary">
        {tFallback('crew.requestsLabel', 'Requests to join')}
      </p>
      <p className="font-heading font-black text-base mb-1">
        {requests.length === 1
          ? tFallback('crew.oneRequest', '1 person wants to join')
          : `${requests.length} ${tFallback('crew.manyRequests', 'people want to join')}`}
      </p>

      <AnimatePresence initial={false}>
        {requests.map((row) => {
          const busy = busyId === row.user_id;
          let asked = null;
          try {
            if (row.created_at) {
              asked = formatDistanceToNow(new Date(row.created_at), { addSuffix: true });
            }
          } catch { asked = null; }

          return (
            <motion.div
              key={row.user_id}
              layout
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-3 py-2.5 border-b border-border/60 overflow-hidden"
            >
              <Avatar row={row} />

              <div className="flex-1 min-w-0">
                <p className="font-heading font-bold text-sm truncate">
                  {row.username ? `@${row.username}` : (row.full_name || tFallback('crew.someone', 'Someone'))}
                </p>
                {/* Level and when they asked, on one line. A reviewer deciding
                    between strangers has nothing else to go on, and an
                    application with no context is a coin flip. */}
                <p className="text-micro text-muted-foreground truncate">
                  {Number.isFinite(Number(row.current_level))
                    ? tFallback('crew.applicantLevel', 'Lv. {lv}', { lv: String(row.current_level) })
                    : null}
                  {Number.isFinite(Number(row.current_level)) && asked ? '  ·  ' : null}
                  {asked}
                </p>
                {row.message && (
                  <p className="text-micro text-muted-foreground truncate italic">{row.message}</p>
                )}
              </div>

              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  {/* Decline is a hairline, not a red button: on a routine
                      triage action a destructive-looking control reads as
                      punishment. Board C. */}
                  <button
                    onClick={() => decide.mutate({ userId: row.user_id, approve: false })}
                    className="text-micro font-bold text-muted-foreground px-3 py-2 rounded-lg border border-border"
                  >
                    {tFallback('crew.decline', 'Decline')}
                  </button>
                  <button
                    onClick={() => decide.mutate({ userId: row.user_id, approve: true })}
                    className="text-micro font-bold px-3 py-2 rounded-lg text-white"
                    style={{ background: 'hsl(var(--primary))' }}
                  >
                    {tFallback('crew.approve', 'Approve')}
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </motion.section>
  );
}
