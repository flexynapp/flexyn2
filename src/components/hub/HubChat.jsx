import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Send, Lock, Paperclip, X } from 'lucide-react';
import { format, parseISO, differenceInHours } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubMessages from '@/lib/data/hubMessages';
import * as users from '@/lib/data/users';
import { db } from '@/api/db';
import { toast } from 'sonner';
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

// Dedupe optimistic messages once the server echoes them back.
// The temp loses to a real duplicate so we don't render the same message twice.
function dedupeMessages(list) {
  if (!list || list.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    // body is the primary column; content is the mirror — check both
    const text = (m.body || m.content || '').trim();
    const key = `${(m.sender_email || '').toLowerCase()}|${text}`;
    const isTemp = String(m.id || '').startsWith('temp-');
    if (seen.has(key) && isTemp) continue;
    seen.add(key);
    out.unshift(m);
  }
  return out;
}

// ── DM fire-reaction helpers ──────────────────────────────────────────────────
const DM_FIRE_KEY = (convId) => `dm_fire_reactions_${convId}`;

function loadDmFires(convId) {
  try {
    return JSON.parse(localStorage.getItem(DM_FIRE_KEY(convId)) || '{}');
  } catch {
    return {};
  }
}
function saveDmFires(convId, map) {
  try {
    localStorage.setItem(DM_FIRE_KEY(convId), JSON.stringify(map));
  } catch {}
}

