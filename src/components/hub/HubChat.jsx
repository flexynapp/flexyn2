import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Send, Lock } from 'lucide-react';
import { format, parseISO, differenceInHours } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubMessages from '@/lib/data/hubMessages';
import * as users from '@/lib/data/users';
import { toast } from 'sonner';

function shouldShowDivider(messages, index) {
  if (index === 0) return true;
  const curr = messages[index]?.created_at;
  const prev = messages[index - 1]?.created_at;
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
    const key = `${(m.sender_email || '').toLowerCase()}|${(m.content || '').trim()}`;
    const isTemp = String(m.id || '').startsWith('temp-');
    if (seen.has(key) && isTemp) continue;
    seen.add(key);
    out.unshift(m);
  }
  return out;
}

export default function HubChat({ conversation, otherUser = null, onBack }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const scrollerRef = useRef(null);
  const textareaRef = useRef(null);
  const stickToBottomRef = useRef(true);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const lastSentIndex = messages.reduce((acc, m, i) =>
    m.sender_email?.toLowerCase() === myEmailLc ? i : acc, -1);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    if (!conversation?.id) {
      toast.error(t('hub.messages.sendError'));
      return;
    }

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic = {
      id: tempId,
      conversation_id: conversation.id,
      sender_email: user?.email || '',
      content: trimmed,
      created_at: new Date().toISOString(),
      read_by: [],
      _optimistic: true,
    };

    const queryKey = ['hubChat', conversation.id];
    const previous = queryClient.getQueryData(queryKey) || [];
    queryClient.setQueryData(queryKey, [...previous, optimistic]);

    setDraft('');
    stickToBottomRef.current = true;
    setSending(true);

    try {
      await hubMessages.sendMessage({
        conversationId: conversation.id,
        senderEmail: user.email || '',
        body: trimmed,
      });
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
          {otherAvatarUrl ? <img src={otherAvatarUrl} alt="" className="w-full h-full object-cover" /> : otherInitials}
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
            const isRead = (m.read_by || []).some(e => e?.toLowerCase() !== myEmailLc);
            return (
              <div key={m.id}>
                {showDivider && m.created_at && (
                  <div className="flex justify-center my-4">
                    <span className="text-[11px] text-muted-foreground">
                      {formatDivider(m.created_at)}
                    </span>
                  </div>
                )}
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 8) * 0.02 }}
                  className={`flex mb-0.5 ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words transition-opacity ${
                      isMine
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'bg-secondary text-foreground rounded-bl-sm'
                    } ${isOptimistic ? 'opacity-70' : 'opacity-100'}`}
                  >
                    {m.content}
                  </div>
                </motion.div>
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

      {/* Composer */}
      <div className="flex items-end gap-2 pt-2 border-t border-border shrink-0">
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
          disabled={sending || !draft.trim()}
          aria-label="Send"
          className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-opacity shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
