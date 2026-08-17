// src/components/crews/CrewInviteSheet.jsx
//
// Inviting somebody to a crew that already exists.
//
// Until this shipped, the ONLY way an invite was ever created was the crew
// creation wizard — `buildCrewInviteBody` had exactly one caller. So a crew
// picked its members in the sixty seconds it was founded and could never add
// another by invitation again; anybody who came later had to find the crew in
// the directory and apply, including a friend the leader specifically wanted.
//
// The server was ready the whole time. `invite_to_crew` (migration 250) gates
// on `is_admin = TRUE OR role IN ('leader','moderator')`, checks bans, and
// upserts a 14-day row. Verified against production: a private crew with no
// invite returns status 'requested' from join_crew_atomic, the same crew with
// an invite row returns 'joined', and a plain member calling the RPC is
// refused 42501.
//
// WHY THIS IS NOT THE CREATION WIZARD'S PICKER, reused. The two look alike and
// behave differently in ways that are the point: this one has to exclude the
// people already in the crew, and it has to respect the seats actually left
// against max_capacity rather than a flat 15. A shared component would carry
// both sets of rules and a flag to pick between them, which is more code than
// the list markup it saves.
//
// It deliberately does NOT show who is already invited. `crew_invites` is
// readable under `invited_user_id = auth.uid() OR is_crew_admin(crew_id)`, and
// is_crew_admin reads `is_admin` — which a MODERATOR does not have. So a
// moderator can create invites it cannot list, and a per-row "Invited" badge
// would be accurate for leaders and silently wrong for moderators. Re-inviting
// is harmless: the RPC upserts and refreshes the expiry.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Check, Loader2, UserPlus } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';
import * as crewMembership from '@/lib/data/crewMembership';
import * as hubFollows from '@/lib/data/hubFollows';
import * as hubMessages from '@/lib/data/hubMessages';
import * as users from '@/lib/data/users';
import { buildCrewInviteBody } from '@/lib/crewInviteBody';
import { displayName } from '@/lib/userDisplay';
import { toast } from '@/lib/toast';

