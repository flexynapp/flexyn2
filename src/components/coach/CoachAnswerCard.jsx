// src/components/coach/CoachAnswerCard.jsx
//
// A Coach answer drawn as a small card instead of a paragraph (2026-10-02).
// Kegan's complaint was the reply to "Should I increase my squat weight?":
// five dense bullets nobody reads on a phone. The model now returns the parts
// (src/lib/aiCoach/coachCard.js) and this draws them:
//
//   headline   the answer, with a mark for what it tells you to do
//   points     one short line each; a point about a number gets a figure
//   next       the one thing to do now
//
// Every figure is drawn from the user's own logged data, resolved when the
// reply arrived. The model picks WHICH figure, never its value.
//
// Read-only data, not a user-arranged object, so the parts sit on hairlines
// inside the bubble rather than in nested cards (CLAUDE.md, UI composition).
// Hues: primary for effort (sessions, food logged, lifts), info for recovery
// (readiness, sleep, soreness), success for a go-ahead. Nothing else.

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, ArrowRight, Pause, Hourglass, HeartPulse } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { cleanCoachText } from '@/lib/aiCoach/markdownLite';
import { DURATION, EASE_OUT, SPRING, STAGGER, staggerContainer, staggerItem } from '@/lib/motion';
import FigureRow, { FigureColumn, FigureValue } from '@/components/ui/FigureRow';

const TONE = {
  go:   { Icon: ArrowUp,    cls: 'bg-success/15 text-success', key: 'coach.tone.go',   en: 'Go ahead' },
  hold: { Icon: Pause,      cls: 'bg-primary/15 text-primary', key: 'coach.tone.hold', en: 'Hold steady' },
  wait: { Icon: Hourglass,  cls: 'bg-muted text-muted-foreground', key: 'coach.tone.wait', en: 'Not yet' },
  care: { Icon: HeartPulse, cls: 'bg-info/15 text-info', key: 'coach.tone.care', en: 'Take it easy' },
};

// Answer tier of the app's motion rules: every number comes from
// src/lib/motion.js. Each row arrives just after the one above it, so the
// answer reads in the order it was written: verdict, reasons, what to do.
// The step is wider than the list default so four rows read as a sequence.
const ROW_STEP = STAGGER * 2;
const list = staggerContainer({ stagger: ROW_STEP });
const row = staggerItem;

/**
 * @param {object}  props
 * @param {object}  props.card   resolved card ({ tone, headline, points, next })
 * @param {boolean} [props.animate] play the arrival; false for history
 */
