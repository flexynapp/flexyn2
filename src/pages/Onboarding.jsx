// src/pages/Onboarding.jsx
// Redesigned onboarding — 7-step flow with animated background, feature
// carousel, multi-select goals, experience level, stat scrubbers,
// schedule picker, loading animation, and personalised reveal.

import { Fragment, createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import SignInToContinue from './SignInToContinue';
import FlexynLogo from '@/components/FlexynLogo';
import { motion, AnimatePresence, useReducedMotion, useAnimationControls } from 'framer-motion';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { selectProfiles } from '@/lib/data/users';
import { markReturningUser } from '@/lib/firstLaunch';
import { containsProfanity } from '@/lib/profanityFilter';
import { grantWelcomeCapsule } from '@/lib/data/capsules';
import { buildStarterRegimen, ensureStarterRegimen, starterPlanLevel, starterPlanWeeks, fiveKSecondsFrom, TRAINING_EQUIPMENT, SESSION_MINUTES } from '@/lib/data/starterRegimen';
import { EXERCISE_LIBRARY } from '@/components/regimens/ExerciseAutocomplete';
import { translateExerciseName } from '@/lib/exerciseTranslations';
import { ensureOnboardingCardioGoal } from '@/lib/data/onboardingCardioGoal';
import StarterPlanCoachCard from '@/components/onboarding/StarterPlanCoachCard';
import GoalIcon from '@/components/onboarding/GoalIcon';
import { askStarterPlanCoach } from '@/lib/aiCoach/starterPlanCoach';
import { reportError } from '@/lib/reportError';
import { isDuplicateUsernameError, isProfaneUsernameError, isReservedUsernameError } from '@/lib/onboardingErrors';
import { escapeLikePattern } from '@/lib/sqlPattern';
import { buildProfilePayload, resolveMeasurements, parseHeightInput, PROFILE_RANGES, MIN_USERNAME_LENGTH, canLeaveAboutStep } from '@/lib/data/onboardingProfile';
import { todayLocalDateString } from '@/lib/dateUtils';
import { useDateFormatter } from '@/lib/intl';
import { isAccent } from '@/lib/accentWord';
import NearbyGymPicker from '@/components/gyms/NearbyGymPicker';
import GymJoinSheet from '@/components/gyms/GymJoinSheet';
// Lazy on purpose: GymMap statically imports maplibre-gl, and
// vite.config keeps that out of vendor-misc so it stays its own chunk.
// A static import here would put a map engine in the onboarding bundle
// for a screen most users never open.
const GymMapOverlay = lazy(() => import('@/pages/GymMap'));
import {
  setHomeGym, setHomeGymFromOsm, resolveHomeGymId,
} from '@/lib/data/homeGym';
import { getGym, leaveGym } from '@/lib/data/gymBusinesses';
import { OnboardingCoachButton, OnboardingCoachSheet } from '@/components/onboarding/OnboardingCoach';
import { hasCoachFor } from '@/lib/aiCoach/onboardingCoach';
import { track, EVENTS } from '@/lib/analytics';

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

// No per-goal accent. Six goals each carrying their own hue put six colours
// on one screen, which reads as six branded products rather than as a list
// with one thing chosen — and the composition rule in CLAUDE.md is four
// hues, where a new state REPLACES one rather than extending the list.
// Selection is primary against grey; the icon and the label are what tell
// the goals apart.
const GOALS = [
  { id: 'strength',  title: 'Build strength', sub: 'Compound lifts. Heavy. Honest.' },
  { id: 'muscle',    title: 'Add muscle',     sub: 'Hypertrophy program, smart volume.' },
  { id: 'lose',      title: 'Lose fat',       sub: 'Recomp without losing the gains.' },
  { id: 'speed',     title: 'Run faster',     sub: 'Sharpen your pace, intervals & tempo.' },
  { id: 'endurance', title: 'Run further',    sub: 'Build distance without burning out.' },
  { id: 'mobility',  title: 'Move better',    sub: 'Mobility, flexibility, longevity.' },
];

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
// (Audit 18 #3.) Floor is 13 — COPPA's minimum for a general-audience app.
// Sourced from the payload builder so the control and the value that reaches
// the database cannot disagree about what's allowed. Everything the steps
// offer is inside the real CHECK bounds — see DB_CHECK_BOUNDS there.
const AGE_MIN = PROFILE_RANGES.age.min;
const AGE_MAX = PROFILE_RANGES.age.max;

// One threshold for "long enough to be a username", read by both the Continue
// button and the availability check. They disagreed (2 vs 3) and the gap was
// invisible until submit. Now imported from onboardingProfile.js alongside
// `canLeaveAboutStep`, which is the other half of the same rule. The
// 20-character ceiling is enforced by the field's maxLength and by
// handleUsernameChange.


/* ═══════════════════════════════════════════════════════════════
   ICON HELPER
═══════════════════════════════════════════════════════════════ */

function Icon({ name, size = 22, strokeWidth = 2.2, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'check':         return <svg {...p}><polyline points="20 6 9 17 4 12"/></svg>;
    case 'arrow-right':   return <svg {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;
    case 'arrow-left':    return <svg {...p}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>;
    default: return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   AURORA BACKGROUND
═══════════════════════════════════════════════════════════════ */

function Aurora() {
  // Deliberately nothing. This used to paint a 48px grid, three animated
  // radial-gradient blobs and a vignette behind every onboarding step —
  // five gradients moving under the content on the first screens anyone
  // sees. The background is a flat surface now; the component stays so the
  // step layout (which positions against a fixed backdrop) is untouched and
  // the decision is recorded where someone would look for it.
  return null;
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

// The bar is the ONLY progress indicator now. It used to be one of three:
// each step also carried an eyebrow ("Experience · 03") and this header
// printed "03/11" beside the bar — three renderings of one fact, in three
// type styles, above a heading that already said what the step was. Two of
// the eyebrows had even drifted out of sync with the bar, because their
// numbers were typed rather than derived, so the app disagreed with itself
// about where the user was. One bar can't drift.
//
// `step` and `total` stay: they're what fills it.
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
  // This row sits OUTSIDE each step's scroll box, so it only lines up with the
  // content below it while the two share a horizontal inset. Eight of the ten
  // scroll boxes used to carry `pe-2` — a scrollbar gutter that protects
  // nothing here (no card scales, rings or shadows, and this ships to iOS and
  // Android where scrollbars are overlays) — which pushed the coach button 8px
  // past the right edge of every card on those steps while the two boxes
  // without it were correct. The gutter is gone rather than mirrored onto this
  // row: one inset, set by the page shell, is a contract that can't drift.
  return (
    <div className="flex items-center gap-3" style={{ marginBottom: 'var(--fluid-header-gap)' }}>
      {/* No spacer when there's no Back button, unlike the coach slot below.
          The bar was centred between two 44px slots, which measures correct
          and reads wrong on the one step where the left slot is invisible:
          ~78px of empty space on the bar's left against ~12px on its right,
          so it looks shoved left even though its centre is the page centre.

          The trade-off the spacer bought was "no layout jump between steps",
          and that is still worth paying on the RIGHT — the coach button
          comes and goes mid-flow, so a bar that changed width each time
          would be a repeated twitch. Back is absent on exactly one step,
          `goal`, and it is the FIRST one: there is no previous position to
          jump from, because the user has not seen the bar anywhere else
          yet. One silent change on entry beats a permanently lopsided row. */}
      {canBack && (
        /* No backdrop-blur, and `rounded-lg` rather than `rounded-lg`.
           CLAUDE.md bans glassmorphism outright and pins the radius set to
           sm/lg/2xl/full — the carousel below already had its backdrop-filter
           removed citing that same rule, and this button (which renders on
           all ten form steps) was the last one left. Opaque `bg-card` also
           drops a composited layer that existed to blur an Aurora the button
           covers anyway. (Onboarding polish #7) */
        /* Round, per the brand direction: the back button and the CTA
           are the two controls every step shares, and both are now pills. */
        <button onClick={onBack} aria-label={tFallback('onboarding.common.back', 'Back')}
          className="w-11 h-11 rounded-full border border-border/70 bg-card flex items-center justify-center text-foreground hover:bg-card active:bg-card transition-colors shrink-0">
          <Icon name="arrow-left" size={17} strokeWidth={2.5} />
        </button>
      )}
      <ProgressSwoosh step={step} total={total} />
      {/* This slot always holds 44px, unlike the back slot above. Removing
          the "02/11" label left nothing on this side, so the bar ran flush
          to the content edge and read as running off the screen — the
          spacer is what stops that. The coach button is w-11 h-11 like the
          back button, so it drops in without shifting the bar, and steps
          with no coach content keep the same width rather than twitching
          the bar wider and narrower as the user moves through the flow. */}
      {showCoach
        ? <OnboardingCoachButton onClick={coach.open} />
        : <div className="w-11 h-11 shrink-0" aria-hidden="true" />}
    </div>
  );
}

/* The progress bar ends in the logo's swoosh: a straight run that curls up
   at its leading edge, the same stroke the welcome headline is underlined
   with. It is still ONE indicator (see the note above StepHeader), just
   drawn in the brand's own line.

   The curl cannot be a stretched SVG. The bar is `flex-1`, so its width
   changes with the phone and with whether the Back button is present, and a
   viewBox scaled to fit would squash the curve on a narrow bar and flatten it
   on a wide one. So the fill is a box animated to `step / total` of the
   width, holding a straight segment that takes whatever is left and a
   fixed 20x16 curl that never scales. `min-w-5` keeps the curl whole on step
   one of a long flow, where the fraction is narrower than the curl.

   `role="progressbar"` with the numbers, because the brand board's visible
   "Step N of M" label was deliberately NOT restored (it is the third
   rendering of one fact that the note above StepHeader removed); a screen
   reader still gets it said in words. */
function ProgressSwoosh({ step, total }) {
  const { tFallback } = useLanguage();
  const reduce = useReducedMotion();
  const pct = (n) => `${Math.max(0, Math.min(1, n / total)) * 100}%`;
  return (
    <div role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step}
      aria-valuetext={tFallback('onboarding.common.stepOf', 'Step {n} of {total}', { n: step, total })}
      className="relative flex-1 h-4">
      <div aria-hidden="true" className="absolute inset-x-0 top-2.5 h-1 rounded-full bg-border" />
      <motion.div aria-hidden="true" className="absolute start-0 top-0 h-4 min-w-5 flex"
        initial={{ width: reduce ? pct(step) : pct(step - 1) }}
        animate={{ width: pct(step) }}
        transition={{ duration: reduce ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <span className="flex-1 mt-2.5 h-1 rounded-s-full bg-primary" />
        <svg width="20" height="16" viewBox="0 0 20 16" fill="none"
          className="block shrink-0 text-primary rtl:-scale-x-100">
          <path d="M0 12H0.2C11.2 12 16.2 9.8 18 4" stroke="currentColor" strokeWidth="4"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED: KINETIC HEADING
═══════════════════════════════════════════════════════════════ */

// Every question is set in the hero style (`.font-hero`: the condensed
// display face at 800, as written, never all caps). Onboarding is the one place that voice
// lives, as a glimpse of what the app is about to be. The size is the fluid
// heading token scaled by 1.1: condensed capitals are narrower than the
// mixed-case heading face this replaced, so a question wraps to the same or fewer
// lines at 10% more size, and the step keeps its fit on a 667pt SE.
function KineticHeading({ text, accentWord }) {
  const reduce = useReducedMotion();
  const words = text.split(' ');
  // Each step mounts its own heading. The Continue button that was pressed
  // has just unmounted, so focus fell to <body> and a screen reader said
  // nothing about the new step. Move it here, unless the person is already
  // in a field.
  const headingRef = useRef(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="mb-2">
      <h1 ref={headingRef} tabIndex={-1} className="font-hero text-foreground m-0 outline-none"
        style={{ fontSize: 'calc(var(--fluid-heading) * 1.1)' }}>
        {/* A real space between the word spans, not a margin: with only a
            margin the heading's text was "Whatareyouherefor?", which is what
            screen readers and copy and paste got. */}
        {words.map((w, i) => (
          <Fragment key={i}>
            {i > 0 && ' '}
            <motion.span initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="inline-block"
              style={{ color: isAccent(w, accentWord) ? 'hsl(var(--primary))' : undefined }}>
              {w}
            </motion.span>
          </Fragment>
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
      style={{ height: 'var(--fluid-cta-h)' }}
      /* A pill with dark ink, per the brand direction. White on this orange
         measures under 3:1, so the ink is `primary-ink`, the same ink a
         picked OptionCard uses: one rule for "text on primary" across the
         flow. */
      className={`w-full rounded-full font-heading font-extrabold text-body flex items-center justify-center gap-2 transition-all
        ${disabled
          ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
          /* shadow-md, not a coloured bloom. `shadow-primary/25` threw an
             orange haze onto the background under the button, which reads as
             a gradient rather than as depth — and coloured shadows are on the
             banned list in CLAUDE.md for exactly that reason. */
          : 'bg-primary text-primary-ink hover:brightness-105 active:scale-[0.98] shadow-md'}
        ${className}`}>
      {children}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED: OPTION CARD

   The selectable row the form steps are built from: goals, experience
   levels, anything added later.

     · at rest: flat card on `--card`, hairline `--border`, no shadow
     · picked: the whole card fills with `--primary`, and everything on it
       (title, sub, glyph, pick pill) inks in `--primary-ink`

   The picked state used to be an orange hairline and an orange pill on an
   otherwise unchanged card, and at a glance six unpicked cards and six cards
   with one picked looked the same. A solid fill is the brand direction's
   answer and it is also the plainest one: the thing you chose is the thing
   that is orange. Primary is the one acting hue, and a picked answer is
   exactly what the Continue button below is about to act on.

   Still no coloured shadow and no tint wash: the fill IS the state, so
   nothing else has to carry it. Elevation stays two levels (hairline at
   rest, `shadow-md` only for things that float) and a card in a list rests.

   The card sets `color` and lets `currentColor` flow down, so `leading` and
   `trailing` should draw in currentColor (GoalIcon, the level bars, the pill
   below) rather than naming a colour. A child that hardcodes primary
   disappears into a picked card.
═══════════════════════════════════════════════════════════════ */

function OptionCard({
  selected, onClick,
  leading, title, sub, trailing, delay = 0,
}) {
  const reduce = useReducedMotion();
  return (
    <motion.button type="button" onClick={onClick} aria-pressed={selected}
      initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`relative w-full overflow-hidden flex items-center gap-2 px-4 rounded-2xl border text-start cursor-pointer transition-colors ${
        selected ? 'bg-primary border-primary text-primary-ink' : 'bg-card border-border text-foreground'}`}
      style={{ paddingBlock: 'var(--fluid-card-y)' }}>
      {leading && <span className="shrink-0 flex items-center">{leading}</span>}
      <span className="flex-1 min-w-0 block">
        <span className="block font-heading font-bold leading-tight tracking-tight"
          style={{ fontSize: 'var(--fluid-card-title)' }}>
          {title}
        </span>
        {sub && (
          <span className={`block leading-[1.45] ${selected ? 'text-primary-ink/75' : 'text-muted-foreground'}`}
            style={{ fontSize: 'var(--fluid-card-sub)' }}>
            {sub}
          </span>
        )}
      </span>
      {trailing && <span className="shrink-0 flex items-center">{trailing}</span>}
    </motion.button>
  );
}

/* The pick marker on an OptionCard: an empty ring at rest, a filled ink disc
   with the tick (or the pick ORDER on a multi-select) once chosen. Ink disc,
   primary glyph, because the card behind it is primary. */
function PickPill({ selected, order = null }) {
  return (
    <span className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors font-mono text-micro font-bold ${
      selected ? 'bg-primary-ink text-primary' : 'border-[1.5px] border-border'}`}>
      {selected && (order != null
        ? order
        : <Icon name="check" size={13} strokeWidth={3} />)}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 1: WELCOME
═══════════════════════════════════════════════════════════════ */

// The welcome screen is a photo, a headline and one button. It used to be a
// headline over an auto-rotating five-card feature carousel (FeatureCarousel,
// five animated illustrations in five hues, a pip strip, a "V 2.0" label and
// an orange radial glow behind the active card). Five selling points on the
// first screen meant none of them landed, the hues broke the four-hue rule,
// and the carousel was the flexible element the whole layout was built around.
// The brand direction replaced it with a lifter: it says what the app is for
// before a single word is read, and the copy is left to say one thing.
//
// The PHOTO does not live here. It is WelcomeBackdrop, mounted by the shell,
// because this step renders inside `.safe-page` (24px inline padding, a 420px
// cap) and inside a motion.div that carries a transform while the step
// animates, which would make any absolute layer in here jump mid-transition.
// The shell's root is the only box that is already full bleed and never moves.
//
// `dark` is set on the step root on purpose: the copy sits on a darkened
// photo in both themes, so it has to read the dark theme's tokens even when
// the app is light. It changes which values the tokens resolve to, not which
// tokens are used.
const WELCOME_PHOTO = '/onboarding/hero-front-squat.jpg';

// The headline is sized by the SMALLER of width and height. Width decides how
// many lines the sentence wraps to; height decides whether those lines leave
// room for the photo. On a 375x667 SE the height term wins (about 48px) so the
// whole block from headline down stays in the bottom half; on a 430x932 Pro Max it caps
// at 64px, which is the board's size scaled to that width.
const WELCOME_HEADLINE_SIZE = 'clamp(40px, min(15vw, calc(7.2 * var(--vhu))), 64px)';

function WelcomeBackdrop() {
  const { tFallback } = useLanguage();
  const reduce = useReducedMotion();
  return (
    <motion.div className="dark absolute inset-0 overflow-hidden bg-background"
      initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}>
      <img src={WELCOME_PHOTO}
        alt={tFallback('onboarding.welcome.photoAlt', 'A lifter front squatting in a busy gym')}
        width={780} height={1688} decoding="async"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition: '50% 30%' }} />
      {/* ONE linear scrim, and it is legibility, not decoration: the top
          stop keeps the logo and "Log in" readable over the gym ceiling
          lights, and the ramp from the middle down is what the headline and
          the button sit on. The board drew this as a flat 38% wash plus a
          separate bottom gradient; one gradient with the same stops draws
          the same picture with one layer fewer. */}
      <div aria-hidden="true" className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, hsl(var(--background) / 0.55) 0%, hsl(var(--background) / 0.3) 18%, hsl(var(--background) / 0.38) 42%, hsl(var(--background) / 0.86) 66%, hsl(var(--background)) 86%)',
        }} />
    </motion.div>
  );
}

function WelcomeStep({ onNext, onSignIn }) {
  const { tFallback } = useLanguage();
  const reduce = useReducedMotion();
  // One gentle fade for the whole bottom block. The old hero bobbed in word
  // by word, which is a lot of motion for the first frame anyone sees, and
  // it had to be skipped entirely for reduced motion anyway.
  const enter = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] } };
  return (
    <div className="dark relative flex flex-col h-full text-foreground">
      <div className="flex items-center justify-between shrink-0 h-11">
        <FlexynLogo className="h-8" />
        <button type="button" onClick={onSignIn}
          className="h-11 min-w-11 px-1 -me-1 flex items-center justify-center text-body font-semibold text-foreground hover:text-primary active:text-primary transition-colors">
          {tFallback('onboarding.welcome.logIn', 'Log in')}
        </button>
      </div>

      {/* The photo shows through this. It is the flexible element now, so
          spare height on a tall phone becomes more lifter, not more gap. */}
      <div className="flex-1 min-h-0" />

      <motion.div {...enter} className="shrink-0 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          {/* Two keys, not one sentence plus an accent WORD. The accent here
              is a two word phrase ("learns you."), which the single-token
              matcher KineticHeading uses cannot express, and in Spanish and
              French the phrase moves anyway. Each locale writes the sentence
              in two halves and the second half is orange. */}
          <h1 className="font-hero m-0" style={{ fontSize: WELCOME_HEADLINE_SIZE, lineHeight: 0.9 }}>
            {tFallback('onboarding.welcome.brandHeadline', 'Train with a plan that')}{' '}
            <span className="text-primary">{tFallback('onboarding.welcome.brandAccent', 'learns you.')}</span>
          </h1>
          {/* The swoosh: the logo's stroke, drawn as an underline that
              curls up at its end. Same curve the progress bar ends in on
              every form step, so the first screen introduces the motif the
              rest of the flow repeats. */}
          <svg viewBox="0 0 300 22" fill="none" aria-hidden="true"
            className="block w-[300px] max-w-full h-auto text-primary rtl:-scale-x-100">
            <path d="M2.5 18.5H257.5C279.5 18.5 289.5 14.8 297.5 3.5"
              stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
          </svg>
          <p className="m-0 text-body leading-normal text-foreground/85 max-w-[320px]">
            {tFallback('onboarding.welcome.brandSub', 'A few questions. A program built around your body, your week and your goal.')}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <PrimaryBtn onClick={onNext}>
            {tFallback('onboarding.welcome.buildPlan', 'Build my plan')}
            <Icon name="arrow-right" size={20} strokeWidth={2.4} />
          </PrimaryBtn>
          <p className="m-0 text-center text-label text-muted-foreground">
            {tFallback('onboarding.welcome.freeLine', 'Free. No card needed.')}
          </p>
        </div>
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

  const helper = selectedIds.length === 0
    ? tFallback('onboarding.goal.helper.none', 'Pick one or many. We tailor your plan to the combination.')
    : selectedIds.length === 1
    ? tFallback('onboarding.goal.helper.one', "Nice. Add another if you're after a few outcomes.")
    : selectedIds.length <= 3
    ? tFallback('onboarding.goal.helper.few', "Stacking {count} goals, we'll balance your plan.", { count: selectedIds.length })
    : tFallback('onboarding.goal.helper.many', 'Heads up: 4+ goals slows visible progress on each.');

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      {/* Spacing here is load-bearing, not decoration: six cards plus the
          heading came to 25px more than the box, so the last card was sliced
          mid-height right where the CTA starts — which reads as broken rather
          than as "scroll for more". The `space-y-3` between these four blocks
          was 36px of it, and the middle spacing register is banned in this
          codebase anyway; each block now carries its own `mb-2`. */}
      <div className="flex-1 overflow-y-auto pb-2">
        <KineticHeading
          text={tFallback('onboarding.goal.heading', 'What are you here for?')}
          accentWord={tFallback('onboarding.goal.accentWord', 'for')} />
        {/* min-h holds two lines so the cards don't jump as the helper text
            changes length with the number of picks. */}
        <p className="text-sm text-muted-foreground min-h-[40px] transition-all"
          style={{ marginBottom: 'var(--fluid-stack)' }}>{helper}</p>

        {/* Clear. No count beside it — the cards carry their own numbers, and
            the helper line above already says how many are stacked. The row
            collapses entirely until there's something to clear, so an
            untouched step has no empty strip above the first card. */}
        {selectedIds.length > 0 && (
          <div className="flex items-center justify-end" style={{ marginBottom: 'var(--fluid-stack)' }}>
            <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              onClick={() => onChange([])}
              /* 21.8px tall, and it clears every pick on the step. Grown to a
                 44px target with a pseudo-element rather than `min-h-11`,
                 because this step has the least room in the flow — 23.6px of
                 slack on a 667pt SE — and 22px of real height put it 6px into
                 overflow. Same technique the carousel pips use above.
                 (Onboarding polish #5) */
              className="relative font-mono text-micro font-bold text-muted-foreground tracking-widest uppercase px-2 py-1 rounded hover:text-foreground active:text-foreground transition-colors border-none bg-transparent cursor-pointer before:absolute before:content-[''] before:-inset-y-[11px] before:-inset-x-2">
              {tFallback('onboarding.goal.clear', 'Clear')}
            </motion.button>
          </div>
        )}

        {/* Goal cards */}
        <div className="flex flex-col" style={{ gap: 'var(--fluid-stack)' }}>
          {GOALS.map((g, i) => {
            const selected = selectedIds.includes(g.id);
            const order = selectedIds.indexOf(g.id) + 1;
            return (
              <OptionCard key={g.id}
                selected={selected} delay={0.05 + i * 0.07}
                onClick={() => toggle(g.id)}
                title={tFallback(`onboarding.goal.${g.id}.title`, g.title)}
                sub={tFallback(`onboarding.goal.${g.id}.sub`, g.sub)}
                leading={
                  /* The brand goal glyphs, two-tone at rest and inked with the
                     card once picked. No tile behind them: the glyph already
                     carries its own accent, and a grey square around it was a
                     second container inside the card. Sized by the same fluid
                     token the tile used, so the row height does not move. */
                  <span className="flex items-center justify-center"
                    style={{ width: 'var(--fluid-tile)', height: 'var(--fluid-tile)' }}>
                    <GoalIcon id={g.id} picked={selected} size="100%" />
                  </span>
                }
                trailing={
                  /* The order number only when several are picked; a single
                     pick is just a tick. */
                  <PickPill selected={selected} order={selectedIds.length > 1 ? order : null} />
                }
              />
            );
          })}
        </div>

      </div>

      <div className="shrink-0" style={{ paddingTop: 'var(--fluid-cta-gap)' }}>
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
// Five suggestions are a shortcut, not the menu. Anything in
// EXERCISE_LIBRARY can be picked through the search under them, because
// buildStarterRegimen matches picks by library name and drops anything else.
// Capped so the picks lead the plan without crowding out the goal's own pool.
const MAX_FOCUS_LIFTS = 5;

// English fallbacks for the Coach's own picker keys (generator.equipment.* and
// generator.duration.*), so onboarding and the Coach say the same thing.
const EQUIPMENT_LABELS = { gym: 'Full gym', dumbbells: 'Dumbbells only', minimal: 'Minimal (band, bench)', bodyweight: 'Bodyweight only' };

function searchLifts(query, exclude) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return EXERCISE_LIBRARY
    .filter(e => e.name.toLowerCase().includes(q) && !exclude.includes(e.name))
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.length - b.name.length || a.name.localeCompare(b.name);
    })
    .slice(0, 6);
}
const TIME_DISTANCES = [{ id: '1mi', label: '1 mi' }, { id: '5k', label: '5K' }, { id: '10k', label: '10K' }];

// Which distance the "recent time" is asked at, per event.
//
// This used to be its own row of three chips, sitting on screen from the
// moment the step opened and asking the user to answer a question they had
// already answered one line above. The event IS the distance — so 5K and 10K
// take their own, and the longer events fall back to a 5K benchmark, which is
// what the old picker offered anyway (it never listed half or marathon).
// Keeping the value inside that same {1mi, 5k, 10k} vocabulary matters:
// `ensureOnboardingCardioGoal` renders it straight into the goal's note.
const TIME_DISTANCE_FOR_EVENT = {
  '5k': '5k', '10k': '10k', half: '5k', marathon: '5k', general: '5k',
};

function Chip({ children, active, onClick }) {
  return (
    /* min-h-11. These measured 31.5px tall — twelve of them on one step, and
       they are the only controls the sharpen step has. (Onboarding polish #5)

       Picked is a solid primary fill with primary-ink text, the same rule as
       OptionCard. It used to take a per-section `accent`, and two sections
       passed hues of their own (a yellow for the cardio event, a second
       literal orange for the lifts), which put five colours on one step
       against a four-hue system. aria-pressed so the state is not colour
       alone. */
    <button type="button" onClick={onClick} aria-pressed={!!active}
      className={`rounded-full font-semibold transition-colors cursor-pointer px-3.5 py-1.5 min-h-11 text-label border-[1.5px] ${
        active ? 'bg-primary border-primary text-primary-ink' : 'bg-card border-border text-foreground'}`}>
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
      // h-11, not h-10: these measured 40px, and they are the only text entry
      // on the step. (Onboarding polish #5)
      className="w-16 h-11 rounded-lg border border-border bg-card text-center text-body font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40" />
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
  const focusFull = focus.length >= MAX_FOCUS_LIFTS;
  const toggleFocus = (name) => {
    if (focus.includes(name)) set({ strengthFocus: focus.filter(n => n !== name) });
    else if (!focusFull) set({ strengthFocus: [...focus, name] });
  };
  // Search stays on screen at five (Kegan, 2026-09-24): hiding it made the
  // step look like it had run out of lifts. A pick from search when full
  // replaces the most recent pick, so the newest choice always lands.
  const addFromSearch = (name) => {
    if (focus.includes(name)) return;
    set({ strengthFocus: focusFull ? [...focus.slice(0, MAX_FOCUS_LIFTS - 1), name] : [...focus, name] });
  };
  // A lift picked from search stays on the chip row, so it can be un-picked
  // the same way as a suggestion.
  const liftChips = [...FOCUS_LIFTS, ...focus.filter(n => !FOCUS_LIFTS.includes(n))];
  const [liftQuery, setLiftQuery] = useState('');
  const liftMatches = searchLifts(liftQuery, focus);

  const cur = s.cardioCurrent || {};
  const setCurrent = (patch) => {
    const nextCur = { ...cur, ...patch };
    nextCur.timeSec = (Number(nextCur.min) || 0) * 60 + (Number(nextCur.sec) || 0);
    set({ cardioCurrent: nextCur });
  };

  // Picking the event also fixes the distance the time is asked at, so the
  // user never answers "which distance?" twice.
  // A time typed for one distance means nothing at another: 25:00 for a 5K
  // read as a 10K made every pace in the plan far too fast. A new distance
  // starts the time over.
  const pickEvent = (eventId) => {
    const distance = TIME_DISTANCE_FOR_EVENT[eventId] || '5k';
    set({
      cardioEvent: eventId,
      cardioCurrent: distance === cur.distance ? cur : { distance },
    });
  };

  const timeDistance = TIME_DISTANCES.find(d => d.id === cur.distance);
  const timeDistanceLabel = timeDistance
    ? tFallback(`onboarding.sharpen.distance.${timeDistance.id}`, timeDistance.label)
    : null;


  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-2">
        <KineticHeading
          text={tFallback('onboarding.sharpen.heading', "Let's sharpen your plan.")}
          accentWord={tFallback('onboarding.sharpen.accentWord', 'sharpen')} />
        <p className="text-sm text-muted-foreground" style={{ marginBottom: 'var(--fluid-section)' }}>
          {tFallback('onboarding.sharpen.sub', 'A few quick details make your starter plan spot-on, all optional.')}
        </p>

        {/* Asked of everyone. Every plan carries strength work, even a
            runner's, and without these the plan assumed a full gym and an
            open-ended session for all of them. Tapping the picked chip
            again clears it, since the whole step is optional. */}
        <div className="space-y-2">
          <SectionLabel accent="hsl(var(--primary))" title={tFallback('onboarding.sharpen.equipmentPrompt', 'Where do you train?')} />
          <div className="flex flex-wrap gap-2">
            {TRAINING_EQUIPMENT.map(id => (
              <Chip key={id} active={s.equipment === id} onClick={() => set({ equipment: s.equipment === id ? null : id })}>
                {tFallback(`generator.equipment.${id}`, EQUIPMENT_LABELS[id])}
              </Chip>
            ))}
          </div>
        </div>

        <div className="space-y-2" style={{ marginTop: 'var(--fluid-section)' }}>
          <SectionLabel accent="hsl(var(--primary))" title={tFallback('onboarding.sharpen.minutesPrompt', 'How long is a session?')} />
          <div className="flex flex-wrap gap-2">
            {SESSION_MINUTES.map(m => (
              <Chip key={m} active={s.sessionMinutes === m} onClick={() => set({ sessionMinutes: s.sessionMinutes === m ? null : m })}>
                {tFallback(`generator.duration.${m}`, `${m} min`)}
              </Chip>
            ))}
          </div>
        </div>

        {wantsCardio && (
          <div className="space-y-2" style={{ marginTop: 'var(--fluid-section)' }}>
            <SectionLabel accent="hsl(var(--primary))" title={tFallback('onboarding.sharpen.cardioPrompt', 'What are you training for?')} />
            <div className="flex flex-wrap gap-2">
              {CARDIO_EVENTS.map(e => (
                <Chip key={e.id} active={s.cardioEvent === e.id} onClick={() => pickEvent(e.id)}>
                  {tFallback(`onboarding.sharpen.event.${e.id}`, e.label)}
                </Chip>
              ))}
            </div>

            {/* The time question is CREATED by the answer above it — there is
                nothing to ask until we know the distance, and asking anyway
                is what made this step feel like a form. It also replaces a
                bordered card nested inside this section (a surface inside a
                surface) with a hairline, and a separate 1 mi / 5K / 10K row
                that re-asked the distance the event already gave us. */}
            {s.cardioEvent && (
              <>
                <div className="h-px bg-border" role="presentation" />
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-label font-semibold">
                    {timeDistanceLabel
                      ? tFallback('onboarding.sharpen.recentTimeFor', 'Recent {distance} time?', { distance: timeDistanceLabel })
                      : tFallback('onboarding.sharpen.recentTime', 'Know a recent time?')}
                  </span>
                  <TimeInput placeholder={tFallback('onboarding.sharpen.minPlaceholder', 'min')} value={cur.min} onChange={v => setCurrent({ min: v })} />
                  <span className="text-muted-foreground font-bold">:</span>
                  <TimeInput placeholder={tFallback('onboarding.sharpen.secPlaceholder', 'sec')} value={cur.sec} onChange={v => setCurrent({ sec: v })} max={59} />
                </div>
                {/* Leaving the fields empty already IS "later", which is why
                    the button that used to say so is gone. */}
                <p className="text-micro text-muted-foreground">
                  {tFallback('onboarding.sharpen.noTimeHint', "Don't know it? Log a run in Cardio anytime and we'll dial it in.")}
                </p>
              </>
            )}
          </div>
        )}

        {wantsStrength && (
          <div className="space-y-2" style={{ marginTop: 'var(--fluid-section)' }}>
            <SectionLabel accent="hsl(var(--primary))" title={tFallback('onboarding.sharpen.liftsPrompt', 'Which lifts matter most?')} />
            <div className="flex flex-wrap gap-2">
              {liftChips.map(n => (
                <Chip key={n} active={focus.includes(n)} onClick={() => toggleFocus(n)}>{n}</Chip>
              ))}
            </div>
            <div>
                <input type="search" value={liftQuery} onChange={e => setLiftQuery(e.target.value)}
                  placeholder={tFallback('onboarding.sharpen.liftSearch', 'Add another lift')}
                  aria-label={tFallback('onboarding.sharpen.liftSearch', 'Add another lift')}
                  autoComplete="off"
                  className="w-full h-11 rounded-lg border border-border bg-card px-3 text-body focus:outline-none focus:ring-2 focus:ring-primary/40" />
                {liftQuery.trim() && (
                  <ul className="mt-1 rounded-lg border border-border bg-card divide-y divide-border">
                    {liftMatches.map(e => (
                      <li key={e.name}>
                        <button type="button" className="w-full min-h-11 px-3 text-start text-body"
                          onClick={() => { addFromSearch(e.name); setLiftQuery(''); }}>
                          {e.name}
                          <span className="ms-2 text-micro text-muted-foreground">{e.muscles.map((m) => tFallback(String(m).toLowerCase(), m)).join(', ')}</span>
                        </button>
                      </li>
                    ))}
                    {liftMatches.length === 0 && (
                      <li className="px-3 py-2 text-label text-muted-foreground">
                        {tFallback('onboarding.sharpen.liftNoMatch', 'No lift by that name yet. Try a shorter word.')}
                      </li>
                    )}
                  </ul>
                )}
            </div>
            {/* FOCUS_LIFTS are deliberately NOT translated: the picked names
                are persisted and matched by string downstream in
                buildStarterRegimen, so they have to stay stable until the
                exercise catalog itself is translated. */}
            <p className="text-micro text-muted-foreground">
              {focusFull
                ? tFallback('onboarding.sharpen.liftsFull', 'That is five. Tap one to remove it, or add another to replace your last pick.')
                : tFallback('onboarding.sharpen.liftsHint', "We'll lead your plan with the lifts you pick.")}
            </p>
          </div>
        )}

      </div>

      <div className="shrink-0" style={{ paddingTop: 'var(--fluid-cta-gap)' }}>
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
      <div className="flex-1 overflow-y-auto pb-2">
        <KineticHeading
          text={tFallback('onboarding.experience.heading', 'How long have you been training?')}
          accentWord={tFallback('onboarding.experience.accentWord', 'training')} />
        {/* Tightened for the same reason as the goal step: with the meter
            open, the fourth level card was being sliced by the CTA. */}
        <p className="text-sm text-muted-foreground mb-2">
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
        {/* `initial={false}` is what makes this step arrive in one piece.
            Without it the meter played its open animation on MOUNT — so
            walking onto the step with a level already chosen showed the card
            growing from height 0 as an EMPTY shell, and its text landed in
            two later beats inside it. Measured off a screen recording of the
            real device: bars at 1.17s, "New" at 1.41s, the description at
            1.64s. Three arrivals for one card, which is the choppiness.

            Animating `height: 0 → auto` is also the one property here that
            can't be composited — it relayouts the four option cards below on
            every frame — so not running it on arrival is worth it twice.

            AnimatePresence only suppresses children present at its OWN first
            render, so picking a level while standing on the step still
            animates the card open. Which is right: this should animate as a
            response to a choice, not as a greeting. */}
        <AnimatePresence initial={false}>
        {current && (
        <motion.div
          initial={{ opacity: 0, y: 8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          /* Four fixed pixel values used to live on this card, on the one
             step in the flow that overflowed: 40px of vertical padding, an
             80px bar chart, and two `mb-4`s that were both in the 12–20px
             spacing register CLAUDE.md bans outright. Measured on a 375x667
             SE with a level picked, the step ran 36px past the fold and
             sliced the fourth option card — the one the user had just been
             asked to choose among four.

             All four now read the fluid scale, which recovers 49px at 667
             and costs 8px at 932 where there were 169px spare. The bars keep
             their 25/45/70/100% proportions at any height, so the meter
             reads the same; it just stops demanding 80px from a screen that
             hasn't got them. (Onboarding polish #8) */
          className="rounded-2xl border bg-card px-5 relative overflow-hidden"
          style={{ paddingBlock: 'var(--fluid-section)', marginBottom: 'var(--fluid-section)' }}>
          {/* bars */}
          {/* `--fluid-section`, not `--fluid-stack`. The chart and the
              sentence explain each other, so the tight register looked
              right on paper — but a 60px graphic sitting 6.7px above a
              single line of prose reads as one blob, and it left the gap
              above the text visibly smaller than the card's own bottom
              padding, which looks like a mistake rather than a choice.
              It was tightened while this step was still 36px over; with
              the duplicated heading gone there is 43px spare and no
              reason to keep paying for it. */}
          <div className="flex items-end gap-2"
            style={{ height: 'var(--fluid-meter)', marginBottom: 'var(--fluid-section)' }}>
            {[1, 2, 3, 4].map(b => {
              const active = current ? b <= current.bars : false;
              const heights = ['25%', '45%', '70%', '100%'];
              return (
                /* No coloured shadow and no gloss gradient on the tallest
                   bar — both are banned decoration (CLAUDE.md), and the bar
                   already carries its meaning in height and fill. */
                /* `backgroundColor`, not `background`. The shorthand reads
                   back from the DOM as the full computed value ("rgba(0,0,0,0)
                   none repeat scroll 0% 0% / auto padding-box border-box"),
                   which Framer cannot interpolate — so it logged four
                   "not an animatable value" warnings on every level pick and
                   snapped the bars to their colour instead of animating them.
                   The height half of this animation worked the whole time,
                   which is why the snap read as a rendering glitch rather
                   than as a missing transition. (Onboarding polish #4) */
                <motion.div key={b} className="flex-1 rounded-t-lg relative overflow-hidden"
                  animate={{ height: heights[b - 1], backgroundColor: active ? 'hsl(var(--primary))' : 'hsl(var(--secondary))' }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} />
              );
            })}
          </div>
          {/* The level's NAME used to head this card, at `text-2xl`, and it
              was the whole problem in one line. It repeated the option card
              sitting 8px below — which the user had just tapped, and which
              carries the name, an accent border and a check — so the card's
              loudest element was the one piece of information on it the user
              could not possibly need. `text-2xl` is also not one of the six
              named type steps, and at 24px it matched `--fluid-heading`'s
              floor: a confirmation chip rendering at page-heading size,
              directly under the actual page heading.

              Removing it fixes the hierarchy by subtraction rather than by
              shrinking a duplicate, and leaves the card saying the only
              thing it ever knew that nothing else did — what this level
              means for the program. That sentence gets the card's voice now
              (`text-body`, foreground) instead of being the muted footnote
              under a headline that was telling the user their own answer.
              Same reduction this file has already made to the reveal step's
              plan title and the three-way progress indicator.

              `initial={false}` and `mode="wait"` both stay, for the reasons
              they were added: the copy must arrive WITH the card rather than
              a beat later, and two descriptions overlapping in normal flow
              would make the card briefly twice as tall. (Onboarding polish #9) */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={current?.id || 'none'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="text-body text-foreground m-0">
              {current && tFallback(`onboarding.level.${current.id}.desc`, current.desc)}
            </motion.p>
          </AnimatePresence>
        </motion.div>
        )}
        </AnimatePresence>

        {/* Level list */}
        <div className="space-y-2">
          {LEVELS.map((l, i) => {
            const selected = value === l.id;
            return (
              <OptionCard key={l.id}
                selected={selected} delay={0.15 + i * 0.05}
                onClick={() => onChange(l.id)}
                title={tFallback(`onboarding.level.${l.id}.label`, l.label)}
                sub={tFallback(`onboarding.level.${l.id}.sub`, l.sub)}
                leading={
                  /* Mini bar chart. On a picked card the lit bars take the
                     card's ink and the unlit ones a faint ink, because primary
                     bars on a primary card would draw nothing. */
                  <span className="flex items-end gap-0.5 w-10 justify-center">
                    {[1, 2, 3, 4].map(b => (
                      <span key={b} className={`block rounded-sm transition-colors ${
                        b <= l.bars
                          ? (selected ? 'bg-primary-ink' : 'bg-primary')
                          : (selected ? 'bg-primary-ink/25' : 'bg-border')}`}
                        style={{ width: 4, height: b * 5 + 4 }} />
                    ))}
                  </span>
                }
                trailing={<PickPill selected={selected} />}
              />
            );
          })}
        </div>
      </div>

      <div className="shrink-0" style={{ paddingTop: 'var(--fluid-cta-gap)' }}>
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

// Five questions in two tiers, and five is a deliberate ceiling: seven rows
// don't fit a phone, and this step ends above a pinned CTA.
//
// The tiers exist because the original four were ALL advanced benchmarks —
// published standards put most untrained men at 0-3 pull-ups and call 8+
// genuinely intermediate. A real beginner answered "not yet" four times and
// scored 0; so did someone a year into training. The instrument had no
// resolution at the end of the range where nearly every new user sits, which
// is the end that decides whether week one is achievable.
//
// FOUNDATION (push-ups, plank) is answerable by someone who trains a little,
// so it separates "never trained" from "trains a bit".
// STRENGTH (squat, pull-ups, mile) is the ceiling end.
//
// What was cut, and why it was the right two: "bench press your bodyweight"
// is an upper-body push, which 20 push-ups already reads; "25 bodyweight
// squats" is a leg endurance test sitting next to a leg strength one. Each
// removal drops a duplicate signal rather than a distinct one.
//
// Easiest first, so the step doesn't open with things the user can't do.
// Every id here must appear in starterRegimen's FOUNDATION_KEYS or
// STRENGTH_KEYS, or the answer is collected and ignored — which would make
// this step's "your AI Coach uses these" a lie.
const ASSESSMENT_QUESTIONS = [
  { id: 'pushups_20',   question: '20 push-ups in a row' },
  { id: 'plank_60s',    question: 'A 60-second plank' },
  { id: 'squat_bw15',   question: 'Squat 1.5× your bodyweight' },
  { id: 'pullups_10',   question: '10 strict pull-ups in a row' },
  { id: 'mile_under10', question: 'A mile under 10 minutes' },
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
  // Never BLOCK on an incomplete answer set — the whole step is optional.
  // The skip button below stays visible until all five are answered, so the
  // user always has a way past without inventing answers.
  const answeredCount = ASSESSMENT_QUESTIONS.filter(q => !!answers[q.id]).length;
  const allAnswered = answeredCount === ASSESSMENT_QUESTIONS.length;

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-2">
        <KineticHeading
          text={tFallback('onboarding.assessment.heading', 'Quick Lift Check')}
          accentWord={tFallback('onboarding.assessment.accentWord', 'Lift')}
        />
        <p className="text-sm text-muted-foreground" style={{ marginBottom: 'var(--fluid-section)' }}>
          {tFallback('onboarding.assessment.sub', 'Optional. The more honest you are, the better the plan. Your AI Coach uses these to set starting volume.')}
        </p>

        {/* One row per question. The answer is binary, so it doesn't need a
            card holding a question above two full-width buttons — it needs a
            statement and a two-segment control. That layout ran 146px past
            the bottom of the screen, the worst overflow of any step; this
            one fits with room. The answered row carries the answer's hue in
            its border, and the chosen chip in border and label — the same
            budget the goal cards settled on, no fills. */}
        <div className="flex flex-col" style={{ gap: 'var(--fluid-stack)' }}>
          {ASSESSMENT_QUESTIONS.map((q, qi) => {
            const answer = ASSESSMENT_ANSWERS.find(a => a.id === answers[q.id]);
            return (
              <motion.div
                key={q.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + qi * 0.06, duration: 0.4 }}
                className="flex items-center gap-2 rounded-2xl border bg-card px-4 transition-colors"
                style={{ paddingBlock: 'var(--fluid-card-y)',
                  borderColor: answer ? answer.hue : 'hsl(var(--border))' }}
              >
                <p className="flex-1 min-w-0 font-heading font-semibold text-label leading-tight text-foreground">
                  {tFallback(`onboarding.assessment.q.${q.id}`, q.question)}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  {ASSESSMENT_ANSWERS.map(a => {
                    const selected = answers[q.id] === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setAnswer(q.id, a.id)}
                        aria-pressed={selected}
                        className="min-h-11 px-3 rounded-full border text-caption font-semibold transition-colors"
                        style={{
                          borderColor: selected ? a.hue : 'hsl(var(--border))',
                          color:       selected ? a.hue : 'hsl(var(--muted-foreground))',
                        }}
                      >
                        {tFallback(`onboarding.assessment.answer.${a.id}`, a.label)}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>

      </div>

      <div className="shrink-0 flex flex-col gap-2" style={{ paddingTop: 'var(--fluid-cta-gap)' }}>
        <PrimaryBtn onClick={onNext}>
          {/* Same reason as the schedule step: this is form step 8 of 10,
              with injuries, home gym, the build and the reveal still to
              come — so the CTA says Continue, not something terminal. */}
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
            {tFallback('onboarding.assessment.skip', 'Skip the lift check')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DRAG HOOK — used by Age, Height, Weight steps
═══════════════════════════════════════════════════════════════ */
function useDragValue({ value, onChange, min, max, axis = 'x', pxPerUnit = 14, step: stepSize = 1, invert = false }) {
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
    // Default: up (or left) raises the value. `invert` is for a tape whose
    // larger values sit ABOVE the centre, where the tape follows the finger,
    // so pulling it down brings the taller marks to the line.
    const delta = Math.round((invert ? 1 : -1) * (pos - drag.current.start) / pxPerUnit) * stepSize;
    const next = Math.min(max, Math.max(min, drag.current.startVal + delta));
    onChangeRef.current(next);
    if (navigator.vibrate) navigator.vibrate(1);
  }, [axis, pxPerUnit, stepSize, min, max, invert]);

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

/* ── Pill unit toggle (ft·in / cm, lb / kg) ── */
function PillUnitToggle({ options, value, onChange }) {
  // Two full-width segments, the same control the sex row and the goal cards
  // use: hairline border, accent on the border and the label, no fill. It was
  // a compact pill with a filled active segment and a coloured drop shadow —
  // a third selection idiom on a flow that now has one.
  return (
    <div className="flex w-full" style={{ gap: 'var(--fluid-stack)' }}>
      {options.map(o => {
        const active = value === o.id;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)}
            aria-pressed={active}
            className="flex-1 min-h-11 rounded-lg border text-label font-semibold transition-colors"
            style={{
              borderColor: active ? 'hsl(var(--primary))' : 'hsl(var(--border))',
              background: 'hsl(var(--card))',
              color: active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
            }}>
            {o.label}
          </button>
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
   STEP: AGE — horizontal drag wheel
═══════════════════════════════════════════════════════════════ */
function AgeStep({ stats, onChange, username, onUsernameChange, usernameError, usernameChecking = false, onNext, onBack, step, total }) {
  const { tFallback } = useLanguage();
  const age = stats.age;
  // Same sticky flag as the weight step: an untouched 26 is the default,
  // not the user's age, and must not be saved as if it were.
  const setAge = (v) => onChange({ ...stats, age: v, userTouchedAge: true });
  const gender = stats.gender || null;
  const setGender = (g) => onChange({ ...stats, gender: g });
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

  // All three answers on this step are required. Sex was not, so the buttons
  // could be left untouched and Continue still went through — and because an
  // unset value silently takes the conservative middle in _demographicScale
  // and BMR, nobody ever saw a consequence; they just got a plan calibrated on
  // a guess. Declining is one of the three options, so this asks for a choice,
  // not a disclosure.
  // And not while the availability check is still out: a quick Continue used
  // to beat it, so a taken name surfaced only at the final save, which sent
  // the person from the reveal all the way back here.
  const canNext = canLeaveAboutStep({ username, usernameError, gender }) && !usernameChecking;

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4">
        <KineticHeading
          text={tFallback('onboarding.about.heading', 'Tell us about yourself.')}
          accentWord={tFallback('onboarding.about.accentWord', 'yourself')} />
        {/* mb-5 was 20px flat, which is both in the banned 12–20px register
            and the wrong axis: it cost a 667pt screen exactly what it cost a
            932pt one, on the step with the least room to spare. */}
        <p className="text-sm text-muted-foreground mt-2"
          style={{ marginBottom: 'var(--fluid-section)' }}>
          {tFallback('onboarding.about.sub', 'We use this to calibrate your plan. Encrypted, never sold.')}
        </p>

        {/* Username */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          style={{ marginBottom: 'var(--fluid-section)' }}>
          <label htmlFor="onboarding-username" className="block font-mono text-micro font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">
            {tFallback('onboarding.about.usernamePrompt', 'What should we call you?')}
          </label>
          <input
            id="onboarding-username"
            type="text"
            value={username}
            aria-invalid={usernameError ? true : undefined}
            aria-describedby={usernameError || stripWarning ? 'onboarding-username-note' : undefined}
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
            className="w-full h-12 rounded-lg border border-border bg-secondary/50 px-4 font-mono text-base font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
          />
          {usernameError && <p id="onboarding-username-note" role="alert" className="text-xs text-destructive mt-1">{usernameError}</p>}
          {!usernameError && stripWarning && (
            <p id="onboarding-username-note" className="text-xs text-muted-foreground mt-1">
              {tFallback('onboarding.about.usernameStripped', 'Letters, numbers and underscores only, capitals are auto-lowered.')}
            </p>
          )}
        </motion.div>

        {/* Age drag section */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          className="relative">
          <div className="font-mono text-micro font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2 text-center">
            {tFallback('onboarding.about.agePrompt', 'How old are you?')}
          </div>

          {/* Hero number — tap to type a value directly */}
          <div className="flex flex-col items-center" style={{ marginBottom: 'var(--fluid-stack)' }}>
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
                // `--fluid-hero`, the same size the number renders at when it
                // is NOT being edited. It was a fixed 96px against a display
                // value that clamps 48→84px, so tapping the number to type
                // grew it by 80% on a 667pt SE (53.4px → 96px) and by 14% on a
                // Pro Max — the control jumped the moment you touched it, by a
                // different amount on every phone. (Onboarding polish #6)
                style={{ width: 180, fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 'var(--fluid-hero)', lineHeight: 0.9, letterSpacing: '-0.06em', textAlign: 'center', background: 'transparent', border: 'none', borderBottom: '3px solid hsl(var(--primary))', color: 'hsl(var(--foreground))', outline: 'none', padding: 0 }}
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
                  fontSize: 'var(--fluid-hero)', lineHeight: 0.9, letterSpacing: '-0.03em',
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
                {tFallback('onboarding.about.ageHint', 'TAP TO TYPE OR DRAG')}
              </button>
            )}

            {/* The life-stage chip used to sit here — a pill reading e.g.
                "PRIME · Strength peaks here for most lifters. Push hard.",
                keyed to six age bands. It was 42px on a step that had 9px to
                spare before the sex question needed a second row, and it is
                the one thing here the user did not ask for and cannot act on:
                the plan already adapts to age through _demographicScale's
                ageFactor, and the chip only narrated that. Removed rather
                than shrunk — a smaller version costs the same argument at a
                worse size. */}
          </div>

          {/* Horizontal ruler scrubber */}
          <div
            ref={ref}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              position: 'relative', height: 'var(--fluid-scrubber)', overflow: 'hidden',
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
                        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                        color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                      }}>{v}</span>
                    )}
                  </span>
                );
              })}
            </div>
            {/* Center hairline */}
            <div style={{ position: 'absolute', left: '50%', top: 8, bottom: 8, width: 2, marginLeft: -1, background: 'hsl(var(--primary))', borderRadius: 1, pointerEvents: 'none' }} />
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
        </motion.div>

        {/* Sex — calibrates strength targets, training volume, and calories.
            The whole app already reads this; it just never asked before. */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}
          style={{ marginTop: 'var(--fluid-section)' }}>
          {/* "Sex assigned at birth" rather than "Sex" or "Gender": this value
              feeds BMR and the strength multipliers in _demographicScale, so
              the honest question is the physiological one. The two-step
              standard (sex at birth + gender identity) is what health research
              uses, but the second step earns its place only when something
              reads it — nothing here does, so asking it would be collecting
              data for nothing. "Prefer not to say" replaces "Other", which as
              a sex option told the calculator nothing anyway; both land on the
              same conservative middle value. */}
          <div className="font-mono text-micro font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">
            {tFallback('onboarding.about.sexPrompt', 'What sex were you assigned at birth?')}
          </div>
          {/* Four options, because "Other" and "Prefer not to say" are not the
              same answer. "Other" is a statement about the user's sex; "Prefer
              not to say" is a refusal to make one. Collapsing them — which
              this step did, offering three and labelling the third one or the
              other depending on which key won — makes someone who simply
              doesn't want to answer pick a category that describes them.
              That matters more now the question is required.

              They compute identically and are meant to: every consumer
              branches on 'male'/'female' by name and lets everything else fall
              to the conservative middle (_demographicScale 0.75/0.85,
              mifflinStJeor base−78, activityEmoji's neutral figure). The
              distinction is kept in the DATA, not in the maths, so it is there
              if anything ever wants to report on it honestly.

              `user_profiles.gender` is plain TEXT with no CHECK — verified
              against the installed column, not the migration — so the fourth
              value needs no schema change.

              Labels come straight from `o.label`. They used to be looked up
              again as `onboarding.about.sex.${o.id}` with `o.label` as the
              fallback, and that key set still existed, so `sex.other` won and
              the third button rendered "Other" no matter what the code said.
              A fallback only fires when the key is missing; that one wasn't. */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'female',            label: tFallback('onboarding.about.sexFemale', 'Female') },
              { id: 'male',              label: tFallback('onboarding.about.sexMale', 'Male') },
              { id: 'other',             label: tFallback('onboarding.about.sexOther', 'Other') },
              { id: 'prefer_not_to_say', label: tFallback('onboarding.about.sexSkip', 'Prefer not to say') },
            ].map(o => {
              const active = gender === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setGender(o.id)}
                  aria-pressed={gender === o.id}
                  className="min-h-11 px-2 py-2 rounded-lg border text-caption font-semibold leading-tight transition-colors"
                  style={{
                    borderColor: active ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                    background: active ? 'hsl(var(--primary) / 0.12)' : 'transparent',
                    color: active ? 'hsl(var(--primary))' : 'hsl(var(--foreground))',
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </motion.div>
      </div>
      <div className="shrink-0" style={{ paddingTop: 'var(--fluid-cta-gap)' }}>
        <PrimaryBtn onClick={onNext} disabled={!canNext}>
          {/* The blocker is a username field several hundred pixels up the
              page, so a bare disabled "Continue" gave the user nothing to
              act on — they could see it was dead and not why. */}
          {!canNext
            ? (usernameChecking && !usernameError && username.trim().length >= MIN_USERNAME_LENGTH && gender
                ? tFallback('onboarding.about.ctaCheckingUsername', 'Checking username')
                : usernameError
                ? tFallback('onboarding.about.ctaBadUsername', 'Pick a different username')
                : username.trim().length < MIN_USERNAME_LENGTH
                  ? tFallback('onboarding.about.ctaNoUsername', 'Choose a username to continue')
                  : tFallback('onboarding.about.ctaNoSex', 'Answer the sex question to continue'))
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
    // setValue keeps both units in step, so switching only changes which one
    // is shown. Rebuilding cm from rounded inches lost a centimetre on every
    // round trip (171 came back as 170).
    if (u === 'cm') onChange({ ...stats, heightUnit: 'cm', heightCm: stats.heightCm ?? cmFromIn(stats.heightIn) });
    else onChange({ ...stats, heightUnit: 'in', heightIn: stats.heightIn ?? inFromCm(stats.heightCm) });
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
    ? onChange({ ...stats, heightCm: v, heightIn: inFromCm(v), userTouchedHeight: true })
    : onChange({ ...stats, heightIn: v, heightCm: cmFromIn(v), userTouchedHeight: true });

  const { ref, onPointerDown, onPointerMove, onPointerUp, isDragging } = useDragValue({ value, onChange: setValue, min: range[0], max: range[1], axis: 'y', pxPerUnit: PX, invert: true });

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
  // Taller is up: a tick sits at -v * PX, so the tape reads like a wall
  // chart instead of counting downward.
  const offsetY = value * PX + trackH / 2;

  const displaySecondary = unit === 'cm' ? `${Math.floor(inFromCm(value) / 12)}'${inFromCm(value) % 12}"` : `${cmFromIn(value)} cm`;
  // One scale for the figure AND the reference lines, in inches from the
  // floor: 8 ft fills 90% of the panel. They used to be sized two different
  // ways (the lines against the input range, the figure against a 4 to 7 ft
  // window), so a 5'10" figure's head stood above the 6'0" line.
  const valueIn = unit === 'cm' ? value / 2.54 : value;
  const panelPct = (inches) => Math.max(0, Math.min(90, (inches / 96) * 90));
  const silhouetteH = panelPct(valueIn);

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
        <KineticHeading
          text={tFallback('onboarding.height.heading', 'How tall are you?')}
          accentWord={tFallback('onboarding.height.accentWord', 'tall')} />
        <div style={{ height: 'var(--fluid-stack)' }} />
        <div style={{ marginBottom: 'var(--fluid-section)' }}>
          <PillUnitToggle
            options={[
              { id: 'in', label: tFallback('onboarding.height.unitImperial', 'ft·in') },
              { id: 'cm', label: tFallback('onboarding.height.unitMetric', 'cm') },
            ]}
            value={unit} onChange={setUnit} />
        </div>

            <div className="text-center" style={{ marginBottom: 'var(--fluid-section)' }}>
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
                // `--fluid-hero`, matching the display value above it. This
                // was a fixed 32px against a 48→84px display, so tapping to
                // type SHRANK the number by 40%. Age had the same mismatch in
                // the opposite direction. (Onboarding polish #6)
                style={{ width: '100%', fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 'var(--fluid-hero)', lineHeight: 1, textAlign: 'center', background: 'transparent', border: 'none', borderBottom: '2px solid hsl(var(--primary))', color: 'hsl(var(--foreground))', outline: 'none', padding: 0 }}
              />
            ) : (
              <button
                type="button"
                onClick={handleHeightTap}
                aria-label={tFallback('onboarding.height.tapAria', 'Tap to type your height')}
                // minHeight 44 — the number IS the tap-to-type target, and
                // the hint under it says so, but it measured 38px.
                style={{ background: 'none', border: 'none', cursor: 'text', padding: 0, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <div style={{ fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 'var(--fluid-hero)', lineHeight: 1, letterSpacing: '-0.04em', color: 'hsl(var(--foreground))', transform: isDragging ? 'scale(0.97)' : 'scale(1)', transition: 'transform 0.15s' }}>
                  {unit === 'cm' ? value : `${Math.floor(value/12)}'${value%12}"`}
                </div>
              </button>
            )}
            <div className="font-mono text-micro font-semibold tracking-widest uppercase text-muted-foreground mt-2">
              {unit === 'cm'
                ? tFallback('onboarding.height.tapHintMetric', 'CM · TAP TO TYPE')
                : tFallback('onboarding.height.tapHintImperial', 'FT · IN · TAP TO TYPE')}
            </div>
            <div className="font-mono text-micro text-muted-foreground/70 mt-1">≈ {displaySecondary}</div>
            {heightHint && (
              <p className="text-micro text-primary mt-1 leading-snug">
                {unit === 'cm'
                  ? tFallback('onboarding.height.hintMetric', "Enter centimetres. E.g. 178. Switch to ft·in above if that's what you meant.")
                  : tFallback('onboarding.height.hintImperial', "Enter feet and inches. E.g. 5'10 or 511. Switch to cm above if that's what you meant.")}
              </p>
            )}
          </div>
        <div style={{ display: 'flex', gap: 8, height: 'var(--fluid-panel)' }}>
          {/* Silhouette panel */}
          <div style={{
            flex: 1, position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            background: 'hsl(var(--card))',
            borderRadius: 16, overflow: 'hidden', border: '1px solid hsl(var(--border))',
          }}>
            {/* Reference lines — labels are unit-aware so cm-mode users
                aren't asked to mentally convert 6'0" → 183 cm.
                (Onboarding screenshot feedback, 2026-06.) */}
            {[
              { cm: 183, in: 72, cmLabel: '183 cm', inLabel: "6'0\"" },
              { cm: 168, in: 66, cmLabel: '168 cm', inLabel: "5'6\"" },
              { cm: 152, in: 60, cmLabel: '152 cm', inLabel: "5'0\"" },
            ].map(m => {
              const label = unit === 'cm' ? m.cmLabel : m.inLabel;
              return (
                <div key={label} style={{ position: 'absolute', left: 8, right: 8, bottom: `${panelPct(m.in)}%`, height: 1, background: 'hsl(var(--muted-foreground) / 0.18)' }}>
                  <span style={{ position: 'absolute', left: 4, top: -14, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'hsl(var(--muted-foreground) / 0.6)' }}>{label}</span>
                </div>
              );
            })}
            {/* Silhouette */}
            {/* viewBox cropped to the figure (head top y=8, feet y=230), so
                the SVG's height IS the person's height on the panel. */}
            <svg viewBox="0 8 100 222" preserveAspectRatio="xMidYMax meet"
              style={{ width: '74%', height: `${silhouetteH}%`, transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.34,1.56,0.64,1)', position: 'relative', zIndex: 2 }}>
              <circle cx="50" cy="20" r="12" fill="hsl(var(--primary))" />
              <rect x="46" y="30" width="8" height="6" fill="hsl(var(--primary))" />
              <path d="M30 36 Q30 45,32 60 L32 130 Q32 138,35 140 L65 140 Q68 138,68 130 L68 60 Q70 45,70 36 Z" fill="hsl(var(--primary))" />
              <rect x="20" y="38" width="10" height="78" rx="5" fill="hsl(var(--primary))" />
              <rect x="70" y="38" width="10" height="78" rx="5" fill="hsl(var(--primary))" />
              <rect x="34" y="138" width="13" height="92" rx="5" fill="hsl(var(--primary))" />
              <rect x="53" y="138" width="13" height="92" rx="5" fill="hsl(var(--primary))" />
            </svg>
          </div>

          {/* Ruler */}
          <div style={{ width: 84, display: 'flex', flexDirection: 'column' }}>
            {/* Ruler */}
            <div ref={ref} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              style={{ flex: 1, position: 'relative', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 16, overflow: 'hidden' }}>
              {/* Three layers, and the order matters. The card and its border
                  are the OUTER element, so they stay crisp. The fade is this
                  middle layer, whose box is the visible ruler. The transform
                  is the inner one — putting the mask there instead masks a box
                  the ticks don't sit in (they're positioned at `value * PX`,
                  hundreds of px outside it), and every tick disappears. */}
              <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', maskImage: 'linear-gradient(180deg, transparent, black 15%, black 85%, transparent)', WebkitMaskImage: 'linear-gradient(180deg, transparent, black 15%, black 85%, transparent)' }}>
              <div style={{ position: 'absolute', inset: 0, transform: `translateY(${offsetY}px)`, transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.16,1,0.3,1)' }}>
                {ticks.map(v => {
                  const isMajor = unit === 'cm' ? v % 10 === 0 : v % 12 === 0;
                  const isMid = unit === 'cm' ? v % 5 === 0 : v % 6 === 0;
                  const isActive = v === value;
                  return (
                    <span key={v}>
                      <span style={{ position: 'absolute', top: -v * PX, left: '50%', transform: 'translate(-50%,-50%)', width: isMajor ? 28 : isMid ? 18 : 10, height: 1.5, background: isActive ? 'hsl(var(--primary))' : isMajor ? 'hsl(var(--foreground)/0.5)' : 'hsl(var(--muted-foreground)/0.3)', borderRadius: 1 }} />
                      {isMajor && <span style={{ position: 'absolute', top: -v * PX, left: '50%', marginLeft: 16, transform: 'translateY(-50%)', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}>{unit === 'cm' ? v : `${Math.floor(v/12)}'`}</span>}
                    </span>
                  );
                })}
              </div>
              </div>
              {/* Center line — outside the fade, so it stays solid. */}
              <div style={{ position: 'absolute', left: 8, right: 8, top: '50%', height: 2, marginTop: -1, background: 'hsl(var(--primary))', borderRadius: 1, pointerEvents: 'none' }} />
            </div>
          </div>
        </div>
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
// The bar is loaded in the unit on screen. It was always built from kilos
// (20 kg bar, 25/20/15 kg bumpers), so 165 lb showed a 25 and a 2.5 that added
// up to 75, which a lb lifter reads as a bar that doesn't match their number.
// Colours follow each unit's bumper code. The printed numbers are gone: at
// 7px they were unreadable, and the plate sizes already carry the weight.
const PLATE_SETS = {
  kg: { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], colors: { 25: 'hsl(0 75% 50%)', 20: 'hsl(217 80% 50%)', 15: 'hsl(50 90% 55%)', 10: 'hsl(160 60% 42%)', 5: 'hsl(0 0% 90%)', 2.5: 'hsl(0 0% 30%)', 1.25: 'hsl(0 0% 55%)' }, toKg: 1 },
  lb: { bar: 45, plates: [55, 45, 35, 25, 10, 5, 2.5], colors: { 55: 'hsl(0 75% 50%)', 45: 'hsl(217 80% 50%)', 35: 'hsl(50 90% 55%)', 25: 'hsl(160 60% 42%)', 10: 'hsl(0 0% 90%)', 5: 'hsl(0 0% 30%)', 2.5: 'hsl(0 0% 55%)' }, toKg: 0.4536 },
};

function WeightPlate({ kg, color, delay }) {
  const h = 24 + Math.min(kg, 25) * 1.4;
  const w = 7 + Math.min(kg, 25) * 0.18;
  return (
    <div style={{ width: w, height: h, marginRight: 1, background: color, borderRadius: 3, animation: `spring-in 0.35s ${delay}s cubic-bezier(0.34,1.56,0.64,1) both`, flexShrink: 0 }} />
  );
}

function loadBar(weight, unit) {
  const set = PLATE_SETS[unit] || PLATE_SETS.kg;
  const result = []; let rem = Math.max(0, (weight - set.bar) / 2);
  for (const p of set.plates) { while (rem >= p - 0.001) { result.push(p); rem -= p; } }
  return result.slice(0, 6);
}

function BarbellVisualizer({ weight, unit }) {
  const set = PLATE_SETS[unit] || PLATE_SETS.kg;
  const plates = useMemo(() => loadBar(weight, unit), [weight, unit]);
  const plate = (side) => (p, i) => (
    <WeightPlate key={`${side}${i}-${p}`} kg={p * set.toKg} color={set.colors[p]} delay={i * 0.04} />
  );

  return (
    <div className="flex items-center justify-center" style={{ height: 56, marginTop: 8 }} aria-hidden="true">
      <div className="flex items-center" style={{ flexDirection: 'row-reverse' }}>
        {plates.map(plate('l'))}
      </div>
      <div style={{ width: 100, height: 6, background: 'hsl(0 0% 68%)', borderRadius: 3 }} />
      <div className="flex items-center">
        {plates.map(plate('r'))}
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
    // setValue keeps both units in step; switching only changes which one
    // is shown, so a round trip cannot drift by a pound.
    if (u === 'kg') onChange({ ...stats, weightUnit: 'kg', weightKg: stats.weightKg ?? kgFromLb(stats.weightLb) });
    else onChange({ ...stats, weightUnit: 'lb', weightLb: stats.weightLb ?? lbFromKg(stats.weightKg) });
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
  const onGaugeKey = (e) => {
    if (editingWeight) return;
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (step) {
      e.preventDefault();
      setValue(Math.min(range[1], Math.max(range[0], value + step)));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleWeightTap();
    }
  };

  const pct = (value - range[0]) / (range[1] - range[0]);
  const circumference = 2 * Math.PI * 82;
  const dash = pct * circumference;

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
            text={tFallback('onboarding.weight.heading', 'How much do you weigh?')}
            accentWord={tFallback('onboarding.weight.accentWord', 'weigh')} />
        </div>
        <div className="mb-4">
          <PillUnitToggle options={[{id:'lb',label:'lb'},{id:'kg',label:'kg'}]} value={unit} onChange={setUnit} />
        </div>

        {/* Circular gauge — draggable dial (vertical drag sets weight, tap to type) */}
        {/* A slider to assistive tech and the keyboard. Drag was the only
            way in, so anyone without a pointer was stuck on 165 lb. */}
        <div ref={ref} onPointerDown={onGaugeDown} onPointerMove={onGaugeMove} onPointerUp={onGaugeUp} onPointerCancel={onGaugeCancel}
          role="slider" tabIndex={editingWeight ? -1 : 0}
          aria-label={unit === 'kg'
            ? tFallback('onboarding.weight.ariaKg', 'Weight in kilograms')
            : tFallback('onboarding.weight.ariaLb', 'Weight in pounds')}
          aria-valuemin={range[0]} aria-valuemax={range[1]} aria-valuenow={value}
          onKeyDown={onGaugeKey}
          className="flex flex-col items-center select-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          style={{ position: 'relative', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}>
          <svg width="220" height="220" viewBox="0 0 200 200" style={{ position: 'relative' }}>
            <circle cx="100" cy="100" r="82" fill="none" stroke="hsl(var(--muted-foreground) / 0.12)" strokeWidth="3" />
            {Array.from({ length: 60 }).map((_, i) => {
              const angle = -90 + i * 6; const isMajor = i % 5 === 0;
              const r1 = isMajor ? 68 : 74; const r2 = 79;
              return <line key={i} x1={100 + Math.cos(angle * Math.PI/180) * r1} y1={100 + Math.sin(angle * Math.PI/180) * r1} x2={100 + Math.cos(angle * Math.PI/180) * r2} y2={100 + Math.sin(angle * Math.PI/180) * r2} stroke="hsl(var(--muted-foreground) / 0.35)" strokeWidth={isMajor ? 1.5 : 0.8} strokeLinecap="round" />;
            })}
            <circle cx="100" cy="100" r="82" fill="none" stroke="hsl(var(--primary))" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${dash} ${circumference}`} transform="rotate(-90 100 100)" style={{ transition: isDragging ? 'none' : 'stroke-dasharray 0.25s cubic-bezier(0.16,1,0.3,1)' }} />
            <circle cx={100 + Math.cos((-90 + pct * 360) * Math.PI/180) * 82} cy={100 + Math.sin((-90 + pct * 360) * Math.PI/180) * 82} r="5" fill="hsl(var(--primary))" style={{ transition: isDragging ? 'none' : 'all 0.25s cubic-bezier(0.16,1,0.3,1)' }} />
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
                style={{ width: 130, fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 'var(--fluid-hero)', lineHeight: 1, textAlign: 'center', background: 'transparent', border: 'none', borderBottom: '2px solid hsl(var(--primary))', color: 'hsl(var(--foreground))', outline: 'none' }}
              />
            ) : (
              // Not a <button>: the gauge captures pointer events, so its own
              // tap-vs-drag handler opens type mode. Tapping here bubbles up.
              // `--fluid-hero` — "the one big number on a step", per its
              // definition in index.css. Age and height already read it;
              // weight was a fixed 64px display against a fixed 48px editing
              // input, so it was both inconsistent with its two neighbours
              // AND resized on tap like they did. All three now hold still.
              // (Onboarding polish #6)
              <div style={{ fontFamily: 'var(--font-heading, sans-serif)', fontWeight: 800, fontSize: 'var(--fluid-hero)', lineHeight: 0.9, letterSpacing: '-0.05em', color: 'hsl(var(--foreground))', transform: isDragging ? 'scale(0.96)' : 'scale(1)', transition: 'transform 0.15s' }}>
                <NumberReel value={value} />
              </div>
            )}
            <div className="font-mono text-micro font-bold tracking-[0.3em] uppercase text-primary mt-1">{unit === 'kg' ? tFallback('onboarding.weight.unitKg', 'KG') : tFallback('onboarding.weight.unitLb', 'LBS')}</div>
            <div className="font-mono text-micro text-muted-foreground mt-1">≈ {unit === 'kg' ? `${lbFromKg(value)} lb` : `${kgFromLb(value)} kg`}</div>
          </div>
        </div>

        {/* Barbell */}
        <BarbellVisualizer weight={value} unit={unit === 'kg' ? 'kg' : 'lb'} />

        {/* Dial hint — the gauge above is the input: drag it up/down to set,
            tap the number to type. Replaces the old horizontal scrubber. */}
        <div className="flex items-center justify-center gap-1.5 mt-3 mb-1" aria-hidden="true">
          <span className="font-mono text-micro font-semibold tracking-[0.18em] uppercase text-muted-foreground/80">
            {tFallback('onboarding.weight.dialHint', 'Tap to type · drag to set')}
          </span>
        </div>

      </div>
      <div className="shrink-0" style={{ paddingTop: 'var(--fluid-cta-gap)' }}>
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
      <div className="flex-1 overflow-y-auto pb-4 space-y-5">
        <KineticHeading
          text={tFallback('onboarding.schedule.heading', 'Which days can you train?')}
          accentWord={tFallback('onboarding.schedule.accentWord', 'train')} />
        <p className="text-sm text-muted-foreground mt-2">
          {tFallback('onboarding.schedule.sub', "Plan around real life. We'll keep recovery in check.")}
        </p>

        {/* Count card.
            Three things used to fire on every tap and fight each other.

            The card used to carry an orange radial glow that brightened
            with `count`. A decorative gradient is on the house list of
            generated-UI tells (Kegan, 2026-09-30), so it is gone. The card
            answers a pick with its border instead, which moves to the
            primary hue once a day is chosen.

            The number carried `key={count}` with `opacity: 0` in its
            initial and no AnimatePresence, so the old digit was removed
            the instant the new one mounted: a blank frame, then a fade.
            It keeps the key (remounting one glyph is cheap) but enters at
            full opacity, so only the scale moves and there is nothing to
            flicker.

            And the scale used Framer's default, which for scale is a
            SPRING — 0.7 to 1 overshoots and settles over ~0.5s. That
            bounce, landing on top of a repainting background, is the
            stutter. A short tween lands it in 180ms and stops. */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border bg-card p-5 text-center relative overflow-hidden transition-colors duration-200"
          style={{ borderColor: count > 0 ? 'hsl(var(--primary) / 0.5)' : 'hsl(var(--border))' }}>
          <div className="relative flex items-baseline justify-center gap-2">
            <motion.span key={count}
              initial={{ scale: 0.88, opacity: 1 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="font-heading font-bold text-[52px] leading-none tracking-tight text-foreground">
              {count}
            </motion.span>
            <span className="font-heading font-semibold text-xl text-muted-foreground">
              {tFallback('onboarding.schedule.daysPerWeek', 'days · week')}
            </span>
          </div>
          {/* Keyed on the INTENSITY, not the count: it only changes at
              thresholds, so tapping a fourth day shouldn't flicker a
              label that still reads "Balanced". Enters at full opacity
              for the same reason the digit does. */}
          <motion.div key={intensity}
            initial={{ opacity: 1, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative font-mono text-micro font-bold tracking-[0.18em] uppercase text-primary mt-1">
            {intensityLabel}
          </motion.div>
        </motion.div>

        {/* Day grid */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          className="grid grid-cols-7 gap-0.5">
          {WEEKDAY_SEED.map((seed, i) => {
            const selected = days.includes(i);
            const label = fmtDate(seed, { weekday: 'short', timeZone: 'UTC' });
            return (
              <button key={i} type="button" aria-pressed={selected} onClick={() => toggle(i)}
                // min-h-11 + the tighter grid gap above lifts these from
                // 39x50 to >=44 wide. Seven adjacent targets where a mis-tap
                // silently selects a DIFFERENT day is the worst hit-target
                // risk in onboarding — a miss here is wrong, not just missed.
                className="flex flex-col items-center justify-center gap-1 min-h-11 py-2.5 rounded-lg border cursor-pointer transition-all font-medium"
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
                <button key={t.id} type="button" aria-pressed={active} onClick={() => toggleTime(t.id)}
                  className="py-3 rounded-lg border text-sm font-medium cursor-pointer transition-all"
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

      <div className="shrink-0" style={{ paddingTop: 'var(--fluid-cta-gap)' }}>
        {/* Was "Build my plan" — on form step 7 of 10, with injuries, home
            gym and the reveal still to come. A terminal-sounding CTA that isn't
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
/* ═══════════════════════════════════════════════════════════════
   STEP V2-B: INJURY HISTORY (optional)
   Quick injury log so the starter regimen can exclude affected
   muscle groups from day one. Mirrors the InjuryForm flow but
   stripped to the minimum: muscle group + severity chips, no
   dates, max 5 entries.
═══════════════════════════════════════════════════════════════ */

// Must match MUSCLE_GROUPS in components/workout/InjuryForm.jsx — see the note
// there for why 'Forearms' is in the list. A region reportable here and absent
// there is one a user can declare at signup and then never edit again.
const OB_MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Legs', 'Glutes', 'Core'];
const OB_SEVERITIES = [
  { id: 'mild',     label: 'Mild',     color: 'text-yellow-400 border-yellow-400/40 bg-yellow-400/10' },
  { id: 'moderate', label: 'Moderate', color: 'text-orange-400 border-orange-400/40 bg-orange-400/10' },
  { id: 'serious',  label: 'Serious',  color: 'text-red-400 border-red-400/40 bg-red-400/10' },
];

function InjuryHistoryStep({ step, total, value, onChange, onNext, onBack, onSkip }) {
  const { tFallback } = useLanguage();
  // Muscle group labels come from `src/locales/*.json`, which already ships
  // all 15 languages for exactly these eight and was, until now, loaded into
  // every language bundle with nothing reading it. The stored value stays the
  // English name — `injury_logs.muscle_group` is matched by string downstream.
  const muscleLabel = (m) => tFallback(m.toLowerCase(), m);
  // value = [{ muscleGroup, severity }]
  const [pendingMuscle, setPendingMuscle] = useState('');
  const [pendingSeverity, setPendingSeverity] = useState('mild');

  // One row per muscle: picking Chest again updates its severity rather than
  // saving two injury logs for the same chest.
  const alreadyLogged = value.some(e => e.muscleGroup === pendingMuscle);
  const withPending = () => [
    ...value.filter(e => e.muscleGroup !== pendingMuscle),
    { muscleGroup: pendingMuscle, severity: pendingSeverity },
  ];
  const addEntry = () => {
    if (!pendingMuscle) return;
    if (value.length >= 5 && !alreadyLogged) return;
    onChange(withPending());
    setPendingMuscle('');
    setPendingSeverity('mild');
  };

  const remove = (idx) => onChange(value.filter((_, i) => i !== idx));

  // A muscle picked but not yet added is still an injury the user told us
  // about. Continue used to drop it, so tapping Chest + Serious and then
  // Continue trained the chest anyway. Commit it on the way out.
  const pendingCounts = !!pendingMuscle && (value.length < 5 || alreadyLogged);
  const handleNext = () => {
    if (pendingCounts) onChange(withPending());
    onNext();
  };
  const loggedCount = value.length + (pendingCounts && !alreadyLogged ? 1 : 0);

  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4">
        <KineticHeading
          text={tFallback('onboarding.injury.heading', 'Any injuries?')}
          accentWord={tFallback('onboarding.injury.accentWord', 'injuries')}
        />
        <p className="text-sm text-muted-foreground mt-1 mb-5">
          {tFallback('onboarding.injury.sub', "We'll work around them from day one. Anything you flag comes out of your plan until you clear it. Skip if you're all good.")}
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
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
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
                    /* 26x23px, the only DESTRUCTIVE control in the flow and
                       the smallest. Grown with a pseudo-element, not real
                       height: five logged injuries are five of these, so
                       `min-h-11` added ~105px and put the step 96px into
                       overflow on a 667pt SE. The expansion stays inside the
                       8px row gap, so neighbouring rows' targets meet but
                       never overlap. (Onboarding polish #5) */
                    className="relative text-muted-foreground hover:text-destructive active:text-destructive transition-colors p-1 leading-none text-lg before:absolute before:content-[''] before:-inset-y-[11px] before:-inset-x-3"
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
          <p className="text-xs text-muted-foreground rounded-lg border border-border bg-card px-3 py-2 mt-3">
            {tFallback('onboarding.injury.capReached', "You've logged the max of 5. Add more later from Profile → My Injuries.")}
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
                    aria-pressed={pendingMuscle === m}
                    className={[
                      'min-h-11 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all',
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
                    aria-pressed={pendingSeverity === s.id}
                    className={[
                      'flex-1 min-h-11 py-1.5 rounded-lg text-xs font-semibold border transition-all',
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
                'w-full min-h-11 py-2 rounded-lg text-sm font-bold border transition-all',
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
        <PrimaryBtn onClick={handleNext}>
          {loggedCount > 0
            ? tFallback('onboarding.injury.ctaLogged', 'Continue · {count} logged', { count: loggedCount })
            : tFallback('onboarding.common.continue', 'Continue')}
        </PrimaryBtn>
        <button
          type="button"
          onClick={onSkip}
          // Left at 36px deliberately. It is 327px wide and full-bleed, which
          // is the easiest thing on the step to hit, and it clears the WCAG
          // 2.5.8 minimum comfortably — while `min-h-11` here is 8px taken
          // straight off the scroll box, which on a 667pt SE with five
          // injuries logged is 8px more of the list pushed below the fold.
          // The three targets that genuinely failed (Clear, Remove, the
          // sharpen chips) were all under the 24px floor or unreachably
          // narrow; this one is neither. (Onboarding polish #5)
          className="w-full py-2 text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
        >
          {tFallback('onboarding.injury.skip', 'Skip, no injuries')}
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

// leaveGym reports failure as { ok: false } rather than throwing, so a
// .catch alone never saw a leave that did not happen.
function leaveJoinedGym(gymId) {
  leaveGym(gymId)
    .then(res => { if (!res?.ok) reportError(new Error('leaveGym returned not ok'), { feature: 'onboarding.home-gym-leave' }); })
    .catch(err => reportError(err, { feature: 'onboarding.home-gym-leave' }));
}

function HomeGymStep({ step, total, value, onChange, onNext, onBack, onSkip }) {
  const { tFallback } = useLanguage();
  // Picking opens a confirmation sheet rather than committing silently.
  // The pick is the one social commitment onboarding asks for, and it
  // used to advance the step with nothing acknowledging it.
  //
  // The sheet JOINS, which means this step now writes — see the head
  // comment in GymJoinSheet.jsx for why the leaderboard cannot be shown
  // any other way, and what it costs. `applied` is how handleRevealNext
  // knows not to write the same pick a second time.
  const [candidate, setCandidate] = useState(null);
  const [browsing, setBrowsing] = useState(false);
  // A map pick commits through GymMap itself, so all we learn is the id. The
  // name is looked up for the CTA, which otherwise read "Continue · " with
  // nothing after it.
  // Joining a second gym here replaces the first rather than adding to it.
  // Both the sheet and the map add a membership without removing the old
  // one, so without this a user who changed their mind trained at two gyms.
  const replaceJoined = (nextId) => {
    const prev = value?.applied ? value.gymId : null;
    if (prev && prev !== nextId) leaveJoinedGym(prev);
  };
  const adoptMapPick = async () => {
    const id = await resolveHomeGymId(null);
    if (!id) return;
    replaceJoined(id);
    const gym = await getGym(id).catch(() => null);
    onChange({ gymId: id, name: gym?.name || '', applied: true });
  };
  // Whether the open sheet has joined its gym. Cancelling a sheet that never
  // joined must leave the earlier pick alone: it used to clear it on screen
  // while the membership stayed, so Skip had nothing left to undo.
  const [sheetJoined, setSheetJoined] = useState(false);
  const pickCandidate = (c) => { setSheetJoined(false); setCandidate(c); };
  return (
    <div className="flex flex-col h-full">
      <StepHeader step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-4">
        <KineticHeading
          text={tFallback('onboarding.homeGym.heading', 'Pick your gym and meet your floor.')}
          accentWord={tFallback('onboarding.homeGym.accentWord', 'floor')}
        />
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          {tFallback('onboarding.homeGym.sub', "Your gym gets a bubble on the Flexyn map, and you'll get a leaderboard with everyone else who trains there. You can change this any time.")}
        </p>

        {/* Escape hatch for anyone the radius search can't serve: the
            whole country, pannable, instead of a list around one fix. */}
        <button
          type="button"
          onClick={() => setBrowsing(true)}
          // min-h-11: this measured 42px, and it is the escape hatch for
          // anyone the radius search can't serve. (Onboarding polish #5)
          className="w-full min-h-11 mb-3 py-2.5 rounded-lg text-sm font-bold border border-border bg-card text-primary hover:border-primary/40 active:border-primary/40 transition-all"
        >
          {/* The one hardcoded user-facing string left in the flow — every
              other one on this step goes through tFallback. (Onboarding
              polish #3) */}
          {tFallback('onboarding.homeGym.browseMap', 'Browse map')}
        </button>

        <NearbyGymPicker
          value={value}
          onChange={pickCandidate}
          emptyHint={tFallback('onboarding.homeGym.emptyHint', "Try Browse map above, or skip for now. You can pick your gym any time from Profile \u2192 My Gym.")}
        />
      </div>

      {/* The map is a full-screen OVERLAY, not a route. App.jsx forces an
          incomplete-onboarding user back onto the onboarding route, so
          navigating to /gym-map bounces straight back — and stepIdx isn't
          persisted, so it would also drop them at the start of the flow.
          Picking on the map commits through GymMap's own adopt path, so
          on close we take whatever home gym now exists. */}
      {browsing && (
        <Suspense fallback={null}>
          <GymMapOverlay
            onClose={async () => {
              setBrowsing(false);
              await adoptMapPick();
            }}
            // Swaps the card's "View Hub" for a Continue and hides the
            // register-gym link — both route somewhere App.jsx will not
            // let an unfinished user go.
            onContinue={async () => {
              setBrowsing(false);
              await adoptMapPick();
              onNext();
            }}
          />
        </Suspense>
      )}

      <GymJoinSheet
        pick={candidate}
        open={!!candidate}
        // After a join the sheet has already left that gym again.
        onCancel={() => { setCandidate(null); if (sheetJoined) onChange(null); setSheetJoined(false); }}
        onJoined={(gymId) => {
          replaceJoined(gymId);
          setSheetJoined(true);
          onChange({ ...candidate, gymId, applied: true });
        }}
        onContinue={() => { setCandidate(null); onNext(); }}
      />

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
              {value.name
                ? tFallback('onboarding.homeGym.ctaPicked', 'Continue · {name}', { name: value.name })
                : tFallback('onboarding.common.continue', 'Continue')}
            </PrimaryBtn>
            <button
              type="button"
              onClick={onSkip}
              className="w-full min-h-11 py-2 text-sm text-center text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
            >
              {tFallback('onboarding.homeGym.skip', "Skip and pick later")}
            </button>
          </>
        ) : (
          <>
            <PrimaryBtn onClick={onSkip}>
              {tFallback('onboarding.homeGym.skip', "Skip and pick later")} <Icon name="arrow-right" size={18} strokeWidth={2.5} />
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

// Hard ceiling on how long the Coach may hold up the reveal, on top of the
// ~4.4 s the loader's beats already take. askStarterPlanCoach has its own 8 s
// timeout; this is the belt to that braces, because the one thing onboarding
// must never do is strand somebody on a loader at the last step.
const COACH_WAIT_CEILING_MS = 4_000;

// Dumbbell rack by Jason Grant on Unsplash, desaturated and cropped to
// 780x1688. Credited in ATTRIBUTIONS.md.
const LOADER_PHOTO = '/onboarding/loader-dumbbells.jpg';

// One beat per pair of plates. The last one is the only line that names
// something happening off the device: it holds until the Coach request
// settles, so a wait there is the thing it says rather than a stall.
const LOADER_BEATS = [
  { key: 'onboarding.loading.beat.1', en: 'Reading Your Answers' },
  { key: 'onboarding.loading.beat.2', en: 'Setting Your Plan Length' },
  { key: 'onboarding.loading.beat.3', en: 'Spacing Your Rest Days' },
  { key: 'onboarding.loading.beat.4', en: 'Asking Your AI Coach' },
];
const LOADER_BEAT_MS = 1100;
const LOADER_FIRST_BEAT_MS = 900;
const LOADER_HOLD_READY_MS = 800;   // "Your plan is ready." on screen, alone
const LOADER_CLEAR_MS = 250;        // text leaves before the bar moves
const LOADER_LIFT_MS = 420;

// Plate heights in the bar's 90-unit viewBox, inside collar outwards. The
// bar is drawn in a 375-wide box with its centre at 187.5, and every plate's
// x is mirrored from that centre, so the two sides cannot drift apart.
const PLATE_H = [58, 50, 42, 34];
const BAR_CX = 187.5;
const COLLAR_OUTER = 91.5;          // centre to the collar face the plates sit against
const PLATE_W = 10;
const PLATE_STEP = 12;

/**
 * The plan loader. Four beats; each slams a pair of plates onto the bar and
 * prints one real answer underneath, so the wait reads as work being done.
 * At the end the text clears, the bar dips and launches off the top of the
 * screen, and the parent flashes into the reveal.
 *
 * @param {object}   data            onboarding draft, for the printed answers
 * @param {object}   previewRegimen  the plan the reveal will show
 * @param {number}   planWeeks       the block length the plan is built for
 * @param {function} onDone          advance to the reveal
 * @param {function} onCoach         asks the Coach; resolves either way
 */
function LoadingStep({ data, previewRegimen, planWeeks = 8, onDone, onCoach }) {
  const { tFallback, language } = useLanguage();
  const fmtDate = useDateFormatter();
  const reduce = useReducedMotion();
  const shake = useAnimationControls();
  const barRef = useRef(null);
  const [beat, setBeat] = useState(0);            // beats completed, 0..4
  const [phase, setPhase] = useState('build');    // build | clear | lift
  const [liftY, setLiftY] = useState(-700);
  // The request is in flight while the beats play, so in the common case it
  // has landed long before the last beat and costs nothing.
  const [coachPending, setCoachPending] = useState(true);

  // Kicked off exactly once. `onCoach` is a fresh closure on every parent
  // render, so it is deliberately not a dependency: re-running this would
  // spend another turn of the user's daily Coach quota per render.
  useEffect(() => {
    let cancelled = false;
    const settle = () => { if (!cancelled) setCoachPending(false); };
    const ceiling = setTimeout(settle, COACH_WAIT_CEILING_MS);
    onCoach?.().finally(() => { clearTimeout(ceiling); settle(); });
    return () => { cancelled = true; clearTimeout(ceiling); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The beats. The last one waits for the Coach before its plates land.
  useEffect(() => {
    if (beat >= LOADER_BEATS.length) return undefined;
    if (beat === LOADER_BEATS.length - 1 && coachPending) return undefined;
    const t = setTimeout(() => {
      setBeat(b => b + 1);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
      if (!reduce) shake.start({ x: [0, -4, 4, -2, 2, 0], transition: { duration: 0.28 } });
    }, beat === 0 ? LOADER_FIRST_BEAT_MS : LOADER_BEAT_MS);
    return () => clearTimeout(t);
  }, [beat, coachPending, reduce, shake]);

  // The finish: hold the ready line, clear the text, launch the bar.
  useEffect(() => {
    if (beat < LOADER_BEATS.length) return undefined;
    const timers = [];
    timers.push(setTimeout(() => {
      setPhase('clear');
      timers.push(setTimeout(() => {
        // Far enough to clear the TOP OF THE SCREEN, not just the step:
        // the shell's overflow edge is the viewport, so measuring the bar's
        // own bottom edge is exactly the distance it has to travel.
        const r = barRef.current?.getBoundingClientRect();
        setLiftY(-((r?.bottom ?? 700) + 24));
        setPhase('lift');
        timers.push(setTimeout(onDone, reduce ? 200 : LOADER_LIFT_MS));
      }, LOADER_CLEAR_MS));
    }, LOADER_HOLD_READY_MS));
    return () => timers.forEach(clearTimeout);
    // `onDone` is the parent's fresh closure; the finish runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, reduce]);

  // The counter lands on 25, 50, 75 and 100 with each pair of plates and
  // creeps between them, so the number and the bar never disagree.
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  useEffect(() => {
    const floor = beat * 25;
    shownRef.current = Math.max(shownRef.current, floor);
    setShown(Math.round(shownRef.current));
    if (beat >= LOADER_BEATS.length) return undefined;
    const ceiling = floor + 20;
    const id = setInterval(() => {
      shownRef.current += (ceiling - shownRef.current) * 0.05;
      setShown(Math.round(shownRef.current));
    }, 40);
    return () => clearInterval(id);
  }, [beat]);

  // The answers it prints. Only what the user actually gave, never a sample.
  const rows = useMemo(() => {
    const goalIds = Array.isArray(data.goal) ? data.goal : (data.goal ? [data.goal] : []);
    const goal = GOALS.find(g => g.id === goalIds[0]);
    const days = [...(Array.isArray(data.days) ? data.days : [])].sort((a, b) => a - b);
    // The first LIFT. A runner's plan leads with its runs, and exercises[0]
    // printed "First lift: Easy run".
    const first = previewRegimen?.exercises?.find(e => e.kind === 'strength');
    const firstName = first ? (first.displayName || translateExerciseName(first.name, language)) : null;
    const firstDose = first?.kind === 'strength' && first.target_sets && first.target_reps
      ? `${first.target_sets} × ${first.target_reps}` : null;
    return [
      goal && {
        label: tFallback('onboarding.loading.row.goal', 'Goal'),
        value: tFallback(`onboarding.goal.${goal.id}.title`, goal.title) + (goalIds.length > 1 ? ` +${goalIds.length - 1}` : ''),
      },
      // The same number the reveal prints, from the level the plan is built at.
      {
        label: tFallback('onboarding.loading.row.length', 'Plan length'),
        value: tFallback('onboarding.loading.weeks', '{n} weeks', { n: planWeeks }),
      },
      days.length > 0 && {
        label: tFallback('onboarding.loading.row.days', 'Training days'),
        value: days.map(i => fmtDate(WEEKDAY_SEED[i], { weekday: 'short', timeZone: 'UTC' })).join(', '),
      },
      firstName && {
        label: tFallback('onboarding.loading.row.firstLift', 'First lift'),
        value: firstDose ? `${firstName}, ${firstDose}` : firstName,
      },
    ].filter(Boolean);
  }, [data.goal, data.days, planWeeks, previewRegimen, language, tFallback, fmtDate]);

  const done = beat >= LOADER_BEATS.length;
  const clearing = phase !== 'build';
  const headline = done
    ? null
    : tFallback(LOADER_BEATS[beat].key, LOADER_BEATS[beat].en);

  return (
    <motion.div animate={shake} className="dark relative flex flex-col h-full text-foreground">
      <div className="flex items-center shrink-0 h-11">
        <FlexynLogo className="h-8" />
      </div>

      {/* Screen readers get the beat as a sentence; the numbers and the bar
          are the same information drawn, so they are hidden from them. */}
      <p className="sr-only" role="status" aria-live="polite">
        {done ? tFallback('onboarding.loading.readyLead', 'Your plan is') + ' ' + tFallback('onboarding.loading.readyAccent', 'ready.') : headline}
      </p>

      <motion.div aria-hidden="true"
        className="font-hero shrink-0 tabular-nums mt-6"
        style={{ fontSize: 'clamp(104px, 34vw, 150px)', lineHeight: 0.8 }}
        animate={{ opacity: clearing ? 0 : 1, y: clearing ? -12 : 0 }}
        transition={{ duration: 0.2 }}>
        {shown}<span className="text-primary" style={{ fontSize: '0.3em', marginInlineStart: 4 }}>%</span>
      </motion.div>

      <motion.div ref={barRef} aria-hidden="true" className="shrink-0 mt-8 -mx-1"
        animate={phase === 'lift'
          ? (reduce ? { opacity: 0 } : { y: [0, 14, liftY] })
          : { y: 0, opacity: 1 }}
        transition={phase === 'lift' && !reduce
          ? { duration: LOADER_LIFT_MS / 1000, times: [0, 0.18, 1], ease: [0.55, 0, 0.9, 0.4] }
          : { duration: 0.2 }}>
        <svg viewBox="0 0 375 90" className="block w-full h-auto overflow-visible">
          <rect x="10" y="42" width="355" height="6" rx="3" fill="hsl(var(--muted-foreground))" />
          {[-1, 1].map(side => (
            <rect key={side} x={side < 0 ? BAR_CX - COLLAR_OUTER : BAR_CX + COLLAR_OUTER - 6}
              y="36" width="6" height="18" rx="2" fill="hsl(var(--muted-foreground))" />
          ))}
          {PLATE_H.map((h, i) => [-1, 1].map(side => {
            const inner = COLLAR_OUTER + i * PLATE_STEP;
            const x = side < 0 ? BAR_CX - inner - PLATE_W : BAR_CX + inner;
            const on = beat > i;
            return (
              <motion.rect key={`${i}${side}`} x={x} y={45 - h / 2} width={PLATE_W} height={h} rx="2"
                fill={i === PLATE_H.length - 1 ? 'hsl(var(--primary))' : 'hsl(var(--foreground))'}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                initial={false}
                animate={on
                  ? { opacity: 1, x: 0, scaleY: 1 }
                  : { opacity: 0, x: reduce ? 0 : side * 40, scaleY: reduce ? 1 : 1.25 }}
                transition={on && !reduce
                  ? { type: 'spring', stiffness: 700, damping: 22 }
                  : { duration: 0.15 }} />
            );
          }))}
        </svg>
      </motion.div>

      <div className="relative shrink-0 mt-5" style={{ minHeight: '2.2em', fontSize: 42 }} aria-hidden="true">
        {/* mode="wait": the old line leaves before the new one lands, so two
            condensed headlines never overprint mid swap. */}
        <AnimatePresence initial={false} mode="wait">
          {!clearing && (
            <motion.h2 key={beat} className="font-hero absolute inset-x-0 top-0 m-0"
              style={{ fontSize: 42, lineHeight: 0.92 }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 1.08 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, y: -12, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 26 }}>
              {done ? (
                <>
                  {tFallback('onboarding.loading.readyLead', 'Your plan is')}{' '}
                  <span className="text-primary">{tFallback('onboarding.loading.readyAccent', 'ready.')}</span>
                </>
              ) : (
                <span className={beat === LOADER_BEATS.length - 1 ? 'text-primary' : undefined}>{headline}</span>
              )}
            </motion.h2>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 min-h-0" />

      <motion.div className="shrink-0" aria-hidden="true"
        animate={{ opacity: clearing ? 0 : 1 }} transition={{ duration: 0.2 }}>
        {rows.map((row, i) => (
          <motion.div key={row.label}
            className="flex items-center justify-between gap-4 min-h-[30px] border-t border-border text-label"
            initial={false}
            animate={beat > i ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
            transition={{ duration: 0.3 }}>
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-semibold text-foreground text-end truncate">{row.value}</span>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}

/** Full-bleed photo behind the loader, pushing in the whole time. */
function LoaderBackdrop() {
  const reduce = useReducedMotion();
  return (
    <motion.div className="dark absolute inset-0 overflow-hidden bg-background" aria-hidden="true"
      initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}>
      <motion.img src={LOADER_PHOTO} alt="" width={780} height={1688} decoding="async"
        className="absolute inset-0 w-full h-full object-cover"
        initial={{ scale: 1.02 }} animate={{ scale: reduce ? 1.02 : 1.22 }}
        transition={{ duration: 6.4, ease: [0.2, 0.6, 0.2, 1] }} />
      {/* Legibility, not decoration: the counter sits on the top of the
          photo and the answers on the bottom, and both need the photo held
          down. Same single-scrim approach as WelcomeBackdrop. */}
      <div className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, hsl(var(--background) / 0.7) 0%, hsl(var(--background) / 0.55) 35%, hsl(var(--background) / 0.92) 70%, hsl(var(--background)) 100%)' }} />
    </motion.div>
  );
}

/** The orange hit between the bar leaving and the plan arriving. */
function LoaderFlash({ onEnd }) {
  return (
    <motion.div aria-hidden="true" className="absolute inset-0 z-20 pointer-events-none bg-primary"
      initial={{ opacity: 0 }} animate={{ opacity: [0, 0.85, 0] }}
      transition={{ duration: 0.5, times: [0, 0.15, 1], ease: 'easeOut' }}
      onAnimationComplete={onEnd} />
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

function RevealStep({ data, onNext, saving = false, previewRegimen = null, coachIntro = null, planLevel = null, planWeeks = 8 }) {
  const { tFallback, language } = useLanguage();
  const goalIds = Array.isArray(data.goal) ? data.goal : (data.goal ? [data.goal] : []);
  const pickedGoals = goalIds.map(id => GOALS.find(g => g.id === id)).filter(Boolean);
  const goals = pickedGoals.length ? pickedGoals : [GOALS[0]];
  // The level the plan was BUILT at, which the lift check can raise above
  // the one picked. Naming the pick put "for new lifters" over an advanced
  // plan. Same for the length: it follows the built level.
  const level = LEVELS.find(l => l.id === (planLevel || data.level)) || LEVELS[0];
  const daysCount = data.days.length;
  const weeks = planWeeks;

  // Every goal, in the order picked, joined the way the language joins a
  // list ("A, B and C", "A, B y C"). It read "build strength + 1 more block",
  // which named one goal and made the user count the rest.
  const goalTitle = (g, i) => {
    const t = tFallback(`onboarding.goal.${g.id}.title`, g.title);
    return i === 0 ? t : t.toLowerCase();
  };
  const goalList = (() => {
    const titles = goals.map(goalTitle);
    let parts;
    try {
      parts = new Intl.ListFormat(language || 'en', { type: 'conjunction' }).formatToParts(titles);
    } catch {
      parts = titles.flatMap((t, i) => (i ? [{ type: 'literal', value: ', ' }, { type: 'element', value: t }] : [{ type: 'element', value: t }]));
    }
    return parts.map((p, i) => (p.type === 'element'
      ? <span key={i} className="text-primary">{p.value}</span>
      : p.value));
  })();

  // Real exercises from the regimen we'll persist on submit. Falls back to
  // an empty list if the generator wasn't passed in (legacy / unit-test path).
  const previewExercises = previewRegimen?.exercises ?? [];

  return (
    <div className="flex flex-col h-full">
      <Confetti pieces={28} />
      <div className="flex-1 overflow-y-auto pb-4 pt-2">
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.4 }}
          className="flex items-center justify-between gap-3"
          style={{ marginBottom: 'var(--fluid-section)' }}>
          <FlexynLogo className="h-7" />
          {/* Reveal has no StepHeader, so the coach button is placed
              directly — "why this plan?" is the question people most
              want answered before they commit to it. */}
          <RevealCoachButton />
        </motion.div>

        {/* The one dominant element on the step. Every value in this sentence
            came from something the user answered across ten form steps, so the
            interpolated values carry the accent and the prose around them
            stays foreground — the emphasis lands on what they chose.

            There is no greeting above it. "Welcome in, {name}." was ceremony
            that told the user their own name, and once it had been demoted to
            a 15px muted line it was too small to be worth the row it cost —
            so the payoff now starts at the top of the page. */}
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.55, ease: [0.16,1,0.3,1] }}
          className="font-heading font-bold leading-[1.1] tracking-tight text-foreground m-0"
          style={{ fontSize: 'var(--fluid-heading-sentence)', marginBottom: 'var(--fluid-section)' }}>
          {fillNodes(
            daysCount === 1
              ? tFallback('onboarding.reveal.headlineOneDay', '{goals} in {weeks} weeks. One day a week, set for {level} lifters.')
              : tFallback('onboarding.reveal.headline', '{goals} in {weeks} weeks. {days} days a week, set for {level} lifters.'),
            {
              goals: goalList,
              weeks: <span className="text-primary">{weeks}</span>,
              level: <span className="text-primary">
                {level ? tFallback(`onboarding.level.${level.id}.label`, level.label).toLowerCase() : ''}
              </span>,
              days: <span className="text-primary">{daysCount}</span>,
            },
          )}
        </motion.h1>

        {/* Your starter plan — sectioned + explorable (Cardio / Strength).

            Nothing titles this block. It carried three lines of heading over
            the sections at one point — a "YOUR STARTER PLAN" eyebrow, the
            regimen's own name ("Your Starter Plan: Build Strength"), and a
            meta line — and all three said what the heading above already says
            and what the sections themselves show. The one survivor is the
            line telling the user where the plan was saved. */}
        {previewExercises.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="space-y-2.5">
            {/* The only thing in the whole flow that tells someone where their
                plan went. The day count that used to lead this line is already
                in the heading, and "tap a section to explore" described a
                chevron the user can see. */}
            <div className="text-caption text-muted-foreground">
              {tFallback('onboarding.reveal.planMeta', "We'll save it to Workout → Regimens.")}
            </div>
            <StarterPlanCoachCard
              regimen={previewRegimen}
              coachReply={coachIntro?.reply || null}
            />
          </motion.div>
        )}
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75 }}
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

const STEPS = ['welcome', 'goal', 'sharpen', 'experience', 'age', 'height', 'weight', 'days', 'assessment', 'injury_history', 'home_gym', 'loading', 'reveal'];
const FORM_STEP_NAMES = ['goal', 'sharpen', 'experience', 'age', 'height', 'weight', 'days', 'assessment', 'injury_history', 'home_gym'];
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
      // Was an animated `clip-path: inset(...)`. WebKit does not run
      // clip-path on the compositor, so a full-screen inset wipe repaints
      // the entire step subtree every frame — on three of the eleven
      // steps. That costs more than the blur and the brightness this same
      // function already refuses to use, and it is the one thing in here
      // contradicting its own GPU-only rule.
      //
      // A slide reads as the same gesture and is transform-only.
      return {
        enter:  { opacity: 0, x: direction > 0 ? '38%' : '-38%' },
        center: { opacity: 1, x: 0, transition: { duration: 0.5, ease: [0.76, 0, 0.24, 1] } },
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
      // Same reason as curtain, and worse: a circle() growing to 140% of
      // a full-screen box is the most expensive repaint in the flow, and
      // it lands on `reveal` — the one step that is also mounting the
      // generated plan. Scale + fade opens the same way for free.
      return {
        enter:  { opacity: 0, scale: 0.94 },
        center: { opacity: 1, scale: 1, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
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

// Session-scoped marker for "the reader is on the sign-in gate, not the
// welcome screen." See the showSignIn state below for why it's persisted.
const SIGN_IN_GATE_KEY = 'fn-onboarding-signin-gate';

export default function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoadingAuth, checkUserAuth, user } = useAuth();
  // `language` as well as tFallback: the Coach writes the starter-plan intro
  // in whatever language the app is set to, and the Edge Function needs to be
  // told which one.
  const { tFallback, language } = useLanguage();
  const { setWeightUnit } = useWeightUnit();
  const { setDistanceUnit } = useDistanceUnit();

  // The step is kept per user beside the draft, by NAME so a reorder of
  // STEPS cannot land someone on the wrong screen. Without it, closing the
  // app or a reload on the ninth step kept every answer and sent the person
  // back to the goal screen to tap through all of them again. The loader and
  // reveal are never restored: they run the save, which needs a fresh visit.
  const [stepIdx, setStepIdx] = useState(() => {
    if (!user?.id) return 0;
    try {
      // No draft means no answers to come back to, so start at the top.
      if (!localStorage.getItem(`fn-onboarding-draft-v1.${user.id}`)) return 0;
      const idx = STEPS.indexOf(localStorage.getItem(`fn-onboarding-step-v1.${user.id}`) || '');
      return idx >= 1 && idx <= STEPS.indexOf('home_gym') ? idx : 0;
    } catch {
      return 0;
    }
  });
  const [direction, setDirection] = useState(1);
  // The loader's exit flash lives here, not in the step, because it has to
  // outlive the step it belongs to and cover the reveal's first frame.
  const [loaderFlash, setLoaderFlash] = useState(false);
  const reduceMotion = useReducedMotion();
  const [saving, setSaving] = useState(false);
  // New users sign in from the welcome screen via the full SignInToContinue
  // gate (Google + Apple + email magic-link, all with error handling) rather
  // than being force-redirected to Google with no fallback. Toggled by the
  // welcome CTAs; the OAuth/magic-link round-trip reloads the app, so this
  // flag doesn't need to survive *that* redirect.
  //
  // It does need to survive one other reload, which is why it's persisted:
  // the gate carries the Terms / Privacy links, those are plain <a> tags to
  // public routes (see SignInToContinue), and coming back from one is a
  // fresh document. Without this, reading the terms dropped the reader on
  // the welcome screen instead of the gate they left. Session-scoped, so it
  // never leaks into a later visit.
  const [showSignIn, setShowSignIn] = useState(() => {
    try { return sessionStorage.getItem(SIGN_IN_GATE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try {
      if (showSignIn && !isAuthenticated) sessionStorage.setItem(SIGN_IN_GATE_KEY, '1');
      else sessionStorage.removeItem(SIGN_IN_GATE_KEY);
    } catch { /* Safari private mode — the gate just won't survive a reload. */ }
  }, [showSignIn, isAuthenticated]);

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
      // Spanish and French speakers mostly live where people measure in
      // centimetres and kilograms. Both still switch with one tap.
      heightUnit: language && language !== 'en' ? 'cm' : 'in',
      weightUnit: language && language !== 'en' ? 'kg' : 'lb',
    },
    days: [],
    // Array — multi-select preferred training times. See DaysStep for
    // the coercion-from-legacy-string fallback.
    preferredTime: [],
    // 4-question lift-estimate assessment. Optional — empty object
    // means "skipped." See `assessment` step + buildStarterRegimen.
    assessment: {},
    // V2 optional steps — all nullable/empty means step was skipped
    onboardingInjuries: [], // [{ muscleGroup, severity }]
    // "Sharpen your plan" follow-ups — all optional; drives the starter plan +
    // a real cardio goal. cardioEvent: 5k|10k|half|marathon|general;
    // cardioCurrent: { distance, timeSec }; strengthFocus: [exercise names].
    sharpen: { cardioEvent: null, cardioCurrent: null, strengthFocus: [], equipment: null, sessionMinutes: null },
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

  useEffect(() => {
    if (!user?.id || stepIdx < 1) return;
    try {
      localStorage.setItem(`fn-onboarding-step-v1.${user.id}`, STEPS[Math.min(stepIdx, STEPS.indexOf('home_gym'))]);
    } catch { /* private mode / quota */ }
  }, [stepIdx, user?.id]);

  const [usernameError, setUsernameError] = useState('');
  const [usernameChecking, setUsernameChecking] = useState(false);

  // Pre-compute the starter regimen the user will see on the Reveal step
  // AND the one we'll actually persist on submit — same object both places,
  // so the preview can't lie about what the user is getting. Pure function,
  // safe to recompute on every relevant input change.
  // The persisted regimen at submit time passes `assessment` to
  // buildStarterRegimen — keep this preview in sync so the Reveal screen
  // can't lie about what the user is getting. Comment at the call site
  // promised "same object both places" and that promise was broken
  // until this dep was added.
  // One set of inputs for the preview AND the plan that gets saved. They were
  // two hand-copied argument lists, which is how the recent run time came to
  // be asked for and passed to neither.
  const starterInputs = useMemo(() => ({
    goals: data.goal,
    level: data.level,
    daysCount: Array.isArray(data.days) ? data.days.length : 0,
    assessment: data.assessment || null,
    cardioEvent: data.sharpen?.cardioEvent,
    current5kSec: fiveKSecondsFrom(data.sharpen?.cardioCurrent),
    strengthFocus: data.sharpen?.strengthFocus,
    equipment: data.sharpen?.equipment,
    sessionMinutes: data.sharpen?.sessionMinutes,
    injuries: data.onboardingInjuries || [],
    // Only what the person actually set. The wheels open on defaults (26,
    // 75 kg, 178 cm) that buildProfilePayload deliberately does not save,
    // so building the plan from them would size a 60 year old's plan for a
    // 26 year old while the profile says the age is unknown.
    age: data.stats?.userTouchedAge ? data.stats.age : undefined,
    gender: data.stats?.gender,
    weightKg: data.stats?.userTouchedWeight ? data.stats.weightKg : undefined,
    heightCm: data.stats?.userTouchedHeight ? data.stats.heightCm : undefined,
    // Runs in the units the person measures themselves in. Someone who gave
    // their height in cm or weight in kg (the default outside English) was
    // handed "2.5 mi @ 8:05/mi" all the same.
    units: data.stats?.heightUnit === 'cm' || data.stats?.weightUnit === 'kg' ? 'metric' : 'imperial',
  }), [data.goal, data.level, data.days, data.assessment, data.sharpen, data.onboardingInjuries, data.stats?.age, data.stats?.gender, data.stats?.weightKg, data.stats?.heightCm, data.stats?.userTouchedAge, data.stats?.userTouchedWeight, data.stats?.userTouchedHeight, data.stats?.heightUnit, data.stats?.weightUnit]);
  const previewRegimen = useMemo(() => buildStarterRegimen(starterInputs), [starterInputs]);
  // The level and length the plan is really built at (the lift check can
  // promote the level), for the loader and the reveal to name.
  const planLevel = useMemo(() => starterPlanLevel(starterInputs), [starterInputs]);
  const planWeeks = starterPlanWeeks(planLevel);

  // The AI Coach's write-up of that plan. Null until the loading step asks for
  // it, and null forever if the Coach is unreachable — the reveal renders the
  // plan on its own in that case, exactly as it did before this existed.
  //
  // The EXERCISES are not the model's. buildStarterRegimen above owns those,
  // because they get persisted, filtered against injuries and capped by age,
  // and they have to be reproducible. This is the same split coach.js runs
  // everywhere else: the model writes, the builder builds.
  const [coachIntro, setCoachIntro] = useState(null);
  // Which plan the intro was asked about. It was a plain once-only flag, so
  // a user sent back by a taken username who then changed their goals got
  // the intro written for the old ones.
  const coachAsked = useRef(null);

  // Returns a promise so LoadingStep can wait on it. Guarded because every
  // call spends one of the user's daily Coach turns (migration 305), and
  // React 18's StrictMode double-mounts effects in development.
  const requestCoachIntro = useCallback(async () => {
    const key = `${language}|${JSON.stringify(starterInputs)}`;
    if (coachAsked.current === key) return;
    coachAsked.current = key;
    setCoachIntro(null);
    try {
      const res = await askStarterPlanCoach({ draft: { ...data, level: planLevel }, language });
      if (res.ok && coachAsked.current === key) setCoachIntro({ reply: res.reply, model: res.model });
    } catch (err) {
      // askStarterPlanCoach is soft by contract; this is the belt to that
      // brace. A Coach failure must never cost the user their onboarding.
      reportError(err, { feature: 'onboarding.starter-coach' });
    }
  }, [data, planLevel, language, starterInputs]);

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
  // One event per step reached, so the onboarding funnel shows where
  // people stop. The step NAME only: no answers ride along.
  useEffect(() => {
    track(EVENTS.ONBOARDING_STEP, { step: stepName, index: stepIdx });
  }, [stepName, stepIdx]);
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
  const sideEffectsDoneRef = useRef(false);
  useEffect(() => {
    const u = (data.username || '').trim();
    // Same threshold the Continue button uses (MIN_USERNAME_LENGTH). These
    // were 3 here and 2 there, so a two-character name was never checked for
    // availability: the user sailed through the remaining steps and found out
    // it was taken when the final save came back 23505, which bounced them
    // from the reveal screen all the way to the age step. (Audit 18 #12.)
    if (u.length < MIN_USERNAME_LENGTH || usernameError) {
      // A newer keystroke supersedes any check still out.
      usernameCheckSeqRef.current += 1;
      setUsernameChecking(false);
      return;
    }
    const seq = ++usernameCheckSeqRef.current;
    setUsernameChecking(true);
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
      finally {
        if (seq === usernameCheckSeqRef.current) setUsernameChecking(false);
      }
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
    // Distances follow the same choice: someone who measures themselves in
    // metric sees km. Imperial stays on the default, mi.
    const applyUnits = () => {
      setWeightUnit(weightUnit);
      if (starterInputs.units === 'metric') setDistanceUnit('km');
    };

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
      applyUnits();
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
        toast.error(tFallback('onboarding.toast.usernameTaken', 'That username is already taken. Try another.'));
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
        toast.error(tFallback('onboarding.toast.usernameProhibited', 'Username contains prohibited content. Pick another.'));
        return;
      }
      // A reserved handle is the same kind of refusal with a different
      // message. It fell through to the tiers below, which all send the
      // username too, so every retry failed with a raw database error.
      if (isReservedUsernameError(err)) {
        const msg = tFallback('onboarding.error.usernameReserved', 'That username is reserved. Pick another.');
        setUsernameError(msg);
        setSaving(false);
        const ageIdx = STEPS.indexOf('age');
        if (ageIdx >= 0) goTo(ageIdx);
        toast.error(msg);
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
        applyUnits();
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
        // stranded forever on the reveal screen. updateMe no longer strips
        // missing columns (2026-09-27), so a column the table lacks fails
        // tiers 1 and 2 and lands here.
        try {
          await db.auth.updateMe(coreProfile);
          applyUnits();
          markReturningUser();
          if (checkUserAuth) await checkUserAuth();
          saved = true;
          // Loud but non-blocking: let the user know some details
          // didn't save so they're not surprised to see missing data.
          toast.warning(
            tFallback('onboarding.toast.partialSave', 'Some profile details could not be saved. Finish setup from Settings later.'),
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
            toast.error(tFallback('onboarding.toast.usernameTaken', 'That username is already taken. Try another.'));
          } else if (isProfaneUsernameError(coreErr)) {
            setUsernameError(tFallback('onboarding.error.usernameProhibited', 'That username contains prohibited content. Pick another.'));
            const ageIdx = STEPS.indexOf('age');
            if (ageIdx >= 0) goTo(ageIdx);
            toast.error(tFallback('onboarding.toast.usernameProhibited', 'Username contains prohibited content. Pick another.'));
          } else if (isReservedUsernameError(coreErr)) {
            // Same as tier 1: a reserved handle is a pick-again, not an
            // outage, so it must not read as "Could not save (P0001)".
            const msg = tFallback('onboarding.error.usernameReserved', 'That username is reserved. Pick another.');
            setUsernameError(msg);
            const ageIdx = STEPS.indexOf('age');
            if (ageIdx >= 0) goTo(ageIdx);
            toast.error(msg);
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
                ? tFallback('onboarding.toast.offline', "You're offline. Reconnect and tap Enter Flexyn again.")
                : tFallback('onboarding.toast.saveFailed', 'Could not save your profile{code}. Tap Enter Flexyn to retry{detail}', { code, detail }),
              { duration: 8000 }
            );
          }
        }
      }
    } finally {
      setSaving(false);
      submittingRef.current = false;
      if (saved) {
        // Only navigate away if SOME save tier succeeded. Side-effects
        // (capsule, regimen, body-metrics, injuries) fire here so they
        // run regardless of which tier landed the profile — a Tier 2/3
        // user still gets their welcome capsule + starter regimen.
        //
        // Once per onboarding. If the profile re-read after a good save
        // fails, the app keeps this screen up and Enter Flexyn works
        // again; a second tap re-ran every insert below, so the user got
        // two injury lists, two weight points and two running goals.
        const firstSave = !sideEffectsDoneRef.current;
        sideEffectsDoneRef.current = true;
        if (firstSave) {
        track(EVENTS.ONBOARDING_COMPLETED, {
          goals: Array.isArray(data.goal) ? data.goal.length : 0,
          picked_gym: Boolean(data.homeGym),
        });
        // Welcome capsule — idempotent, fire-and-forget.
        if (user?.id && user?.email) {
          grantWelcomeCapsule(user.id, user.email).catch(sideErr => {
            reportError(sideErr, { feature: 'onboarding.welcome-capsule', level: 'warning', userEmail: user?.email });
          });
        }
        // Starter regimen — idempotent (skips if any regimens exist).
        // Dashboard may have read an empty list before this insert landed
        // and would keep it for a minute, hiding the plan the reveal just
        // promised. Refetch once it exists.
        ensureStarterRegimen({ user, profile: starterInputs }).then(() => {
          queryClient.invalidateQueries({ queryKey: ['regimens'] });
        }).catch(sideErr => {
          reportError(sideErr, { feature: 'onboarding.starter-regimen', level: 'warning', userEmail: user?.email });
          // The reveal just promised the plan would be saved, so a failure
          // here is one the user will go looking for. Say so, the same way
          // the injury history does.
          toast.warning(
            tFallback('onboarding.toast.planFailed', "We couldn't save your starter plan. Ask the AI Coach to build you a new one."),
            { duration: 7000 },
          );
        });

        // Cardio goal — if the user picked a running goal + a target event,
        // create a real, trackable cardio goal (shows in the Cardio tab +
        // dashboard). Idempotent-ish + fire-and-forget; never blocks onboarding.
        ensureOnboardingCardioGoal({ user, goals: data.goal, sharpen: data.sharpen })
          .then(() => queryClient.invalidateQueries({ queryKey: ['goals'] }))
          .catch(sideErr => {
            reportError(sideErr, { feature: 'onboarding.cardio-goal', level: 'warning', userEmail: user?.email });
          });

        // Seed the Progress weight chart with the weight the user just
        // entered, so it opens with a first point instead of an empty graph.
        //
        // This block used to also write body-fat / waist / chest / hip from a
        // "body baseline" step, and only ran when that step was filled in.
        // That step is gone, so the measurement columns have no source and the
        // gate moves to the weight step's own "did they actually touch it"
        // flag — which was always the guard on weight_lbs here, to keep the
        // default 165 lb from contaminating the chart as a phantom entry.
        const userTouchedWeight = !!data.stats?.userTouchedWeight;
        if (user?.id && userTouchedWeight) {
          supabase.from('body_metrics').insert({
            created_by: user.email,
            user_id:    user.id,
            date:       todayLocalDateString(),
            // Same resolver the profile payload uses, so the first point on
            // the Progress weight chart cannot disagree with the weight on the
            // profile it was captured alongside.
            weight_lbs: resolveMeasurements(s).weightLb,
          })
            // supabase-js RESOLVES with `{ error }` on a database failure — it
            // only rejects on a network-level throw. `.then(() => {}).catch()`
            // therefore swallowed every RLS denial and constraint violation
            // here, silently, including from Sentry. Re-throw so the catch is
            // reachable. (Audit 18 #8.)
            .then(({ error }) => { if (error) throw error; })
            .catch(sideErr => {
              reportError(sideErr, { feature: 'onboarding.weight-seed', level: 'warning', userEmail: user?.email });
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
              // open their injury list to find it empty and conclude the app
              // lost them. (Both these strings used to name "Progress →
              // Recovery", which is not a route and never has been — there is
              // no Recovery tab on Progress. The form lives behind Profile →
              // My Injuries and the Workout tab's Recovery Mode banner.)
              // The toast lands on the dashboard they're being
              // navigated to, and `warning` is always delivered under the
              // current toast policy. (Audit 18 #8.)
              toast.warning(
                tFallback('onboarding.toast.injuriesFailed', "We couldn't save your injury history. Add it from Profile → My Injuries so your plan works around it."),
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
          // `applied` means GymJoinSheet already committed this pick when
          // the user tapped Join. Re-running the RPC would be harmless —
          // all three are idempotent — but it would be a wasted round
          // trip on the slowest screen in the flow, and for an OSM pick
          // it re-reads a row we already hold the id for.
          const attach = data.homeGym.applied
            ? setHomeGym(data.homeGym.gymId)
            : data.homeGym.osm
              ? setHomeGymFromOsm(data.homeGym.osm)
              : setHomeGym(data.homeGym.gymId);
          // Both setters resolve { ok: false } rather than throwing, so a
          // .catch alone never saw a gym that failed to attach.
          const gymFailed = (sideErr) => {
            reportError(sideErr, { feature: 'onboarding.home-gym', level: 'warning', userEmail: user?.email });
            toast.warning(
              tFallback('onboarding.toast.gymFailed', "We couldn't set your gym. Pick it from Profile → My Gym."),
              { duration: 7000 },
            );
          };
          attach
            .then(res => { if (!res?.ok) gymFailed(new Error(`home gym attach: ${res?.error || 'not ok'}`)); })
            .catch(gymFailed);
        }

        }

        // Clear the persisted draft now that the profile is in the DB.
        try {
          localStorage.removeItem(ONBOARDING_DRAFT_KEY);
          if (user?.id) localStorage.removeItem(`fn-onboarding-step-v1.${user.id}`);
        } catch { /* ignore */ }
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
        heading={tFallback('onboarding.signIn.heading', "Let's Get You Set Up")}
        subtext={tFallback('onboarding.signIn.subtext', 'Create an account or sign in. It saves your plan and syncs your progress across devices.')}
      />
    );
  }

  return (
    // 100svh, not 100dvh.
    //
    // dvh was chosen so a focused input wouldn't sit behind the soft
    // keyboard, and it does solve that — but it solves it by tracking the
    // viewport CONTINUOUSLY, and on iOS Safari the URL bar collapses and
    // expands with every scroll gesture. A fixed shell sized in dvh is
    // therefore being resized mid-gesture: the whole step grows and
    // shrinks under the content while it animates.
    //
    // svh is the SMALLEST viewport height and never changes, so the shell
    // holds still. The keyboard case moves to where it belongs —
    // `interactive-widget=resizes-content` in index.html's viewport meta,
    // which shrinks the layout viewport when the keyboard opens.
    <OnboardingCoachContext.Provider value={coachCtx}>
    <div className="fixed inset-0 bg-background overflow-hidden" style={{ height: '100svh' }}>
      <Aurora />

      {/* The welcome photo, full bleed behind the shell. See WelcomeBackdrop
          for why it is mounted here rather than inside WelcomeStep. */}
      <AnimatePresence>
        {stepName === 'welcome' && <WelcomeBackdrop key="welcome-backdrop" />}
        {stepName === 'loading' && <LoaderBackdrop key="loader-backdrop" />}
      </AnimatePresence>
      {loaderFlash && <LoaderFlash onEnd={() => setLoaderFlash(false)} />}

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

      {/* `perspective` lives HERE, on the element that does not move. It
          was set on the animating child itself, where it does nothing for
          that element's own rotateX/rotateY — a 3D transform is projected
          by its PARENT's perspective — while still forcing a 3D rendering
          context onto a full-screen subtree on every step. */}
      <div
        className="relative z-10 h-full flex items-start justify-center overflow-hidden"
        style={{ perspective: 1000 }}
      >
        {/* `safe-page` carries the safe-area insets and the fluid padding —
            see index.css. Layout.jsx has had insets since launch for the
            authenticated app, but onboarding escapes Layout and never got
            them: 24px of bottom padding against a 34px home indicator put
            the Continue button partly under it on every notched iPhone, on
            every step in the flow. The step's own spacing reads `--fluid-*`, which
            is why the goal step now fits a 667pt SE as well as a 932pt Pro
            Max instead of overflowing the first by 131px. */}
        <div className="safe-page w-full max-w-[420px] h-full flex flex-col">
          <AnimatePresence mode="wait">
            <motion.div key={stepName}
              variants={buildVariants(direction > 0 ? STEP_TRANSITIONS[stepName] : 'back', direction)}
              initial="enter" animate="center" exit="exit"
              /* No willChange and no preserve-3d here. Framer Motion sets
                 will-change for the duration of an animation and clears it
                 after; pinning it kept a full-screen layer promoted for
                 the whole flow. preserve-3d on the same subtree disables
                 subpixel text antialiasing, which is why type appears to
                 shimmer as a step settles. */
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
                  usernameChecking={usernameChecking}
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
                  // The step falls back to `onSkip || onNext`, so with no
                  // handler passed "Skip and generate a generic plan" was
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
                  onNext={next} onBack={back}
                  // Skip CLEARS, exactly like `assessment` above and
                  // `home_gym` below. Wired to a bare `next` this button read
                  // "Skip, no injuries" and kept every injury the user had
                  // logged: they still landed in `injury_logs` at submit, and
                  // still reached `ensureStarterRegimen`, so the plan excluded
                  // muscle groups for injuries the user had just said they
                  // didn't have. Reproduced end to end — logged Chest + Legs,
                  // tapped Skip, both rows were inserted. Same defect audit 18
                  // #4 found on the body-baseline step; this was the one
                  // sibling that never got the fix. (Onboarding polish #1)
                  onSkip={() => { setData(d => ({ ...d, onboardingInjuries: [] })); next(); }}
                />
              )}

              {stepName === 'home_gym' && (
                <HomeGymStep
                  step={formStep} total={TOTAL_FORM}
                  value={data.homeGym}
                  onChange={v => setData(d => ({ ...d, homeGym: v }))}
                  onNext={next}
                  onBack={back}
                  // A pick made through the join sheet or the map is already a
                  // membership and a home gym on the server. Skip has to undo
                  // that, or "Skip and pick later" leaves the user on the
                  // gym's leaderboard. leaveGym clears the home gym too.
                  onSkip={() => {
                    const joined = data.homeGym?.applied ? data.homeGym.gymId : null;
                    if (joined) leaveJoinedGym(joined);
                    setData(d => ({ ...d, homeGym: null }));
                    next();
                  }}
                />
              )}

              {stepName === 'loading' && (
                <LoadingStep data={data} previewRegimen={previewRegimen} planWeeks={planWeeks}
                  onDone={() => { if (!reduceMotion) setLoaderFlash(true); next(); }}
                  onCoach={requestCoachIntro} />
              )}

              {stepName === 'reveal' && (
                <RevealStep
                  data={data}
                  onNext={handleRevealNext}
                  saving={saving}
                  previewRegimen={previewRegimen}
                  coachIntro={coachIntro}
                  planLevel={planLevel}
                  planWeeks={planWeeks}
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

