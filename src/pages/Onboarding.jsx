// src/pages/Onboarding.jsx
// Redesigned onboarding — 7-step flow with animated background, feature
// carousel, multi-select goals, experience level, stat scrubbers,
// schedule picker, loading animation, and personalised reveal.

import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SignInToContinue from './SignInToContinue';
import FlexynLogo from '@/components/FlexynLogo';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { selectProfiles } from '@/lib/data/users';
import { markReturningUser } from '@/lib/firstLaunch';
import { containsProfanity } from '@/lib/profanityFilter';
import { grantWelcomeCapsule } from '@/lib/data/capsules';
import { buildStarterRegimen, ensureStarterRegimen } from '@/lib/data/starterRegimen';
import { ensureOnboardingCardioGoal } from '@/lib/data/onboardingCardioGoal';
import StarterPlanView from '@/components/workout/StarterPlanView';
import { reportError } from '@/lib/reportError';
import { isDuplicateUsernameError, isProfaneUsernameError } from '@/lib/onboardingErrors';
import { escapeLikePattern } from '@/lib/sqlPattern';
import { buildProfilePayload, resolveMeasurements, parseHeightInput, PROFILE_RANGES } from '@/lib/data/onboardingProfile';
import { todayLocalDateString } from '@/lib/dateUtils';
import { useDateFormatter } from '@/lib/intl';
import NearbyGymPicker from '@/components/gyms/NearbyGymPicker';
import { setHomeGym, setHomeGymFromOsm } from '@/lib/data/homeGym';
import { OnboardingCoachButton, OnboardingCoachSheet } from '@/components/onboarding/OnboardingCoach';
import { hasCoachFor } from '@/lib/aiCoach/onboardingCoach';

/* ═══════════════════════════════════════════════════════════════
   COACH CONTEXT

   Every form step renders the shared <StepHeader>, so that is the one
   place the coach button has to be added — but StepHeader takes only
   {step, total, onBack} and threading the step id, the draft and an
   apply handler through eleven call sites would be eleven chances to
   forget one. A context is read by StepHeader directly and none of the
   step components change at all.
═══════════════════════════════════════════════════════════════ */

const OnboardingCoachContext = createContext(null);

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════ */

const GOALS = [
  { id: 'strength',  title: 'Build strength',   sub: 'Compound lifts. Heavy. Honest.',                        icon: 'dumbbell',      accent: 'hsl(26 95% 56%)'  },
  { id: 'muscle',    title: 'Add muscle',        sub: 'Hypertrophy program, smart volume.',                    icon: 'flame',         accent: 'hsl(14 92% 56%)'  },
  { id: 'lose',      title: 'Lose fat',          sub: 'Recomp without losing the gains.',                      icon: 'trending-down', accent: 'hsl(160 64% 45%)' },
  { id: 'speed',     title: 'Run faster',        sub: 'Sharpen your pace — intervals & tempo.',                icon: 'zap',           accent: 'hsl(45 93% 55%)'  },
  { id: 'endurance', title: 'Run further',       sub: 'Build distance without burning out.',                   icon: 'activity',      accent: 'hsl(217 91% 60%)' },
  { id: 'mobility',  title: 'Move better',       sub: 'Mobility, flexibility, longevity.',                     icon: 'wind',          accent: 'hsl(280 60% 60%)' },
];

const GOAL_TAILORS = {
  strength:  ['Heavier compounds', 'Anti-cheat: bar speed', '+15 g protein/day'],
  muscle:    ['Hypertrophy volume', 'Heatmap: chest / back / legs', '+25 g protein/day'],
  lose:      ['Calorie target −350', 'Cardio finishers', 'Anti-cheat: rest timer'],
  speed:     ['Interval sessions', 'Tempo runs', 'Pace tracking'],
  endurance: ['Easy-run base', 'Weekly long run', 'Carb-forward macros'],
  mobility:  ['Daily mobility flow', 'Form-check anti-cheat', 'Recovery weighting'],
};

// Goals that are cardio/running — used to decide whether the "sharpen your plan"
// step asks the cardio follow-ups.
const CARDIO_GOAL_IDS = ['speed', 'endurance'];

const LEVELS = [
  { id: 'newbie',     label: 'New',        sub: 'Less than 6 months lifting',      bars: 1, desc: "We'll start light, build form first." },
  { id: 'returning',  label: 'Returning',  sub: 'Coming back after a break',       bars: 2, desc: 'Ramp gently. Avoid the soreness wall.' },
  { id: 'consistent', label: 'Consistent', sub: '6–24 months under the bar',       bars: 3, desc: 'Progressive overload, real periodization.' },
  { id: 'advanced',   label: 'Advanced',   sub: '2+ years, lifts close to plateau', bars: 4, desc: 'Specificity, blocks, and earned PRs.' },
];

/* ── i18n ─────────────────────────────────────────────────────────
   Every table below keeps its English text, and the translation key is
   DERIVED from the row's stable id (`onboarding.goal.strength.title`), so
   there is no second list of keys to keep in sync with the first. Call sites
   read `tFallback(key, row.english)` — the English stays inline as the
   last-resort fallback, per the i18n rule in CLAUDE.md.

   Ids are also what gets PERSISTED. The preferred-training-time control used
   to store its English display label, so a French user's profile row read
   "Evening"; the label is now free to change or translate without touching
   the database. (Audit 18 #6, #11.)
────────────────────────────────────────────────────────────────── */

// Weekday abbreviations come from Intl rather than a translation table —
// correct in all 15 locales for free, instead of 105 hand-written strings.
// 2024-01-01 was a Monday; seven consecutive days from it give Mon…Sun in
// the order the day grid expects.
const WEEKDAY_SEED = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)));

const TIMES = [
  { id: 'morning',    label: 'Morning'    },
  { id: 'midday',     label: 'Midday'     },
  { id: 'evening',    label: 'Evening'    },
  { id: 'late_night', label: 'Late night' },
];

// Age bounds. Every part of the age step derives from these — the drag hook,
// the ± buttons, the tap-to-type clamp, the tick marks and the range captions.
// They were four separate literals and had already drifted: the control was
// raised to 100 but the ruler still stopped at 80, so anyone older scrubbed
// into 20 units of blank track under a caption that said the max was 80.
// (Audit 18 #3.) Floor is 13 — COPPA's minimum for a general-audience app;
// the TEEN life-stage chip covers 13-17 messaging.
// Sourced from the payload builder so the control and the value that reaches
// the database cannot disagree about what's allowed. Everything the steps
// offer is inside the real CHECK bounds — see DB_CHECK_BOUNDS there.
const AGE_MIN = PROFILE_RANGES.age.min;
const AGE_MAX = PROFILE_RANGES.age.max;

// One threshold for "long enough to be a username", read by both the Continue
// button and the availability check. They disagreed (2 vs 3) and the gap was
// invisible until submit. The 20-character ceiling is enforced by the field's
// maxLength and by handleUsernameChange.
const MIN_USERNAME_LENGTH = 2;

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
          fontFamily: 'var(--font-heading, Archivo, sans-serif)', fontSize: 28, fontWeight: 800,
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
          fontFamily: 'var(--font-heading, Archivo, sans-serif)', fontSize: 26, fontWeight: 800, color: 'white',
          // Tight shadow, not a soft halo. `0 2px 6px` spread the glyph edges
          // over ~6px and was the other half of why this number read as
          // low-quality; 1px keeps it legible against the pale top of the
          // flame without smearing it. (Audit 18 #15.)
          textShadow: '0 1px 2px rgba(0,0,0,0.45)', paddingTop: 10, overflow: 'hidden',
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
    case 'zap':           return <svg {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
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

// NOTE: the eyebrow on each step ("Experience · 03") must derive its number
// from the same `step` prop this header uses. Four of them were hardcoded
// string literals, and two had drifted out of sync — the Experience step
// showed "Experience · 02" beside a progress bar reading 03/11, so the app
// disagreed with itself about where the user was. Never type the number.
function StepHeader({ step, total, onBack }) {
  const { tFallback } = useLanguage();
  // Hide the Back button when there's nowhere to go back to. The first
  // form step (goal) had a broken Back button: it called `back()` →
  // stepIdx=0 (welcome) → an auto-advance effect immediately bounced
  // the authenticated user back to goal. The button LOOKED broken.
  // Treating `onBack === null` as "no back" lets the parent step decide.
  const canBack = typeof onBack === 'function';
  const coach = useContext(OnboardingCoachContext);
  const showCoach = !!coach && hasCoachFor(coach.stepName);
  return (
    <div className="flex items-center gap-3 mb-7">
      {canBack ? (
        <button onClick={onBack} aria-label={tFallback('onboarding.common.back', 'Back')}
          className="w-11 h-11 rounded-xl border border-border/70 bg-card/70 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-card active:bg-card transition-colors shrink-0">
          <Icon name="arrow-left" size={17} strokeWidth={2.5} />
        </button>
      ) : (
        // Spacer keeps the progress bar in the same position even when
        // the button is hidden — no layout jump between steps.
        <div className="w-11 h-11 shrink-0" aria-hidden="true" />
      )}
      <div className="flex-1 h-1.5 rounded-full bg-border/50 overflow-hidden">
        <motion.div className="h-full rounded-full bg-primary"
          initial={{ width: `${((step - 1) / total) * 100}%` }}
          animate={{ width: `${(step / total) * 100}%` }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} />
      </div>
      <span className="font-mono text-micro font-semibold text-muted-foreground shrink-0 tracking-wider">
        {String(step).padStart(2, '0')}<span className="opacity-40">/{String(total).padStart(2, '0')}</span>
      </span>
      {showCoach && <OnboardingCoachButton onClick={coach.open} />}
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
          className="font-mono text-micro font-bold text-primary tracking-[0.18em] uppercase mb-2.5">
          {kicker}
        </motion.div>
      )}
      <h1 className="font-heading font-bold text-[30px] leading-[1.05] tracking-tight text-foreground m-0">
        {words.map((w, i) => (
          <motion.span key={i} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="inline-block me-2"
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
      className={`w-full h-14 rounded-2xl font-heading font-bold text-body flex items-center justify-center gap-2 transition-all
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
  const { tFallback } = useLanguage();
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

  // Swipe affordance — user feedback ("make this carousel people
  // requested to scroll") flagged that the auto-rotating pips didn't
  // signal the cards were interactive. Drag-to-swipe + a subtle
  // bouncing chevron makes the gesture discoverable.
  const handleDragEnd = (_e, info) => {
    const dx = info.offset.x;
    const vx = info.velocity.x;
    if (dx < -40 || vx < -400) {
      setIdx(i => (i + 1) % FEATURES.length);
      setPaused(true);
      setTimeout(() => setPaused(false), 4000);
    } else if (dx > 40 || vx > 400) {
      setIdx(i => (i - 1 + FEATURES.length) % FEATURES.length);
      setPaused(true);
      setTimeout(() => setPaused(false), 4000);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85, duration: 0.5 }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.22}
      onDragEnd={handleDragEnd}
      className="relative rounded-[20px] border border-border overflow-hidden p-4 touch-pan-y cursor-grab active:cursor-grabbing"
      // No backdrop-filter. CLAUDE.md's UI rules ban glassmorphism outright
      // ("backdrop-blur is on the published list of signals designers use to
      // identify generated UI"), and it had a second cost here: backdrop-filter
      // promotes the whole subtree to its own composited layer, which is why
      // the streak card's "47" rendered soft next to the rest of the page.
      // (Audit 18 #15.)
      style={{ background: 'linear-gradient(180deg, hsl(var(--card) / 0.88), hsl(var(--card) / 0.65))' }}>
      {/* accent glow */}
      <div className="absolute -top-10 -end-10 w-44 h-44 rounded-full blur-[40px] transition-all duration-700 pointer-events-none"
        style={{ background: F.accent, opacity: 0.18 }} />
      {/* card body — keyed so it remounts + plays entry animation on each slide */}
      <div key={F.id} className="flex items-center gap-3"
        style={{ animation: 'ob-feat-enter 0.65s cubic-bezier(0.16,1,0.3,1) both', perspective: 800 }}>
        {/* Animated visual.
            The frame is sized to the TALLEST illustration, not to a round
            number. At 110px the Smart Log visual (127px: three set rows plus
            the "+ PR" badge) was clipped by 17px, so the badge and the bottom
            of the third row were sliced off — the "part of the bench is cut
            off" report from the 2026-08-05 walkthrough. The other four
            measure 87-100px and are centred in the frame.
            Keep the height FIXED: letting the frame size to its content would
            change the card's height per slide, which is the resize behaviour
            the carousel is explicitly not supposed to have. If this frame ever
            grows again, shrink the illustration instead. (Audit 18 #7.) */}
        <div className="flex items-center justify-center" style={{ width: 110, height: 132, flexShrink: 0, overflow: 'hidden' }}>
          <Visual accent={F.accent} />
        </div>
        {/* Copy */}
        {/* pe-5 reserves the strip the swipe chevron occupies. The chevron is
            positioned against the CARD (the nearest positioned ancestor), at
            end-3 — inside the card's own p-4 — so without this the sub-copy
            wrapped straight under it and rendered as "…RPE. ›". (Audit 18 #16.) */}
        <div className="flex-1 min-w-0 pe-5">
          <div className="font-mono text-micro font-bold tracking-[0.16em] uppercase mb-1" style={{ color: F.accent }}>
            {tFallback(`onboarding.feature.${F.id}.eyebrow`, F.eyebrow)}
          </div>
          <div className="font-heading font-bold text-body leading-tight tracking-tight text-foreground mb-1.5">
            {tFallback(`onboarding.feature.${F.id}.title`, F.title)}
          </div>
          <div className="text-[11.5px] leading-[1.45] text-muted-foreground">
            {tFallback(`onboarding.feature.${F.id}.sub`, F.sub)}
          </div>
        </div>
        {/* Bouncing chevron — subtle hint that the card slides horizontally */}
        <motion.span
          aria-hidden="true"
          animate={{ x: [0, 5, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 text-lg pointer-events-none select-none"
        >›</motion.span>
      </div>
      {/* pip indicators with progress fill */}
      <div className="flex gap-1.5 mt-3.5 items-center">
        {FEATURES.map((f, i) => {
          const active = i === idx;
          return (
            <button key={f.id} onClick={() => setIdx(i)}
              aria-label={tFallback('onboarding.feature.showAria', 'Show {name}', { name: tFallback(`onboarding.feature.${f.id}.eyebrow`, f.eyebrow) })}
              className="relative h-1 rounded-full cursor-pointer border-none p-0 transition-all duration-500 before:absolute before:content-[''] before:-inset-y-5 before:-inset-x-1"
              style={{ width: active ? 28 : 6, background: active ? 'hsl(var(--muted) / 0.7)' : 'hsl(var(--muted-foreground) / 0.3)' }}>
              {active && (
                <span key={idx} className="absolute inset-0 rounded-full overflow-hidden"
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
  const { tFallback } = useLanguage();
  // The hero animates word by word, so the copy has to survive being split on
  // spaces in any language — hence two line keys rather than one string with a
  // hardcoded <br>. The accent word is its own key because "mean" is the
  // emphasis in English and the equivalent word sits elsewhere in the sentence
  // in most other languages; if a translation doesn't contain it, nothing is
  // accented and the headline still reads correctly.
  const line1 = tFallback('onboarding.welcome.headline1', 'Train like you').split(' ');
  const line2 = tFallback('onboarding.welcome.headline2', 'actually mean it.').split(' ');
  const accent = tFallback('onboarding.welcome.accentWord', 'mean');
  let delay = 0.15;
  return (
    <div className="flex flex-col h-full pt-3 gap-5 justify-between">
      {/* Header */}
      <div className="flex items-center justify-between">
        <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
          <FlexynLogo className="h-9" />
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          className="font-mono text-micro font-semibold text-muted-foreground tracking-[0.16em] uppercase">V 2.0</motion.div>
      </div>

      {/* Hero */}
      <div>
        <h1 className="font-heading font-bold text-[44px] leading-[0.97] tracking-[-0.045em] text-foreground m-0">
          {line1.map((w, i) => (
            <motion.span key={`l1-${i}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: (delay += 0.1) - 0.1, duration: 0.55, ease: [0.16,1,0.3,1] }}
              className="inline-block me-3">{w}</motion.span>
          ))}
          <br />
          {line2.map((w, i) => (
            <motion.span key={`l2-${i}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: (delay += 0.1) - 0.1, duration: 0.55, ease: [0.16,1,0.3,1] }}
              className={`inline-block me-3 ${w.replace(/[.,!?]/g, '') === accent ? 'text-primary' : ''}`}>{w}</motion.span>
          ))}
        </h1>
      </div>

      {/* Feature carousel */}
      <FeatureCarousel />

      {/* CTAs */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95, duration: 0.4 }}
        className="flex flex-col gap-2">
        <PrimaryBtn onClick={onNext}>
          {tFallback('onboarding.welcome.cta', 'Get started')} <span className="ob-icon-bob inline-flex"><Icon name="arrow-right" size={20} strokeWidth={2.5} /></span>
        </PrimaryBtn>
        <p className="text-center text-micro font-medium text-muted-foreground/80 tracking-wide">
          {tFallback('onboarding.welcome.trustLine', 'Free to start · no card needed')}
        </p>
        <button onClick={onSignIn}
          className="text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors min-h-[44px] py-2 text-center">
          {tFallback('onboarding.welcome.haveAccount', 'I already have an account')}
        </button>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 2: GOAL (multi-select)
═══════════════════════════════════════════════════════════════ */

function GoalStep({ value, onChange, onNext, onBack, step, total }) {
  const { tFallback } = useLanguage();
  const selectedIds = Array.isArray(value) ? value : (value ? [value] : []);
  const toggle = (id) => {
    const has = selectedIds.includes(id);
    onChange(has ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };

  // Dedupe on the ENGLISH source text, not the translated label: two goals can
  // share a tailoring chip, and which of them "owns" it (and therefore what
  // colour it takes) must not depend on the reader's language.
  const tailors = useMemo(() => {
    const seen = new Set(); const out = [];
    selectedIds.forEach(id => (GOAL_TAILORS[id] || []).forEach((text, i) => {
      if (!seen.has(text)) { seen.add(text); out.push({ text, id, idx: i + 1 }); }
    }));
    return out;
  }, [selectedIds]);

  const primaryAccent = selectedIds.length ? (GOALS.find(g => g.id === selectedIds[0])?.accent || 'hsl(var(--primary))') : 'hsl(var(--primary))';

  const helper = selectedIds.length === 0
    ? tFallback('onboarding.goal.helper.none', 'Pick one or many — we tailor your plan to the combination.')
    : selectedIds.length === 1
    ? tFallback('onboarding.goal.helper.one', "Nice. Add another if you're after a few outcomes.")
    : selectedIds.length <= 3
    ? tFallback('onboarding.goal.helper.few', "Stacking {count} goals — we'll balance your plan.", { count: selectedIds.length })
    : tFallback('onboarding.goal.helper.many', 'Heads up: 4+ goals slows visible progress on each. Your call.');

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto space-y-3 pb-4 pe-2">
        <KineticHeading
          kicker={`${tFallback('onboarding.goal.kicker', 'Goal')} · ${String(step).padStart(2, '0')}`}
          text={tFallback('onboarding.goal.heading', 'What are you here for?')}
          accentWord="for?" />
        <p className="text-sm text-muted-foreground mt-1.5 mb-4 min-h-[40px] transition-all">{helper}</p>

        {/* Counter row */}
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-micro font-bold text-muted-foreground tracking-[0.16em] uppercase">
            {selectedIds.length === 0
              ? tFallback('onboarding.goal.selectPrompt', 'Select goals')
              : tFallback('onboarding.goal.selectedCount', '{count} selected', { count: selectedIds.length })}
          </span>
          {selectedIds.length > 0 && (
            <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              onClick={() => onChange([])}
              className="font-mono text-micro font-bold text-muted-foreground tracking-widest uppercase px-2 py-1 rounded hover:text-foreground active:text-foreground transition-colors border-none bg-transparent cursor-pointer">
              {tFallback('onboarding.goal.clear', 'Clear')}
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
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-start cursor-pointer transition-all"
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
                  <div className="font-heading font-bold text-body text-foreground leading-tight">
                    {tFallback(`onboarding.goal.${g.id}.title`, g.title)}
                  </div>
                  <div className="text-caption text-muted-foreground mt-0.5">
                    {tFallback(`onboarding.goal.${g.id}.sub`, g.sub)}
                  </div>
                </div>
                {/* checkbox */}
                <div className="w-6 h-6 rounded-[7px] flex items-center justify-center shrink-0 transition-all font-mono text-micro font-bold text-white"
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
              <div className="absolute -top-8 -end-8 w-28 h-28 rounded-full blur-[30px] pointer-events-none transition-all duration-500"
                style={{ background: primaryAccent, opacity: 0.12 }} />
              <div className="font-mono text-[9.5px] font-bold text-muted-foreground tracking-[0.18em] uppercase mb-2.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: primaryAccent, boxShadow: `0 0 8px ${primaryAccent}` }} />
                {tFallback('onboarding.goal.tailoring', 'Tailoring your plan')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tailors.slice(0, 6).map(({ text, id, idx }, i) => {
                  const accent = GOALS.find(g => g.id === id)?.accent || 'hsl(var(--primary))';
                  return (
                    <motion.span key={text} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.05, type: 'spring', stiffness: 400, damping: 18 }}
                      className="px-2.5 py-1 rounded-full font-mono text-[10.5px] font-semibold tracking-tight"
                      style={{ color: accent, background: accent.replace(')', ' / 0.1)'), border: `1px solid ${accent.replace(')', ' / 0.25)')}` }}>
                      {tFallback(`onboarding.tailor.${id}.${idx}`, text)}
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
          {selectedIds.length === 0
            ? tFallback('onboarding.goal.ctaEmpty', 'Pick at least one')
            : selectedIds.length === 1
            ? tFallback('onboarding.common.continue', 'Continue')
            : tFallback('onboarding.goal.ctaMulti', 'Continue with {count}', { count: selectedIds.length })}
          <Icon name="arrow-right" size={18} strokeWidth={2.5} />
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 2b: SHARPEN YOUR PLAN (goal-aware follow-ups)
═══════════════════════════════════════════════════════════════ */

const CARDIO_EVENTS = [
  { id: '5k', label: '5K' }, { id: '10k', label: '10K' },
  { id: 'half', label: 'Half' }, { id: 'marathon', label: 'Marathon' },
  { id: 'general', label: 'General' },
];
const FOCUS_LIFTS = ['Bench Press', 'Squat', 'Deadlift', 'Overhead Press', 'Pull-Up'];
const TIME_DISTANCES = [{ id: '1mi', label: '1 mi' }, { id: '5k', label: '5K' }, { id: '10k', label: '10K' }];

function Chip({ children, active, accent = 'hsl(var(--primary))', small, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full font-semibold transition-all cursor-pointer ${small ? 'px-3 py-1 text-caption' : 'px-3.5 py-1.5 text-label'}`}
      style={{
        border: `1.5px solid ${active ? accent : 'hsl(var(--border))'}`,
        background: active ? accent.replace(')', ' / 0.12)') : 'hsl(var(--card))',
        color: active ? accent : 'hsl(var(--foreground))',
      }}>
      {children}
    </button>
  );
}

function SectionLabel({ title, accent }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
      <span className="font-heading font-bold text-body">{title}</span>
    </div>
  );
}