export default function CrewInviteSheet({
  open, onClose, crewId, crewName, members = [], maxCapacity = 16,
}) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setQuery('');
  }, [open]);

  const { data: followingIds = [] } = useQuery({
    queryKey: ['followingIds', user?.id],
    queryFn:  () => hubFollows.listFollowingIds(user.id),
    enabled:  open && !!user?.id,
    staleTime: 60_000,
  });

  const { data: allProfiles = [] } = useQuery({
    queryKey: ['allProfiles'],
    queryFn:  () => users.list(),
    enabled:  open,
    staleTime: 120_000,
  });

  const memberIds = useMemo(
    () => new Set((members || []).map(m => m.user_id)),
    [members],
  );

  // Seats, not a flat cap. A crew of 14 with a 16 cap can invite two.
  const seatsLeft = Math.max(0, (maxCapacity ?? 16) - (members?.length ?? 0));

  const candidates = allProfiles
    .filter(p => followingIds.includes(p.id))
    .filter(p => p.id !== user?.id && !memberIds.has(p.id))
    .filter(p => {
      if (!query.trim()) return true;
      return String(p.username || '').toLowerCase().includes(query.trim().toLowerCase());
    });

  const toggle = (profile) => {
    setSelected(prev => {
      if (prev.some(p => p.id === profile.id)) return prev.filter(p => p.id !== profile.id);
      if (prev.length >= seatsLeft) {
        // Worded so it reads correctly at 1 without a plural pair — "You can
        // invite 1 more right now" is fine where "Only 1 seats left" is not.
        toast.warning(tFallback(
          'crewInvite.noSeats',
          'You can invite {n} more right now.',
          { n: seatsLeft },
        ));
        return prev;
      }
      return [...prev, profile];
    });
  };

  const send = async () => {
    if (!selected.length || sending) return;
    setSending(true);
    try {
      const { data: myProfile } = await supabase
        .from('user_profiles')
        .select('username, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      const body = buildCrewInviteBody(
        crewId, crewName, myProfile?.username || 'Someone', myProfile?.avatar_url || null,
      );

      const failures = [];
      await Promise.allSettled(
        selected.map(async (friend) => {
          // Same ordering rule as the creation flow, for the same reason: the
          // row has to exist before the message that announces it, or a
          // friend who taps Accept immediately files a request instead.
          try {
            const inv = await crewMembership.inviteToCrew(crewId, friend.id);
            if (!inv?.ok) failures.push(inv?.reason || 'db_error');
          } catch { failures.push('db_error'); }

          try {
            const conv = await hubMessages.findOrCreateConversation(user.email, friend.id);
            if (conv) {
              await hubMessages.sendMessage({
                conversationId: conv.id,
                senderEmail:    user.email,
                recipientId:    friend.id,
                body,
              });
            }
          } catch { /* non-fatal — the invite still stands */ }
        }),
      );

      const sent = selected.length - failures.length;
      if (sent > 0) {
        toast.success(sent === 1
          ? tFallback('crewInvite.sentOne', 'Invite sent.')
          : tFallback('crewInvite.sent', 'Invites sent to {n} people.', { n: sent }));
      }
      if (failures.length) {
        // 'not_allowed' is the server refusing the rank, which means the UI
        // offered a control the server does not honour. Say that plainly
        // rather than folding it into a generic count.
        toast.error(
          failures.every(f => f === 'not_allowed')
            ? tFallback('crewInvite.notAllowed', 'Only a crew leader or moderator can invite people.')
            : failures.length === 1
              ? tFallback('crewInvite.someFailedOne', 'One invite could not be sent. They can still apply.')
              : tFallback('crewInvite.someFailed',
                  '{n} invites could not be sent. Those friends can still apply.',
                  { n: failures.length }));
      }
      if (sent > 0) onClose?.();
    } finally {
      setSending(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={tFallback('crewInvite.title', 'Invite to crew')}
    >
      <div className="px-4 pb-6 flex flex-col gap-2">
        <p className="text-micro text-muted-foreground">
          {seatsLeft > 0
            ? tFallback('crewInvite.seats', 'Seats left: {n}. An invite lasts 14 days and lets them join without applying.', { n: seatsLeft })
            : tFallback('crewInvite.full', 'This crew is full. Someone has to leave before you can invite anyone.')}
        </p>

        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={tFallback('crewCreationFlow.searchFriends', 'Search friends…')}
            aria-label={tFallback('crewCreationFlow.searchFriends', 'Search friends…')}
            className="w-full bg-secondary rounded-xl ps-9 pe-3 py-2.5 text-label text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="max-h-[45dvh] overflow-y-auto divide-y divide-border/50">
          {candidates.length === 0 ? (
            <p className="py-10 text-center text-label text-muted-foreground">
              {query
                ? tFallback('crewInvite.noMatches', 'No matches.')
                : tFallback('crewInvite.everyoneIn', 'Everyone you follow is already in this crew.')}
            </p>
          ) : candidates.map(p => {
            const isSelected = selected.some(s => s.id === p.id);
            const name = displayName(p);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggle(p)}
                className="w-full flex items-center gap-2 py-2.5 text-start"
              >
                <span className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-micro font-bold text-muted-foreground shrink-0 overflow-hidden">
                  {p.avatar_url
                    ? <img loading="lazy" src={p.avatar_url} alt="" className="w-full h-full object-cover" draggable={false} />
                    : name.slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1 text-label font-semibold truncate">@{name}</span>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  isSelected ? 'border-primary bg-primary' : 'border-border'
                }`}>
                  {isSelected && <Check className="w-3 h-3 text-white" aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={send}
          disabled={!selected.length || sending}
          className="w-full h-11 rounded-2xl bg-primary text-primary-foreground font-heading font-bold text-label flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {sending
            ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            : <UserPlus className="w-4 h-4" aria-hidden="true" />}
          {selected.length === 0
            ? tFallback('crewInvite.pick', 'Pick someone to invite')
            : selected.length === 1
              ? tFallback('crewInvite.sendOne', 'Send invite')
              : tFallback('crewInvite.send', 'Send {n} invites', { n: selected.length })}
        </button>
      </div>
    </BottomSheet>
  );
}
