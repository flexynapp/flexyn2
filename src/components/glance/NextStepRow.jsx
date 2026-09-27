// src/components/glance/NextStepRow.jsx
//
// One moment from the user's own data, under a page's focal goal: the PR
// they set on Tuesday, today being a day they planned to train, the session
// worth repeating. The page builds the candidates from what it already
// fetched; src/lib/nextStep.js picks one. See that file for the rules.
//
// Why a row and not a banner: the carousels this replaces gave every feature
// a full hero slide on a timer, so the page had no focal point and the
// relevant door was visible a fifth of the time. This is one line, it holds
// still for the whole visit, and it can be waved away.
//
// The action is a text link in --primary, not a filled button: it is the
// page's one action, and a fill would compete with the ring above it.
//
// Renders nothing when there is no candidate, including before the page's
// data has loaded (`ready` false), so eligibility is never judged on the
// empty defaults a query hands back while it is still in flight.

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { track, EVENTS } from '@/lib/analytics';
import { pickNextStep, readNextStepDismissed, markNextStepDismissed } from '@/lib/nextStep';

const TILE_TONE = {
  success: 'bg-success/10 text-success',
  neutral: 'bg-secondary text-foreground',
};

/**
 * @param {object} props
 * @param {string} props.page         analytics key, e.g. 'progress'
 * @param {string} [props.userId]
 * @param {boolean} [props.ready]     false while the data behind eligibility loads
 * @param {Array<{id: string, kind: string, eligible: boolean, priority: number,
 *   icon: React.ComponentType, tone?: 'success'|'neutral', title: string,
 *   reason?: string, actionLabel: string, onOpen: () => void}>} props.candidates
 * @param {string} [props.className]
 */
export default function NextStepRow({ page, userId, ready = true, candidates = [], className = '' }) {
  const { tFallback } = useLanguage();
  // The pick is made ONCE per visit and held: undefined = not decided yet,
  // null = decided, nothing to offer.
  const [pickedId, setPickedId] = useState(undefined);
  const [dismissed, setDismissed] = useState(false);
  const decided = useRef(false);

  useEffect(() => {
    if (!ready || decided.current) return;
    decided.current = true;
    const pick = pickNextStep({ candidates, now: Date.now(), dismissed: readNextStepDismissed(userId) });
    setPickedId(pick ? pick.id : null);
    // `kind`, not `id`: the id carries an exercise name and a date, which is
    // the user's data and has no business in an analytics payload.
    if (pick) track(EVENTS.NEXT_STEP_SHOWN, { page, id: pick.kind });
  }, [ready, candidates, userId, page]);

  if (!pickedId || dismissed) return null;
  // Read the live candidate by id so `onOpen` is the current render's
  // handler, not a closure from the render that made the pick.
  const step = candidates.find((c) => c.id === pickedId);
  if (!step) return null;
  const Icon = step.icon;

  const open = () => {
    track(EVENTS.NEXT_STEP_OPENED, { page, id: step.kind });
    step.onOpen?.();
  };

  const notNow = () => {
    markNextStepDismissed(userId, step.id);
    track(EVENTS.NEXT_STEP_DISMISSED, { page, id: step.kind });
    setDismissed(true);
  };

  return (
    <div
      className={`flex items-center gap-2 py-2 ps-3 pe-1 rounded-2xl border border-border bg-card text-card-foreground ${className}`}
      data-testid="next-step-row"
    >
      {Icon && (
        <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${TILE_TONE[step.tone] || TILE_TONE.neutral}`} aria-hidden="true">
          <Icon className="w-[18px] h-[18px]" />
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-sm font-bold leading-tight text-foreground">{step.title}</span>
        {step.reason && (
          <span className="text-caption text-muted-foreground leading-snug">{step.reason}</span>
        )}
      </div>
      <button
        type="button"
        onClick={open}
        className="shrink-0 min-h-[44px] px-2 inline-flex items-center text-label font-bold text-primary hover:text-primary/80 active:text-primary/80 transition-colors"
      >
        {step.actionLabel}
      </button>
      <button
        type="button"
        onClick={notNow}
        aria-label={tFallback('nextStep.notNow', 'Not now')}
        title={tFallback('nextStep.notNow', 'Not now')}
        className="shrink-0 w-11 h-11 -ms-1 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
