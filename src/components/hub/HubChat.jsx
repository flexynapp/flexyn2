import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, Lock, Paperclip, X, CornerUpLeft, Search, Clock, Smile } from 'lucide-react';
import { highlightMatches, countMatches } from '@/lib/highlightMatches';
import { acceptConversation, isPendingRequestSendBlocked } from '@/lib/data/conversationRequests';
import { useReadReceiptsEnabled } from '@/hooks/useReadReceiptsEnabled';
import { deleteMyMessage, scheduleMyMessage, listMyScheduled, cancelMyScheduledMessage } from '@/lib/data/dmLifecycle';
import DMStickerPicker from './DMStickerPicker';
import GifPicker, { GIF_ENABLED } from './GifPicker';
import VoiceMemoRecorder, { formatDuration as formatVoiceDuration } from './VoiceMemoRecorder';
import { ITEMS as LOOT_ITEMS } from '@/lib/lootCatalog';
import { format, parseISO, differenceInHours, formatDistanceToNowStrict } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import OneShotTooltip from '@/components/OneShotTooltip';
import { TOOLTIP } from '@/lib/tooltipRegistry';
import * as hubMessages from '@/lib/data/hubMessages';
import * as users from '@/lib/data/users';
import * as dmRxns from '@/lib/data/dmMessageReactions';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { toast } from '@/lib/toast';
import { triggerHaptic } from '@/lib/haptic';
import { compressImage } from '@/lib/imageCompress';
import TradeOfferCard, { parseTradeOffer, parseTradeResponse } from './TradeOfferCard';
import CrewDMInviteCard, { parseCrewInvite } from '@/components/crews/CrewDMInviteCard';
import DuelInviteCard, { parseDuelInvite } from '@/components/duels/DuelInviteCard';
import { PollBubble, PollComposer } from './PollMessage';
import { isPollVote, parsePoll, buildPollBody, buildVoteBody, buildVoteIndex, pollResults } from '@/lib/dmPolls';
import { useSwipeToDelete } from '@/hooks/useSwipeToDelete';

// Resolve the timestamp from either column (migration 004 added created_date; base schema has created_at)
const msgTime = (m) => m?.created_date || m?.created_at || null;

function shouldShowDivider(messages, index) {
  if (index === 0) return true;
  const curr = msgTime(messages[index]);
  const prev = msgTime(messages[index - 1]);
  if (!curr || !prev) return false;
  return differenceInHours(parseISO(curr), parseISO(prev)) >= 1;
}

function formatDivider(dateStr) {
  if (!dateStr) return '';
  const date = parseISO(dateStr);
  const diffH = differenceInHours(new Date(), date);
  if (diffH < 24) return format(date, "'Today at' h:mm a");
  if (diffH < 48) return format(date, "'Yesterday at' h:mm a");
  return format(date, "MMM d 'at' h:mm a");
}

function formatRelativeShort(dateStr) {
  if (!dateStr) return '';
  try {
    return formatDistanceToNowStrict(parseISO(dateStr), { addSuffix: false })
      .replace(' seconds', 's').replace(' second', 's')
      .replace(' minutes', 'm').replace(' minute', 'm')
      .replace(' hours', 'h').replace(' hour', 'h')
      .replace(' days', 'd').replace(' day', 'd');
  } catch { return ''; }
}

// Dedupe optimistic messages once the server echoes them back.
//
// The naive key (sender+content) collapsed two identical rapid sends
// ("ok" + "ok") into one — the user saw only one in the thread even
// though both reached the server. The previous fix attempted a
// two-pass that still suffered the same collision class because all
// temps with the same content were considered interchangeable with
// any single real of matching content.
//
// Current strategy: dedupe REAL ids by id; for temps, consume each
// real exactly once. If two temps share content and only one real
// has landed, the SECOND temp survives until its own real lands.
// (Audit 10 #19.)
function dedupeMessages(list) {
  if (!list || list.length === 0) return [];
  // Count how many REAL rows exist per content+sender key. As we
  // walk newest → oldest, each temp consumes one count; subsequent
  // temps for the same key survive until the matching real arrives.
  const realKeyCounts = new Map();
  for (const m of list) {
    const id = m.id;
    const isTemp = String(id || '').startsWith('temp-');
    if (!isTemp && id) {
      const text = (m.body || m.content || '').trim();
      const key = `${(m.sender_email || '').toLowerCase()}|${text}`;
      realKeyCounts.set(key, (realKeyCounts.get(key) || 0) + 1);
    }
  }
  const seenIds = new Set();
  const out = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    const id = m.id;
    const isTemp = String(id || '').startsWith('temp-');
    if (id && seenIds.has(id)) continue;
    if (isTemp) {
      const text = (m.body || m.content || '').trim();
      const key = `${(m.sender_email || '').toLowerCase()}|${text}`;
      const remaining = realKeyCounts.get(key) || 0;
      if (remaining > 0) {
        // This temp's real has landed — drop the temp, decrement.
        realKeyCounts.set(key, remaining - 1);
        continue;
      }
      // No real left to absorb this temp → it's a genuine extra send
      // still in-flight; keep it.
    }
    if (id) seenIds.add(id);
    out.unshift(m);
  }
  return out;
}


const QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '😮'];

// Render a message body with optional in-thread search highlights.
// Returns <span> children so it slots into the existing message bubble
// without disturbing the wordBreak / whiteSpace styling. Falls back to
// a plain <span> when no query is active.
function renderBodyWithHighlights(text, query) {
  if (!query || !query.trim()) return <span>{text}</span>;
  const segments = highlightMatches(text, query);
  return (
    <span>
      {segments.map((seg, idx) =>
        seg.match
          ? <mark key={idx} className="bg-primary/30 text-foreground rounded-sm px-0.5">{seg.text}</mark>
          : <span key={idx}>{seg.text}</span>
      )}
    </span>
  );
}

// Wraps a single DM message row with swipe-to-delete. Only fires
// onDelete when the message is the user's own (non-optimistic) message.
function SwipeableDmMessage({ children, isMine, isOptimistic, onDelete }) {
  const swipe = useSwipeToDelete({
    onDelete,
    enabled: isMine && !isOptimistic,
  });
  if (!isMine || isOptimistic) return children;
  return (
    <div {...swipe.containerProps}>
      {/* Delete affordance — slides in from the right as user drags left */}
      <div
        style={swipe.actionStyle}
        className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-wide"
      >
        🗑️ Delete
      </div>
      <div {...swipe.contentProps}>{children}</div>
    </div>
  );
}

