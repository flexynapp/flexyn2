// src/components/coach/CoachChat.jsx
//
// AI Coach chat interface. Conversation history lives in localStorage per
// user (avoids a DB migration for v1). New messages call askCoach() which
// returns a personalized reply based on the user's actual data.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Send, Sparkles, Loader2, Trash2, Mic, MicOff, ChevronLeft, ChevronRight } from 'lucide-react';
import ChatViewportFrame from '@/components/ChatViewportFrame';
import { isVoiceInputSupported, startVoiceCapture } from '@/lib/voiceInput';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { askCoach, SUGGESTED_PROMPTS } from '@/lib/aiCoach/coach';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/db';
import { listActiveInjuries, getExcludedMuscleGroups } from '@/lib/data/injuries';
import { buildCoachContext } from '@/lib/aiCoach/responders';
import { GENERATE_PROMPTS } from '@/lib/aiCoach/planBuilder';
import { parseBoldSegments } from '@/lib/aiCoach/markdownLite';
import { followUpsFor } from '@/lib/aiCoach/followUps';
import CoachPlanCard from '@/components/coach/CoachPlanCard';
import { toast } from '@/lib/toast';
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
    // Strip transient error placeholders before persisting — the
    // "Something went wrong on my side" coach reply is a UI signal
    // for the current turn, not durable conversation history. Without
    // this filter, a returning user re-opens Coach and sees stale
    // error bubbles from a past network blip as if the coach had
    // actually said them. The user's own message is kept so they
    // remember what they asked.
    const persistable = messages.filter(m => m?.source !== 'error');
    const trimmed = persistable.slice(-MAX_HISTORY);
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

