// src/components/coach/CoachChat.jsx
//
// AI Coach chat interface. Conversation history lives in localStorage per
// user (avoids a DB migration for v1). New messages call askCoach() which
// returns a personalized reply based on the user's actual data.

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Send, Sparkles, Loader2, Trash2, Mic, MicOff, ChevronLeft, ChevronRight } from 'lucide-react';
import { isVoiceInputSupported, startVoiceCapture } from '@/lib/voiceInput';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { askCoach, SUGGESTED_PROMPTS } from '@/lib/aiCoach/coach';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const MAX_HISTORY = 50;

function _historyKey(userId) { return `fn-coach-history-${userId || 'anon'}`; }

function loadHistory(userId) {
  try {
    const raw = localStorage.getItem(_historyKey(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    // Slice on hydrate too, not just on save. A localStorage written
    // by a prior version of the app (with a larger cap) or by a user
    // manually editing would otherwise render every message until the
    // next send re-trimmed. (Audit 16 F10.)
    return Array.isArray(arr) ? arr.slice(-MAX_HISTORY) : [];
  } catch { return []; }
}
function saveHistory(userId, messages) {
  try {
    const trimmed = messages.slice(-MAX_HISTORY);
    localStorage.setItem(_historyKey(userId), JSON.stringify(trimmed));
  } catch { /* ignore quota errors */ }
}

// Map app-language code → BCP-47 tag the Web Speech API understands.
// Without this, a non-English user got `en-US` recognition and saw
// their Spanish/German/etc. transcribed as garbled phonetic English.
// (Audit 16 F9.)
const SPEECH_LANG_BY_APP_LANG = {
  en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-PT',
  it: 'it-IT', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', ar: 'ar-SA',
  hi: 'hi-IN', ru: 'ru-RU', tr: 'tr-TR', pl: 'pl-PL', nl: 'nl-NL',
};

export default function CoachChat() {
  const { user } = useAuth();
  const { tFallback, language } = useLanguage();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  // Voice dictation state — the Mic icon swaps to MicOff with a pulse
  // while listening. Captures one phrase per tap (not continuous).
  const [voiceListening, setVoiceListening] = useState(false);
  const voiceSessionRef = useRef(null);
  const handleVoiceTap = () => {
    if (voiceListening) {
      voiceSessionRef.current?.stop();
      setVoiceListening(false);
      return;
    }
    setVoiceListening(true);
    voiceSessionRef.current = startVoiceCapture({
      lang: SPEECH_LANG_BY_APP_LANG[language] || 'en-US',
      onResult: ({ transcript }) => {
        setVoiceListening(false);
        voiceSessionRef.current = null;
        if (transcript && transcript.trim()) {
          // Append to existing draft so a half-typed question + a voice
          // addition both land. Trim trailing whitespace before appending
          // a space so we don't get double spaces.
          setDraft((prev) => (prev.trim() ? prev.trim() + ' ' + transcript : transcript));
        }
      },
      // Surface specific reasons so the user knows why dictation
      // stopped working. Previously a permission-denied silently reset
      // the mic icon with no toast. (Audit 16 F13.)
      onError: (info) => {
        setVoiceListening(false);
        voiceSessionRef.current = null;
        const reason = info?.reason || info; // accept either shape
        if (reason === 'permission') {
          toast.error(tFallback(
            'coach.voice.permissionDenied',
            'Microphone permission denied. Enable it in your browser settings.'
          ));
        } else if (reason === 'unsupported') {
          toast.error(tFallback(
            'coach.voice.unsupported',
            "Voice dictation isn't supported in this browser."
          ));
        } else if (reason && reason !== 'aborted') {
          toast.error(tFallback('coach.voice.failed', 'Voice input failed — try again.'));
        }
      },
    });
  };
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
        text: tFallback('coach.error', "Something went wrong on my side — try asking again in a moment."),
        ts: Date.now(),
        source: 'error',
      }]);
    } finally {
      setThinking(false);
    }
  };

  // Radix AlertDialog instead of native confirm() so the destructive
  // confirmation matches the rest of the app's visual language and
  // doesn't block the event loop / show the URL prefix on iOS Safari.
  // (Audit 16 F14.)
  const [clearOpen, setClearOpen] = useState(false);
  const handleClear = () => setClearOpen(true);
  const confirmClear = () => {
    setClearOpen(false);
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
              {tFallback('coach.title', 'Coach')}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {tFallback('coach.subtitle', 'Personalized advice from your data')}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            aria-label="Clear chat"
            className="p-2.5 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors touch-manipulation"
          >
            <Trash2 className="w-6 h-6" />
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
          <CoachWelcome onPick={handleSend} tFallback={tFallback} />
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
                    {tFallback('coach.thinking', 'Thinking…')}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Persistent suggested prompts — once the chat has started the
          welcome card is gone, so keep the prompts reachable as a
          horizontally-scrollable strip with arrow controls. */}
      {!isEmpty && (
        <PromptStrip prompts={SUGGESTED_PROMPTS} onPick={handleSend} disabled={thinking} />
      )}

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
          placeholder={tFallback('coach.placeholder', 'Ask Coach anything…')}
          maxLength={500}
          rows={1}
          className="flex-1 px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none leading-snug"
          style={{ maxHeight: 140 }}
        />
        {/* Voice dictation — hidden when Web Speech API isn't available
            (Firefox, some embedded browsers). Captures one phrase per
            tap and appends it to the draft so the user can review +
            edit before sending. */}
        {isVoiceInputSupported() && (
          <button
            type="button"
            onClick={handleVoiceTap}
            disabled={thinking}
            aria-label={voiceListening ? 'Stop listening' : 'Dictate your question'}
            aria-pressed={voiceListening}
            className={[
              'p-2 rounded-lg transition-colors shrink-0',
              voiceListening
                ? 'bg-rose-500/15 text-rose-500'
                : 'bg-secondary text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {voiceListening ? <MicOff className="w-4 h-4 animate-pulse" /> : <Mic className="w-4 h-4" />}
          </button>
        )}
        <button
          onClick={() => handleSend()}
          disabled={thinking || !draft.trim()}
          aria-label="Send"
          className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-opacity shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Clear chat confirmation. Replaces native confirm() so the
          destructive prompt matches the rest of the app's visual
          language. (Audit 16 F14.) */}
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tFallback('coach.clearConfirm', 'Clear chat history?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tFallback('coach.clearWarn', 'All previous Coach messages on this device will be erased.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tFallback('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmClear} className="bg-destructive hover:bg-destructive/90">
              {tFallback('common.clear', 'Clear')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

// Horizontally-scrollable suggested-prompt chips with left/right arrow
// controls. Arrows hide at the respective scroll extremes.
function PromptStrip({ prompts, onPick, disabled }) {
  const ref = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateArrows = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);

  useEffect(() => { updateArrows(); }, [updateArrows, prompts]);

  const scrollByAmount = (dx) => ref.current?.scrollBy({ left: dx, behavior: 'smooth' });

  return (
    <div className="relative shrink-0 mb-2">
      {!atStart && (
        <button
          type="button"
          onClick={() => scrollByAmount(-160)}
          aria-label="Scroll prompts left"
          className="absolute start-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-full bg-card border border-border shadow-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}
      <div
        ref={ref}
        onScroll={updateArrows}
        className="flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {prompts.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.text)}
            disabled={disabled}
            className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full bg-secondary/60 hover:bg-secondary border border-border/50 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {p.text}
          </button>
        ))}
      </div>
      {!atEnd && (
        <button
          type="button"
          onClick={() => scrollByAmount(160)}
          aria-label="Scroll prompts right"
          className="absolute end-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-full bg-card border border-border shadow-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function CoachWelcome({ onPick, tFallback }) {
  return (
    <div className="flex flex-col items-center justify-center text-center pt-8 pb-4 px-2">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary via-fuchsia-500 to-violet-500 flex items-center justify-center mb-4">
        <Sparkles className="w-7 h-7 text-white" />
      </div>
      <h2 className="font-heading font-bold text-lg mb-1">
        {tFallback('coach.welcome.title', 'Your personal coach')}
      </h2>
      <p className="text-sm text-muted-foreground mb-5 max-w-xs">
        {tFallback('coach.welcome.desc', "Ask me anything about your training. I read your actual workout data to give you specific advice.")}
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
