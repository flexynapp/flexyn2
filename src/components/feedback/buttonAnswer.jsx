// src/components/feedback/buttonAnswer.jsx
//
// "The button answers": the pressed button confirms its own action instead
// of raising a message somewhere else. On success its label turns into a
// drawn check and a past-tense word ("Added", "Logged") for ANSWER_MS, then
// goes back. On failure it turns into an outlined "Didn't save" that stays
// until the next press, and `reason` carries the sentence to show under it.
//
// Kegan picked this pattern on 2026-09-27 and, on seeing the result, asked
// that it stay subtle: "I like that it looks subtle while displaying the
// necessary information." So: one colour change, one check, no confetti.
//
//   const answer = useButtonAnswer();
//   <Button className={answerClassName(answer.phase)} onClick={...}>
//     <AnswerLabel phase={answer.phase} idle="Log meal" done="Logged" failed="Didn't save" />
//   </Button>
//   {answer.reason && <AnswerReason>{answer.reason}</AnswerReason>}
//
// When a button answers, its action must NOT also send a toast; that is the
// whole point.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import DrawnCheck from '@/components/feedback/DrawnCheck';
import { triggerHaptic } from '@/lib/haptic';

export const ANSWER_MS = 1200;

export function useButtonAnswer() {
  const [phase, setPhase] = useState('idle'); // idle | done | failed
  const [reason, setReason] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    setPhase('idle');
    setReason(null);
  }, []);

  const succeed = useCallback(() => {
    clearTimeout(timer.current);
    setReason(null);
    setPhase('done');
    triggerHaptic('success');
    timer.current = setTimeout(() => setPhase('idle'), ANSWER_MS);
  }, []);

  const fail = useCallback((why = null) => {
    clearTimeout(timer.current);
    setReason(why);
    setPhase('failed');
    triggerHaptic('warning');
  }, []);

  return { phase, reason, succeed, fail, reset };
}

// Classes layered onto a primary <Button>. Failed drops the fill for a red
// outline so it reads as "this did not happen" rather than as a second,
// angrier call to action.
export function answerClassName(phase) {
  if (phase === 'done') return 'bg-success text-success-foreground hover:bg-success active:bg-success';
  if (phase === 'failed') return 'bg-transparent border border-destructive text-destructive hover:bg-transparent active:bg-transparent';
  return '';
}

export function AnswerLabel({ phase, idle, done, failed }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={phase}
        className="inline-flex items-center gap-2"
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.15 }}
      >
        {phase === 'done' && <DrawnCheck className="w-5 h-5" halo={false} />}
        {phase === 'done' ? done : phase === 'failed' ? failed : idle}
      </motion.span>
    </AnimatePresence>
  );
}

export function AnswerReason({ children, tone = 'error' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`text-sm ${tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {children}
    </p>
  );
}
