import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import EmptyState from '@/components/EmptyState';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, MessageCircle, Lock, Shield, ChevronRight, Users, MoreHorizontal, Pin, BellOff, LogOut, Archive, ArchiveRestore, Inbox, Mail, UserPlus } from 'lucide-react';
import { format, parseISO, differenceInDays, formatDistanceToNowStrict } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useDelayedLoading } from '@/hooks/useDelayedLoading';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubMessages from '@/lib/data/hubMessages';
import * as users from '@/lib/data/users';
import * as crewsData from '@/lib/data/crews';
import * as hubFollows from '@/lib/data/hubFollows';
import HubChat from './HubChat';
import CrewChat from '@/components/crews/CrewChat';
import ChatViewportFrame from '@/components/ChatViewportFrame';
import { toast } from '@/lib/toast';
import { partitionByArchive, archive as archiveConv, unarchive as unarchiveConv, isArchived } from '@/lib/conversationArchive';
import { partitionConversations } from '@/lib/data/conversationRequests';
import NewGroupDMModal from './NewGroupDMModal';

// Instagram-style relative time: "5m", "2h", "Yesterday", "Mon", "May 1"
function formatInboxTime(dateStr) {
  if (!dateStr) return '';
  const date = parseISO(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const days = differenceInDays(now, date);
  if (days === 0) return formatDistanceToNowStrict(date).replace(' hours', 'h').replace(' hour', 'h').replace(' minutes', 'm').replace(' minute', 'm');
  if (days === 1) return 'Yesterday';
  if (days < 7) return format(date, 'EEE');
  return format(date, 'MMM d');
}

export default function HubMessages({ pendingChatTarget = null, onPendingConsumed = null }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeConv, setActiveConv] = useState(null);
  const [openOtherUser, setOpenOtherUser] = useState(null);
  const [activeCrew, setActiveCrew] = useState(null); // crew object for crew chat
  const [tab, setTab] = useState('dms'); // 'dms' | 'crews'
  // DM-tab sub-view: 'inbox' (accepted + follow), 'requests' (strangers),
  // 'archived' (user-archived). Defaults to inbox.
  const [dmView, setDmView] = useState('inbox');
  const [newGroupOpen, setNewGroupOpen] = useState(false);

  // Desktop three-dot quick-action state.
  //
  // Pin / mute state lives in per-user-namespaced localStorage keys so
  // shared devices (gym demo iPad, family device) don't leak the
  // previous user's lists into the next user's session. Legacy keys
  // (`fn_*`) are migrated below the first time this user signs in on a
  // device that holds them. (Audit 07 + audit 10 #3 #4.)
  const userScope = user?.id || user?.email || 'anon';
  const LS_KEYS = {
    pinnedConvs:  `flexyn.pinnedConvs.${userScope}`,
    mutedConvs:   `flexyn.mutedConvs.${userScope}`,
    pinnedCrews:  `flexyn.pinnedCrews.${userScope}`,
    mutedCrews:   `flexyn.mutedCrews.${userScope}`,
  };
  // One-time migration from the legacy unscoped keys → namespaced keys.
  // After the first sign-in the legacy keys are removed so a different
  // user signing in on the same device doesn't inherit them. Idempotent.
  useEffect(() => {
    if (!user?.id && !user?.email) return;
    try {
      const migrate = (legacy, scoped) => {
        const v = localStorage.getItem(legacy);
        if (v && !localStorage.getItem(scoped)) {
          localStorage.setItem(scoped, v);
        }
        localStorage.removeItem(legacy);
      };
      migrate('fn_pinned_convs', LS_KEYS.pinnedConvs);
      migrate('fn_muted_convs',  LS_KEYS.mutedConvs);
      migrate('fn_pinned_crews', LS_KEYS.pinnedCrews);
      migrate('fn_muted_crews',  LS_KEYS.mutedCrews);
    } catch { /* best-effort */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.email]);

  const [openMenuId, setOpenMenuId] = useState(null); // conv.id or crew.id
  const [pinnedConvIds, setPinnedConvIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEYS.pinnedConvs) || localStorage.getItem('fn_pinned_convs') || '[]')); } catch { return new Set(); }
  });
  const [mutedConvIds, setMutedConvIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEYS.mutedConvs) || localStorage.getItem('fn_muted_convs') || '[]')); } catch { return new Set(); }
  });
  const [pinnedCrewIds, setPinnedCrewIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEYS.pinnedCrews) || localStorage.getItem('fn_pinned_crews') || '[]')); } catch { return new Set(); }
  });
  const [mutedCrewIds, setMutedCrewIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEYS.mutedCrews) || localStorage.getItem('fn_muted_crews') || '[]')); } catch { return new Set(); }
  });
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e) => {
      if (!menuRef.current?.contains(e.target)) setOpenMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuId]);

  const togglePinConv = useCallback((id) => {
    setPinnedConvIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(LS_KEYS.pinnedConvs, JSON.stringify([...next])); } catch {}
      return next;
    });
    setOpenMenuId(null);
  }, [LS_KEYS.pinnedConvs]);

  const toggleMuteConv = useCallback((id) => {
    setMutedConvIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(LS_KEYS.mutedConvs, JSON.stringify([...next])); } catch {}
      return next;
    });
    setOpenMenuId(null);
    toast.success(mutedConvIds.has(id) ? 'Chat unmuted' : 'Chat muted');
  }, [mutedConvIds, LS_KEYS.mutedConvs]);

  const togglePinCrew = useCallback((id) => {
    setPinnedCrewIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(LS_KEYS.pinnedCrews, JSON.stringify([...next])); } catch {}
      return next;
    });
    setOpenMenuId(null);
  }, [LS_KEYS.pinnedCrews]);

  const toggleMuteCrew = useCallback((id) => {
    setMutedCrewIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(LS_KEYS.mutedCrews, JSON.stringify([...next])); } catch {}
      return next;
    });
    setOpenMenuId(null);
    toast.success(mutedCrewIds.has(id) ? 'Crew unmuted' : 'Crew muted');
  }, [mutedCrewIds, LS_KEYS.mutedCrews]);

  const handleLeaveCrew = useCallback(async (crew) => {
    setOpenMenuId(null);
    if (!user?.id) return;
    try {
      await crewsData.removeMember(crew.id, user.id);
      queryClient.invalidateQueries({ queryKey: ['myCrews', user.id] });
      toast.success(`Left ${crew.name}`);
    } catch {
      toast.error('Could not leave crew. Try again.');
    }
  }, [user?.id, queryClient]);

  const { data: conversations = [], isLoading: convsLoading } = useQuery({
    queryKey: ['hubConversations', user?.email],
    queryFn: () => hubMessages.listMyConversations(user.email),
    enabled: !!user?.email,
    refetchInterval: 15000,
  });

  // Follow graph — needed to partition strangers into Message Requests.
  // Stale-time generous; new follows refresh on next mount.
  //
  // listFollowing returns Array<string> (the follow-target emails), NOT
  // an array of row objects. The previous .map(f => f?.followee_email...)
  // pulled .followee_email OFF EACH STRING — always undefined — so
  // followingEmails was permanently []. Every conversation with a
  // followed friend was being mis-partitioned into Requests instead of
  // Inbox. (Audit 10 #1, the highest-impact Hub bug.)
  const { data: followingEmails = [] } = useQuery({
    queryKey: ['myFollowsForDMs', user?.email],
    queryFn: async () => {
      const list = await hubFollows.listFollowing(user.email).catch(() => []);
      // Accept either the canonical string-array shape OR a future
      // row-object shape (defensive). Trim + lowercase for consistent
      // membership checks in partitionConversations.
      return (list || [])
        .map(item => (typeof item === 'string' ? item : (item?.followee_email || item?.followed_email || item?.email)))
        .filter(Boolean)
        .map(e => String(e).trim().toLowerCase());
    },
    enabled: !!user?.email,
    staleTime: 5 * 60_000,
  });

  // Three-way split of conversations:
  //   • archived  → archived view (per-device localStorage)
  //   • requests  → strangers (not followed, not accepted)
  //   • inbox     → everything else (accepted OR followed)
  // The archive partition runs first so an archived conversation stays
  // archived even if it lives in Requests semantically — the user
  // explicitly told us to bury it.
  const { archivedConvs, inboxConvs, requestConvs } = useMemo(() => {
    const { active, archived } = partitionByArchive(conversations);
    const { inbox, requests } = partitionConversations(active, user?.email, followingEmails);
    return { archivedConvs: archived, inboxConvs: inbox, requestConvs: requests };
  }, [conversations, user?.email, followingEmails]);

  // The list rendered in the current dmView. Pinned conversations sort
  // to the top within the inbox view (audit 10 #4 — pin used to be a
  // no-op visually; toast lied about effect). Requests + archived
  // ignore pin state since they're niche views.
  const visibleConvs = useMemo(() => {
    const base =
      dmView === 'requests' ? requestConvs :
      dmView === 'archived' ? archivedConvs :
      inboxConvs;
    if (dmView !== 'inbox' || pinnedConvIds.size === 0) return base;
    // Stable sort: pinned first (preserving inter-pin order), unpinned
    // second (preserving the underlying last-message-time order).
    return [...base].sort((a, b) => {
      const aPin = pinnedConvIds.has(a.id) ? 1 : 0;
      const bPin = pinnedConvIds.has(b.id) ? 1 : 0;
      return bPin - aPin;
    });
  }, [dmView, inboxConvs, requestConvs, archivedConvs, pinnedConvIds]);

  // Auto-select a conversation from a `?conv=<id>` query param. Used by
  // the story-reply "Open" toast action to land the user directly in
  // the new (or existing) thread. Runs once per conversations-list
  // change so it survives the initial async load.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const wantedId = params.get('conv');
    if (!wantedId || activeConv?.id === wantedId) return;
    const target = conversations.find(c => c.id === wantedId);
    if (target) {
      setActiveConv(target);
      // Strip the param so a refresh doesn't re-trigger the select.
      params.delete('conv');
      const next = params.toString();
      const url = window.location.pathname + (next ? `?${next}` : '');
      window.history.replaceState({}, '', url);
    }
  }, [conversations, activeConv?.id]);

  const { data: myCrews = [], isLoading: crewsLoadingRaw } = useQuery({
    queryKey: ['myCrews', user?.id],
    queryFn: () => crewsData.getMyCrews(user.id),
    enabled: !!user?.id && tab === 'crews',
    staleTime: 30_000,
  });

  // Gate the spinners through useDelayedLoading so fast fetches (cache
  // hit, sub-250ms response) don't flash a loading affordance that
  // immediately disappears. Users perceive sub-300ms as "instant" —
  // the flicker actually makes the app feel slower than no spinner.
  const isLoading = useDelayedLoading(convsLoading);
  const crewsLoading = useDelayedLoading(crewsLoadingRaw);

  // Resolve each other-participant's DISPLAY profile (username/avatar) by
  // user_id via participant_ids — not by scanning users.list() and matching
  // on email. participant_ids is backfilled + trigger-maintained (mig 216)
  // and RLS already authorises the id path. The email needed for the SEND
  // path is read from each conversation's own participant_emails column in
  // the render below (not the public_profiles view), so this drops the
  // view's email from the inbox without touching message delivery.
  const otherIds = (conversations || [])
    .map(c => (c.participant_ids || []).find(id => id && id !== user?.id))
    .filter(Boolean);

  const { data: profilesById = {} } = useQuery({
    queryKey: ['hubMessageProfiles', otherIds.slice().sort().join(',')],
    queryFn: async () => {
      if (otherIds.length === 0) return {};
      const { data } = await users.selectProfiles((from) => from
        .select('id, username, avatar_url')
        .in('id', otherIds));
      const map = {};
      for (const u of (data ?? [])) map[u.id] = u;
      return map;
    },
    enabled: otherIds.length > 0,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (pendingChatTarget?.conversation?.id) {
      setActiveConv(pendingChatTarget.conversation);
      setOpenOtherUser(pendingChatTarget.otherUser || null);
      onPendingConsumed && onPendingConsumed();
    }
  }, [pendingChatTarget, onPendingConsumed]);

  // ── Active DM chat ────────────────────────────────────────────────────────────
  if (activeConv) {
    const conv = conversations.find(c => c.id === activeConv.id) || activeConv;
    return (
      <ChatViewportFrame>
        <HubChat
          conversation={conv}
          otherUser={openOtherUser}
          onBack={() => {
            setActiveConv(null);
            setOpenOtherUser(null);
            queryClient.invalidateQueries({ queryKey: ['hubConversations'] });
          }}
        />
      </ChatViewportFrame>
    );
  }

  // ── Active Crew chat ──────────────────────────────────────────────────────────
  if (activeCrew) {
    return (
      <ChatViewportFrame>
        <CrewChat
          crew={activeCrew}
          onBack={() => setActiveCrew(null)}
          onViewProfile={null}
        />
      </ChatViewportFrame>
    );
  }

  return (
    <div>
      {/* Tab toggle */}
      <div className="flex items-center gap-1 mb-4 bg-secondary/30 rounded-xl p-1">
        <button
          onClick={() => setTab('dms')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
            tab === 'dms' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <MessageCircle className="w-4 h-4" />
          {tFallback('hub.messages.tab.dms', 'Messages')}
        </button>
        <button
          onClick={() => setTab('crews')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
            tab === 'crews' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Shield className="w-4 h-4" />
          {tFallback('hub.messages.tab.crews', 'Crews')}
        </button>
      </div>

      {/* ── DMs tab ────────────────────────────────────────────────────────── */}
      {tab === 'dms' && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <Lock className="w-3.5 h-3.5 text-muted-foreground" title={t('hub.messages.privateNote')} />
            <p className="text-xs text-muted-foreground">{t('hub.messages.privateNote')}</p>
          </div>

          {/* Inbox / Requests / Archived view switcher — only renders
              when there's actually content to switch between, so a
              user with zero messages doesn't see clutter. */}
          {(conversations.length > 0) && (
            <div className="flex items-center gap-1 mb-3 text-xs">
              <button
                onClick={() => setDmView('inbox')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold transition-colors ${
                  dmView === 'inbox' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                }`}
              >
                <Inbox className="w-3.5 h-3.5" /> Inbox
                {inboxConvs.length > 0 && <span className="opacity-70">({inboxConvs.length})</span>}
              </button>
              {/* Requests is always visible so message requests are never
                  hidden behind a zero count — muted when empty, amber with a
                  badge when someone is waiting. */}
              <button
                onClick={() => setDmView('requests')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold transition-colors ${
                  dmView === 'requests'
                    ? 'bg-primary text-primary-foreground'
                    : requestConvs.length > 0
                    ? 'text-amber-500 hover:bg-secondary'
                    : 'text-muted-foreground hover:bg-secondary'
                }`}
              >
                <Mail className="w-3.5 h-3.5" /> Requests
                {requestConvs.length > 0 && <span className="opacity-90">({requestConvs.length})</span>}
              </button>
              {archivedConvs.length > 0 && (
                <button
                  onClick={() => setDmView('archived')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold transition-colors ${
                    dmView === 'archived' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  <Archive className="w-3.5 h-3.5" /> Archived
                </button>
              )}
              <button
                onClick={() => setNewGroupOpen(true)}
                className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold text-primary hover:bg-secondary"
                aria-label="Start a new group conversation"
              >
                <UserPlus className="w-3.5 h-3.5" /> New group
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : visibleConvs.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title={dmView === 'requests'
                ? 'No requests'
                : dmView === 'archived'
                ? 'No archived conversations'
                : t('hub.messages.empty.title')}
              body={dmView === 'inbox' ? t('hub.messages.empty.desc') : null}
              action={dmView === 'inbox' ? {
                label: 'Start a group',
                onClick: () => setNewGroupOpen(true),
              } : null}
            />
          ) : (
            <div className="space-y-1">
              {visibleConvs.map((c, i) => {
                const otherId = (c.participant_ids || []).find(id => id && id !== user?.id) || '';
                const otherEmail = (c.participant_emails || []).find(e => e?.toLowerCase() !== user?.email?.toLowerCase()) || '';
                const profile = profilesById[otherId];
                const username = profile?.username || null;
                const handle = username ? `@${username}` : t('hub.profile.anonymousAthlete');
                const initials = (username || '?').slice(0, 2).toUpperCase();
                const lastMsg = c.latestMessage;
                let preview = t('hub.messages.noMessagesYet');
                const lastMsgText = lastMsg?.body || lastMsg?.content;
                if (lastMsgText) {
                  const isMine = lastMsg.sender_email?.toLowerCase() === user?.email?.toLowerCase();
                  // Strip protocol markers from the conversation-list
                  // preview. Without this, a user who just sent or
                  // received a trade offer or a trade response sees the
                  // raw marker in their inbox — e.g.
                  //   "[TRADE_RESPONSE_V1]abc-123:accepted"
                  // — which reads as a SQL-like string instead of a
                  // human-readable message. Opening the conversation
                  // looks fine because HubChat parses the markers and
                  // renders TradeOfferCard / response chips; the inbox
                  // preview just shows raw body, so we mirror that
                  // parse here. Two markers to handle:
                  //   [TRADE_OFFER_V1]{...}\n<friendly fallback>
                  //   [TRADE_RESPONSE_V1]<id>:<accepted|declined>\n<friendly fallback>
                  // For TRADE_RESPONSE we keep the friendly fallback
                  // line (it's already human-readable: "✅ I'd like to
                  // do this trade…"). For TRADE_OFFER we replace with
                  // a short summary because the friendly fallback can
                  // be long and the inbox preview is one line.
                  const isTradeOffer =
                    lastMsg.message_type === 'trade_offer' ||
                    lastMsgText.startsWith('[TRADE_OFFER_V1]');
                  const isTradeResponse = lastMsgText.startsWith('[TRADE_RESPONSE_V1]');
                  const isDuelInvite   = lastMsgText.startsWith('[DUEL_INVITE_V1]');
                  const isCrewInvite   = lastMsgText.startsWith('[CREW_INVITE_V1]');
                  let displayText = lastMsgText;
                  if (isTradeOffer) {
                    displayText = '📦 Trade offer sent.';
                  } else if (isTradeResponse) {
                    // Show only the human-readable line that follows
                    // the marker. Falls back to a generic label if the
                    // marker is malformed.
                    const newlineIdx = lastMsgText.indexOf('\n');
                    displayText = newlineIdx >= 0
                      ? lastMsgText.slice(newlineIdx + 1).trim() || '📦 Replied to trade offer.'
                      : '📦 Replied to trade offer.';
                  } else if (isDuelInvite) {
                    // Parse sender name from JSON payload if available
                    try {
                      const json = JSON.parse(lastMsgText.replace('[DUEL_INVITE_V1]', ''));
                      const senderName = json.senderName || json.sender_name || (isMine ? 'You' : handle);
                      displayText = isMine
                        ? '⚔️ You sent a Duel Challenge.'
                        : `⚔️ Duel Challenge from ${senderName}.`;
                    } catch {
                      displayText = isMine ? '⚔️ You sent a Duel Challenge.' : '⚔️ Duel Challenge received.';
                    }
                  } else if (isCrewInvite) {
                    try {
                      const json = JSON.parse(lastMsgText.replace('[CREW_INVITE_V1]', ''));
                      const crewName = json.crewName || json.crew_name || 'a Crew';
                      displayText = isMine
                        ? `🛡️ You sent an invite to ${crewName}.`
                        : `🛡️ Crew invite: ${crewName}.`;
                    } catch {
                      displayText = isMine ? '🛡️ You sent a Crew invite.' : '🛡️ Crew invite received.';
                    }
                  }
                  // For duel/crew invites the friendly text already includes
                  // direction context, so skip the "You:" prefix.
                  const skipYouPrefix = isDuelInvite || isCrewInvite;
                  preview = (isMine && !skipYouPrefix) ? `You: ${displayText}` : displayText;
                }
                const isMuted = mutedConvIds.has(c.id);
                const isPinned = pinnedConvIds.has(c.id);
                // Muted conversations DON'T count toward the unread dot.
                // Previously, muting was a no-op visually + the unread
                // pip kept appearing on muted threads. (Audit 10 #3.)
                const unread = !isMuted && (c.unreadCount || 0) > 0;
                const timeStr = formatInboxTime(lastMsg?.created_date || lastMsg?.created_at || c.last_message_at);

                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className={`relative group ${isMuted ? 'opacity-60' : ''}`}
                  >
                    <button
                      onClick={() => {
                        setActiveConv(c);
                        setOpenOtherUser(profile ? { ...profile, email: otherEmail } : { id: otherId, email: otherEmail, username });
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-secondary/40 active:bg-secondary/60 transition-colors text-start"
                    >
                      <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-heading font-bold text-primary text-base overflow-hidden">
                        {profile?.avatar_url ? (
                          <img loading="lazy" src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`font-heading text-sm truncate flex items-center gap-1.5 ${unread ? 'font-bold text-foreground' : 'font-semibold text-foreground'}`}>
                            {isPinned && <Pin className="w-3 h-3 text-primary shrink-0" aria-label="Pinned" />}
                            <span className="truncate">{handle}</span>
                            {isMuted && <BellOff className="w-3 h-3 text-muted-foreground shrink-0" aria-label="Muted" />}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className={`text-sm truncate ${unread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                            {preview}
                            {timeStr && <span className="text-muted-foreground font-normal"> · {timeStr}</span>}
                          </p>
                          {unread && <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                        </div>
                      </div>
                    </button>
                    {/* Desktop three-dot menu — lg only */}
                    <div className="hidden lg:flex absolute end-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === c.id ? null : c.id); }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      <AnimatePresence>
                        {openMenuId === c.id && (
                          <motion.div
                            ref={menuRef}
                            key="dm-menu"
                            initial={{ opacity: 0, scale: 0.95, y: -4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -4 }}
                            transition={{ duration: 0.12 }}
                            className="absolute end-0 top-10 w-44 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden"
                          >
                            <button
                              onClick={(e) => { e.stopPropagation(); togglePinConv(c.id); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-secondary/60 transition-colors text-start"
                            >
                              <Pin className="w-4 h-4 text-muted-foreground" />
                              {pinnedConvIds.has(c.id)
                                ? (tFallback('hub.messages.unpinChat', 'Unpin Chat'))
                                : (tFallback('hub.messages.pinChat', 'Pin Chat'))}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleMuteConv(c.id); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-secondary/60 transition-colors text-start"
                            >
                              <BellOff className="w-4 h-4 text-muted-foreground" />
                              {mutedConvIds.has(c.id)
                                ? (tFallback('hub.messages.unmuteChat', 'Unmute Chat'))
                                : (tFallback('hub.messages.muteChat', 'Mute Chat'))}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isArchived(c.id)) {
                                  unarchiveConv(c.id);
                                  toast.success('Conversation unarchived.');
                                } else {
                                  archiveConv(c.id);
                                  toast.success('Conversation archived.');
                                }
                                setOpenMenuId(null);
                                queryClient.invalidateQueries({ queryKey: ['hubConversations', user?.email] });
                              }}
                              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-secondary/60 transition-colors text-start"
                            >
                              {isArchived(c.id)
                                ? <><ArchiveRestore className="w-4 h-4 text-muted-foreground" /> Unarchive</>
                                : <><Archive className="w-4 h-4 text-muted-foreground" /> Archive</>}
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* New group modal — anchored to the DMs tab so closing it
              doesn't yank focus out of the conversations rail. */}
          <NewGroupDMModal
            open={newGroupOpen}
            onClose={() => setNewGroupOpen(false)}
            onCreated={(convId) => {
              queryClient.invalidateQueries({ queryKey: ['hubConversations', user?.email] });
              // Open the new thread immediately. Brief delay lets the
              // refetch land so activeConv has the latest row shape.
              setTimeout(() => {
                const target = conversations.find(c => c.id === convId);
                if (target) setActiveConv(target);
              }, 250);
            }}
          />
        </>
      )}

      {/* ── Crews tab ──────────────────────────────────────────────────────── */}
      {tab === 'crews' && (
        <>
          {crewsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : myCrews.length === 0 ? (
            <EmptyState
              icon={Shield}
              title={tFallback('hub.messages.noCrews.title', 'No Crews yet')}
              body={tFallback('hub.messages.noCrews.desc', 'Join or create a Crew from the Hub tab.')}
            />
          ) : (
            <div className="space-y-2">
              {myCrews.map((crew, i) => (
                <motion.div
                  key={crew.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="relative group"
                >
                  <button
                    onClick={() => setActiveCrew(crew)}
                    className="w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-border text-start hover:bg-secondary/30 active:bg-secondary/50 transition-colors"
                  >
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'hsl(var(--primary) / 0.12)' }}
                    >
                      <Shield className="w-5 h-5" style={{ color: 'hsl(var(--primary))' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold text-sm text-foreground truncate">{crew.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Users className="w-3 h-3" />
                        {crew.max_capacity ? `up to ${crew.max_capacity} members` : 'Group Chat'}
                        {crew.is_admin && (
                          <span
                            className="ms-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide"
                            style={{ background: 'hsl(var(--primary) / 0.15)', color: 'hsl(var(--primary))' }}
                          >
                            Admin
                          </span>
                        )}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                  {/* Desktop three-dot menu — lg only */}
                  <div className="hidden lg:flex absolute end-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === crew.id ? null : crew.id); }}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    <AnimatePresence>
                      {openMenuId === crew.id && (
                        <motion.div
                          ref={menuRef}
                          key="crew-menu"
                          initial={{ opacity: 0, scale: 0.95, y: -4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -4 }}
                          transition={{ duration: 0.12 }}
                          className="absolute end-0 top-10 w-44 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden"
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); togglePinCrew(crew.id); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-secondary/60 transition-colors text-start"
                          >
                            <Pin className="w-4 h-4 text-muted-foreground" />
                            {pinnedCrewIds.has(crew.id) ? 'Unpin Chat' : 'Pin Chat'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleMuteCrew(crew.id); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-secondary/60 transition-colors text-start"
                          >
                            <BellOff className="w-4 h-4 text-muted-foreground" />
                            {mutedCrewIds.has(crew.id) ? 'Unmute Crew' : 'Mute Crew'}
                          </button>
                          <div className="border-t border-border/50 mx-2" />
                          <button
                            onClick={(e) => { e.stopPropagation(); handleLeaveCrew(crew); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-red-500/10 text-red-500 transition-colors text-start"
                          >
                            <LogOut className="w-4 h-4" />
                            Leave Chat
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
