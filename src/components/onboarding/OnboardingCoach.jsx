// src/components/onboarding/OnboardingCoach.jsx
//
// The AI Coach, available on every onboarding step.
//
// Two exports:
//   <OnboardingCoachButton /> — the Sparkles trigger. Sparkles is the app's
//     coach mark everywhere else (Layout's nav rail, the Coach page), so it
//     has to be the mark here too or it reads as a different feature.
//   <OnboardingCoachSheet />  — the panel it opens.
//
// Deliberately NOT CoachChat. That component fetches the user's profile,
// their active injuries and their workout history, and renders plan cards —
// during initial onboarding none of that exists yet (the profile row is
// written at the very end of the flow), so every query would fire, miss, and
// the whole thing would render empty states. This is a light sheet over the
// pure `onboardingCoach` module instead.
//
// The part that earns its place is `apply`: when the coach's answer resolves
// to an actual selection ("that reads as Build strength"), the reply carries
// a button that MAKES the selection. Advice you then have to go and re-enter
// by hand is most of the way to being no help at all.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Send, X, Check } from 'lucide-react';
import { answerOnboarding, introFor, promptsFor, hasCoachFor } from '@/lib/aiCoach/onboardingCoach';
import { parseBoldSegments } from '@/lib/aiCoach/markdownLite';

const MAX_INPUT = 500;

/**
 * Sparkles trigger. Sits in the top-right corner of an onboarding card.
 *
 * `size="sm"` is for the nutrition modal, whose chrome is tighter and whose
 * own close X is already in that corner.
 */
export function OnboardingCoachButton({ onClick, className = '', size = 'lg' }) {
  const box = size === 'sm' ? 'w-9 h-9 rounded-lg' : 'w-11 h-11 rounded-xl';
  const glyph = size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Ask the AI Coach"
      className={`${box} border border-primary/30 bg-primary/10 backdrop-blur-sm flex items-center justify-center text-primary hover:bg-primary/20 active:scale-95 transition-all shrink-0 ${className}`}
    >
      <Sparkles className={glyph} strokeWidth={2.2} />
    </button>
  );
}

/** One rendered line of coach copy — supports **bold** and bullet lines. */
function CoachLine({ text }) {
  return text.split('\n').map((line, i) => {
    if (line.trim() === '') return <div key={i} className="h-2" />;
    const bullet = line.startsWith('• ');
    const body = bullet ? line.slice(2) : line;
    return (
      <p key={i} className={`text-sm leading-relaxed ${bullet ? 'ps-3.5 -indent-3.5' : ''}`}>
        {bullet && <span className="text-primary">• </span>}
        {parseBoldSegments(body).map((seg, j) =>
          seg.bold
            ? <strong key={j} className="font-semibold text-foreground">{seg.text}</strong>
            : <span key={j}>{seg.text}</span>,
        )}
      </p>
    );
  });
}

/**
 * The coach panel.
 *
 * @param {string}   stepId   which onboarding step the user is looking at
 * @param {object}   draft    what they've answered so far (read-only here)
 * @param {function} onApply  receives { field, value, label } when the user
 *                            accepts a suggestion. Omit it and suggestions
 *                            render as plain advice with no Apply button.
 */
export function OnboardingCoachSheet({ open, onClose, stepId, draft = {}, onApply }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [applied, setApplied] = useState({});
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const prompts = useMemo(() => promptsFor(stepId, draft), [stepId, draft]);

  // Reset on open and on step change: the conversation is about THIS
  // question. Carrying "pick Build strength" across into the injury step
  // would leave stale advice sitting above an unrelated question.
  useEffect(() => {
    if (!open) return;
    setMessages([{ role: 'coach', text: introFor(stepId, draft) }]);
    setInput('');
    setApplied({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const ask = (text) => {
    const q = String(text || '').trim().slice(0, MAX_INPUT);
    if (!q) return;
    const answer = answerOnboarding({ stepId, draft, message: q });
    setMessages(prev => [
      ...prev,
      { role: 'user', text: q },
      { role: 'coach', text: answer.reply, apply: answer.apply },
    ]);
    setInput('');
  };

  const handleApply = (apply, idx) => {
    onApply?.(apply);
    setApplied(prev => ({ ...prev, [idx]: true }));
  };

  if (!hasCoachFor(stepId)) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            role="dialog"
            aria-label="AI Coach"
            className="fixed inset-x-0 bottom-0 z-[61] mx-auto w-full max-w-[420px] rounded-t-3xl border-t border-x border-border bg-card shadow-2xl flex flex-col"
            // 82dvh, not vh: the sheet holds a text input, and on iOS the
            // keyboard shrinks the dynamic viewport but not the static one.
            style={{ maxHeight: '82dvh' }}
          >
            <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-border/60">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-heading font-bold text-sm leading-tight">AI Coach</p>
                <p className="text-[11px] text-muted-foreground leading-tight">Here to help you set this up</p>
              </div>
              <button
                type="button" onClick={onClose} aria-label="Close coach"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                  {m.role === 'user' ? (
                    <p className="max-w-[85%] rounded-2xl rounded-ee-md bg-primary text-primary-foreground px-3.5 py-2 text-sm">
                      {m.text}
                    </p>
                  ) : (
                    <div className="max-w-[95%] rounded-2xl rounded-es-md bg-secondary/60 px-3.5 py-2.5 text-foreground/90">
                      <CoachLine text={m.text} />
                      {m.apply && onApply && (
                        <button
                          type="button"
                          onClick={() => handleApply(m.apply, i)}
                          disabled={!!applied[i]}
                          className="mt-2.5 w-full rounded-lg bg-primary text-primary-foreground text-xs font-bold py-2 px-3 flex items-center justify-center gap-1.5 disabled:opacity-60 hover:opacity-90 transition-opacity"
                        >
                          {applied[i]
                            ? <><Check className="w-3.5 h-3.5" /> Applied</>
                            : <><Sparkles className="w-3.5 h-3.5" /> {m.apply.label}</>}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Starter chips, only while the user hasn't asked anything —
                  once there's a conversation they're just noise. */}
              {messages.length <= 1 && prompts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {prompts.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => ask(p.text)}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground/80 hover:border-primary/50 hover:text-foreground transition-colors"
                    >
                      {p.text}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); ask(input); }}
              className="flex items-center gap-2 px-4 py-3 border-t border-border/60"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT))}
                placeholder="Ask, or describe yourself…"
                aria-label="Ask the AI Coach"
                className="flex-1 min-w-0 h-10 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:border-primary/60"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send"
                className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default OnboardingCoachSheet;