export default function CoachChat({ mode, onSaveRegimen, onStartWorkout }) {
  const { user } = useAuth();

  // Personalization inputs for the chat path, so asking Coach in chat and
  // tapping Quick pick can't disagree about the same lift. Both served from
  // the shared query keys, so this costs no extra fetch.
  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn:  () => db.auth.me(),
    enabled:  !!user?.email,
    staleTime: 60_000,
  });
  // Key is ['injuries','active',uid] — the SAME key InjuryBanner uses and the
  // one InjuryForm's mutations invalidate by prefix. It used to be
  // ['activeInjuries', uid], which no mutation has ever touched: logging or
  // clearing an injury left the Coach reading a five-minute-stale copy, so the
  // session you were handed straight after reporting a bad shoulder could
  // still contain overhead work. Any new reader of this data must use this key.
  const { data: activeInjuries = [] } = useQuery({
    queryKey: ['injuries', 'active', user?.id],
    queryFn:  () => listActiveInjuries(),
    enabled:  !!user?.id,
    staleTime: 5 * 60_000,
  });
  const excludeMuscleGroups = useMemo(
    () => getExcludedMuscleGroups(activeInjuries),
    [activeInjuries],
  );
  // The digest the language model reads instead of guessing. Fetched on mount
  // rather than inside handleSend so it is already warm when the user finishes
  // typing — otherwise every message paid for these reads before the request
  // to the Edge Function even started. Two minutes is well inside a chat
  // session and no workout can land mid-conversation without the user leaving.
  const { data: coachContext } = useQuery({
    // The injury rows are in the key, not just the derived set: two different
    // injuries can produce the same exclusion list, and the digest now carries
    // severity and age, so the cached digest has to age out when they change.
    queryKey: ['coachContext', user?.id, userProfile?.updated_at, activeInjuries.length, [...excludeMuscleGroups].join(',')],
    queryFn:  () => buildCoachContext({
      user,
      profile: userProfile || {},
      excludeMuscleGroups,
      activeInjuries,
    }),
    enabled:  !!user?.email,
    staleTime: 2 * 60_000,
  });
  const { tFallback, language } = useLanguage();
  const generateMode = mode === 'generate';
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  // Voice dictation state — the Mic icon swaps to MicOff with a pulse
  // while listening. Captures one phrase per tap (not continuous).
  const [voiceListening, setVoiceListening] = useState(false);
  const voiceSessionRef = useRef(null);
  // If the user changes the app language while a voice session is
  // active, stop the in-flight recognizer so the next phrase isn't
  // transcribed against the previous BCP-47 tag. The user can tap
  // the mic again to restart in the new language.
  useEffect(() => {
    if (voiceListening && voiceSessionRef.current) {
      try { voiceSessionRef.current.stop(); } catch { /* ignore */ }
      voiceSessionRef.current = null;
      setVoiceListening(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);
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
    const full = ta.scrollHeight;
    ta.style.height = Math.min(full, 140) + 'px';
    // Only show a scrollbar once the content actually exceeds the max height.
    // Otherwise border-box rounding makes scrollHeight edge just past the
    // client height and a 1–2px scrollbar renders as a stray vertical line.
    ta.style.overflowY = full > 140 ? 'auto' : 'hidden';
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

  // `displayAs` lets a follow-up chip send the full re-stated request while the
  // transcript shows what the user actually tapped. Without it the thread fills
  // with machine-shaped sentences ("give me a workout for today — max points for
  // my crew war, 90 minutes, dumbbells only") that nobody typed and that read as
  // the app talking to itself.
  const handleSend = async (textOverride, displayAs) => {
    const text = (textOverride ?? draft).trim();
    if (!text || thinking) return;
    setDraft('');
    stickToBottomRef.current = true;

    const userMsg = { role: 'user', text: displayAs || text, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setThinking(true);

    try {
      const result = await askCoach(user, text, {
        profile: userProfile || {},
        excludeMuscleGroups,
        coachContext: coachContext || {},
        language,
        // The thread so far, so the coach can follow "make it shorter" or
        // "why?" — the regex router parsed every message with no memory of
        // the previous one, which is most of why it felt robotic. Error
        // placeholders are excluded: they are UI state, not things the
        // coach said.
        history: messages.filter(m => m.source !== 'error').slice(-8),
      });
      // The daily cap is the one degradation worth naming. The reply below is
      // the rule-based one and still useful, but a coach that silently gets
      // simpler mid-conversation reads as the app breaking.
      if (result.capped) {
        toast.info(tFallback(
          'coach.capped',
          "You've hit today's limit for detailed answers — back to the basics until tomorrow.",
        ));
      }
      const reply = {
        role: 'coach',
        text: result.reply,
        ts: Date.now(),
        source: result.source,
        // A generated workout/plan rides along as a structured payload the
        // chat renders as an interactive, saveable card.
        plan: result.plan || null,
      };
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

  // Replace one message's plan in place. Indexed rather than keyed by id
  // because messages have no ids — but the list is append-only within a turn,
  // so an index is stable for as long as the card that holds it is mounted.
  const handlePlanChange = useCallback((index, plan) => {
    setMessages(prev => prev.map((m, i) => (i === index ? { ...m, plan } : m)));
  }, []);

  const isEmpty = messages.length === 0;

  const basePrompts = generateMode ? GENERATE_PROMPTS : SUGGESTED_PROMPTS;
  // Derived from the LAST plan in the thread, not the last message: a user who
  // asks a follow-up question after a workout should still see the chips for
  // that workout rather than lose them to an unrelated answer.
  const followUps = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.plan) return followUpsFor(messages[i].plan);
    }
    return [];
  }, [messages]);

  return (
    <ChatViewportFrame className="flex flex-col" minHeight={380}>
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
            <p className="text-micro text-muted-foreground">
              {tFallback('coach.subtitle', 'Personalized advice from your data')}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            aria-label="Clear chat"
            className="p-2.5 rounded-lg text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground transition-colors touch-manipulation"
          >
            <Trash2 className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain pe-1"
      >
        {isEmpty ? (
          <CoachWelcome onPick={handleSend} tFallback={tFallback} generateMode={generateMode} />
        ) : (
          <>
            {messages.map((m, i) => (
              <React.Fragment key={i}>
                <MessageBubble m={m} />
                {m.plan && (
                  <CoachPlanCard
                    plan={m.plan}
                    onSaveRegimen={onSaveRegimen}
                    onStartWorkout={onStartWorkout}
                    // Edits live on the message, not inside the card, so they
                    // survive a re-render and get persisted with the thread.
                    // A workout the user tuned and then lost by scrolling
                    // would be worse than not offering the edit at all.
                    onPlanChange={(plan) => handlePlanChange(i, plan)}
                  />
                )}
              </React.Fragment>
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
          horizontally-scrollable strip with arrow controls.

          Follow-ups for the plan the coach just built lead the strip, because
          right after a workout lands "45 min" and "Dumbbells only" are what
          the user actually wants; "Train for a faster 5K" is not. The static
          prompts stay behind them so nothing that used to be reachable stops
          being reachable. */}
      {!isEmpty && (
        <PromptStrip
          prompts={[...followUps, ...basePrompts.filter(p => !followUps.some(f => f.id === p.id))]}
          onPick={handleSend}
          disabled={thinking}
        />
      )}

      {/* Composer — a single rounded "shell" so the focus highlight wraps the
          whole control (textarea + buttons), not just the text field. The
          textarea itself is transparent/borderless with no inner ring or
          scrollbar so it never draws a stray line. */}
      <div className="pt-2 shrink-0">
        <div className="flex items-end gap-1 rounded-2xl border border-border bg-secondary/40 ps-3 pe-1.5 py-1.5 transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/40">
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
            className="flex-1 min-w-0 bg-transparent border-0 outline-none focus:outline-none focus:ring-0 resize-none overflow-hidden text-sm leading-snug py-1.5 caret-primary"
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
                'p-2 rounded-xl transition-colors shrink-0',
                voiceListening
                  ? 'bg-rose-500/15 text-rose-500'
                  : 'text-muted-foreground hover:text-foreground active:text-foreground hover:bg-background/60 active:bg-background/60',
              ].join(' ')}
            >
              {voiceListening ? <MicOff className="w-4 h-4 animate-pulse" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => handleSend()}
            disabled={thinking || !draft.trim()}
            aria-label="Send"
            className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-opacity shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
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
            <AlertDialogAction onClick={confirmClear} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/90">
              {tFallback('common.clear', 'Clear')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ChatViewportFrame>
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
        {/* The coach writes **bold** for the headline of each reply. Rendered
            as raw text those markers were pure noise on the one line that
            most needed to stand out. User messages are echoed verbatim — they
            are the user's own words, not our copy. */}
        {isUser ? m.text : parseBoldSegments(m.text).map((seg, i) => (
          seg.bold
            ? <strong key={i} className="font-semibold">{seg.text}</strong>
            : <React.Fragment key={i}>{seg.text}</React.Fragment>
        ))}
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
          className="absolute start-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-full bg-card border border-border shadow-sm text-muted-foreground hover:text-foreground active:text-foreground"
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
            // A follow-up chip's label is a shorthand ("45 min") while `send`
            // carries the full re-stated request, because each message is
            // parsed with no memory of the last one. Static prompts have no
            // `send` and are already complete sentences.
            onClick={() => onPick(p.send ?? p.text, p.send ? p.text : undefined)}
            disabled={disabled}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full border text-xs font-medium transition-colors disabled:opacity-50 ${
              p.send
                ? 'bg-primary/10 hover:bg-primary/20 active:bg-primary/20 border-primary/30 text-primary'
                : 'bg-secondary/60 hover:bg-secondary active:bg-secondary border-border/50'
            }`}
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
          className="absolute end-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-full bg-card border border-border shadow-sm text-muted-foreground hover:text-foreground active:text-foreground"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function CoachWelcome({ onPick, tFallback, generateMode }) {
  const prompts = generateMode ? GENERATE_PROMPTS : SUGGESTED_PROMPTS;
  const title = generateMode
    ? tFallback('coach.generate.title', 'What are you training for?')
    : tFallback('coach.welcome.title', 'Your personal coach');
  const desc = generateMode
    ? tFallback('coach.generate.desc', 'Tell me your goal and I’ll build a workout or a full plan you can save — try "train for a faster 5K" or "help me PR my bench."')
    : tFallback('coach.welcome.desc', "Ask me anything about your training. I read your actual workout data to give you specific advice.");
  return (
    <div className="flex flex-col items-center justify-center text-center pt-8 pb-4 px-2">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary via-fuchsia-500 to-violet-500 flex items-center justify-center mb-4">
        <Sparkles className="w-7 h-7 text-white" />
      </div>
      <h2 className="font-heading font-bold text-lg mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground mb-5 max-w-xs">{desc}</p>
      <div className="space-y-1.5 w-full max-w-sm">
        {prompts.map(p => (
          <button
            key={p.id}
            onClick={() => onPick(p.text)}
            className="w-full text-start px-3 py-2.5 rounded-lg bg-secondary/50 hover:bg-secondary active:bg-secondary border border-border/50 text-sm transition-colors"
          >
            {p.text}
          </button>
        ))}
      </div>
    </div>
  );
}
