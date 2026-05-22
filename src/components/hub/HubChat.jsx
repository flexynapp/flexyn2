import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, Lock, Paperclip, X, CornerUpLeft, Search, Clock } from 'lucide-react';
import { highlightMatches, countMatches } from '@/lib/highlightMatches';
import { acceptConversation } from '@/lib/data/conversationRequests';
import { deleteMyMessage, scheduleMyMessage, listMyScheduled, cancelMyScheduledMessage } from '@/lib/data/dmLifecycle';
import { format, parseISO, differenceInHours, formatDistanceToNowStrict } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubMessages from '@/lib/data/hubMessages';
import * as users from '@/lib/data/users';
import * as dmRxns from '@/lib/data/dmMessageReactions';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';
import { triggerHaptic } from '@/lib/haptic';
import { compressImage } from '@/lib/imageCompress';
import TradeOfferCard, { parseTradeOffer, parseTradeResponse } from './TradeOfferCard';
import CrewDMInviteCard, { parseCrewInvite } from '@/components/crews/CrewDMInviteCard';
import DuelInviteCard, { parseDuelInvite } from '@/components/duels/DuelInviteCard';

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
// Two-pass to avoid the prior bug where two rapidly-sent identical TEMP
// messages would silently drop the second one (same sender+body key).
//   Pass 1: collect content keys of all REAL (non-temp) messages.
//   Pass 2: skip a temp ONLY if a real with the same content exists.
//           Dedupe everything else by id so genuine duplicates can't slip in.
function dedupeMessages(list) {
  if (!list || list.length === 0) return [];
  const realKeys = new Set();
  for (const m of list) {
    const id = m.id;
    const isTemp = String(id || '').startsWith('temp-');
    if (!isTemp && id) {
      const text = (m.body || m.content || '').trim();
      realKeys.add(`${(m.sender_email || '').toLowerCase()}|${text}`);
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
      if (realKeys.has(key)) continue;
    }
    if (id) seenIds.add(id);
    out.unshift(m);
  }
  return out;
}

// ── DM fire-reaction helpers ──────────────────────────────────────────────────
const DM_FIRE_KEY = (convId) => `dm_fire_reactions_${convId}`;

function loadDmFires(convId) {
  try { return JSON.parse(localStorage.getItem(DM_FIRE_KEY(convId)) || '{}'); } catch { return {}; }
}
function saveDmFires(convId, map) {
  try { localStorage.setItem(DM_FIRE_KEY(convId), JSON.stringify(map)); } catch {}
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
          ? <mark key={idx} className="bg-amber-300/40 text-foreground rounded-sm px-0.5">{seg.text}</mark>
          : <span key={idx}>{seg.text}</span>
      )}
    </span>
  );
}

