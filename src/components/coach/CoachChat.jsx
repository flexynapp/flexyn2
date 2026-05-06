// src/components/coach/CoachChat.jsx
//
// AI Coach chat interface. Conversation history lives in localStorage per
// user (avoids a DB migration for v1). New messages call askCoach() which
// returns a personalized reply based on the user's actual data.

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, Loader2, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { askCoach, SUGGESTED_PROMPTS } from '@/lib/aiCoach/coach';

const MAX_HISTORY = 50;

function _historyKey(userId) { return `fn-coach-history-${userId || 'anon'}`; }

function loadHistory(userId) {
  try {
    const raw = localStorage.getItem(_historyKey(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveHistory(userId, messages) {
  try {
    const trimmed = messages.slice(-MAX_HISTORY);
    localStorage.setItem(_historyKey(userId), JSON.stringify(trimmed));
  } catch { /* ignore quota errors */ }
}

export default function CoachChat() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollerRef = useRef(null);
  const textareaRef = useRef(null);
  const stickToBottomRef = useRef(true);

  // Hydrate from localStorage on mount / when user changes
  useEffect(() => {
    setMessages(loadHistory(user?.id));
  }, [user?.id]);

  // Persist on change (debounced via render — small N is fine to write often)
  useEffect(() => {
    if (user?.id) saveHistory(user.id, messages);
  }, [messages, user?.id]);

  // Auto-resize the textarea
  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }, []);
  useEffect(() => { resizeTextarea(); }, [draft, resizeTextarea]);

  // Auto-scroll on new messages if user is near the bottom
  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (smooth && 'scrollTo' in el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);
  useLayoutEffect(() => { scrollToBottom(false); }, [scrollToBottom]);
  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom(true);
  }, [messages.length, thinking, scrollToBottom]);

  const handleSend = async (textOverride) => {
    const text = (textOverride ?? draft).trim();
    if (!text || thinking) return;
    setDraft('');
    stickToBottomRef.current = true;

    const userMsg = { role: 'user', text, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setThinking(true);

    try {
      const result = await askCoach(user, text);
      const reply = { role: 'coach', text: result.reply, ts: Date.now(), source: result.source };
      setMessages(prev => [...prev, reply]);
    } catch (err) {
      console.error('[CoachChat] askCoach threw:', err);
      setMessages(prev => [...prev, {
        role: 'coach',
        text: "Something went wrong on my side — try asking again in a moment.",
        ts: Date.now(),
        source: 'error',
      }]);
    } finally {
      setThinking(false);
    }
  };

  const handleClear = () => {
    if (!confirm('Clear chat history?')) return;
    setMessages([]);
    if (user?.id) try { localStorage.removeItem(_historyKey(user.id)); } catch {}
  };

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }, []);

  const isEmpty = messages.length === 0;

  return (
    <div
      className="flex flex-col"
      style={{ height: 'calc(100dvh - 200px)', minHeight: 380 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary via-fuchsia-500 to-violet-500 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-heading font-bold text-sm">
              {t('coach.title') === 'coach.title' ? 'Coach' : t('coach.title')}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {t('coach.subtitle') === 'coach.subtitle' ? 'Personalized advice from your data' : t('coach.subtitle')}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            aria-label="Clear chat"
            className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1"
      >
        {isEmpty ? (
          <CoachWelcome onPick={handleSend} t={t} />
        ) : (
          <>
            {messages.map((m, i) => (
              <MessageBubble key={i} m={m} />
            ))}
            {thinking && (
              <div className="flex mb-2 justify-start">
                <div className="bg-secondary text-foreground rounded-2xl rounded-bl-sm px-3 py-2 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">
                    {t('coach.thinking') === 'coach.thinking' ? 'Thinking…' : t('coach.thinking')}
                  </span>
                </div>
              </div>
            )}
          </>
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
          placeholder={t('coach.placeholder') === 'coach.placeholder' ? 'Ask Coach anything…' : t('coach.placeholder')}
          maxLength={500}
          rows={1}
          className="flex-1 px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none leading-snug"
          style={{ maxHeight: 140 }}
        />
        <button
          onClick={() => handleSend()}
          disabled={thinking || !draft.trim()}
          aria-label="Send"
          className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-opacity shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ m }) {
  const isUser = m.role === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex mb-2 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-secondary text-foreground rounded-bl-sm'
        }`}
      >
        {m.text}
      </div>
    </motion.div>
  );
}

function CoachWelcome({ onPick, t }) {
  return (
    <div className="flex flex-col items-center justify-center text-center pt-8 pb-4 px-2">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary via-fuchsia-500 to-violet-500 flex items-center justify-center mb-4">
        <Sparkles className="w-7 h-7 text-white" />
      </div>
      <h2 className="font-heading font-bold text-lg mb-1">
        {t('coach.welcome.title') === 'coach.welcome.title' ? "Your personal coach" : t('coach.welcome.title')}
      </h2>
      <p className="text-sm text-muted-foreground mb-5 max-w-xs">
        {t('coach.welcome.desc') === 'coach.welcome.desc'
          ? "Ask me anything about your training. I read your actual workout data to give you specific advice."
          : t('coach.welcome.desc')}
      </p>
      <div className="space-y-1.5 w-full max-w-sm">
        {SUGGESTED_PROMPTS.map(p => (
          <button
            key={p.id}
            onClick={() => onPick(p.text)}
            className="w-full text-left px-3 py-2.5 rounded-lg bg-secondary/50 hover:bg-secondary border border-border/50 text-sm transition-colors"
          >
            {p.text}
          </button>
        ))}
      </div>
    </div>
  );
}
