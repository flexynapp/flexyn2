// src/components/dashboard/TonightRow.jsx
//
// Now the Recovery card (Kegan, 27 Sep): the readiness score used to be a
// chip in the hero while its inputs sat here, two places for one idea. The
// score heads this card as the result, and sleep, mood and steps sit under
// it as what produced it. The file keeps its name so the log-card
// invalidation test that pins it still reaches it.
//
// The three recovery signals — sleep, mood, steps — as ONE row of three
// columns instead of three separate cards (plus the macro / calorie /
// hydration cards that used to sit with them and now live only on the
// Nutrition tab, which already owns MacroNutrientBox, CalorieTopBar and
// WaterTracker).
//
// Why a row and not six cards: the six-card "Nutrition & Recovery" stack
// cost ~600px of the dashboard for data the user glances at, and three of
// those cards duplicated the Nutrition tab outright. But sleep, mood and
// steps could NOT just be deleted: this was their only surface in the app,
// and they are 85% of the Readiness score (sleep 40%, quality 20%,
// mood/soreness 25%). So the glance stays on the page at ~100px and the
// controls live one tap away in ReadinessSheet, beside the score they feed.
//
// Read-only here by design. Tapping a column opens the sheet focused on
// that signal, where the real SleepLogCard / MoodLogCard / StepsLogCard
// do the logging — one implementation of each logger, not two.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import useCountUp from '@/hooks/useCountUp';
import { motion } from 'framer-motion';
import { Moon, Smile, Footprints, Star, ChevronRight, Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { getTodayStepLog } from '@/lib/data/stepLogs';
import { MOOD_LABELS } from '@/lib/data/moodLogs';
import ReadinessRing, { readinessColors } from '@/components/dashboard/ReadinessRing';
import { ACTION_BY_LABEL } from '@/components/dashboard/ReadinessCard';

// A DISPLAY reference for the steps bar, not a stored goal — step_logs
// holds a count and nothing else, so there is no per-user target to read.
// 10k is the conventional default; the bar carries no "of your goal" copy
// precisely because we would be inventing that goal.
const STEP_REFERENCE = 10000;

function Column({ icon: Icon, iconClass, label, value, logged, onClick, ariaLabel, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex-1 min-w-0 px-3 py-1 text-start rounded-sm hover:bg-secondary/40 active:bg-secondary/60 active:scale-[0.98] motion-reduce:active:scale-100 transition-[background-color,transform] duration-150"
    >
      <span className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
        <Icon className={`w-3 h-3 shrink-0 ${iconClass}`} aria-hidden="true" />
        <span className="text-micro font-semibold tracking-[0.04em] truncate">{label}</span>
      </span>
      <span
        className={`block leading-none tabular-nums truncate ${
          logged ? 'font-heading font-bold text-xl text-foreground' : 'text-sm font-semibold text-primary'
        }`}
      >
        {value}
      </span>
      {/* The stars, dots and bar only mean something beside a value. Under
          an empty column they drew five hollow stars and a flat bar, which
          read as a bad night rather than no entry. The height is kept so
          the three columns stay aligned. */}
      <span className="mt-2 h-3 flex items-center">{logged ? children : null}</span>
    </button>
  );
}

export default function TonightRow({ readiness, onOpen }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();

  // Steps is the one signal useReadiness doesn't already hold, so it's the
  // only query this row adds. Sleep + mood arrive as props from the
  // Dashboard's existing useReadiness call — querying them again here
  // would be a second copy of the same two reads.
  const { data: stepLog } = useQuery({
    queryKey: ['stepLogToday', user?.id],
    queryFn: getTodayStepLog,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const hours = readiness?.sleep?.hours ?? null;
  const quality = readiness?.sleep?.quality ?? null;
  const mood = readiness?.mood?.mood ?? null;
  const steps = stepLog?.steps ?? null;
  // Count the steps up and drive the bar from the SAME tweened value, so the
  // figure and the fill arrive together rather than the bar snapping while
  // the number is still rolling. null passes through untouched, which keeps
  // "no entry" distinct from zero. Reduced motion returns `steps` as is.
  const countedSteps = useCountUp(steps, { duration: 700 });

  // An unlogged column says what tapping does rather than showing a dash.
  const add = (
    <span className="inline-flex items-center gap-0.5">
      <Plus className="w-3.5 h-3.5 stroke-[3]" aria-hidden="true" />
      {tFallback('today.recovery.log', 'Log')}
    </span>
  );

  // Readiness heads the card. Same rule as ReadinessCard: with neither sleep
  // nor soreness logged every input is a neutral default and the score is 70
  // for everyone, so no number shows until one of them exists.
  const scored = !!(readiness?.breakdown?.sleep?.logged || readiness?.breakdown?.soreness?.logged);
  const score = readiness?.score ?? 0;
  const countedScore = useCountUp(scored ? score : null, { duration: 800 });
  const colors = scored
    ? readinessColors(readiness?.label)
    : { text: 'text-muted-foreground', ring: 'hsl(var(--muted-foreground))' };
  const safeLabel = ACTION_BY_LABEL[readiness?.label] ? readiness.label : 'Ready';
  const readinessLabel = scored
    ? tFallback(`readiness.label.${safeLabel.toLowerCase()}`, safeLabel)
    : tFallback('today.readiness.unscoredLabel', 'Not scored');
  const readinessAction = scored
    ? tFallback(ACTION_BY_LABEL[safeLabel].key, ACTION_BY_LABEL[safeLabel].fallback)
    : tFallback('today.readiness.unscored', "Log last night's sleep to get a score.");
  const tapToLog = tFallback('dashboard.tonight.tapToLog', 'Tap to log');
  const nothingLogged = hours == null && mood == null && steps == null;

  // Nothing logged at all: one prompt instead of three columns of blanks.
  // It opens the sheet on sleep, the signal that weighs most in readiness.
  if (nothingLogged) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      >
        <Card>
          <button
            type="button"
            onClick={() => onOpen('sleep')}
            className="w-full flex items-center gap-3 px-4 py-4 text-start rounded-lg hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
          >
            <span className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
              <Moon className="w-4 h-4 text-info" />
              <Smile className="w-4 h-4 text-primary" />
              <Footprints className="w-4 h-4 text-success" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {tFallback('dashboard.tonight.emptyTitle', 'Log sleep, mood and steps')}
              </span>
              <span className="block text-xs text-muted-foreground">
                {tFallback('dashboard.tonight.emptySub', 'They make up most of your readiness score.')}
              </span>
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rtl:scale-x-[-1]" aria-hidden="true" />
          </button>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* cq-stack-y: three columns in a paired half slot give each signal
          ~50px, which truncates "8,240". Stacked, each keeps its full row.
          See the .dash-slot / cq-* block in index.css. */}
      <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => onOpen()}
        aria-label={tFallback('readiness.openLabel', 'Readiness. Tap for details')}
        className="w-full flex items-center gap-2 px-4 py-3 text-start hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
      >
        <ReadinessRing score={scored ? score : 0} color={colors.ring} size={36} stroke={3}>
          <span className="font-heading font-black text-xs tabular-nums">
            {scored ? Math.round(countedScore ?? score) : '—'}
          </span>
        </ReadinessRing>
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-1.5">
            <span className="text-micro font-bold tracking-[0.04em] text-muted-foreground">
              {tFallback('readiness.kicker', 'READINESS')}
            </span>
            <span className={`text-sm font-heading font-bold ${colors.text}`}>{readinessLabel}</span>
          </span>
          <span className="block text-xs text-muted-foreground leading-snug">{readinessAction}</span>
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rtl:scale-x-[-1]" aria-hidden="true" />
      </button>
      <div className="border-t border-border py-3 px-1 divide-x divide-border flex items-stretch cq-stack-y">
        <Column
          icon={Moon}
          iconClass="text-info"
          label={tFallback('dashboard.tonight.sleep', 'SLEEP')}
          value={hours != null ? `${hours} h` : add}
          logged={hours != null}
          onClick={() => onOpen('sleep')}
          ariaLabel={hours != null
            ? tFallback('dashboard.tonight.sleepLogged', 'Sleep logged. Open readiness')
            : `${tapToLog}: ${tFallback('dashboard.tonight.sleep', 'SLEEP')}`}
        >
          {/* Quality is optional when logging sleep, and most nights carry
              none. Five hollow stars under "7 h" read as a zero star night,
              so the stars appear only when a rating exists. */}
          {quality != null && [1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={`w-2.5 h-2.5 ${
                n <= quality
                  ? 'text-primary fill-primary'
                  : 'text-muted-foreground/30'
              }`}
              aria-hidden="true"
            />
          ))}
        </Column>

        <Column
          icon={Smile}
          iconClass="text-primary"
          label={tFallback('dashboard.tonight.mood', 'MOOD')}
          value={mood != null ? tFallback(`mood.label.${mood}`, MOOD_LABELS[mood - 1]) : add}
          logged={mood != null}
          onClick={() => onOpen('mood')}
          ariaLabel={mood != null
            ? tFallback('dashboard.tonight.moodLogged', 'Mood logged. Open readiness')
            : `${tapToLog}: ${tFallback('dashboard.tonight.mood', 'MOOD')}`}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`rounded-full me-1 ${
                mood === n
                  ? 'w-2.5 h-2.5 bg-primary'
                  : 'w-2 h-2 bg-foreground/15'
              }`}
              aria-hidden="true"
            />
          ))}
        </Column>

        <Column
          icon={Footprints}
          iconClass="text-success"
          label={tFallback('dashboard.tonight.steps', 'STEPS')}
          value={steps != null ? fmt(Math.round(countedSteps ?? steps)) : add}
          logged={steps != null}
          onClick={() => onOpen('steps')}
          ariaLabel={steps != null
            ? tFallback('dashboard.tonight.stepsLogged', 'Steps logged. Open readiness')
            : `${tapToLog}: ${tFallback('dashboard.tonight.steps', 'STEPS')}`}
        >
          <span className="block w-full h-1 rounded-full bg-foreground/10 overflow-hidden">
            <span
              className="block h-full rounded-full bg-success"
              style={{ width: `${Math.min(100, ((countedSteps || 0) / STEP_REFERENCE) * 100)}%` }}
            />
          </span>
        </Column>
      </div>
      </Card>
    </motion.div>
  );
}
