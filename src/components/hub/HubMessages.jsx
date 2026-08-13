import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import EmptyState from '@/components/EmptyState';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Loader2, MessageCircle, Lock, Shield, ChevronRight, Users, MoreHorizontal, Pin, BellOff, LogOut, Archive, ArchiveRestore, Inbox, Mail, UserPlus, Check, CheckCheck, Eye, Trash2, Ban, Undo2, Search, X } from 'lucide-react';
import { useLongPress } from '@/hooks/useLongPress';
import { triggerHaptic } from '@/lib/haptic';
import OneShotTooltip from '@/components/OneShotTooltip';
import { TOOLTIP } from '@/lib/tooltipRegistry';
import RowActionSheet from './RowActionSheet';
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
import {
  partitionConversations,
  acceptConversation,
  purgeMessageRequest,
  unsendMessageRequest,
  isOutgoingPendingRequest,
} from '@/lib/data/conversationRequests';
import { deriveDeliveryStatus } from '@/lib/dmDeliveryStatus';
import { useReadReceiptsEnabled } from '@/hooks/useReadReceiptsEnabled';
import { blockUserFull } from '@/lib/data/userBlocks';
import NewGroupDMModal from './NewGroupDMModal';
import { filterConversationsByQuery } from '@/lib/dmSearch';
import { reportError } from '@/lib/reportError';

