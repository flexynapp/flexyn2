// src/components/today/TodayTraining.jsx
//
// The training half of the Today page redesign (proposal, Oct 2026). Kegan:
// "the dashboard/today page could look and feel more functional for users,
// especially focusing on the training portion of the app". Three whole-page
// options are drawn from these parts on /preview/today-page; nothing here is
// mounted on the live Today page until one is picked.
//
//   SessionCard     today's session as one card, lead lift first (option A)
//   SessionLineup   the lifts as a row of figures, for the hero (option B)
//   SessionLead     the first lift as the page's focal figure (option C)
//   LiftProgress    estimated max on the lifts in today's session
//   LogStrip        the five daily logs as one row of rings
//   TodoPeek        quests and goals folded into one row
//
// Every weight arrives in lbs (todaySession.js) and is shown in the user's
// unit. Figures are the app's own posed figure (ExerciseFigure); a lift we
// have not drawn yet shows the Dumbbell, never someone else's movement.

import React, { useContext, useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight, ArrowUp, ChevronRight, Dumbbell, Utensils, Droplet, Moon, Smile, Footprints, ListChecks,
} from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { translateExerciseName } from '@/lib/exerciseTranslations';
import { posesFor } from '@/lib/data/exercisePoses';
import { anchorFor } from '@/lib/exerciseFigureGeometry';
import ExerciseFigure from '@/components/exercise/ExerciseFigure';
import FocalRing from '@/components/glance/FocalRing';
import { DRAW_S, DRAW_EASE, SETTLE_WAIT_S, TrendTimeScale } from '@/components/glance/TrendGraph';

// ── Shared ───────────────────────────────────────────────────────────────

/** Weight in the user's unit: whole pounds, kilograms to the half. */
function useWeight() {
  const { weightUnit } = useWeightUnit();
  const fmt = useNumberFormatter();
  const kg = weightUnit === 'kg';
  const num = (lbs) => {
    if (lbs == null) return null;
    const v = fromLbs(lbs, weightUnit);
    return fmt(kg ? Math.round(v * 2) / 2 : Math.round(v));
  };
  return { num, unit: kg ? 'kg' : 'lb', kg };
}

/** The lift's middle frame, the position the movement is about. */
export function LiftFigure({ name, className = '', accent = false }) {
  const poses = posesFor(name);
  if (!poses?.frames?.length) {
    return (
      <span className={`flex items-center justify-center text-muted-foreground ${className}`} aria-hidden="true">
        <Dumbbell className="w-1/2 h-1/2" strokeWidth={1.75} />
      </span>
    );
  }
  const frames = poses.frames;
  return (
    <ExerciseFigure
      pose={frames[1] || frames[0]}
      anchor={anchorFor(frames[0])}
      accent={accent}
      className={className}
    />
  );
}

function useLiftName() {
  const { language } = useLanguage();
  return (name) => translateExerciseName(name, language);
}