export default function HubChat({ conversation, otherUser = null, onBack }) {
  const { t, tFallback } = useLanguage();
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

  const scrollerRef    = useRef(null);
  const textareaRef    = useRef(null);
  const fileInputRef   = useRef(null);
  const stickToBottomRef = useRef(true);

  // ── Double-tap fire reactions ──────────────────────────────────────────────
  const lastTapRef = useRef({ id: null, time: 0 });
  const [fireReactions, setFireReactions] = useState(() => loadDmFires(conversation?.id));
  const [floatingFires, setFloatingFires] = useState([]);
  useEffect(() => { setFireReactions(loadDmFires(conversation?.id)); }, [conversation?.id]);

  // ── Pinning ────────────────────────────────────────────────────────────────
  const [pinnedIds, setPinnedIds] = useState(() => new Set());
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
  const otherEmail = (conversation?.participant_emails || [])
    .find(e => e?.toLowerCase() !== myEmailLc) || '';

  const { data: resolvedOther } = useQuery({
    queryKey: ['hubChatProfile', otherEmail],
    queryFn: async () => {
      if (!otherEmail) return null;
      const all = await users.list().catch(() => []);
      return all.find(u => u.email === otherEmail) || null;
    },
    enabled: !otherUser && !!otherEmail,
    staleTime: 60_000,
  });

  const otherProfile    = otherUser || resolvedOther;
  const otherUsername   = otherProfile?.username || (otherEmail ? otherEmail.split('@')[0] : null);
  const otherHandle     = otherUsername ? `@${otherUsername}` : t('hub.profile.anonymousAthlete');
  const otherInitials   = (otherUsername || '?').slice(0, 2).toUpperCase();
  const otherAvatarUrl  = otherProfile?.avatar_url || null;

  const { data: rawMessages = [] } = useQuery({
    queryKey: ['hubChat', conversation?.id],
    queryFn: () => hubMessages.listMessages(conversation.id),
    enabled: !!conversation?.id,
    refetchInterval: 5000,
  });

  const messages = dedupeMessages(rawMessages);

  // In-thread search filter (G1). Skipped to all-messages when the
  // search bar is closed; once a query exists, only matching messages
  // (case-insensitive substring) render.
  const visibleMessages = (() => {
    const q = searchQuery.trim();
    if (!searchOpen || !q) return messages;
    const ql = q.toLowerCase();
    return messages.filter(m => {
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
  useEffect(() => {
    if (conversation?.id && user?.email) {
      hubMessages.markRead(conversation.id, user.email).then(() => {
        queryClient.invalidateQueries({ queryKey: ['hubUnreadCount', user.email] });
      }).catch(() => {});
    }
  }, [conversation?.id, user?.email, messages.length]);

  // ── Read receipt fade (4 s after read_at appears) ─────────────────────────
  const lastSentIndex = messages.reduce((acc, m, i) =>
    m.sender_email?.toLowerCase() === myEmailLc ? i : acc, -1);
  const lastSentMsg = lastSentIndex >= 0 ? messages[lastSentIndex] : null;

  useEffect(() => {
    if (lastSentMsg?.read_at && !readReceiptFaded) {
      const t = setTimeout(() => setReadReceiptFaded(true), 4000);
      return () => clearTimeout(t);
    }
  }, [lastSentMsg?.read_at, readReceiptFaded]);

  // Reset fade state when conversation changes
  useEffect(() => { setReadReceiptFaded(false); }, [conversation?.id]);

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

  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollToBottom(true);
      setNewMsgCount(0);
    } else {
      setNewMsgCount(c => c + 1);
    }
  }, [messages.length, scrollToBottom]);

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
          toast.error('Image must be 50 MB or smaller');
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

  // ── Double-tap fire ───────────────────────────────────────────────────────
  const handleMessageTap = useCallback((msgId) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last.id === msgId && now - last.time < 320) {
      lastTapRef.current = { id: null, time: 0 };
      setFireReactions(prev => {
        const next = { ...prev, [msgId]: !prev[msgId] };
        saveDmFires(conversation?.id, next);
        return next;
      });
      if (!fireReactions[msgId]) {
        const floatId = `${msgId}-${now}`;
        setFloatingFires(f => [...f, { id: floatId, msgId }]);
        setTimeout(() => setFloatingFires(f => f.filter(x => x.id !== floatId)), 900);
      }
    } else {
      lastTapRef.current = { id: msgId, time: now };
    }
  }, [conversation?.id, fireReactions]);

  // ── Long-press for context menu ───────────────────────────────────────────
  const startLongPress = useCallback((msg) => {
    longPressRef.current = setTimeout(() => setContextMsg(msg), 500);
  }, []);
  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
  }, []);

  // ── Pin toggle ────────────────────────────────────────────────────────────
  const isPinned = useCallback((msg) =>
    pinnedIds.has(msg.id) ? !msg.is_pinned : !!msg.is_pinned, [pinnedIds]);

  const handlePinToggle = useCallback(async (msg) => {
    setContextMsg(null);
    const id = msg.id;
    if (!id || String(id).startsWith('temp-')) return;
    setPinnedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    try {
      await hubMessages.togglePinDmMessage(id);
      queryClient.invalidateQueries({ queryKey: ['hubChat', conversation?.id] });
    } catch {
      setPinnedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      // Resync with server in case the failure was a transient that
      // succeeded server-side — avoids leaving the UI desynced after recovery.
      queryClient.invalidateQueries({ queryKey: ['hubChat', conversation?.id] });
      toast.error(tFallback('hub.chat.pinError', 'Could not pin message. Try again.'));
    }
  }, [conversation?.id, queryClient]);

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

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed && !attachmentFile) return;
    if (sending || uploading) return;
    if (!conversation?.id) { toast.error(t('hub.messages.sendError')); return; }
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
        queryClient.setQueryData(queryKey, previous);
        toast.error('Image upload failed — try again');
        return;
      }
      if (uploadFailed) toast.error('Image upload failed — message sent without attachment');

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
        queryClient.setQueryData(queryKey, previous);
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
      toast.error(t('hub.messages.sendError'));
    } finally {
      setSending(false);
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
    <div
      className="flex flex-col relative"
      style={{ height: 'calc(100dvh - 200px)', minHeight: 360 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border mb-3 shrink-0">
        <button
          onClick={onBack}
          aria-label={tFallback('hub.backToHub', 'Back')}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-heading font-bold text-primary text-sm overflow-hidden shrink-0">
          {otherAvatarUrl
            ? <img src={otherAvatarUrl} alt={`${otherHandle} avatar`} className="w-full h-full object-cover" />
            : otherInitials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading font-bold text-sm truncate">{otherHandle}</p>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Lock className="w-2.5 h-2.5" /> {t('hub.messages.privateNote.short')}
          </p>
        </div>
        {/* Search this thread — opens an inline filter pill. Closing
            the search clears the query so the next open starts fresh. */}
        <button
          onClick={() => { setSearchOpen(v => { if (v) setSearchQuery(''); return !v; }); }}
          aria-label="Search this conversation"
          className={`p-1.5 rounded-md transition-colors ${searchOpen ? 'bg-primary/15 text-primary' : 'hover:bg-secondary'}`}
        >
          <Search className="w-4 h-4" />
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
          <div className="mb-2 shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-amber-500 uppercase tracking-wide">Message request</p>
              <p className="text-[11px] text-muted-foreground">Accept to move this conversation to your inbox.</p>
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
            placeholder="Search this conversation…"
            className="flex-1 bg-transparent text-sm outline-none placeholder-muted-foreground/60"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-foreground" aria-label="Clear">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1"
      >
        {searchOpen && searchQuery.trim() && (
          <p className="text-[11px] text-muted-foreground text-center mb-2 tabular-nums">
            {totalMatches === 0
              ? 'No matches'
              : `${totalMatches} match${totalMatches === 1 ? '' : 'es'} in ${visibleMessages.length} message${visibleMessages.length === 1 ? '' : 's'}`}
          </p>
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
            const isLastSent = isMine && i === lastSentIndex;
            const showDivider = shouldShowDivider(visibleMessages, i);
            const isOptimistic = !!m._optimistic;
            const ts = msgTime(m);
            const isRead = !!m.read_at;
            const rxnGroups = getReactionGroups(m.id);
            return (
              <div key={m.id} id={`dm-msg-${m.id}`}>
                {showDivider && ts && (
                  <div className="flex justify-center my-4">
                    <span className="text-[11px] text-muted-foreground">{formatDivider(ts)}</span>
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

                  const hasFire = !!fireReactions[m.id];
                  const floatingFire = floatingFires.find(f => f.msgId === m.id);
                  const msgIsPinned = isPinned(m);

                  return (
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
                      <div className={`relative flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                        {/* Reply quote block */}
                        {m.replied_to_snippet && (
                          <button
                            type="button"
                            onClick={() => m.replied_to_message_id && scrollToMessage(m.replied_to_message_id)}
                            className={`max-w-[75%] mb-0.5 px-2.5 py-1.5 rounded-xl border-l-2 border-primary bg-secondary/40 text-left text-xs text-muted-foreground line-clamp-2 cursor-pointer hover:bg-secondary/60 transition-colors`}
                          >
                            {m.replied_to_snippet}
                          </button>
                        )}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => !isOptimistic && handleMessageTap(m.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleMessageTap(m.id); }}
                          onMouseDown={() => !isOptimistic && startLongPress(m)}
                          onMouseUp={cancelLongPress}
                          onMouseLeave={cancelLongPress}
                          onTouchStart={() => !isOptimistic && startLongPress(m)}
                          onTouchEnd={cancelLongPress}
                          onTouchMove={cancelLongPress}
                          className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm transition-opacity cursor-pointer select-text ${
                            isMine
                              ? 'bg-primary text-primary-foreground rounded-br-sm'
                              : 'bg-secondary text-foreground rounded-bl-sm'
                          } ${isOptimistic ? 'opacity-70' : 'opacity-100'}`}
                          style={{ wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'pre-wrap' }}
                        >
                          {(() => {
                            // Soft-deleted by sender → swap the body for a
                            // muted "This message was deleted" pill so the
                            // recipient sees that something used to be here
                            // (iMessage / IG pattern).
                            if (m.deleted_at) {
                              return <span className="italic opacity-70">This message was deleted</span>;
                            }
                            const raw = m.body || m.content || '';
                            if (parseTradeResponse(raw)) {
                              const newline = raw.indexOf('\n');
                              const visible = newline >= 0 ? raw.slice(newline + 1) : '';
                              return visible ? renderBodyWithHighlights(visible, searchOpen ? searchQuery : '') : null;
                            }
                            return raw ? renderBodyWithHighlights(raw, searchOpen ? searchQuery : '') : null;
                          })()}
                          {m.attachment_url && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); window.open(m.attachment_url, '_blank', 'noopener,noreferrer'); }}
                              aria-label="Open attachment in new tab"
                              className={`block rounded-lg overflow-hidden focus:outline-none ${(m.body || m.content) ? 'mt-1.5' : ''}`}
                            >
                              <img src={m.attachment_url} alt="Message attachment" className="rounded-lg max-h-64 object-cover max-w-full" />
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
                                    : 'bg-secondary border-border text-muted-foreground hover:bg-secondary/70'
                                }`}
                              >
                                <span>{emoji}</span>
                                {count > 1 && <span className="font-medium">{count}</span>}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Persistent fire badge — inward-facing */}
                        {hasFire && (
                          <span
                            className={`absolute -bottom-2 text-sm leading-none pointer-events-none select-none ${
                              isMine ? '-left-3' : '-right-3'
                            }`}
                          >🔥</span>
                        )}
                        {/* Pin badge — inward-facing */}
                        {msgIsPinned && (
                          <span
                            className={`absolute -top-2 text-xs leading-none pointer-events-none select-none ${
                              isMine ? '-left-3' : '-right-3'
                            }`}
                            title="Pinned message"
                          >📌</span>
                        )}
                      </div>
                    </motion.div>
                  );
                })()}

                {/* Read receipt — last sent message only */}
                {isLastSent && !isOptimistic && (
                  <div className="flex justify-end mb-2 pr-1">
                    {isRead && !readReceiptFaded ? (
                      <motion.span
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-[10px] text-primary font-medium transition-opacity duration-1000"
                      >
                        Read
                        {lastSentMsg?.read_at && (
                          <span className="text-muted-foreground font-normal">
                            {' · '}{formatRelativeShort(lastSentMsg.read_at) || 'just now'}
                          </span>
                        )}
                      </motion.span>
                    ) : !isRead ? (
                      <span className="text-[10px] text-muted-foreground">
                        Sent
                        {ts && <span> · {formatRelativeShort(ts)}</span>}
                      </span>
                    ) : null}
                  </div>
                )}
                {isLastSent && isOptimistic && (
                  <div className="flex justify-end mb-2 pr-1">
                    <span className="text-[10px] text-muted-foreground">Sending…</span>
                  </div>
                )}
              </div>
            );
          })
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
            className="absolute bottom-[76px] left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold shadow-lg"
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
                      className={`text-2xl p-1.5 rounded-xl transition-all ${myReacted ? 'bg-primary/20 scale-110' : 'hover:bg-secondary hover:scale-110'}`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>

              {/* Reply */}
              <button
                onClick={() => handleReply(contextMsg)}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-secondary transition-colors"
              >
                <CornerUpLeft className="w-4 h-4 text-muted-foreground" />
                Reply
              </button>

              {/* Pin/Unpin */}
              <button
                onClick={() => handlePinToggle(contextMsg)}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-secondary transition-colors border-t border-border"
              >
                <span className="text-base">📌</span>
                {isPinned(contextMsg) ? 'Unpin message' : 'Pin message'}
              </button>

              {/* Delete — only for the sender's own messages (mig 114) */}
              {contextMsg?.sender_email?.toLowerCase() === myEmailLc && (
                <button
                  onClick={() => handleDeleteMessage(contextMsg)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-secondary transition-colors border-t border-border text-destructive"
                >
                  <span className="text-base">🗑️</span>
                  Delete message
                </button>
              )}

              {/* Cancel */}
              <button
                onClick={() => setContextMsg(null)}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors border-t border-border"
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
            className="flex items-center gap-2 px-3 py-2 border-t border-l-2 border-l-primary bg-primary/5 shrink-0"
          >
            <CornerUpLeft className="w-3.5 h-3.5 text-primary shrink-0" />
            <p className="flex-1 text-xs text-muted-foreground truncate">{replyTo.snippet}</p>
            <button onClick={() => setReplyTo(null)} className="p-0.5 rounded text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment preview strip */}
      {attachmentPreview && (
        <div className="flex items-center gap-2 px-1 py-1.5 border-t border-border shrink-0">
          <div className="relative w-14 h-14 shrink-0">
            <img src={attachmentPreview} alt="Attachment preview" className="w-full h-full object-cover rounded-lg" />
            <button
              onClick={clearAttachment}
              aria-label="Remove attachment"
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center shadow"
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
            <div key={s.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wide">
                  Scheduled · {new Date(s.scheduled_at).toLocaleString()}
                </p>
                <p className="text-xs text-foreground truncate">{s.content}</p>
              </div>
              <button
                onClick={() => handleCancelScheduled(s.id)}
                className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground hover:text-destructive"
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="flex items-end gap-2 pt-2 border-t border-border shrink-0">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFilePick} />
        <button
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach image"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
        >
          <Paperclip className="w-4 h-4" />
        </button>
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
        {/* Schedule send — opens an inline picker. Only shown when the
            user has typed something to send. */}
        {draft.trim() && (
          <button
            onClick={() => setScheduleOpen(v => !v)}
            aria-label="Schedule message"
            title="Schedule send"
            className={`p-2 rounded-lg transition-colors shrink-0 ${scheduleOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
          >
            <Clock className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={handleSend}
          disabled={sending || uploading || (!draft.trim() && !attachmentFile)}
          aria-label="Send"
          className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-opacity shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Schedule send overlay — dropdown above the composer. Uses
          datetime-local since the native control is mobile-friendly. */}
      <AnimatePresence>
        {scheduleOpen && draft.trim() && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-16 right-0 left-0 z-40 mx-2 p-3 rounded-xl bg-card border border-border shadow-lg"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Schedule send
            </p>
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
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
