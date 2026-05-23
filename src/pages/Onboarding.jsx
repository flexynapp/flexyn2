// src/pages/Onboarding.jsx
// Redesigned onboarding — 7-step flow with animated background, feature
// carousel, multi-select goals, experience level, stat scrubbers,
// schedule picker, loading animation, and personalised reveal.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { markReturningUser } from '@/lib/firstLaunch';
import { containsProfanity } from '@/lib/profanityFilter';
import { grantWelcomeCapsule } from '@/lib/data/capsules';
import { buildStarterRegimen, ensureStarterRegimen } from '@/lib/data/starterRegimen';
import { reportError } from '@/lib/reportError';

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════ */

const GOALS = [
  { id: 'strength',  title: 'Build strength',   sub: 'Compound lifts. Heavy. Honest.',                        icon: 'dumbbell',      accent: 'hsl(26 95% 56%)'  },
  { id: 'muscle',    title: 'Add muscle',        sub: 'Hypertrophy program, smart volume.',                    icon: 'flame',         accent: 'hsl(14 92% 56%)'  },
  { id: 'lose',      title: 'Lose fat',          sub: 'Recomp without losing the gains.',                      icon: 'trending-down', accent: 'hsl(160 64% 45%)' },
  { id: 'endurance', title: 'Run further',       sub: "Cardio plans that don't feel like punishment.",         icon: 'activity',      accent: 'hsl(217 91% 60%)' },
  { id: 'mobility',  title: 'Move better',       sub: 'Mobility, flexibility, longevity.',                     icon: 'wind',          accent: 'hsl(280 60% 60%)' },
];

const GOAL_TAILORS = {
  strength:  ['Heavier compounds', 'Anti-cheat: bar speed', '+15 g protein/day'],
  muscle:    ['Hypertrophy volume', 'Heatmap: chest / back / legs', '+25 g protein/day'],
  lose:      ['Calorie target −350', 'Cardio finishers', 'Anti-cheat: rest timer'],
  endurance: ['VO₂ blocks', 'Cardio heatmap', 'Carb-forward macros'],
  mobility:  ['Daily mobility flow', 'Form-check anti-cheat', 'Recovery weighting'],
};

const LEVELS = [
  { id: 'newbie',     label: 'New',        sub: 'Less than 6 months lifting',      bars: 1, desc: "We'll start light, build form first." },
  { id: 'returning',  label: 'Returning',  sub: 'Coming back after a break',       bars: 2, desc: 'Ramp gently. Avoid the soreness wall.' },
  { id: 'consistent', label: 'Consistent', sub: '6–24 months under the bar',       bars: 3, desc: 'Progressive overload, real periodization.' },
  { id: 'advanced',   label: 'Advanced',   sub: '2+ years, lifts close to plateau', bars: 4, desc: 'Specificity, blocks, and earned PRs.' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIMES    = ['Morning', 'Midday', 'Evening', 'Late night'];

/* ── Feature visual components (animated SVG illustrations for the carousel) ── */

function FeatVisualCoach({ accent }) {
  return (
    <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          border: `1.5px solid ${accent}`,
          animation: `ob-ring-grow 2.4s ${i * 0.6}s cubic-bezier(0,0,0.2,1) infinite`,
          opacity: 0,
        }} />
      ))}
      <div style={{
        position: 'absolute', inset: 16, borderRadius: '50%',
        background: `radial-gradient(circle at 32% 32%, ${accent}, ${accent.replace(')', ' / 0.55)')})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 10px 28px -6px ${accent.replace(')', ' / 0.6)')}`,
        animation: 'ob-coach-pulse 2.2s ease-in-out infinite',
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v8"/><path d="M5 12a7 7 0 0 0 14 0"/><circle cx="12" cy="14" r="2" fill="white"/>
        </svg>
      </div>
      {/* orbiting dot */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 8, height: 8, marginLeft: -4, marginTop: -4 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: accent, boxShadow: `0 0 10px ${accent}`,
          animation: 'ob-orbit-dot 3.5s linear infinite',
        }} />
      </div>
    </div>
  );
}

function FeatVisualLog({ accent }) {
  const rows = [{ label: 'Bench', val: '185 × 5' }, { label: 'Bench', val: '195 × 5' }, { label: 'Bench', val: '205 × 5' }];
  return (
    <div style={{ width: 108, display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
      {rows.map((row, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 10px', borderRadius: 8,
          background: 'hsl(var(--card) / 0.8)',
          border: `1px solid ${accent.replace(')', ' / 0.22)')}`,
          fontFamily: 'monospace', fontSize: 11,
          opacity: 0,
          animation: `ob-spring-in 0.4s ${0.15 + i * 0.18}s cubic-bezier(0.16,1,0.3,1) both`,
        }}>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>{row.label}</span>
          <span style={{ color: 'hsl(var(--foreground))', fontWeight: 700 }}>
            {row.val}
            <span style={{
              display: 'inline-block', width: 1.5, height: 10,
              background: accent, marginLeft: 2, verticalAlign: 'middle',
              animation: 'ob-type-cursor 0.9s step-end infinite',
            }} />
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 1 }}>
        <span style={{
          fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: accent,
          letterSpacing: '0.1em', opacity: 0,
          animation: 'ob-spring-in 0.4s 0.7s cubic-bezier(0.16,1,0.3,1) both',
        }}>+ PR</span>
      </div>
    </div>
  );
}

function FeatVisualProgress({ accent }) {
  const heights = [22, 30, 28, 44, 38, 56, 62];
  return (
    <div style={{ width: 108, height: 88, position: 'relative', flexShrink: 0 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 10, height: 1, background: 'hsl(var(--border))' }} />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 76, padding: '0 2px' }}>
        {heights.map((h, i) => (
          <div key={i} style={{
            flex: 1, height: h,
            background: i === heights.length - 1
              ? `linear-gradient(180deg, ${accent}, ${accent.replace(')', ' / 0.55)')})`
              : 'hsl(var(--muted-foreground) / 0.35)',
            borderRadius: '3px 3px 0 0',
            transformOrigin: 'bottom',
            animation: `ob-count-bar 0.5s ${i * 0.07}s cubic-bezier(0.34,1.56,0.64,1) both`,
            boxShadow: i === heights.length - 1 ? `0 -6px 14px ${accent.replace(')', ' / 0.38)')}` : 'none',
          }} />
        ))}
      </div>
      <div style={{
        position: 'absolute', right: 2, top: 0,
        padding: '2px 6px', borderRadius: 4,
        background: accent, color: 'white',
        fontFamily: 'monospace', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
        opacity: 0, animation: 'ob-spring-in 0.4s 0.65s cubic-bezier(0.16,1,0.3,1) both',
      }}>+12%</div>
    </div>
  );
}

function FeatVisualRecovery({ accent }) {
  return (
    <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
      <svg width="100" height="100" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
        <circle cx="50" cy="50" r="40" fill="none" stroke={accent} strokeWidth="6" strokeLinecap="round"
          strokeDasharray="251"
          style={{ animation: 'ob-recovery-fill 1.5s 0.2s cubic-bezier(0.16,1,0.3,1) both' }} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          fontFamily: 'var(--font-heading, "Space Grotesk", sans-serif)', fontSize: 28, fontWeight: 800,
          color: 'hsl(var(--foreground))', letterSpacing: '-0.04em', lineHeight: 1,
          overflow: 'hidden', height: '1em',
        }}>
          <span style={{ display: 'block', animation: 'ob-streak-roll 0.7s 0.6s cubic-bezier(0.16,1,0.3,1) both' }}>82</span>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 8, fontWeight: 600, color: 'hsl(var(--muted-foreground))', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 2 }}>Ready</div>
      </div>
    </div>
  );
}

function FeatVisualStreak({ accent }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <div style={{ position: 'relative' }}>
        <svg width="62" height="72" viewBox="0 0 68 80" style={{ animation: 'ob-streak-flame 1.8s ease-in-out infinite' }}>
          <defs>
            <linearGradient id="ob-flame-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(50 100% 65%)" />
              <stop offset="60%" stopColor={accent} />
              <stop offset="100%" stopColor="hsl(0 80% 50%)" />
            </linearGradient>
          </defs>
          <path d="M34 6 C 50 22, 60 36, 60 52 C 60 68, 48 76, 34 76 C 20 76, 8 68, 8 52 C 8 40, 16 32, 22 28 C 22 38, 28 42, 32 38 C 32 28, 30 18, 34 6 Z" fill="url(#ob-flame-grad)" />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-heading, "Space Grotesk", sans-serif)', fontSize: 26, fontWeight: 800, color: 'white',
          textShadow: '0 2px 6px rgba(0,0,0,0.35)', paddingTop: 10, overflow: 'hidden',
        }}>
          <span style={{ display: 'block', animation: 'ob-streak-roll 0.7s 0.5s cubic-bezier(0.16,1,0.3,1) both' }}>47</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: 2,
            background: i < 6 ? accent : 'hsl(var(--muted-foreground) / 0.3)',
            animation: i < 6 ? `ob-spring-in 0.3s ${0.55 + i * 0.05}s cubic-bezier(0.16,1,0.3,1) both` : 'none',
            opacity: i < 6 ? 0 : 1,
          }} />
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  { id: 'coach',    eyebrow: 'AI Coach',   title: 'A coach that adapts in real time',       sub: 'Reads your sets. Adjusts tomorrow. No guesswork.',                              accent: 'hsl(26 95% 56%)',  Visual: FeatVisualCoach    },
  { id: 'log',      eyebrow: 'Smart Log',  title: 'Logging that finishes your sentence',    sub: 'Auto-detects sets, plates, RPE. Hands stay on the bar.',                        accent: 'hsl(217 91% 60%)', Visual: FeatVisualLog      },
  { id: 'progress', eyebrow: 'Progress',   title: 'Watch your numbers climb',               sub: 'PR tracking, volume curves, e1RM that actually mean something.',                 accent: 'hsl(160 64% 45%)', Visual: FeatVisualProgress },
  { id: 'recovery', eyebrow: 'Recovery',   title: 'Train hard. Recover smarter.',           sub: 'Readiness score syncs with sleep, soreness, last session.',                      accent: 'hsl(280 60% 60%)', Visual: FeatVisualRecovery },
  { id: 'streaks',  eyebrow: 'Streaks',    title: 'Show up. Stack the days.',               sub: 'Streak shields, weekly missions, and the only leaderboard that matters: yours.', accent: 'hsl(14 92% 56%)',  Visual: FeatVisualStreak   },
];

const LOADING_TASKS = [
  'Reading your goals',
  'Mapping training volume',
  'Calibrating progression',
  'Pairing exercises to equipment',
  'Stress-testing recovery',
  'Locking in week one',
];

/* ═══════════════════════════════════════════════════════════════
   ICON HELPER
═══════════════════════════════════════════════════════════════ */

