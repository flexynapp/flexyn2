import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import StoriesRow from '@/components/stories/StoriesRow';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import {
  packLayout, unpackLayout, writeLayoutToLocal, clearLayoutLocal,
  queueLayoutSync, flushLayoutSync, mergeWidgetOrder, applyLayoutMigrations,
  readLocalDefaultsVersion, ORDER_KEY, LAYOUTS_KEY, HIDDEN_KEY,
} from '@/lib/dashboardLayout';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { subDays, isAfter, differenceInDays, startOfDay, format } from 'date-fns';
import { Dumbbell, TrendingUp, Play, ArrowRight, Zap, Activity, Target, Apple, Camera, Scale, TrendingDown, Minus, CheckCircle2, LayoutGrid, GripVertical, CalendarDays, ChevronRight, ChevronDown, Rows3, Columns2, RotateCcw, Plus, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { ReorderableRow, DragHandle } from '@/components/dashboard/ReorderableRow';
import { buildDashboardRows, reorderFrozen, flattenRows } from '@/lib/dashboardRows';
import GoalsModal from '@/components/goals/GoalsModal';
import GoalsAlmostComplete from '@/components/goals/GoalsAlmostComplete';
import GoalsProgressStrip from '@/components/dashboard/GoalsProgressStrip';
import LogWeightModal from '@/components/dashboard/LogWeightModal';
import RoutineCalendarModal from '@/components/routines/RoutineCalendarModal';
import ProgressPhotoCapture from '@/components/progress/ProgressPhotoCapture';
import DashboardWidgets from '@/components/dashboard/DashboardWidgets';
import SyncStatus from '@/components/dashboard/SyncStatus';
import ResumeWorkoutBanner from '@/components/dashboard/ResumeWorkoutBanner';
import HeroSlideshow from '@/components/dashboard/HeroSlideshow';
import DailyChestCard from '@/components/dashboard/DailyChestCard';
import StreakRescueCard from '@/components/dashboard/StreakRescueCard';
import DailyQuote from '@/components/dashboard/DailyQuote';
import DailyQuestsCard from '@/components/dashboard/DailyQuestsCard';
import WeeklyRecap from '@/components/dashboard/WeeklyRecap';
import WorkoutSuggestionCard from '@/components/dashboard/WorkoutSuggestionCard';
import WorkoutMemoryCard from '@/components/dashboard/WorkoutMemoryCard';
import JournalWidget from '@/components/dashboard/JournalWidget';
import ReadinessCard from '@/components/dashboard/ReadinessCard';
import TonightRow from '@/components/dashboard/TonightRow';
// Sleep / mood / steps logging + the score explainer live in this sheet, so
// three log cards leave the eager dashboard chunk and arrive on first open.
const ReadinessSheet = React.lazy(() => import('@/components/dashboard/ReadinessSheet'));
import { useReadiness } from '@/hooks/useReadiness';
import LoginStreakBanner from '@/components/dashboard/LoginStreakBanner';
import PushOptInBanner from '@/components/dashboard/PushOptInBanner';
import IosInstallBanner from '@/components/dashboard/IosInstallBanner';
import LeagueCard from '@/components/dashboard/LeagueCard';
// The ceremony is a once-per-season sheet, so it must not sit in the eager
// dashboard chunk — same reasoning as ReadinessSheet above.
const SeasonCeremonyModal = React.lazy(() => import('@/components/dashboard/SeasonCeremonyModal'));
import * as leagueSeasons from '@/lib/data/leagueSeasons';
import { fireSeasonEndCelebration, OPEN_SEASON_CEREMONY_EVENT } from '@/lib/seasonEndCelebration';
import { enqueueReveal } from '@/lib/rewardQueue';
import FriendLeaderboardPanel from '@/components/hub/FriendLeaderboardPanel';
import DiscoveryCards from '@/components/dashboard/DiscoveryCards';
import ErrorBoundary from '@/components/ErrorBoundary';
import PrestigePrompt from '@/components/prestige/PrestigePrompt';
import { isPrestigeEligible } from '@/lib/data/prestige';
import { isAppAdmin } from '@/lib/adminRoles';
import { setLayoutDefault } from '@/lib/data/layoutDefaults';
import { checkAndCelebrate as checkTrophies } from '@/lib/data/trophies';
import { toast } from '@/lib/toast';
import LeagueStandingsModal from '@/components/dashboard/LeagueStandingsModal';
import { filterAfterReset } from '@/lib/accountReset';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { useNumberFormatter } from '@/lib/intl';
import { parseLocalDate } from '@/lib/dateUtils';
import { getDateLocale } from '@/lib/dateLocales';
import { heroTintGradient, HERO_FADE_GRADIENT } from '@/lib/heroChrome';
import { cardioLogsKey } from '@/lib/data/cardioKeys';


/* ──────────────────────────────────────────────────────────────────
 *  Sub-components live in this file deliberately — they only exist
 *  to compose the dashboard hero and stats strip, and keeping them
 *  co-located makes the page easier to read end-to-end.
 * ────────────────────────────────────────────────────────────────── */

/* The hero band's tint + fade gradients, the smoothstep maths behind them
 * and the reasoning for both now live in src/lib/heroChrome.js — imported
 * at the top of this file. They moved because the Progress and Nutrition
 * carousels paint the same band and had their own, older treatment (two
 * blurred radial blobs, one animating on a 9s loop).
 */

/* Dither grain lived here and is gone — see the note at its old render
 * site below for why. Kept as a pointer rather than a deleted block so the
 * next person to see banding on a desktop monitor finds the history instead
 * of re-deriving it: the tile was a stitched 160px feTurbulence, desaturated,
 * alpha-flattened, stretched slope 3 / intercept −1.28, composited at 0.11
 * under `mix-blend-mode: overlay`, and measured at sd 1.80 against the real
 * band colour. It worked. It is removed because it is a desktop fix on a
 * mobile-only product, and it is the prime suspect for an iOS artefact.
 */

function HeroCard({
  streak, hasWorkedOutToday, daysSinceLast,
  logs, cardioLogs, goals, userProfile, user,
  onPrimary, onReadinessInfo, onPlanWeek, navigate,
  t, tFallback,
}) {
  // Pick the right CTA copy based on the user's recent activity.
  // HeroSlideshow handles the LEFT-column content (achievement
  // carousel / new-user calculated path / streak fallback) and uses
  // these same booleans to pick its mode.
  const isFresh = streak === 0 && daysSinceLast == null;
  const isOnStreak = streak > 0;
  const isLapsed = !isOnStreak && !isFresh && daysSinceLast >= 2;

  let cta;
  if (hasWorkedOutToday) {
    cta = t('dashboard.hero.cta.logAnother');
  } else if (isOnStreak) {
    cta = t('dashboard.hero.cta.continueStreak');
  } else if (isLapsed) {
    cta = t('dashboard.hero.cta.getBack');
  } else {
    cta = t('dashboard.hero.cta.startFirst');
  }

  // Drag-to-swipe lives on the band so the WHOLE hero is swipeable, not
  // just the slideshow content area.
  const slideshowRef = useRef(null);
  const [slideCount, setSlideCount] = useState(0);
  // Per-slide accent. Each slide reports its own HSL colour up via
  // onSlideColorChange (orange for streak, purple for duels, pink for
  // stories, cyan for cardio…). It drives three things below: the 2px
  // identity rule, the tint that falls off under it, and the pagination
  // dots inside the slideshow.
  //
  // History, because this has moved twice. It began as an ANIMATED radial
  // gradient mesh across the band and was cut to a bare 2px rule — the
  // animation and the mesh are the generated-UI tells CLAUDE.md names, and
  // that was most of why the hero read as one more card. The tint below is
  // not that mesh coming back: it is static, it is one linear falloff, and
  // it is on the band precisely so it has no edge to be sloppy about. The
  // thing being avoided is decoration with a visible seam, not colour.
  const [slideColor, setSlideColor] = useState(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      {/* The hero is the page's ONE dominant element, so it is the only
          thing allowed to break the page's px-4/px-6 inset (CLAUDE.md).
          -mx-4/-mx-6 cancels that padding, the band runs edge to edge, and
          only the bottom corners round — the top edge is a seam with the
          content above, not a card corner.

          bg-muted on light / bg-card on dark: a white band on the off-white
          light background did not read as dominant, which defeats the whole
          point of letting it bleed. On dark, --card is already lighter than
          --background so it separates on its own. */}
      {/* The band no longer drags. The gesture moved INTO HeroSlideshow,
          onto the paged track, because in a paged carousel the pages travel
          and the chrome does not — dragging the band moved the tint, the
          fade, the grain and the rule along with the content, which is why
          the old gesture read as nudging a card rather than turning a page.
          `touch-pan-y` stays on the class list below: the track needs the
          browser to leave horizontal gestures alone just as much. */}
      <motion.div
        // `isolate` went with the grain. It existed only to confine that
        // layer's mix-blend-mode to the band; with no blended layer left it
        // was a stacking context created for nothing, and stacking contexts
        // are not free — they change how descendants composite.
        className="relative overflow-hidden -mx-4 md:-mx-6 rounded-b-2xl bg-muted dark:bg-card text-foreground touch-pan-y"
      >
        {/* Accent tint. This lives on the BAND, and that placement is the
            whole reason it has no edges — it is not a softer version of
            the box that used to sit on the feature slide.

            A gradient shows an edge wherever its alpha is still non-zero
            at the element's boundary. The old overlay was a floating
            `-inset-3` box inside the slide, so three of its four sides
            were boundaries in the middle of the band and it read as an
            orange rectangle. The band has no such sides:

              · left / right — `-mx-4` bleeds past the page inset to the
                viewport edges, and `overflow-hidden` clips there. Paint
                runs off the screen instead of stopping at a line.
              · top — meets the 2px identity rule below, which is
                deliberate chrome. The rule renders AFTER this div so it
                stays crisp rather than being washed by the tint.
              · bottom — the falloff ends exactly ON the band's own
                boundary rather than somewhere inside it, so the curve
                never terminates in open space. Alpha is ~0.004 by 90%,
                so the rounded corners are visually untinted regardless.

            Percentages, not fixed heights: the band is min-h-[330px] but
            grows for a taller slide, and a px falloff would drift up the
            card when it does.

            The curve is smoothstep — see heroTintGradient above. A plain
            two-stop ramp still showed a faint line where it ended, because
            its SLOPE stops abruptly there even though its colour does not,
            and Mach banding makes the eye amplify exactly that.

            Every stop is `hsl(C / a)` — the same hue at falling alpha —
            never the `transparent` keyword. `transparent` is rgba(0,0,0,0),
            so the ramp would interpolate toward transparent BLACK and pick
            up the muddy darkening that made the old overlay look dirty.

            Uses the slide's own accent rather than a hardcoded --primary,
            so it agrees with the rule and the dots instead of staying
            orange on a purple slide. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: heroTintGradient(slideColor || 'var(--primary)') }}
        />

        {/* Band-to-page fade — see HERO_FADE_GRADIENT above. Occupies the
            bottom 40% so the dissolve is spread over ~170px at the measured
            429px band height: the surface step is 7.65 luminance, which over
            that distance is one level per ~22px rather than all of it in a
            single row.

            AFTER the tint so it also absorbs the tint's own remainder, and
            BEFORE the content so the CTA row and dots — which sit inside this
            zone — render at full strength over it rather than being dimmed. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[40%] pointer-events-none"
          style={{ background: HERO_FADE_GRADIENT }}
        />

        {/* The dither grain that used to sit here is REMOVED. It was added to
            defeat 8-bit banding on a 6-bit + FRC desktop MONITOR, and this app
            ships to iOS and Android only — so it was solving a problem the
            target device does not have, using `mix-blend-mode: overlay` plus
            `isolation`, which is one of the better-known places iOS Safari
            diverges from desktop Chrome.

            It became the prime suspect for a warm cast with a hard horizontal
            boundary reported from an iPhone: the boundary sat at ~60% of the
            band's height, which is exactly where the grain's mask had its knee
            (`#000 to 60%`, then a fade). Measured on desktop, the tint on that
            same slide is blue and spans the whole band — so whatever was
            drawing a warm bounded box was not the gradient.

            That is a hypothesis matched to geometry rather than a measurement,
            because the artefact does not reproduce here. But the trade decides
            it either way: a real artefact on the only platform we ship to is
            not worth a fix for a monitor that no user has. Restoring it is one
            revert if the banding matters more. */}

        {/* Slide identity — a 2px solid rule. Renders after the tint so
            the tint cannot wash it out.

            NO `transition-colors` on either of these, and that is load
            bearing rather than an omission. Transitioning a
            background-color whose value is `hsl(var(--x))` does not
            work: the inline style updates on every slide, the computed
            colour never leaves whatever it first painted, and the rule
            sits frozen on slide one's accent forever. Measured across a
            rotation — inline went --info → --success → --primary while
            the computed value stayed rgb(82,165,224) the whole way;
            dropping the class made it track exactly. The tint escaped it
            only by accident, because it paints a gradient and
            transition-colors does not cover background-image. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5 pointer-events-none"
          style={{ background: `hsl(${slideColor || 'var(--primary)'})` }}
        />

        {/* Carousel chevron — inside the band now that the band itself
            reaches the viewport edge. */}
        {slideCount > 1 && (
          <button
            type="button"
            onClick={() => slideshowRef.current?.next?.()}
            aria-label={tFallback ? tFallback('dashboard.hero.next', 'Next slide') : 'Next slide'}
            className="absolute end-3 top-[38%] -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-foreground/10 text-foreground hover:bg-foreground/20 active:bg-foreground/20 active:scale-95 flex items-center justify-center transition-all"
          >
            <ChevronRight className="w-4 h-4 rtl:scale-x-[-1]" />
          </button>
        )}

        {/* min-h locks the hero card's vertical size so different slides
            (Step 2 has a long sub-line + progress bar, Step 3 has just a
            number + one line) don't make the card visibly grow/shrink
            between auto-rotations. The min-height matches the tallest
            template slide's natural height — slides shorter than this
            now sit at the top with empty space underneath rather than
            collapsing the card. (Screenshot feedback, 2026-06.)
            NOTE: bottom padding is intentionally small (pb-2) — the streak
            pill below flows right after this box, and the previous pb-12 +
            negative-margin tuck clipped the pill / its expanded calendar on
            taller slides (progress bar + CTA). Now the pill sits cleanly
            below the dots and the card grows to fit whatever's open. */}
        {/* pe-12 when the carousel has more than one slide: the next-slide
            button is absolutely positioned over this box, and slide content
            ran underneath it — "Sun · 3 target" sat behind the chevron on the
            routine slide. Reserving the gutter fixes it for EVERY slide
            rather than per-slide, which is what a shared overlay needs; with
            a single slide there is no button, so no gutter is taken. */}
        {/* 330px, measured rather than guessed. The floor was 264/284, and
            the slides actually run 264→306px at 375pt (Step 2 is the tall
            one: progress bar plus a longer sub-line), so the box grew 42px on
            every rotation — the collapse/expand. 330 clears the tallest
            measured slide with ~24px of headroom, so shorter slides sit at
            the top against empty card and nothing moves.

            Deliberately min-height and not a hard height: a slide type this
            account never rotates through, or a longer locale, would be
            CLIPPED by a fixed height. This way the worst case is that one
            unusually tall slide grows the box — visible, not destructive —
            while every slide in normal rotation is pinned. Re-measure with
            the loop in the browser console before changing it. */}
        {/* The chevron gutter used to live HERE, as `pe-12` on this container.
            It moved into each slide's own root (see HERO_SLIDE_GUTTER in
            HeroSlideshow) for one reason: this container is the ancestor of
            the pager's `overflow-hidden` track, so padding here narrows the
            PAGE, and anything a slide positions at its right edge — the
            watermark — gets clipped 48px short of the band. That is why the
            watermark sat 48px from the right while sitting 16px from the top.

            Padding on the slide root instead insets the text without moving
            the watermark, because an absolutely positioned child resolves
            `right: 0` against its containing block's PADDING box. Same
            clearance for the chevron, symmetric corner for the icon. */}
        <div className="relative p-4 md:p-6 pb-2 md:pb-2 min-h-[330px]">
          <HeroSlideshow
            ref={slideshowRef}
            logs={logs}
            cardioLogs={cardioLogs}
            goals={goals}
            profile={userProfile}
            user={user}
            streak={streak}
            hasWorkedOutToday={hasWorkedOutToday}
            daysSinceLast={daysSinceLast}
            onPrimary={onPrimary}
            onSlideCta={(to) => navigate(to)}
            onPlanWeek={onPlanWeek}
            onSlidesCountChange={setSlideCount}
            onSlideColorChange={setSlideColor}
            t={t}
          />
        </div>

        {/* The login streak used to sit here, between the carousel dots and
            the CTA. Four things stacked inside one band — slide, dots,
            streak, CTA+readiness — read as crowded, so the streak moved out
            to its own section ('streak' in widgetOrder), where it is also
            reorderable and hideable like everything else. That also retired
            the pointerdown-stopPropagation wrapper it needed to keep the
            hero's drag gesture from eating taps on its chevron. */}

        {/* The "today" row — primary CTA (2/3) + Readiness (1/3) — now sits
            INSIDE the band. It used to be a sibling below it, which made
            today's moment read as three stacked objects (slide, streak,
            action) instead of one.

            Flat --primary, no baked-in orange gradient, no shine sweep, no
            coloured bloom. The old version hard-coded #ffd27a→#c2410c, so it
            did NOT actually follow the user's theme despite the comment
            claiming it did, and it carried three of the four generated-UI
            tells CLAUDE.md lists. Depth is shadow-md; the arrow chip is
            --primary-foreground. Recolours with every theme for free.

            No whileHover lift: this ships to iOS and Android where there is
            no hover, and the tap scale is the feedback that matters. */}
        <div className="relative z-10 px-4 md:px-6 pb-4 md:pb-5 flex items-stretch gap-2">
          <motion.button
            whileTap={{ scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            onClick={onPrimary}
            className="group relative flex-[2] rounded-2xl px-3 py-2.5 md:p-3 bg-primary text-primary-foreground shadow-md hover:brightness-105 flex items-center justify-between gap-3 text-start select-none-ui transition-all"
          >
            <span className="min-w-0">
              <span className="block text-micro font-semibold tracking-[0.04em] mb-1 text-primary-foreground/80">
                {hasWorkedOutToday
                  ? t('dashboard.hero.label.again')
                  : t('dashboard.hero.label.today')}
              </span>
              <span className="block font-heading font-bold text-lg md:text-xl leading-tight break-anywhere">
                {cta}
              </span>
            </span>
            <span className="shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary-foreground text-primary flex items-center justify-center">
              <ArrowRight className="w-5 h-5 md:w-6 md:h-6 transition-transform group-hover:translate-x-0.5 rtl:scale-x-[-1]" strokeWidth={2.5} />
            </span>
          </motion.button>
          {/* Readiness — 1/3 beside the CTA, and the entry point to the
              Readiness sheet where sleep / mood / steps are logged.
              renderDashboardSection('readiness') returns null so it isn't
              rendered twice. items-stretch matches the CTA's height. */}
          <div className="flex-1 min-w-[92px]">
            <ErrorBoundary label="ReadinessCard">
              <ReadinessCard logs={logs} compact onClick={onReadinessInfo} />
            </ErrorBoundary>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* One card, three columns, hairline dividers — was three separate Cards in
   a grid. These are read-only numbers, not widgets the user arranged, and
   CLAUDE.md reserves card surfaces for the latter: "read-only data that is
   NOT a widget gets no surface: hairline dividers instead". Three surfaces
   for three related figures also spent three focal points on one idea. */
function StatColumn({ icon: Icon, value, label, suffix, accent = false, trend = null }) {
  const { tFallback } = useLanguage();
  // trend: positive number = up, negative = down, 0 = flat, null = no data
  const showTrend = trend !== null && trend !== 0;
  const isUp = trend > 0;
  const TrendIcon = isUp ? TrendingUp : TrendingDown;

  return (
    <div className="flex-1 min-w-0 px-3">
      <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
        <Icon className={`w-3 h-3 shrink-0 ${accent ? 'text-primary' : ''}`} />
        <span className="text-micro font-semibold tracking-[0.04em] truncate">{label}</span>
      </div>
      <div className="font-heading font-bold text-2xl md:text-3xl leading-none tabular-nums tracking-tight truncate">
        {value}
      </div>
      <div className="mt-1.5 h-4 flex items-center gap-0.5">
        {showTrend && (
          <>
            <TrendIcon className={`w-3 h-3 shrink-0 ${isUp ? 'text-success' : 'text-destructive'}`} />
            <span className={`text-micro font-semibold truncate ${isUp ? 'text-success' : 'text-destructive'}`}>
              {isUp ? '+' : ''}{trend} {tFallback('dashboard.stats.vsLastWeek', 'vs last wk')}
            </span>
          </>
        )}
        {trend === 0 && (
          <>
            <Minus className="w-3 h-3 shrink-0 text-muted-foreground/60" />
            <span className="text-micro text-muted-foreground/60 truncate">
              {tFallback('dashboard.stats.sameAsLastWeek', 'same as last wk')}
            </span>
          </>
        )}
        {trend === null && suffix && (
          <span className="text-micro text-muted-foreground font-medium truncate">{suffix}</span>
        )}
      </div>
    </div>
  );
}

/* A grid tile, not a list row. Seven full-width rows plus a "Show 4 more"
   toggle cost roughly a screen and a half and still hid four of the seven
   actions behind a tap. Eight tiles in two rows fit the same actions in a
   third of the height with nothing hidden — so the toggle is gone too.
   One tile carries the primary accent (Start workout); the rest are muted
   chrome, which keeps a single focal point instead of eight competing
   coloured icons. */
function ActionTile({ to, icon: Icon, label, onClick, delay = 0, accent = false }) {
  const inner = (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay, ease: 'easeOut' }}
      whileTap={{ scale: 0.97 }}
      className={`group h-full flex flex-col items-center justify-center gap-2 px-1 py-3 rounded-lg bg-card border transition-colors cursor-pointer select-none-ui ${
        accent ? 'border-primary' : 'border-border/70 hover:border-primary/40'
      }`}
    >
      <span
        className={`w-8 h-8 rounded-sm flex items-center justify-center shrink-0 ${
          accent ? 'bg-primary/15' : 'bg-secondary'
        }`}
      >
        <Icon className={`w-4 h-4 ${accent ? 'text-primary' : 'text-muted-foreground'}`} />
      </span>
      <span className="text-micro font-semibold leading-tight text-center break-anywhere">{label}</span>
    </motion.div>
  );

  if (to) return <Link to={to} className="block h-full">{inner}</Link>;
  return (
    <button type="button" onClick={onClick} className="h-full text-center">
      {inner}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Section header + collapse helpers (module-scoped — DO NOT inline
 *  inside Dashboard(). Inlined functional components get a new
 *  reference each render → React treats them as a different component
 *  type → mount/unmount churn that defeats AnimatePresence.)
 * ────────────────────────────────────────────────────────────────── */

// Section label lookup — used by edit mode's drag-handle chips so each
// section row shows its name next to the layout-toggle button. Keyed
// by widgetOrder id; takes (tFallback, t) so it stays i18n-aware.
const SECTION_LABELS = {
  readiness:    (tF) => tF('dashboard.section.readiness',    'Readiness'),
  // Was 'Nutrition & Recovery' — the macro / calorie / hydration widgets
  // moved off the dashboard (Nutrition owns them) and what's left is the
  // three signals you log at the end of the day.
  recovery:     (tF) => tF('dashboard.section.tonight',      'Tonight'),
  stats:        (tF) => tF('dashboard.section.stats',        'This week'),
  streak:       (tF) => tF('dashboard.section.streak',       'Login streak'),
  challenges:   (tF) => tF('dashboard.section.challenges',   'Challenges'),
  chest:        (tF) => tF('dashboard.section.chest',        'Daily chest'),
  league:       (tF) => tF('dashboard.section.league',       'Weekly rank'),
  friends:      (tF) => tF('dashboard.section.friends',      'Friends this week'),
  // English-only via tFallback, like every other label in this map — the
  // dashboard.section.* keys are not in any i18n part file. Adding one
  // translated sibling would be the odd one out, so it follows the group.
  rescue:       (tF) => tF('dashboard.section.rescue',       'Streak rescue'),
  progress:     (tF) => tF('dashboard.section.progress',     'Your progress'),
  actions:      (tF, t) => t('dashboard.quickActions'),
  journal:      (tF) => tF('dashboard.section.journal',      'Journal'),
  discover:     (tF) => tF('dashboard.section.discover',     'Discover'),
  motivation:   (tF) => tF('dashboard.section.motivation',   'More motivation'),
  onboarding:   (tF) => tF('dashboard.section.onboarding',   'Get started'),
  customize:    (tF) => tF('dashboard.section.customize',    'Widget library'),
};

/* Section label — the onboarding step language: a 1.5px accent dot, a bold
   heading, and an optional quiet note on the right. No Hide / Show all
   control: collapsing lives in edit mode now, next to drag, pair and hide,
   so normal mode shows content instead of a control on every section. */
function SectionLabel({ label, note }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mb-2 px-1">
      <span className="flex items-center gap-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden="true" />
        <h2 className="font-heading font-bold text-sm tracking-tight truncate">{label}</h2>
      </span>
      {/* cq-hide: the note is the optional half of this row. In a half-width
          slot it was truncating the heading it annotates ("To…"). */}
      {note && (
        <span className="text-micro font-semibold text-muted-foreground/70 shrink-0 cq-hide">{note}</span>
      )}
    </div>
  );
}

/* What a collapsed section renders in NORMAL mode. Collapse has to stay
   reachable and reversible without entering edit mode, otherwise it is
   indistinguishable from hide — so a collapsed section keeps a slim
   labelled row you can tap to bring it back. */
function CollapsedStub({ label, onExpand, tFallback }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-expanded={false}
      className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-lg border border-dashed border-border bg-card/40 text-start group"
    >
      <span className="text-label font-semibold text-muted-foreground group-hover:text-foreground transition-colors truncate">
        {label}
      </span>
      <span className="flex items-center gap-1 shrink-0 text-micro font-semibold text-muted-foreground/70 group-hover:text-foreground transition-colors">
        {tFallback('dashboard.showAll', 'Show all')}
        <ChevronDown className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Main Dashboard
 * ────────────────────────────────────────────────────────────────── */


export default function Dashboard() {
  const { t, tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const fmt = useNumberFormatter();
  const isFirstLoad = location.state?.fromSplash;
  const [showWelcome, setShowWelcome] = useState(isFirstLoad);
  const [goalsModalOpen, setGoalsModalOpen] = useState(false);
  const [logWeightOpen, setLogWeightOpen] = useState(false);
  const [photoCaptureOpen, setPhotoCaptureOpen] = useState(false);
  const [weekModalOpen, setWeekModalOpen] = useState(false);
  const [leagueModalOpen, setLeagueModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  // Order follows the v2 composition: orient (hero, pinned above these
  // rows) → this week's numbers → what to do now → what to log tonight →
  // then the game layer, then state, then the tail.
  //
  // 'stats' is new: the three weekly figures used to live inside
  // 'progress', below goals and the recap, so the page's most-glanced
  // numbers sat a screen and a half down. They are their own row now,
  // directly under the hero.
  const defaultWidgetOrder = [
    'stats',                 // this week / volume / muscles — one card, 3 cols
    'actions',               // 4 × 2 tile grid
    'recovery',              // "Tonight" — sleep · mood · steps
    // Pairing only happens between ADJACENT halves, so the two ids that
    // should share a row have to sit next to each other here.
    'streak', 'challenges',  // both full-width; adjacent because they read
                             // as one "today" block, not because they pair
    'chest', 'league',       // hotdog pair: chest beside weekly rank
    'friends',
    'rescue',                // conditional — "your streak is about to break"
    'progress',              // goals, weekly recap, suggestion + memory
    'journal',
    'discover', 'motivation',
    'onboarding',
    'customize',
  ];
  const [widgetOrder, setWidgetOrder] = useState(defaultWidgetOrder);

  // Per-user hidden sections — users can tap the × on any main
  // dashboard section in edit mode to hide it; restored via the
  // "Hidden" chip rail also shown in edit mode. Persisted to
  // localStorage so the choice survives reloads. Stored as a Set
  // for O(1) hide lookup during render; serialized as array.
  // (Screenshot feedback: "if someone doesn't like a feature, just
  // make it so they can remove it and then if they wanna add it
  // back, it's in the widgets.")
  const hiddenSectionsKey = `flexyn.dashHiddenSections.${user?.id || 'anon'}`;
  const [hiddenSections, setHiddenSections] = useState(() => new Set());
  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(hiddenSectionsKey);
      if (raw) setHiddenSections(new Set(JSON.parse(raw)));
    } catch { /* corrupt JSON / quota — start with empty */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  const persistHidden = (next) => {
    try { localStorage.setItem(hiddenSectionsKey, JSON.stringify(Array.from(next))); }
    catch { /* quota / private mode */ }
  };
  const hideSection = (id) => {
    setHiddenSections(prev => {
      const next = new Set(prev);
      next.add(id);
      persistHidden(next);
      return next;
    });
  };
  const restoreSection = (id) => {
    setHiddenSections(prev => {
      const next = new Set(prev);
      next.delete(id);
      persistHidden(next);
      return next;
    });
  };

  // Per-section layout — hamburger (full-width, default) or hotdog
  // (half-width, pairs with adjacent half neighbor). Persisted per-user
  // to localStorage alongside widgetOrder. Two consecutive half
  // sections in widgetOrder render side-by-side; a lone half degrades
  // to full width (no half-width orphan).
  //
  // Factory default pair: chest + league. Both are small, single-figure
  // cards that waste a full row on their own, and they sit adjacent in
  // defaultWidgetOrder so the pairing actually takes effect.
  //
  // The previous default paired readiness + league and had to be turned off,
  // because LeagueCard renders null for anyone not yet in a league — every
  // new user — which stranded a 96px square next to an empty half. That
  // failure mode is unchanged here: a lone half degrades to full width (see
  // dashboardRows), so a new user sees a full-width chest card and no gap.
  const [sectionLayouts, setSectionLayouts] = useState({
    // streak + challenges USED to be paired here. A half slot is ~171px at
    // 375pt, and Daily Quests is three lines of text: every title wrapped to
    // two lines and the card ran ~500px to say three things. It is a full
    // row again (defaults v4 unpairs it for existing users too). chest +
    // league stay paired — both are single-figure cards that genuinely do
    // waste a row on their own.
    chest:      'half',
    league:     'half',
  });
  const toggleSectionLayout = (id) => {
    setSectionLayouts(prev => {
      const next = { ...prev, [id]: (prev[id] || 'full') === 'half' ? 'full' : 'half' };
      try { localStorage.setItem(LAYOUTS_KEY(user?.id), JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Per-section collapse. This was ten separate `xxxOpen` booleans plus ten
  // toggles plus a SectionHeader rendering "Hide / Show all" above every
  // section — a control on every section, permanently, for a preference
  // most people set once or never. One Set replaces all of it: collapsing
  // happens in edit mode (beside drag / pair / hide) and a collapsed
  // section keeps a slim labelled stub so it can be reopened without
  // entering edit mode.
  //
  // Still per-device (sessionStorage → resets next launch) and still keyed
  // per-user, per CLAUDE.md's `flexyn.<feature>.<userId>` convention: two
  // people on one phone must not inherit each other's collapsed sections.
  // sessionStorage already limits this to one tab, but a sign-out/sign-in
  // in that tab leaked it. Dashboard mounts below App.jsx's auth gates, so
  // `user` is resolved on the first render and this initializer doesn't
  // read an 'anon' key and then start writing a uid one mid-session.
  const collapsedKey = `flexyn.dash.${user?.id || 'anon'}.collapsed`;
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const raw = sessionStorage.getItem(collapsedKey);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  const toggleCollapsed = (id) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { sessionStorage.setItem(collapsedKey, JSON.stringify(Array.from(next))); }
      catch { /* private mode / quota */ }
      return next;
    });
  };

  // The Readiness sheet — score breakdown AND the sleep / mood / steps
  // loggers. `focus` is which signal to scroll to, set when the user taps a
  // column of the Tonight row rather than the Readiness card itself.
  const [readinessSheetOpen, setReadinessSheetOpen] = useState(false);
  const [readinessFocus, setReadinessFocus] = useState(null);
  const openReadiness = (signal = null) => {
    setReadinessFocus(signal);
    setReadinessSheetOpen(true);
  };

  // ?openReadiness=<signal> — the deep link the sleep / mood / steps daily
  // quests route to. Without it those three quests were tappable rows that
  // landed you on the Dashboard with no indication of where to log the thing
  // they asked for; the loggers live inside this sheet and nowhere else.
  //
  // The param is stripped on arrival (replace: true) so a back-nav doesn't
  // re-open the sheet, matching how Hub handles ?compose=1.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const signal = params.get('openReadiness');
    if (!signal) return;
    openReadiness(['sleep', 'mood', 'steps'].includes(signal) ? signal : null);
    params.delete('openReadiness');
    navigate(
      { pathname: '/dashboard', search: params.toString() ? `?${params.toString()}` : '' },
      { replace: true },
    );
    // openReadiness is stable enough for this — it only sets two pieces of
    // local state, and re-running on its identity would loop with the
    // navigate() above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, navigate]);

  // ── Rest day declaration ──────────────────────────────────────────────────
  // Per-user key (flexyn.<feature>.<userId> per CLAUDE.md) so two users
  // on the same device (family shared phone, sign in/out) don't inherit
  // each other's rest-day state. Falls back to 'anon' before auth resolves
  // so the read on first render still works.
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const restDayKey = `flexyn.restDay.${user?.id || 'anon'}.${todayKey}`;
  const [isRestDay, setIsRestDay] = useState(() => {
    try { return localStorage.getItem(restDayKey) === '1'; } catch { return false; }
  });
  // Re-read when the user resolves (the initial render happens with
  // user undefined; once auth loads we want the per-user value).
  useEffect(() => {
    try { setIsRestDay(localStorage.getItem(restDayKey) === '1'); } catch {}
  }, [restDayKey]);

  // Trophy check — fires once per dashboard mount (per user). The
  // server-side RPC is idempotent (UNIQUE constraint on the trophies
  // table) so re-calling never double-grants. Cheap: one round-trip
  // with COUNT queries, returns the newly-granted IDs which trigger
  // a celebration toast.
  useEffect(() => {
    if (!user?.id) return;
    // Cancelled flag so a checkTrophies call kicked off by the
    // setTimeout doesn't continue side-effecting after the Dashboard
    // unmounts (route change, sign-out). Without this, a trophy
    // celebration could fire on a destination route the user already
    // navigated to.
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      checkTrophies().catch(() => {});
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [user?.id]);

  // ── Season-end ceremony ───────────────────────────────────────────────────
  //
  // Fires once per season per device, on first open after roll-league-seasons
  // has awarded. Two-step on purpose: the celebration toast lands first and
  // the sheet only opens if the user taps View. A 28-day payoff deserves to
  // interrupt, but not to hijack — someone opening the app to log a workout
  // should be able to keep going.
  //
  // Delayed behind the trophy check so the two never collide, and routed
  // through rewardQueue for the same reason: this is the second place on the
  // Dashboard where two celebrations can land on one mount.
  const [seasonResult, setSeasonResult] = useState(null);
  const [seasonCeremonyOpen, setSeasonCeremonyOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const t = setTimeout(async () => {
      if (cancelled) return;
      const res = await leagueSeasons.getLastSeasonResult(user);
      if (cancelled || !res) return;
      // Keep the result around regardless, so the OPEN_SEASON_CEREMONY_EVENT
      // listener below can still open the sheet on a later tap.
      setSeasonResult(res);
      if (leagueSeasons.hasSeenSeasonResult(user.id, res.seasonNumber)) return;
      leagueSeasons.markSeasonResultSeen(user.id, res.seasonNumber);
      enqueueReveal(() =>
        fireSeasonEndCelebration({
          seasonNumber: res.seasonNumber,
          tier: res.tier,
          isChampion: res.isChampion,
          trophyId: res.trophyId,
        }),
      );
    }, 2600);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [user?.id]);

  // The celebration toast is React-free, so "View" reaches us as a window
  // event rather than a callback — same indirection prCelebration uses.
  useEffect(() => {
    const onOpen = () => setSeasonCeremonyOpen(true);
    window.addEventListener(OPEN_SEASON_CEREMONY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SEASON_CEREMONY_EVENT, onOpen);
  }, []);

  const handleDeclareRestDay = () => {
    try { localStorage.setItem(restDayKey, '1'); } catch {}
    setIsRestDay(true);
  };
  const handleUndoRestDay = () => {
    try { localStorage.removeItem(restDayKey); } catch {}
    setIsRestDay(false);
  };

  // Load + persist widget order per user.
  //
  // Merge-with-defaults (mergeWidgetOrder): keep the user's saved positions
  // for ids that still exist, drop unknown/stale ids, and slot any NEW
  // defaultWidgetOrder id in at its default index. The original code
  // required `defaultWidgetOrder.every(id => parsed.includes(id))`, which
  // discarded a user's whole saved order the first time we added a section;
  // the version after that appended new ids at the end, which was fine until
  // 'stats' — a row that belongs under the hero, not at the bottom.
  useEffect(() => {
    if (!user?.id) return;
    try {
      // First try user-specific saved order, then fall back to admin-set default
      const userSaved  = localStorage.getItem(ORDER_KEY(user.id));
      const appDefault = localStorage.getItem('flexyn.dashWidgetOrder.default');
      const raw = userSaved || appDefault;
      if (!raw) {
        // Account switch on a shared device — the previous user's
        // widgetOrder still lives in React state from before user.id
        // changed. Reset to the baseline so we don't render User A's
        // layout to User B for the first paint.
        setWidgetOrder(defaultWidgetOrder);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const merged = mergeWidgetOrder(parsed, defaultWidgetOrder);
      // Use JSON.stringify for the equality check — joining on a single
      // delimiter ('|') aliases two different orderings when an id
      // happens to contain that delimiter ("foo|bar" + "baz" joins
      // identical to "foo" + "bar" + "baz").
      if (merged.length > 0 && JSON.stringify(merged) !== JSON.stringify(defaultWidgetOrder)) {
        setWidgetOrder(merged);
      }
    } catch {}
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load sectionLayouts on user resolve.
  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = localStorage.getItem(LAYOUTS_KEY(user.id));
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') setSectionLayouts(parsed);
    } catch {}
  }, [user?.id]);

  // Compute rows from widgetOrder + sectionLayouts. Two consecutive
  // 'half' sections share a row; everything else stands alone. A lone
  // 'half' is rendered full-width (degraded — no orphan).
  // Hidden sections (per-user opt-out) are filtered FIRST so the
  // hotdog/hamburger pairing logic sees them as if they were never
  // in the order. Otherwise a hidden half-width section between two
  // visible halves would split the pair across rows.
  // 'readiness' is excluded entirely — it now renders inside the hero
  // (beside the CTA), so it must not occupy a section row (which would
  // leave an empty gap for any saved widgetOrder that still lists it).
  const isRowSection = (id) => !hiddenSections.has(id) && id !== 'readiness';
  const dashboardRows = useMemo(
    () => buildDashboardRows(widgetOrder.filter(isRowSection), sectionLayouts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widgetOrder, sectionLayouts, hiddenSections],
  );

  // Rows held still for the length of a drag. Pairing depends on ADJACENCY,
  // so recomputing it mid-gesture creates and destroys rows under framer —
  // the pair you drag past splits and re-merges, the list goes 4 → 5 → 4
  // items, and layout projection is left animating across two different
  // lists. If the row being dragged is the one that merges, its key changes
  // and the element is unmounted under the pointer. Both were visible as
  // rows flying off and the held card glitching. See lib/dashboardRows.js.
  const [dragRows, setDragRows] = useState(null);
  const rows = dragRows ?? dashboardRows;

  // Reset the customize state — clears widgetOrder + sectionLayouts
  // back to factory defaults. Used by the "Reset" button in edit mode
  // so a user who doesn't like their tweaks can go back without
  // dragging every section around manually.
  // Admin-only: snapshot the current widgetOrder + sectionLayouts and
  // write them to app_layout_defaults so new users (and Reset) read
  // from there. NOT a live sync — re-tap to push a new snapshot.
  const canSetAsDefault = isAppAdmin(user);
  // Per-tap in-flight guard so an admin double-tapping "Set Default"
  // can't fire two concurrent RPC writes and race the second toast
  // against the first. Ref-based so a re-render between taps doesn't
  // race a state-flag.
  const settingDefaultRef = useRef(false);
  const handleSetAsDefault = async () => {
    if (settingDefaultRef.current) return;
    settingDefaultRef.current = true;
    let res;
    try {
      res = await setLayoutDefault('dashboard', widgetOrder, sectionLayouts);
    } finally {
      settingDefaultRef.current = false;
    }
    if (res.ok) {
      toast.success(tFallback('dashboard.setDefaultSuccess', 'Saved — new users will see this dashboard layout.'));
    } else if (res.error === 'rpc_missing') {
      toast.error(tFallback('dashboard.setDefaultRpcMissing', 'Default-layouts RPC not deployed yet. Apply migration 166.'));
    } else if (res.error === 'admin_only') {
      toast.error(tFallback('dashboard.adminOnly', 'Admins only.'));
    } else {
      toast.error(tFallback('dashboard.setDefaultFailed', 'Could not save default layout — try again.'));
    }
  };

  const handleResetCustomize = () => {
    setWidgetOrder(defaultWidgetOrder);
    setSectionLayouts({
      chest:      'half',
      league:     'half',
    });
    // Reset means reset: a section the user collapsed comes back too.
    setCollapsedSections(new Set());
    try { sessionStorage.removeItem(collapsedKey); } catch { /* private mode */ }
    // Reset also unhides everything. Previously it left hidden sections
    // hidden, so "Reset" restored the order but not the sections the user
    // had removed — and there was no other way to get them all back at
    // once. The state change flows into the sync effect below, so the
    // server copy is reset too rather than resurrecting on the next
    // device. clearLayoutLocal drops all three local keys, including the
    // hidden-sections one the old code missed.
    setHiddenSections(new Set());
    clearLayoutLocal(user?.id);
  };

  // Debounced localStorage write so rapid drags (framer-motion
  // Reorder fires onReorder on every hover-cross during the drag,
  // not just on drop) don't hammer localStorage 30x per second.
  // The state update is still synchronous so the UI tracks the
  // pointer immediately — only the persistence is throttled.
  const reorderWriteTimerRef = useRef(null);
  const commitRowOrder = (nextRows) => {
    // Sections this row list never represented — hidden ones and 'readiness'.
    // They used to be dropped here, so hiding a section and then dragging
    // anything erased its saved slot until the next load put it back from the
    // defaults. Carrying them keeps the saved order whole.
    const carried = widgetOrder.filter(id => !isRowSection(id));
    const newOrder = flattenRows(nextRows, carried);
    setWidgetOrder(newOrder);
    if (reorderWriteTimerRef.current) clearTimeout(reorderWriteTimerRef.current);
    reorderWriteTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(ORDER_KEY(user?.id), JSON.stringify(newOrder));
      } catch { /* private mode / quota */ }
      reorderWriteTimerRef.current = null;
    }, 200);
  };

  const handleWidgetReorder = (newRowKeys) => {
    const next = reorderFrozen(rows, newRowKeys);
    // Mid-drag the frozen units move and nothing re-pairs, so framer sees a
    // list that only ever changes ORDER. The section order is committed on
    // drop instead of on every crossing — re-pairing while the pointer is
    // down is the whole defect.
    if (dragRows) setDragRows(next);
    else commitRowOrder(next);
  };

  // Snapshot at pointer-down; release on drop. `seamRowKey` pins the single
  // 32px break to the row that owns it at drag start: it is normally derived
  // from "the row after the actions row", which means it would hop to a
  // different row on every crossing and shove everything below it by 32px.
  const [seamRowKey, setSeamRowKey] = useState(null);
  const beginRowDrag = () => {
    const seamIdx = dashboardRows.findIndex(
      (r, i) => i > 0 && dashboardRows[i - 1].sections.includes('actions'),
    );
    setSeamRowKey(seamIdx >= 0 ? dashboardRows[seamIdx].rowKey : null);
    setDragRows(dashboardRows);
  };
  const endRowDrag = () => {
    setDragRows(current => {
      if (current) commitRowOrder(current);
      return null;
    });
    setSeamRowKey(null);
  };
  // Leaving edit mode unmounts the handles, so a drag in flight never gets
  // its onDragEnd. Without this the frozen list would outlive the gesture and
  // the dashboard would stop reflecting hides, layout toggles and arriving
  // data until remount.
  useEffect(() => {
    if (!editMode) { setDragRows(null); setSeamRowKey(null); }
  }, [editMode]);
  // Flush any pending reorder write on unmount so a quick drag +
  // navigate away doesn't lose the final ordering.
  useEffect(() => () => {
    if (reorderWriteTimerRef.current) {
      clearTimeout(reorderWriteTimerRef.current);
      reorderWriteTimerRef.current = null;
    }
  }, []);

  // ── Deep-link query params ───────────────────────────────────────────────
  // Layout.jsx long-press shortcuts on the Progress tab navigate to:
  //   /dashboard?logWeight=1  → open LogWeightModal
  //   /dashboard?addPhoto=1   → open ProgressPhotoCapture
  // Without this effect those navigations would land on /dashboard with
  // the modal NEVER opening — the shortcuts looked like they worked
  // (URL changed, page changed) but the promised action silently
  // failed. Strip the params after consuming so a back-nav doesn't
  // reopen the modal on every revisit.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    let changed = false;
    if (params.get('logWeight') === '1') {
      setLogWeightOpen(true);
      params.delete('logWeight');
      changed = true;
    }
    if (params.get('addPhoto') === '1') {
      setPhotoCaptureOpen(true);
      params.delete('addPhoto');
      changed = true;
    }
    if (changed) {
      navigate(
        { pathname: '/dashboard', search: params.toString() ? '?' + params.toString() : '' },
        { replace: true },
      );
    }
  }, [location.search, navigate]);

  useEffect(() => {
    if (showWelcome) {
      // 6 s gives slower readers time to finish the welcome-back message
      const timer = setTimeout(() => setShowWelcome(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [showWelcome]);

  // Strip location.state.fromSplash after the first render so a
  // back-nav to /dashboard from another page doesn't re-trigger the
  // welcome banner. The state lingered in router history otherwise,
  // surfacing the "Welcome back, <name>" message every time the user
  // tab-navigated to home.
  useEffect(() => {
    if (location.state?.fromSplash) {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Audit D-4 — best-effort reconcile pass. Fixes the case where a
  // workout INSERT landed but the increment_user_volume RPC never
  // ran (network died between the two). Idempotent server-side (RPC
  // skips already-credited rows) so it's safe to fire on every mount.
  // Gated to fire once per session via sessionStorage.
  useEffect(() => {
    if (!user?.id) return;
    const sessionKey = 'flexyn.volumeReconciled';
    try { if (sessionStorage.getItem(sessionKey)) return; } catch {}
    let cancelled = false;
    (async () => {
      try {
        const { reconcileMyVolume } = await import('@/lib/data/workouts');
        const res = await reconcileMyVolume();
        if (cancelled) return;
        try { sessionStorage.setItem(sessionKey, '1'); } catch {}
        if (res.ok && res.reconciled > 0) {
          // Quietly refresh the profile so the leaderboard rank picks
          // up the recovered volume on the next render.
          queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.email, queryClient]);

  const { data: rawLogs = [], isLoading: logsLoading, dataUpdatedAt: logsUpdatedAt } = useQuery({
    queryKey: ['workoutLogs', user?.email],
    queryFn: () => db.entities.WorkoutLog.filter({ created_by: user.email }, '-date', 50),
    enabled: !!user?.email,
  });

  const { data: rawCardioLogs = [] } = useQuery({
    queryKey: cardioLogsKey(user?.email, 'dashboard'),
    queryFn: () => db.entities.CardioLog.filter({ created_by: user.email }, '-date', 50),
    enabled: !!user?.email,
  });

  const { data: rawRegimens = [], isLoading: regimensLoading } = useQuery({
    queryKey: ['regimens', user?.email],
    queryFn: () => db.entities.Regimen.filter({ created_by: user.email }),
    enabled: !!user?.email,
  });

  const { data: rawGoals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ['goals', user?.email],
    queryFn: () => db.entities.Goal.filter({ created_by: user.email }, '-created_date'),
    enabled: !!user?.email,
  });

  // Lightweight meal-log query for the StreakRescueCard. Only needs the
  // date column — small payload, generous staleTime since the rescue
  // card only checks "logged anything today?" not specific entries.
  // Without this query the streak-rescue card would fire on users who
  // logged a meal today but not a workout. (Audit 08 #1.)
  const { data: rawNutritionLogs = [] } = useQuery({
    queryKey: ['nutritionLogsRecent', user?.email],
    queryFn: () => db.entities.NutritionLog.filter({ created_by: user.email }, '-date', 20),
    enabled: !!user?.email,
    staleTime: 5 * 60_000,
  });

  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });

  // ── Customize-home cross-device sync (migration 260) ───────────────────
  //
  // The three edit-mode facets (hidden sections, widget order, per-section
  // layout) were localStorage-only, so reinstalling the PWA or switching
  // phone silently wiped the layout. localStorage stays the fast path for
  // first paint; user_profiles.dashboard_layout is the copy that follows
  // the user, mirroring how DashboardWidgets already syncs.
  //
  // These effects live HERE, below `userProfile`, rather than beside the
  // state they read at the top of the component. `userProfile` is a const
  // declared at this line — referencing it from an effect declared earlier
  // would read it in the temporal dead zone when the deps array is
  // evaluated, which is the exact production crash CLAUDE.md documents.
  const layoutHydratedFor = useRef(null);
  // The defaults version this session actually reached, so the sync stamps
  // what happened instead of asserting the current constant. packLayout()
  // defaulting to the constant is what let a never-migrated layout be written
  // to the server as "v2 done", which then out-ranked the local copy forever.
  const [layoutDefaultsVersion, setLayoutDefaultsVersion] = useState(0);

  useEffect(() => {
    const uid = user?.id;
    if (!uid) { layoutHydratedFor.current = null; return; }
    if (layoutHydratedFor.current === uid) return;
    // Wait for the profile query to actually resolve. `userProfile`
    // defaults to {}, so an absent `dashboard_layout` key here means
    // "still loading" as often as it means "never customized" — settling
    // early would let the local layout win and immediately overwrite the
    // server copy with this device's state.
    if (!userProfile || Object.keys(userProfile).length === 0) return;

    const remote = unpackLayout(userProfile.dashboard_layout);

    // The layout this user is actually on, from whichever source is
    // authoritative: the server copy if there is one, otherwise whatever the
    // localStorage effects above already put into state.
    const base = remote
      ? {
        hiddenSections: remote.hiddenSections,
        widgetOrder: remote.widgetOrder.length > 0
          ? mergeWidgetOrder(remote.widgetOrder, defaultWidgetOrder)
          : widgetOrder,
        sectionLayouts: Object.keys(remote.sectionLayouts).length > 0
          ? remote.sectionLayouts
          : sectionLayouts,
        defaultsVersion: remote.defaultsVersion,
      }
      : (() => {
        // Read localStorage DIRECTLY rather than trusting the state values.
        // The local order/layout/hidden loaders are separate effects, and this
        // one can run before their setState has landed — so `widgetOrder` here
        // may still be defaultWidgetOrder. Migrating that is worse than not
        // migrating: the step sees defaults (already paired), reports "nothing
        // to do", stamps the version as done, and then the local loader
        // overwrites state with the un-paired saved order that will now never
        // be migrated again. Caught on a guest account whose streak and quests
        // stayed apart after the migration shipped.
        const readJson = (key, fallback) => {
          try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
          } catch { return fallback; }
        };
        const savedOrder = readJson(ORDER_KEY(uid), null);
        const savedLayouts = readJson(LAYOUTS_KEY(uid), null);
        const savedHidden = readJson(HIDDEN_KEY(uid), null);
        return {
          hiddenSections: Array.isArray(savedHidden) ? savedHidden : Array.from(hiddenSections),
          widgetOrder: Array.isArray(savedOrder) && savedOrder.length > 0
            ? mergeWidgetOrder(savedOrder, defaultWidgetOrder)
            : widgetOrder,
          sectionLayouts: savedLayouts && typeof savedLayouts === 'object' ? savedLayouts : sectionLayouts,
          defaultsVersion: readLocalDefaultsVersion(uid),
        };
      })();

    // Catch a saved layout up to the current DEFAULTS. mergeWidgetOrder
    // protects a customized order, which means a new default pairing could
    // otherwise never reach anyone who had opened edit mode — the pair needs
    // two ids adjacent and both 'half', and their saved order says
    // otherwise. Each step is the smallest change that delivers the new
    // default and touches nothing else; see dashboardLayout.js.
    const { layout: next, version, applied } = applyLayoutMigrations(base, base.defaultsVersion);

    // Server wins on load — that's what makes it cross-device. In-session
    // edits win afterwards, guarded by layoutHydratedFor.
    if (remote || applied.length > 0) {
      setHiddenSections(new Set(next.hiddenSections));
      if (next.widgetOrder.length > 0) setWidgetOrder(next.widgetOrder);
      if (Object.keys(next.sectionLayouts).length > 0) setSectionLayouts(next.sectionLayouts);
      writeLayoutToLocal(uid, { ...next, defaultsVersion: version });
    } else {
      // Nothing to hydrate and nothing to migrate, but the version still has
      // to be recorded or every load re-runs the same no-op steps.
      writeLayoutToLocal(uid, { ...next, defaultsVersion: version });
    }

    setLayoutDefaultsVersion(version);
    layoutHydratedFor.current = uid;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, userProfile]);

  // Push local edits up. Gated on hydration so the first render after login
  // can't overwrite the server copy with this device's stale localStorage
  // before the profile has been read.
  useEffect(() => {
    if (!user?.id || layoutHydratedFor.current !== user.id) return;
    queueLayoutSync(user.id, packLayout({
      hiddenSections, widgetOrder, sectionLayouts, defaultsVersion: layoutDefaultsVersion,
    }));
  }, [hiddenSections, widgetOrder, sectionLayouts, layoutDefaultsVersion, user?.id]);

  // Drop any pending debounce on unmount — the timer is module-level, so a
  // stale one firing after an account switch would write the previous
  // user's layout under the new session.
  useEffect(() => () => flushLayoutSync(), []);

  const logs = useMemo(() => filterAfterReset(rawLogs, userProfile), [rawLogs, userProfile]);
  const cardioLogs = useMemo(() => filterAfterReset(rawCardioLogs, userProfile), [rawCardioLogs, userProfile]);

  // Shared readiness computation — feeds the explainer sheet so it can
  // show the user their ACTUAL logged signals + how each contributed to
  // the score (same numbers ReadinessCard renders).
  const readiness = useReadiness(logs);

  // goLogReadinessSignal is gone. It closed the explainer, expanded the
  // recovery section and scrolled to [data-recovery-section] — which only
  // worked while the loggers were a section on this page. They live in the
  // sheet now, directly above the breakdown that names them, so there is
  // nothing to navigate to: the only signal you can't log there is
  // training, and ReadinessSheet routes that one to /workout itself.
  const regimens = useMemo(() => filterAfterReset(rawRegimens, userProfile), [rawRegimens, userProfile]);
  const goals = useMemo(() => filterAfterReset(rawGoals, userProfile), [rawGoals, userProfile]);

  const isLoading = logsLoading || regimensLoading || goalsLoading;

  /* ── Derived stats ─────────────────────────────────────────────── */

  const today = useMemo(() => startOfDay(new Date()), []);

  // parseLocalDate so a 'YYYY-MM-DD' DATE column is interpreted in the
  // user's local TZ. Plain `new Date('YYYY-MM-DD')` is UTC midnight,
  // which is the PREVIOUS local day for negative-offset zones — making
  // a workout that happened on the 7-day boundary fall in or out of
  // "this week" depending on which side of midnight UTC the user is on.
  const thisWeekLogs = useMemo(
    () => {
      // Hoist out of the filter callback — new Date() inside the
      // predicate fires once per log row when N items can be 50+,
      // which is wasteful when the reference instant is unchanged.
      const cutoff = subDays(new Date(), 7);
      return logs.filter(l => {
        const d = parseLocalDate(l.date);
        return d && isAfter(d, cutoff);
      });
    },
    [logs]
  );

  const muscleGroupCount = useMemo(() => {
    const groups = new Set();
    thisWeekLogs.forEach(log => {
      log.exercises?.forEach(ex => {
        if (ex.muscle_group?.trim?.()) groups.add(ex.muscle_group.trim());
        if (ex.muscle_groups?.length) ex.muscle_groups.forEach(g => { if (g && g.trim()) groups.add(g.trim()); });
      });
    });
    return groups.size;
  }, [thisWeekLogs]);

  // ── Last-week stats for trend arrows ──────────────────────────────────────
  const lastWeekLogs = useMemo(
    () => {
      // Hoist reference instants — calling new Date() twice per filter
      // call is both wasteful and risks edge cases where the two calls
      // straddle midnight (extremely unlikely but theoretically possible).
      const sevenAgo = subDays(new Date(), 7);
      const fourteenAgo = subDays(new Date(), 14);
      return logs.filter(l => {
        const d = parseLocalDate(l.date);
        if (!d) return false;
        return isAfter(d, fourteenAgo) && !isAfter(d, sevenAgo);
      });
    },
    [logs]
  );

  const lastWeekWorkoutCount = lastWeekLogs.length;

  const lastWeekMuscleGroupCount = useMemo(() => {
    const groups = new Set();
    lastWeekLogs.forEach(log => {
      log.exercises?.forEach(ex => {
        if (ex.muscle_group?.trim?.()) groups.add(ex.muscle_group.trim());
        if (ex.muscle_groups?.length) ex.muscle_groups.forEach(g => { if (g && g.trim()) groups.add(g.trim()); });
      });
    });
    return groups.size;
  }, [lastWeekLogs]);

  // delta: positive = up, negative = down, null = no last-week data
  const workoutTrend = lastWeekWorkoutCount > 0
    ? thisWeekLogs.length - lastWeekWorkoutCount
    : null;
  const muscleTrend = lastWeekMuscleGroupCount > 0
    ? muscleGroupCount - lastWeekMuscleGroupCount
    : null;

  // Total volume this week (in user's preferred unit, lbs or kg)
  const weeklyVolume = useMemo(() => {
    let totalLbs = 0;
    thisWeekLogs.forEach(log => {
      log.exercises?.forEach(ex => {
        ex.sets?.forEach(set => {
          if (set.weight && set.reps) totalLbs += set.weight * set.reps;
        });
      });
    });
    return Math.round(fromLbs(totalLbs, weightUnit));
  }, [thisWeekLogs, weightUnit]);

  // Streak — merges workout + cardio dates, parses date strings as LOCAL dates
  // via the shared parseLocalDate helper.
  const streak = useMemo(() => {
    const stamps = new Set();
    const addStamp = (raw) => {
      const d = parseLocalDate(raw);
      if (!d || isNaN(d.getTime())) return;
      const day = startOfDay(d);
      stamps.add(`${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`);
    };
    logs.forEach(l => addStamp(l.date));
    cardioLogs.forEach(l => addStamp(l.date));
    if (stamps.size === 0) return 0;
    const stampOf = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let cursor = startOfDay(new Date());
    if (!stamps.has(stampOf(cursor))) {
      const yesterday = new Date(cursor);
      yesterday.setDate(yesterday.getDate() - 1);
      if (stamps.has(stampOf(yesterday))) cursor = yesterday;
      else return 0;
    }
    let count = 0;
    while (stamps.has(stampOf(cursor))) {
      count++;
      const prev = new Date(cursor);
      prev.setDate(prev.getDate() - 1);
      cursor = prev;
    }
    return count;
  }, [logs, cardioLogs]);

  const lastWorkoutDate = useMemo(() => {
    const all = [...logs.map(l => l.date), ...cardioLogs.map(l => l.date)]
      .map(parseLocalDate)
      .filter(d => d && !isNaN(d.getTime()));
    if (all.length === 0) return null;
    return new Date(Math.max(...all.map(d => d.getTime())));
  }, [logs, cardioLogs]);

  // Most-recent meal date for the StreakRescueCard's "logged anything
  // today?" check. Same parseLocalDate convention as workout dates so
  // the late-evening / timezone-edge cases line up.
  const lastMealDate = useMemo(() => {
    const all = rawNutritionLogs
      .map(l => l.date)
      .map(parseLocalDate)
      .filter(d => d && !isNaN(d.getTime()));
    if (all.length === 0) return null;
    return new Date(Math.max(...all.map(d => d.getTime())));
  }, [rawNutritionLogs]);

  const daysSinceLast = useMemo(() => {
    if (!lastWorkoutDate) return null;
    return differenceInDays(today, startOfDay(lastWorkoutDate));
  }, [lastWorkoutDate, today]);

  const hasWorkedOutToday = daysSinceLast === 0;

  // Time-aware greeting
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return t('dashboard.greeting.lateNight');
    if (h < 12) return t('dashboard.greeting.morning');
    if (h < 17) return t('dashboard.greeting.afternoon');
    if (h < 22) return t('dashboard.greeting.evening');
    return t('dashboard.greeting.night');
  }, [t]);

  // full_name FIRST. This read `username || full_name`, so an account whose
  // handle was auto-generated greeted its owner as "Evening work, revu14404."
  // while their real name sat unused one property away. The username is a
  // database key; the name is what a person answers to.
  const firstName = user?.full_name?.trim().split(/\s+/)[0] || user?.username || '';
  const todayLabel = format(new Date(), 'EEEE, MMMM d', { locale: getDateLocale(language) });

  // Format weekly volume nicely (1.2k for big numbers).
  // Use fmt() for ALL branches so digit grouping + decimal separator
  // respect the user's locale (matches CrewStatsPanel.fmtVolume).
  // Previously: `(n/1000).toFixed(1)` rendered "1.5k" for German users
  // who expect "1,5k", and English digits for Arabic users.
  const formatVolume = (n) => {
    // Guard at entry — a NaN/Infinity from upstream (corrupt set, broken
    // import) would otherwise fall through every branch and render as
    // "NaN" in the stats tile. Treat unrenderable inputs as zero.
    if (!Number.isFinite(n)) return fmt(0);
    if (n >= 10000) return `${fmt(Math.round(n / 1000))}k`;
    if (n >= 1000) return `${fmt(n / 1000, { maximumFractionDigits: 1 })}k`;
    return fmt(n);
  };

  /* ── Section renderer for drag-to-reorder ──────────────────────── */
  const renderDashboardSection = (id, paired = false) => {
    switch (id) {
      case 'readiness':
        // Readiness now lives in the hero (a 2/3 CTA + 1/3 Readiness row —
        // see HeroCard). Return null here so a saved widgetOrder that still
        // lists 'readiness' can't render it a second time as a section.
        return null;
      // "Tonight" — sleep · mood · steps as one three-column row. Keeps the
      // section id `recovery` deliberately: every saved widgetOrder,
      // sectionLayouts and hiddenSections entry out there already refers to
      // it, so renaming the id would silently discard those users' choices
      // and reappear as a section they had hidden. Only the label changed.
      //
      // Gone from here: MacroRingWidget, CalorieProgressWidget and
      // HydrationRing. All three duplicated the Nutrition tab, which owns
      // MacroNutrientBox, CalorieTopBar and WaterTracker — no feature lost.
      // Sleep / mood / steps are NOT duplicated anywhere, which is why they
      // stayed on the page rather than going with them.
      case 'recovery': return (
        <React.Fragment key="recovery">
          <section aria-labelledby="dash-tonight-heading">
            <div className="flex items-baseline justify-between gap-2 mb-2 px-1">
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden="true" />
                <h2 id="dash-tonight-heading" className="font-heading font-bold text-sm tracking-tight truncate">
                  {tFallback('dashboard.section.tonight', 'Tonight')}
                </h2>
              </span>
              <span className="text-micro font-semibold text-muted-foreground/70 shrink-0 cq-hide">
                {tFallback('dashboard.tonight.note', 'feeds your readiness')}
              </span>
            </div>
            <ErrorBoundary label="TonightRow">
              <TonightRow readiness={readiness} onOpen={openReadiness} />
            </ErrorBoundary>
          </section>
        </React.Fragment>
      );
      // Moved out of the hero (see HeroCard) — the pill carries its own
      // "3 days streak" text and expands its calendar inline, so it needs no
      // section label above it.
      case 'streak': return (
        <React.Fragment key="streak">
          <ErrorBoundary label="LoginStreakBanner">
            <LoginStreakBanner variant="default" />
          </ErrorBoundary>
        </React.Fragment>
      );
      // The three weekly figures, promoted out of 'progress' into their own
      // row under the hero. One card with hairline dividers, not three cards.
      case 'stats': return (
        <React.Fragment key="stats">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card className="py-4 px-1 divide-x divide-border flex items-stretch cq-stack-y">
              <StatColumn
                icon={Activity}
                value={thisWeekLogs.length}
                label={t('dashboard.stats.thisWeek')}
                suffix={thisWeekLogs.length === 1 ? t('dashboard.stats.workoutSingular') : t('dashboard.stats.workoutPlural')}
                accent
                trend={workoutTrend}
              />
              <StatColumn
                icon={Zap}
                value={formatVolume(weeklyVolume)}
                label={t('dashboard.stats.volume')}
                suffix={weightUnit}
              />
              <StatColumn
                icon={Target}
                value={muscleGroupCount}
                label={t('dashboard.stats.muscles')}
                suffix={muscleGroupCount === 1 ? t('dashboard.stats.groupSingular') : t('dashboard.stats.groupPlural')}
                trend={muscleTrend}
              />
            </Card>
          </motion.div>
        </React.Fragment>
      );
      case 'challenges': return (
        <React.Fragment key="challenges">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.15 }}>
            <ErrorBoundary label="DailyQuestsCard"><DailyQuestsCard /></ErrorBoundary>
          </motion.div>
        </React.Fragment>
      );
      // Streak rescue is its own row, below the friend leaderboard, per board
      // 01. It used to render inside 'challenges', glued 8px under Daily
      // Quests — which read as a third quest rather than the "you are about to
      // lose a streak" interrupt it is.
      //
      // A section rather than a tail on 'friends': hanging it off another
      // section means hiding that section silently removes the streak rescue
      // too, and the one card that saves a run of training is the worst thing
      // to lose to a decision about a leaderboard.
      //
      // No defaults-version bump needed. mergeWidgetOrder splices an id the
      // user has never seen in at its default index, so existing layouts pick
      // this up in the right slot on next load.
      case 'rescue': return (
        <React.Fragment key="rescue">
          {/* Rest day means the streak is deliberately paused, so the rescue
              prompt would be nagging about a choice the user just made. */}
          {!isRestDay && (
            <StreakRescueCard
              streakDays={streak}
              lastWorkoutDate={lastWorkoutDate?.toISOString()}
              lastMealDate={lastMealDate?.toISOString()}
            />
          )}
        </React.Fragment>
      );
      case 'chest': return (
        <React.Fragment key="chest">
          <ErrorBoundary label="DailyChestCard"><DailyChestCard /></ErrorBoundary>
        </React.Fragment>
      );
      // No motion.div wrapper here, deliberately. LeagueCard returns null
      // until the user is actually in a league, and a wrapper div renders
      // either way — which is what stranded the old readiness + league pair
      // next to an empty half. With nothing between the fragment and the
      // card, a null card means this section renders NO DOM, so the paired
      // wrapper's `empty:hidden` collapses it and Daily chest takes the full
      // width. stretch keeps it the same height as its partner.
      case 'league': return (
        <React.Fragment key="league">
          <ErrorBoundary label="LeagueCard"><LeagueCard stretch onClick={() => setLeagueModalOpen(true)} /></ErrorBoundary>
        </React.Fragment>
      );
      case 'friends': return (
        <React.Fragment key="friends">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.12 }}>
            <ErrorBoundary label="FriendLeaderboard"><FriendLeaderboardPanel /></ErrorBoundary>
          </motion.div>
        </React.Fragment>
      );
      // Every card in this section needs data: goals for the two goal cards,
      // logs (or cardio logs) for the recap, the suggestion and the memory.
      // With none of the three, all five render null and the section was a
      // "Your progress" label above an empty gap — which is what a brand-new
      // account saw. A label is a promise that content follows, so don't make
      // it. This is a definite-empty guard, not an emptiness oracle: any one
      // of the three arrays having rows means something can render.
      case 'progress': {
        if (goals.length === 0 && logs.length === 0 && cardioLogs.length === 0) return null;
        return (
        <React.Fragment key="progress">
          <SectionLabel label={tFallback('dashboard.section.progress', 'Your progress')} />
          {/* Stat tiles moved out to the 'stats' section (its own row, under
              the hero). What's left here is goals → the week → what to do
              next, in that order. */}
          <div className="space-y-2">
            <ErrorBoundary label="GoalsAlmostComplete">
              <GoalsAlmostComplete goals={goals} logs={logs} cardioLogs={cardioLogs} limit={1} compact={false} onOpen={() => setGoalsModalOpen(true)} />
            </ErrorBoundary>
            <ErrorBoundary label="GoalsProgressStrip">
              <GoalsProgressStrip goals={goals} logs={logs} onOpen={() => setGoalsModalOpen(true)} />
            </ErrorBoundary>
            <div data-recap-card>
              <ErrorBoundary label="WeeklyRecap"><WeeklyRecap logs={logs} cardioLogs={cardioLogs} /></ErrorBoundary>
            </div>
            {/* Suggestion + memory as a real 2-up from 380px rather than a
                flex-wrap with a 15rem min: on a 390px phone that min forced
                them to stack anyway, so the pair never happened where it
                matters. empty:hidden keeps a card that renders null from
                leaving half a row of dead space. */}
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2 items-start">
              <div className="min-w-0 empty:hidden">
                <ErrorBoundary label="WorkoutSuggestionCard"><WorkoutSuggestionCard logs={logs} cardioLogs={cardioLogs} /></ErrorBoundary>
              </div>
              <div className="min-w-0 empty:hidden">
                <ErrorBoundary label="WorkoutMemoryCard"><WorkoutMemoryCard logs={logs} /></ErrorBoundary>
              </div>
            </div>
          </div>
        </React.Fragment>
        );
      }
      case 'actions': {
        // 4 × 2 grid. Eight tiles, nothing behind a toggle: the old vertical
        // list showed three of seven actions and hid the other four, which is
        // how "Add progress photo" and "Log weight" ended up effectively
        // undiscoverable on the page that owns them.
        //
        // The eighth tile is the widget library — the entry point the
        // 'customize' section used to be the only route to.
        const actions = [
          { key: 'startWorkout',  to: '/workout', icon: Play, accent: true,
            label: t('dashboard.startWorkout') },
          { key: 'myWeek',        icon: CalendarDays, label: tFallback('dashboard.myWeek', 'My Week'),
            onClick: () => setWeekModalOpen(true) },
          { key: 'createRegimen', icon: Dumbbell,     label: t('dashboard.createRegimen'),
            onClick: () => navigate('/workout', { state: { openRegimens: true } }) },
          { key: 'checkProgress', icon: TrendingUp,   label: t('dashboard.checkProgress'),
            onClick: () => { window.scrollTo({ top: 0, behavior: 'auto' }); navigate('/progress'); } },
          { key: 'logMeal',       icon: Apple,        label: t('dashboard.logMeal'),
            onClick: () => navigate('/nutrition', { state: { openLogMeal: true } }) },
          { key: 'logWeight',     icon: Scale,        label: tFallback('dashboard.logWeight', 'Log weight'),
            onClick: () => setLogWeightOpen(true) },
          { key: 'addPhoto',      icon: Camera,       label: tFallback('dashboard.addPhotoShort', 'Add photo'),
            onClick: () => setPhotoCaptureOpen(true) },
          { key: 'widgets',       icon: LayoutGrid,   label: tFallback('dashboard.actions.widgets', 'Widgets'),
            onClick: () => {
              try {
                document.getElementById('dash-widget-library')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } catch { /* older WebViews — no-op */ }
            } },
        ];
        return (
          <React.Fragment key="actions">
            <SectionLabel label={t('dashboard.quickActions')} />
            {/* cq-cols-2: paired into a half slot, 4 columns give each tile
                ~33px and every label stacks one word per line. */}
            <div className="grid grid-cols-4 gap-2 cq-cols-2">
              {actions.map((a, i) => (
                <ActionTile
                  key={a.key}
                  to={a.to}
                  icon={a.icon}
                  label={a.label}
                  onClick={a.onClick}
                  accent={a.accent}
                  delay={0.04 + i * 0.02}
                />
              ))}
            </div>
          </React.Fragment>
        );
      }
      case 'journal': return (
        <React.Fragment key="journal">
          <ErrorBoundary label="JournalWidget">
            <JournalWidget userId={user?.id} userEmail={user?.email} />
          </ErrorBoundary>
        </React.Fragment>
      );
      // DiscoveryCards renders ONE card — the highest-priority one whose
      // precondition holds — or null when none qualifies or everything has
      // been dismissed. dash-section-body has exactly that one child, so it
      // is genuinely :empty in the null case and the CSS in index.css takes
      // the label down with it.
      case 'discover': return (
        <React.Fragment key="discover">
          <div className="dash-section">
            <SectionLabel label={tFallback('dashboard.section.discover', 'Discover')} />
            <div className="dash-section-body">
              <ErrorBoundary label="DiscoveryCards">
                <DiscoveryCards
                  logs={rawLogs}
                  regimens={rawRegimens}
                  isLoading={logsLoading || regimensLoading}
                />
              </ErrorBoundary>
            </div>
          </div>
        </React.Fragment>
      );
      case 'motivation': return (
        <React.Fragment key="motivation">
          <DailyQuote editMode={editMode} />
        </React.Fragment>
      );
      case 'onboarding': return (
        <React.Fragment key="onboarding">
          <div className="space-y-2">
            {/* OnboardingNudgeCard removed — its suggestions (log a workout,
                follow a friend, try a regimen, share your week, invite,
                notifications) now rotate as slides in the hero carousel. */}
            <ErrorBoundary label="PushOptInBanner">
              <PushOptInBanner hasWorkouts={rawLogs.length > 0} />
            </ErrorBoundary>
            <ErrorBoundary label="IosInstallBanner">
              <IosInstallBanner />
            </ErrorBoundary>
          </div>
        </React.Fragment>
      );
      case 'customize': return (
        <React.Fragment key="customize">
          {/* Board 01 gives this the same dot + heading + note every other
              section gets. It was the only section announcing itself
              differently — DashboardWidgets carried its own <h2> reading
              "Your Widgets" — so the last thing on the page looked like it
              belonged to another screen. The <h2> is gone from that component;
              its edit toggle stays where it was. */}
          {/* No `note` here, unlike the board. Board 01 draws "Edit layout" as
              the note because it draws no Edit button; the real component has
              one, so rendering both put the words "Edit layout" directly above
              a button reading "Edit" — seen on the rendered page, not reasoned
              about. The button is the affordance, so the label stays bare. */}
          <SectionLabel label={tFallback('dashboard.section.customize', 'Widget library')} />
          {/* id is the scroll target for the Widgets action tile. */}
          <motion.div
            id="dash-widget-library"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, delay: 0.25 }}
          >
            <DashboardWidgets logs={logs} goals={goals} isLoading={isLoading} userProfile={userProfile} />
          </motion.div>
        </React.Fragment>
      );
      default: return null;
    }
  };

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22 }}
      className="px-4 md:px-6 pt-1 md:pt-2 lg:pb-6 max-w-5xl mx-auto"
    >
      {/* ── Stories ──────────────────────────────────────────────
           Pinned to the very top (above the greeting) to maximize
           social engagement — the one card kept out of the priority
           tiering below by product decision. */}
      <StoriesRow
        onViewProfile={(u) =>
          navigate('/hub?profile=' + encodeURIComponent(u.id || u.email))
        }
      />

      {/* ═══ TIER 1 · Orient & act ════════════════════════════════ */}

      {/* ── Greeting block ─────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: 'easeOut' }}
        className=""
      >
        <p className="text-micro font-semibold tracking-[0.04em] text-muted-foreground mb-1.5">
          {todayLabel}
        </p>
        <div className="flex items-start justify-between gap-2">
          <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight leading-tight flex-1 min-w-0">
            <span className="text-muted-foreground/80">{greeting}</span>
            {firstName && (
              <>
                <span className="text-muted-foreground/80">, </span>
                <span className="text-foreground">{firstName}</span>
              </>
            )}
            <span className="text-primary">.</span>
          </h1>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            {/* Reset-customize — only shown in edit mode. Restores
                the default widgetOrder + sectionLayouts. */}
            {editMode && canSetAsDefault && (
              <button
                type="button"
                onClick={handleSetAsDefault}
                title="Save this layout as the default for all new users"
                className="flex items-center gap-1 px-2 py-1.5 rounded-full bg-secondary text-micro font-semibold text-foreground hover:bg-secondary/80 active:bg-secondary/70 transition-colors"
              >
                {/* Board 03 draws a plus here, not a floppy disk. "Set
                    default" adds this layout to what new accounts get; save
                    is what the button does to the record, not what the user
                    is doing. */}
                <Plus className="w-3 h-3" />
                <span>Set default</span>
              </button>
            )}
            {editMode && (
              <button
                type="button"
                onClick={handleResetCustomize}
                title={tFallback('dashboard.resetCustomize', 'Reset to default')}
                className="flex items-center gap-1 px-2 py-1.5 rounded-full bg-secondary text-micro font-semibold text-foreground hover:bg-secondary/80 active:bg-secondary/70 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{tFallback('dashboard.reset', 'Reset')}</span>
              </button>
            )}
            {/* Rest-day toggle removed — it was an unused slide switch
                cluttering the greeting header. */}
            {/* Dropped the duplicate "Set Default" button that was here —
                it only wrote to localStorage which is per-device. The
                first "Set default" above (handleSetAsDefault) uses the
                proper server-side RPC and is the canonical action. */}
            <button
              onClick={() => setEditMode(e => !e)}
              title={editMode ? tFallback('dashboard.doneEditing', 'Done editing') : tFallback('dashboard.customizeHome', 'Customize home')}
              // Three pills in a row in edit mode, and board 03 draws them as
              // pills: two on --secondary, Done on --primary. rounded-lg read
              // as three buttons that happened to sit together.
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full text-micro font-semibold transition-colors ${
                editMode
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground/60 hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary'
              }`}
            >
              {editMode ? (
                <><CheckCircle2 className="w-3 h-3" /><span>{tFallback('dashboard.done', 'Done')}</span></>
              ) : (
                <LayoutGrid className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showWelcome && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, delay: 0.2 }}
              className="text-sm text-muted-foreground mt-2"
            >
              {t('dashboard.welcomeBack')}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>

      {/* "Continue where you left off" — only renders when there's a
          paused workout in localStorage. Peace-of-mind affordance for
          users interrupted mid-workout. Auto-evicts drafts >24h old
          so it doesn't degrade into "you have nothing to do" noise. */}
      <ResumeWorkoutBanner />

      {/* ── Streak banners — sit between the greeting and the hero so
            the user sees their daily streak the moment they open the
            app. Kept compact via the banners' own min variants. ───── */}
      {/* ── Hero ───────────────────────────────────────────────── */}
      {/* mt-5 gives the hero breathing room below the greeting when no
          Resume banner sits between them; when the banner IS present its
          own margin collapses with this one, so the gap stays consistent. */}
      <div className="mt-5 mb-2">
        <HeroCard
          streak={streak}
          hasWorkedOutToday={hasWorkedOutToday}
          daysSinceLast={daysSinceLast}
          logs={logs}
          cardioLogs={cardioLogs}
          goals={goals}
          userProfile={userProfile}
          user={user}
          // The hero's own button ("Start your first workout" / "Continue
          // the streak" / "Log another") opens a freestyle session directly.
          // ?freestyle=1 is handled in Workout.jsx — landing on that page's
          // picker meant pressing Start twice to start one workout.
          onPrimary={() => navigate('/workout?freestyle=1')}
          onReadinessInfo={() => openReadiness()}
          onPlanWeek={() => setWeekModalOpen(true)}
          navigate={navigate}
          t={t}
          tFallback={tFallback}
        />
      </div>

      {/* Repeat-last-workout moved OFF the dashboard — it lives on the
          Workout page now (Workout.jsx repeat flow), per cleanup: the
          dashboard was too busy and this duplicated a Workout-tab action. */}

      {/* Hidden-sections chip rail — only renders in edit mode and
          only when the user has actually hidden something. Tapping a
          chip restores that section to the end of the visible list.

          Solid border, per board 03. Dashed reads as a drop target — this
          rail is a shelf you take things off, not one you drag onto. */}
      {editMode && hiddenSections.size > 0 && (
        <div className="mt-4 mb-3 p-3 rounded-lg border border-border bg-secondary/30">
          <p className="font-mono text-micro font-bold tracking-[0.04em] text-muted-foreground mb-2">
            {tFallback('dashboard.hiddenSections', 'Hidden — tap to restore')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(hiddenSections).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => restoreSection(id)}
                className="flex items-center gap-1 px-2 py-1 rounded-full border border-primary/40 bg-primary/5 text-primary text-micro font-semibold hover:bg-primary/10 active:bg-primary/20 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {SECTION_LABELS[id]?.(tFallback, t) || id}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Reorderable rows — each row holds 1 section (hamburger /
              full-width) or 2 sections side-by-side (hotdog / half).
              Edit mode: long-press the drag handle to move a row, tap
              the layout icon to switch between hamburger and hotdog.
              Hotdog pairs travel together when reordered. ═══ */}
      <Reorder.Group axis="y" values={rows.map(r => r.rowKey)} onReorder={handleWidgetReorder} as="div">
        {rows.map((row, rowIndex) => {
          // Two spacing registers only: 8px inside a group, 24px between
          // sections (CLAUDE.md bans 12–20px, which is exactly what the old
          // mb-3 was). Exactly ONE 32px break on the page, and it sits
          // wherever the action block currently ends — the seam between
          // "do something now" and "here's how it's going". Computed from
          // the live order so dragging the grid somewhere else moves the
          // break with it instead of stranding it mid-page.
          // Pinned to one row for the length of a drag, or the seam hops to
          // whichever row currently follows 'actions' and shifts everything
          // below it by 32px on every crossing.
          const prevRow = rowIndex > 0 ? rows[rowIndex - 1] : null;
          const afterActions = dragRows
            ? row.rowKey === seamRowKey
            : (!!prevRow && prevRow.sections.includes('actions'));
          return (
          <ReorderableRow
            key={row.rowKey}
            value={row.rowKey}
            // `layout` defaults to TRUE on Reorder.Item, and outside edit mode
            // it is pure downside. Reorder's projection is built for drag
            // reordering — a stable list where only the ORDER changes. Here the
            // list MEMBERSHIP changes as each query resolves: sections render
            // null until their data lands, so `dashboardRows` is rebuilt several
            // times in the first second. Project across two different lists and
            // a row can be left holding a delta it never resolves — the row
            // keeps its flow box while painting somewhere else, so a gap opens
            // where it belongs and it lands on top of the two rows below.
            //
            // That is the Discover-on-top-of-the-quote overlap. Measured in
            // isolation against framer-motion 11.18.2: with `layout` on, the
            // row settles at a permanent translateY of -320px after the row
            // list changes twice; with it off, 0px across repeated churn.
            //
            // Editing keeps it, because that is when rows genuinely reorder and
            // the animation is the whole point. Nothing reorders outside edit
            // mode — the drag handle only renders there either.
            //
            // 'position' rather than `true`: rows differ a lot in height, and
            // animating SIZE as well as position is what squashes the card
            // being held. Nothing legitimately resizes during a reorder now
            // that pairing is frozen for the gesture, so there is no size
            // change worth animating. Nutrition already made this choice.
            layout={editMode ? 'position' : false}
            onDragStart={beginRowDrag}
            onDragEnd={endRowDrag}
            className={`relative ${afterActions ? 'mt-8' : ''}${editMode ? ' select-none' : ''}`}
          >
            {(dragControls) => (<>
            {editMode && (
              <div className="flex items-center gap-2 mt-6 mb-1 px-1">
                {/* The strip runs at full strength in board 03 — grip and
                    labels in --primary, × in --destructive. Dimming every
                    control to 50-60% made the row of things you came here to
                    use the faintest thing on the screen. */}
                <DragHandle
                  dragControls={dragControls}
                  label={tFallback('dashboard.editLegend.drag', 'Long-press and drag to reorder a section')}
                />
                {row.sections.map((id, i) => {
                  const layout = sectionLayouts[id] || 'full';
                  const isHalf = layout === 'half';
                  const isCollapsed = collapsedSections.has(id);
                  return (
                    <React.Fragment key={id}>
                      {i > 0 && <span className="text-micro text-primary/50">+</span>}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleSectionLayout(id); }}
                        title={isHalf
                          ? tFallback('dashboard.layout.toHamburger', 'Stack full-width')
                          : tFallback('dashboard.layout.toHotdog',     'Pair side-by-side')}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm hover:bg-primary/10 active:bg-primary/20 text-primary transition-colors"
                      >
                        {isHalf
                          ? <Columns2 className="w-3 h-3" />
                          : <Rows3    className="w-3 h-3" />}
                        <span className="text-micro font-bold tracking-[0.04em]">
                          {SECTION_LABELS[id]?.(tFallback, t) || id}
                        </span>
                      </button>
                      {/* Collapse — the old "Hide / Show all" header on every
                          section, moved in here beside drag / pair / hide so
                          normal mode carries content instead of controls. */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleCollapsed(id); }}
                        title={isCollapsed
                          ? tFallback('dashboard.showAll', 'Show all')
                          : tFallback('dashboard.hide', 'Hide')}
                        aria-label={isCollapsed
                          ? tFallback('dashboard.showAll', 'Show all')
                          : tFallback('dashboard.hide', 'Hide')}
                        aria-expanded={!isCollapsed}
                        className="flex items-center justify-center w-5 h-5 rounded-sm hover:bg-primary/10 active:bg-primary/20 text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                      >
                        {/* Right when collapsed, down when open — the
                            disclosure convention board 03 draws. Down/up read
                            as "move it", which is the grip's job. */}
                        {isCollapsed
                          ? <ChevronRight className="w-3 h-3" />
                          : <ChevronDown  className="w-3 h-3" />}
                      </button>
                      {/* Per-section hide button — tapping this removes
                          the section from the user's dashboard. The
                          section is restorable from the "Hidden" chip
                          rail (rendered above the first row in edit
                          mode). 'customize' is intentionally NOT
                          hideable since it's how users re-add widgets
                          back from the library. */}
                      {id !== 'customize' && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); hideSection(id); }}
                          title={tFallback('dashboard.hideSection', 'Hide this section')}
                          aria-label={tFallback('dashboard.hideSection', 'Hide this section')}
                          className="flex items-center justify-center w-5 h-5 rounded-sm hover:bg-destructive/15 active:bg-destructive/15 text-destructive transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
            {/* The 24px inter-section gap lives on THIS div, not on the
                Reorder.Item, and it carries empty:hidden. Several sections
                render nothing depending on state (LeagueCard before you join
                a league, DailyChestCard before it's ready, the friends panel
                with no friends) and the old markup left a gap behind for
                each one — margin on a wrapper that was still in the layout.
                Now an empty section costs zero pixels, while edit mode still
                shows its control strip so it can be found and reordered. */}
            <div className={`mb-6 empty:hidden ${row.sections.length === 2 ? 'flex items-stretch gap-2' : ''}`}>
              {row.sections.map(id => {
                // Default hotdog = 50/50. empty:hidden so a half that renders
                // nothing gives its width back to its partner instead of
                // leaving a hole.
                //
                // dash-slot makes this wrapper a container query context, so
                // a card inside it can lay itself out against ~171px instead
                // of against the 375pt viewport (which is identical either
                // way, and is why this was broken for every paired card). Only
                // on paired rows — a full-width row has no container, so the
                // compact rules can't fire there. See index.css.
                const widthClass = row.sections.length === 2
                  ? 'flex-1 min-w-0 empty:hidden dash-slot'
                  : '';
                return (
                  <div key={id} className={widthClass}>
                    {collapsedSections.has(id)
                      ? (
                        <CollapsedStub
                          label={SECTION_LABELS[id]?.(tFallback, t) || id}
                          onExpand={() => toggleCollapsed(id)}
                          tFallback={tFallback}
                        />
                      )
                      : renderDashboardSection(id, row.sections.length === 2)}
                  </div>
                );
              })}
            </div>
            </>)}
          </ReorderableRow>
          );
        })}
      </Reorder.Group>

      {/* ── Edit-mode legend (board 03) ────────────────────────────────
          Four icons in a strip with no labels, explained only by `title`
          tooltips — which a touch device never fires. This app ships to
          iOS and Android, so until now nothing on a phone said what grip,
          hamburger, hotdog, chevron or × actually did.

          Icon colours are the strip's own semantics, which is the whole
          point of the legend: primary for the three that rearrange, muted
          for collapse, destructive for hide. Read them here, recognise
          them up there.

          The six strings now live in i18n-dashboard-redesign.js across all
          15 languages, taken as a set so the part file keeps its "no English
          fallbacks" contract. The inline English stays as the tFallback
          second argument per the app-wide convention — it is the fallback,
          not the source. "Hamburger" and "hotdog" are loanwords in every
          locale: they are Flexyn's names for the two shapes, and a
          translated nickname would stop matching what the strip teaches. */}
      {editMode && (
        <div className="mt-6 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden="true" />
            <h2 className="font-heading font-bold text-body">
              {tFallback('dashboard.editLegend.title', 'Four controls, one strip')}
            </h2>
          </div>
          <ul className="space-y-1">
            {[
              { Icon: GripVertical, tone: 'text-primary',     key: 'drag',      en: 'Long-press and drag to reorder a section' },
              { Icon: Rows3,        tone: 'text-primary',     key: 'hamburger', en: 'Stack full-width — hamburger' },
              { Icon: Columns2,     tone: 'text-primary',     key: 'hotdog',    en: 'Pair side-by-side — hotdog (travels as one)' },
              { Icon: ChevronDown,  tone: 'text-muted-foreground', key: 'collapse', en: 'Collapse — replaces the per-card chevron' },
              { Icon: X,            tone: 'text-destructive', key: 'hide',      en: 'Hide — comes back from the rail at the top' },
            ].map(({ Icon, tone, key, en }) => (
              <li key={key} className="flex items-center gap-2">
                <Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} aria-hidden="true" />
                <span className="text-caption">{tFallback(`dashboard.editLegend.${key}`, en)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Prestige prompt — only when at max level ───────────── */}
      {isPrestigeEligible(userProfile) && !userProfile.prestige_dismissed && (
        <ErrorBoundary label="PrestigePrompt">
          <PrestigePrompt currentPrestige={userProfile.prestige_level || 0} />
        </ErrorBoundary>
      )}

      <GoalsModal
        open={goalsModalOpen}
        onClose={() => setGoalsModalOpen(false)}
        goals={goals}
        logs={logs}
        userProfile={userProfile}
      />

      <LeagueStandingsModal
        open={leagueModalOpen}
        onClose={() => setLeagueModalOpen(false)}
      />

      {/* Readiness sheet — the score breakdown AND the sleep / mood /
          steps loggers, opened by the Readiness card in the hero or by any
          column of the Tonight row. Was a ~130-line inline modal here that
          explained the score and then pointed at a section further down the
          page to actually log anything; that section no longer exists, so
          the controls moved into the sheet and this became one lazy import.
          Suspense fallback is null: the sheet is the response to a tap, and
          a skeleton that flashes for one frame reads as a glitch. */}
      {readinessSheetOpen && (
        <Suspense fallback={null}>
          <ReadinessSheet
            open={readinessSheetOpen}
            onClose={() => setReadinessSheetOpen(false)}
            readiness={readiness}
            focus={readinessFocus}
            onLogWorkout={() => navigate('/workout')}
          />
        </Suspense>
      )}

      {/* Season-end ceremony. Same Suspense-null reasoning as the readiness
          sheet: it opens in response to a tap, so a one-frame skeleton reads
          as a glitch. */}
      {seasonCeremonyOpen && seasonResult && (
        <Suspense fallback={null}>
          <SeasonCeremonyModal
            open={seasonCeremonyOpen}
            onClose={() => setSeasonCeremonyOpen(false)}
            result={seasonResult}
            onOpenTrophyCase={() => navigate('/hub?tab=profile')}
          />
        </Suspense>
      )}

      {/* Dashboard-level quick-action modals.
          LogWeightModal writes a body-metric row AND mirrors to
          user_profiles.weight_lbs so the global weight stays in sync.
          ProgressPhotoCapture runs in controlled mode (no internal
          trigger button) — the parent owns the prompt's open state. */}
      <LogWeightModal
        open={logWeightOpen}
        onOpenChange={setLogWeightOpen}
        profile={userProfile}
      />

      <RoutineCalendarModal open={weekModalOpen} onClose={() => setWeekModalOpen(false)} />
      <ErrorBoundary label="ProgressPhotoCapture">
        <ProgressPhotoCapture
          workoutName={null}
          open={photoCaptureOpen}
          onOpenChange={setPhotoCaptureOpen}
        />
      </ErrorBoundary>

      {/* Subtle "Synced Xm ago" footer. Tappable to force refresh of all
          primary Dashboard queries. Trust signal — when a user wonders
          "is this stale?" they get a clear answer at a glance, and a
          one-tap path to fix it. Color shifts amber/red as data ages. */}
      <div className="mt-2 flex justify-center">
        <SyncStatus dataUpdatedAt={logsUpdatedAt} />
      </div>
    </motion.div>
  );
}