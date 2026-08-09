// src/components/onboarding/StarterPlanCoachCard.jsx
//
// The onboarding reveal's plan, presented as the AI Coach's suggestion.
//
// The plan itself is unchanged — `StarterPlanView` over the regimen that
// `buildStarterRegimen` produced and that onboarding actually persists. What
// this adds is the frame: the Coach mark, the model's own two sentences on why
// this plan suits this person, and an attribution line saying which model
// wrote them.
//
// ── Why not reuse CoachPlanCard ─────────────────────────────────────────────
//
// It carries "Start workout", "Schedule it" and "Save as regimen". All three
// are wrong here: onboarding saves the regimen itself on submit, so a Save
// button would either duplicate the row or sit there claiming credit for work
// that already happened, and there is nowhere to navigate to mid-flow. The
// visual language is deliberately the same — Sparkles mark, primary-tinted
// hairline, plan underneath — so the two read as one feature.
//
// ── Attribution is conditional, and that is the point ───────────────────────
//
// The model line renders ONLY when a model actually replied. The Coach's whole
// pipeline is built to degrade to deterministic output when the Edge Function
// is absent (see starterPlanCoach.js), and a badge that says "Claude Haiku"
// over a plan Haiku never saw is a lie the user has no way to detect.

import React from 'react';
import { Sparkles } from 'lucide-react';
import StarterPlanView from '@/components/workout/StarterPlanView';
import { parseBoldSegments } from '@/lib/aiCoach/markdownLite';
import { modelLabel } from '@/lib/aiCoach/starterPlanCoach';

/** The coach's prose. Supports the one construct the app renders: **bold**. */
function CoachProse({ text }) {
  return String(text)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => (
      <p key={i} className="text-caption leading-relaxed text-foreground/85">
        {parseBoldSegments(line).map((seg, j) =>
          seg.bold
            ? <strong key={j} className="font-semibold text-foreground">{seg.text}</strong>
            : <span key={j}>{seg.text}</span>,
        )}
      </p>
    ));
}

/**
 * @param {object}      regimen  the starter regimen being previewed and saved
 * @param {string|null} coachReply  the model's intro, or null on any fallback
 * @param {string|null} coachModel  model id from the reply, for attribution
 */
export default function StarterPlanCoachCard({ regimen, coachReply = null, coachModel = null }) {
  const label = modelLabel(coachModel);

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-2.5 space-y-2.5">
      <div className="flex items-center gap-2.5 px-1 pt-0.5">
        <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-primary" strokeWidth={2.2} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-heading font-bold text-label leading-tight">AI Coach</span>
          <span className="block text-micro text-muted-foreground leading-tight">
            {coachReply
              ? 'Your starter plan, built around your answers'
              : 'Your starter plan'}
          </span>
        </span>
      </div>

      {coachReply && (
        // The one genuinely personal thing on the screen, so it leads — above
        // the plan, not tucked under it as a caption.
        //
        // NO entrance animation of its own. It had one, and it rendered at
        // opacity 0 — the reveal step already wraps this whole block in a
        // delayed motion.div, so this was a second entrance nested inside a
        // first, and when the inner one failed to run the coach's write-up was
        // invisible with nothing on screen to say why. The most important copy
        // on the screen does not get to depend on an animation finishing.
        <div className="px-1 space-y-1.5">
          <CoachProse text={coachReply} />
          {label && (
            <p className="text-micro text-muted-foreground/80">
              Written by {label}
            </p>
          )}
        </div>
      )}

      <StarterPlanView regimen={regimen} />
    </div>
  );
}