export default function CoachAnswerCard({ card, animate = true }) {
  const { tFallback } = useLanguage();
  const reduce = useReducedMotion();
  const play = animate && !reduce;
  const tone = TONE[card.tone];

  return (
    <motion.div
      variants={list}
      initial={play ? 'hidden' : false}
      animate="show"
      className="flex flex-col"
      data-coach-card=""
    >
      {card.headline && (
        <motion.div variants={row} className="flex items-start gap-2">
          {tone && (
            <span
              role="img"
              aria-label={tFallback(tone.key, tone.en)}
              className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full ${tone.cls}`}
            >
              <tone.Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
            </span>
          )}
          <p className="font-heading text-body font-semibold leading-snug">{cleanCoachText(card.headline)}</p>
        </motion.div>
      )}

      {card.points.length > 0 && (
        <ul className="mt-2 flex flex-col divide-y divide-border/60 border-t border-border/60">
          {card.points.map((p, i) => (
            <FigureRow
              key={i}
              as={motion.li}
              variants={row}
              column={p.viz && <Figure viz={p.viz} play={play} delay={(i + 1) * ROW_STEP + DURATION.fast} />}
            >
              {cleanCoachText(p.text)}
            </FigureRow>
          ))}
        </ul>
      )}

      {card.next && (
        <motion.p
          variants={row}
          className={`flex items-start gap-2 text-sm font-medium leading-snug ${card.points.length ? 'border-t border-border/60 pt-2' : 'mt-2'}`}
        >
          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary rtl:scale-x-[-1]" aria-hidden="true" />
          <span className="min-w-0">{cleanCoachText(card.next)}</span>
        </motion.p>
      )}
    </motion.div>
  );
}

// ── Figures ────────────────────────────────────────────────────────────
// One fixed-width column, value over a small graphic over a label, so the
// eye finds the numbers down the left edge and the reasons to their right.

function Figure({ viz, play, delay }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const n = (v, d = 0) => fmt(v, { maximumFractionDigits: d });

  let value = null;
  let unit = null;
  let graphic = null;
  let label = null;

  switch (viz.type) {
    case 'week_sessions': {
      const total = Math.min(7, Math.max(viz.target || 7, viz.done));
      value = n(viz.done);
      unit = viz.target ? `/${n(viz.target)}` : null;
      graphic = <Dots total={total} filled={Math.min(viz.done, total)} hue="bg-primary" play={play} delay={delay} />;
      label = tFallback('coach.viz.thisWeek', 'this week');
      break;
    }
    case 'readiness':
      return (
        <FigureColumn label={tFallback('coach.viz.readiness', 'readiness')}>
          <Ring pct={viz.score} play={play} delay={delay}>{n(viz.score)}</Ring>
        </FigureColumn>
      );
    case 'sleep':
      value = n(viz.hours, 1);
      unit = 'h';
      label = tFallback('coach.viz.sleepAvg', 'sleep avg');
      break;
    case 'soreness':
      value = n(viz.value);
      unit = '/5';
      graphic = <Bars total={5} filled={viz.value} play={play} delay={delay} />;
      label = tFallback('coach.viz.soreness', 'soreness');
      break;
    case 'calories':
      value = n(viz.kcal);
      unit = 'kcal';
      graphic = <Dots total={7} filled={viz.days} hue="bg-primary" play={play} delay={delay} />;
      label = tFallback('coach.viz.daysLogged', '{n} of 7 days', { n: n(viz.days) });
      break;
    case 'protein':
      value = n(viz.grams);
      unit = 'g';
      label = tFallback('coach.viz.proteinAvg', 'protein avg');
      break;
    case 'muscle_sets':
      value = n(viz.sets);
      unit = tFallback('coach.viz.setsUnit', 'sets');
      label = tFallback('coach.viz.muscle14d', '{muscle}, 14 days', {
        muscle: tFallback(`suggestion.group.${viz.muscle}`, viz.muscle),
      });
      break;
    case 'top_lift':
      value = n(viz.weight, 1);
      unit = viz.units;
      label = viz.reps
        ? tFallback('coach.viz.bestSetReps', 'best set × {n}', { n: n(viz.reps) })
        : tFallback('coach.viz.bestSet', 'best set');
      break;
    case 'body_trend':
      value = n(viz.current, 1);
      unit = viz.units;
      label = viz.change != null && viz.overDays
        ? tFallback('coach.viz.changeOver', '{change} in {n} days', {
          change: `${viz.change > 0 ? '+' : ''}${n(viz.change, 1)}`,
          n: n(viz.overDays),
        })
        : tFallback('coach.viz.bodyweight', 'bodyweight');
      break;
    case 'cardio':
      value = n(viz.sessions);
      label = tFallback('coach.viz.cardio14d', 'cardio, 14 days');
      break;
    case 'streak':
      value = n(viz.days);
      label = tFallback('dashboard.dayStreak', 'day streak');
      break;
    default:
      return null;
  }

  return (
    <FigureColumn label={label}>
      <FigureValue figure={value} unit={unit} />
      {graphic}
    </FigureColumn>
  );
}

// Days as dots: filled ones land one after another, so "1 of 3" is seen as
// two still to go, not read as a fraction.
function Dots({ total, filled, hue, play, delay }) {
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="relative h-1.5 w-1.5 rounded-full bg-foreground/15">
          {i < filled && (
            <motion.span
              className={`absolute inset-0 rounded-full ${hue}`}
              initial={play ? { scale: 0 } : false}
              animate={{ scale: 1 }}
              transition={{ ...SPRING.pop, delay: delay + i * STAGGER }}
            />
          )}
        </span>
      ))}
    </span>
  );
}

function Bars({ total, filled, play, delay }) {
  return (
    <span className="flex items-end gap-0.5" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="relative w-1.5 overflow-hidden rounded-sm bg-foreground/15" style={{ height: 4 + i * 2 }}>
          {i < filled && (
            <motion.span
              className="absolute inset-0 origin-bottom bg-info"
              initial={play ? { scaleY: 0 } : false}
              animate={{ scaleY: 1 }}
              transition={{ delay: delay + i * STAGGER, duration: DURATION.fast, ease: EASE_OUT }}
            />
          )}
        </span>
      ))}
    </span>
  );
}

// The readiness score is the one figure the Dashboard already draws as a
// ring, so it keeps that shape here.
function Ring({ pct, play, delay, children }) {
  const r = 17;
  return (
    <span className="relative grid h-10 w-10 place-items-center">
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="3.5" className="stroke-foreground/15" />
        <motion.circle
          cx="20" cy="20" r={r} fill="none" strokeWidth="3.5" strokeLinecap="round"
          className="stroke-info"
          initial={play ? { pathLength: 0 } : false}
          animate={{ pathLength: pct / 100 }}
          transition={{ delay, duration: DURATION.slow, ease: EASE_OUT }}
        />
      </svg>
      <span className="font-heading text-sm font-semibold tabular-nums">{children}</span>
    </span>
  );
}
