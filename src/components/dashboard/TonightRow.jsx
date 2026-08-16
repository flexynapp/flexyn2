// src/components/dashboard/TonightRow.jsx
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
import { motion } from 'framer-motion';
import { Moon, Smile, Footprints, Star } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { getTodayStepLog } from '@/lib/data/stepLogs';
import { MOOD_LABELS } from '@/lib/data/moodLogs';

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
      className="flex-1 min-w-0 px-3 py-1 text-start rounded-sm hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
    >
      <span className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
        <Icon className={`w-3 h-3 shrink-0 ${iconClass}`} aria-hidden="true" />
        <span className="text-micro font-semibold tracking-[0.04em] truncate">{label}</span>
      </span>
      <span
        className={`block font-heading font-bold text-xl leading-none tabular-nums truncate ${
          logged ? 'text-foreground' : 'text-muted-foreground/50'
        }`}
      >
        {value}
      </span>
      <span className="mt-2 h-3 flex items-center">{children}</span>
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

  const dash = '—';
  const tapToLog = tFallback('dashboard.tonight.tapToLog', 'Tap to log');

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* cq-stack-y: three columns in a paired half slot give each signal
          ~50px, which truncates "8,240". Stacked, each keeps its full row.
          See the .dash-slot / cq-* block in index.css. */}
      <Card className="py-4 px-1 divide-x divide-border flex items-stretch cq-stack-y">
        <Column
          icon={Moon}
          iconClass="text-info"
          label={tFallback('dashboard.tonight.sleep', 'SLEEP')}
          value={hours != null ? `${hours} h` : dash}
          logged={hours != null}
          onClick={() => onOpen('sleep')}
          ariaLabel={hours != null
            ? tFallback('dashboard.tonight.sleepLogged', 'Sleep logged. Open readiness')
            : `${tapToLog} — ${tFallback('dashboard.tonight.sleep', 'sleep')}`}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={`w-2.5 h-2.5 ${
                quality != null && n <= quality
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
          value={mood != null ? tFallback(`mood.label.${mood}`, MOOD_LABELS[mood - 1]) : dash}
          logged={mood != null}
          onClick={() => onOpen('mood')}
          ariaLabel={mood != null
            ? tFallback('dashboard.tonight.moodLogged', 'Mood logged. Open readiness')
            : `${tapToLog} — ${tFallback('dashboard.tonight.mood', 'mood')}`}
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
          value={steps != null ? fmt(steps) : dash}
          logged={steps != null}
          onClick={() => onOpen('steps')}
          ariaLabel={steps != null
            ? tFallback('dashboard.tonight.stepsLogged', 'Steps logged. Open readiness')
            : `${tapToLog} — ${tFallback('dashboard.tonight.steps', 'steps')}`}
        >
          <span className="block w-full h-1 rounded-full bg-foreground/10 overflow-hidden">
            <span
              className="block h-full rounded-full bg-success"
              style={{ width: `${Math.min(100, ((steps || 0) / STEP_REFERENCE) * 100)}%` }}
            />
          </span>
        </Column>
      </Card>
    </motion.div>
  );
}
