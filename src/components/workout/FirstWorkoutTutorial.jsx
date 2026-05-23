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

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ChevronRight, X } from 'lucide-react';

const LS_KEY = (userId) => `flexyn.firstWorkoutTutorial.${userId || 'anon'}`;

const STEPS = [
  {
    title: 'Welcome to your first workout',
    body:  "Your AI Coach pre-loaded the exercises. Tap a set row to start logging.",
  },
  {
    title: 'Enter weight + reps per set',
    body:  'Each row has a weight field and a reps field. The last set from prior sessions seeds future workouts automatically.',
  },
  {
    title: 'Tap "Save workout" when finished',
    body:  'The big button at the bottom of the page saves the session, awards XP, and updates your streak. You\'re all set!',
  },
];

export function hasSeenFirstWorkoutTutorial(userId) {
  try { return localStorage.getItem(LS_KEY(userId)) === 'dismissed'; }
  catch { return false; }
}

export default function FirstWorkoutTutorial({ userId, onClose }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(true);

  // Persist dismissal once — covers both "Got it" on the last step and
  // any other dismiss path (X button, Skip). Effect (not callback) so a
  // parent forcibly unmounting us still records the flag.
  useEffect(() => () => {
    try { localStorage.setItem(LS_KEY(userId), 'dismissed'); } catch { /* ignore */ }
  }, [userId]);

  const handleNext = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else handleDismiss();
  };

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => onClose?.(), 250);
  };

  const current = STEPS[step] || STEPS[0];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          className="fixed left-2 right-2 sm:left-4 sm:right-4 z-40 pointer-events-none"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0) + 72px)' }}
        >
          <div className="max-w-md mx-auto pointer-events-auto">
            <div className="relative rounded-2xl bg-card border border-primary/35 shadow-2xl shadow-primary/15 overflow-hidden">
              {/* Subtle radial accent so the card pops over the workout
                  view without being visually noisy. */}
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl bg-primary/25 pointer-events-none" />

              <div className="relative p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                        Tip {step + 1} / {STEPS.length}
                      </span>
                    </div>
                    <h3 className="font-heading font-bold text-sm leading-tight">
                      {current.title}
                    </h3>
                    <p className="text-xs text-muted-foreground leading-snug mt-1">
                      {current.body}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDismiss}
                    aria-label="Dismiss tutorial"
                    className="w-7 h-7 rounded-full bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    {STEPS.map((_, i) => (
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
                    {step < STEPS.length - 1 && (
                      <button
                        type="button"
                        onClick={handleDismiss}
                        className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground px-2 py-1"
                      >
                        Skip
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleNext}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold"
                    >
                      {step < STEPS.length - 1 ? 'Next' : 'Got it'}
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