function Icon({ name, size = 22, strokeWidth = 2.2, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'dumbbell':      return <svg {...p}><path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/></svg>;
    case 'flame':         return <svg {...p}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>;
    case 'trending-down': return <svg {...p}><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>;
    case 'activity':      return <svg {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
    case 'wind':          return <svg {...p}><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>;
    case 'check':         return <svg {...p}><polyline points="20 6 9 17 4 12"/></svg>;
    case 'arrow-right':   return <svg {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;
    case 'arrow-left':    return <svg {...p}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>;
    case 'user':          return <svg {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case 'ruler':         return <svg {...p}><path d="M21.3 8.7L8.7 21.3a2.4 2.4 0 0 1-3.4 0L2.7 18.7a2.4 2.4 0 0 1 0-3.4L15.3 2.7a2.4 2.4 0 0 1 3.4 0l2.6 2.6a2.4 2.4 0 0 1 0 3.4z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></svg>;
    case 'scale':         return <svg {...p}><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>;
    default: return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   AURORA BACKGROUND
═══════════════════════════════════════════════════════════════ */

function Aurora() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* Grid overlay */}
      <div className="absolute inset-0 opacity-[0.035]"
        style={{ backgroundImage: 'linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
      {/* Blobs */}
      <motion.div className="absolute rounded-full blur-[50px] opacity-55"
        style={{ width: '70%', height: '55%', left: '-10%', top: '-10%', background: 'radial-gradient(circle, hsl(var(--primary) / 0.55), transparent 70%)', willChange: 'transform' }}
        animate={{ x: [0, 20, 0], y: [0, 15, 0] }} transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="absolute rounded-full blur-[50px] opacity-40"
        style={{ width: '55%', height: '50%', right: '-5%', top: '25%', background: 'radial-gradient(circle, hsl(38 92% 60% / 0.5), transparent 70%)', willChange: 'transform' }}
        animate={{ x: [0, -20, 0], y: [0, 20, 0] }} transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut', delay: 2 }} />
      <motion.div className="absolute rounded-full blur-[50px] opacity-35"
        style={{ width: '75%', height: '45%', left: '5%', bottom: '-10%', background: 'radial-gradient(circle, hsl(14 92% 56% / 0.38), transparent 70%)', willChange: 'transform' }}
        animate={{ x: [0, 15, 0], y: [0, -10, 0] }} transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut', delay: 4 }} />
      {/* Vignette */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, hsl(var(--background) / 0.35) 100%)' }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CONFETTI
═══════════════════════════════════════════════════════════════ */

function Confetti({ pieces = 32 }) {
  const colors = ['hsl(26 95% 56%)', 'hsl(38 92% 60%)', 'hsl(160 64% 50%)', 'hsl(217 91% 65%)', 'hsl(340 80% 60%)'];
  const items = useMemo(() => Array.from({ length: pieces }).map(() => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.6,
    duration: 1.8 + Math.random() * 1.6,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotate: Math.random() * 360,
    width: 6 + Math.random() * 6,
    height: 8 + Math.random() * 8,
  })), []);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden z-10">
      {items.map((p, i) => (
        <motion.span key={i}
          className="absolute top-0 rounded-sm"
          style={{ left: `${p.left}%`, width: p.width, height: p.height, background: p.color, rotate: p.rotate }}
          animate={{ y: ['0vh', '110vh'], opacity: [0, 1, 1, 0], rotate: [p.rotate, p.rotate + 360] }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED: STEP HEADER (progress bar + back)
═══════════════════════════════════════════════════════════════ */

function StepHeader({ step, total, onBack }) {
  // Hide the Back button when there's nowhere to go back to. The first
  // form step (goal) had a broken Back button: it called `back()` →
  // stepIdx=0 (welcome) → an auto-advance effect immediately bounced
  // the authenticated user back to goal. The button LOOKED broken.
  // Treating `onBack === null` as "no back" lets the parent step decide.
  const canBack = typeof onBack === 'function';
  return (
    <div className="flex items-center gap-3 mb-7">
      {canBack ? (
        <button onClick={onBack} aria-label="Back"
          className="w-9 h-9 rounded-xl border border-border/70 bg-card/70 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-card transition-colors shrink-0">
          <Icon name="arrow-left" size={17} strokeWidth={2.5} />
        </button>
      ) : (
        // Spacer keeps the progress bar in the same position even when
        // the button is hidden — no layout jump between steps.
        <div className="w-9 h-9 shrink-0" aria-hidden="true" />
      )}
      <div className="flex-1 h-1.5 rounded-full bg-border/50 overflow-hidden">
        <motion.div className="h-full rounded-full bg-primary"
          initial={{ width: `${((step - 1) / total) * 100}%` }}
          animate={{ width: `${(step / total) * 100}%` }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} />
      </div>
      <span className="font-mono text-[11px] font-semibold text-muted-foreground shrink-0 tracking-wider">
        {String(step).padStart(2, '0')}<span className="opacity-40">/{String(total).padStart(2, '0')}</span>
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED: KINETIC HEADING
═══════════════════════════════════════════════════════════════ */

function KineticHeading({ text, kicker, accentWord }) {
  const words = text.split(' ');
  return (
    <div className="mb-2">
      {kicker && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.4 }}
          className="font-mono text-[11px] font-bold text-primary tracking-[0.18em] uppercase mb-2.5">
          {kicker}
        </motion.div>
      )}
      <h1 className="font-heading font-bold text-[30px] leading-[1.05] tracking-tight text-foreground m-0">
        {words.map((w, i) => (
          <motion.span key={i} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="inline-block mr-2"
            style={{ color: w.replace(/[.,!?]/g, '') === accentWord ? 'hsl(var(--primary))' : undefined }}>
            {w}
          </motion.span>
        ))}
      </h1>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED: PRIMARY BUTTON
═══════════════════════════════════════════════════════════════ */

function PrimaryBtn({ onClick, disabled, children, className = '' }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full h-14 rounded-2xl font-heading font-bold text-[15px] flex items-center justify-center gap-2 transition-all
        ${disabled
          ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
          : 'bg-primary text-primary-foreground hover:brightness-105 active:scale-[0.98] shadow-lg shadow-primary/25'}
        ${className}`}>
      {children}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE CAROUSEL (Welcome screen)
═══════════════════════════════════════════════════════════════ */

function FeatureCarousel() {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const DURATION = 3800;

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setIdx(i => (i + 1) % FEATURES.length), DURATION);
    return () => clearTimeout(t);
  }, [idx, paused]);

  const F = FEATURES[idx];
  const Visual = F.Visual;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85, duration: 0.5 }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      className="relative rounded-[20px] border border-border overflow-hidden p-4"
      style={{ background: 'linear-gradient(180deg, hsl(var(--card) / 0.88), hsl(var(--card) / 0.65))', backdropFilter: 'blur(18px)' }}>
      {/* accent glow */}
      <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full blur-[40px] transition-all duration-700 pointer-events-none"
        style={{ background: F.accent, opacity: 0.18 }} />
      {/* card body — keyed so it remounts + plays entry animation on each slide */}
      <div key={F.id} className="flex items-center gap-3"
        style={{ animation: 'ob-feat-enter 0.65s cubic-bezier(0.16,1,0.3,1) both', perspective: 800 }}>
        {/* Animated visual */}
        <div className="flex items-center justify-center" style={{ width: 110, height: 110, flexShrink: 0, overflow: 'hidden' }}>
          <Visual accent={F.accent} />
        </div>
        {/* Copy */}
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] font-bold tracking-[0.16em] uppercase mb-1" style={{ color: F.accent }}>{F.eyebrow}</div>
          <div className="font-heading font-bold text-[15px] leading-tight tracking-tight text-foreground mb-1.5">{F.title}</div>
          <div className="text-[11.5px] leading-[1.45] text-muted-foreground">{F.sub}</div>
        </div>
      </div>
      {/* pip indicators with progress fill */}
      <div className="flex gap-1.5 mt-3.5 items-center">
        {FEATURES.map((f, i) => {
          const active = i === idx;
          return (
            <button key={f.id} onClick={() => setIdx(i)} aria-label={`Show ${f.eyebrow}`}
              className="relative h-1 rounded-full cursor-pointer border-none p-0 overflow-hidden transition-all duration-500"
              style={{ width: active ? 28 : 6, background: active ? 'hsl(var(--muted) / 0.7)' : 'hsl(var(--muted-foreground) / 0.3)' }}>
              {active && (
                <span key={idx} className="absolute inset-0 rounded-full"
                  style={{ background: F.accent, transformOrigin: 'left center', animation: paused ? 'none' : `ob-pip-progress ${DURATION}ms linear forwards` }} />
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 1: WELCOME
═══════════════════════════════════════════════════════════════ */

function WelcomeStep({ onNext, onSignIn }) {
  return (
    <div className="flex flex-col h-full pt-3 gap-5 justify-between">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className="w-10 h-10 rounded-[12px] flex items-center justify-center relative overflow-hidden shadow-xl shadow-primary/40"
            style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(38 92% 60%))' }}>
            <span className="absolute inset-0" style={{ background: 'radial-gradient(120% 100% at 50% 0%, hsl(0 0% 100% / 0.35), transparent 50%)' }} />
            <span className="font-heading font-bold text-[22px] text-white relative tracking-tighter">F</span>
          </motion.div>
          <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05, duration: 0.4 }}
            className="font-heading font-bold text-[17px] tracking-tight text-foreground">Flexyn</motion.span>
        </div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          className="font-mono text-[10px] font-semibold text-muted-foreground tracking-[0.16em] uppercase">V 2.0</motion.div>
      </div>

      {/* Hero */}
      <div>
        <h1 className="font-heading font-bold text-[44px] leading-[0.97] tracking-[-0.045em] text-foreground m-0">
          {[{w:'Train',d:0.15},{w:'like',d:0.25},{w:'you',d:0.35}].map(({w,d}) => (
            <motion.span key={w} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: d, duration: 0.55, ease: [0.16,1,0.3,1] }}
              className="inline-block mr-3">{w}</motion.span>
          ))}
          <br />
          {[{w:'actually',d:0.45,c:false},{w:'mean',d:0.55,c:true},{w:'it.',d:0.65,c:false}].map(({w,d,c}) => (
            <motion.span key={w} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: d, duration: 0.55, ease: [0.16,1,0.3,1] }}
              className={`inline-block mr-3 ${c ? 'text-primary' : ''}`}>{w}</motion.span>
          ))}
        </h1>
      </div>

      {/* Feature carousel */}
      <FeatureCarousel />

      {/* CTAs */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95, duration: 0.4 }}
        className="flex flex-col gap-2">
        <PrimaryBtn onClick={onNext}>
          Get started <span className="ob-icon-bob inline-flex"><Icon name="arrow-right" size={20} strokeWidth={2.5} /></span>
        </PrimaryBtn>
        <button onClick={onSignIn}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2 text-center">
          I already have an account
        </button>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 2: GOAL (multi-select)
═══════════════════════════════════════════════════════════════ */

function GoalStep({ value, onChange, onNext, onBack, step, total }) {
  const selectedIds = Array.isArray(value) ? value : (value ? [value] : []);
  const toggle = (id) => {
    const has = selectedIds.includes(id);
    onChange(has ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };

  const tailors = useMemo(() => {
    const seen = new Set(); const out = [];
    selectedIds.forEach(id => (GOAL_TAILORS[id] || []).forEach(t => { if (!seen.has(t)) { seen.add(t); out.push({ t, id }); } }));
    return out;
  }, [selectedIds]);

  const primaryAccent = selectedIds.length ? (GOALS.find(g => g.id === selectedIds[0])?.accent || 'hsl(var(--primary))') : 'hsl(var(--primary))';

  const helper = selectedIds.length === 0 ? 'Pick one or many — we tailor your plan to the combination.'
    : selectedIds.length === 1 ? "Nice. Add another if you're after a few outcomes."
    : selectedIds.length <= 3 ? `Stacking ${selectedIds.length} goals — we'll balance your plan.`
    : 'Heads up: 4+ goals slows visible progress on each. Your call.';

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto space-y-3 pb-4 pr-2">
        <KineticHeading kicker="Goal · 01" text="What are you here for?" accentWord="for?" />
        <p className="text-sm text-muted-foreground mt-1.5 mb-4 min-h-[40px] transition-all">{helper}</p>

        {/* Counter row */}
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-[10px] font-bold text-muted-foreground tracking-[0.16em] uppercase">
            {selectedIds.length === 0 ? 'Select goals' : `${selectedIds.length} selected`}
          </span>
          {selectedIds.length > 0 && (
            <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              onClick={() => onChange([])}
              className="font-mono text-[10px] font-bold text-muted-foreground tracking-widest uppercase px-2 py-1 rounded hover:text-foreground transition-colors border-none bg-transparent cursor-pointer">
              Clear
            </motion.button>
          )}
        </div>

        {/* Goal cards */}
        <div className="space-y-2.5">
          {GOALS.map((g, i) => {
            const selected = selectedIds.includes(g.id);
            const order = selectedIds.indexOf(g.id) + 1;
            return (
              <motion.button key={g.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.07, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => toggle(g.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left cursor-pointer transition-all"
                style={{
                  borderColor: selected ? g.accent : 'hsl(var(--border))',
                  background: selected ? g.accent.replace(')', ' / 0.07)') : 'hsl(var(--card))',
                  boxShadow: selected ? `0 8px 24px -10px ${g.accent.replace(')', ' / 0.4)')}` : 'none',
                }}>
                {/* icon */}
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all"
                  style={{
                    background: selected ? g.accent.replace(')', ' / 0.18)') : 'hsl(var(--secondary))',
                    color: selected ? g.accent : 'hsl(var(--muted-foreground))',
                  }}>
                  <Icon name={g.icon} size={20} strokeWidth={2} />
                </div>
                {/* text */}
                <div className="flex-1 min-w-0">
                  <div className="font-heading font-bold text-[15px] text-foreground leading-tight">{g.title}</div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">{g.sub}</div>
                </div>
                {/* checkbox */}
                <div className="w-6 h-6 rounded-[7px] flex items-center justify-center shrink-0 transition-all font-mono text-[11px] font-bold text-white"
                  style={{
                    border: selected ? `2px solid ${g.accent}` : '1.5px solid hsl(var(--border))',
                    background: selected ? g.accent : 'transparent',
                    color: 'white',
                  }}>
                  {selected && (selectedIds.length > 1
                    ? <span>{order}</span>
                    : <Icon name="check" size={13} strokeWidth={3} color="white" />)}
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Live tailoring preview */}
        <AnimatePresence>
          {tailors.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mt-4 p-3.5 rounded-2xl border bg-card/70 backdrop-blur-sm relative">
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full blur-[30px] pointer-events-none transition-all duration-500"
                style={{ background: primaryAccent, opacity: 0.12 }} />
              <div className="font-mono text-[9.5px] font-bold text-muted-foreground tracking-[0.18em] uppercase mb-2.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: primaryAccent, boxShadow: `0 0 8px ${primaryAccent}` }} />
                Tailoring your plan
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tailors.slice(0, 6).map(({ t, id }, i) => {
                  const accent = GOALS.find(g => g.id === id)?.accent || 'hsl(var(--primary))';
                  return (
                    <motion.span key={t} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.05, type: 'spring', stiffness: 400, damping: 18 }}
                      className="px-2.5 py-1 rounded-full font-mono text-[10.5px] font-semibold tracking-tight"
                      style={{ color: accent, background: accent.replace(')', ' / 0.1)'), border: `1px solid ${accent.replace(')', ' / 0.25)')}` }}>
                      {t}
                    </motion.span>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext} disabled={selectedIds.length === 0}>
          {selectedIds.length === 0 ? 'Pick at least one'
            : selectedIds.length === 1 ? 'Continue'
            : `Continue with ${selectedIds.length}`}
          <Icon name="arrow-right" size={18} strokeWidth={2.5} />
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 3: EXPERIENCE
═══════════════════════════════════════════════════════════════ */

function ExperienceStep({ value, onChange, onNext, onBack, step, total }) {
  const current = LEVELS.find(l => l.id === value) || null;
  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4 pr-2">
        <KineticHeading kicker="Experience · 02" text="How long have you been training?" accentWord="training?" />
        <p className="text-sm text-muted-foreground mt-2 mb-6">Honest answers get you a better program.</p>

        {/* Visual rep meter */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.45 }}
          className="rounded-2xl border bg-card p-5 mb-4 relative overflow-hidden">
          {/* bars */}
          <div className="flex items-end gap-2 h-20 mb-4">
            {[1, 2, 3, 4].map(b => {
              const active = current ? b <= current.bars : false;
              const heights = ['25%', '45%', '70%', '100%'];
              return (
                <motion.div key={b} className="flex-1 rounded-t-lg relative overflow-hidden"
                  animate={{ height: heights[b - 1], background: active ? 'hsl(var(--primary))' : 'hsl(var(--secondary))' }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  style={{ boxShadow: active ? '0 6px 20px -8px hsl(var(--primary) / 0.55)' : 'none' }}>
                  {active && b === (current?.bars || 0) && (
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.28), transparent 40%)' }} />
                  )}
                </motion.div>
              );
            })}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={current?.id || 'none'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <div className="font-heading font-bold text-2xl tracking-tight text-foreground">
                {current?.label || <span className="text-muted-foreground text-base">Choose below</span>}
              </div>
              {current && <div className="text-sm text-muted-foreground mt-1">{current.desc}</div>}
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {/* Level list */}
        <div className="space-y-2">
          {LEVELS.map((l, i) => {
            const selected = value === l.id;
            return (
              <motion.button key={l.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.05, duration: 0.4 }}
                onClick={() => onChange(l.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border cursor-pointer transition-all text-left"
                style={{
                  borderColor: selected ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                  background: selected ? 'hsl(var(--primary) / 0.06)' : 'hsl(var(--card))',
                }}>
                {/* mini bar chart */}
                <div className="flex items-end gap-0.5 shrink-0">
                  {[1, 2, 3, 4].map(b => (
                    <span key={b} className="block rounded-sm transition-colors"
                      style={{ width: 4, height: b * 5 + 4, background: b <= l.bars ? 'hsl(var(--primary))' : 'hsl(var(--border))' }} />
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-heading font-semibold text-[14px] text-foreground">{l.label}</div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">{l.sub}</div>
                </div>
                {selected && <Icon name="check" size={16} strokeWidth={3} color="hsl(var(--primary))" />}
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext} disabled={!value}>
          Continue <Icon name="arrow-right" size={18} strokeWidth={2.5} />
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ASSESSMENT STEP — 4 lift-estimate questions, all optional
═══════════════════════════════════════════════════════════════ */

const ASSESSMENT_QUESTIONS = [
  { id: 'bench_bw',     icon: '🏋️', question: 'Can you bench-press your bodyweight?' },
  { id: 'squat_bw15',   icon: '🦵', question: 'Can you squat 1.5× your bodyweight?' },
  { id: 'pullups_10',   icon: '🤸', question: 'Can you do 10 strict pull-ups in a row?' },
  { id: 'mile_under10', icon: '🏃', question: 'Can you run a mile in under 10 minutes?' },
];

const ASSESSMENT_ANSWERS = [
  { id: 'yes',     label: 'Yes',     hue: 'hsl(142 71% 45%)' },
  { id: 'not_yet', label: 'Not yet', hue: 'hsl(38 92% 50%)'  },
  { id: 'no',     label: 'No',      hue: 'hsl(220 9% 46%)'   },
];

function AssessmentStep({ value, onChange, onNext, onBack, onSkip, step, total }) {
  const answers = value || {};
  const setAnswer = (qid, aid) => onChange({ ...answers, [qid]: aid });
  // Allow proceeding when all 4 are answered OR when the user
  // explicitly chooses to skip. We don't BLOCK on incomplete; the
  // bottom button text changes to "Skip rest" when fewer than 4 are
  // answered so the user always knows they can move on.
  const answeredCount = ASSESSMENT_QUESTIONS.filter(q => !!answers[q.id]).length;
  const allAnswered = answeredCount === ASSESSMENT_QUESTIONS.length;

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4 pr-2">
        <KineticHeading
          kicker={`Assessment · ${String(step).padStart(2, '0')}`}
          text="Quick lift check"
          accentWord="lift"
        />
        <p className="text-sm text-muted-foreground mt-2 mb-6">
          Optional — but the more honest you are, the better the plan.
          <br />
          <span className="text-xs text-muted-foreground/70">
            Your AI Coach uses these to dial in starting volume.
          </span>
        </p>

        <div className="space-y-4">
          {ASSESSMENT_QUESTIONS.map((q, qi) => (
            <motion.div
              key={q.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + qi * 0.06, duration: 0.4 }}
              className="rounded-2xl border bg-card p-4"
            >
              <div className="flex items-start gap-2 mb-3">
                <span className="text-2xl leading-none" aria-hidden="true">{q.icon}</span>
                <p className="font-heading font-semibold text-sm leading-snug text-foreground">
                  {q.question}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {ASSESSMENT_ANSWERS.map(a => {
                  const selected = answers[q.id] === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAnswer(q.id, a.id)}
                      className="py-2 rounded-xl border text-xs font-bold uppercase tracking-wide transition-colors"
                      style={{
                        borderColor: selected ? a.hue : 'hsl(var(--border))',
                        background:  selected ? `${a.hue}1f` : 'hsl(var(--card))',
                        color:       selected ? a.hue : 'hsl(var(--foreground))',
                      }}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>

        <p className="text-[11px] text-center text-muted-foreground mt-4">
          Answered {answeredCount} of {ASSESSMENT_QUESTIONS.length}
        </p>
      </div>

      <div className="pt-4 shrink-0 flex flex-col gap-2">
        <PrimaryBtn onClick={onNext}>
          {allAnswered ? 'Build my plan' : 'Continue'}
          <Icon name="arrow-right" size={18} strokeWidth={2.5} />
        </PrimaryBtn>
        {!allAnswered && (
          <button
            type="button"
            onClick={onSkip || onNext}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors py-1.5"
          >
            Skip — generate a generic plan
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SCRUBBER COMPONENT (drag ruler)
═══════════════════════════════════════════════════════════════ */

function Scrubber({ min, max, value, onChange, majorEvery = 5 }) {
  const trackRef = useRef(null);
  const dragRef = useRef({ down: false, startX: 0, startVal: value });
  const PX_PER_UNIT = 14;
  const [width, setWidth] = useState(320);

  useEffect(() => {
    const update = () => { if (trackRef.current) setWidth(trackRef.current.offsetWidth); };
    update();
    const ro = new ResizeObserver(update);
    if (trackRef.current) ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, []);

  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const onDown = useCallback((e) => {
    e.preventDefault();
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { down: true, startX: e.clientX, startVal: value };
  }, [value]);

  const onMove = useCallback((e) => {
    if (!dragRef.current.down) return;
    const delta = Math.round(-(e.clientX - dragRef.current.startX) / PX_PER_UNIT);
    const next = Math.min(max, Math.max(min, dragRef.current.startVal + delta));
    onChangeRef.current(next);
    if (navigator.vibrate) navigator.vibrate(1);
  }, [min, max]);

  const onUp = useCallback(() => { dragRef.current.down = false; }, []);

  const ticks = useMemo(() => { const a = []; for (let v = min; v <= max; v++) a.push(v); return a; }, [min, max]);
  const offset = -value * PX_PER_UNIT + width / 2;

  return (
    <div ref={trackRef} className="relative h-16 overflow-hidden cursor-grab select-none touch-none"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {/* fade edges */}
      <div className="absolute inset-y-0 left-0 w-12 z-10 pointer-events-none" style={{ background: 'linear-gradient(90deg, hsl(var(--card)), transparent)' }} />
      <div className="absolute inset-y-0 right-0 w-12 z-10 pointer-events-none" style={{ background: 'linear-gradient(270deg, hsl(var(--card)), transparent)' }} />
      {/* cursor line */}
      <div className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 z-10 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
      {/* ticks */}
      <div className="absolute inset-0" style={{ transform: `translateX(${offset}px)`, transition: dragRef.current.down ? 'none' : 'transform 0.2s cubic-bezier(0.16,1,0.3,1)' }}>
        {ticks.map(t => {
          const isMajor = t % majorEvery === 0;
          const isMid = t % Math.floor(majorEvery / 2 || 1) === 0 && !isMajor;
          return (
            <span key={t} className="absolute top-0 flex flex-col items-center" style={{ left: t * PX_PER_UNIT, transform: 'translateX(-50%)' }}>
              <span className="block rounded-full"
                style={{
                  width: 1.5, height: isMajor ? 28 : isMid ? 16 : 10,
                  background: t === value ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.4)',
                  marginTop: isMajor ? 8 : isMid ? 14 : 18,
                }} />
              {isMajor && (
                <span className="font-mono text-[9px] font-semibold mt-1 tracking-wide transition-colors"
                  style={{ color: t === value ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}>
                  {t}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 4: STATS (username + age + height + weight)
═══════════════════════════════════════════════════════════════ */

function UnitToggle({ options, value, onChange }) {
  return (
    <div className="flex bg-secondary rounded-xl p-0.5 gap-0.5">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className="px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest uppercase rounded-[10px] transition-all cursor-pointer"
          style={{
            background: value === o.id ? 'hsl(var(--card))' : 'transparent',
            color: value === o.id ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
            boxShadow: value === o.id ? '0 2px 6px hsl(0 0% 0% / 0.07)' : 'none',
            border: 'none',
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatCard({ icon, label, value, unit, min, max, majorEvery = 5, onChange, unitToggle, suffix }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border bg-card p-4 pb-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon name={icon} size={15} strokeWidth={2} color="hsl(var(--muted-foreground))" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
        </div>
        {unitToggle}
      </div>
      {/* Big value display */}
      <div className="flex items-baseline justify-center gap-2 mb-1">
        <motion.span key={value} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="font-heading font-bold text-[40px] leading-none tracking-tight text-foreground">
          {value}
        </motion.span>
        <span className="font-heading font-semibold text-xl text-muted-foreground">{unit}</span>
        {suffix && <span className="font-mono text-[11px] text-muted-foreground ml-1">{suffix}</span>}
      </div>
      <Scrubber min={min} max={max} value={value} onChange={onChange} majorEvery={majorEvery} />
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DRAG HOOK — used by Age, Height, Weight steps
═══════════════════════════════════════════════════════════════ */
function useDragValue({ value, onChange, min, max, axis = 'x', pxPerUnit = 14, step: stepSize = 1 }) {
  const ref = useRef(null);
  const drag = useRef({ active: false, start: 0, startVal: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Keep latest onChange and value accessible to native listeners without re-registering
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  // ── Pointer events (desktop + modern mobile) ──────────────────────────────
  const onPointerDown = useCallback((e) => {
    // Only handle primary button / touch; ignore right-click
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    const pos = axis === 'x' ? e.clientX : e.clientY;
    drag.current = { active: true, start: pos, startVal: valueRef.current };
    setIsDragging(true);
  }, [axis]);

  const onPointerMove = useCallback((e) => {
    if (!drag.current.active) return;
    const pos = axis === 'x' ? e.clientX : e.clientY;
    const delta = Math.round(-(pos - drag.current.start) / pxPerUnit) * stepSize;
    const next = Math.min(max, Math.max(min, drag.current.startVal + delta));
    onChangeRef.current(next);
    if (navigator.vibrate) navigator.vibrate(1);
  }, [axis, pxPerUnit, stepSize, min, max]);

  const onPointerUp = useCallback(() => {
    drag.current.active = false;
    setIsDragging(false);
  }, []);

  // ── Native touch listeners { passive: false } ─────────────────────────────
  // React 17+ marks synthetic touch events as passive, so e.preventDefault()
  // inside onTouchMove is silently ignored and the browser scrolls instead of
  // dragging. Attaching native listeners bypasses this restriction.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleTouchStart = (e) => {
      e.preventDefault();
      const t = e.touches[0];
      const pos = axis === 'x' ? t.clientX : t.clientY;
      drag.current = { active: true, start: pos, startVal: valueRef.current };
      setIsDragging(true);
    };

    const handleTouchMove = (e) => {
      e.preventDefault(); // stops page scroll while dragging the ruler
      if (!drag.current.active) return;
      const t = e.touches[0];
      const pos = axis === 'x' ? t.clientX : t.clientY;
      const delta = Math.round(-(pos - drag.current.start) / pxPerUnit) * stepSize;
      const next = Math.min(max, Math.max(min, drag.current.startVal + delta));
      onChangeRef.current(next);
      if (navigator.vibrate) navigator.vibrate(1);
    };

    const handleTouchEnd = () => { drag.current.active = false; setIsDragging(false); };

    el.addEventListener('touchstart',  handleTouchStart, { passive: false });
    el.addEventListener('touchmove',   handleTouchMove,  { passive: false });
    el.addEventListener('touchend',    handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      el.removeEventListener('touchstart',  handleTouchStart);
      el.removeEventListener('touchmove',   handleTouchMove);
      el.removeEventListener('touchend',    handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  // Re-register when these change; value/onChange handled via refs above
  }, [axis, pxPerUnit, stepSize, min, max]);

  return { ref, onPointerDown, onPointerMove, onPointerUp, isDragging };
}

// Shared style for the ±1 / ±5 nudge buttons on weight / height / age steps
// 48×48 hits Apple HIG (44pt) + WCAG 2.5.8 (24×24 minimum, 44×44 recommended)
// with margin to spare — users on small phones were missing 40×40 targets.
const nudgeBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 48, height: 48, borderRadius: '50%',
  border: '1.5px solid hsl(var(--border))',
  background: 'hsl(var(--secondary))',
  color: 'hsl(var(--foreground))',
  fontFamily: 'ui-monospace, monospace', fontSize: 14, fontWeight: 700,
  cursor: 'pointer', userSelect: 'none',
  WebkitTapHighlightColor: 'transparent',
  touchAction: 'manipulation',
  transition: 'background 0.15s, transform 0.1s',
};

/* ── Pill unit toggle (ft·in / cm, lb / kg) ── */
function PillUnitToggle({ options, value, onChange }) {
  return (
    <div style={{
      display: 'inline-flex', background: 'hsl(var(--secondary))',
      borderRadius: 999, padding: 3, gap: 2, border: '1px solid hsl(var(--border))',
    }}>
      {options.map(o => {
        const active = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            border: 'none', padding: '6px 18px',
            fontFamily: 'ui-monospace, monospace', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
            borderRadius: 999,
            background: active ? 'hsl(var(--primary))' : 'transparent',
            color: active ? 'white' : 'hsl(var(--muted-foreground))',
            cursor: 'pointer', transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
            boxShadow: active ? '0 4px 12px hsl(var(--primary) / 0.35)' : 'none',
            textTransform: 'uppercase', minWidth: 60,
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

/* ── Digit reel counter (Framer-animated) ── */
function NumberReel({ value, digits = 2, size = 80 }) {
  const str = String(value).padStart(digits, '0');
  return (
    <span style={{ display: 'inline-flex' }}>
      {str.split('').map((ch, i) => (
        <span key={i} style={{ display: 'inline-block', overflow: 'hidden', height: '0.95em', lineHeight: 1 }}>
          <motion.span
            key={`${i}-${ch}`}
            initial={{ y: '80%', opacity: 0 }}
            animate={{ y: '0%', opacity: 1 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ display: 'block' }}
          >{ch}</motion.span>
        </span>
      ))}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP: AGE — horizontal drag wheel with life-stage chip
═══════════════════════════════════════════════════════════════ */
function AgeStep({ stats, onChange, username, onUsernameChange, usernameError, onNext, onBack, step, total }) {
  const age = stats.age;
  const setAge = (v) => onChange({ ...stats, age: v });
  // Floor at 13 (COPPA-safe minimum for general apps); the under-18 stage
  // chip still surfaces TEEN messaging for 13-17 so the tone stays appropriate.
  const bumpAge = (dir) => setAge(Math.min(80, Math.max(13, age + dir)));
  const { ref, onPointerDown, onPointerMove, onPointerUp, isDragging } = useDragValue({ value: age, onChange: setAge, min: 13, max: 80, axis: 'x', pxPerUnit: 20 });

  // Tap-to-type: tapping the big number opens a numeric keypad so users
  // on mobile don't have to drag-scrub or hammer ±1 to get to their age.
  // Mirrors the Weight step's tap-to-type pattern.
  const [editingAge, setEditingAge] = useState(false);
  const ageInputRef = useRef(null);
  const handleAgeTap = () => { setEditingAge(true); setTimeout(() => ageInputRef.current?.focus(), 30); };
  const handleAgeInput = (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) setAge(Math.min(80, Math.max(13, v)));
  };

  // Track when the username field strips a character so we can surface a
  // friendly hint rather than just silently dropping the keystroke. Common
  // confusion source: iOS auto-capitalizes the first letter and the user
  // wonders why nothing appears.
  const [stripWarning, setStripWarning] = useState(false);
  const onUsernameChangeSanitized = (raw) => {
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (raw && cleaned !== raw.toLowerCase()) {
      setStripWarning(true);
      setTimeout(() => setStripWarning(false), 1500);
    }
    onUsernameChange(cleaned);
  };

  const [trackW, setTrackW] = useState(300);
  useEffect(() => {
    const update = () => { if (ref.current) setTrackW(ref.current.offsetWidth); };
    update();
    window.addEventListener('resize', update); return () => window.removeEventListener('resize', update);
  }, [ref]);

  const PX = 20;
  const offset = -age * PX + trackW / 2;

  const stage = useMemo(() => {
    if (age < 18) return { tag: 'TEEN', tone: "Building habits early. We'll start with form.", accent: 'hsl(217 91% 60%)' };
    if (age < 25) return { tag: 'PEAK INTAKE', tone: 'Hormonally primed for muscle gain. Great window.', accent: 'hsl(160 64% 45%)' };
    if (age < 35) return { tag: 'PRIME', tone: 'Strength peaks here for most lifters. Push hard.', accent: 'hsl(26 95% 56%)' };
    if (age < 45) return { tag: 'SUSTAIN', tone: 'Smart programming wins. Volume per session.', accent: 'hsl(38 92% 60%)' };
    if (age < 55) return { tag: 'INTENT', tone: "Recovery becomes the variable. We'll protect it.", accent: 'hsl(280 60% 60%)' };
    return { tag: 'LONGEVITY', tone: 'Joint-first programming. Strength is never stunted.', accent: 'hsl(0 70% 55%)' };
  }, [age]);

  const canNext = username.trim().length >= 2 && !usernameError;

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4 pr-2">
        <KineticHeading kicker={`About You · 0${step}`} text="Tell us about yourself." accentWord="yourself." />
        <p className="text-sm text-muted-foreground mt-2 mb-5">We use this to calibrate your plan. Encrypted, never sold.</p>

        {/* Username */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-2xl border bg-card/80 p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="user" size={14} color="hsl(var(--muted-foreground))" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">What should we call you?</span>
          </div>
          <input
            type="text"
            value={username}
            onChange={e => onUsernameChangeSanitized(e.target.value)}
            placeholder="e.g. jordan_lifts"
            maxLength={20}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="next"
            className="w-full h-12 rounded-xl border border-border bg-secondary/50 px-4 font-mono text-[16px] font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
          />
          {usernameError && <p className="text-xs text-destructive mt-1">{usernameError}</p>}
          {!usernameError && stripWarning && (
            <p className="text-xs text-muted-foreground mt-1">Letters, numbers and underscores only — capitals are auto-lowered.</p>
          )}
        </motion.div>

        {/* Age drag section */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          className="rounded-2xl border bg-card/80 p-5 relative overflow-hidden">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-4">How old are you?</div>

          {/* Glow halo */}
          <div style={{
            position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 200, height: 200, borderRadius: '50%',
            background: stage.accent, opacity: 0.1, filter: 'blur(50px)',
            transition: 'background 0.5s', pointerEvents: 'none', animation: 'stat-glow-pulse 3s ease-in-out infinite',
          }} />

          {/* Hero number — tap to type a value directly */}
          <div className="flex flex-col items-center mb-4">
            {editingAge ? (
              <input
                ref={ageInputRef}
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                defaultValue={age}
                min={13}
                max={80}
                onBlur={() => setEditingAge(false)}
                onChange={handleAgeInput}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                style={{ width: 180, fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 96, lineHeight: 0.9, letterSpacing: '-0.06em', textAlign: 'center', background: 'transparent', border: 'none', borderBottom: '3px solid hsl(var(--primary))', color: 'hsl(var(--foreground))', outline: 'none', padding: 0 }}
              />
            ) : (
              <button
                type="button"
                onClick={handleAgeTap}
                aria-label="Tap to type your age"
                style={{ background: 'none', border: 'none', cursor: 'text', padding: 0 }}
              >
                <div style={{
                  fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800,
                  fontSize: 120, lineHeight: 0.9, letterSpacing: '-0.06em',
                  color: 'hsl(var(--foreground))',
                  transform: isDragging ? 'scale(0.97)' : 'scale(1)',
                  transition: 'transform 0.15s ease-out',
                }}>
                  <NumberReel value={age} digits={2} size={120} />
                </div>
              </button>
            )}
            <div className="font-mono text-[11px] font-600 tracking-[0.3em] uppercase text-muted-foreground mt-2">YEARS OLD · TAP TO TYPE</div>

            {/* Life-stage chip */}
            <motion.div
              key={stage.tag}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
              className="flex items-center gap-2 mt-3 px-4 py-2 rounded-full text-sm font-semibold"
              style={{
                background: `${stage.accent.replace(')', ' / 0.12)')}`,
                border: `1.5px solid ${stage.accent.replace(')', ' / 0.4)')}`,
                color: stage.accent,
              }}>
              <span className="font-mono text-[10px] tracking-[0.14em] uppercase font-bold">{stage.tag}</span>
              <span style={{ width: 1, height: 12, background: stage.accent, opacity: 0.4 }} />
              <span className="text-xs font-normal" style={{ color: 'hsl(var(--foreground) / 0.8)' }}>{stage.tone}</span>
            </motion.div>
          </div>

          {/* Horizontal ruler scrubber */}
          <div
            ref={ref}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              position: 'relative', height: 48, overflow: 'hidden',
              cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none',
              maskImage: 'linear-gradient(90deg, transparent, black 12%, black 88%, transparent)',
              WebkitMaskImage: 'linear-gradient(90deg, transparent, black 12%, black 88%, transparent)',
              background: 'hsl(var(--secondary) / 0.5)', borderRadius: 12,
            }}
          >
            <div style={{ position: 'absolute', inset: 0, transform: `translateX(${offset}px)`, transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.16,1,0.3,1)' }}>
              {Array.from({ length: 81 - 13 }, (_, i) => i + 13).map(v => {
                const isMajor = v % 10 === 0, isMid = v % 5 === 0 && !isMajor;
                const isActive = v === age;
                return (
                  <span key={v}>
                    <span style={{
                      position: 'absolute', left: v * PX, top: '50%', transform: 'translate(-50%, -50%)',
                      width: 2, height: isMajor ? 22 : isMid ? 14 : 8,
                      background: isActive ? `hsl(var(--primary))` : isMajor ? 'hsl(var(--foreground) / 0.5)' : 'hsl(var(--muted-foreground) / 0.3)',
                      borderRadius: 1,
                    }} />
                    {isMajor && (
                      <span style={{
                        position: 'absolute', left: v * PX, top: '72%', transform: 'translateX(-50%)',
                        fontFamily: 'ui-monospace,monospace', fontSize: 10, fontWeight: 600,
                        color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                      }}>{v}</span>
                    )}
                  </span>
                );
              })}
            </div>
            {/* Center hairline */}
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, marginLeft: -1, background: 'linear-gradient(180deg, hsl(var(--primary)), transparent)', pointerEvents: 'none', boxShadow: '0 0 10px hsl(var(--primary))' }} />
          </div>
          <div className="flex justify-between mt-1 px-1">
            <span className="font-mono text-[9px] font-semibold text-muted-foreground tracking-wide">13</span>
            <span className="font-mono text-[9px] font-semibold text-muted-foreground tracking-wide">DRAG OR USE BUTTONS</span>
            <span className="font-mono text-[9px] font-semibold text-muted-foreground tracking-wide">80</span>
          </div>
          {/* ± Age nudge buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12 }}>
            <button onClick={() => bumpAge(-5)} style={nudgeBtnStyle}>−5</button>
            <button onClick={() => bumpAge(-1)} style={nudgeBtnStyle}>−1</button>
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13, fontWeight: 700, color: 'hsl(var(--foreground))', minWidth: 48, textAlign: 'center' }}>{age} yrs</span>
            <button onClick={() => bumpAge(+1)} style={nudgeBtnStyle}>+1</button>
            <button onClick={() => bumpAge(+5)} style={nudgeBtnStyle}>+5</button>
          </div>
        </motion.div>
      </div>
      <div className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext} disabled={!canNext}>
          Continue <Icon name="arrow-right" size={18} strokeWidth={2.5} />
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP: HEIGHT — silhouette + vertical ruler (ft·in default)
═══════════════════════════════════════════════════════════════ */
function HeightStep({ stats, onChange, onNext, onBack, step, total }) {
  const unit = stats.heightUnit ?? 'in';
  const inFromCm = (cm) => Math.round(cm / 2.54);
  const cmFromIn = (inches) => Math.round(inches * 2.54);

  const setUnit = (u) => {
    if (u === 'cm') onChange({ ...stats, heightUnit: 'cm', heightCm: cmFromIn(stats.heightIn) });
    else onChange({ ...stats, heightUnit: 'in', heightIn: inFromCm(stats.heightCm) });
  };

  const value = unit === 'cm' ? stats.heightCm : stats.heightIn;
  const range = unit === 'cm' ? [120, 220] : [48, 84];
  const PX = unit === 'cm' ? 6 : 12;
  const setValue = (v) => unit === 'cm'
    ? onChange({ ...stats, heightCm: v, heightIn: inFromCm(v) })
    : onChange({ ...stats, heightIn: v, heightCm: cmFromIn(v) });

  const bump = (dir) => setValue(Math.min(range[1], Math.max(range[0], value + dir)));

  const { ref, onPointerDown, onPointerMove, onPointerUp, isDragging } = useDragValue({ value, onChange: setValue, min: range[0], max: range[1], axis: 'y', pxPerUnit: PX });

  // Tap-to-type for height — mobile users complained that the vertical
  // ruler is too sensitive to drag accurately. Typing is faster anyway.
  // In ft·in mode we accept total inches and let users see the readout
  // convert to ft'in" live; this keeps the input simple (one number).
  const [editingHeight, setEditingHeight] = useState(false);
  const heightInputRef = useRef(null);
  const handleHeightTap = () => { setEditingHeight(true); setTimeout(() => heightInputRef.current?.focus(), 30); };
  const handleHeightInput = (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) setValue(Math.min(range[1], Math.max(range[0], v)));
  };

  const [trackH, setTrackH] = useState(240);
  useEffect(() => {
    const update = () => { if (ref.current) setTrackH(ref.current.offsetHeight); };
    update();
    window.addEventListener('resize', update); return () => window.removeEventListener('resize', update);
  }, [ref]);
  const offsetY = -value * PX + trackH / 2;

  const displayPrimary = unit === 'cm' ? `${value} cm` : `${Math.floor(value / 12)}'${value % 12}"`;
  const displaySecondary = unit === 'cm' ? `${Math.floor(inFromCm(value) / 12)}'${inFromCm(value) % 12}"` : `${cmFromIn(value)} cm`;
  const minPct = (value - range[0]) / (range[1] - range[0]);
  const silhouetteH = 70 + minPct * 25;

  const ticks = useMemo(() => {
    const arr = []; for (let v = range[0]; v <= range[1]; v++) arr.push(v); return arr;
  }, [range[0], range[1]]);

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-hidden pb-2">
        <div className="flex justify-between items-start mb-3">
          <KineticHeading kicker={`Height · 0${step}`} text="How tall are you?" accentWord="tall" />
        </div>
        <div className="mb-4">
          <PillUnitToggle options={[{id:'in',label:'ft·in'},{id:'cm',label:'cm'}]} value={unit} onChange={setUnit} />
        </div>

        <div style={{ display: 'flex', gap: 12, height: 320 }}>
          {/* Silhouette panel */}
          <div style={{
            flex: 1, position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            background: 'linear-gradient(180deg, transparent, hsl(var(--card) / 0.6))',
            borderRadius: 18, overflow: 'hidden', border: '1px solid hsl(var(--border))',
          }}>
            {/* Reference lines */}
            {[{label:"6'0\"",cm:183,in:72},{label:"5'6\"",cm:168,in:66},{label:"5'0\"",cm:152,in:60}].map(m => {
              const rv = unit === 'cm' ? m.cm : m.in;
              const pct = (rv - range[0]) / (range[1] - range[0]);
              return (
                <div key={m.label} style={{ position: 'absolute', left: 8, right: 8, bottom: `${pct * 88}%`, height: 1, background: 'hsl(var(--muted-foreground) / 0.18)' }}>
                  <span style={{ position: 'absolute', left: 4, top: -9, fontFamily: 'ui-monospace,monospace', fontSize: 9, fontWeight: 600, color: 'hsl(var(--muted-foreground) / 0.6)' }}>{m.label}</span>
                </div>
              );
            })}
            {/* Silhouette */}
            <svg viewBox="0 0 100 240" preserveAspectRatio="xMidYMax meet"
              style={{ width: '65%', height: `${silhouetteH}%`, transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.34,1.56,0.64,1)', position: 'relative', zIndex: 2 }}>
              <defs>
                <linearGradient id="sil-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" />
                  <stop offset="100%" stopColor="hsl(var(--primary) / 0.3)" />
                </linearGradient>
              </defs>
              <circle cx="50" cy="20" r="12" fill="url(#sil-grad)" />
              <rect x="46" y="30" width="8" height="6" fill="url(#sil-grad)" />
              <path d="M30 36 Q30 45,32 60 L32 130 Q32 138,35 140 L65 140 Q68 138,68 130 L68 60 Q70 45,70 36 Z" fill="url(#sil-grad)" />
              <rect x="20" y="38" width="10" height="78" rx="5" fill="url(#sil-grad)" />
              <rect x="70" y="38" width="10" height="78" rx="5" fill="url(#sil-grad)" />
              <rect x="34" y="138" width="13" height="92" rx="5" fill="url(#sil-grad)" />
              <rect x="53" y="138" width="13" height="92" rx="5" fill="url(#sil-grad)" />
            </svg>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 16, background: 'linear-gradient(0deg, hsl(var(--primary) / 0.2), transparent)', pointerEvents: 'none' }} />
          </div>

          {/* Readout + ruler */}
          <div style={{ width: 120, display: 'flex', flexDirection: 'column' }}>
            <div className="mb-3">
              {editingHeight ? (
                <input
                  ref={heightInputRef}
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  enterKeyHint="done"
                  defaultValue={value}
                  min={range[0]}
                  max={range[1]}
                  onBlur={() => setEditingHeight(false)}
                  onChange={handleHeightInput}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                  style={{ width: '100%', fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 32, lineHeight: 1, textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '2px solid hsl(var(--primary))', color: 'hsl(var(--foreground))', outline: 'none', padding: 0 }}
                />
              ) : (
                <button
                  type="button"
                  onClick={handleHeightTap}
                  aria-label="Tap to type your height"
                  style={{ background: 'none', border: 'none', cursor: 'text', padding: 0, textAlign: 'left' }}
                >
                  <div style={{ fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 38, lineHeight: 1, letterSpacing: '-0.04em', color: 'hsl(var(--foreground))', transform: isDragging ? 'scale(0.97)' : 'scale(1)', transition: 'transform 0.15s' }}>
                    {unit === 'cm' ? value : `${Math.floor(value/12)}'${value%12}"`}
                  </div>
                </button>
              )}
              <div className="font-mono text-[9px] font-semibold tracking-widest uppercase text-muted-foreground mt-1">
                {unit === 'cm' ? 'CM · TAP TO TYPE' : 'FT · IN · TAP TO TYPE'}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground/70 mt-1">≈ {displaySecondary}</div>
            </div>
            {/* Ruler */}
            <div ref={ref} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              style={{ flex: 1, position: 'relative', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none', background: 'hsl(var(--card) / 0.6)', border: '1px solid hsl(var(--border))', borderRadius: 14, overflow: 'hidden', maskImage: 'linear-gradient(180deg, transparent, black 15%, black 85%, transparent)', WebkitMaskImage: 'linear-gradient(180deg, transparent, black 15%, black 85%, transparent)' }}>
              <div style={{ position: 'absolute', inset: 0, transform: `translateY(${offsetY}px)`, transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.16,1,0.3,1)' }}>
                {ticks.map(v => {
                  const isMajor = unit === 'cm' ? v % 10 === 0 : v % 12 === 0;
                  const isMid = unit === 'cm' ? v % 5 === 0 : v % 6 === 0;
                  const isActive = v === value;
                  return (
                    <span key={v}>
                      <span style={{ position: 'absolute', top: v * PX, left: '50%', transform: 'translate(-50%,-50%)', width: isMajor ? 28 : isMid ? 18 : 10, height: 1.5, background: isActive ? 'hsl(var(--primary))' : isMajor ? 'hsl(var(--foreground)/0.5)' : 'hsl(var(--muted-foreground)/0.3)', borderRadius: 1 }} />
                      {isMajor && <span style={{ position: 'absolute', top: v * PX, left: '50%', marginLeft: 16, transform: 'translateY(-50%)', fontFamily: 'ui-monospace,monospace', fontSize: 9, fontWeight: 600, color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}>{unit === 'cm' ? v : `${Math.floor(v/12)}'`}</span>}
                    </span>
                  );
                })}
              </div>
              {/* Center line */}
              <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, marginTop: -1, background: 'linear-gradient(90deg, transparent, hsl(var(--primary)), transparent)', boxShadow: '0 0 10px hsl(var(--primary))', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', left: 0, top: '50%', marginTop: -5, borderLeft: '7px solid hsl(var(--primary))', borderTop: '5px solid transparent', borderBottom: '5px solid transparent' }} />
              <div style={{ position: 'absolute', right: 0, top: '50%', marginTop: -5, borderRight: '7px solid hsl(var(--primary))', borderTop: '5px solid transparent', borderBottom: '5px solid transparent' }} />
            </div>
          </div>
        </div>
      </div>
      {/* ± Fine-tune row for height */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 8 }}>
        <button onClick={() => bump(-5)} style={nudgeBtnStyle}>−5</button>
        <button onClick={() => bump(-1)} style={nudgeBtnStyle}>−1</button>
        <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, color: 'hsl(var(--muted-foreground))', minWidth: 72, textAlign: 'center' }}>
          {unit === 'cm' ? `${value} cm` : `${Math.floor(value/12)}'${value%12}"`}
        </span>
        <button onClick={() => bump(+1)} style={nudgeBtnStyle}>+1</button>
        <button onClick={() => bump(+5)} style={nudgeBtnStyle}>+5</button>
      </div>
      <div className="pt-3 shrink-0">
        <PrimaryBtn onClick={onNext}>Continue <Icon name="arrow-right" size={18} strokeWidth={2.5} /></PrimaryBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP: WEIGHT — circular gauge + animated barbell (lbs default)
═══════════════════════════════════════════════════════════════ */
function WeightPlate({ kg, color, delay }) {
  const h = 24 + Math.min(kg, 25) * 1.4;
  const w = 7 + Math.min(kg, 25) * 0.18;
  return (
    <div style={{ width: w, height: h, marginRight: 1, background: color, borderRadius: 3, boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.12)', animation: `spring-in 0.35s ${delay}s cubic-bezier(0.34,1.56,0.64,1) both`, flexShrink: 0, position: 'relative' }}>
      <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%) rotate(-90deg)', fontFamily: 'ui-monospace,monospace', fontSize: 7, fontWeight: 700, color: kg === 5 ? 'hsl(0 0% 30%)' : 'white' }}>{kg}</span>
    </div>
  );
}

function BarbellVisualizer({ kg }) {
  const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
  const PLATE_COLORS = { 25: 'hsl(0 75% 50%)', 20: 'hsl(217 80% 50%)', 15: 'hsl(50 90% 55%)', 10: 'hsl(160 60% 42%)', 5: 'hsl(0 0% 90%)', 2.5: 'hsl(0 0% 30%)', 1.25: 'hsl(0 0% 55%)' };
  const plates = useMemo(() => {
    const result = []; let rem = Math.max(0, (kg - 20) / 2);
    for (const p of PLATES) { while (rem >= p - 0.001) { result.push(p); rem -= p; } }
    return result.slice(0, 6);
  }, [kg]);

  return (
    <div className="flex items-center justify-center" style={{ height: 56, marginTop: 8 }}>
      <div className="flex items-center" style={{ flexDirection: 'row-reverse' }}>
        {plates.map((p, i) => <WeightPlate key={`l${i}-${p}`} kg={p} color={PLATE_COLORS[p]} delay={i * 0.04} />)}
      </div>
      <div style={{ width: 100, height: 6, background: 'linear-gradient(180deg, hsl(0 0% 78%), hsl(0 0% 52%))', borderRadius: 3, boxShadow: 'inset 0 -1px 0 hsl(0 0% 30%)' }} />
      <div className="flex items-center">
        {plates.map((p, i) => <WeightPlate key={`r${i}-${p}`} kg={p} color={PLATE_COLORS[p]} delay={i * 0.04} />)}
      </div>
    </div>
  );
}

function WeightStep({ stats, onChange, onNext, onBack, step, total }) {
  const unit = stats.weightUnit ?? 'lb';
  const kgFromLb = (lb) => Math.round(lb / 2.20462);
  const lbFromKg = (kg) => Math.round(kg * 2.20462);

  const setUnit = (u) => {
    if (u === 'kg') onChange({ ...stats, weightUnit: 'kg', weightKg: kgFromLb(stats.weightLb) });
    else onChange({ ...stats, weightUnit: 'lb', weightLb: lbFromKg(stats.weightKg) });
  };

  const value = unit === 'kg' ? stats.weightKg : stats.weightLb;
  const range = unit === 'kg' ? [35, 180] : [80, 400];
  const PX = unit === 'kg' ? 8 : 6; // increased from 4 → 6 for lb: easier to drag
  const setValue = (v) => unit === 'kg'
    ? onChange({ ...stats, weightKg: v, weightLb: lbFromKg(v) })
    : onChange({ ...stats, weightLb: v, weightKg: kgFromLb(v) });

  const bump = (dir) => setValue(Math.min(range[1], Math.max(range[0], value + dir)));

  // Tap-to-type: tapping the big number shows a native input
  const [editingWeight, setEditingWeight] = useState(false);
  const weightInputRef = useRef(null);
  const handleWeightTap = () => { setEditingWeight(true); setTimeout(() => weightInputRef.current?.focus(), 30); };
  const handleWeightInput = (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) setValue(Math.min(range[1], Math.max(range[0], v)));
  };
  const handleWeightBlur = () => setEditingWeight(false);

  const { ref, onPointerDown, onPointerMove, onPointerUp, isDragging } = useDragValue({ value, onChange: setValue, min: range[0], max: range[1], axis: 'x', pxPerUnit: PX });

  const [trackW, setTrackW] = useState(300);
  useEffect(() => {
    const update = () => { if (ref.current) setTrackW(ref.current.offsetWidth); };
    update();
    window.addEventListener('resize', update); return () => window.removeEventListener('resize', update);
  }, [ref]);
  const offsetX = -value * PX + trackW / 2;

  const pct = (value - range[0]) / (range[1] - range[0]);
  const circumference = 2 * Math.PI * 82;
  const dash = pct * circumference;
  const valueKg = unit === 'kg' ? value : kgFromLb(value);

  const ticks = useMemo(() => {
    const arr = []; const s = unit === 'kg' ? 1 : 2;
    for (let v = range[0]; v <= range[1]; v += s) arr.push(v);
    return arr;
  }, [range[0], range[1], unit]);

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-hidden pb-2">
        <div className="flex justify-between items-start mb-3">
          <KineticHeading kicker={`Weight · 0${step}`} text="How much do you weigh?" accentWord="weigh?" />
        </div>
        <div className="mb-4">
          <PillUnitToggle options={[{id:'lb',label:'lb'},{id:'kg',label:'kg'}]} value={unit} onChange={setUnit} />
        </div>

        {/* Circular gauge */}
        <div className="flex flex-col items-center" style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', width: 240, height: 240, borderRadius: '50%', background: 'hsl(var(--primary))', opacity: 0.1, filter: 'blur(50px)', animation: 'stat-glow-pulse 3s ease-in-out infinite' }} />
          <svg width="220" height="220" viewBox="0 0 200 200" style={{ position: 'relative' }}>
            <defs>
              <linearGradient id="wt-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="hsl(38 92% 60%)" />
                <stop offset="50%" stopColor="hsl(var(--primary))" />
                <stop offset="100%" stopColor="hsl(14 92% 56%)" />
              </linearGradient>
            </defs>
            <circle cx="100" cy="100" r="82" fill="none" stroke="hsl(var(--muted-foreground) / 0.12)" strokeWidth="3" />
            {Array.from({ length: 60 }).map((_, i) => {
              const angle = -90 + i * 6; const isMajor = i % 5 === 0;
              const r1 = isMajor ? 68 : 74; const r2 = 79;
              return <line key={i} x1={100 + Math.cos(angle * Math.PI/180) * r1} y1={100 + Math.sin(angle * Math.PI/180) * r1} x2={100 + Math.cos(angle * Math.PI/180) * r2} y2={100 + Math.sin(angle * Math.PI/180) * r2} stroke="hsl(var(--muted-foreground) / 0.35)" strokeWidth={isMajor ? 1.5 : 0.8} strokeLinecap="round" />;
            })}
            <circle cx="100" cy="100" r="82" fill="none" stroke="url(#wt-grad)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${dash} ${circumference}`} transform="rotate(-90 100 100)" style={{ transition: isDragging ? 'none' : 'stroke-dasharray 0.25s cubic-bezier(0.16,1,0.3,1)' }} />
            <circle cx={100 + Math.cos((-90 + pct * 360) * Math.PI/180) * 82} cy={100 + Math.sin((-90 + pct * 360) * Math.PI/180) * 82} r="5" fill="hsl(var(--primary))" style={{ filter: 'drop-shadow(0 0 6px hsl(var(--primary)))', transition: isDragging ? 'none' : 'all 0.25s cubic-bezier(0.16,1,0.3,1)' }} />
          </svg>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
            {editingWeight ? (
              <input
                ref={weightInputRef}
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                defaultValue={value}
                min={range[0]}
                max={range[1]}
                onBlur={handleWeightBlur}
                onChange={handleWeightInput}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                style={{ width: 110, fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 48, lineHeight: 1, textAlign: 'center', background: 'transparent', border: 'none', borderBottom: '2px solid hsl(var(--primary))', color: 'hsl(var(--foreground))', outline: 'none' }}
              />
            ) : (
              <button onClick={handleWeightTap} style={{ background: 'none', border: 'none', cursor: 'text', padding: 0 }}>
                <div style={{ fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 64, lineHeight: 0.9, letterSpacing: '-0.05em', color: 'hsl(var(--foreground))', transform: isDragging ? 'scale(0.96)' : 'scale(1)', transition: 'transform 0.15s' }}>
                  <NumberReel value={value} digits={String(range[1]).length} size={64} />
                </div>
              </button>
            )}
            <div className="font-mono text-[11px] font-bold tracking-[0.3em] uppercase text-primary mt-1">{unit === 'kg' ? 'KG' : 'LBS'}</div>
            <div className="font-mono text-[9px] text-muted-foreground mt-1">≈ {unit === 'kg' ? `${lbFromKg(value)} lb` : `${kgFromLb(value)} kg`}</div>
          </div>
        </div>

        {/* Barbell */}
        <BarbellVisualizer kg={valueKg} />

        {/* Horizontal scrubber */}
        <div ref={ref} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          style={{ position: 'relative', height: 44, marginTop: 10, cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none', overflow: 'hidden', maskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)' }}>
          <div style={{ position: 'absolute', inset: 0, transform: `translateX(${offsetX}px)`, transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.16,1,0.3,1)' }}>
            {ticks.map(v => {
              const isMajor = unit === 'kg' ? v % 10 === 0 : v % 25 === 0;
              const isMid = unit === 'kg' ? v % 5 === 0 && !isMajor : v % 10 === 0 && !isMajor;
              const isActive = v === value;
              return (
                <span key={v}>
                  <span style={{ position: 'absolute', left: v * PX, top: '50%', transform: 'translate(-50%,-50%)', width: 1.5, height: isMajor ? 20 : isMid ? 12 : 6, background: isActive ? 'hsl(var(--primary))' : isMajor ? 'hsl(var(--foreground)/0.5)' : 'hsl(var(--muted-foreground)/0.25)' }} />
                  {isMajor && <span style={{ position: 'absolute', left: v * PX, top: '75%', transform: 'translateX(-50%)', fontFamily: 'ui-monospace,monospace', fontSize: 9, fontWeight: 600, color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}>{v}</span>}
                </span>
              );
            })}
          </div>
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, marginLeft: -1, background: 'linear-gradient(180deg, hsl(var(--primary)), transparent)', boxShadow: '0 0 10px hsl(var(--primary))', pointerEvents: 'none' }} />
        </div>

        {/* ± Fine-tune buttons — always reachable even if drag doesn't work */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 10 }}>
          <button onClick={() => bump(-5)} style={nudgeBtnStyle}>−5</button>
          <button onClick={() => bump(-1)} style={nudgeBtnStyle}>−1</button>
          <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, color: 'hsl(var(--muted-foreground))', minWidth: 56, textAlign: 'center' }}>tap number to type</span>
          <button onClick={() => bump(+1)} style={nudgeBtnStyle}>+1</button>
          <button onClick={() => bump(+5)} style={nudgeBtnStyle}>+5</button>
        </div>
      </div>
      <div className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext}>Continue <Icon name="arrow-right" size={18} strokeWidth={2.5} /></PrimaryBtn>
      </div>
    </div>
  );
}

/* ─── Legacy combined stats step (kept but not used in main flow) ─── */
function StatsStep({ username, onUsernameChange, stats, onChange, onNext, onBack, step, total, usernameError }) {
  const ageOk = stats.age >= 13 && stats.age <= 80;
  const userOk = username.trim().length >= 2 && !usernameError;
  const canNext = ageOk && userOk;

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto space-y-3 pb-4 pr-2">
        <KineticHeading kicker="Stats · 03" text="A few numbers, then we're done." accentWord="numbers," />
        <p className="text-sm text-muted-foreground mt-2 mb-4">Drag to set. Encrypted, never sold.</p>

        {/* Username */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="user" size={15} color="hsl(var(--muted-foreground))" />
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Username</span>
          </div>
          <input
            type="text"
            value={username}
            onChange={e => onUsernameChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder="e.g. jordan_lifts"
            maxLength={20}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="next"
            className="w-full h-12 rounded-xl border border-border bg-secondary/50 px-4 font-mono text-[16px] font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
          />
          {usernameError && <p className="text-xs text-destructive mt-1.5">{usernameError}</p>}
          <p className="text-xs text-muted-foreground mt-1.5">Lowercase, numbers and underscores only</p>
        </motion.div>

        {/* Age */}
        <StatCard icon="user" label="Age" value={stats.age} unit="yrs" min={13} max={80} majorEvery={5}
          onChange={v => onChange({ ...stats, age: v })}
          suffix={stats.age < 18 ? 'guardian consent reqd' : ''} />

        {/* Height */}
        <StatCard
          icon="ruler" label="Height"
          value={stats.heightUnit === 'cm' ? stats.heightCm : stats.heightIn}
          unit={stats.heightUnit === 'cm' ? 'cm' : 'in'}
          min={stats.heightUnit === 'cm' ? 120 : 48} max={stats.heightUnit === 'cm' ? 220 : 84}
          majorEvery={stats.heightUnit === 'cm' ? 10 : 6}
          onChange={v => stats.heightUnit === 'cm' ? onChange({ ...stats, heightCm: v }) : onChange({ ...stats, heightIn: v })}
          unitToggle={<UnitToggle options={[{id:'cm',label:'cm'},{id:'in',label:'in'}]} value={stats.heightUnit} onChange={u => onChange({ ...stats, heightUnit: u })} />}
          suffix={stats.heightUnit === 'in' ? `${Math.floor(stats.heightIn / 12)}'${stats.heightIn % 12}"` : ''}
        />

        {/* Weight */}
        <StatCard
          icon="scale" label="Weight"
          value={stats.weightUnit === 'kg' ? stats.weightKg : stats.weightLb}
          unit={stats.weightUnit}
          min={stats.weightUnit === 'kg' ? 35 : 80} max={stats.weightUnit === 'kg' ? 200 : 440}
          majorEvery={stats.weightUnit === 'kg' ? 10 : 20}
          onChange={v => stats.weightUnit === 'kg' ? onChange({ ...stats, weightKg: v }) : onChange({ ...stats, weightLb: v })}
          unitToggle={<UnitToggle options={[{id:'kg',label:'kg'},{id:'lb',label:'lb'}]} value={stats.weightUnit} onChange={u => onChange({ ...stats, weightUnit: u })} />}
        />
      </div>

      <div className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext} disabled={!canNext}>
          Continue <Icon name="arrow-right" size={18} strokeWidth={2.5} />
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 5: SCHEDULE
═══════════════════════════════════════════════════════════════ */

function DaysStep({ days, preferredTime, onDaysChange, onTimeChange, onNext, onBack, step, total }) {
  const toggle = (i) => {
    const next = days.includes(i) ? days.filter(d => d !== i) : [...days, i];
    onDaysChange(next);
    if (navigator.vibrate) navigator.vibrate(4);
  };
  const count = days.length;
  const intensityLabel = count === 0 ? '—' : count <= 2 ? 'Light cadence' : count <= 4 ? 'Balanced' : count <= 5 ? 'Serious' : 'Hardcore';

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4 pr-2 space-y-5">
        <KineticHeading kicker="Schedule · 04" text="Which days can you train?" accentWord="train?" />
        <p className="text-sm text-muted-foreground mt-2">Plan around real life — we'll keep recovery in check.</p>

        {/* Count card */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border bg-card p-5 text-center relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none transition-all duration-500"
            style={{ background: `radial-gradient(80% 60% at 50% 0%, hsl(var(--primary) / ${0.04 + count * 0.025}), transparent 70%)` }} />
          <div className="relative flex items-baseline justify-center gap-2">
            <motion.span key={count} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="font-heading font-bold text-[52px] leading-none tracking-tight text-foreground">
              {count}
            </motion.span>
            <span className="font-heading font-semibold text-xl text-muted-foreground">days · week</span>
          </div>
          <div className="relative font-mono text-[11px] font-bold tracking-[0.18em] uppercase text-primary mt-1">{intensityLabel}</div>
        </motion.div>

        {/* Day grid */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          className="grid grid-cols-7 gap-2">
          {WEEKDAYS.map((d, i) => {
            const selected = days.includes(i);
            return (
              <button key={d} onClick={() => toggle(i)}
                className="flex flex-col items-center gap-1 py-3 rounded-xl border cursor-pointer transition-all font-medium"
                style={{
                  borderColor: selected ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                  background: selected ? 'hsl(var(--primary))' : 'hsl(var(--card))',
                  color: selected ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                }}>
                <span className="text-[11px]">{d}</span>
                <span className="w-1.5 h-1.5 rounded-full"
                  style={{ background: selected ? 'currentColor' : 'hsl(var(--border))' }} />
              </button>
            );
          })}
        </motion.div>

        {/* Preferred time */}
        <div>
          <div className="font-mono text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-3">Preferred time</div>
          <div className="grid grid-cols-2 gap-2">
            {TIMES.map(t => (
              <button key={t} onClick={() => onTimeChange(t)}
                className="py-3 rounded-xl border text-sm font-medium cursor-pointer transition-all"
                style={{
                  borderColor: preferredTime === t ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                  background: preferredTime === t ? 'hsl(var(--primary) / 0.07)' : 'hsl(var(--card))',
                  color: preferredTime === t ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext} disabled={count === 0}>
          Build my plan <Icon name="arrow-right" size={18} strokeWidth={2.5} />
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 6: LOADING
═══════════════════════════════════════════════════════════════ */

function LoadingStep({ onDone }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= LOADING_TASKS.length) { const t = setTimeout(onDone, 600); return () => clearTimeout(t); }
    const t = setTimeout(() => setStep(s => s + 1), 720);
    return () => clearTimeout(t);
  }, [step, onDone]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      {/* Logo animation */}
      <motion.div className="relative w-28 h-28 flex items-center justify-center mb-2"
        animate={{ scale: [1, 1.04, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
        {[0, 1, 2].map(i => (
          <motion.div key={i} className="absolute rounded-full border border-primary/25"
            style={{ inset: i * -14 }}
            animate={{ opacity: [0.5, 0.1, 0.5], scale: [1, 1.08, 1] }}
            transition={{ duration: 2.2, delay: i * 0.4, repeat: Infinity, ease: 'easeInOut' }} />
        ))}
        <div className="w-20 h-20 rounded-[22px] flex items-center justify-center shadow-2xl shadow-primary/40"
          style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(38 92% 60%))' }}>
          <span className="font-heading font-bold text-3xl text-white tracking-tighter">F</span>
        </div>
      </motion.div>

      <h2 className="font-heading font-bold text-2xl tracking-tight text-foreground text-center">Building your plan</h2>
      <p className="text-sm text-muted-foreground text-center">Tuned to your goal · experience · schedule</p>

      <div className="w-full max-w-xs space-y-3 mt-4">
        {LOADING_TASKS.map((task, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <div key={task} className="flex items-center gap-3 transition-opacity duration-300"
              style={{ opacity: i <= step ? 1 : 0.35 }}>
              <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 relative"
                style={{
                  background: done ? 'hsl(var(--primary))' : 'transparent',
                  border: done ? 'none' : `1.5px solid hsl(var(--${active ? 'primary' : 'border'}))`,
                }}>
                {done && <Icon name="check" size={11} strokeWidth={3.5} color="white" />}
                {active && (
                  <motion.span className="absolute inset-0.5 rounded-full border border-primary border-t-transparent"
                    animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }} />
                )}
              </div>
              <span className="text-sm transition-all" style={{ color: done ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))', fontWeight: active ? 600 : 400 }}>
                {task}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 7: REVEAL
═══════════════════════════════════════════════════════════════ */

function RevealStep({ data, onNext, saving = false, previewRegimen = null }) {
  const goalIds = Array.isArray(data.goal) ? data.goal : (data.goal ? [data.goal] : []);
  const primaryGoal = GOALS.find(g => g.id === goalIds[0]) || GOALS[0];
  const extraGoalCount = Math.max(0, goalIds.length - 1);
  const level = LEVELS.find(l => l.id === data.level) || LEVELS[0];
  const daysCount = data.days.length;
  const weeklyVol = Math.round(80 + (level?.bars || 1) * 30 + daysCount * 12 + extraGoalCount * 14);
  const weeks = (level?.bars || 1) >= 3 ? 12 : 8;

  // Real exercises from the regimen we'll persist on submit. Falls back to
  // an empty list if the generator wasn't passed in (legacy / unit-test path).
  const previewExercises = previewRegimen?.exercises ?? [];
  const totalSets = previewExercises.reduce((s, ex) => s + (ex.target_sets || 0), 0);

  return (
    <div className="flex flex-col h-full">
      <Confetti pieces={28} />
      <div className="flex-1 overflow-y-auto pb-4 pt-2 pr-2">
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="font-mono text-[11px] font-bold tracking-[0.18em] text-primary uppercase mb-4">
          Plan ready · 100%
        </motion.div>

        <h1 className="font-heading font-bold text-[38px] leading-[1.0] tracking-tight text-foreground m-0 mb-4">
          <motion.span initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.55, ease: [0.16,1,0.3,1] }} className="inline-block mr-3">Welcome</motion.span>
          <motion.span initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.55, ease: [0.16,1,0.3,1] }} className="inline-block mr-3">in,</motion.span>
          <br />
          <motion.span initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.55, ease: [0.16,1,0.3,1] }} className="inline-block text-primary">{data.username || 'lifter'}.</motion.span>
        </h1>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
          className="text-[14px] text-muted-foreground leading-relaxed mb-6 max-w-xs">
          A <strong className="text-foreground">{weeks}-week</strong> {primaryGoal.title.toLowerCase()}
          {extraGoalCount > 0 && <> + <strong className="text-foreground">{extraGoalCount} more</strong></>} block,
          dialled in for a <strong className="text-foreground">{level?.label.toLowerCase()}</strong> lifter on{' '}
          <strong className="text-foreground">{daysCount} days</strong>.
        </motion.p>

        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          {[
            { label: 'Block length', value: weeks, unit: 'weeks', delay: 0.7 },
            { label: 'Weekly volume', value: weeklyVol, unit: 'sets', delay: 0.78 },
          ].map(({ label, value, unit, delay }) => (
            <motion.div key={label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
              className="rounded-2xl border bg-card p-4">
              <div className="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-2">{label}</div>
              <div className="font-heading font-bold text-2xl tracking-tight text-foreground">
                {value}<span className="text-muted-foreground text-[13px] font-semibold ml-1">{unit}</span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Your starter plan — the exercises we'll actually save to your Regimens */}
        {previewExercises.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.86 }}
            className="rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Your starter plan</span>
              <span className="font-mono text-[10px] font-bold text-emerald-500">● READY</span>
            </div>
            <div className="font-heading font-bold text-[17px] tracking-tight text-foreground">{previewRegimen?.name || `${primaryGoal.title} starter`}</div>
            <div className="flex items-center gap-3 mt-1 text-[12px] text-muted-foreground">
              <span>{previewExercises.length} lifts</span>
              <span>· {totalSets} sets</span>
              <span>· saved to Workout → Regimens</span>
            </div>
            <ul className="mt-3 grid grid-cols-1 gap-1.5">
              {previewExercises.slice(0, 6).map((ex, i) => (
                <motion.li
                  key={ex.name}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.9 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center justify-between text-[13px]"
                >
                  <span className="font-medium text-foreground truncate pr-2">{ex.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground shrink-0">{ex.target_sets} × {ex.target_reps}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }}
        className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext} disabled={saving}>
          {saving ? (
            <>
              <span className="inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              Saving…
            </>
          ) : (
            <>Enter Flexyn <Icon name="arrow-right" size={18} strokeWidth={2.5} /></>
          )}
        </PrimaryBtn>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN ONBOARDING ORCHESTRATOR
═══════════════════════════════════════════════════════════════ */

const STEPS = ['welcome', 'goal', 'experience', 'age', 'height', 'weight', 'days', 'assessment', 'loading', 'reveal'];
const FORM_STEP_NAMES = ['goal', 'experience', 'age', 'height', 'weight', 'days', 'assessment'];
const TOTAL_FORM = FORM_STEP_NAMES.length;

// Per-step theatrical transition flavors — variety = wow factor
const STEP_TRANSITIONS = {
  welcome:    null,                                // first step, no entry needed
  goal:       'curtain',
  experience: 'tilt',
  age:        'fwd',
  height:     'flip',
  weight:     'tilt',
  days:       'curtain',
  assessment: 'fwd',
  loading:    'flash',
  reveal:     'iris',
};

function buildVariants(flavor, direction) {
  // exit is a quick fade+slide — GPU-only (opacity + transform) for 60fps on mobile
  const exitX = direction > 0 ? -24 : 24;
  const exit = { opacity: 0, x: exitX, transition: { duration: 0.24, ease: [0.4, 0, 1, 1] } };

  switch (flavor) {
    case 'curtain':
      return {
        enter:  { clipPath: 'inset(0 0 0 100%)', opacity: 1 },
        center: { clipPath: 'inset(0 0 0 0%)', opacity: 1, transition: { duration: 0.6, ease: [0.76, 0, 0.24, 1] } },
        exit,
      };
    case 'tilt':
      return {
        // No blur — rotateY + opacity only (GPU-composited)
        enter:  { opacity: 0, rotateY: direction > 0 ? -18 : 18, x: direction > 0 ? 50 : -50, scale: 0.96 },
        center: { opacity: 1, rotateY: 0, x: 0, scale: 1, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
        exit,
      };
    case 'flip':
      return {
        enter:  { opacity: 0, rotateX: direction > 0 ? 35 : -35, y: direction > 0 ? 24 : -24 },
        center: { opacity: 1, rotateX: 0, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
        exit,
      };
    case 'flash':
      return {
        // Scale + opacity only — brightness is expensive on mobile, skip it
        enter:  { opacity: 0, scale: 1.05 },
        center: { opacity: 1, scale: 1, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
        exit,
      };
    case 'iris':
      return {
        enter:  { clipPath: 'circle(0% at 50% 55%)', scale: 1.03 },
        center: { clipPath: 'circle(140% at 50% 55%)', scale: 1, transition: { duration: 0.75, ease: [0.65, 0, 0.35, 1] } },
        exit,
      };
    default: // 'fwd' / 'back'
      return {
        enter:  { opacity: 0, x: direction > 0 ? 36 : -36 },
        center: { opacity: 1, x: 0, transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] } },
        exit,
      };
  }
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoadingAuth, checkUserAuth, user } = useAuth();
  const { setWeightUnit } = useWeightUnit();

  const [stepIdx, setStepIdx] = useState(0);
  const [direction, setDirection] = useState(1);
  const [saving, setSaving] = useState(false);

  // Persist in-flight onboarding state to localStorage so a refresh / tab
  // close mid-flow doesn't lose 6 steps of input. Cleared on successful
  // submit (handleRevealNext). Keyed independent of user id so unauthed
  // users persist too; on auth, the same value carries through.
  const ONBOARDING_DRAFT_KEY = 'fn-onboarding-draft-v1';

  const DEFAULT_DATA = {
    username: '',
    goal: [],
    level: null,
    stats: {
      age: 26,
      heightCm: 178, heightIn: 70,
      weightKg: 75, weightLb: 165,
      heightUnit: 'in', weightUnit: 'lb',
    },
    days: [],
    preferredTime: '',
    // 4-question lift-estimate assessment. Optional — empty object
    // means "skipped." See `assessment` step + buildStarterRegimen.
    assessment: {},
  };

  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(ONBOARDING_DRAFT_KEY);
      if (!raw) return DEFAULT_DATA;
      const parsed = JSON.parse(raw);
      // Shallow-merge so any new fields we add later get their defaults
      // and stale partial drafts don't break the form.
      return {
        ...DEFAULT_DATA,
        ...parsed,
        stats: { ...DEFAULT_DATA.stats, ...(parsed.stats || {}) },
      };
    } catch {
      return DEFAULT_DATA;
    }
  });

  // Persist every data change. Cheap — the object is small (< 500 bytes).
  useEffect(() => {
    try {
      localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(data));
    } catch { /* private mode / quota */ }
  }, [data]);

  const [usernameError, setUsernameError] = useState('');

  // Pre-compute the starter regimen the user will see on the Reveal step
  // AND the one we'll actually persist on submit — same object both places,
  // so the preview can't lie about what the user is getting. Pure function,
  // safe to recompute on every relevant input change.
  const previewRegimen = useMemo(
    () => buildStarterRegimen({
      goals: data.goal,
      level: data.level,
      daysCount: Array.isArray(data.days) ? data.days.length : 0,
    }),
    [data.goal, data.level, data.days]
  );

  // Force Iron Orange theme during onboarding so new/reset users always see
  // the default look regardless of any previously-saved theme.
  useEffect(() => {
    const ironOrange = {
      '--primary': '26 90% 50%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '210 18% 30%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '26 90% 50%',
      '--sidebar-primary': '26 90% 50%',
      '--sidebar-ring': '26 90% 50%',
    };
    const root = document.documentElement;
    const prev = {};
    Object.keys(ironOrange).forEach(k => {
      prev[k] = root.style.getPropertyValue(k);
      root.style.setProperty(k, ironOrange[k]);
    });
    return () => {
      // Restore saved theme vars when leaving onboarding
      Object.entries(prev).forEach(([k, v]) => root.style.setProperty(k, v));
    };
  }, []);

  // If already authenticated with a complete profile, redirect to dashboard.
  // Accounts with a deleted_ username placeholder (from account reset) must NOT
  // be skipped — they need to re-onboard and pick a real username.
  useEffect(() => {
    const isDeletedPlaceholder = !!(user?.username?.startsWith('deleted_'));
    const hasRealUsername = !!(user?.username && !isDeletedPlaceholder);
    // Never skip onboarding for deleted_ placeholder accounts — stale
    // onboarding_complete flags must not override the re-onboarding gate.
    if (!isDeletedPlaceholder && (user?.onboarding_complete || hasRealUsername)) {
      navigate('/dashboard', { replace: true });
    }
  }, [user?.onboarding_complete, user?.username]);

  // If they authenticated via the "get started" flow, skip to goal step
  useEffect(() => {
    if (isAuthenticated && stepIdx === 0) {
      goTo(1);
    }
  }, [isAuthenticated]);

  const goTo = (idx) => {
    setDirection(idx > stepIdx ? 1 : -1);
    setStepIdx(idx);
  };

  const next = () => goTo(Math.min(STEPS.length - 1, stepIdx + 1));
  const back = () => goTo(Math.max(0, stepIdx - 1));

  const stepName = STEPS[stepIdx];
  const formStep = FORM_STEP_NAMES.indexOf(stepName) + 1; // 0 if not a form step

  const handleUsernameChange = (val) => {
    setData(d => ({ ...d, username: val }));
    if (val.length >= 2 && containsProfanity(val)) {
      setUsernameError('Username contains inappropriate language.');
    } else if (val.length > 20) {
      setUsernameError('Username must be 20 characters or less.');
    } else {
      setUsernameError('');
    }
  };

  // Debounced username availability check. Without this, the user fills
  // every step and only discovers their username is taken when the final
  // submit fails with a confusing toast. We query as they type and surface
  // a clear "That username is taken" message inline.
  //
  // Race-safe via a monotonically increasing sequence ID: if a slow
  // response arrives after the user has typed something newer, we drop
  // it. Without this, a "name1 → name2" sequence where name1's reply
  // returns after name2's could falsely flag name2 as taken.
  const usernameCheckSeqRef = useRef(0);
  useEffect(() => {
    const u = (data.username || '').trim();
    if (u.length < 3) return;
    if (usernameError) return; // already showing a different validation error
    const seq = ++usernameCheckSeqRef.current;
    const timer = setTimeout(async () => {
      try {
        const { data: rows } = await safeSelect({
          columns: ['id'],
          build: (cols) => supabase
            .from('user_profiles')
            .select(cols)
            .ilike('username', u)
            .limit(1),
        });
        if (seq !== usernameCheckSeqRef.current) return; // a newer keystroke superseded us
        if (!rows || rows.length === 0) return;
        // If the only matching row IS the current user, that's fine.
        if (user?.id && rows[0].id === user.id) return;
        setUsernameError('That username is already taken.');
      } catch { /* network/RLS — fall through silently, the final-submit
                  check will still catch the duplicate via 23505 */ }
    }, 350);
    return () => clearTimeout(timer);
  }, [data.username, user?.id, usernameError]);

  const handleRevealNext = async () => {
    setSaving(true);
    const s = data.stats;
    const weightUnit = s.weightUnit === 'kg' ? 'kg' : 'lbs';

    // Full profile payload
    const fullProfile = {
      username:               data.username.trim(),
      // fitness_goals is a text column — join the array to a comma-separated string.
      // The new fitness_goals_arr (text[]) column added in migration 006 gets the raw array.
      fitness_goals:          Array.isArray(data.goal) ? data.goal.join(',') : (data.goal || ''),
      fitness_goals_arr:      Array.isArray(data.goal) ? data.goal : [],
      fitness_level:          data.level,
      fitness_assessment:     data.assessment || {},
      training_days:          data.days,
      preferred_workout_time: data.preferredTime,
      age:                    s.age,
      height_cm:    s.heightUnit === 'cm' ? String(s.heightCm) : String(Math.round(s.heightIn * 2.54)),
      height_inches: s.heightUnit === 'in' ? String(s.heightIn) : String(Math.round(s.heightCm / 2.54)),
      height_unit:  s.heightUnit === 'cm' ? 'metric' : 'imperial',
      weight_kg:    s.weightUnit === 'kg' ? String(s.weightKg) : String(Math.round(s.weightLb * 0.453592)),
      weight_lbs:   s.weightUnit === 'lb' ? String(s.weightLb) : String(Math.round(s.weightKg / 0.453592)),
      weight_unit:  weightUnit,
      onboarding_complete:      true,
      onboarding_completed:     true,
      onboarding_completed_at:  new Date().toISOString(),
    };

    let saved = false;
    try {
      await db.auth.updateMe(fullProfile);
      setWeightUnit(weightUnit);
      markReturningUser();
      if (checkUserAuth) await checkUserAuth();
      // Grant starter capsule for brand-new users (idempotent — skips if they
      // already have one). Fire-and-forget but log failures so we know if it
      // ever breaks — previously this swallowed errors completely.
      if (user?.id && user?.email) {
        grantWelcomeCapsule(user.id, user.email).catch(err => {
          reportError(err, { feature: 'onboarding.welcome-capsule', level: 'warning', userEmail: user?.email });
        });
      }
      // Create the starter regimen we just promised on the Reveal screen.
      // Fire-and-forget — onboarding completion must not be gated on this.
      // ensureStarterRegimen is idempotent (skips if any regimens exist) so
      // it's safe even if the user re-onboards after an account reset.
      ensureStarterRegimen({
        user,
        profile: {
          goals: data.goal,
          level: data.level,
          daysCount: Array.isArray(data.days) ? data.days.length : 0,
          assessment: data.assessment || null,
        },
      }).catch(err => {
        reportError(err, { feature: 'onboarding.starter-regimen', level: 'warning', userEmail: user?.email });
      });
      saved = true;
    } catch (err) {
      // Full save failed — try the minimal fallback below. This is a
      // warning (not error) because we have a documented fallback path;
      // the real error level is set on minErr below if BOTH fail.
      reportError(err, { feature: 'onboarding.full-save', level: 'warning', userEmail: user?.email, note: 'attempting minimal-save fallback' });
      // Detect duplicate-username error and route the user back to a step
      // where they can fix it — the old code just toasted a misleading
      // "check your connection" message and stranded them on the reveal
      // screen. Postgres 23505 = unique_violation, message also mentions
      // "username" when the username unique constraint is the culprit.
      const isDupUsername =
        err?.code === '23505' ||
        /duplicate key|unique constraint|already exists/i.test(err?.message || '') ||
        /username/i.test(err?.message || '');
      if (isDupUsername) {
        setUsernameError('That username is already taken. Try another.');
        setSaving(false);
        // Jump back to the age step (last step before reveal where the
        // username field is visible) so the user can edit it.
        const ageIdx = STEPS.indexOf('age');
        if (ageIdx >= 0) goTo(ageIdx);
        toast.error('That username is already taken — try another.');
        return;
      }
      // Server-side profanity trigger (migration 050) — surfaces as
      // 23514 with a 'username_profanity' tag in err.message. Route the
      // user back to the username step with a clear inline error so
      // they can fix it without guessing.
      const isProfaneUsername =
        err?.code === '23514' &&
        /username_profanity|prohibited content/i.test((err?.message || '') + ' ' + (err?.hint || ''));
      if (isProfaneUsername) {
        setUsernameError('That username contains prohibited content. Pick another.');
        setSaving(false);
        const ageIdx = STEPS.indexOf('age');
        if (ageIdx >= 0) goTo(ageIdx);
        toast.error('Username contains prohibited content — pick another.');
        return;
      }

      // Fallback: save the user's actual answers, not just username +
      // the completion flag. Previously this only persisted username
      // and onboarding_completed, so a user who filled all six steps
      // and hit a transient network blip on the full save landed on
      // the Dashboard with an empty profile (no fitness goals, no
      // level, no demographics). The starter regimen grant also
      // skipped because it needs goals + level. db.js's strip-and-retry
      // (42703 / PGRST204) handles any column the running schema
      // doesn't have, so passing every field is safe on legacy hosts.
      try {
        await db.auth.updateMe({
          username:                data.username.trim(),
          fitness_goals:           Array.isArray(data.goal) ? data.goal.join(',') : (data.goal || ''),
          fitness_goals_arr:       Array.isArray(data.goal) ? data.goal : [],
          fitness_level:           data.level,
          training_days:           data.days,
          preferred_workout_time:  data.preferredTime,
          age:                     data.stats?.age,
          height_cm:    data.stats?.heightUnit === 'cm' ? String(data.stats?.heightCm) : String(Math.round((data.stats?.heightIn || 0) * 2.54)),
          height_inches: data.stats?.heightUnit === 'in' ? String(data.stats?.heightIn) : String(Math.round((data.stats?.heightCm || 0) / 2.54)),
          height_unit:  data.stats?.heightUnit === 'cm' ? 'metric' : 'imperial',
          weight_kg:    data.stats?.weightUnit === 'kg' ? String(data.stats?.weightKg) : String(Math.round((data.stats?.weightLb || 0) * 0.453592)),
          weight_lbs:   data.stats?.weightUnit === 'lb' ? String(data.stats?.weightLb) : String(Math.round((data.stats?.weightKg || 0) / 0.453592)),
          weight_unit:  data.stats?.weightUnit === 'kg' ? 'kg' : 'lbs',
          onboarding_completed:    true,
          onboarding_completed_at: new Date().toISOString(),
        });
        setWeightUnit(weightUnit);
        markReturningUser();
        if (checkUserAuth) await checkUserAuth();
        saved = true;
      } catch (minErr) {
        // Both saves failed — this IS the user-blocking state. Report as
        // 'error' level so it stands out from the warning-level full-save
        // attempt above.
        reportError(minErr, { feature: 'onboarding.minimal-save', userEmail: user?.email, note: 'both full and minimal save failed' });
        // Same duplicate detection on the minimal save.
        const isDupUsernameMin =
          minErr?.code === '23505' ||
          /duplicate key|unique constraint|already exists/i.test(minErr?.message || '');
        const isProfaneUsernameMin =
          minErr?.code === '23514' &&
          /username_profanity|prohibited content/i.test((minErr?.message || '') + ' ' + (minErr?.hint || ''));
        if (isDupUsernameMin) {
          setUsernameError('That username is already taken. Try another.');
          const ageIdx = STEPS.indexOf('age');
          if (ageIdx >= 0) goTo(ageIdx);
          toast.error('That username is already taken — try another.');
        } else if (isProfaneUsernameMin) {
          setUsernameError('That username contains prohibited content. Pick another.');
          const ageIdx = STEPS.indexOf('age');
          if (ageIdx >= 0) goTo(ageIdx);
          toast.error('Username contains prohibited content — pick another.');
        } else {
          // Do NOT mark as returning user — onboarding_completed never wrote to DB.
          // User will be able to retry by tapping Save again. Include a hint
          // about which kind of failure this looks like so the user knows
          // whether to retry or to take action.
          const looksOffline = !navigator.onLine || /network|failed to fetch|timeout/i.test(minErr?.message || '');
          toast.error(
            looksOffline
              ? "You're offline — reconnect and tap Save again."
              : 'Could not save your profile. Tap Save to retry.',
            { duration: 6000 }
          );
        }
      }
    } finally {
      setSaving(false);
      // Only navigate away if at least the minimal save succeeded.
      if (saved) {
        // Clear the persisted draft now that the profile is in the DB.
        try { localStorage.removeItem(ONBOARDING_DRAFT_KEY); } catch { /* ignore */ }
        navigate('/dashboard', { replace: true });
      }
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background overflow-hidden">
      <Aurora />

      <div className="relative z-10 h-full flex items-start justify-center overflow-hidden">
        <div className="w-full max-w-[420px] h-full px-6 py-10 flex flex-col">
          <AnimatePresence mode="wait">
            <motion.div key={stepName}
              variants={buildVariants(direction > 0 ? STEP_TRANSITIONS[stepName] : 'back', direction)}
              initial="enter" animate="center" exit="exit"
              style={{ perspective: 1000, transformStyle: 'preserve-3d', willChange: 'transform, opacity' }}
              className="flex-1 flex flex-col min-h-0">

              {stepName === 'welcome' && (
                <WelcomeStep
                  onNext={() => {
                    if (isAuthenticated) { next(); }
                    else { db.auth.redirectToLogin('/'); }
                  }}
                  onSignIn={() => db.auth.redirectToLogin('/')}
                />
              )}

              {stepName === 'goal' && (
                <GoalStep step={formStep} total={TOTAL_FORM}
                  value={data.goal} onChange={v => setData(d => ({ ...d, goal: v }))}
                  onNext={next}
                  // No Back button for authenticated users: a Back from
                  // `goal` would land on `welcome`, which the auto-advance
                  // effect immediately bounces back to `goal`. The button
                  // would look broken. Pass null → StepHeader hides it.
                  onBack={isAuthenticated ? null : back} />
              )}

              {stepName === 'experience' && (
                <ExperienceStep step={formStep} total={TOTAL_FORM}
                  value={data.level} onChange={v => setData(d => ({ ...d, level: v }))}
                  onNext={next} onBack={back} />
              )}

              {stepName === 'age' && (
                <AgeStep step={formStep} total={TOTAL_FORM}
                  username={data.username} onUsernameChange={handleUsernameChange}
                  usernameError={usernameError}
                  stats={data.stats} onChange={s => setData(d => ({ ...d, stats: s }))}
                  onNext={next} onBack={back} />
              )}

              {stepName === 'height' && (
                <HeightStep step={formStep} total={TOTAL_FORM}
                  stats={data.stats} onChange={s => setData(d => ({ ...d, stats: s }))}
                  onNext={next} onBack={back} />
              )}

              {stepName === 'weight' && (
                <WeightStep step={formStep} total={TOTAL_FORM}
                  stats={data.stats} onChange={s => setData(d => ({ ...d, stats: s }))}
                  onNext={next} onBack={back} />
              )}

              {stepName === 'days' && (
                <DaysStep step={formStep} total={TOTAL_FORM}
                  days={data.days} preferredTime={data.preferredTime}
                  onDaysChange={v => setData(d => ({ ...d, days: v }))}
                  onTimeChange={v => setData(d => ({ ...d, preferredTime: v }))}
                  onNext={next} onBack={back} />
              )}

              {stepName === 'assessment' && (
                <AssessmentStep
                  step={formStep}
                  total={TOTAL_FORM}
                  value={data.assessment}
                  onChange={v => setData(d => ({ ...d, assessment: v }))}
                  onNext={next}
                  onBack={back}
                />
              )}

              {stepName === 'loading' && <LoadingStep onDone={next} />}

              {stepName === 'reveal' && (
                <RevealStep
                  data={data}
                  onNext={handleRevealNext}
                  saving={saving}
                  previewRegimen={previewRegimen}
                />
              )}

            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