function TimeInput({ value, onChange, placeholder, max = 99 }) {
  return (
    <input type="number" inputMode="numeric" min="0" max={max} placeholder={placeholder}
      value={value ?? ''}
      // `max` is an HTML attribute on an input that never submits a form, so
      // nothing enforced it: the seconds field accepted 99, and 22:99 was
      // stored as 1,419s and read back to the user as 23:39. Clamp in the
      // handler. Only out-of-range values are affected, so there's no
      // clamp-while-typing jump. (Audit 18 #21.)
      onChange={e => {
        const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
        onChange(digits === '' ? '' : String(Math.min(max, parseInt(digits, 10))));
      }}
      className="w-16 h-10 rounded-xl border border-border bg-card text-center text-body font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40" />
  );
}

function SharpenStep({ goals, value, onChange, onNext, onBack, step, total }) {
  const { tFallback } = useLanguage();
  const g = Array.isArray(goals) ? goals : [];
  const wantsCardio = g.some(x => CARDIO_GOAL_IDS.includes(x));
  const wantsStrength = g.some(x => x === 'strength' || x === 'muscle');
  const s = value || {};
  const set = (patch) => onChange({ ...s, ...patch });

  const focus = Array.isArray(s.strengthFocus) ? s.strengthFocus : [];
  const toggleFocus = (name) => set({ strengthFocus: focus.includes(name) ? focus.filter(n => n !== name) : [...focus, name] });

  const cur = s.cardioCurrent || {};
  const setCurrent = (patch) => {
    const nextCur = { ...cur, ...patch };
    nextCur.timeSec = (Number(nextCur.min) || 0) * 60 + (Number(nextCur.sec) || 0);
    set({ cardioCurrent: nextCur, cardioDefer: false });
  };

  const nothingToAsk = !wantsCardio && !wantsStrength;

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto space-y-5 pb-4 pe-2">
        <KineticHeading
          kicker={`${tFallback('onboarding.sharpen.kicker', 'Sharpen')} · ${String(step).padStart(2, '0')}`}
          text={tFallback('onboarding.sharpen.heading', "Let's sharpen your plan.")}
          accentWord="sharpen" />
        <p className="text-sm text-muted-foreground -mt-1">
          {tFallback('onboarding.sharpen.sub', 'A few quick details make your starter plan spot-on — all optional.')}
        </p>

        {wantsCardio && (
          <div className="space-y-3">
            <SectionLabel accent="hsl(45 93% 55%)" title={tFallback('onboarding.sharpen.cardioPrompt', 'What are you training for?')} />
            <div className="flex flex-wrap gap-2">
              {CARDIO_EVENTS.map(e => (
                <Chip key={e.id} active={s.cardioEvent === e.id} accent="hsl(45 93% 55%)" onClick={() => set({ cardioEvent: e.id })}>
                  {tFallback(`onboarding.sharpen.event.${e.id}`, e.label)}
                </Chip>
              ))}
            </div>

            <div className="rounded-2xl border border-border bg-card p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-label font-semibold">{tFallback('onboarding.sharpen.recentTime', 'Know a recent time?')}</span>
                <button type="button"
                  onClick={() => set({ cardioDefer: !s.cardioDefer, cardioCurrent: s.cardioDefer ? cur : null })}
                  className={`text-micro font-semibold px-2.5 py-1 rounded-lg transition-colors ${s.cardioDefer ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary active:bg-secondary'}`}>
                  {tFallback('onboarding.sharpen.setLater', "I'll set it later")}
                </button>
              </div>
              {!s.cardioDefer && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {TIME_DISTANCES.map(d => (
                      <Chip key={d.id} small active={cur.distance === d.id} accent="hsl(217 91% 60%)" onClick={() => setCurrent({ distance: d.id })}>
                        {tFallback(`onboarding.sharpen.distance.${d.id}`, d.label)}
                      </Chip>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <TimeInput placeholder={tFallback('onboarding.sharpen.minPlaceholder', 'min')} value={cur.min} onChange={v => setCurrent({ min: v })} />
                    <span className="text-muted-foreground font-bold">:</span>
                    <TimeInput placeholder={tFallback('onboarding.sharpen.secPlaceholder', 'sec')} value={cur.sec} onChange={v => setCurrent({ sec: v })} max={59} />
                    <span className="text-micro text-muted-foreground">
                      {(() => {
                        const d = TIME_DISTANCES.find(x => x.id === cur.distance);
                        return d
                          ? tFallback('onboarding.sharpen.forYour', 'for your {distance}', { distance: tFallback(`onboarding.sharpen.distance.${d.id}`, d.label) })
                          : tFallback('onboarding.sharpen.forYourRun', 'for your run');
                      })()}
                    </span>
                  </div>
                </>
              )}
              <p className="text-micro text-muted-foreground">
                {tFallback('onboarding.sharpen.noTimeHint', "Don't know it? No worries — log a run in the Cardio tab anytime and we'll dial it in.")}
              </p>
            </div>
          </div>
        )}

        {wantsStrength && (
          <div className="space-y-3">
            <SectionLabel accent="hsl(26 95% 56%)" title={tFallback('onboarding.sharpen.liftsPrompt', 'Which lifts matter most?')} />
            <div className="flex flex-wrap gap-2">
              {FOCUS_LIFTS.map(n => (
                <Chip key={n} active={focus.includes(n)} accent="hsl(26 95% 56%)" onClick={() => toggleFocus(n)}>{n}</Chip>
              ))}
            </div>
            {/* FOCUS_LIFTS are deliberately NOT translated: the picked names
                are persisted and matched by string downstream in
                buildStarterRegimen, so they have to stay stable until the
                exercise catalog itself is translated. */}
            <p className="text-micro text-muted-foreground">
              {tFallback('onboarding.sharpen.liftsHint', "We'll lead your plan with the lifts you pick.")}
            </p>
          </div>
        )}

        {nothingToAsk && (
          <div className="rounded-2xl border border-border bg-card p-5 text-center">
            <div className="text-2xl mb-1">✅</div>
            <p className="font-heading font-bold text-body">{tFallback('onboarding.sharpen.allSet', "You're all set")}</p>
            <p className="text-label text-muted-foreground mt-1">
              {tFallback('onboarding.sharpen.allSetSub', "We've got what we need — your plan's ready to build.")}
            </p>
          </div>
        )}
      </div>

      <div className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext}>
          {tFallback('onboarding.common.continue', 'Continue')} <Icon name="arrow-right" size={18} strokeWidth={2.5} />
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 3: EXPERIENCE
═══════════════════════════════════════════════════════════════ */

function ExperienceStep({ value, onChange, onNext, onBack, step, total }) {
  const { tFallback } = useLanguage();
  const current = LEVELS.find(l => l.id === value) || null;
  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4 pe-2">
        <KineticHeading
          kicker={`${tFallback('onboarding.experience.kicker', 'Experience')} · ${String(step).padStart(2, '0')}`}
          text={tFallback('onboarding.experience.heading', 'How long have you been training?')}
          accentWord="training?" />
        <p className="text-sm text-muted-foreground mt-2 mb-6">
          {tFallback('onboarding.experience.sub', 'Honest answers get you a better program.')}
        </p>

        {/* Visual rep meter — renders ONLY once a level is picked.
            It used to render unconditionally, so the top third of the step
            was a large empty card holding four grey bars and the words
            "Choose below": a chart of nothing, explaining nothing, pushing
            the actual options below the fold on a 375x812 viewport. Now the
            options own the screen at rest and the meter arrives as
            confirmation of the choice, which is the only moment it has
            anything to show. */}
        <AnimatePresence>
        {current && (
        <motion.div
          initial={{ opacity: 0, y: 8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
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
                {current && tFallback(`onboarding.level.${current.id}.label`, current.label)}
              </div>
              {current && (
                <div className="text-sm text-muted-foreground mt-1">
                  {tFallback(`onboarding.level.${current.id}.desc`, current.desc)}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
        )}
        </AnimatePresence>

        {/* Level list */}
        <div className="space-y-2">
          {LEVELS.map((l, i) => {
            const selected = value === l.id;
            return (
              <motion.button key={l.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.05, duration: 0.4 }}
                onClick={() => onChange(l.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border cursor-pointer transition-all text-start"
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
                  <div className="font-heading font-semibold text-sm text-foreground">
                    {tFallback(`onboarding.level.${l.id}.label`, l.label)}
                  </div>
                  <div className="text-caption text-muted-foreground mt-0.5">
                    {tFallback(`onboarding.level.${l.id}.sub`, l.sub)}
                  </div>
                </div>
                {selected && <Icon name="check" size={16} strokeWidth={3} color="hsl(var(--primary))" />}
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext} disabled={!value}>
          {!value
            ? tFallback('onboarding.experience.ctaEmpty', 'Pick your experience level')
            : <>{tFallback('onboarding.common.continue', 'Continue')} <Icon name="arrow-right" size={18} strokeWidth={2.5} /></>}
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
  // Removed the "No" option per screenshot feedback. Three buttons read
  // as a harsh verdict — Yes/Not yet/NO felt judgmental for a fitness
  // app's optional self-assessment. With just Yes + Not yet the user
  // never has to declare a permanent "no I cannot," which keeps the
  // tone aspirational and is also more accurate (everyone is "not yet"
  // until they're not). Two-column layout reads cleaner too.
  { id: 'yes',     label: 'Yes',     hue: 'hsl(142 71% 45%)' },
  { id: 'not_yet', label: 'Not yet', hue: 'hsl(38 92% 50%)'  },
];

function AssessmentStep({ value, onChange, onNext, onBack, onSkip, step, total }) {
  const { tFallback } = useLanguage();
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
      <div className="flex-1 overflow-y-auto pb-4 pe-2">
        <KineticHeading
          kicker={`${tFallback('onboarding.assessment.kicker', 'Assessment')} · ${String(step).padStart(2, '0')}`}
          text={tFallback('onboarding.assessment.heading', 'Quick lift check')}
          accentWord="lift"
        />
        <p className="text-sm text-muted-foreground mt-2 mb-6">
          {tFallback('onboarding.assessment.sub', 'Optional — but the more honest you are, the better the plan.')}
          <br />
          <span className="text-xs text-muted-foreground/70">
            {tFallback('onboarding.assessment.coachNote', 'Your AI Coach uses these to dial in starting volume.')}
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
                  {tFallback(`onboarding.assessment.q.${q.id}`, q.question)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ASSESSMENT_ANSWERS.map(a => {
                  const selected = answers[q.id] === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAnswer(q.id, a.id)}
                      // min-h-11: eight of these render in one viewport at
                      // 34px tall.
                      className="min-h-11 rounded-xl border text-xs font-bold uppercase tracking-wide transition-colors"
                      style={{
                        borderColor: selected ? a.hue : 'hsl(var(--border))',
                        background:  selected ? `${a.hue}1f` : 'hsl(var(--card))',
                        color:       selected ? a.hue : 'hsl(var(--foreground))',
                      }}
                    >
                      {tFallback(`onboarding.assessment.answer.${a.id}`, a.label)}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>

        <p className="text-micro text-center text-muted-foreground mt-4">
          {tFallback('onboarding.assessment.answered', 'Answered {count} of {total}', {
            count: answeredCount, total: ASSESSMENT_QUESTIONS.length,
          })}
        </p>
      </div>

      <div className="pt-4 shrink-0 flex flex-col gap-2">
        <PrimaryBtn onClick={onNext}>
          {/* Same reason as the schedule step: this is step 10 of 14. */}
          {tFallback('onboarding.common.continue', 'Continue')}
          <Icon name="arrow-right" size={18} strokeWidth={2.5} />
        </PrimaryBtn>
        {!allAnswered && (
          <button
            type="button"
            onClick={onSkip || onNext}
            // min-h-11 — this was a 28px caption-styled control on the one
            // step a user is most likely to want to skip.
            className="text-xs font-semibold text-muted-foreground hover:text-foreground active:text-foreground transition-colors min-h-11"
          >
            {tFallback('onboarding.assessment.skip', 'Skip — generate a generic plan')}
          </button>
        )}
      </div>
    </div>
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

  // ── Touch is handled by the Pointer Events above ──────────────────────────
  // Every consumer sets `touch-action: none` on the scrubber, so the browser
  // won't scroll the page on a touch-drag and Pointer Events fire reliably for
  // mouse + touch + pen (with setPointerCapture keeping the drag alive even if
  // the finger leaves the element).
  //
  // We previously ALSO attached native touch listeners here. But a single
  // finger fires BOTH a pointer event AND a touch event, so the two code paths
  // double-updated `drag.current` and `setPointerCapture` fought the touch
  // stream — that race is why the dial sometimes "didn't register" until the
  // 2nd or 3rd try (beta feedback). Pointer-only is the single source of truth.

  return { ref, onPointerDown, onPointerMove, onPointerUp, isDragging };
}

// Shared style for the ±1 / ±5 nudge buttons on weight / height / age steps
// 48×48 hits Apple HIG (44pt) + WCAG 2.5.8 (24×24 minimum, 44×44 recommended)
// with margin to spare — users on small phones were missing 40×40 targets.
const nudgeBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  // flexShrink:0 is load-bearing. These are declared 48px, but they sit in a
  // flex row and were being squeezed to 41px wide on a 375px screen — the
  // declared size is not the rendered size without this.
  width: 48, height: 48, flexShrink: 0, borderRadius: '50%',
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
            border: 'none', padding: '0 18px', minHeight: 44,
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
//
// No zero-padding. It used to take a `digits` prop and `padStart` to it, and
// the weight step passed `String(range[1]).length` — 3, because the lb range
// tops out at 400. So every weight below 100 rendered with a leading zero:
// a 75 kg user was shown "075 KG" on the step whose entire job is to display
// their weight back to them. Padding never bought anything either — the age
// step's `digits={2}` was a no-op for every reachable age. (Audit 18 #2.)
function NumberReel({ value }) {
  const str = String(value);
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
  const { tFallback } = useLanguage();
  const age = stats.age;
  const setAge = (v) => onChange({ ...stats, age: v });
  const gender = stats.gender || null;
  const setGender = (g) => onChange({ ...stats, gender: g });
  const bumpAge = (dir) => setAge(Math.min(AGE_MAX, Math.max(AGE_MIN, age + dir)));
  const { ref, onPointerDown, onPointerMove, onPointerUp, isDragging } = useDragValue({ value: age, onChange: setAge, min: AGE_MIN, max: AGE_MAX, axis: 'x', pxPerUnit: 18 });

  // Tap-to-type: tapping the big number opens a numeric keypad so users
  // on mobile don't have to drag-scrub or hammer ±1 to get to their age.
  //
  // CONTROLLED with a local string draft. Clamp ONLY on blur — typing
  // "1" used to instantly clamp to 13 (min), so the user saw "13"
  // appear before they could finish typing. Same defect as WeightStep
  // and HeightStep. (Audit 13 #3.)
  const [editingAge, setEditingAge] = useState(false);
  const [draftAge,   setDraftAge]   = useState('');
  const ageInputRef = useRef(null);
  // iOS keyboard scrolls focused input into view only when there's a
  // scrollable ancestor — the parent already has overflow-y-auto, but
  // we still call scrollIntoView explicitly on focus to handle the
  // post-keyboard layout settle.
  const scrollAgeIntoView = (el) => {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
  };
  const handleAgeTap = () => {
    setDraftAge(String(age));
    setEditingAge(true);
    setTimeout(() => {
      const el = ageInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
      scrollAgeIntoView(el);
      setTimeout(() => scrollAgeIntoView(ageInputRef.current), 250);
    }, 30);
  };
  const handleAgeInput = (e) => {
    setDraftAge((e.target.value || '').replace(/[^0-9]/g, '').slice(0, 3));
  };
  const handleAgeBlur = () => {
    const parsed = parseInt(draftAge, 10);
    if (Number.isFinite(parsed)) setAge(Math.min(AGE_MAX, Math.max(AGE_MIN, parsed)));
    setEditingAge(false);
    setDraftAge('');
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
    if (age < 18) return { id: 'teen',      tag: 'TEEN',        tone: "Building habits early. We'll start with form.",      accent: 'hsl(217 91% 60%)' };
    if (age < 25) return { id: 'peak',      tag: 'PEAK INTAKE', tone: 'Hormonally primed for muscle gain. Great window.',   accent: 'hsl(160 64% 45%)' };
    if (age < 35) return { id: 'prime',     tag: 'PRIME',       tone: 'Strength peaks here for most lifters. Push hard.',    accent: 'hsl(26 95% 56%)'  };
    if (age < 45) return { id: 'sustain',   tag: 'SUSTAIN',     tone: 'Smart programming wins. Volume per session.',         accent: 'hsl(38 92% 60%)'  };
    if (age < 55) return { id: 'intent',    tag: 'INTENT',      tone: "Recovery becomes the variable. We'll protect it.",    accent: 'hsl(280 60% 60%)' };
    return          { id: 'longevity', tag: 'LONGEVITY',   tone: 'Joint-first programming. Strength is never stunted.', accent: 'hsl(0 70% 55%)'   };
  }, [age]);

  const canNext = username.trim().length >= MIN_USERNAME_LENGTH && !usernameError;

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4 pe-2">
        <KineticHeading
          kicker={`${tFallback('onboarding.about.kicker', 'About You')} · ${String(step).padStart(2, '0')}`}
          text={tFallback('onboarding.about.heading', 'Tell us about yourself.')}
          accentWord="yourself." />
        <p className="text-sm text-muted-foreground mt-2 mb-5">
          {tFallback('onboarding.about.sub', 'We use this to calibrate your plan. Encrypted, never sold.')}
        </p>

        {/* Username */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-2xl border bg-card/80 p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="user" size={14} color="hsl(var(--muted-foreground))" />
            <span className="font-mono text-micro font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {tFallback('onboarding.about.usernamePrompt', 'What should we call you?')}
            </span>
          </div>
          <input
            type="text"
            value={username}
            onChange={e => onUsernameChangeSanitized(e.target.value)}
            // Pressing the iOS "Next" / "Done" key on the on-screen
            // keyboard now advances the step when allowed. Previously
            // Enter did nothing and the user had to tap the Continue
            // button at the bottom of the screen. (Audit 13 #30.)
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canNext) {
                e.preventDefault();
                e.currentTarget.blur();
                onNext();
              }
            }}
            placeholder={tFallback('onboarding.about.usernamePlaceholder', 'e.g. jordan_lifts')}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="next"
            className="w-full h-12 rounded-xl border border-border bg-secondary/50 px-4 font-mono text-base font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
          />
          {usernameError && <p className="text-xs text-destructive mt-1">{usernameError}</p>}
          {!usernameError && stripWarning && (
            <p className="text-xs text-muted-foreground mt-1">
              {tFallback('onboarding.about.usernameStripped', 'Letters, numbers and underscores only — capitals are auto-lowered.')}
            </p>
          )}
        </motion.div>

        {/* Age drag section */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          className="rounded-2xl border bg-card/80 p-5 relative overflow-hidden">
          <div className="font-mono text-micro font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-4">
            {tFallback('onboarding.about.agePrompt', 'How old are you?')}
          </div>

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
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                value={draftAge}
                onBlur={handleAgeBlur}
                onChange={handleAgeInput}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                aria-label={tFallback('onboarding.about.ageAria', 'Your age')}
                style={{ width: 180, fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 96, lineHeight: 0.9, letterSpacing: '-0.06em', textAlign: 'center', background: 'transparent', border: 'none', borderBottom: '3px solid hsl(var(--primary))', color: 'hsl(var(--foreground))', outline: 'none', padding: 0 }}
              />
            ) : (
              <button
                type="button"
                onClick={handleAgeTap}
                aria-label={tFallback('onboarding.about.ageTapAria', 'Tap to type your age')}
                style={{ background: 'none', border: 'none', cursor: 'text', padding: 0 }}
              >
                {/* paddingRight + letterSpacing tightened so two-digit ages
                    (e.g. "48", "60") don't visually clip on the right edge.
                    Negative letter-spacing was eating the trailing digit
                    inside the card's overflow-hidden bounds.
                    (Onboarding screenshot feedback, 2026-06.) */}
                <div style={{
                  fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800,
                  fontSize: 120, lineHeight: 0.9, letterSpacing: '-0.03em',
                  paddingRight: '0.1em',
                  color: 'hsl(var(--foreground))',
                  transform: isDragging ? 'scale(0.97)' : 'scale(1)',
                  transition: 'transform 0.15s ease-out',
                }}>
                  <NumberReel value={age} />
                </div>
              </button>
            )}
            {/* The hint underneath the number is now ALSO tappable so
                users who fixate on the "TAP TO TYPE" copy and tap it
                actually open the keypad. Previously only the number itself
                was the hit target, which was unintuitive given the label.
                (Onboarding screenshot feedback, 2026-06.) */}
            {!editingAge && (
              <button
                type="button"
                onClick={handleAgeTap}
                aria-label={tFallback('onboarding.about.ageTapAria', 'Tap to type your age')}
                className="font-mono text-micro font-semibold tracking-[0.3em] uppercase text-muted-foreground mt-2 hover:text-foreground active:text-foreground transition-colors inline-flex items-center justify-center"
                // This LOOKS like a caption but is a real control — tapping it
                // opens the keypad. It was 28px tall, so the affordance the
                // copy advertises was the hardest thing on the step to hit.
                style={{ background: 'none', border: 'none', cursor: 'text', padding: '0 8px', minHeight: 44 }}
              >
                {tFallback('onboarding.about.ageHint', 'YEARS OLD · TAP TO TYPE OR DRAG')}
              </button>
            )}

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
              <span className="font-mono text-micro tracking-[0.14em] uppercase font-bold">
                {tFallback(`onboarding.stage.${stage.id}.tag`, stage.tag)}
              </span>
              <span style={{ width: 1, height: 12, background: stage.accent, opacity: 0.4 }} />
              <span className="text-xs font-normal" style={{ color: 'hsl(var(--foreground) / 0.8)' }}>
                {tFallback(`onboarding.stage.${stage.id}.tone`, stage.tone)}
              </span>
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
              {Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) => i + AGE_MIN).map(v => {
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
            {/* The middle "DRAG OR USE BUTTONS" label is gone — the step was
                carrying two separate instruction lines for one control, and
                the hint under the number now covers both gestures. What's
                left is the ruler's actual range, which is information the
                other line was crowding out.
                Sizes are text-micro (11px), per the app-wide type floor. */}
            <span className="font-mono text-micro font-semibold text-muted-foreground tracking-wide">{AGE_MIN}</span>
            <span className="font-mono text-micro font-semibold text-muted-foreground tracking-wide">{AGE_MAX}</span>
          </div>
          {/* ± Age nudge buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12 }}>
            <button onClick={() => bumpAge(-5)} style={nudgeBtnStyle}>−5</button>
            <button onClick={() => bumpAge(-1)} style={nudgeBtnStyle}>−1</button>
            {/* The value used to be repeated here, 13px, ~300px below the
                120px reel already showing it. One number, one place — the
                spacer keeps the ± buttons from closing up around the gap. */}
            <span aria-hidden="true" style={{ minWidth: 48 }} />
            <button onClick={() => bumpAge(+1)} style={nudgeBtnStyle}>+1</button>
            <button onClick={() => bumpAge(+5)} style={nudgeBtnStyle}>+5</button>
          </div>
        </motion.div>

        {/* Sex — calibrates strength targets, training volume, and calories.
            The whole app already reads this; it just never asked before. */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}
          className="rounded-2xl border bg-card/80 p-4 mt-4">
          <div className="font-mono text-micro font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
            {tFallback('onboarding.about.sexLabel', 'Sex')}{' '}
            <span className="normal-case font-normal opacity-70">
              {tFallback('onboarding.about.sexNote', '· tunes your strength + calorie targets')}
            </span>
          </div>
          {/* Three-option layout so users who don't identify as binary
              male/female have an "Other" path that still records a value
              (vs. silently leaving it null, which the strength/calorie
              calibrators default to 'male'). Stored as 'other' — consumers
              treat it the same as the unset default for now, but the value
              survives so we can surface inclusive copy downstream.
              (Onboarding screenshot feedback, 2026-06.) */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'male', label: 'Male' },
              { id: 'female', label: 'Female' },
              { id: 'other', label: 'Other' },
            ].map(o => {
              const active = gender === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setGender(o.id)}
                  className="h-11 rounded-xl border text-sm font-semibold transition-colors"
                  style={{
                    borderColor: active ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                    background: active ? 'hsl(var(--primary) / 0.12)' : 'transparent',
                    color: active ? 'hsl(var(--primary))' : 'hsl(var(--foreground))',
                  }}
                >
                  {tFallback(`onboarding.about.sex.${o.id}`, o.label)}
                </button>
              );
            })}
          </div>
        </motion.div>
      </div>
      <div className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext} disabled={!canNext}>
          {/* The blocker is a username field several hundred pixels up the
              page, so a bare disabled "Continue" gave the user nothing to
              act on — they could see it was dead and not why. */}
          {!canNext
            ? (usernameError
                ? tFallback('onboarding.about.ctaBadUsername', 'Pick a different username')
                : tFallback('onboarding.about.ctaNoUsername', 'Choose a username to continue'))
            : <>{tFallback('onboarding.common.continue', 'Continue')} <Icon name="arrow-right" size={18} strokeWidth={2.5} /></>}
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP: HEIGHT — silhouette + vertical ruler (ft·in default)
═══════════════════════════════════════════════════════════════ */
function HeightStep({ stats, onChange, onNext, onBack, step, total }) {
  const { tFallback } = useLanguage();
  const unit = stats.heightUnit ?? 'in';
  const inFromCm = (cm) => Math.round(cm / 2.54);
  const cmFromIn = (inches) => Math.round(inches * 2.54);

  const setUnit = (u) => {
    if (u === 'cm') onChange({ ...stats, heightUnit: 'cm', heightCm: cmFromIn(stats.heightIn) });
    else onChange({ ...stats, heightUnit: 'in', heightIn: inFromCm(stats.heightCm) });
  };

  const value = unit === 'cm' ? stats.heightCm : stats.heightIn;
  // Expanded from [48,84]→[36,96] and [120,220]→[90,245] cm: the narrow range
  // cut off shorter people (<4ft, e.g. accessibility accounts) and taller
  // athletes (>7ft), forcing them to bail. (Onboarding screenshot feedback,
  // 2026-06.) Now sourced from PROFILE_RANGES, which is the union of each
  // unit's range and what the other converts into — so toggling ft·in ↔ cm at
  // either extreme never silently clamps the value you just set.
  const range = unit === 'cm'
    ? [PROFILE_RANGES.heightCm.min, PROFILE_RANGES.heightCm.max]
    : [PROFILE_RANGES.heightIn.min, PROFILE_RANGES.heightIn.max];
  const PX = unit === 'cm' ? 6 : 12;
  const setValue = (v) => unit === 'cm'
    ? onChange({ ...stats, heightCm: v, heightIn: inFromCm(v) })
    : onChange({ ...stats, heightIn: v, heightCm: cmFromIn(v) });

  const bump = (dir) => setValue(Math.min(range[1], Math.max(range[0], value + dir)));

  const { ref, onPointerDown, onPointerMove, onPointerUp, isDragging } = useDragValue({ value, onChange: setValue, min: range[0], max: range[1], axis: 'y', pxPerUnit: PX });

  // Tap-to-type for height.
  //
  // CONTROLLED with a local string draft + clamp-on-blur (same fix as
  // WeightStep / AgeStep). Previously the input clamped on every
  // keystroke, so typing "1" instantly jumped to 48 (min for inches)
  // and the user couldn't enter any number that needs to start below
  // the minimum.
  //
  // In ft·in mode, the input now accepts EITHER total inches ("70")
  // OR feet+inches ("5'10" or "5 10" or "5.10"). The previous version
  // silently accepted only total-inches with no copy explaining it,
  // so users typed "6" expecting "6 feet" and the value clamped to
  // 6 inches (4'0" after re-clamp). (Audit 13 #3 + #4.)
  const [editingHeight, setEditingHeight] = useState(false);
  const [draftHeight,   setDraftHeight]   = useState('');
  const heightInputRef = useRef(null);

  // Parsing lives in `@/lib/data/onboardingProfile` (`parseHeightInput`) with
  // its own tests — the shapes it has to accept are exactly the sort of thing
  // that looks obviously right and is off by a factor of ten. (Audit 18 #9.)

  // iOS keyboard scrolls focused input into view only when there's a
  // scrollable ancestor — see WeightStep / AgeStep for the bug story.
  const scrollHeightIntoView = (el) => {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
  };
  const handleHeightTap = () => {
    // Pre-fill the draft with the current value in a friendly shape
    setDraftHeight(unit === 'cm' ? String(value) : `${Math.floor(value / 12)}'${value % 12}`);
    setEditingHeight(true);
    setTimeout(() => {
      const el = heightInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
      scrollHeightIntoView(el);
      setTimeout(() => scrollHeightIntoView(heightInputRef.current), 250);
    }, 30);
  };
  const handleHeightInput = (e) => {
    // Allow digits + the ft·in separators only.
    const allowed = unit === 'cm' ? /[^0-9]/g : /[^0-9'’ ."”]/g;
    setDraftHeight((e.target.value || '').replace(allowed, '').slice(0, 8));
  };
  // Say something when the input is rejected. `parseHeightInput` now returns
  // null for things it can't read as a height — chiefly a cm value typed while
  // the toggle still says ft·in — instead of the old behaviour of clamping it
  // to 8'0". Reverting in silence is better than being wrong, but it still
  // reads as the field ignoring you. (Audit 18 #9.)
  const [heightHint, setHeightHint] = useState(false);
  const handleHeightBlur = () => {
    const typed = draftHeight.trim();
    const parsed = parseHeightInput(draftHeight, unit);
    if (Number.isFinite(parsed)) {
      setValue(Math.min(range[1], Math.max(range[0], parsed)));
      setHeightHint(false);
    } else if (typed) {
      setHeightHint(true);
      setTimeout(() => setHeightHint(false), 4000);
    }
    setEditingHeight(false);
    setDraftHeight('');
  };

  const [trackH, setTrackH] = useState(240);
  useEffect(() => {
    const update = () => { if (ref.current) setTrackH(ref.current.offsetHeight); };
    update();
    window.addEventListener('resize', update); return () => window.removeEventListener('resize', update);
  }, [ref]);
  const offsetY = -value * PX + trackH / 2;

  const displaySecondary = unit === 'cm' ? `${Math.floor(inFromCm(value) / 12)}'${inFromCm(value) % 12}"` : `${cmFromIn(value)} cm`;
  // Pin minPct against a stable 4ft-7ft window so the silhouette scales
  // by ACTUAL height, not by position within the (now-wider) input range.
  // Previously the figure was sized off `value vs [range[0],range[1]]` so
  // a 6-foot user appeared the same size as a 5-foot user (because both
  // sat near the middle of the range). The screenshot feedback flagged
  // that the silhouette didn't visibly change with the selected value.
  const valueIn = unit === 'cm' ? inFromCm(value) : value;
  const silhouettePct = Math.max(0, Math.min(1, (valueIn - 48) / 36)); // 4ft → 7ft
  const silhouetteH = 55 + silhouettePct * 45; // 55%–100% range, very visible

  const ticks = useMemo(() => {
    const arr = []; for (let v = range[0]; v <= range[1]; v++) arr.push(v); return arr;
  }, [range[0], range[1]]);

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      {/* overflow-y-auto so iOS Safari can scroll the focused input
          into view when the keyboard appears — same fix as WeightStep
          and AgeStep. Without this the user's number input was hidden
          behind the keyboard. */}
      <div className="flex-1 overflow-y-auto pb-2">
        <div className="flex justify-between items-start mb-3">
          <KineticHeading
            kicker={`${tFallback('onboarding.height.kicker', 'Height')} · ${String(step).padStart(2, '0')}`}
            text={tFallback('onboarding.height.heading', 'How tall are you?')}
            accentWord="tall" />
        </div>
        <div className="mb-4">
          <PillUnitToggle
            options={[
              { id: 'in', label: tFallback('onboarding.height.unitImperial', 'ft·in') },
              { id: 'cm', label: tFallback('onboarding.height.unitMetric', 'cm') },
            ]}
            value={unit} onChange={setUnit} />
        </div>

        <div style={{ display: 'flex', gap: 12, height: 320 }}>
          {/* Silhouette panel */}
          <div style={{
            flex: 1, position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            background: 'linear-gradient(180deg, transparent, hsl(var(--card) / 0.6))',
            borderRadius: 18, overflow: 'hidden', border: '1px solid hsl(var(--border))',
          }}>
            {/* Reference lines — labels are unit-aware so cm-mode users
                aren't asked to mentally convert 6'0" → 183 cm.
                (Onboarding screenshot feedback, 2026-06.) */}
            {[
              { cm: 183, in: 72, cmLabel: '183 cm', inLabel: "6'0\"" },
              { cm: 168, in: 66, cmLabel: '168 cm', inLabel: "5'6\"" },
              { cm: 152, in: 60, cmLabel: '152 cm', inLabel: "5'0\"" },
            ].map(m => {
              const rv = unit === 'cm' ? m.cm : m.in;
              const label = unit === 'cm' ? m.cmLabel : m.inLabel;
              const pct = (rv - range[0]) / (range[1] - range[0]);
              return (
                <div key={label} style={{ position: 'absolute', left: 8, right: 8, bottom: `${pct * 88}%`, height: 1, background: 'hsl(var(--muted-foreground) / 0.18)' }}>
                  <span style={{ position: 'absolute', left: 4, top: -9, fontFamily: 'ui-monospace,monospace', fontSize: 9, fontWeight: 600, color: 'hsl(var(--muted-foreground) / 0.6)' }}>{label}</span>
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
                  // type="text" so the ft·in separator chars (' or " or .)
                  // are typeable on mobile. type="number" rejects them.
                  type="text"
                  // Numeric keypad for cm mode; default for ft·in mode
                  // (need the apostrophe/quote/dot keys).
                  inputMode={unit === 'cm' ? 'numeric' : 'text'}
                  pattern={unit === 'cm' ? '[0-9]*' : undefined}
                  enterKeyHint="done"
                  value={draftHeight}
                  placeholder={unit === 'cm' ? '170' : "5'10"}
                  onBlur={handleHeightBlur}
                  onChange={handleHeightInput}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                  aria-label={unit === 'cm'
                    ? tFallback('onboarding.height.ariaMetric', 'Your height in centimeters')
                    : tFallback('onboarding.height.ariaImperial', 'Your height in feet and inches')}
                  style={{ width: '100%', fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 32, lineHeight: 1, textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '2px solid hsl(var(--primary))', color: 'hsl(var(--foreground))', outline: 'none', padding: 0 }}
                />
              ) : (
                <button
                  type="button"
                  onClick={handleHeightTap}
                  aria-label={tFallback('onboarding.height.tapAria', 'Tap to type your height')}
                  // minHeight 44 — the number IS the tap-to-type target, and
                  // the hint under it says so, but it measured 38px.
                  style={{ background: 'none', border: 'none', cursor: 'text', padding: 0, textAlign: 'left', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
                >
                  <div style={{ fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 38, lineHeight: 1, letterSpacing: '-0.04em', color: 'hsl(var(--foreground))', transform: isDragging ? 'scale(0.97)' : 'scale(1)', transition: 'transform 0.15s' }}>
                    {unit === 'cm' ? value : `${Math.floor(value/12)}'${value%12}"`}
                  </div>
                </button>
              )}
              <div className="font-mono text-micro font-semibold tracking-widest uppercase text-muted-foreground mt-1">
                {unit === 'cm'
                  ? tFallback('onboarding.height.tapHintMetric', 'CM · TAP TO TYPE')
                  : tFallback('onboarding.height.tapHintImperial', 'FT · IN · TAP TO TYPE')}
              </div>
              <div className="font-mono text-micro text-muted-foreground/70 mt-1">≈ {displaySecondary}</div>
              {heightHint && (
                <p className="text-micro text-primary mt-1 leading-snug">
                  {unit === 'cm'
                    ? tFallback('onboarding.height.hintMetric', "Enter centimetres — e.g. 178. Switch to ft·in above if that's what you meant.")
                    : tFallback('onboarding.height.hintImperial', "Enter feet and inches — e.g. 5'10 or 511. Switch to cm above if that's what you meant.")}
                </p>
              )}
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
        <PrimaryBtn onClick={onNext}>
          {tFallback('onboarding.common.continue', 'Continue')} <Icon name="arrow-right" size={18} strokeWidth={2.5} />
        </PrimaryBtn>
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
  const { tFallback } = useLanguage();
  // Scroll-into-view ref for the tap-to-type input. iOS Safari with
  // an `overflow-hidden` ancestor cannot auto-scroll the focused
  // input into view when the virtual keyboard appears, so the user
  // is typing blind behind the keyboard. We give the modal a scroll
  // container below (overflow-y-auto) AND explicitly scroll the
  // input into the middle of the visible area on focus.
  const scrollIntoViewSafe = (el) => {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
  };
  const unit = stats.weightUnit ?? 'lb';
  const kgFromLb = (lb) => Math.round(lb / 2.20462);
  const lbFromKg = (kg) => Math.round(kg * 2.20462);

  const setUnit = (u) => {
    if (u === 'kg') onChange({ ...stats, weightUnit: 'kg', weightKg: kgFromLb(stats.weightLb) });
    else onChange({ ...stats, weightUnit: 'lb', weightLb: lbFromKg(stats.weightKg) });
  };

  const value = unit === 'kg' ? stats.weightKg : stats.weightLb;
  const range = unit === 'kg'
    ? [PROFILE_RANGES.weightKg.min, PROFILE_RANGES.weightKg.max]
    : [PROFILE_RANGES.weightLb.min, PROFILE_RANGES.weightLb.max];
  const PX = unit === 'kg' ? 8 : 6; // increased from 4 → 6 for lb: easier to drag
  // Mark userTouchedWeight=true so the post-onboarding body_metrics
  // insert can distinguish "user kept default 165 lb" from "user
  // actually entered their weight." (Audit 13 #2.) The flag is sticky
  // — once set, stays set across the rest of the flow.
  const setValue = (v) => unit === 'kg'
    ? onChange({ ...stats, weightKg: v, weightLb: lbFromKg(v), userTouchedWeight: true })
    : onChange({ ...stats, weightLb: v, weightKg: kgFromLb(v), userTouchedWeight: true });

  const bump = (dir) => setValue(Math.min(range[1], Math.max(range[0], value + dir)));

  // Tap-to-type: tapping the big number shows a native input.
  //
  // CONTROLLED with a local STRING. Previously the input was
  // uncontrolled (defaultValue) and clamped every keystroke. A user
  // wanting to type "165" would type "1" → clamped to 80 (min for lb)
  // → screen showed "80" instead of "1", and there was no way to
  // type any number that needs to start below the minimum. The
  // user's dad couldn't enter his weight at all — confirmed against
  // the audit-finding-13 #3 description. (Audit 13 #3.)
  //
  // Now: while editing, the string is allowed to be anything
  // (including empty, mid-typed, etc.). Numeric parse + clamp only
  // happens on BLUR / Enter, when the user signals "done." If the
  // final input is empty or unparseable, we revert to the prior
  // committed value rather than clamping to min.
  const [editingWeight, setEditingWeight] = useState(false);
  const [draftWeight,   setDraftWeight]   = useState('');
  const weightInputRef = useRef(null);
  const handleWeightTap = () => {
    setDraftWeight(String(value));
    setEditingWeight(true);
    setTimeout(() => {
      const el = weightInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
      // After the iOS keyboard begins animating up, scroll the input
      // into the middle of the visible viewport. Without this, on
      // small phones the input stays at its layout position which is
      // hidden behind the keyboard. The 250ms second-pass catches the
      // post-keyboard layout settle on iOS.
      scrollIntoViewSafe(el);
      setTimeout(() => scrollIntoViewSafe(weightInputRef.current), 250);
    }, 30);
  };
  const handleWeightInput = (e) => {
    // Allow only digits in the draft string; tolerate empty.
    const next = (e.target.value || '').replace(/[^0-9]/g, '').slice(0, 4);
    setDraftWeight(next);
  };
  const handleWeightBlur = () => {
    const parsed = parseInt(draftWeight, 10);
    if (Number.isFinite(parsed)) {
      setValue(Math.min(range[1], Math.max(range[0], parsed)));
    }
    // If parsed is NaN (empty draft / non-numeric), keep prior value.
    setEditingWeight(false);
    setDraftWeight('');
  };

  // The circular gauge (the "dial" users are naturally drawn to) IS the input
  // now — drag vertically on it to set weight (up = heavier). The old
  // horizontal scrubber was missed by most users, so it's gone.
  const { ref, onPointerDown, onPointerMove, onPointerUp, isDragging } = useDragValue({ value, onChange: setValue, min: range[0], max: range[1], axis: 'y', pxPerUnit: PX });

  // Tap vs drag on the gauge: a near-stationary press opens tap-to-type; a real
  // drag sets the value. Track max vertical travel so a drag never opens typing.
  const gaugeStartY = useRef(0);
  const gaugeMoved = useRef(0);
  const onGaugeDown = (e) => { if (editingWeight) return; gaugeStartY.current = e.clientY; gaugeMoved.current = 0; onPointerDown(e); };
  const onGaugeMove = (e) => { gaugeMoved.current = Math.max(gaugeMoved.current, Math.abs(e.clientY - gaugeStartY.current)); onPointerMove(e); };
  const onGaugeUp = (e) => { onPointerUp(e); if (!editingWeight && gaugeMoved.current < 6) handleWeightTap(); };
  // pointercancel means the SYSTEM took the gesture away (iOS edge-swipe,
  // scroll hand-off) — it is not a tap and must not be treated as one. This
  // was bound to onGaugeUp, so an interrupted touch that hadn't travelled 6px
  // popped the numeric keyboard the user never asked for. (Audit 18 #10.)
  const onGaugeCancel = (e) => { onPointerUp(e); };

  const pct = (value - range[0]) / (range[1] - range[0]);
  const circumference = 2 * Math.PI * 82;
  const dash = pct * circumference;
  const valueKg = unit === 'kg' ? value : kgFromLb(value);

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      {/* overflow-y-auto (not overflow-hidden) so iOS Safari has a
          scrollable ancestor to bring the focused number-input into
          view when the keyboard appears. Previously the user could
          tap the number, the keyboard slid up, the input was hidden
          behind it, and they typed blind. That was the dad-can't-
          enter-his-weight bug + the user-reported "can't get past
          weight" complaint. */}
      <div className="flex-1 overflow-y-auto pb-2">
        <div className="flex justify-between items-start mb-3">
          <KineticHeading
            kicker={`${tFallback('onboarding.weight.kicker', 'Weight')} · ${String(step).padStart(2, '0')}`}
            text={tFallback('onboarding.weight.heading', 'How much do you weigh?')}
            accentWord="weigh?" />
        </div>
        <div className="mb-4">
          <PillUnitToggle options={[{id:'lb',label:'lb'},{id:'kg',label:'kg'}]} value={unit} onChange={setUnit} />
        </div>

        {/* Circular gauge — draggable dial (vertical drag sets weight, tap to type) */}
        <div ref={ref} onPointerDown={onGaugeDown} onPointerMove={onGaugeMove} onPointerUp={onGaugeUp} onPointerCancel={onGaugeCancel}
          className="flex flex-col items-center select-none"
          style={{ position: 'relative', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}>
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
                // type="text" with inputMode="numeric" is the iOS-friendly
                // numeric-keyboard pattern; type="number" has historic
                // quirks (scroll-wheel changes value, leading zeros
                // stripped weirdly, harder to clear on some browsers).
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                value={draftWeight}
                onBlur={handleWeightBlur}
                onChange={handleWeightInput}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                aria-label={unit === 'kg'
                  ? tFallback('onboarding.weight.ariaKg', 'Weight in kilograms')
                  : tFallback('onboarding.weight.ariaLb', 'Weight in pounds')}
                style={{ width: 130, fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 48, lineHeight: 1, textAlign: 'center', background: 'transparent', border: 'none', borderBottom: '2px solid hsl(var(--primary))', color: 'hsl(var(--foreground))', outline: 'none' }}
              />
            ) : (
              // Not a <button>: the gauge captures pointer events, so its own
              // tap-vs-drag handler opens type mode. Tapping here bubbles up.
              <div style={{ fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 64, lineHeight: 0.9, letterSpacing: '-0.05em', color: 'hsl(var(--foreground))', transform: isDragging ? 'scale(0.96)' : 'scale(1)', transition: 'transform 0.15s' }}>
                <NumberReel value={value} />
              </div>
            )}
            <div className="font-mono text-micro font-bold tracking-[0.3em] uppercase text-primary mt-1">{unit === 'kg' ? 'KG' : 'LBS'}</div>
            <div className="font-mono text-micro text-muted-foreground mt-1">≈ {unit === 'kg' ? `${lbFromKg(value)} lb` : `${kgFromLb(value)} kg`}</div>
          </div>
        </div>

        {/* Barbell */}
        <BarbellVisualizer kg={valueKg} />

        {/* Dial hint — the gauge above is the input: drag it up/down to set,
            tap the number to type. Replaces the old horizontal scrubber. */}
        <div className="flex items-center justify-center gap-1.5 mt-3 mb-1" aria-hidden="true">
          <motion.span
            animate={{ y: [-2, 1, -2] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            className="text-primary/70 font-bold text-sm leading-none"
          >⌃</motion.span>
          <span className="font-mono text-micro font-semibold tracking-[0.18em] uppercase text-muted-foreground/80">
            {tFallback('onboarding.weight.dialHint', 'Drag dial to set · tap to type')}
          </span>
          <motion.span
            animate={{ y: [2, -1, 2] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            className="text-primary/70 font-bold text-sm leading-none"
          >⌄</motion.span>
        </div>

        {/* ± Fine-tune buttons — always reachable even if drag doesn't work */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 10 }}>
          <button onClick={() => bump(-5)} style={nudgeBtnStyle}>−5</button>
          <button onClick={() => bump(-1)} style={nudgeBtnStyle}>−1</button>
          {/* The "tap number to type" label that used to sit here is gone.
              The dial hint two lines up already reads "Drag dial to set · tap
              to type", so the step was carrying two instruction lines for one
              control — the same duplication removed from the age step. The
              spacer keeps the +/- buttons from closing up around the gap. */}
          <span aria-hidden="true" style={{ minWidth: 56 }} />
          <button onClick={() => bump(+1)} style={nudgeBtnStyle}>+1</button>
          <button onClick={() => bump(+5)} style={nudgeBtnStyle}>+5</button>
        </div>
      </div>
      <div className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext}>
          {tFallback('onboarding.common.continue', 'Continue')} <Icon name="arrow-right" size={18} strokeWidth={2.5} />
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 5: SCHEDULE
═══════════════════════════════════════════════════════════════ */

function DaysStep({ days, preferredTime, onDaysChange, onTimeChange, onNext, onBack, step, total }) {
  const { tFallback } = useLanguage();
  const fmtDate = useDateFormatter();
  const toggle = (i) => {
    const next = days.includes(i) ? days.filter(d => d !== i) : [...days, i];
    onDaysChange(next);
    if (navigator.vibrate) navigator.vibrate(4);
  };
  const count = days.length;
  const intensity = count === 0 ? 'none' : count <= 2 ? 'light' : count <= 4 ? 'balanced' : count <= 5 ? 'serious' : 'hardcore';
  const intensityLabel = tFallback(
    `onboarding.schedule.intensity.${intensity}`,
    { none: '—', light: 'Light cadence', balanced: 'Balanced', serious: 'Serious', hardcore: 'Hardcore' }[intensity],
  );

  // preferredTime is a string ARRAY of TIME IDS so users who train at more
  // than one slot (morning lifting + evening cardio) can pick all that apply.
  // Two legacy draft shapes are tolerated: a bare string from before the array
  // change, and English display labels ("Late night") from before ids. Both
  // get mapped onto ids so a draft saved mid-flow yesterday still shows the
  // right chips selected today.
  const toId = (v) => (TIMES.find(t => t.id === v || t.label === v)?.id ?? null);
  const selectedTimes = (Array.isArray(preferredTime)
    ? preferredTime
    : (typeof preferredTime === 'string' && preferredTime ? [preferredTime] : [])
  ).map(toId).filter(Boolean);
  const toggleTime = (id) => {
    const next = selectedTimes.includes(id)
      ? selectedTimes.filter(x => x !== id)
      : [...selectedTimes, id];
    onTimeChange(next);
    if (navigator.vibrate) navigator.vibrate(4);
  };

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4 pe-2 space-y-5">
        <KineticHeading
          kicker={`${tFallback('onboarding.schedule.kicker', 'Schedule')} · ${String(step).padStart(2, '0')}`}
          text={tFallback('onboarding.schedule.heading', 'Which days can you train?')}
          accentWord="train?" />
        <p className="text-sm text-muted-foreground mt-2">
          {tFallback('onboarding.schedule.sub', "Plan around real life — we'll keep recovery in check.")}
        </p>

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
            <span className="font-heading font-semibold text-xl text-muted-foreground">
              {tFallback('onboarding.schedule.daysPerWeek', 'days · week')}
            </span>
          </div>
          <div className="relative font-mono text-micro font-bold tracking-[0.18em] uppercase text-primary mt-1">{intensityLabel}</div>
        </motion.div>

        {/* Day grid */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          className="grid grid-cols-7 gap-0.5">
          {WEEKDAY_SEED.map((seed, i) => {
            const selected = days.includes(i);
            const label = fmtDate(seed, { weekday: 'short', timeZone: 'UTC' });
            return (
              <button key={i} onClick={() => toggle(i)}
                // min-h-11 + the tighter grid gap above lifts these from
                // 39x50 to >=44 wide. Seven adjacent targets where a mis-tap
                // silently selects a DIFFERENT day is the worst hit-target
                // risk in onboarding — a miss here is wrong, not just missed.
                className="flex flex-col items-center justify-center gap-1 min-h-11 py-2.5 rounded-xl border cursor-pointer transition-all font-medium"
                style={{
                  borderColor: selected ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                  background: selected ? 'hsl(var(--primary))' : 'hsl(var(--card))',
                  color: selected ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                }}>
                <span className="text-micro">{label}</span>
                <span className="w-1.5 h-1.5 rounded-full"
                  style={{ background: selected ? 'currentColor' : 'hsl(var(--border))' }} />
              </button>
            );
          })}
        </motion.div>

        {/* Preferred time — multi-select. Many users train at more than
            one slot (morning lifts + evening cardio, weekday lunch +
            weekend morning, etc.) and the previous single-select forced
            them to lie. */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-mono text-micro font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              {tFallback('onboarding.schedule.preferredTime', 'Preferred time')}
            </div>
            <div className="font-mono text-micro font-medium tracking-wider uppercase text-muted-foreground/70">
              {tFallback('onboarding.schedule.pickAll', 'Pick all that apply')}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {TIMES.map(t => {
              const active = selectedTimes.includes(t.id);
              return (
                <button key={t.id} onClick={() => toggleTime(t.id)}
                  className="py-3 rounded-xl border text-sm font-medium cursor-pointer transition-all"
                  style={{
                    borderColor: active ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                    background: active ? 'hsl(var(--primary) / 0.07)' : 'hsl(var(--card))',
                    color: active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                  }}>
                  {tFallback(`onboarding.schedule.time.${t.id}`, t.label)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="pt-4 shrink-0">
        {/* Was "Build my plan" — on step 09 of 14, with injuries, home gym
            and the reveal still to come. A terminal-sounding CTA that isn't
            terminal makes the three steps after it feel like a bait and
            switch. "Enter Flexyn" on the reveal step is the real finish. */}
        <PrimaryBtn onClick={onNext} disabled={count === 0}>
          {count === 0
            ? tFallback('onboarding.schedule.ctaEmpty', 'Pick at least one day')
            : <>{tFallback('onboarding.common.continue', 'Continue')} <Icon name="arrow-right" size={18} strokeWidth={2.5} /></>}
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP V2-A: BODY BASELINE (optional)
   Collects circumference measurements + body-fat % so the
   Progress tab has a meaningful starting point. All fields are
   optional — user can skip the whole step.
═══════════════════════════════════════════════════════════════ */

// `key` is the persisted field name and `i18nKey` the translation suffix — they
// differ because the persisted names carry their unit (waistCm) and the labels
// must not (the unit is rendered separately).
const MEASURE_FIELDS = [
  { key: 'waistCm',   label: 'Waist',   i18nKey: 'waist',   icon: '📏', min: 40,  max: 180 },
  // Chest icon was 💪 (flexed bicep) which screenshot feedback flagged as
  // confusing — users read it as "arm/bicep" instead of "chest". Switched
  // to 👕 (t-shirt) which sits clearly over the chest area.
  { key: 'chestCm',   label: 'Chest',   i18nKey: 'chest',   icon: '👕', min: 50,  max: 200 },
  { key: 'hipCm',     label: 'Hips',    i18nKey: 'hips',    icon: '🍑', min: 50,  max: 200 },
  { key: 'bodyFatPct',label: 'Body fat',i18nKey: 'bodyFat', icon: '📊', min: 3,   max: 60, unit: '%', isPercent: true },
];

// One source of truth for "no measurements given" — read by DEFAULT_DATA and by
// the step's Skip handler, so the two can't drift into disagreeing about what
// an empty baseline looks like.
const EMPTY_BODY_BASELINE = Object.fromEntries(MEASURE_FIELDS.map(f => [f.key, null]));

function BodyBaselineStep({ step, total, value, onChange, onNext, onBack, onSkip }) {
  const { tFallback } = useLanguage();
  // value = { waistCm, chestCm, hipCm, bodyFatPct } — all nullable
  // Measurements are collected in cm only (body-fat in %). Weight unit
  // is handled separately by the weight step.

  // Per-field text drafts. We must NOT clamp while the user is typing — the
  // old code clamped on every keystroke, so typing "8" toward a waist of 80
  // instantly snapped to the 40 cm minimum and you could never enter a real
  // value (body-fat did the same, snapping to 3%). Beta feedback: the waist
  // and body-fat inputs "won't let me type." Fix: hold the raw string, then
  // parse + clamp ONCE on blur. Out-of-range / junk still can't be persisted
  // (the original -50 / 1e10 guard, Audit 13 #7 + #27).
  const [drafts, setDrafts] = useState({});

  const sanitizeNumeric = (raw) => {
    let s = String(raw).replace(/[^0-9.]/g, '');
    const dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    return s;
  };

  const handleType = (key, raw) => {
    setDrafts(d => ({ ...d, [key]: sanitizeNumeric(raw) }));
  };

  const commitField = (key) => {
    if (!(key in drafts)) return;
    const raw = drafts[key];
    let committed = null;
    if (raw !== '' && raw !== '.') {
      const num = Number(raw);
      if (Number.isFinite(num)) {
        const field = MEASURE_FIELDS.find(f => f.key === key);
        const min = field?.min ?? -Infinity;
        const max = field?.max ?? Infinity;
        committed = Math.max(min, Math.min(max, num));
      }
    }
    onChange({ ...value, [key]: committed });
    setDrafts(d => { const n = { ...d }; delete n[key]; return n; });
  };

  const fieldDisplay = (key) => (key in drafts ? drafts[key] : (value[key] ?? ''));

  const hasAny = MEASURE_FIELDS.some(f => value[f.key] != null && value[f.key] !== '');

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4 pe-2">
        <KineticHeading
          kicker={tFallback('onboarding.baseline.kicker', 'Body baseline · optional')}
          text={tFallback('onboarding.baseline.heading', 'Starting numbers for your progress graphs.')}
          accentWord="progress"
        />
        <p className="text-sm text-muted-foreground mt-1 mb-5">
          {tFallback('onboarding.baseline.sub', 'All optional. Stored encrypted, never shared. You can add these later in Progress too.')}
        </p>

        <div className="space-y-3">
          {MEASURE_FIELDS.map((f, i) => (
            <motion.div
              key={f.key}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, ease: [0.16, 1, 0.3, 1], duration: 0.4 }}
              className="rounded-2xl border border-border bg-card p-4 flex items-center gap-4"
            >
              <span className="text-2xl w-8 shrink-0">{f.icon}</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  {tFallback(`onboarding.baseline.${f.i18nKey}`, f.label)}
                  {!f.isPercent && <span className="font-normal normal-case"> (cm)</span>}
                  {f.isPercent && <span className="font-normal normal-case"> (%)</span>}
                </p>
                <input
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="done"
                  placeholder={f.isPercent
                    ? tFallback('onboarding.baseline.placeholderPct', 'e.g. 18')
                    : tFallback('onboarding.baseline.placeholderCm', 'e.g. 80')}
                  value={fieldDisplay(f.key)}
                  onChange={e => handleType(f.key, e.target.value)}
                  onBlur={() => commitField(f.key)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  className="w-full h-11 rounded-xl border border-border bg-secondary/50 px-3 font-mono text-sm font-medium text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Visual hierarchy swaps based on whether the user has filled
          anything in. Most users don't know their tape-measure stats off
          the top of their head, so we don't want "Save & continue" to be
          the loudest button — that pressures them into faking numbers.
          When NO field is filled, Skip becomes the primary visual action.
          When the user HAS entered something, Save returns to primary so
          they don't lose their data by hitting Skip out of habit.
          (Onboarding screenshot feedback, 2026-06.) */}
      <div className="pb-2 pt-2 space-y-2 shrink-0">
        {hasAny ? (
          <>
            <PrimaryBtn onClick={onNext}>
              {tFallback('onboarding.baseline.save', 'Save & continue')}
            </PrimaryBtn>
            <button
              type="button"
              onClick={onSkip}
              className="w-full py-3 rounded-2xl border border-border bg-secondary/60 text-sm font-semibold text-foreground/80 hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground transition-colors"
            >
              {tFallback('onboarding.baseline.skip', 'Skip for now')}
            </button>
          </>
        ) : (
          <>
            <PrimaryBtn onClick={onSkip}>
              {tFallback('onboarding.baseline.skip', 'Skip for now')} <Icon name="arrow-right" size={18} strokeWidth={2.5} />
            </PrimaryBtn>
            <button
              type="button"
              onClick={onNext}
              className="w-full py-3 rounded-2xl border border-border bg-secondary/60 text-sm font-semibold text-foreground/80 hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground transition-colors"
            >
              {tFallback('onboarding.baseline.enterThem', 'I know my measurements — let me enter them')}
            </button>
            <p className="text-micro text-muted-foreground/70 text-center pt-1">
              {tFallback('onboarding.baseline.laterHint', 'You can add these anytime from Progress.')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP V2-B: INJURY HISTORY (optional)
   Quick injury log so the starter regimen can exclude affected
   muscle groups from day one. Mirrors the InjuryForm flow but
   stripped to the minimum: muscle group + severity chips, no
   dates, max 5 entries.
═══════════════════════════════════════════════════════════════ */

const OB_MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core'];
const OB_SEVERITIES = [
  { id: 'mild',     label: 'Mild',     color: 'text-yellow-400 border-yellow-400/40 bg-yellow-400/10' },
  { id: 'moderate', label: 'Moderate', color: 'text-orange-400 border-orange-400/40 bg-orange-400/10' },
  { id: 'serious',  label: 'Serious',  color: 'text-red-400 border-red-400/40 bg-red-400/10' },
];

function InjuryHistoryStep({ step, total, value, onChange, onNext, onBack, onSkip }) {
  const { tFallback } = useLanguage();
  // Muscle group labels come from `i18n-muscle-groups.js`, which already ships
  // all 15 languages for exactly these eight and was, until now, loaded into
  // every language bundle with nothing reading it. The stored value stays the
  // English name — `injury_logs.muscle_group` is matched by string downstream.
  const muscleLabel = (m) => tFallback(m.toLowerCase(), m);
  // value = [{ muscleGroup, severity }]
  const [pendingMuscle, setPendingMuscle] = useState('');
  const [pendingSeverity, setPendingSeverity] = useState('mild');

  const addEntry = () => {
    if (!pendingMuscle) return;
    if (value.length >= 5) return;
    onChange([...value, { muscleGroup: pendingMuscle, severity: pendingSeverity }]);
    setPendingMuscle('');
    setPendingSeverity('mild');
  };

  const remove = (idx) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4 pe-2">
        <KineticHeading
          kicker={tFallback('onboarding.injury.kicker', 'Any injuries? · optional')}
          text={tFallback('onboarding.injury.heading', "We'll work around them from day one.")}
          accentWord="around"
        />
        <p className="text-sm text-muted-foreground mt-1 mb-5">
          {tFallback('onboarding.injury.sub', "Moderate and serious injuries are excluded from your starter plan; mild ones stay in with an ease-in note. Skip if you're all good.")}
        </p>

        {/* Logged injuries */}
        {value.length > 0 && (
          <div className="space-y-2 mb-4">
            {value.map((inj, i) => {
              const sev = OB_SEVERITIES.find(s => s.id === inj.severity) || OB_SEVERITIES[0];
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{muscleLabel(inj.muscleGroup)}</span>
                    <span className={`text-micro font-bold px-1.5 py-0.5 rounded-full border ${sev.color}`}>
                      {tFallback(`onboarding.injury.severity.${sev.id}`, sev.label)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="text-muted-foreground hover:text-destructive active:text-destructive transition-colors p-1 leading-none text-lg"
                    aria-label={tFallback('onboarding.injury.removeAria', 'Remove')}
                  >
                    ×
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Add form — hidden when at the 5-injury cap. Surface a
            friendly hint so the form doesn't just silently vanish.
            (Audit 13 #26.) */}
        {value.length >= 5 && (
          <p className="text-xs text-muted-foreground rounded-xl border border-border bg-card px-3 py-2 mt-3">
            {tFallback('onboarding.injury.capReached', "You've logged the max of 5. Add more later in Progress → Recovery.")}
          </p>
        )}
        {value.length < 5 && (
          <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {tFallback('onboarding.injury.muscleGroup', 'Muscle group')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {OB_MUSCLES.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPendingMuscle(p => p === m ? '' : m)}
                    className={[
                      'px-2.5 py-1 rounded-full text-xs font-semibold border transition-all',
                      pendingMuscle === m
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground active:text-foreground',
                    ].join(' ')}
                  >
                    {muscleLabel(m)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {tFallback('onboarding.injury.severity', 'Severity')}
              </p>
              <div className="flex gap-2">
                {OB_SEVERITIES.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPendingSeverity(s.id)}
                    className={[
                      'flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                      pendingSeverity === s.id ? s.color : 'border-border text-muted-foreground',
                    ].join(' ')}
                  >
                    {tFallback(`onboarding.injury.severity.${s.id}`, s.label)}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={addEntry}
              disabled={!pendingMuscle}
              className={[
                'w-full py-2 rounded-xl text-sm font-bold border transition-all',
                pendingMuscle
                  ? 'bg-secondary text-foreground border-border hover:border-primary/40'
                  : 'bg-secondary/40 text-muted-foreground/50 border-border/40 cursor-not-allowed',
              ].join(' ')}
            >
              {tFallback('onboarding.injury.add', '+ Add injury')}
            </button>
          </div>
        )}
      </div>

      <div className="pb-2 pt-2 space-y-2 shrink-0">
        <PrimaryBtn onClick={onNext}>
          {value.length > 0
            ? tFallback('onboarding.injury.ctaLogged', 'Continue · {count} logged', { count: value.length })
            : tFallback('onboarding.common.continue', 'Continue')}
        </PrimaryBtn>
        <button
          type="button"
          onClick={onSkip}
          className="w-full py-2 text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
        >
          {tFallback('onboarding.injury.skip', 'Skip — no injuries')}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP: HOME GYM

   Beta testers asked to declare the gym they actually train at, so it
   shows on the locator map and they get a leaderboard against the
   people who train there.

   The list merges two sources:
     • gym_businesses rows near the user (verified businesses, demo
       gyms, and community gyms someone already promoted)
     • live OpenStreetMap results, which is where ~every real gym
       actually is, since almost none have registered with us

   An OSM entry already promoted to a community gym appears ONCE, as
   the database row — matched on osm_type/osm_id, the same key mig 275
   dedupes on. Selecting the database row joins an existing community;
   selecting a raw OSM row creates that community.

   Nothing is written here. The pick is held in onboarding state and
   applied in handleRevealNext with the rest of the profile, so
   abandoning onboarding halfway doesn't leave a community gym and a
   membership behind for a user who never finished signing up.
═══════════════════════════════════════════════════════════════ */

function HomeGymStep({ step, total, value, onChange, onNext, onBack, onSkip }) {
  const { tFallback } = useLanguage();
  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4 pe-2">
        <KineticHeading
          kicker={tFallback('onboarding.homeGym.kicker', 'Where do you train? · optional')}
          text={tFallback('onboarding.homeGym.heading', 'Pick your gym and meet your floor.')}
          accentWord="floor"
        />
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          {tFallback('onboarding.homeGym.sub', "Your gym gets a bubble on the Flexyn map, and you'll get a leaderboard with everyone else who trains there. You can change this any time.")}
        </p>

        <NearbyGymPicker
          value={value}
          onChange={onChange}
          emptyHint={tFallback('onboarding.homeGym.emptyHint', 'Nothing is mapped within a few kilometres of you. Skip for now — you can pick your gym from the map later.')}
        />
      </div>

      {/* Same hierarchy swap as the body-baseline step: on an OPTIONAL step the
          loudest control has to be one that actually works. This was
          `disabled={!value}` while still reading a plain "Continue", so the
          biggest button on the last step before the reveal sat dead with
          nothing explaining why, and the only way forward was a low-contrast
          text link. Every other step in the flow changes its label to name the
          blocker; this one couldn't, because nothing was blocking — the step is
          optional. (Audit 18 #5.) */}
      <div className="pb-2 pt-2 space-y-2 shrink-0">
        {value ? (
          <>
            <PrimaryBtn onClick={onNext}>
              {tFallback('onboarding.homeGym.ctaPicked', 'Continue · {name}', { name: value.name })}
            </PrimaryBtn>
            <button
              type="button"
              onClick={onSkip}
              className="w-full py-2 text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
            >
              {tFallback('onboarding.homeGym.skip', "Skip — I'll pick later")}
            </button>
          </>
        ) : (
          <>
            <PrimaryBtn onClick={onSkip}>
              {tFallback('onboarding.homeGym.skip', "Skip — I'll pick later")} <Icon name="arrow-right" size={18} strokeWidth={2.5} />
            </PrimaryBtn>
            <p className="text-micro text-muted-foreground/70 text-center pt-1">
              {tFallback('onboarding.homeGym.laterHint', 'You can set your gym any time from Profile → My Gym.')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 6: LOADING
═══════════════════════════════════════════════════════════════ */

function LoadingStep({ onDone }) {
  const { tFallback } = useLanguage();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= LOADING_TASKS.length) { const t = setTimeout(onDone, 600); return () => clearTimeout(t); }
    const t = setTimeout(() => setStep(s => s + 1), 720);
    return () => clearTimeout(t);
  }, [step, onDone]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      {/* Logo animation — real Flexyn lockup, gently pulsing */}
      <motion.div className="relative w-40 h-24 flex items-center justify-center mb-2"
        animate={{ scale: [1, 1.04, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
        {[0, 1, 2].map(i => (
          <motion.div key={i} className="absolute rounded-full border border-primary/20"
            style={{ inset: -10 - i * 14 }}
            animate={{ opacity: [0.4, 0.08, 0.4], scale: [1, 1.06, 1] }}
            transition={{ duration: 2.2, delay: i * 0.4, repeat: Infinity, ease: 'easeInOut' }} />
        ))}
        <FlexynLogo className="h-11 relative" />
      </motion.div>

      <h2 className="font-heading font-bold text-2xl tracking-tight text-foreground text-center">
        {tFallback('onboarding.loading.heading', 'Building your plan')}
      </h2>
      <p className="text-sm text-muted-foreground text-center">
        {tFallback('onboarding.loading.sub', 'Tuned to your goal · experience · schedule')}
      </p>

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
                {tFallback(`onboarding.loading.task.${i + 1}`, task)}
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

/** Coach trigger for steps that don't render a StepHeader. */
function RevealCoachButton() {
  const coach = useContext(OnboardingCoachContext);
  if (!coach || !hasCoachFor(coach.stepName)) return null;
  return <OnboardingCoachButton onClick={coach.open} />;
}

/**
 * Fill `{placeholder}` slots in a translated string with React nodes.
 *
 * The reveal sentence mixes copy and emphasised values, and word order moves
 * between languages — "for a beginner lifter on 3 days" puts the level before
 * the day count in English and after it in several others. Interpolating nodes
 * rather than concatenating JSX lets a translator move the slots freely.
 */
function fillNodes(template, values) {
  return String(template).split(/(\{\w+\})/g).map((part, i) => {
    const m = part.match(/^\{(\w+)\}$/);
    return m ? <span key={i}>{values[m[1]] ?? ''}</span> : part;
  });
}

function RevealStep({ data, onNext, saving = false, previewRegimen = null }) {
  const { tFallback } = useLanguage();
  const goalIds = Array.isArray(data.goal) ? data.goal : (data.goal ? [data.goal] : []);
  const primaryGoal = GOALS.find(g => g.id === goalIds[0]) || GOALS[0];
  const extraGoalCount = Math.max(0, goalIds.length - 1);
  const level = LEVELS.find(l => l.id === data.level) || LEVELS[0];
  const daysCount = data.days.length;
  const weeks = (level?.bars || 1) >= 3 ? 12 : 8;

  // Real exercises from the regimen we'll persist on submit. Falls back to
  // an empty list if the generator wasn't passed in (legacy / unit-test path).
  const previewExercises = previewRegimen?.exercises ?? [];

  return (
    <div className="flex flex-col h-full">
      <Confetti pieces={28} />
      <div className="flex-1 overflow-y-auto pb-4 pt-2 pe-2">
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.4 }}
          className="mb-5 flex items-center justify-between gap-3">
          <FlexynLogo className="h-7" />
          {/* Reveal has no StepHeader, so the coach button is placed
              directly — "why this plan?" is the question people most
              want answered before they commit to it. */}
          <RevealCoachButton />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="font-mono text-micro font-bold tracking-[0.18em] text-primary uppercase mb-4">
          {tFallback('onboarding.reveal.ready', 'Plan ready · 100%')}
        </motion.div>

        <h1 className="font-heading font-bold text-[38px] leading-[1.0] tracking-tight text-foreground m-0 mb-4">
          {tFallback('onboarding.reveal.welcome', 'Welcome in,').split(' ').map((w, i) => (
            <motion.span key={`w-${i}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1, duration: 0.55, ease: [0.16,1,0.3,1] }}
              className="inline-block me-3">{w}</motion.span>
          ))}
          <br />
          <motion.span initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.55, ease: [0.16,1,0.3,1] }} className="inline-block text-primary">
            {data.username || tFallback('onboarding.reveal.defaultName', 'lifter')}.
          </motion.span>
        </h1>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
          className="text-sm text-muted-foreground leading-relaxed mb-6 max-w-xs">
          {fillNodes(
            tFallback(
              'onboarding.reveal.summary',
              'A {weeks}-week {goal}{extra} block, dialled in for a {level} lifter on {days} days.',
            ),
            {
              weeks: <strong className="text-foreground">{weeks}</strong>,
              goal: tFallback(`onboarding.goal.${primaryGoal.id}.title`, primaryGoal.title).toLowerCase(),
              extra: extraGoalCount > 0
                ? fillNodes(
                    tFallback('onboarding.reveal.summaryExtra', ' + {count} more'),
                    { count: <strong className="text-foreground">{extraGoalCount}</strong> },
                  )
                : '',
              level: <strong className="text-foreground">
                {level ? tFallback(`onboarding.level.${level.id}.label`, level.label).toLowerCase() : ''}
              </strong>,
              days: <strong className="text-foreground">{daysCount}</strong>,
            },
          )}
        </motion.p>

        {/* Your starter plan — sectioned + explorable (Cardio / Strength) */}
        {previewExercises.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
            className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-micro font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                {tFallback('onboarding.reveal.starterPlan', 'Your starter plan')}
              </span>
              <span className="font-mono text-micro font-bold text-emerald-500">
                {tFallback('onboarding.reveal.readyBadge', '● READY')}
              </span>
            </div>
            <div className="font-heading font-bold text-lg tracking-tight text-foreground leading-tight">
              {previewRegimen?.name || tFallback('onboarding.reveal.planName', '{goal} starter', {
                goal: tFallback(`onboarding.goal.${primaryGoal.id}.title`, primaryGoal.title),
              })}
            </div>
            <div className="text-caption text-muted-foreground -mt-0.5 mb-1">
              {tFallback(
                'onboarding.reveal.planMeta',
                '{days} days/week · tap a section to explore · saved to Workout → Regimens',
                { days: daysCount || '—' },
              )}
            </div>
            <StarterPlanView regimen={previewRegimen} />
          </motion.div>
        )}
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }}
        className="pt-4 shrink-0">
        <PrimaryBtn onClick={onNext} disabled={saving}>
          {saving ? (
            <>
              <span className="inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              {tFallback('onboarding.reveal.saving', 'Saving…')}
            </>
          ) : (
            <>{tFallback('onboarding.reveal.cta', 'Enter Flexyn')} <Icon name="arrow-right" size={18} strokeWidth={2.5} /></>
          )}
        </PrimaryBtn>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN ONBOARDING ORCHESTRATOR
═══════════════════════════════════════════════════════════════ */

const STEPS = ['welcome', 'goal', 'sharpen', 'experience', 'age', 'height', 'weight', 'body_baseline', 'days', 'assessment', 'injury_history', 'home_gym', 'loading', 'reveal'];
const FORM_STEP_NAMES = ['goal', 'sharpen', 'experience', 'age', 'height', 'weight', 'body_baseline', 'days', 'assessment', 'injury_history', 'home_gym'];
const TOTAL_FORM = FORM_STEP_NAMES.length;

// Per-step theatrical transition flavors — variety = wow factor
const STEP_TRANSITIONS = {
  welcome:       null,
  goal:          'curtain',
  sharpen:       'tilt',
  experience:    'tilt',
  age:           'fwd',
  height:        'flip',
  weight:        'tilt',
  body_baseline: 'flip',
  days:          'curtain',
  assessment:    'fwd',
  injury_history:'tilt',
  home_gym:      'curtain',
  loading:       'flash',
  reveal:        'iris',
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
  const { tFallback } = useLanguage();
  const { setWeightUnit } = useWeightUnit();

  const [stepIdx, setStepIdx] = useState(0);
  const [direction, setDirection] = useState(1);
  const [saving, setSaving] = useState(false);
  // New users sign in from the welcome screen via the full SignInToContinue
  // gate (Google + Apple + email magic-link, all with error handling) rather
  // than being force-redirected to Google with no fallback. Toggled by the
  // welcome CTAs; the OAuth/magic-link round-trip reloads the app, so this
  // flag doesn't need to survive the redirect.
  const [showSignIn, setShowSignIn] = useState(false);

  // Persist in-flight onboarding state to localStorage so a refresh / tab
  // close mid-flow doesn't lose 6 steps of input. Cleared on successful
  // submit (handleRevealNext).
  //
  // Namespaced by user.id so a shared/family device doesn't leak User A's
  // draft (DOB, height, weight, goals) into User B's onboarding form when
  // B logs in fresh. The pre-auth window uses an `anon` bucket; once
  // user.id resolves the effect below migrates the anon draft over so
  // someone who hit "Get Started" → filled a couple of steps → signed in
  // doesn't lose what they typed.
  const ONBOARDING_DRAFT_KEY = `fn-onboarding-draft-v1.${user?.id || 'anon'}`;

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
    // Array — multi-select preferred training times. See DaysStep for
    // the coercion-from-legacy-string fallback.
    preferredTime: [],
    // 4-question lift-estimate assessment. Optional — empty object
    // means "skipped." See `assessment` step + buildStarterRegimen.
    assessment: {},
    // V2 optional steps — all nullable/empty means step was skipped
    bodyBaseline: { ...EMPTY_BODY_BASELINE },
    onboardingInjuries: [], // [{ muscleGroup, severity }]
    // "Sharpen your plan" follow-ups — all optional; drives the starter plan +
    // a real cardio goal. cardioEvent: 5k|10k|half|marathon|general;
    // cardioCurrent: { distance, timeSec }; strengthFocus: [exercise names].
    sharpen: { cardioEvent: null, cardioCurrent: null, cardioDefer: false, strengthFocus: [] },
    // Home gym pick (mig 275). Either { gymId, name } for a gym we
    // already have a row for, or { osm, name } for an OpenStreetMap
    // entry to promote. null = skipped.
    homeGym: null,
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
        bodyBaseline: { ...DEFAULT_DATA.bodyBaseline, ...(parsed.bodyBaseline || {}) },
        onboardingInjuries: Array.isArray(parsed.onboardingInjuries) ? parsed.onboardingInjuries : [],
        // Only restore a draft pick that still has something to act on.
        // A half-written shape would reach setHomeGymFromOsm as
        // undefined coords and fail the RPC's validation for no reason.
        homeGym: (parsed.homeGym?.gymId || parsed.homeGym?.osm?.osmId)
          ? parsed.homeGym
          : null,
      };
    } catch {
      return DEFAULT_DATA;
    }
  });

  // Persist every data change, but ONLY once there's a user to key it to.
  //
  // There is no longer any pre-auth step that collects anything: welcome's two
  // CTAs both open the sign-in gate, so `welcome` is the only screen an
  // anonymous visitor sees and it has no inputs. The unconditional write was
  // therefore stamping a fresh copy of DEFAULT_DATA into an `…anon` bucket on
  // every single visit, and a migration effect below it existed to move that
  // nothing into the user's bucket on sign-in. Both are gone; the stale anon
  // bucket from earlier builds is swept once. (Audit 18 #23.)
  //
  // If a pre-auth step is ever reintroduced, this is the line to revisit —
  // and the cross-user question comes back with it, because two people
  // signing up on one device would share the anon bucket.
  useEffect(() => {
    if (!user?.id) return;
    try {
      localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(data));
    } catch { /* private mode / quota */ }
  }, [data, ONBOARDING_DRAFT_KEY, user?.id]);

  useEffect(() => {
    try { localStorage.removeItem('fn-onboarding-draft-v1.anon'); } catch { /* private mode */ }
  }, []);

  const [usernameError, setUsernameError] = useState('');

  // Pre-compute the starter regimen the user will see on the Reveal step
  // AND the one we'll actually persist on submit — same object both places,
  // so the preview can't lie about what the user is getting. Pure function,
  // safe to recompute on every relevant input change.
  // The persisted regimen at submit time passes `assessment` to
  // buildStarterRegimen — keep this preview in sync so the Reveal screen
  // can't lie about what the user is getting. Comment at the call site
  // promised "same object both places" and that promise was broken
  // until this dep was added.
  const previewRegimen = useMemo(
    () => buildStarterRegimen({
      goals: data.goal,
      level: data.level,
      daysCount: Array.isArray(data.days) ? data.days.length : 0,
      assessment: data.assessment || null,
      cardioEvent: data.sharpen?.cardioEvent,
      strengthFocus: data.sharpen?.strengthFocus,
      injuries: data.onboardingInjuries || [],
      age: data.stats?.age,
      bodyFatPct: data.bodyBaseline?.bodyFatPct,
      gender: data.stats?.gender,
      weightKg: data.stats?.weightKg,
      heightCm: data.stats?.heightCm,
    }),
    [data.goal, data.level, data.days, data.assessment, data.sharpen?.cardioEvent, data.sharpen?.strengthFocus, data.onboardingInjuries, data.stats?.age, data.bodyBaseline?.bodyFatPct, data.stats?.gender, data.stats?.weightKg, data.stats?.heightCm]
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
  // Gate on !isLoadingAuth so we don't briefly show the welcome step
  // during the auth-hydration window for a returning user.
  useEffect(() => {
    if (isLoadingAuth) return;
    const isDeletedPlaceholder = !!(user?.username?.startsWith('deleted_'));
    const hasRealUsername = !!(user?.username && !isDeletedPlaceholder);
    // A username alone is NOT evidence of a finished profile. This used to
    // bounce anyone holding one straight to the dashboard, so a user who
    // picked a name and then dropped out — or whose save landed on the
    // username-only tier-3 fallback — was sent to a Dashboard of empty cards
    // with no way back into the flow that would fill them.
    //
    // App.jsx:266-274 already knows the right test for "the legacy flow
    // really did complete" and refuses to auto-heal the onboarding_complete
    // flag without it. The two gates disagreed; this is the same test.
    // (Audit 18 #19.)
    const hasFullProfile = !!(
      user?.fitness_level ||
      user?.fitness_goals ||
      user?.primary_goal ||
      user?.training_days_per_week ||
      user?.weight_lbs ||
      user?.height_inches
    );
    // Never skip onboarding for deleted_ placeholder accounts — stale
    // onboarding_complete flags must not override the re-onboarding gate.
    if (!isDeletedPlaceholder && (user?.onboarding_complete || (hasRealUsername && hasFullProfile))) {
      navigate('/dashboard', { replace: true });
    }
  }, [
    user?.onboarding_complete, user?.username, isLoadingAuth, navigate,
    // The profile fields the gate now reads have to be in here, or a profile
    // that finishes loading after the first pass never re-triggers the check.
    user?.fitness_level, user?.fitness_goals, user?.primary_goal,
    user?.training_days_per_week, user?.weight_lbs, user?.height_inches,
  ]);

  // Declared BEFORE the effect that calls it. `const` is not hoisted, and the
  // effect below referenced `goTo` from above its declaration — safe only
  // because effect bodies run after mount, and one step from throwing if
  // anyone ever adds `goTo` to a deps array. That is the exact TDZ pattern
  // CLAUDE.md records as having crashed Hub in production. (Audit 18 #25.)
  const goTo = (idx) => {
    setDirection(idx > stepIdx ? 1 : -1);
    setStepIdx(idx);
  };

  // If they authenticated via the "get started" flow, skip to goal step.
  // stepIdx is intentionally read freshly via the dep array so a future
  // change that lands the user on `welcome` while authed re-fires the
  // skip (e.g. browser back to step 0).
  useEffect(() => {
    if (isAuthenticated && stepIdx === 0) {
      goTo(1);
    }
  }, [isAuthenticated, stepIdx]);

  const next = () => goTo(Math.min(STEPS.length - 1, stepIdx + 1));
  const back = () => goTo(Math.max(0, stepIdx - 1));

  const stepName = STEPS[stepIdx];
  const formStep = FORM_STEP_NAMES.indexOf(stepName) + 1; // 0 if not a form step

  /* ── AI Coach ──────────────────────────────────────────────
     The coach can answer about the current step, and where its answer
     resolves to an actual choice it hands back an `apply` payload that
     makes the selection here. Advice the user then has to go and
     re-enter by hand is most of the way to being no help at all.
     Unknown fields are ignored rather than written blindly — a new
     suggestion type shipped in the pure module must not be able to
     poke an arbitrary key into the profile draft.                    */
  const [coachOpen, setCoachOpen] = useState(false);
  const applyCoachSuggestion = useCallback((apply) => {
    if (!apply || typeof apply.field !== 'string') return;
    const { field, value } = apply;
    if (field === 'goal') {
      setData(d => ({ ...d, goal: Array.isArray(value) ? value : [value] }));
    } else if (field === 'level') {
      setData(d => ({ ...d, level: value }));
    } else if (field === 'days') {
      setData(d => ({ ...d, days: Array.isArray(value) ? value : d.days }));
    } else {
      return;
    }
    if (navigator.vibrate) navigator.vibrate(6);
    setCoachOpen(false);
  }, []);
  const coachCtx = useMemo(
    () => ({ stepName, open: () => setCoachOpen(true) }),
    [stepName],
  );

  const handleUsernameChange = (val) => {
    setData(d => ({ ...d, username: val }));
    if (val.length >= 2 && containsProfanity(val)) {
      setUsernameError(tFallback('onboarding.error.usernameProfane', 'Username contains inappropriate language.'));
    } else if (val.length > 20) {
      setUsernameError(tFallback('onboarding.error.usernameTooLong', 'Username must be 20 characters or less.'));
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
  // In-flight guard against rapid double-tap on the final "Enter Flexyn"
  // button. The visible `saving` state DOES disable the button, but it's
  // set AFTER handleRevealNext's first await — between the click and
  // React's next render a fast second tap slips through and fires the
  // whole submit pipeline twice. Symptoms: two starter regimens
  // (ensureStarterRegimen sees "no regimens" on both racing reads),
  // two body_metrics rows for the same date, two injury_logs batches.
  // Ref-based guard takes effect synchronously inside the click handler.
  const submittingRef = useRef(false);
  useEffect(() => {
    const u = (data.username || '').trim();
    // Same threshold the Continue button uses (MIN_USERNAME_LENGTH). These
    // were 3 here and 2 there, so a two-character name was never checked for
    // availability: the user sailed through the remaining steps and found out
    // it was taken when the final save came back 23505, which bounced them
    // from the reveal screen all the way to the age step. (Audit 18 #12.)
    if (u.length < MIN_USERNAME_LENGTH) return;
    if (usernameError) return; // already showing a different validation error
    const seq = ++usernameCheckSeqRef.current;
    const timer = setTimeout(async () => {
      try {
        // Cross-user read (other accounts' usernames) — goes through the
        // public_profiles view so it keeps working after the base table's
        // public SELECT policy is dropped.
        //
        // The pattern MUST be escaped. `_` is a single-character wildcard in
        // SQL LIKE/ILIKE, the sanitizer at onUsernameChangeSanitized
        // deliberately allows `_`, and the field's own placeholder suggests
        // `jordan_lifts` — so an unescaped `ilike` matched any existing
        // `jordanXlifts` and told the user their name was taken. The error
        // disables Continue, so this blocked signup outright for every
        // underscored name. (Audit 18 #1.)
        const { data: rows } = await safeSelect({
          columns: ['id'],
          build: (cols) => selectProfiles((from) => from
            .select(cols)
            .ilike('username', escapeLikePattern(u))
            .limit(1)),
        });
        if (seq !== usernameCheckSeqRef.current) return; // a newer keystroke superseded us
        if (!rows || rows.length === 0) return;
        // If the only matching row IS the current user, that's fine.
        if (user?.id && rows[0].id === user.id) return;
        setUsernameError(tFallback('onboarding.error.usernameTaken', 'That username is already taken.'));
      } catch { /* network/RLS — fall through silently, the final-submit
                  check will still catch the duplicate via 23505 */ }
    }, 350);
    return () => clearTimeout(timer);
  }, [data.username, user?.id, usernameError]);

  const handleRevealNext = async () => {
    // Synchronous ref guard — see submittingRef declaration for why this
    // is needed in addition to the `saving` state.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    const s = data.stats || {};
    const weightUnit = s.weightUnit === 'kg' ? 'kg' : 'lbs';

    // Unit conversion, clamping and the three save tiers live in
    // `@/lib/data/onboardingProfile` — pure, and tested directly rather than
    // through a 14-step flow against a live database. See that module for why
    // the clamps are what they are; the CHECK constraints this code used to
    // claim it was defending against mostly do not exist. (Audit 18 #13, #14.)
    const {
      core: coreProfile,
      full: fullProfile,
      minimal: minimalProfile,
    } = buildProfilePayload({ data, nowIso: new Date().toISOString() });

    // Tier 3 — last resort: just username + completion flags. This is
    // the bulletproof guarantee the user can always finish onboarding.
    // If even this fails it's a hard backend outage (RLS / network) and
    // we surface the actual PG error code so users can report something
    // actionable.

    let saved = false;
    try {
      await db.auth.updateMe(fullProfile);
      setWeightUnit(weightUnit);
      markReturningUser();
      if (checkUserAuth) await checkUserAuth();
      saved = true;
    } catch (err) {
      // Full save failed — try the minimal fallback below. This is a
      // warning (not error) because we have a documented fallback path;
      // the real error level is set on minErr below if BOTH fail.
      reportError(err, { feature: 'onboarding.full-save', level: 'warning', userEmail: user?.email, note: 'attempting minimal-save fallback' });
      // Detect a duplicate-username error and route the user back to a step
      // where they can fix it. Keyed off the constraint NAME (via the shared
      // classifier) so it fires ONLY for the username unique constraint —
      // an email collision (also a 23505) or any other save failure falls
      // through to the generic handler instead of being mislabelled
      // "username taken" and bouncing the user to a step they can't fix.
      if (isDuplicateUsernameError(err)) {
        setUsernameError(tFallback('onboarding.error.usernameTakenRetry', 'That username is already taken. Try another.'));
        setSaving(false);
        // Jump back to the age step (last step before reveal where the
        // username field is visible) so the user can edit it.
        const ageIdx = STEPS.indexOf('age');
        if (ageIdx >= 0) goTo(ageIdx);
        toast.error(tFallback('onboarding.toast.usernameTaken', 'That username is already taken — try another.'));
        return;
      }
      // Server-side profanity trigger (migration 050) — surfaces as
      // 23514 with a 'username_profanity' tag in err.message. Route the
      // user back to the username step with a clear inline error so
      // they can fix it without guessing.
      if (isProfaneUsernameError(err)) {
        setUsernameError(tFallback('onboarding.error.usernameProhibited', 'That username contains prohibited content. Pick another.'));
        setSaving(false);
        const ageIdx = STEPS.indexOf('age');
        if (ageIdx >= 0) goTo(ageIdx);
        toast.error(tFallback('onboarding.toast.usernameProhibited', 'Username contains prohibited content — pick another.'));
        return;
      }

      // Tier 2 fallback: drop fitness_assessment (a JSONB column added
      // in mig 129 — if PostgREST's schema cache or RLS rejects it for
      // any reason, this layer skips it). All the other fields are
      // included so the user's actual answers are persisted even when
      // the full save trips on the assessment column.
      let tier2Err = null;
      try {
        await db.auth.updateMe(minimalProfile);
        setWeightUnit(weightUnit);
        markReturningUser();
        if (checkUserAuth) await checkUserAuth();
        saved = true;
      } catch (minErr) {
        tier2Err = minErr;
      }

      if (!saved) {
        // Tier 3 — LAST RESORT. Persist just username + the onboarding
        // flag. This is the bulletproof guarantee: if our backend is
        // even minimally responsive, the user can finish onboarding and
        // fix profile details later from Settings, instead of being
        // stranded forever on the reveal screen. The strip-and-retry
        // inside updateMe handles missing columns transparently.
        try {
          await db.auth.updateMe(coreProfile);
          setWeightUnit(weightUnit);
          markReturningUser();
          if (checkUserAuth) await checkUserAuth();
          saved = true;
          // Loud but non-blocking: let the user know some details
          // didn't save so they're not surprised to see missing data.
          toast.warning(
            tFallback('onboarding.toast.partialSave', 'Some profile details could not be saved — finish setup from Settings later.'),
            { duration: 5000 },
          );
          reportError(tier2Err, { feature: 'onboarding.tier3-recovery', level: 'warning', userEmail: user?.email, note: 'core saved, details deferred' });
        } catch (coreErr) {
          // Even the last-resort save failed — this is a real backend
          // outage. Report at error level + surface the actual PG code
          // in the toast so the user can report something specific.
          reportError(coreErr, { feature: 'onboarding.core-save', userEmail: user?.email, note: 'all 3 tiers failed', tier2Err: tier2Err?.message });
          if (isDuplicateUsernameError(coreErr)) {
            setUsernameError(tFallback('onboarding.error.usernameTakenRetry', 'That username is already taken. Try another.'));
            const ageIdx = STEPS.indexOf('age');
            if (ageIdx >= 0) goTo(ageIdx);
            toast.error(tFallback('onboarding.toast.usernameTaken', 'That username is already taken — try another.'));
          } else if (isProfaneUsernameError(coreErr)) {
            setUsernameError(tFallback('onboarding.error.usernameProhibited', 'That username contains prohibited content. Pick another.'));
            const ageIdx = STEPS.indexOf('age');
            if (ageIdx >= 0) goTo(ageIdx);
            toast.error(tFallback('onboarding.toast.usernameProhibited', 'Username contains prohibited content — pick another.'));
          } else {
            const looksOffline =
              !navigator.onLine ||
              /network|failed to fetch|timeout|fetch failed/i.test(coreErr?.message || '');
            // Surface the actual PG error code so reports come in
            // with something actionable instead of "Could not save."
            const code = coreErr?.code ? ` (${coreErr.code})` : '';
            const detail = coreErr?.message ? `: ${String(coreErr.message).slice(0, 120)}` : '';
            toast.error(
              looksOffline
                ? tFallback('onboarding.toast.offline', "You're offline — reconnect and tap Save again.")
                : tFallback('onboarding.toast.saveFailed', 'Could not save your profile{code}. Tap Save to retry{detail}', { code, detail }),
              { duration: 8000 }
            );
          }
        }
      }
    } finally {
      setSaving(false);
      submittingRef.current = false;
      // Only navigate away if SOME save tier succeeded. Side-effects
      // (capsule, regimen, body-metrics, injuries) fire here so they
      // run regardless of which tier landed the profile — a Tier 2/3
      // user still gets their welcome capsule + starter regimen.
      if (saved) {
        // Welcome capsule — idempotent, fire-and-forget.
        if (user?.id && user?.email) {
          grantWelcomeCapsule(user.id, user.email).catch(sideErr => {
            reportError(sideErr, { feature: 'onboarding.welcome-capsule', level: 'warning', userEmail: user?.email });
          });
        }
        // Starter regimen — idempotent (skips if any regimens exist).
        ensureStarterRegimen({
          user,
          profile: {
            goals: data.goal,
            level: data.level,
            daysCount: Array.isArray(data.days) ? data.days.length : 0,
            assessment: data.assessment || null,
            cardioEvent: data.sharpen?.cardioEvent,
            strengthFocus: data.sharpen?.strengthFocus,
            injuries: data.onboardingInjuries || [],
            age: data.stats?.age,
            bodyFatPct: data.bodyBaseline?.bodyFatPct,
            gender: data.stats?.gender,
            weightKg: data.stats?.weightKg,
            heightCm: data.stats?.heightCm,
          },
        }).catch(sideErr => {
          reportError(sideErr, { feature: 'onboarding.starter-regimen', level: 'warning', userEmail: user?.email });
        });

        // Cardio goal — if the user picked a running goal + a target event,
        // create a real, trackable cardio goal (shows in the Cardio tab +
        // dashboard). Idempotent-ish + fire-and-forget; never blocks onboarding.
        ensureOnboardingCardioGoal({ user, goals: data.goal, sharpen: data.sharpen })
          .catch(sideErr => {
            reportError(sideErr, { feature: 'onboarding.cardio-goal', level: 'warning', userEmail: user?.email });
          });

        // Body baseline (mig 133) — only if user filled bodyBaseline
        // step. weight_lbs left NULL unless user actually touched the
        // weight step (avoids phantom default-165 entry contaminating
        // the Progress chart). Audit 13 #2.
        const bb = data.bodyBaseline || {};
        const hasMeasurements = Object.values(bb).some(v => v != null && v !== '');
        const userTouchedWeight = !!data.stats?.userTouchedWeight;
        if (user?.id && hasMeasurements) {
          supabase.from('body_metrics').insert({
            created_by: user.email,
            user_id:    user.id,
            date:       todayLocalDateString(),
            // Same resolver the profile payload uses, so the first point on
            // the Progress weight chart cannot disagree with the weight on the
            // profile it was captured alongside.
            weight_lbs: userTouchedWeight ? resolveMeasurements(s).weightLb : null,
            body_fat_pct: bb.bodyFatPct ?? null,
            waist_cm:   bb.waistCm   ?? null,
            chest_cm:   bb.chestCm   ?? null,
            hip_cm:     bb.hipCm     ?? null,
          })
            // supabase-js RESOLVES with `{ error }` on a database failure — it
            // only rejects on a network-level throw. `.then(() => {}).catch()`
            // therefore swallowed every RLS denial and constraint violation
            // here, silently, including from Sentry. Re-throw so the catch is
            // reachable. (Audit 18 #8.)
            .then(({ error }) => { if (error) throw error; })
            .catch(sideErr => {
              reportError(sideErr, { feature: 'onboarding.body-baseline', level: 'warning', userEmail: user?.email });
            });
        }

        // Injuries from onboarding step.
        if (user?.id && user?.email && Array.isArray(data.onboardingInjuries) && data.onboardingInjuries.length > 0) {
          const injuryRows = data.onboardingInjuries.map(inj => ({
            user_id:    user.id,
            user_email: user.email,
            muscle_group: inj.muscleGroup,
            severity:     inj.severity,
            notes:        'Logged during onboarding',
            injured_at:   todayLocalDateString(),
            status:       'active',
          }));
          supabase.from('injury_logs').insert(injuryRows)
            // Same resolve-with-error trap as the body-baseline insert above.
            .then(({ error }) => { if (error) throw error; })
            .catch(sideErr => {
              reportError(sideErr, { feature: 'onboarding.injury-history', level: 'warning', userEmail: user?.email });
              // TELL the user. This is the one side effect whose absence they
              // will go looking for: they listed injuries specifically so the
              // plan would work around them, and a silent failure means they
              // open Progress → Recovery to an empty list and conclude the app
              // lost them. The toast lands on the dashboard they're being
              // navigated to, and `warning` is always delivered under the
              // current toast policy. (Audit 18 #8.)
              toast.warning(
                tFallback('onboarding.toast.injuriesFailed', "We couldn't save your injury history — add it from Progress → Recovery so your plan works around it."),
                { duration: 7000 },
              );
            });
        }

        // Home gym from the picker step (mig 275). Applied here rather
        // than at pick time so abandoning onboarding halfway never
        // leaves a community gym + membership behind for a user who
        // never finished. Fire-and-forget like the other side effects —
        // a gym that didn't attach is recoverable from Profile → My
        // Gym, and must never block entry into the app.
        if (data.homeGym) {
          const attach = data.homeGym.osm
            ? setHomeGymFromOsm(data.homeGym.osm)
            : setHomeGym(data.homeGym.gymId);
          attach.catch(sideErr => {
            reportError(sideErr, { feature: 'onboarding.home-gym', level: 'warning', userEmail: user?.email });
          });
        }

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

  // New user tapped a welcome CTA → show the full sign-in gate (Google +
  // Apple + email magic-link with error handling) instead of force-pushing
  // Google with no fallback. Once authenticated the round-trip reloads the
  // app and the welcome→goal auto-advance takes over.
  if (showSignIn && !isAuthenticated) {
    return (
      <SignInToContinue
        onBack={() => setShowSignIn(false)}
        heading="Let's get you set up"
        subtext="Create an account or sign in — it saves your plan and syncs your progress across devices."
      />
    );
  }

  return (
    // Use 100dvh (dynamic viewport height) so the layout adapts when
    // the iOS Safari URL bar / virtual keyboard collapses or expands.
    // Plain `fixed inset-0` resolves to 100vh which on iOS stays at
    // pre-keyboard size — pushing the focused input behind the
    // keyboard. dvh shrinks with the keyboard so onboarding inputs
    // stay reachable.
    <OnboardingCoachContext.Provider value={coachCtx}>
    <div className="fixed inset-0 bg-background overflow-hidden" style={{ height: '100dvh' }}>
      <Aurora />

      {/* Mounted at the root rather than inside the step, so the sheet
          survives the AnimatePresence step transition — applying a
          suggestion that advances the step must not yank the panel out
          from under the user mid-animation. */}
      <OnboardingCoachSheet
        open={coachOpen}
        onClose={() => setCoachOpen(false)}
        stepId={stepName}
        draft={data}
        onApply={applyCoachSuggestion}
      />

      <div className="relative z-10 h-full flex items-start justify-center overflow-hidden">
        <div className="w-full max-w-[420px] h-full px-6 py-6 sm:py-10 flex flex-col">
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
                    else { setShowSignIn(true); }
                  }}
                  onSignIn={() => setShowSignIn(true)}
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

              {stepName === 'sharpen' && (
                <SharpenStep step={formStep} total={TOTAL_FORM}
                  goals={data.goal}
                  value={data.sharpen} onChange={v => setData(d => ({ ...d, sharpen: v }))}
                  onNext={next} onBack={back} />
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

              {stepName === 'body_baseline' && (
                <BodyBaselineStep
                  step={formStep} total={TOTAL_FORM}
                  value={data.bodyBaseline}
                  onChange={v => setData(d => ({ ...d, bodyBaseline: v }))}
                  onNext={next} onBack={back}
                  // Skip must DISCARD, not just advance. It was wired straight
                  // to `next`, so a user who typed a waist measurement and then
                  // tapped "Skip for now" still had it written to body_metrics
                  // at submit — the button did the opposite of its label, with
                  // health data. The home-gym step below already clears its
                  // pick on skip; this now matches. (Audit 18 #4.)
                  onSkip={() => { setData(d => ({ ...d, bodyBaseline: { ...EMPTY_BODY_BASELINE } })); next(); }}
                />
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
                  // The step falls back to `onSkip || onNext`, so with no
                  // handler passed "Skip — generate a generic plan" was
                  // byte-identical to Continue and any partial answers still
                  // fed buildStarterRegimen. Skipping now means what it says.
                  // (Audit 18 #24.)
                  onSkip={() => { setData(d => ({ ...d, assessment: {} })); next(); }}
                />
              )}

              {stepName === 'injury_history' && (
                <InjuryHistoryStep
                  step={formStep} total={TOTAL_FORM}
                  value={data.onboardingInjuries}
                  onChange={v => setData(d => ({ ...d, onboardingInjuries: v }))}
                  onNext={next} onBack={back} onSkip={next}
                />
              )}

              {stepName === 'home_gym' && (
                <HomeGymStep
                  step={formStep} total={TOTAL_FORM}
                  value={data.homeGym}
                  onChange={v => setData(d => ({ ...d, homeGym: v }))}
                  onNext={next}
                  onBack={back}
                  onSkip={() => { setData(d => ({ ...d, homeGym: null })); next(); }}
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
    </OnboardingCoachContext.Provider>
  );
}

