// src/components/workout/FirstWorkoutTutorial.jsx
//
// Three-step coach-mark banner shown on the user's very first active
// workout session. Mounts when:
//   • the parent is rendering the active-workout view (started === true), AND
//   • logs.length === 0 (truly first session), AND
//   • localStorage flag `flexyn.firstWorkoutTutorial.<userId>` is unset
//
// Auto-dismisses when the user taps "Got it" on the last step or hits the
// Skip link. We persist a per-user flag so the tutorial never re-shows
// after the first session, even if the user cancels mid-flow without
// saving.

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ChevronRight, X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

const LS_KEY = (userId) => `flexyn.firstWorkoutTutorial.${userId || 'anon'}`;

const STEP_KEYS = [
  { titleKey: 'workout.tutorial.step1.title', titleFallback: 'Welcome to your first workout',
    bodyKey:  'workout.tutorial.step1.body',  bodyFallback:  "Your AI Coach pre-loaded the exercises. Tap a set row to start logging." },
  { titleKey: 'workout.tutorial.step2.title', titleFallback: 'Enter weight + reps per set',
    bodyKey:  'workout.tutorial.step2.body',  bodyFallback:  'Each row has a weight field and a reps field. The last set from prior sessions seeds future workouts automatically.' },
  { titleKey: 'workout.tutorial.step3.title', titleFallback: 'Tap "Save workout" when finished',
    bodyKey:  'workout.tutorial.step3.body',  bodyFallback:  'The big button at the bottom of the page saves the session, awards XP, and updates your streak.' },
];

export function hasSeenFirstWorkoutTutorial(userId) {
  try { return localStorage.getItem(LS_KEY(userId)) === 'dismissed'; }
  catch { return false; }
}

export default function FirstWorkoutTutorial({ userId, onClose }) {
  const { tFallback } = useLanguage();
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(true);
  // Track whether the dismiss was EXPLICIT (user finished steps OR
  // tapped X) vs. INCIDENTAL (parent route-change unmount, StrictMode
  // double-mount). The previous version persisted dismissal on EVERY
  // unmount via the effect-cleanup pattern, so a user who navigated
  // away mid-step-1 permanently lost steps 2 + 3. (Audit 09 #C-4.)
  const dismissedExplicitlyRef = useRef(false);

  useEffect(() => () => {
    if (!dismissedExplicitlyRef.current) return;
    try { localStorage.setItem(LS_KEY(userId), 'dismissed'); } catch { /* ignore */ }
  }, [userId]);

  const handleNext = () => {
    if (step < STEP_KEYS.length - 1) setStep(s => s + 1);
    else handleDismiss();
  };

  const handleDismiss = () => {
    dismissedExplicitlyRef.current = true;
    setVisible(false);
    setTimeout(() => onClose?.(), 250);
  };

  const current = STEP_KEYS[step] || STEP_KEYS[0];
  const currentTitle = tFallback(current.titleKey, current.titleFallback);
  const currentBody  = tFallback(current.bodyKey,  current.bodyFallback);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          className="fixed start-2 end-2 sm:start-4 sm:end-4 z-40 pointer-events-none"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0) + 72px)' }}
        >
          <div className="max-w-md mx-auto pointer-events-auto">
            <div className="relative rounded-2xl bg-card border border-primary/35 shadow-2xl shadow-primary/15 overflow-hidden">
              {/* Subtle radial accent so the card pops over the workout
                  view without being visually noisy. */}
              <div className="absolute -top-10 -end-10 w-40 h-40 rounded-full blur-3xl bg-primary/25 pointer-events-none" />

              <div className="relative p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-micro font-bold uppercase tracking-[0.18em] text-primary">
                        {tFallback('workout.tutorial.step', 'Tip {n} / {total}')
                          .replace('{n}', step + 1)
                          .replace('{total}', STEP_KEYS.length)}
                      </span>
                    </div>
                    <h3 className="font-heading font-bold text-sm leading-tight">
                      {currentTitle}
                    </h3>
                    <p className="text-xs text-muted-foreground leading-snug mt-1">
                      {currentBody}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDismiss}
                    aria-label={tFallback('workout.tutorial.dismiss', 'Dismiss tutorial')}
                    className="w-7 h-7 rounded-full bg-secondary/60 hover:bg-secondary active:bg-secondary text-muted-foreground hover:text-foreground active:text-foreground flex items-center justify-center shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    {STEP_KEYS.map((_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 rounded-full transition-all ${
                          i === step
                            ? 'w-5 bg-primary'
                            : i < step
                              ? 'w-1.5 bg-primary/60'
                              : 'w-1.5 bg-muted'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    {step < STEP_KEYS.length - 1 && (
                      <button
                        type="button"
                        onClick={handleDismiss}
                        className="text-micro font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground active:text-foreground px-2 py-1"
                      >
                        {tFallback('workout.tutorial.skip', 'Skip')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleNext}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold"
                    >
                      {step < STEP_KEYS.length - 1
                        ? tFallback('workout.tutorial.next', 'Next')
                        : tFallback('workout.tutorial.gotIt', 'Got it')}
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