export default function HubChat({ conversation, otherUser = null, onBack }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState(null);   // File object
  const [attachmentPreview, setAttachmentPreview] = useState(null); // object URL
  const [uploading, setUploading] = useState(false);

  const scrollerRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const stickToBottomRef = useRef(true);

  // Double-tap fire reactions — persisted in localStorage per conversation
  const lastTapRef = useRef({ id: null, time: 0 });
  const [fireReactions, setFireReactions] = useState(() =>
    loadDmFires(conversation?.id)
  );
  const [floatingFires, setFloatingFires] = useState([]); // [{id, msgId}]

  // Reload fires if conversation changes
  useEffect(() => {
    setFireReactions(loadDmFires(conversation?.id));
  }, [conversation?.id]);

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

  const otherProfile = otherUser || resolvedOther;
  const otherUsername = otherProfile?.username || (otherEmail ? otherEmail.split('@')[0] : null);
  const otherHandle = otherUsername ? `@${otherUsername}` : t('hub.profile.anonymousAthlete');
  const otherInitials = (otherUsername || '?').slice(0, 2).toUpperCase();
  const otherAvatarUrl = otherProfile?.avatar_url || null;

  const { data: rawMessages = [] } = useQuery({
    queryKey: ['hubChat', conversation?.id],
    queryFn: () => hubMessages.listMessages(conversation.id),
    enabled: !!conversation?.id,
    refetchInterval: 5000,
  });

  const messages = dedupeMessages(rawMessages);

  useEffect(() => {
    if (conversation?.id && user?.email) {
      hubMessages.markRead(conversation.id, user.email).then(() => {
        // Immediately clear the nav badge so the unread count reflects reality.
        queryClient.invalidateQueries({ queryKey: ['hubUnreadCount', user.email] });
      }).catch(() => {});
    }
  }, [conversation?.id, user?.email, messages.length]);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
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
    }
  }, [messages.length, scrollToBottom]);

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }, []);

  useEffect(() => { resizeTextarea(); }, [draft, resizeTextarea]);

  // Revoke object URL when attachment is cleared to avoid memory leaks
  const clearAttachment = useCallback(() => {
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachmentFile(null);
    setAttachmentPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [attachmentPreview]);

  // DMs are private, so we can be generous. 50 MB easily covers Live Photos,
  // 4K screenshots, screen recordings, and large camera-roll exports.
  const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MB
  const handleFilePick = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error('Image must be 50 MB or smaller');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachmentFile(file);
    setAttachmentPreview(URL.createObjectURL(file));
  }, [attachmentPreview]);

  const handleMessageTap = useCallback((msgId) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last.id === msgId && now - last.time < 320) {
      // Double-tap detected — toggle fire reaction
      lastTapRef.current = { id: null, time: 0 };
      setFireReactions(prev => {
        const next = { ...prev, [msgId]: !prev[msgId] };
        saveDmFires(conversation?.id, next);
        return next;
      });
      if (!fireReactions[msgId]) {
        // Spawn a floating fire emoji
        const floatId = `${msgId}-${now}`;
        setFloatingFires(f => [...f, { id: floatId, msgId }]);
        setTimeout(() => setFloatingFires(f => f.filter(x => x.id !== floatId)), 900);
      }
    } else {
      lastTapRef.current = { id: msgId, time: now };
    }
  }, [conversation?.id, fireReactions]);

  const lastSentIndex = messages.reduce((acc, m, i) =>
    m.sender_email?.toLowerCase() === myEmailLc ? i : acc, -1);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed && !attachmentFile) return;
    if (sending || uploading) return;
    if (!conversation?.id) {
      toast.error(t('hub.messages.sendError'));
      return;
    }

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
      // Show blob preview URL immediately so image is visible while uploading
      ...(attachmentPreview ? { attachment_url: attachmentPreview } : {}),
    };

    const queryKey = ['hubChat', conversation.id];
    const previous = queryClient.getQueryData(queryKey) || [];
    queryClient.setQueryData(queryKey, [...previous, optimistic]);

    setDraft('');
    stickToBottomRef.current = true;
    setSending(true);

    // Capture & clear attachment state before async work
    const fileToUpload = attachmentFile;
    clearAttachment();

    try {
      let attachmentUrl = null;
      let uploadFailed = false;
      if (fileToUpload) {
        setUploading(true);
        try {
          const result = await db.integrations.Core.UploadFile({ file: fileToUpload });
          attachmentUrl = result?.file_url || null;
          if (!attachmentUrl) uploadFailed = true;
        } catch (uploadErr) {
          console.error('[HubChat] upload threw:', uploadErr);
          uploadFailed = true;
        } finally {
          setUploading(false);
        }
      }

      // If upload failed AND there's no text, the message is empty — abort
      // cleanly rather than silently dropping the optimistic bubble on refetch.
      if (uploadFailed && !trimmed) {
        queryClient.setQueryData(queryKey, previous);
        toast.error('Image upload failed — try again');
        return;
      }
      if (uploadFailed) {
        toast.error('Image upload failed — message sent without attachment');
      }

      const sent = await hubMessages.sendMessage({
        conversationId: conversation.id,
        senderEmail: user.email || '',
        recipientEmail: otherEmail,
        body: trimmed,
        ...(attachmentUrl ? { attachmentUrl } : {}),
      });
      // sendMessage returns null on validation failure rather than throwing.
      // Treat that as an error so the optimistic bubble is rolled back instead
      // of being silently replaced by stale server data on refetch.
      if (!sent) {
        queryClient.setQueryData(queryKey, previous);
        setDraft(trimmed);
        toast.error(t('hub.messages.sendError'));
        return;
      }
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['hubConversations'] });
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      setDraft(trimmed);
      console.error('[HubChat] sendMessage threw:', err);
      toast.error(t('hub.messages.sendError'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="flex flex-col"
      style={{ height: 'calc(100dvh - 200px)', minHeight: 360 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border mb-3 shrink-0">
        <button
          onClick={onBack}
          aria-label={t('hub.backToHub') || 'Back'}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-heading font-bold text-primary text-sm overflow-hidden shrink-0">
          {otherAvatarUrl ? <img src={otherAvatarUrl} alt={`${otherHandle} avatar`} className="w-full h-full object-cover" /> : otherInitials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading font-bold text-sm truncate">{otherHandle}</p>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Lock className="w-2.5 h-2.5" /> {t('hub.messages.privateNote.short')}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1"
      >
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-center text-sm text-muted-foreground">{t('hub.chat.empty')}</p>
          </div>
        ) : (
          messages.map((m, i) => {
            const isMine = m.sender_email?.toLowerCase() === myEmailLc;
            const isLastSent = isMine && i === lastSentIndex;
            const showDivider = shouldShowDivider(messages, i);
            const isOptimistic = !!m._optimistic;
            const ts = msgTime(m);
            // read_at is the timestamptz set when the recipient reads the message
            const isRead = !!m.read_at;
            return (
              <div key={m.id}>
                {showDivider && ts && (
                  <div className="flex justify-center my-4">
                    <span className="text-[11px] text-muted-foreground">
                      {formatDivider(ts)}
                    </span>
                  </div>
                )}
                {(() => {
                  // Body parsing routes:
                  //  1. [TRADE_OFFER_V1] → render interactive offer card.
                  //  2. [TRADE_RESPONSE_V1] → render as a regular plain
                  //     bubble showing only the human-readable second line
                  //     (the marker is hidden — its job is server-side
                  //     state recovery for the original offer card).
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
                        <CrewDMInviteCard
                          payload={crewInvitePayload}
                          userId={user?.id}
                          isMine={isMine}
                        />
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
                  return (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i, 8) * 0.02 }}
                      className={`flex mb-0.5 relative ${isMine ? 'justify-end' : 'justify-start'}`}
                    >
                      {/* Floating fire animation on double-tap */}
                      {floatingFire && (
                        <motion.span
                          key={floatingFire.id}
                          initial={{ opacity: 1, y: 0, scale: 1 }}
                          animate={{ opacity: 0, y: -40, scale: 1.4 }}
                          transition={{ duration: 0.85, ease: 'easeOut' }}
                          className="absolute -top-2 pointer-events-none z-10 text-base select-none"
                          style={isMine ? { right: 8 } : { left: 8 }}
                        >
                          🔥
                        </motion.span>
                      )}
                      <div className="relative">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => !isOptimistic && handleMessageTap(m.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleMessageTap(m.id); }}
                          className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words transition-opacity cursor-pointer select-text ${
                            isMine
                              ? 'bg-primary text-primary-foreground rounded-br-sm'
                              : 'bg-secondary text-foreground rounded-bl-sm'
                          } ${isOptimistic ? 'opacity-70' : 'opacity-100'}`}
                        >
                          {(() => {
                            // Strip the [TRADE_RESPONSE_V1] marker line so the
                            // bubble shows only the human-readable reply text.
                            // The marker exists for offer-card state recovery,
                            // not for the message bubble to display.
                            const raw = m.body || m.content || '';
                            if (parseTradeResponse(raw)) {
                              const newline = raw.indexOf('\n');
                              const visible = newline >= 0 ? raw.slice(newline + 1) : '';
                              return visible ? <span>{visible}</span> : null;
                            }
                            return raw ? <span>{raw}</span> : null;
                          })()}
                          {m.attachment_url && (
                            // Attachment opens full-res in a new tab. Wrapped in
                            // a real <button> (not an <img onClick>) so it's
                            // tabbable, keyboard-actionable (Enter/Space), and
                            // announced by screen readers as an interactive
                            // element instead of an image.
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); window.open(m.attachment_url, '_blank', 'noopener,noreferrer'); }}
                              aria-label="Open attachment in new tab"
                              className={`block rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-transparent focus:ring-white/60 ${(m.body || m.content) ? 'mt-1.5' : ''}`}
                            >
                              <img
                                src={m.attachment_url}
                                alt="Message attachment"
                                className="rounded-lg max-h-64 object-cover max-w-full"
                              />
                            </button>
                          )}
                        </div>
                        {/* Persistent fire badge */}
                        {hasFire && (
                          <span
                            className={`absolute -bottom-2 text-sm leading-none pointer-events-none select-none ${
                              isMine ? '-left-3' : '-right-3'
                            }`}
                          >
                            🔥
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })()}
                {isLastSent && !isOptimistic && (
                  <div className="flex justify-end mb-2 pr-1">
                    <span className="text-[10px] text-muted-foreground">
                      {isRead ? 'Read' : 'Sent'}
                    </span>
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
      </div>

      {/* Attachment preview strip */}
      {attachmentPreview && (
        <div className="flex items-center gap-2 px-1 py-1.5 border-t border-border shrink-0">
          <div className="relative w-14 h-14 shrink-0">
            <img
              src={attachmentPreview}
              alt="Attachment preview"
              className="w-full h-full object-cover rounded-lg"
            />
            <button
              onClick={clearAttachment}
              aria-label="Remove attachment"
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center shadow"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground truncate flex-1">
            {attachmentFile?.name}
          </p>
        </div>
      )}

      {/* Composer */}
      <div className="flex items-end gap-2 pt-2 border-t border-border shrink-0">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFilePick}
        />
        {/* Paperclip button */}
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
          onChange={(e) => setDraft(e.target.value)}
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
        <button
          onClick={handleSend}
          disabled={sending || uploading || (!draft.trim() && !attachmentFile)}
          aria-label="Send"
          className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-opacity shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