// A row that opens on tap and offers its quick actions on hold.
//
// This is a component rather than a hook call inside the list's .map()
// because useLongPress is a hook and there is one press timer per row.
// It wraps the row's existing <button> without touching its contents, so
// the row markup below is unchanged.
//
// `consumeClick` is the load-bearing part: a long-press is followed by a
// synthesized click, and without swallowing it the row would open the
// conversation behind the sheet that just opened.
function LongPressRow({ onTap, onLongPress, innerRef, className, children }) {
  const longPress = useLongPress(() => {
    if (!onLongPress) return;
    triggerHaptic('primary');
    onLongPress();
  }, { ms: 400 });
  return (
    <button
      ref={innerRef}
      onClick={(e) => { if (longPress.consumeClick(e)) onTap?.(e); }}
      {...(onLongPress ? longPress.bind : {})}
      className={className}
    >
      {children}
    </button>
  );
}

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
  // Reciprocity (mig 238): with receipts off, the viewer stops seeing
  // other people's read state too. Declared here, above every use.
  const readReceiptsEnabled = useReadReceiptsEnabled();
  const [activeConv, setActiveConv] = useState(null);
  const [openOtherUser, setOpenOtherUser] = useState(null);
  const [activeCrew, setActiveCrew] = useState(null); // crew object for crew chat
  const [tab, setTab] = useState('dms'); // 'dms' | 'crews'
  // DM-tab sub-view: 'inbox' (accepted + follow), 'requests' (strangers),
  // 'archived' (user-archived). Defaults to inbox.
  const [dmView, setDmView] = useState('inbox');
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  // Conversation-list search. Collapsed by default — the view switcher
  // row is already busy, and a permanently-open field would cost vertical
  // space on every visit to buy something used occasionally.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);
  // Bumped whenever archive state changes. Archive lives in localStorage,
  // which no React state observes, so this is what tells the partition
  // memo to re-run. See the memo below for why nothing else does.
  const [archiveVersion, setArchiveVersion] = useState(0);

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

  // The row whose quick actions are open: { kind: 'dm' | 'crew', row }.
  //
  // It holds the ROW OBJECT, not an id or an index. `hubConversations`
  // refetches every 15s and pinning reorders the list, so an index would
  // point at a different thread by the time someone taps Archive.
  const [sheetTarget, setSheetTarget] = useState(null);
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
  // The row the sheet was opened from, so focus goes back where it came
  // from on close rather than to the top of the document.
  const sheetOriginRef = useRef(null);
  // Anchor for the one-shot hint that teaches the gesture.
  const firstRowRef = useRef(null);

  const openSheet = useCallback((kind, row, originEl) => {
    sheetOriginRef.current = originEl || null;
    setSheetTarget({ kind, row });
  }, []);

  const togglePinConv = useCallback((id) => {
    setPinnedConvIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(LS_KEYS.pinnedConvs, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [LS_KEYS.pinnedConvs]);

  const toggleMuteConv = useCallback((id) => {
    setMutedConvIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(LS_KEYS.mutedConvs, JSON.stringify([...next])); } catch {}
      return next;
    });
    toast.success(mutedConvIds.has(id)
      ? tFallback('hub.messages.unmuted', 'Chat unmuted')
      : tFallback('hub.messages.muted', 'Chat muted'));
  }, [mutedConvIds, LS_KEYS.mutedConvs, tFallback]);

  const togglePinCrew = useCallback((id) => {
    setPinnedCrewIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(LS_KEYS.pinnedCrews, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [LS_KEYS.pinnedCrews]);

  const toggleMuteCrew = useCallback((id) => {
    setMutedCrewIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(LS_KEYS.mutedCrews, JSON.stringify([...next])); } catch {}
      return next;
    });
    toast.success(mutedCrewIds.has(id)
      ? tFallback('hub.messages.unmuted', 'Chat unmuted')
      : tFallback('hub.messages.muted', 'Chat muted'));
  }, [mutedCrewIds, LS_KEYS.mutedCrews, tFallback]);

  const handleLeaveCrew = useCallback(async (crew) => {
    if (!user?.id) return;
    try {
      await crewsData.removeMember(crew.id, user.id);
      queryClient.invalidateQueries({ queryKey: ['myCrews', user.id] });
      toast.success(`Left ${crew.name}`);
    } catch {
      toast.error(tFallback('hub.messages.leaveCrewError', 'Could not leave crew. Try again.'));
    }
  }, [user?.id, queryClient, tFallback]);

  // Archive lives in localStorage, which no React state observes — bumping
  // archiveVersion is what re-runs the partition memo. The invalidate alone
  // never moved the row (React Query's structural sharing hands back the
  // same array when nothing on the server changed, and archiving touches no
  // server row), which is why only Archive was ever reported broken.
  const toggleArchiveConv = useCallback((convId) => {
    if (isArchived(convId, user?.id)) {
      unarchiveConv(convId, user?.id);
      toast.success(tFallback('hub.messages.unarchived', 'Conversation unarchived.'));
    } else {
      archiveConv(convId, user?.id);
      toast.success(tFallback('hub.messages.archived', 'Conversation archived.'));
    }
    setArchiveVersion(v => v + 1);
    queryClient.invalidateQueries({ queryKey: ['hubConversations', user?.email] });
  }, [user?.id, user?.email, queryClient, tFallback]);

  const { data: conversations = [], isLoading: convsLoading } = useQuery({
    queryKey: ['hubConversations', user?.email],
    queryFn: () => hubMessages.listMyConversations(user.email),
    enabled: !!user?.email,
    refetchInterval: 15000,
  });

  // ── Message-request actions (Accept / Delete / Block) ──────────────────────
  // Accept appends the viewer's email to accepted_emails (mig 113's
  // accept_conversation RPC), which is all it takes to move the thread
  // to the Inbox — the partition is computed from that column, so there
  // is no row to migrate. Delete is a real destructive purge (mig 234):
  // the conversation row and every message under it are deleted for both
  // participants. Block runs the existing full-block RPC first, then
  // purges so the thread goes with it.
  const [requestBusyId, setRequestBusyId] = useState(null);

  // Two-tap confirm on Delete. The purge is irreversible AND takes the
  // sender's copy with it, so the first tap only ARMS the row — the
  // button row swaps into a confirm/cancel pair, mirroring
  // EditWorkoutModal's confirmDelete state. Only one row can be armed at
  // a time (arming another replaces it), and it disarms on outside tap,
  // scroll, window blur, or a 5s timeout.
  const [armedDeleteId, setArmedDeleteId] = useState(null);
  const armTimerRef = useRef(null);
  const confirmRef = useRef(null);

  const disarmDelete = useCallback(() => {
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    setArmedDeleteId(null);
  }, []);

  const armDelete = useCallback((convId) => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    setArmedDeleteId(convId);
    armTimerRef.current = setTimeout(() => setArmedDeleteId(null), 5000);
  }, []);

  useEffect(() => {
    if (!armedDeleteId) return;
    // Same outside-tap shape as the three-dot menu handler above: taps
    // INSIDE the confirm cluster must not disarm it before the click
    // resolves.
    const outside = (e) => {
      if (!confirmRef.current?.contains(e.target)) disarmDelete();
    };
    const away = () => disarmDelete();
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside, { passive: true });
    window.addEventListener('scroll', away, { passive: true, capture: true });
    window.addEventListener('blur', away);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
      window.removeEventListener('scroll', away, { capture: true });
      window.removeEventListener('blur', away);
    };
  }, [armedDeleteId, disarmDelete]);

  // Don't leak the arm timer if the component unmounts while armed.
  useEffect(() => () => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
  }, []);

  const refreshConversations = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['hubConversations', user?.email] });
  }, [queryClient, user?.email]);

  // Drop a purged row from the cached list immediately. The refetch that
  // follows would remove it anyway, but not before the next poll tick —
  // without this the row lingers for up to a second after the tap, which
  // reads as "Delete didn't work".
  const dropConversationFromCache = useCallback((convId) => {
    queryClient.setQueryData(
      ['hubConversations', user?.email],
      (rows) => (Array.isArray(rows) ? rows.filter(r => r?.id !== convId) : rows),
    );
  }, [queryClient, user?.email]);

  // Postgres RAISEs from the request RPCs carry a meaningful message
  // ('conversation_already_accepted', 'not_a_participant',
  // 'not_a_message_request', 'unauthenticated'). Swallowing them behind a
  // generic "try again" has now cost two separate diagnosis round-trips —
  // the failing call was invisible from the toast and from Sentry. Surface
  // the code and report it, same as the story-post path.
  const describeRpcError = useCallback((err) => {
    const code = err?.code || err?.status || '';
    const msg = err?.message || err?.error_description || (typeof err === 'string' ? err : '') || 'unknown error';
    return `${code ? code + ': ' : ''}${msg}`.slice(0, 140);
  }, []);

  const reportRequestFailure = useCallback((err, feature, convId) => {
    reportError(err instanceof Error ? err : new Error(String(err?.message || err)), {
      feature,
      level: 'warning',
      userEmail: user?.email,
      convId,
      code: err?.code || '',
    });
  }, [user?.email]);

  const handleAcceptRequest = useCallback(async (convId) => {
    if (!convId) return;
    setRequestBusyId(convId);
    try {
      await acceptConversation(convId);
      refreshConversations();
      toast.success(tFallback('hub.messages.request.accepted', 'Moved to your inbox.'));
    } catch (err) {
      reportRequestFailure(err, 'dm.accept', convId);
      toast.error(
        `${tFallback('hub.messages.request.error', 'Could not update that request.')} ${describeRpcError(err)}`,
        { duration: 9000 },
      );
    } finally {
      setRequestBusyId(null);
    }
  }, [refreshConversations, tFallback, describeRpcError, reportRequestFailure]);

  const handleDeleteRequest = useCallback(async (convId) => {
    if (!convId) return;
    disarmDelete();
    setRequestBusyId(convId);
    try {
      await purgeMessageRequest(convId);
      dropConversationFromCache(convId);
      refreshConversations();
      toast.success(tFallback('hub.messages.request.deleted', 'Request deleted.'));
    } catch (err) {
      reportRequestFailure(err, 'dm.purge', convId);
      toast.error(
        `${tFallback('hub.messages.request.error', 'Could not delete that request.')} ${describeRpcError(err)}`,
        { duration: 9000 },
      );
    } finally {
      setRequestBusyId(null);
    }
  }, [disarmDelete, dropConversationFromCache, refreshConversations, tFallback, describeRpcError, reportRequestFailure]);

  // Withdraw your OWN outgoing request. Lives in the Inbox, not
  // Requests — you accepted the thread by creating it — so this is the
  // only affordance the sender ever gets for taking a message back.
  // Unlike Delete it records NO block: withdrawing a message is not
  // blocking the person you were trying to reach.
  const handleUnsendRequest = useCallback(async (convId) => {
    if (!convId) return;
    disarmDelete();
    setRequestBusyId(convId);
    try {
      await unsendMessageRequest(convId);
      dropConversationFromCache(convId);
      refreshConversations();
      toast.success(tFallback('hub.messages.request.unsent', 'Request withdrawn.'));
    } catch (err) {
      reportRequestFailure(err, 'dm.unsend', convId);
      toast.error(
        `${tFallback('hub.messages.request.unsendError', 'Could not withdraw that request.')} ${describeRpcError(err)}`,
        { duration: 9000 },
      );
    } finally {
      setRequestBusyId(null);
    }
  }, [disarmDelete, dropConversationFromCache, refreshConversations, tFallback, describeRpcError, reportRequestFailure]);

  const handleBlockRequest = useCallback(async (convId, otherEmail) => {
    if (!convId || !otherEmail) return;
    disarmDelete();
    setRequestBusyId(convId);
    try {
      await blockUserFull(otherEmail);
      // Best-effort — the block already stops delivery, so a purge
      // failure here shouldn't read as "block failed".
      await purgeMessageRequest(convId).catch(() => {});
      dropConversationFromCache(convId);
      refreshConversations();
      toast.success(tFallback('hub.messages.request.blocked', 'Blocked. They can no longer message you.'));
    } catch {
      toast.error(tFallback('hub.messages.request.blockError', 'Could not block that user. Try again.'));
    } finally {
      setRequestBusyId(null);
    }
  }, [disarmDelete, dropConversationFromCache, refreshConversations, tFallback]);

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
    const { active, archived } = partitionByArchive(conversations, user?.id);
    const { inbox, requests } = partitionConversations(active, user?.email, followingEmails);
    return { archivedConvs: archived, inboxConvs: inbox, requestConvs: requests };
  // archiveVersion is a deliberate dependency, not noise. Archive state
  // lives in localStorage, so archiving changes NOTHING this memo watches:
  // `conversations` keeps its identity because React Query's structural
  // sharing returns the same array reference when a refetch is
  // structurally identical, which it is — archiving touches no server
  // row. So the invalidate fired, the refetch ran, and the partition
  // never re-ran; the row stayed in Inbox until a full reload.
  //
  // Pin and Mute were unaffected precisely because they hold their state
  // in React (pinnedConvIds / mutedConvIds) and re-render on change,
  // which is why only Archive was reported broken.
  }, [conversations, user?.email, user?.id, followingEmails, archiveVersion]);

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

  // A conversation asked for by id but not yet in the fetched list — set by
  // NewGroupDMModal's onCreated. Opens as soon as the refetch delivers the
  // row; cleared either way so a failed create doesn't leave it armed.
  const [pendingOpenConvId, setPendingOpenConvId] = useState(null);
  useEffect(() => {
    if (!pendingOpenConvId) return;
    const target = conversations.find(c => c.id === pendingOpenConvId);
    if (target) {
      setActiveConv(target);
      setPendingOpenConvId(null);
    }
  }, [conversations, pendingOpenConvId]);

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

  // Pinned crews sort to the top, same stable sort the DM list uses. The
  // crew menu already wrote pinnedCrewIds / mutedCrewIds and toasted, but
  // nothing read them back: the row never moved, never dimmed and carried
  // no pin or bell icon, so both actions were toasts over a no-op. That is
  // exactly the defect audit 10 #4 fixed for DMs; the crew half was missed.
  const visibleCrews = useMemo(() => {
    if (pinnedCrewIds.size === 0) return myCrews;
    return [...myCrews].sort((a, b) =>
      (pinnedCrewIds.has(b.id) ? 1 : 0) - (pinnedCrewIds.has(a.id) ? 1 : 0)
    );
  }, [myCrews, pinnedCrewIds]);

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

  // Search narrows the ACTIVE view's rows, so tab scoping is inherent:
  // `visibleConvs` is already inbox / requests / archived, and filtering
  // a list can only ever remove from it. Declared after `profilesById`
  // because usernames are resolved through it.
  const searchedConvs = useMemo(
    () => filterConversationsByQuery(visibleConvs, searchQuery, {
      profilesById,
      selfId: user?.id,
    }),
    [visibleConvs, searchQuery, profilesById, user?.id],
  );
  const isSearching = searchQuery.trim().length > 0;

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
  }, []);

  // ── Quick-action sheet contents ───────────────────────────────────────────
  // Declared after `profilesById` because the DM header resolves its handle
  // through it. Both kinds build the same shape so the sheet stays a dumb
  // renderer.
  const sheetHeader = useMemo(() => {
    if (!sheetTarget) return null;
    const { kind, row } = sheetTarget;
    if (kind === 'crew') {
      return {
        icon: Shield,
        label: row.name,
        sublabel: tFallback('hub.messages.tab.crews', 'Crews'),
      };
    }
    const otherId = (row.participant_ids || []).find(id => id && id !== user?.id) || '';
    const profile = profilesById[otherId];
    const username = profile?.username || null;
    return {
      avatarUrl: profile?.avatar_url || null,
      initials: (username || '?').slice(0, 2).toUpperCase(),
      label: username ? `@${username}` : t('hub.profile.anonymousAthlete'),
    };
  }, [sheetTarget, profilesById, user?.id, t, tFallback]);

  const sheetActions = useMemo(() => {
    if (!sheetTarget) return [];
    const { kind, row } = sheetTarget;
    if (kind === 'crew') {
      return [
        {
          id: 'pin',
          icon: Pin,
          label: pinnedCrewIds.has(row.id)
            ? tFallback('hub.messages.unpinChat', 'Unpin Chat')
            : tFallback('hub.messages.pinChat', 'Pin Chat'),
          onSelect: () => togglePinCrew(row.id),
        },
        {
          id: 'mute',
          icon: BellOff,
          label: mutedCrewIds.has(row.id)
            ? tFallback('hub.messages.unmuteChat', 'Unmute Chat')
            : tFallback('hub.messages.muteChat', 'Mute Chat'),
          onSelect: () => toggleMuteCrew(row.id),
        },
        {
          id: 'leave',
          icon: LogOut,
          label: tFallback('hub.messages.leaveCrew', 'Leave crew'),
          destructive: true,
          confirmLabel: tFallback('hub.messages.leaveCrewConfirm', 'Confirm leave'),
          confirmWarning: tFallback('hub.messages.leaveCrewWarning', "You'll need a new invite to rejoin."),
          onSelect: () => handleLeaveCrew(row),
        },
      ];
    }
    const archived = isArchived(row.id, user?.id);
    return [
      {
        id: 'pin',
        icon: Pin,
        label: pinnedConvIds.has(row.id)
          ? tFallback('hub.messages.unpinChat', 'Unpin Chat')
          : tFallback('hub.messages.pinChat', 'Pin Chat'),
        onSelect: () => togglePinConv(row.id),
      },
      {
        id: 'mute',
        icon: BellOff,
        label: mutedConvIds.has(row.id)
          ? tFallback('hub.messages.unmuteChat', 'Unmute Chat')
          : tFallback('hub.messages.muteChat', 'Mute Chat'),
        onSelect: () => toggleMuteConv(row.id),
      },
      {
        id: 'archive',
        icon: archived ? ArchiveRestore : Archive,
        label: archived
          ? tFallback('hub.messages.unarchive', 'Unarchive')
          : tFallback('hub.messages.archive', 'Archive'),
        onSelect: () => toggleArchiveConv(row.id),
      },
    ];
  // `isArchived` reads localStorage, which no dependency here observes —
  // but unlike the partition memo this one does NOT need archiveVersion.
  // Archiving closes the sheet, and reopening it produces a new
  // `sheetTarget` object, so the label is always re-read from a fresh
  // localStorage on the only render where it can be seen.
  }, [sheetTarget, pinnedConvIds, mutedConvIds, pinnedCrewIds, mutedCrewIds,
      user?.id, tFallback,
      togglePinConv, toggleMuteConv, toggleArchiveConv,
      togglePinCrew, toggleMuteCrew, handleLeaveCrew]);

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
            tab === 'dms' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground active:text-foreground'
          }`}
        >
          <MessageCircle className="w-4 h-4" />
          {tFallback('hub.messages.tab.dms', 'Messages')}
        </button>
        <button
          onClick={() => setTab('crews')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
            tab === 'crews' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground active:text-foreground'
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
                  dmView === 'inbox' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
                }`}
              >
                <Inbox className="w-3.5 h-3.5" /> {tFallback('hub.messages.view.inbox', 'Inbox')}
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
                    ? 'text-primary hover:bg-secondary active:bg-secondary'
                    : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
                }`}
              >
                <Mail className="w-3.5 h-3.5" /> {tFallback('hub.messages.view.requests', 'Requests')}
                {requestConvs.length > 0 && (
                  <span
                    aria-label={`${requestConvs.length} pending message requests`}
                    className={`min-w-[1.15rem] px-1 h-[1.15rem] inline-flex items-center justify-center rounded-full text-micro font-bold leading-none ${
                      dmView === 'requests'
                        ? 'bg-primary-foreground/25 text-primary-foreground'
                        : 'bg-primary text-white'
                    }`}
                  >
                    {requestConvs.length > 99 ? '99+' : requestConvs.length}
                  </span>
                )}
              </button>
              {archivedConvs.length > 0 && (
                <button
                  onClick={() => setDmView('archived')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold transition-colors ${
                    dmView === 'archived' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
                  }`}
                >
                  <Archive className="w-3.5 h-3.5" /> {tFallback('hub.messages.view.archived', 'Archived')}
                </button>
              )}
              <button
                onClick={() => {
                  if (searchOpen) { closeSearch(); return; }
                  setSearchOpen(true);
                  // Focus after the field has mounted.
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }}
                className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold transition-colors ${
                  searchOpen ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
                }`}
                aria-label={tFallback('hub.messages.search.toggle', 'Search conversations')}
                aria-expanded={searchOpen}
              >
                <Search className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setNewGroupOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold text-primary hover:bg-secondary active:bg-secondary"
                aria-label="Start a new group conversation"
              >
                <UserPlus className="w-3.5 h-3.5" /> New group
              </button>
            </div>
          )}

          {/* Search field — styling mirrors the All Workouts modal's
              inline filter (icon inset in a rounded secondary field),
              since this is the same job: narrowing a list that is
              already in memory. */}
          {searchOpen && conversations.length > 0 && (
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }}
                placeholder={tFallback('hub.messages.search.placeholder', 'Search by name or message…')}
                aria-label={tFallback('hub.messages.search.placeholder', 'Search by name or message…')}
                className="w-full h-10 ps-9 pe-9 rounded-xl bg-secondary/40 border border-border text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                onClick={closeSearch}
                className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground transition-colors"
                aria-label={tFallback('hub.messages.search.close', 'Close search')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : isSearching && searchedConvs.length === 0 ? (
            /* Distinct from "no conversations yet" — there ARE threads
               here, the query just didn't match any of them, so the copy
               points at the query rather than at an empty inbox. */
            <EmptyState
              icon={Search}
              title={tFallback('hub.messages.search.empty.title', 'No matches')}
              body={tFallback(
                'hub.messages.search.empty.desc',
                'No conversations in this view match that search. Try a different name or word.'
              )}
              action={{
                label: tFallback('hub.messages.search.clear', 'Clear search'),
                onClick: () => setSearchQuery(''),
              }}
            />
          ) : visibleConvs.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title={dmView === 'requests'
                ? tFallback('hub.messages.requests.empty.title', 'No message requests')
                : dmView === 'archived'
                ? tFallback('hub.messages.archived.empty.title', 'No archived conversations')
                : t('hub.messages.empty.title')}
              body={dmView === 'inbox'
                ? t('hub.messages.empty.desc')
                : dmView === 'requests'
                ? tFallback(
                    'hub.messages.requests.empty.desc',
                    'People you don’t follow have to request before they can message you. Their requests show up here.'
                  )
                : null}
              action={dmView === 'inbox' ? {
                label: 'Start a group',
                onClick: () => setNewGroupOpen(true),
              } : null}
            />
          ) : (
            <div className="space-y-1">
              {searchedConvs.map((c, i) => {
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
                // Your own request, still un-actioned by the recipient.
                // It sits in YOUR inbox (you accepted it by creating it),
                // so without a marker it reads as a normal thread and
                // there's nowhere to take it back from.
                const outgoingPending = dmView === 'inbox'
                  && isOutgoingPendingRequest(c, user?.email);
                // Grey check / green check / green eye on MY last
                // message. Declared before the JSX that reads it.
                const deliveryStatus = deriveDeliveryStatus(lastMsg, user?.email, {
                  isGroup: !!c.is_group
                    || (Array.isArray(c.participant_emails) && c.participant_emails.length > 2),
                  readReceiptsEnabled,
                });
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
                    <LongPressRow
                      innerRef={i === 0 ? firstRowRef : undefined}
                      onTap={() => {
                        setActiveConv(c);
                        setOpenOtherUser(profile ? { ...profile, email: otherEmail } : { id: otherId, email: otherEmail, username });
                      }}
                      // Requests rows already carry Accept / Delete / Block
                      // inline, and pinning a message request is meaningless —
                      // so that view has no quick actions to offer.
                      onLongPress={dmView === 'requests'
                        ? null
                        : () => openSheet('dm', c, null)}
                      // lg:pe-12 reserves the strip the absolutely-positioned
                      // three-dot menu occupies (32px button, inset end-2).
                      // Without it the delivery-status icon — the last thing
                      // on the timestamp line — runs right up against the
                      // ellipsis, which is what "the eye and ellipses are too
                      // close together" describes. Only on lg, since the menu
                      // itself is hidden below that breakpoint.
                      className="w-full flex items-center gap-3 p-3 lg:pe-12 rounded-xl hover:bg-secondary/40 active:bg-secondary/60 transition-colors text-start select-none-ui"
                    >
                      <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-heading font-bold text-primary text-base overflow-hidden">
                        {profile?.avatar_url ? (
                          <img loading="lazy" src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`font-heading text-sm truncate flex items-center gap-1.5 ${unread ? 'font-bold text-foreground' : 'font-semibold text-foreground'}`}>
                            {isPinned && <Pin className="w-3 h-3 text-primary shrink-0" aria-label={t('crew.messages.pinned')} />}
                            <span className="truncate">{handle}</span>
                            {isMuted && <BellOff className="w-3 h-3 text-muted-foreground shrink-0" aria-label="Muted" />}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className={`text-sm truncate ${unread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                            {preview}
                            {timeStr && <span className="text-muted-foreground font-normal"> · {timeStr}</span>}
                          </p>
                        </div>
                      </div>
                    </LongPressRow>

                    {/* Request actions. Only rendered in the Requests view —
                        Accept moves the thread to Inbox by appending the
                        viewer to accepted_emails (no row migration), Delete
                        writes a per-viewer decline tombstone, Block runs the
                        full-block RPC and then hides the thread. */}
                    {/* Unsend — same two-tap confirm as Delete, because
                        it is the same irreversible destruction seen from
                        the other side. */}
                    {outgoingPending && (
                      armedDeleteId === c.id ? (
                        <div ref={confirmRef} className="flex items-center gap-2 px-3 pb-3 -mt-1">
                          <button
                            disabled={requestBusyId === c.id}
                            onClick={(e) => { e.stopPropagation(); handleUnsendRequest(c.id); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive text-white text-xs font-bold disabled:opacity-50 transition-opacity"
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                            {tFallback('hub.messages.request.confirmUnsend', 'Confirm unsend')}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); disarmDelete(); }}
                            className="px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-semibold transition-colors"
                          >
                            {tFallback('common.cancel', 'Cancel')}
                          </button>
                          <span className="text-micro text-muted-foreground">
                            {tFallback('hub.messages.request.unsendWarning', 'Removes it for both of you.')}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3 pb-3 -mt-1">
                          <button
                            disabled={requestBusyId === c.id}
                            onClick={(e) => { e.stopPropagation(); armDelete(c.id); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-semibold disabled:opacity-50 transition-opacity"
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                            {tFallback('hub.messages.request.unsend', 'Unsend request')}
                          </button>
                          <span className="text-micro text-muted-foreground">
                            {tFallback('hub.messages.request.awaitingAccept', 'Waiting for them to accept.')}
                          </span>
                        </div>
                      )
                    )}

                    {dmView === 'requests' && (
                      armedDeleteId === c.id ? (
                        // Armed state. Deleting is irreversible and removes
                        // the sender's copy too, so the second tap is a
                        // deliberate one.
                        <div ref={confirmRef} className="flex items-center gap-2 px-3 pb-3 -mt-1">
                          <button
                            disabled={requestBusyId === c.id}
                            onClick={(e) => { e.stopPropagation(); handleDeleteRequest(c.id); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive text-white text-xs font-bold disabled:opacity-50 transition-opacity"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {tFallback('common.confirmDelete', 'Confirm delete')}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); disarmDelete(); }}
                            className="px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-semibold transition-colors"
                          >
                            {tFallback('common.cancel', 'Cancel')}
                          </button>
                          <span className="text-micro text-muted-foreground">
                            {tFallback('hub.messages.request.deleteWarning', 'Deletes it for both of you.')}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3 pb-3 -mt-1">
                          <button
                            disabled={requestBusyId === c.id}
                            onClick={(e) => { e.stopPropagation(); handleAcceptRequest(c.id); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50 transition-opacity"
                          >
                            <Check className="w-3.5 h-3.5" />
                            {tFallback('hub.messages.request.accept', 'Accept')}
                          </button>
                          <button
                            disabled={requestBusyId === c.id}
                            onClick={(e) => { e.stopPropagation(); armDelete(c.id); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-semibold disabled:opacity-50 transition-opacity"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {tFallback('hub.messages.request.delete', 'Delete')}
                          </button>
                          <button
                            disabled={requestBusyId === c.id || !otherEmail}
                            onClick={(e) => { e.stopPropagation(); handleBlockRequest(c.id, otherEmail); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-destructive hover:bg-destructive/10 active:bg-destructive/10 text-xs font-semibold disabled:opacity-50 transition-colors"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            {tFallback('hub.messages.request.block', 'Block')}
                          </button>
                        </div>
                      )
                    )}
                    {/* Right-hand rail: delivery status + the desktop menu,
                        as siblings in ONE row-centered flex container.

                        The status icon used to live at the end of the preview
                        line while the three-dot button was centred on the row.
                        Two different anchors, so they never lined up: measured
                        at 11px apart (icon on text line 2 at y=311, button at
                        the row centre y=300). Sharing one `items-center`
                        parent makes the offset 0 by construction rather than
                        by a magic margin, and it holds however many text lines
                        the row grows to.

                        Status is pointer-events-none so it never steals a tap
                        from the row button underneath it. */}
                    <div className="absolute end-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      {/* Delivery status for MY last message. Never rendered on
                          a message I received — you don't show read state for
                          someone else's message — so this and the unread dot
                          are mutually exclusive by construction. */}
                      <span className="flex items-center pointer-events-none">
                        {deliveryStatus === 'read' ? (
                          <Eye
                            className="w-3.5 h-3.5 shrink-0 text-success"
                            aria-label={tFallback('hub.messages.status.read', 'Read')}
                          />
                        ) : deliveryStatus === 'delivered' ? (
                          <CheckCheck
                            className="w-3.5 h-3.5 shrink-0 text-success"
                            aria-label={tFallback('hub.messages.status.delivered', 'Delivered')}
                          />
                        ) : deliveryStatus === 'sent' ? (
                          <Check
                            className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
                            aria-label={tFallback('hub.messages.status.sent', 'Sent')}
                          />
                        ) : null}
                        {unread && <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                      </span>

                    {/* Pointer-device trigger for the SAME sheet the
                        long-press opens. A hold is the wrong idiom for a
                        mouse, but a second menu implementation is how the
                        two drift apart — so this is a second trigger, not a
                        second menu. It also retires the popover that used
                        to live here, which rode on group-hover and vanished
                        mid-click whenever the 15s refetch reordered the list
                        under the pointer. */}
                    {dmView !== 'requests' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openSheet('dm', c, e.currentTarget); }}
                        aria-label={tFallback('hub.messages.rowActions', 'Conversation options')}
                        className="hidden lg:flex w-8 h-8 items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-secondary active:bg-secondary text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    )}
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
              // Record the id and let the effect above open it when the row
              // actually arrives. The previous version read `conversations`
              // inside a setTimeout — a closure over the array as it stood
              // BEFORE the invalidate, which by definition cannot contain a
              // conversation created a moment ago. `target` was always
              // undefined, so creating a group silently landed you back on
              // the inbox instead of in the new thread.
              setPendingOpenConvId(convId);
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
              {visibleCrews.map((crew, i) => (
                <motion.div
                  key={crew.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={`relative group ${mutedCrewIds.has(crew.id) ? 'opacity-60' : ''}`}
                >
                  <LongPressRow
                    onTap={() => setActiveCrew(crew)}
                    onLongPress={() => openSheet('crew', crew, null)}
                    className="w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-border text-start hover:bg-secondary/30 active:bg-secondary/50 transition-colors select-none-ui"
                  >
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'hsl(var(--primary) / 0.12)' }}
                    >
                      <Shield className="w-5 h-5" style={{ color: 'hsl(var(--primary))' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold text-sm text-foreground truncate flex items-center gap-1.5">
                        {pinnedCrewIds.has(crew.id) && (
                          <Pin className="w-3 h-3 text-primary shrink-0" aria-label={tFallback('hub.messages.pinned', 'Pinned')} />
                        )}
                        <span className="truncate">{crew.name}</span>
                        {mutedCrewIds.has(crew.id) && (
                          <BellOff className="w-3 h-3 text-muted-foreground shrink-0" aria-label={tFallback('hub.messages.muted', 'Muted')} />
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Users className="w-3 h-3" />
                        {crew.max_capacity ? `up to ${crew.max_capacity} members` : 'Group Chat'}
                        {crew.is_admin && (
                          <span
                            className="ms-1.5 px-1.5 py-0.5 rounded-full text-micro font-bold uppercase tracking-wide"
                            style={{ background: 'hsl(var(--primary) / 0.15)', color: 'hsl(var(--primary))' }}
                          >
                            Admin
                          </span>
                        )}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </LongPressRow>
                  {/* Pointer trigger for the same sheet — see the DM row. */}
                  <button
                    onClick={(e) => { e.stopPropagation(); openSheet('crew', crew, e.currentTarget); }}
                    aria-label={tFallback('hub.messages.rowActions', 'Conversation options')}
                    className="hidden lg:flex absolute end-2 top-1/2 -translate-y-1/2 w-8 h-8 items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-secondary active:bg-secondary text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Row quick actions. One sheet for both kinds of row and both
          triggers (hold on touch, three-dot on a pointer). */}
      <RowActionSheet
        open={!!sheetTarget}
        onClose={() => setSheetTarget(null)}
        header={sheetHeader}
        actions={sheetActions}
        returnFocusRef={sheetOriginRef}
      />

      {/* Nothing pointed at the gesture, and a gesture nobody is told about
          belongs only to whoever wrote it. Gated on there being a row to
          anchor to: OneShotTooltip fires once on mount and will not re-run
          when an anchor appears later, so mounting it against an empty
          inbox would burn the one shot on nothing. */}
      {tab === 'dms' && dmView !== 'requests' && searchedConvs.length > 0 && (
        <OneShotTooltip id={TOOLTIP.DM_ROW_LONG_PRESS} anchorRef={firstRowRef} placement="bottom">
          {tFallback('hub.messages.tooltip.longPress', 'Hold a chat for pin, mute and archive')}
        </OneShotTooltip>
      )}
    </div>
  );
}