/** "+5" in success when the bar goes up, nothing otherwise. */
function Change({ lift, className = '' }) {
  const { weightUnit } = useWeightUnit();
  const fmt = useNumberFormatter();
  if (lift.change !== 'up' || lift.last == null || lift.weight == null) return null;
  // The difference in the user's unit, from the two rounded figures, so
  // "190 to 195" never reads as "+4.5".
  const kg = weightUnit === 'kg';
  const r = (v) => (kg ? Math.round(fromLbs(v, weightUnit) * 2) / 2 : Math.round(v));
  const diff = r(lift.weight) - r(lift.last);
  if (!(diff > 0)) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 text-micro font-bold tabular-nums text-success ${className}`}>
      <ArrowUp className="w-3 h-3" strokeWidth={2.5} aria-hidden="true" />
      {fmt(diff)}
    </span>
  );
}

function setsReps(lift) {
  return lift.reps ? `${lift.sets} × ${lift.reps}` : `${lift.sets} ×`;
}

export function StartButton({ label, onStart, kicker }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onClick={onStart}
      className="group w-full min-h-[44px] rounded-2xl px-3 py-2.5 bg-primary text-primary-foreground shadow-md flex items-center justify-between gap-2 text-start"
    >
      <span className="min-w-0">
        {kicker && <span className="block mb-1 text-label font-medium text-primary-foreground/80">{kicker}</span>}
        <span className="block font-heading font-bold text-lg leading-tight break-anywhere">{label}</span>
      </span>
      <span className="shrink-0 w-10 h-10 rounded-full bg-primary-foreground text-primary flex items-center justify-center">
        <ArrowRight className="w-5 h-5 rtl:scale-x-[-1]" strokeWidth={2.5} />
      </span>
    </motion.button>
  );
}

// ── A: the session as one card ───────────────────────────────────────────

export function SessionCard({ session, onStart }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const { num, unit } = useWeight();
  const liftName = useLiftName();
  if (!session) return null;
  const [lead, ...rest] = session.lifts;

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="px-4 pt-4 flex items-baseline justify-between gap-3">
        <h2 className="text-title font-bold leading-tight min-w-0 truncate">{session.name}</h2>
        <span className="shrink-0 text-label text-muted-foreground tabular-nums">
          {tFallback('today.session.minutes', '{n} min', { n: fmt(session.minutes) })}
        </span>
      </header>

      {/* The first lift is the one the user walks to first, so it gets the
          figure and the number at size. The rest is a list. */}
      <div className="px-4 pt-3 pb-3 flex items-center gap-4">
        <LiftFigure name={lead.name} accent className="w-24 h-24 shrink-0 text-foreground" />
        <div className="min-w-0 flex flex-col gap-1">
          <p className="text-label text-muted-foreground truncate">{liftName(lead.name)}</p>
          <p className="flex items-baseline gap-1.5">
            {lead.weight != null ? (
              <>
                <span className="font-display text-display tabular-nums leading-none">{num(lead.weight)}</span>
                <span className="text-label text-muted-foreground">{unit}</span>
              </>
            ) : (
              <span className="font-display text-display tabular-nums leading-none">{setsReps(lead)}</span>
            )}
          </p>
          <p className="flex items-center gap-2 text-label tabular-nums">
            {lead.weight != null && <span>{setsReps(lead)}</span>}
            <Change lift={lead} />
          </p>
        </div>
      </div>

      <ul className="border-t border-border/60 divide-y divide-border/40">
        {rest.map((l) => (
          <li key={l.name} className="px-4 py-1.5 flex items-center gap-3">
            <LiftFigure name={l.name} className="w-10 h-10 shrink-0 text-foreground/70" />
            <span className="flex-1 min-w-0 text-label font-medium truncate">{liftName(l.name)}</span>
            <Change lift={l} />
            <span className="shrink-0 text-label tabular-nums text-muted-foreground">
              {l.weight != null && <span className="text-foreground font-semibold">{num(l.weight)} </span>}
              {setsReps(l)}
            </span>
          </li>
        ))}
      </ul>

      <div className="p-3 pt-2">
        <StartButton label={tFallback('today.session.start', 'Start session')} onStart={onStart} />
      </div>
    </section>
  );
}

// ── B: the lifts as a lineup, for the hero's visual row ─────────────────

export function SessionLineup({ session, height = 104 }) {
  const { num } = useWeight();
  const liftName = useLiftName();
  if (!session) return null;
  return (
    <ol className="flex justify-between gap-1" style={{ height }} aria-label={session.name}>
      {session.lifts.slice(0, 6).map((l) => (
        <li key={l.name} className="flex-1 min-w-0 flex flex-col items-center gap-0.5" aria-label={liftName(l.name)}>
          <LiftFigure name={l.name} className="w-full max-w-[56px] aspect-square text-foreground" />
          <span className="text-label font-semibold tabular-nums leading-none">
            {l.weight != null ? num(l.weight) : setsReps(l)}
          </span>
          <span className="text-micro text-muted-foreground tabular-nums leading-none">
            {l.weight != null ? setsReps(l) : ' '}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ── C: the first lift as the page's focal figure ─────────────────────────

export function SessionLead({ session, weekShare = null, weekLabel }) {
  const { tFallback } = useLanguage();
  const { num, unit } = useWeight();
  const liftName = useLiftName();
  const list = useMemo(() => {
    try { return new Intl.ListFormat(undefined, { style: 'narrow', type: 'conjunction' }); } catch { return null; }
  }, []);
  if (!session) return null;
  const [lead, ...rest] = session.lifts;
  const next = rest.slice(0, 3).map((l) => liftName(l.name));
  const more = rest.length - next.length;
  const then = list ? list.format(next) : next.join(', ');

  return (
    <section className="flex items-center" style={{ gap: 'var(--fluid-section)' }}>
      {/* The ring spot every hero slide uses, so the page still reads as the
          app's revolving menus. The arc is the week; the figure is today. */}
      <FocalRing share={weekShare} label={weekLabel}>
        <LiftFigure name={lead.name} accent className="w-[92px] h-[92px] text-foreground" />
      </FocalRing>
      <div className="min-w-0 flex flex-col gap-1">
        <p className="text-label text-muted-foreground truncate">{liftName(lead.name)}</p>
        <p className="flex items-baseline gap-1.5">
          <span className="font-display tabular-nums leading-none" style={{ fontSize: 'clamp(2.5rem, 12vw, 3rem)' }}>
            {lead.weight != null ? num(lead.weight) : setsReps(lead)}
          </span>
          {lead.weight != null && <span className="text-label text-muted-foreground">{unit}</span>}
        </p>
        <p className="flex items-center gap-2 text-label tabular-nums">
          {lead.weight != null && <span>{setsReps(lead)}</span>}
          <Change lift={lead} />
        </p>
        {next.length > 0 && (
          <p className="text-micro text-muted-foreground leading-snug line-clamp-2">
            {more > 0
              ? tFallback('today.session.thenMore', 'Then {list}, +{n}', { list: then, n: more })
              : tFallback('today.session.then', 'Then {list}', { list: then })}
          </p>
        )}
      </div>
    </section>
  );
}

// ── Lift progress ────────────────────────────────────────────────────────

/** A small estimated-max line that draws itself in, the hero trend's motion. */
function LiftSpark({ points, play, width = 96, height = 32 }) {
  const reduce = useReducedMotion();
  const k = useContext(TrendTimeScale) || 1;
  const d = useMemo(() => {
    if (!points || points.length < 2) return null;
    const t0 = points[0].t; const t1 = points[points.length - 1].t;
    const vs = points.map((p) => p.v);
    const lo = Math.min(...vs); const hi = Math.max(...vs);
    const x = (t) => 2 + ((t - t0) / Math.max(1, t1 - t0)) * (width - 6);
    const y = (v) => height - 3 - ((v - lo) / Math.max(1, hi - lo)) * (height - 6);
    const pts = points.map((p) => [x(p.t), y(p.v)]);
    return { path: pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' '), end: pts[pts.length - 1] };
  }, [points, width, height]);
  if (!d) return <span style={{ width, height }} />;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0 overflow-visible">
      <motion.path
        d={d.path} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: play || reduce ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: DRAW_S * k, ease: DRAW_EASE, delay: SETTLE_WAIT_S * k }}
      />
      <motion.circle
        cx={d.end[0]} cy={d.end[1]} r="3" fill="hsl(var(--primary))"
        initial={false}
        animate={{ opacity: play || reduce ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.2, delay: (SETTLE_WAIT_S + DRAW_S) * k }}
      />
    </svg>
  );
}

/**
 * @param {Array<ReturnType<import('@/lib/heroTrends').liftTrend>>} props.trends  ready trends only
 */
export function LiftProgress({ trends = [], onOpen }) {
  const { tFallback } = useLanguage();
  const { num, unit, kg } = useWeight();
  const liftName = useLiftName();
  const fmt = useNumberFormatter();
  const [play, setPlay] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setPlay(true)); return () => cancelAnimationFrame(id); }, []);
  if (!trends.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <button type="button" onClick={onOpen} className="flex items-center justify-between text-start">
        <h3 className="eyebrow">{tFallback('today.lifts.title', 'Your lifts')}</h3>
        <span className="flex items-center gap-0.5 text-micro text-muted-foreground">
          {tFallback('today.lifts.estMax', 'Estimated max')}
          <ChevronRight className="w-3.5 h-3.5 rtl:scale-x-[-1]" aria-hidden="true" />
        </span>
      </button>
      <ul className="divide-y divide-border/40 border-y border-border/40">
        {trends.map((tr) => {
          const r = (v) => (kg ? Math.round(fromLbs(v, 'kg') * 2) / 2 : Math.round(v));
          const gain = r(tr.last.v) - r(tr.first.v);
          const weeks = Math.max(1, Math.round(tr.spanDays / 7));
          return (
            <li key={tr.lift} className="py-2 flex items-center gap-3">
              <LiftFigure name={tr.lift} className="w-10 h-10 shrink-0 text-foreground/70" />
              <div className="flex-1 min-w-0">
                <p className="text-label font-medium truncate">{liftName(tr.lift)}</p>
                <p className="text-micro text-muted-foreground tabular-nums">
                  {gain > 0
                    ? tFallback('today.lifts.gain', '+{n} in {w} wk', { n: fmt(gain), w: fmt(weeks) })
                    : tFallback('today.lifts.steady', 'Holding, {w} wk', { w: fmt(weeks) })}
                </p>
              </div>
              <LiftSpark points={tr.points} play={play} />
              <p className="w-16 shrink-0 text-end">
                <span className="text-body font-bold tabular-nums">{num(tr.last.v)}</span>
                <span className="text-micro text-muted-foreground"> {unit}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── The five daily logs as one row ───────────────────────────────────────

const LOG_ICONS = { meals: Utensils, water: Droplet, sleep: Moon, mood: Smile, steps: Footprints };

function LogRing({ share, size = 48, children }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const s = Math.max(0, Math.min(1, share || 0));
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
        {s > 0 && (
          <motion.circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - s) }}
            transition={{ duration: DRAW_S, ease: DRAW_EASE, delay: SETTLE_WAIT_S }}
          />
        )}
      </svg>
      {children}
    </span>
  );
}

/**
 * @param {Array<{ id: keyof LOG_ICONS, share: number, value?: string }>} props.items
 */
export function LogStrip({ items = [], onLog }) {
  const { tFallback } = useLanguage();
  const names = {
    meals: tFallback('today.log.meals', 'Meals'),
    water: tFallback('today.log.water', 'Water'),
    sleep: tFallback('today.log.sleep', 'Sleep'),
    mood: tFallback('today.log.mood', 'Mood'),
    steps: tFallback('today.log.steps', 'Steps'),
  };
  return (
    <ul className="flex justify-between" aria-label={tFallback('today.log.title', 'Log today')}>
      {items.map((it) => {
        const Icon = LOG_ICONS[it.id];
        return (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onLog?.(it.id)}
              aria-label={it.value ? `${names[it.id]}, ${it.value}` : names[it.id]}
              className="flex flex-col items-center gap-1 min-w-[56px]"
            >
              <LogRing share={it.share}>
                <Icon className={`w-5 h-5 ${it.share >= 1 ? 'text-primary' : 'text-foreground'}`} strokeWidth={1.75} aria-hidden="true" />
              </LogRing>
              <span className="text-micro text-muted-foreground tabular-nums">{it.value || names[it.id]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── Quests and goals as one row ──────────────────────────────────────────

export function TodoPeek({ done = 0, total = 0, xp = 0, onOpen }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  if (!total) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 py-2.5 border-y border-border/40 text-start"
    >
      <ListChecks className="w-5 h-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
      <span className="text-label font-medium">{tFallback('today.todo.title', 'To do')}</span>
      <span className="flex-1 flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-1 flex-1 max-w-[20px] rounded-full ${i < done ? 'bg-primary' : 'bg-secondary'}`} />
        ))}
      </span>
      <span className="text-label tabular-nums text-muted-foreground">
        {tFallback('today.todo.xp', '{n} XP', { n: fmt(xp) })}
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
    </button>
  );
}