export default function HubChat({ conversation, otherUser = null, onBack }) {
  const { t, tFallback } = useLanguage();
  // Declared before every read, including the deps arrays below.
  const readReceiptsEnabled = useReadReceiptsEnabled();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);

  const scrollerRef    = useRef(null);
  const textareaRef    = useRef(null);
  const fileInputRef   = useRef(null);
  const stickToBottomRef = useRef(true);

  // ── Double-tap fire reactions ──────────────────────────────────────────────
  const lastTapRef = useRef({ id: null, time: 0 });
  // Anchor for the one-shot double-tap hint (see the mount below the list).
  const lastMsgRef = useRef(null);
  const [floatingFires, setFloatingFires] = useState([]);

  // ── Pinning ────────────────────────────────────────────────────────────────
  // messageId → the optimistic pin value, held only until the server row
  // agrees. This was a Set XOR'd against `msg.is_pinned`, which inverted
  // itself the moment the write landed: pin a message, the row refetches
  // with is_pinned = true, the id is still in the Set, and `!true` renders
  // it as UNPINNED again. The badge and the Pinned panel both dropped it
  // within one 5s poll, so pinning looked like it silently failed.
  const [pinOverride, setPinOverride] = useState({});
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [contextMsg, setContextMsg] = useState(null);
  const longPressRef = useRef(null);

  // ── Emoji reactions (migration 064) ───────────────────────────────────────
  const [reactions, setReactions] = useState({}); // { [msgId]: [{ user_id, emoji }] }

  // ── Inline reply ──────────────────────────────────────────────────────────
  const [replyTo, setReplyTo] = useState(null); // { id, snippet }

  // ── Typing indicator ──────────────────────────────────────────────────────
  const [peerIsTyping, setPeerIsTyping] = useState(false);
  const channelRef            = useRef(null);
  const typingTimeoutRef      = useRef(null);
  const lastTypingBroadcastRef = useRef(0);

  // ── Scroll-to-bottom pill ─────────────────────────────────────────────────
  const [newMsgCount, setNewMsgCount] = useState(0);

  // ── Read receipt fade ─────────────────────────────────────────────────────
  const [readReceiptFaded, setReadReceiptFaded] = useState(false);

  const myEmailLc = (user?.email || '').toLowerCase();
  // Is this a group conversation? (3+ participants OR the explicit
  // is_group flag from mig 116.) Group threads show all-vs-one rendering:
  // sender name above each non-own message, participant-list header.
  const isGroup = !!conversation?.is_group
    || (Array.isArray(conversation?.participant_emails)
      && conversation.participant_emails.length > 2);
  const otherEmails = (conversation?.participant_emails || [])
    .filter(e => e?.toLowerCase() !== myEmailLc);
  const otherEmail = otherEmails[0] || '';
  const otherIds = (conversation?.participant_ids || [])
    .filter(id => id && id !== user?.id);
  const otherId = otherIds[0] || '';

  const { data: resolvedOther } = useQuery({
    queryKey: ['hubChatProfile', otherId || otherEmail],
    queryFn: async () => {
      if (!otherId) return null;
      // Resolve the peer's display profile by user_id (participant_ids is
      // backfilled + trigger-maintained, mig 216) instead of scanning
      // users.list() and matching on email — drops a public_profiles email
      // read. otherEmail stays for the send path (recipientEmail), sourced
      // from the conversation's own participant_emails, not the view.
      const { data } = await users.selectProfiles((from) => from
        .select('id, username, avatar_url')
        .eq('id', otherId)
        .single());
      return data || null;
    },
    enabled: !otherUser && !!otherId,
    staleTime: 60_000,
  });

  // Every participant's display profile, keyed by user_id. Groups only —
  // a 1:1 thread already has `resolvedOther` and never labels its bubbles.
  //
  // hub_messages.user_id is the sender's auth uid (db.js injects it on every
  // create; 47/47 production rows carry one), so this is what turns a message
  // into a name. participant_ids is NOT index-aligned with participant_emails
  // — mig 216 fills it with `array_agg(id ORDER BY id)` — so pairing the two
  // arrays positionally would attribute messages to the wrong person.
  const participantIds = useMemo(
    () => (conversation?.participant_ids || []).filter(Boolean),
    [conversation?.participant_ids],
  );
  const { data: participantsById = {} } = useQuery({
    queryKey: ['hubChatParticipants', participantIds.slice().sort().join(',')],
    queryFn: async () => {
      const { data } = await users.selectProfiles((from) => from
        .select('id, username, avatar_url')
        .in('id', participantIds));
      const map = {};
      for (const u of (data ?? [])) map[u.id] = u;
      return map;
    },
    enabled: isGroup && participantIds.length > 0,
    staleTime: 60_000,
  });

  const otherProfile    = otherUser || resolvedOther;
  const otherUsername   = otherProfile?.username || null;
  const otherHandle     = otherUsername ? `@${otherUsername}` : t('hub.profile.anonymousAthlete');
  const otherInitials   = (otherUsername || '?').slice(0, 2).toUpperCase();
  const otherAvatarUrl  = otherProfile?.avatar_url || null;

  const INITIAL_WINDOW = 200;
  const MAX_WINDOW = 2000;
  // How many rows are currently in the cache — used so the 5s poll / any
  // invalidate refetches AT LEAST the rows already on screen. Without this,
  // a poll re-running `listMessages(id, 200)` after the user paged older
  // history in would collapse the window back to the newest 200 and yank
  // the history out from under them. The ref keeps the queryFn stable.
  const loadedCountRef = useRef(INITIAL_WINDOW);
  const { data: rawMessages = [] } = useQuery({
    queryKey: ['hubChat', conversation?.id],
    queryFn: () => hubMessages.listMessages(
      conversation.id,
      Math.min(Math.max(loadedCountRef.current, INITIAL_WINDOW), MAX_WINDOW),
    ),
    enabled: !!conversation?.id,
    refetchInterval: 5000,
  });

  const messages = dedupeMessages(rawMessages);

  // ── Pending message-request send cap ──────────────────────────────────────
  // Until the recipient accepts, a request sender gets exactly ONE message.
  // The database is the enforcement point (mig 234's RESTRICTIVE INSERT
  // policy on hub_messages); this mirror exists so the composer can
  // disable itself and say why, instead of the user typing a paragraph
  // into a 42501. Declared here — above handleSend and every deps array
  // that reads it — per the TDZ rule in CLAUDE.md.
  const myMessageCount = messages.filter(
    m => (m.sender_email || '').toLowerCase() === myEmailLc
  ).length;
  const pendingSendBlocked = isPendingRequestSendBlocked(
    conversation, user?.email, myMessageCount
  );

  // Shared guard for every send path. handleSend is not the only one —
  // stickers, GIFs and voice memos each insert their own hub_messages
  // row, so each is subject to mig 234's one-message cap. Without this
  // they'd hit the RESTRICTIVE policy and surface a raw 42501. The voice
  // path especially: it uploads BEFORE inserting, so an ungated attempt
  // would also leave an orphan blob in storage.
  //
  // Note what is NOT gated: the FIRST message may carry an image, video,
  // sticker, GIF or voice memo. The cap counts message rows, not media.
  const blockPendingSend = useCallback(() => {
    if (!pendingSendBlocked) return false;
    toast.error(tFallback(
      'hub.messages.request.waitToSend',
      'Message request sent. You can send more once they accept.'
    ));
    return true;
  }, [pendingSendBlocked, tFallback]);

  // Keep the poll window in sync with what's loaded (persisted rows only —
  // temps don't exist server-side). Reset to the initial window on switch.
  loadedCountRef.current = Math.max(rawMessages.length, INITIAL_WINDOW);

  // ── Older-history pagination ───────────────────────────────────────────────
  // The initial query loads the NEWEST `INITIAL_WINDOW` messages (oldest-first
  // for render). If that came back full, there may be older history; show a
  // "Load earlier" affordance that prepends a cursor page while preserving the
  // visual scroll position (anchored to the row that was at the top).
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  // The 5s poll only ever appends newer rows, so once the first full window
  // arrives we keep the "maybe older exists" signal until a cursor page comes
  // back short. rawMessages length can exceed INITIAL_WINDOW after prepends,
  // so gate on whether we've hit the start rather than the current length.
  const initialWindowWasFull = rawMessages.length >= INITIAL_WINDOW;
  const canLoadOlder = initialWindowWasFull && !reachedStart;

  // Reset pagination signals whenever the conversation changes.
  useEffect(() => { setReachedStart(false); setLoadingOlder(false); }, [conversation?.id]);

  const handleLoadOlder = useCallback(async () => {
    if (loadingOlder || reachedStart || !conversation?.id) return;
    // Oldest currently-loaded row is the cursor (messages are ascending).
    const oldest = messages[0];
    const cursor = oldest && (oldest.created_date || oldest.created_at);
    if (!cursor) return;
    setLoadingOlder(true);
    // Anchor scroll: remember the scroll distance from the BOTTOM so that
    // after we prepend older rows (which grow scrollHeight at the top) we can
    // restore the same visual position the user was looking at.
    const el = scrollerRef.current;
    const prevDistanceFromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const older = await hubMessages.listOlderMessages(conversation.id, cursor, 100);
      if (!older || older.length === 0) {
        setReachedStart(true);
        return;
      }
      if (older.length < 100) setReachedStart(true);
      const queryKey = ['hubChat', conversation.id];
      queryClient.setQueryData(queryKey, (rows) => {
        const existing = rows || [];
        const existingIds = new Set(existing.map(r => r.id));
        const fresh = older.filter(r => !existingIds.has(r.id));
        return [...fresh, ...existing];
      });
      // Restore visual position after the DOM grows. Two rAFs so layout has
      // flushed the prepended rows before we read the new scrollHeight.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const node = scrollerRef.current;
        if (node) node.scrollTop = node.scrollHeight - prevDistanceFromBottom;
      }));
    } catch {
      // Soft failure — leave the affordance up so the user can retry.
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, reachedStart, conversation?.id, messages, queryClient]);

  // Poll vote tally — votes are control messages ([POLL_VOTE_V1]) that
  // reference a poll's message id. Built from the full (unfiltered) list so
  // the count is complete, then the control rows are hidden from the thread.
  const voteIndex = useMemo(() => buildVoteIndex(messages), [messages]);

  // In-thread search filter (G1). Skipped to all-messages when the
  // search bar is closed; once a query exists, only matching messages
  // (case-insensitive substring) render. Poll-vote control rows are never
  // shown — they're an implementation detail, not chat content.
  const visibleMessages = (() => {
    const nonControl = messages.filter(m => !isPollVote(m.body || m.content || ''));
    const q = searchQuery.trim();
    if (!searchOpen || !q) return nonControl;
    const ql = q.toLowerCase();
    return nonControl.filter(m => {
      const body = (m.body || m.content || '').toLowerCase();
      return body.includes(ql);
    });
  })();
  const totalMatches = searchOpen && searchQuery.trim()
    ? messages.reduce((s, m) => s + countMatches(m.body || m.content || '', searchQuery), 0)
    : 0;

  // Fetch emoji reactions for visible messages.
  //
  // Memoize the persisted (non-temp) message-id list as a stable string
  // key. Two fixes the previous implementation needed:
  //   1. Depending on messages.length alone meant a delete + insert
  //      (length unchanged) skipped the refetch, so reactions on the
  //      new message never showed.
  //   2. The .then(setReactions) had no cancellation — if the user
  //      switched conversations or the component unmounted before the
  //      fetch resolved, the previous conversation's reactions could
  //      land in the new view (or warn about state-after-unmount).
  const persistedIdsKey = useMemo(
    () => messages.map(m => m.id).filter(id => !String(id).startsWith('temp-')).join(','),
    [messages]
  );
  useEffect(() => {
    if (!persistedIdsKey) return;
    const ids = persistedIdsKey.split(',');
    let cancelled = false;
    dmRxns.getReactionsForMessages(ids)
      .then((r) => { if (!cancelled) setReactions(r); })
      .catch((err) => console.warn('[HubChat] reactions fetch failed:', err));
    return () => { cancelled = true; };
  }, [persistedIdsKey]);

  // ── Realtime channel for typing indicator ─────────────────────────────────
  useEffect(() => {
    if (!conversation?.id || !user?.id) return;
    // Channel name MUST match across both peers for broadcast routing
    // to work — adding a random per-mount suffix (the fix used in
    // HubFeed) would silo each user. Instead we wrap subscribe in a
    // try/catch: if Supabase's channel registry hands back a stale
    // already-subscribed channel from a prior mount whose cleanup is
    // still in flight (React 18 double-mount, rapid conversation
    // switch back-and-forth), .on() throws "cannot add callbacks
    // after subscribe()". In that case we forcibly remove + recreate
    // once. If the retry still fails we log and continue without the
    // typing indicator — degrading the feature is acceptable;
    // crashing the chat is not.
    let ch;
    const buildChannel = () => supabase.channel(`dm_typing_${conversation.id}`, {
      config: { broadcast: { self: false } },
    });
    const attachAndSubscribe = (channel) => {
      channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.user_id === user.id) return;
        setPeerIsTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setPeerIsTyping(false), 3000);
      }).subscribe();
    };
    try {
      ch = buildChannel();
      attachAndSubscribe(ch);
    } catch (e) {
      const isStaleChannel = /cannot add.*callbacks.*subscribe/i.test(e?.message || '');
      if (isStaleChannel && ch) {
        // Remove the zombie + retry with a fresh acquisition.
        try { supabase.removeChannel(ch).catch(() => {}); } catch {}
        try {
          ch = buildChannel();
          attachAndSubscribe(ch);
        } catch (retryErr) {
          // Give up — chat keeps working, typing indicator just won't fire.
          console.warn('[HubChat] typing channel setup failed:', retryErr);
          ch = null;
        }
      } else {
        console.warn('[HubChat] typing channel setup failed:', e);
        ch = null;
      }
    }
    channelRef.current = ch;
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (ch) supabase.removeChannel(ch).catch(() => {});
      channelRef.current = null;
    };
  }, [conversation?.id, user?.id]);

  // ── Mark read + invalidate badge ──────────────────────────────────────────
  // Only mark messages read when the user's tab is actually VISIBLE.
  // Previously this effect fired whenever messages.length changed
  // including on background tabs — the sender saw a "Read" indicator
  // even though the recipient had never actually opened the chat
  // (their tab was inactive when a new message arrived). Now we gate
  // on document.visibilityState and re-check when the tab becomes
  // visible again. (Audit 10 #6.)
  useEffect(() => {
    if (!conversation?.id || !user?.email) return;

    const tryMark = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      hubMessages.markRead(conversation.id, user.email).then(() => {
        queryClient.invalidateQueries({ queryKey: ['hubUnreadCount', user.email] });
      }).catch(() => {});
    };

    tryMark();

    const onVisibilityChange = () => { if (document.visibilityState === 'visible') tryMark(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [conversation?.id, user?.email, messages.length, queryClient]);

  // ── Read receipt fade (4 s after read_at appears) ─────────────────────────
  // Identify the last OWN message by id (not by index). The render maps over
  // `visibleMessages` (control/poll-vote rows filtered out, plus search), so
  // an index computed over the full `messages` array pointed at the wrong row
  // whenever the two lists diverged — the "Read" receipt could attach to a
  // hidden control row or shift onto the wrong bubble. Comparing ids in the
  // render is mismatch-proof. We derive the receipt target from the rendered
  // list so it always lands on a bubble the user can actually see.
  const lastSentMsg = (() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].sender_email?.toLowerCase() === myEmailLc) return visibleMessages[i];
    }
    return null;
  })();
  const lastSentMsgId = lastSentMsg?.id ?? null;

  useEffect(() => {
    if (lastSentMsg?.read_at && !readReceiptFaded) {
      const t = setTimeout(() => setReadReceiptFaded(true), 4000);
      return () => clearTimeout(t);
    }
  }, [lastSentMsg?.read_at, readReceiptFaded]);

  // Reset fade state when conversation changes
  useEffect(() => { setReadReceiptFaded(false); }, [conversation?.id]);
  // Also reset when the most-recent sent message id changes — otherwise
  // the 4s fade hid the read receipt permanently after the first sight,
  // and any new message the user sent afterwards never showed its own
  // "Read" indicator even when the recipient marked it read. (Audit 10 #77.)
  useEffect(() => { setReadReceiptFaded(false); }, [lastSentMsg?.id]);

  // ── Scroll management ─────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
    if (stickToBottomRef.current) setNewMsgCount(0);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (smooth && 'scrollTo' in el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useLayoutEffect(() => {
    scrollToBottom(false);
    stickToBottomRef.current = true;
  }, [conversation?.id]);

  // Drive auto-scroll / new-message pill off the LAST message's identity, not
  // the list length. Prepending older history grows the length but does NOT
  // change the bottom row — keying on length would fire the "N new" pill (and
  // a scroll-to-bottom when stuck) for messages the user deliberately paged
  // UP to see. The last id only changes when a genuinely new row appends.
  const lastMsgId = messages.length ? messages[messages.length - 1].id : null;
  const prevLastMsgIdRef = useRef(null);
  useEffect(() => {
    if (lastMsgId === prevLastMsgIdRef.current) return; // prepend or no-op
    const isFirstPaint = prevLastMsgIdRef.current === null;
    prevLastMsgIdRef.current = lastMsgId;
    if (isFirstPaint) return; // initial load handled by the layout effect
    if (stickToBottomRef.current) {
      scrollToBottom(true);
      setNewMsgCount(0);
    } else {
      setNewMsgCount(c => c + 1);
    }
  }, [lastMsgId, scrollToBottom]);

  // Reset the bottom-row tracker on conversation switch so the first paint of
  // the next thread doesn't read as a new-message append.
  useEffect(() => { prevLastMsgIdRef.current = null; }, [conversation?.id]);

  // ── Textarea auto-resize ──────────────────────────────────────────────────
  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }, []);
  useEffect(() => { resizeTextarea(); }, [draft, resizeTextarea]);

  // ── Attachment handling ───────────────────────────────────────────────────
  const clearAttachment = useCallback(() => {
    if (attachmentPreview) { try { URL.revokeObjectURL(attachmentPreview); } catch { /* already revoked */ } }
    setAttachmentFile(null);
    setAttachmentPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [attachmentPreview]);

  const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

  const handleFilePick = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(tFallback('hub.chat.attachmentTooLarge', 'Image must be 50 MB or smaller'));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (attachmentPreview) { try { URL.revokeObjectURL(attachmentPreview); } catch { /* already revoked */ } }
    setAttachmentFile(file);
    setAttachmentPreview(URL.createObjectURL(file));
  }, [attachmentPreview]);

  // ── Image paste from clipboard ────────────────────────────────────────────
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > MAX_ATTACHMENT_BYTES) {
          toast.error(tFallback('hub.chat.attachmentTooLarge', 'Image must be 50 MB or smaller'));
          return;
        }
        if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
        setAttachmentFile(file);
        setAttachmentPreview(URL.createObjectURL(file));
        return;
      }
    }
  }, [attachmentPreview]);

  // ── Typing broadcast (throttled 2 s) ─────────────────────────────────────
  const handleDraftChange = useCallback((e) => {
    setDraft(e.target.value);
    const now = Date.now();
    if (channelRef.current && now - lastTypingBroadcastRef.current > 2000) {
      lastTypingBroadcastRef.current = now;
      channelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: { user_id: user?.id, timestamp: now },
      }).catch(() => {});
    }
  }, [user?.id]);

  // ── Double-tap fire — defined placeholder here, real impl after handleEmojiReact ──
  const handleMessageTapRef = useRef(null);

  // ── Long-press for context menu ───────────────────────────────────────────
  // Move tolerance: cancel only if finger moves > 8 px from start position.
  // Fixes "must hold precisely on bubble" — slight finger drift no longer
  // cancels, matching iOS Messages behavior.
  const lpStartPos = useRef(null);
  const startLongPress = useCallback((msg, e) => {
    const touch = e?.touches?.[0] || e;
    lpStartPos.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    longPressRef.current = setTimeout(() => {
      triggerHaptic('primary');
      setContextMsg(msg);
    }, 480);
  }, []);
  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    lpStartPos.current = null;
  }, []);
  const moveLongPress = useCallback((e) => {
    if (!lpStartPos.current || !longPressRef.current) return;
    const touch = e?.touches?.[0] || e;
    if (!touch) return;
    const dx = touch.clientX - lpStartPos.current.x;
    const dy = touch.clientY - lpStartPos.current.y;
    // Only cancel if finger has drifted more than 8 px in any direction
    if (Math.sqrt(dx * dx + dy * dy) > 8) cancelLongPress();
  }, [cancelLongPress]);

  // ── Pin toggle ────────────────────────────────────────────────────────────
  const isPinned = useCallback((msg) => {
    if (!msg) return false;
    const pending = pinOverride[msg.id];
    return pending === undefined ? !!msg.is_pinned : pending;
  }, [pinOverride]);

  // Retire an override the moment the server row carries the same value.
  // Keyed on a value string rather than the `messages` array, which is a
  // fresh reference on every render (dedupeMessages), so this runs only
  // when a pin state actually changed.
  const pinSignature = messages.map(m => `${m.id}:${m.is_pinned ? 1 : 0}`).join(',');
  useEffect(() => {
    setPinOverride(prev => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      const serverValue = new Map(
        pinSignature.split(',').filter(Boolean).map(pair => {
          const idx = pair.lastIndexOf(':');
          return [pair.slice(0, idx), pair.slice(idx + 1) === '1'];
        })
      );
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        if (serverValue.has(id) && serverValue.get(id) === next[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [pinSignature]);

  // Drop every override on conversation switch — they key on message ids
  // from the thread being left.
  useEffect(() => { setPinOverride({}); }, [conversation?.id]);

  const handlePinToggle = useCallback(async (msg) => {
    setContextMsg(null);
    const id = msg.id;
    if (!id || String(id).startsWith('temp-')) return;
    const wasPinned = isPinned(msg);
    setPinOverride(prev => ({ ...prev, [id]: !wasPinned }));
    try {
      // The RPC returns the new value — trust it over a local guess, since
      // a concurrent toggle from another device makes them disagree.
      const nowPinned = await hubMessages.togglePinDmMessage(id);
      setPinOverride(prev => ({ ...prev, [id]: !!nowPinned }));
      queryClient.invalidateQueries({ queryKey: ['hubChat', conversation?.id] });
      // Confirmation toast so the user has a clear signal the pin landed
      // — previously the only feedback was the small pin icon on the
      // bubble, which beta testers were missing entirely and assumed they
      // had to manually exit + refresh.
      toast.success(nowPinned
        ? tFallback('hub.chat.pinned', 'Pinned to the conversation')
        : tFallback('hub.chat.unpinned', 'Unpinned'));
    } catch {
      // Roll the override back to what the server last told us, then
      // resync in case the failure was a transient that landed anyway.
      setPinOverride(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['hubChat', conversation?.id] });
      toast.error(tFallback('hub.chat.pinError', 'Could not pin message. Try again.'));
    }
  }, [conversation?.id, queryClient, tFallback, isPinned]);

  // ── Rich-media sends (stickers / GIFs / voice — mig 115) ────────────────
  // Each shares the existing sendMessage path; only message_type and the
  // companion fields (sticker_id / attachment_url / duration_ms) vary.
  // No optimistic UI to keep this contained — the message appears on
  // next refetch (already 5s polling).
  const handleSendSticker = useCallback(async (stickerId) => {
    if (!stickerId || !conversation?.id) return;
    if (blockPendingSend()) return;
    try {
      await hubMessages.sendMessage({
        conversationId: conversation.id,
        senderEmail:    user?.email || '',
        recipientEmail: otherUser?.email || null,
        body:           '',
        messageType:    'sticker',
        stickerId,
      });
      queryClient.invalidateQueries({ queryKey: ['hubChat', conversation.id] });
    } catch (err) {
      toast.error(`Could not send sticker: ${err?.message || 'try again'}`);
    }
  }, [conversation?.id, user?.email, otherUser?.email, queryClient, blockPendingSend]);

  const handleSendGif = useCallback(async ({ url, alt }) => {
    if (!url || !conversation?.id) return;
    if (blockPendingSend()) return;
    try {
      await hubMessages.sendMessage({
        conversationId: conversation.id,
        senderEmail:    user?.email || '',
        recipientEmail: otherUser?.email || null,
        body:           '',
        attachmentUrl:  url,
        messageType:    'gif',
      });
      queryClient.invalidateQueries({ queryKey: ['hubChat', conversation.id] });
    } catch (err) {
      toast.error(`Could not send GIF: ${err?.message || 'try again'}`);
    }
  }, [conversation?.id, user?.email, otherUser?.email, queryClient, blockPendingSend]);

  const handleSendVoice = useCallback(async ({ blob, durationMs }) => {
    if (!blob || !conversation?.id) return;
    // Guard BEFORE the upload — an ungated attempt would orphan the blob.
    if (blockPendingSend()) return;
    try {
      // Upload via the existing Core.UploadFile (same path image
      // attachments take in handleSend above).
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
      const upload = await db.integrations.Core.UploadFile({ file });
      const url = upload?.file_url;
      if (!url) throw new Error('upload failed');
      await hubMessages.sendMessage({
        conversationId: conversation.id,
        senderEmail:    user?.email || '',
        recipientEmail: otherUser?.email || null,
        body:           '',
        attachmentUrl:  url,
        messageType:    'voice',
        durationMs,
      });
      queryClient.invalidateQueries({ queryKey: ['hubChat', conversation.id] });
    } catch (err) {
      toast.error(`Could not send voice memo: ${err?.message || 'try again'}`);
    }
  }, [conversation?.id, user?.email, otherUser?.email, queryClient, blockPendingSend]);

  // ── Polls ───────────────────────────────────────────────────────────────
  // A poll is a [POLL_V1] message; votes are [POLL_VOTE_V1] control messages
  // that reference the poll's id. Both ride the normal sendMessage path — no
  // migration. Tally is computed client-side from the vote messages.
  const handleSendPoll = useCallback(async ({ question, options }) => {
    if (!conversation?.id) return;
    if (blockPendingSend()) return;
    const body = buildPollBody({ question, options });
    if (!body) return;
    setPollComposerOpen(false);
    try {
      await hubMessages.sendMessage({
        conversationId: conversation.id,
        senderEmail:    user?.email || '',
        recipientEmail: otherUser?.email || null,
        body,
      });
      queryClient.invalidateQueries({ queryKey: ['hubChat', conversation.id] });
    } catch (err) {
      toast.error(`Could not create poll: ${err?.message || 'try again'}`);
    }
  }, [conversation?.id, user?.email, otherUser?.email, queryClient, blockPendingSend]);

  const handleVotePoll = useCallback(async (pollId, optionIndex) => {
    if (!conversation?.id || !pollId) return;
    // A vote is a [POLL_VOTE_V1] control message — still a hub_messages
    // row, so still subject to the pending-request cap.
    if (blockPendingSend()) return;
    try {
      await hubMessages.sendMessage({
        conversationId: conversation.id,
        senderEmail:    user?.email || '',
        recipientEmail: otherUser?.email || null,
        body:           buildVoteBody(pollId, optionIndex),
      });
      queryClient.invalidateQueries({ queryKey: ['hubChat', conversation.id] });
    } catch (err) {
      toast.error(`Could not record vote: ${err?.message || 'try again'}`);
    }
  }, [conversation?.id, user?.email, otherUser?.email, queryClient, blockPendingSend]);

  // ── Scheduled send (mig 114) ────────────────────────────────────────────
  // Currently-pending scheduled messages for this conversation. Refetch
  // on send and on schedule.
  const { data: scheduledHere = [] } = useQuery({
    queryKey: ['hubChatScheduled', conversation?.id, user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const all = await listMyScheduled(user.id);
      return all.filter(m => m.conversation_id === conversation?.id);
    },
    enabled: !!user?.id && !!conversation?.id,
    refetchInterval: 30_000,
  });

  const handleSchedule = useCallback(async () => {
    if (!draft.trim()) return;
    if (!scheduleAt) { toast.error('Pick a date and time.'); return; }
    const sendAt = new Date(scheduleAt);
    if (Number.isNaN(sendAt.getTime()) || sendAt <= new Date()) {
      toast.error('Pick a future date.');
      return;
    }
    try {
      await scheduleMyMessage({
        conversationId:  conversation.id,
        recipientEmail:  otherUser?.email || null,
        content:         draft.trim(),
        sendAt,
      });
      setDraft('');
      setScheduleAt('');
      setScheduleOpen(false);
      queryClient.invalidateQueries({ queryKey: ['hubChatScheduled', conversation.id, user?.id] });
      toast.success(`Scheduled for ${sendAt.toLocaleString()}`);
    } catch (err) {
      toast.error(`Could not schedule: ${err?.message || 'try again'}`);
    }
  }, [draft, scheduleAt, conversation?.id, otherUser?.email, queryClient, user?.id]);

  const handleCancelScheduled = useCallback(async (id) => {
    try {
      await cancelMyScheduledMessage(id);
      queryClient.invalidateQueries({ queryKey: ['hubChatScheduled', conversation?.id, user?.id] });
      toast.success('Scheduled message cancelled.');
    } catch (err) {
      toast.error(`Could not cancel: ${err?.message || 'try again'}`);
    }
  }, [conversation?.id, queryClient, user?.id]);

  // ── Sender-side message deletion (mig 114) ───────────────────────────────
  // Soft-delete via the delete_my_message RPC. Optimistic — flag the
  // local row immediately so the bubble swaps to "This message was
  // deleted" without waiting for the round-trip. Rollback on error.
  const handleDeleteMessage = useCallback(async (msg) => {
    setContextMsg(null);
    if (!msg?.id || msg.sender_email?.toLowerCase() !== myEmailLc) return;
    const prev = msg.deleted_at;
    queryClient.setQueryData(['hubChat', conversation?.id], (rows) =>
      (rows || []).map(r => r.id === msg.id ? { ...r, deleted_at: new Date().toISOString() } : r)
    );
    try {
      await deleteMyMessage(msg.id);
      toast.success('Message deleted.');
    } catch (err) {
      queryClient.setQueryData(['hubChat', conversation?.id], (rows) =>
        (rows || []).map(r => r.id === msg.id ? { ...r, deleted_at: prev || null } : r)
      );
      toast.error(`Could not delete: ${err?.message || 'try again'}`);
    }
  }, [conversation?.id, myEmailLc, queryClient]);

  // ── Emoji reaction ────────────────────────────────────────────────────────
  const handleEmojiReact = useCallback(async (msg, emoji) => {
    setContextMsg(null);
    if (!msg?.id || !user?.id || String(msg.id).startsWith('temp-')) return;
    // Optimistic toggle
    setReactions(prev => {
      const arr = prev[msg.id] || [];
      const exists = arr.some(r => r.user_id === user.id && r.emoji === emoji);
      const next = exists
        ? arr.filter(r => !(r.user_id === user.id && r.emoji === emoji))
        : [...arr, { user_id: user.id, emoji }];
      return { ...prev, [msg.id]: next };
    });
    try {
      await dmRxns.toggleReaction(msg.id, user.id, emoji);
    } catch {
      // Revert optimistic on failure
      dmRxns.getReactionsForMessages([msg.id]).then(map => {
        setReactions(prev => ({ ...prev, [msg.id]: map[msg.id] || [] }));
      }).catch(() => {});
    }
  }, [user?.id]);

  // ── Double-tap fire — real impl (must be AFTER handleEmojiReact to avoid TDZ) ──
  const handleMessageTap = useCallback((msg) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last.id === msg.id && now - last.time < 320) {
      lastTapRef.current = { id: null, time: 0 };
      handleEmojiReact(msg, '🔥');
      const floatId = `${msg.id}-${now}`;
      setFloatingFires(f => [...f, { id: floatId, msgId: msg.id }]);
      setTimeout(() => setFloatingFires(f => f.filter(x => x.id !== floatId)), 900);
    } else {
      lastTapRef.current = { id: msg.id, time: now };
    }
  }, [handleEmojiReact]);
  handleMessageTapRef.current = handleMessageTap;

  // ── Inline reply ──────────────────────────────────────────────────────────
  const handleReply = useCallback((msg) => {
    setContextMsg(null);
    const snippet = (msg.body || msg.content || '').slice(0, 120);
    setReplyTo({ id: msg.id, snippet });
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  // ── Scroll-to-quoted message ──────────────────────────────────────────────
  const scrollToMessage = useCallback((msgId) => {
    const el = document.getElementById(`dm-msg-${msgId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Synchronous in-flight guard. `sending` state lags React, so two
  // rapid Enter keystrokes in the same microtask batch both see
  // sending=false → two HTTP inserts → dedupeMessages can't help
  // (it dedupes temp-vs-real, not real-vs-real with identical body).
  // Wave 57 (Messages audit) caught this. Pattern from CrewCreationFlow.
  const sendingRef = useRef(false);

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed && !attachmentFile) return;
    if (sending || uploading || sendingRef.current) return;
    if (!conversation?.id) { toast.error(t('hub.messages.sendError')); return; }
    if (blockPendingSend()) return;
    sendingRef.current = true;
    // Primary-action haptic — sending a DM is the most frequent
    // primary action in the messaging surface. The centralized util
    // honors the user's haptics-off setting + rate-limiting + the
    // reduced-motion preference.
    triggerHaptic('primary');

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic = {
      id: tempId,
      conversation_id: conversation.id,
      sender_email: user?.email || '',
      body: trimmed,
      content: trimmed,
      created_date: new Date().toISOString(),
      read_at: null,
      _optimistic: true,
      ...(replyTo ? { replied_to_message_id: replyTo.id, replied_to_snippet: replyTo.snippet } : {}),
      ...(attachmentPreview ? { attachment_url: attachmentPreview } : {}),
    };

    const queryKey = ['hubChat', conversation.id];
    const previous = queryClient.getQueryData(queryKey) || [];
    queryClient.setQueryData(queryKey, [...previous, optimistic]);

    setDraft('');
    const capturedReplyTo = replyTo;
    setReplyTo(null);
    stickToBottomRef.current = true;
    setSending(true);

    const fileToUpload = attachmentFile;
    clearAttachment();

    // Track the uploaded blob's storage path so we can clean it up if
    // the message insert fails downstream. Without this, every
    // upload-then-send-failed path leaked a file in Supabase Storage
    // forever (same orphan-cleanup pattern stories.js already has).
    let uploadedPath = null;
    let uploadedBucket = null;
    try {
      let attachmentUrl = null;
      let uploadFailed = false;
      if (fileToUpload) {
        setUploading(true);
        try {
          const compressed = await compressImage(fileToUpload);
          const result = await db.integrations.Core.UploadFile({ file: compressed });
          attachmentUrl = result?.file_url || null;
          uploadedPath = result?.path || null;
          uploadedBucket = result?.bucket || 'uploads';
          if (!attachmentUrl) uploadFailed = true;
        } catch (uploadErr) {
          console.error('[HubChat] upload threw:', uploadErr);
          uploadFailed = true;
        } finally {
          setUploading(false);
        }
      }

      if (uploadFailed && !trimmed) {
        queryClient.setQueryData(queryKey, (rows) => (rows || []).filter(r => r.id !== tempId));
        toast.error(tFallback("hubChat.imageUploadFailedTryAgain", "Image upload failed — try again"));
        return;
      }
      if (uploadFailed) toast.error(tFallback("hubChat.imageUploadFailedMessageSent", "Image upload failed — message sent without attachment"));

      const sent = await hubMessages.sendMessage({
        conversationId: conversation.id,
        senderEmail: user.email || '',
        recipientEmail: otherEmail,
        body: trimmed,
        ...(attachmentUrl ? { attachmentUrl } : {}),
        ...(capturedReplyTo ? {
          repliedToMessageId: capturedReplyTo.id,
          repliedToSnippet: capturedReplyTo.snippet,
        } : {}),
      });
      if (!sent) {
        queryClient.setQueryData(queryKey, (rows) => (rows || []).filter(r => r.id !== tempId));
        setDraft(trimmed);
        toast.error(t('hub.messages.sendError'));
        // Orphan cleanup: the blob landed but the message didn't, so
        // there's no DB reference to ever reach it again. Best-effort
        // remove; failure here is logged but non-fatal.
        if (uploadedPath) {
          supabase.storage.from(uploadedBucket).remove([uploadedPath])
            .catch(err => console.warn('[HubChat] orphan-upload cleanup failed:', err));
        }
        return;
      }
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['hubConversations'] });
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      setDraft(trimmed);
      // Same orphan cleanup path on a thrown sendMessage.
      if (uploadedPath) {
        supabase.storage.from(uploadedBucket).remove([uploadedPath])
          .catch(cleanupErr => console.warn('[HubChat] orphan-upload cleanup failed:', cleanupErr));
      }
      console.error('[HubChat] sendMessage threw:', err);
      // Surface specific errors from mig 157 (profanity trigger) and
      // mig 159 (block trigger) so the user knows WHY their message
      // didn't go. Without this they hit a generic "send failed" toast
      // and retry into the same wall in a frustration loop. Wave 57
      // (Messages audit) caught this.
      const msg = `${err?.message || ''} ${err?.hint || ''}`;
      if (/message_profanity/i.test(msg) || err?.code === '23514') {
        toast.error('Message contains prohibited content. Edit it and try again.');
      } else if (
        err?.code === '42501'
        // Passing 1 asks "is this thread still a pending request for me?"
        // — the count argument is the only thing separating "allowed one
        // more" from "already used it". A 42501 on a pending thread is
        // mig 234's send cap, not a block.
        && isPendingRequestSendBlocked(conversation, user?.email, 1)
      ) {
        toast.error(tFallback(
          'hub.messages.request.waitToSend',
          'Message request sent. You can send more once they accept.'
        ));
      } else if (/dm_blocked/i.test(msg) || err?.code === '42501') {
        toast.error("You can't send messages to this user.");
      } else {
        toast.error(t('hub.messages.sendError'));
      }
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };

  // ── Reaction group display ────────────────────────────────────────────────
  const getReactionGroups = (msgId) => {
    const rxns = reactions[msgId] || [];
    const groups = {};
    for (const r of rxns) {
      if (!groups[r.emoji]) groups[r.emoji] = { count: 0, myReacted: false };
      groups[r.emoji].count++;
      if (r.user_id === user?.id) groups[r.emoji].myReacted = true;
    }
    return Object.entries(groups).map(([emoji, g]) => ({ emoji, ...g }));
  };

  return (
    <div className="flex flex-col relative h-full" style={{ minHeight: 360 }}>
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border mb-3 shrink-0">
        <button
          onClick={onBack}
          aria-label={tFallback('hub.backToHub', 'Back')}
          className="p-1.5 rounded-md hover:bg-secondary active:bg-secondary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-heading font-bold text-primary text-sm overflow-hidden shrink-0">
          {isGroup ? (
            // Group avatar: stack of initials. With real avatars per
            // participant we'd composite three small circles, but
            // initials inside a single tile is simpler and still reads
            // as "group" because of the count label below.
            <span className="text-xs">{(conversation?.title || 'Group').slice(0, 2).toUpperCase()}</span>
          ) : otherAvatarUrl
            ? <img loading="lazy" src={otherAvatarUrl} alt={`${otherHandle} avatar`} className="w-full h-full object-cover" />
            : otherInitials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading font-bold text-sm truncate">
            {isGroup
              ? (conversation?.title || 'Group chat')
              : otherHandle}
          </p>
          <p className="text-micro text-muted-foreground flex items-center gap-1">
            {isGroup
              ? <>{(conversation?.participant_emails?.length || 0)} people · group chat</>
              : <><Lock className="w-2.5 h-2.5" /> {t('hub.messages.privateNote.short')}</>}
          </p>
        </div>
        {/* Search this thread — opens an inline filter pill. Closing
            the search clears the query so the next open starts fresh. */}
        <button
          onClick={() => { setSearchOpen(v => { if (v) setSearchQuery(''); return !v; }); }}
          aria-label={tFallback("hubChat.searchThisConversation", "Search this conversation")}
          className={`p-1.5 rounded-md transition-colors ${searchOpen ? 'bg-primary/15 text-primary' : 'hover:bg-secondary active:bg-secondary'}`}
        >
          <Search className="w-4 h-4" />
        </button>
        <button
          onClick={() => setPinnedOpen(v => !v)}
          aria-label={tFallback("hubChat.pinnedMessages", "Pinned messages")}
          className={`p-1.5 rounded-md transition-colors text-base leading-none ${pinnedOpen ? 'bg-primary/15' : 'hover:bg-secondary active:bg-secondary'}`}
        >
          📌
        </button>
      </div>

      {/* Message Request banner — shows when the viewer is a participant
          but hasn't accepted yet. Tap Accept to move the conversation
          from Requests to the main inbox. Sending a reply implicitly
          accepts too (via mig 113's trg_auto_accept_on_send). */}
      {(() => {
        const accepted = Array.isArray(conversation?.accepted_emails) ? conversation.accepted_emails : [];
        const myLc = String(user?.email || '').toLowerCase();
        const acceptedByMe = accepted.some(e => String(e).toLowerCase() === myLc);
        if (acceptedByMe || !conversation?.id) return null;
        return (
          <div className="mb-2 shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-primary uppercase tracking-wide">{tFallback("hubChat.messageRequest", "Message request")}</p>
              <p className="text-micro text-muted-foreground">Accept to move this conversation to your inbox.</p>
            </div>
            <button
              onClick={async () => {
                try {
                  await acceptConversation(conversation.id);
                  queryClient.invalidateQueries({ queryKey: ['hubConversations', user?.email] });
                } catch { /* swallow — silent retry on send */ }
              }}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-bold"
            >
              Accept
            </button>
          </div>
        );
      })()}

      {/* Inline search pill — only mounts when the toolbar button toggles it. */}
      {searchOpen && (
        <div className="mb-2 shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/40 border border-border">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tFallback("hubChat.searchThisConversation2", "Search this conversation…")}
            className="flex-1 bg-transparent text-sm outline-none placeholder-muted-foreground/60"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-foreground active:text-foreground" aria-label={tFallback("implement.clear", "Clear")}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Pinned messages panel */}
      {pinnedOpen && (() => {
        const pinned = messages.filter(m => isPinned(m));
        return (
          <div className="mb-2 shrink-0 rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/20">
              <span className="text-sm">📌</span>
              <span className="text-xs font-bold text-primary uppercase tracking-wide">{tFallback("hubChat.pinnedMessages2", "Pinned Messages")}</span>
              <span className="ms-auto text-xs text-muted-foreground">{pinned.length}</span>
            </div>
            {pinned.length === 0 ? (
              <p className="text-xs text-muted-foreground px-3 py-2">No pinned messages yet.</p>
            ) : (
              <div className="max-h-40 overflow-y-auto">
                {pinned.map(m => (
                  <button key={m.id} type="button"
                    onClick={() => { scrollToMessage(m.id); setPinnedOpen(false); }}
                    className="w-full text-start px-3 py-2 text-xs hover:bg-secondary/40 active:bg-secondary/40 transition-colors border-b border-border/50 last:border-0">
                    <p className="text-muted-foreground truncate">{m.body || m.content || '(media)'}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Messages */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        // overflow-x-hidden is load-bearing, not belt-and-braces. Setting
        // ONLY overflow-y-auto leaves the x-axis computing to `auto` (CSS
        // Overflow 3 §3: a non-visible value on one axis forces the other from
        // `visible` to `auto`), so any child wider than the column — a long
        // unbroken URL, a wide attachment, the pinned bar — gave the whole
        // thread a horizontal scrollbar on desktop. That scrollbar then sat
        // over the pinned-messages affordance and hid it.
        //
        // scrollbar-hide kills the visible track. The thread is a chat log;
        // its scroll position is obvious from the content and the bar was
        // pure chrome over the conversation.
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pe-1 scrollbar-hide"
      >
        {searchOpen && searchQuery.trim() && (
          <p className="text-micro text-muted-foreground text-center mb-2 tabular-nums">
            {totalMatches === 0
              ? 'No matches'
              : `${totalMatches} match${totalMatches === 1 ? '' : 'es'} in ${visibleMessages.length} message${visibleMessages.length === 1 ? '' : 's'}`}
          </p>
        )}
        {/* Load earlier history — only when the initial window came back full
            (older messages likely exist) and we're not filtering a search.
            Prepends a cursor page while preserving the scroll anchor. */}
        {canLoadOlder && !(searchOpen && searchQuery.trim()) && visibleMessages.length > 0 && (
          <div className="flex justify-center my-2">
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={loadingOlder}
              className="px-3 py-1.5 rounded-full bg-secondary/60 border border-border text-micro font-semibold text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors disabled:opacity-60"
            >
              {loadingOlder
                ? tFallback('hub.chat.loadingEarlier', 'Loading…')
                : tFallback('hub.chat.loadEarlier', 'Load earlier messages')}
            </button>
          </div>
        )}
        {visibleMessages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-center text-sm text-muted-foreground">
              {searchOpen && searchQuery.trim()
                ? 'No messages match.'
                : t('hub.chat.empty')}
            </p>
          </div>
        ) : (
          visibleMessages.map((m, i) => {
            const isMine = m.sender_email?.toLowerCase() === myEmailLc;
            const isLastSent = isMine && m.id === lastSentMsgId;
            const showDivider = shouldShowDivider(visibleMessages, i);
            const isOptimistic = !!m._optimistic;
            // Image / GIF / video with no caption → render the media bare,
            // without the chat bubble's padding and colored fill (that fill
            // read as a thick frame around the picture). Declared here, before
            // the JSX that reads it, per the TDZ rule in CLAUDE.md.
            const mediaOnly =
              ['image', 'gif', 'video'].includes(m.message_type) &&
              !!m.attachment_url &&
              !(m.body || m.content || '').trim() &&
              !m.deleted_at;
            const ts = msgTime(m);
            // Reciprocity (mig 238): a viewer who turned read receipts
            // off doesn't get to see other people's read state either,
            // so the "Read · 5m" line collapses back to "Sent".
            const isRead = !!m.read_at && readReceiptsEnabled;
            const rxnGroups = getReactionGroups(m.id);
            return (
              <div
                key={m.id}
                id={`dm-msg-${m.id}`}
                // Anchor for the one-shot double-tap hint. The LAST message,
                // not the first — the thread is scrolled to the bottom, so
                // anchoring to the oldest would point the tooltip off screen.
                ref={i === visibleMessages.length - 1 ? lastMsgRef : undefined}
              >
                {showDivider && ts && (
                  <div className="flex justify-center my-4">
                    <span className="text-micro text-muted-foreground">{formatDivider(ts)}</span>
                  </div>
                )}
                {(() => {
                  const body = m.body || m.content || '';
                  const duelInvitePayload = parseDuelInvite(body);
                  if (duelInvitePayload) {
                    return (
                      <motion.div
                        key={m.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 8) * 0.02 }}
                        className={`flex mb-0.5 ${isMine ? 'justify-end' : 'justify-start'}`}
                      >
                        <DuelInviteCard payload={duelInvitePayload} isMine={isMine} />
                      </motion.div>
                    );
                  }
                  const crewInvitePayload = parseCrewInvite(body);
                  if (crewInvitePayload) {
                    return (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 8) * 0.02 }}
                        className={`flex mb-0.5 ${isMine ? 'justify-end' : 'justify-start'}`}
                      >
                        <CrewDMInviteCard payload={crewInvitePayload} userId={user?.id} isMine={isMine} />
                      </motion.div>
                    );
                  }
                  const tradePayload = parseTradeOffer(body);
                  if (tradePayload) {
                    return (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 8) * 0.02 }}
                        className={`flex mb-0.5 ${isMine ? 'justify-end' : 'justify-start'} ${isOptimistic ? 'opacity-70' : ''}`}
                      >
                        <TradeOfferCard
                          payload={tradePayload}
                          isMine={isMine}
                          user={user}
                          conversationId={conversation?.id}
                          conversationMessages={messages}
                        />
                      </motion.div>
                    );
                  }

                  const floatingFire = floatingFires.find(f => f.msgId === m.id);
                  const msgIsPinned = isPinned(m);

                  return (
                    <SwipeableDmMessage
                      key={`swipe-${m.id}`}
                      isMine={isMine}
                      isOptimistic={isOptimistic}
                      onDelete={() => handleDeleteMessage(m)}
                    >
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i, 8) * 0.02 }}
                      className={`flex mb-0.5 relative ${isMine ? 'justify-end' : 'justify-start'}`}
                    >
                      {floatingFire && (
                        <motion.span
                          key={floatingFire.id}
                          initial={{ opacity: 1, y: 0, scale: 1 }}
                          animate={{ opacity: 0, y: -40, scale: 1.4 }}
                          transition={{ duration: 0.85, ease: 'easeOut' }}
                          className="absolute -top-2 pointer-events-none z-10 text-base select-none"
                          style={isMine ? { left: 0 } : { right: 0 }}
                        >
                          🔥
                        </motion.span>
                      )}
                      <div className={`relative flex flex-col w-full min-w-0 ${isMine ? 'items-end' : 'items-start'}`}>
                        {/* Reply quote block */}
                        {/* Sender name — only in groups, only above
                            the other person's messages, only at the
                            start of a run (current sender different
                            from previous). */}
                        {isGroup && !isMine && (() => {
                          const prev = visibleMessages[i - 1];
                          const sameSenderAsPrev = prev?.sender_email?.toLowerCase() === m.sender_email?.toLowerCase();
                          if (sameSenderAsPrev) return null;
                          // Was the literal string 'Athlete', so every member
                          // of a group read as "@Athlete" and there was no way
                          // to tell who said what. Resolve by sender user_id.
                          const senderName = participantsById[m.user_id]?.username;
                          return (
                            <p className="text-micro font-bold text-muted-foreground mb-0.5 px-1">
                              {senderName ? `@${senderName}` : t('hub.profile.anonymousAthlete')}
                            </p>
                          );
                        })()}
                        {m.replied_to_snippet && (
                          <button
                            type="button"
                            onClick={() => m.replied_to_message_id && scrollToMessage(m.replied_to_message_id)}
                            className={`max-w-[75%] mb-0.5 px-2.5 py-1.5 rounded-xl border-s-2 border-primary bg-secondary/40 text-start text-xs text-muted-foreground line-clamp-2 cursor-pointer hover:bg-secondary/60 active:bg-secondary/60 transition-colors`}
                          >
                            {m.replied_to_snippet}
                          </button>
                        )}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => !isOptimistic && handleMessageTapRef.current?.(m)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleMessageTapRef.current?.(m); }}
                          onMouseDown={(e) => !isOptimistic && startLongPress(m, e)}
                          onMouseUp={cancelLongPress}
                          onMouseLeave={cancelLongPress}
                          onTouchStart={(e) => !isOptimistic && startLongPress(m, e)}
                          onTouchEnd={cancelLongPress}
                          onTouchMove={moveLongPress}
                          className={`max-w-[75%] rounded-2xl text-sm transition-opacity cursor-pointer select-none-ui ${
                            // A media-only message (image / GIF / video, no
                            // caption) renders bare — the bubble's padding +
                            // colored fill was showing up as a thick frame
                            // around the picture. With a caption we keep the
                            // bubble so the text still has its backdrop.
                            mediaOnly
                              ? 'p-0 bg-transparent overflow-hidden'
                              : `px-3 py-2 ${isMine
                                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                                  : 'bg-secondary text-foreground rounded-bl-sm'}`
                          } ${isOptimistic ? 'opacity-70' : 'opacity-100'}`}
                          style={{ wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'pre-wrap' }}
                        >
                          {(() => {
                            // Soft-deleted by sender → swap the body for a
                            // muted "This message was deleted" pill so the
                            // recipient sees that something used to be here
                            // (iMessage / IG pattern).
                            if (m.deleted_at) {
                              return <span className="italic opacity-70">{tFallback("hubChat.thisMessageWasDeleted", "This message was deleted")}</span>;
                            }
                            // Sticker message (mig 115) — render the emoji
                            // glyph from the loot catalog at large size with
                            // no chat-bubble background. The outer bubble
                            // styling is overridden below; here we just
                            // produce the glyph.
                            if (m.message_type === 'sticker' && m.sticker_id) {
                              const meta = LOOT_ITEMS.find(it => it.id === m.sticker_id);
                              return <span className="text-5xl leading-none">{meta?.emoji || '✨'}</span>;
                            }
                            const raw = m.body || m.content || '';
                            const poll = parsePoll(raw);
                            if (poll) {
                              const results = pollResults(voteIndex.get(m.id), poll.options.length, user?.email);
                              return (
                                <PollBubble
                                  poll={poll}
                                  results={results}
                                  onVote={(idx) => handleVotePoll(m.id, idx)}
                                  disabled={isOptimistic}
                                  tFallback={tFallback}
                                />
                              );
                            }
                            if (parseTradeResponse(raw)) {
                              const newline = raw.indexOf('\n');
                              const visible = newline >= 0 ? raw.slice(newline + 1) : '';
                              return visible ? renderBodyWithHighlights(visible, searchOpen ? searchQuery : '') : null;
                            }
                            return raw ? renderBodyWithHighlights(raw, searchOpen ? searchQuery : '') : null;
                          })()}
                          {/* Voice memo — render an inline audio player
                              with duration. Native controls are mobile-
                              friendly and don't need a custom skin. */}
                          {m.message_type === 'voice' && m.attachment_url && (
                            <div className={`flex items-center gap-2 ${(m.body || m.content) ? 'mt-1.5' : ''}`}>
                              <audio src={m.attachment_url} controls className="max-w-[220px]" preload="metadata" />
                              {Number.isFinite(m.duration_ms) && (
                                <span className="text-micro tabular-nums opacity-80">
                                  {formatVoiceDuration(m.duration_ms)}
                                </span>
                              )}
                            </div>
                          )}
                          {/* GIF — same shape as a regular image attachment
                              but tagged so future analytics can split them
                              from photos. */}
                          {m.message_type === 'gif' && m.attachment_url && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); window.open(m.attachment_url, '_blank', 'noopener,noreferrer'); }}
                              aria-label={tFallback("hubChat.openGifInNewTab", "Open GIF in new tab")}
                              className={`block rounded-lg overflow-hidden focus:outline-none ${(m.body || m.content) ? 'mt-1.5' : ''}`}
                            >
                              <img loading="lazy" src={m.attachment_url} alt="GIF" className="rounded-lg max-h-64 object-cover max-w-full" />
                            </button>
                          )}
                          {/* Fallback image attachment (text + photo) */}
                          {m.message_type !== 'voice' && m.message_type !== 'gif' && m.attachment_url && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); window.open(m.attachment_url, '_blank', 'noopener,noreferrer'); }}
                              aria-label={tFallback("hubChat.openAttachmentInNewTab", "Open attachment in new tab")}
                              className={`block rounded-lg overflow-hidden focus:outline-none ${(m.body || m.content) ? 'mt-1.5' : ''}`}
                            >
                              <img loading="lazy" src={m.attachment_url} alt={tFallback("hubChat.messageAttachment", "Message attachment")} className="rounded-lg max-h-64 object-cover max-w-full" />
                            </button>
                          )}
                        </div>

                        {/* Emoji reaction bubbles below message */}
                        {rxnGroups.length > 0 && (
                          <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                            {rxnGroups.map(({ emoji, count, myReacted }) => (
                              <button
                                key={emoji}
                                onClick={() => !isOptimistic && handleEmojiReact(m, emoji)}
                                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                                  myReacted
                                    ? 'bg-primary/20 border-primary/40 text-foreground'
                                    : 'bg-secondary border-border text-muted-foreground hover:bg-secondary/70 active:bg-secondary/70'
                                }`}
                              >
                                <span>{emoji}</span>
                                {count > 1 && <span className="font-medium">{count}</span>}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Pin badge — inward-facing */}
                        {msgIsPinned && (
                          <span
                            className={`absolute -top-2 text-xs leading-none pointer-events-none select-none ${
                              isMine ? '-start-3' : '-end-3'
                            }`}
                            title={tFallback("hubChat.pinnedMessage", "Pinned message")}
                          >📌</span>
                        )}
                      </div>
                    </motion.div>
                    </SwipeableDmMessage>
                  );
                })()}

                {/* Read receipt — last sent message only */}
                {isLastSent && !isOptimistic && (
                  <div className="flex justify-end mb-2 pe-1">
                    {isRead && !readReceiptFaded ? (
                      <motion.span
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-micro text-primary font-medium transition-opacity duration-1000"
                      >
                        Read
                        {lastSentMsg?.read_at && (
                          <span className="text-muted-foreground font-normal">
                            {' · '}{formatRelativeShort(lastSentMsg.read_at) || 'just now'}
                          </span>
                        )}
                      </motion.span>
                    ) : !isRead ? (
                      <span className="text-micro text-muted-foreground">
                        Sent
                        {ts && <span> · {formatRelativeShort(ts)}</span>}
                      </span>
                    ) : null}
                  </div>
                )}
                {isLastSent && isOptimistic && (
                  <div className="flex justify-end mb-2 pe-1">
                    <span className="text-micro text-muted-foreground">Sending…</span>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Double-tap-to-react was registered in tooltipRegistry.js and never
            mounted, so the gesture shipped with nothing teaching it. Gated on
            there being a message to point at — OneShotTooltip fires once on
            mount and won't re-run when an anchor appears later, so mounting it
            against an empty thread would burn the one shot on nothing. */}
        {visibleMessages.length > 0 && (
          <OneShotTooltip id={TOOLTIP.DM_DOUBLE_TAP} anchorRef={lastMsgRef} placement="top">
            {tFallback('hub.chat.tooltip.doubleTap', 'Double-tap a message to react 🔥')}
          </OneShotTooltip>
        )}

        {/* Typing indicator bubble */}
        <AnimatePresence>
          {peerIsTyping && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.9 }}
              transition={{ duration: 0.18 }}
              className="flex justify-start mb-2"
            >
              <div className="bg-secondary rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Scroll-to-bottom pill */}
      <AnimatePresence>
        {newMsgCount > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            onClick={() => { scrollToBottom(true); setNewMsgCount(0); }}
            className="absolute bottom-[76px] start-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold shadow-lg"
          >
            ↓ {newMsgCount} new
          </motion.button>
        )}
      </AnimatePresence>

      {/* Long-press context menu */}
      <AnimatePresence>
        {contextMsg && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/40 flex items-end justify-center pb-6"
            onClick={() => setContextMsg(null)}
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl overflow-hidden w-72 shadow-xl"
            >
              {/* Quick emoji reaction strip */}
              <div className="flex items-center justify-around px-3 py-3 border-b border-border">
                {QUICK_EMOJIS.map(emoji => {
                  const myReacted = (reactions[contextMsg?.id] || []).some(r => r.user_id === user?.id && r.emoji === emoji);
                  return (
                    <button
                      key={emoji}
                      onClick={() => handleEmojiReact(contextMsg, emoji)}
                      className={`text-2xl p-1.5 rounded-xl transition-all ${myReacted ? 'bg-primary/20 scale-110' : 'hover:bg-secondary active:bg-secondary hover:scale-110'}`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>

              {/* Reply */}
              <button
                onClick={() => handleReply(contextMsg)}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-secondary active:bg-secondary transition-colors"
              >
                <CornerUpLeft className="w-4 h-4 text-muted-foreground" />
                {t('hub.comments.reply')}
              </button>

              {/* Pin/Unpin */}
              <button
                onClick={() => handlePinToggle(contextMsg)}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
              >
                <span className="text-base">📌</span>
                {isPinned(contextMsg) ? 'Unpin message' : 'Pin message'}
              </button>

              {/* Delete — only for the sender's own messages (mig 114) */}
              {contextMsg?.sender_email?.toLowerCase() === myEmailLc && (
                <button
                  onClick={() => handleDeleteMessage(contextMsg)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-secondary active:bg-secondary transition-colors border-t border-border text-destructive"
                >
                  <span className="text-base">🗑️</span>
                  Delete message
                </button>
              )}

              {/* Cancel */}
              <button
                onClick={() => setContextMsg(null)}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reply quote bar */}
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2 px-3 py-2 border-t border-s-2 border-l-primary bg-primary/5 shrink-0"
          >
            <CornerUpLeft className="w-3.5 h-3.5 text-primary shrink-0" />
            <p className="flex-1 text-xs text-muted-foreground truncate">{replyTo.snippet}</p>
            <button onClick={() => setReplyTo(null)} className="p-0.5 rounded text-muted-foreground hover:text-foreground active:text-foreground">
              <X className="w-3 h-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment preview strip */}
      {attachmentPreview && (
        <div className="flex items-center gap-2 px-1 py-1.5 border-t border-border shrink-0">
          <div className="relative w-14 h-14 shrink-0">
            <img loading="lazy" src={attachmentPreview} alt={tFallback("hubChat.attachmentPreview", "Attachment preview")} className="w-full h-full object-cover rounded-lg" />
            <button
              onClick={clearAttachment}
              aria-label={tFallback("hubChat.removeAttachment", "Remove attachment")}
              className="relative before:absolute before:content-[''] before:-inset-2.5 absolute -top-1.5 -end-1.5 w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center shadow"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground truncate flex-1">{attachmentFile?.name}</p>
        </div>
      )}

      {/* Scheduled message queue — small banner above the composer
          listing my pending scheduled sends in THIS conversation.
          Each row has Cancel; no edit (cancel + recompose is cleaner). */}
      {scheduledHere.length > 0 && (
        <div className="mb-2 shrink-0 space-y-1">
          {scheduledHere.map(s => (
            <div key={s.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
              <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-micro font-bold text-primary uppercase tracking-wide">
                  Scheduled · {new Date(s.scheduled_at).toLocaleString()}
                </p>
                <p className="text-xs text-foreground truncate">{s.content}</p>
              </div>
              <button
                onClick={() => handleCancelScheduled(s.id)}
                className="text-micro font-bold uppercase tracking-wide text-muted-foreground hover:text-destructive active:text-destructive"
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pending-request notice. The one-message cap is enforced by mig
          234's RESTRICTIVE INSERT policy; this explains it rather than
          letting the user compose into a 42501. */}
      {pendingSendBlocked && (
        <div className="mt-2 shrink-0 px-3 py-2 rounded-lg bg-secondary/50 border border-border">
          <p className="text-micro text-muted-foreground text-center">
            {tFallback(
              'hub.messages.request.waitToSend',
              'Message request sent. You can send more once they accept.'
            )}
          </p>
        </div>
      )}

      {/* Composer */}
      <div className="flex items-end gap-1 pt-2 border-t border-border shrink-0">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFilePick} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={pendingSendBlocked}
          aria-label="Attach image"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        {/* Sticker picker — uses inventory stickers (mig 115). */}
        <button
          onClick={() => setStickerPickerOpen(true)}
          disabled={pendingSendBlocked}
          aria-label={tFallback("hubChat.sendSticker", "Send sticker")}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Smile className="w-4 h-4" />
        </button>
        {/* GIF picker — Tenor-backed. Hidden entirely when no Tenor key is
            configured, so users never hit the picker's dev-facing "set the
            env var" state (the button used to always render). */}
        {GIF_ENABLED && (
          <button
            onClick={() => setGifPickerOpen(true)}
            disabled={pendingSendBlocked}
            aria-label={tFallback("hubChat.sendGif", "Send GIF")}
            className="px-2 py-1.5 rounded-lg text-micro font-extrabold text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors shrink-0 border border-border disabled:opacity-40 disabled:cursor-not-allowed"
          >
            GIF
          </button>
        )}
        {/* Poll creation is intentionally NOT offered in 1:1 DMs — polls are a
            group-audience feature, so they live on Hub posts and in Crew chats.
            Existing poll messages still RENDER + accept votes here (PollBubble
            below), so any poll sent before this change keeps working. */}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleDraftChange}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={t('hub.chat.placeholder')}
          maxLength={1000}
          rows={1}
          className="flex-1 px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none leading-snug"
          style={{ maxHeight: 140 }}
        />
        {/* Voice memo — hold-to-record. Hidden when there's already a
            draft so the send-button doesn't fight for the same space. */}
        {!draft.trim() && !attachmentFile && !pendingSendBlocked && (
          <VoiceMemoRecorder
            onComplete={handleSendVoice}
            onError={(msg) => toast.error(msg || 'Recording failed.')}
          />
        )}
        {/* Schedule send — opens an inline picker. Only shown when the
            user has typed something to send. */}
        {draft.trim() && (
          <button
            onClick={() => setScheduleOpen(v => !v)}
            aria-label={tFallback("hubChat.scheduleMessage", "Schedule message")}
            title={tFallback("hubChat.scheduleSend", "Schedule send")}
            className={`p-2 rounded-lg transition-colors shrink-0 ${scheduleOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary'}`}
          >
            <Clock className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={handleSend}
          disabled={sending || uploading || pendingSendBlocked || (!draft.trim() && !attachmentFile)}
          aria-label={tFallback("hubChat.send", "Send")}
          className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-opacity shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Sticker / GIF pickers — slide up from the bottom. Mounted as
          siblings to the composer so the drawer naturally overlaps the
          input rail when open. */}
      <AnimatePresence>
        {stickerPickerOpen && (
          <DMStickerPicker
            open
            userId={user?.id}
            userEmail={user?.email}
            onPick={handleSendSticker}
            onClose={() => setStickerPickerOpen(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {GIF_ENABLED && gifPickerOpen && (
          <GifPicker
            open
            onPick={handleSendGif}
            onClose={() => setGifPickerOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Schedule send overlay — dropdown above the composer. Uses
          datetime-local since the native control is mobile-friendly. */}
      {/* Poll composer — slides up above the composer rail. */}
      <AnimatePresence>
        {pollComposerOpen && (
          <PollComposer
            onCreate={handleSendPoll}
            onClose={() => setPollComposerOpen(false)}
            tFallback={tFallback}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {scheduleOpen && draft.trim() && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-16 end-0 start-0 z-40 mx-2 p-3 rounded-xl bg-card border border-border shadow-lg"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Schedule send
            </p>
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              min={format(new Date(Date.now() + 60_000), "yyyy-MM-dd'T'HH:mm")}
              className="w-full px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50"
            />
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                onClick={() => { setScheduleOpen(false); setScheduleAt(''); }}
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={!scheduleAt}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50"
              >
                Schedule
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
