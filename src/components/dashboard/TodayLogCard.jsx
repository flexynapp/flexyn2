// src/components/dashboard/TodayLogCard.jsx
//
// "Log today" (Kegan, 27 Sep): meals, water, sleep, mood and steps as one
// block of rows. It replaces two cards that each opened on a paragraph of
// instructions — "Food and water" and "Recovery" — which on a fresh day made
// Today three "you haven't done this" boxes in a row.
//
// Every row draws its own unit rather than describing it: a bar against the
// calorie target, a glass per 8 oz of the water goal, the readiness ring once
// sleep is in, a bar for steps. An empty row is a quiet "+" pill, not a
// sentence. Every tap answers: numbers count up, glasses fill, the ring draws
// in, and the header pips fill as rows get logged. Logging the fifth opens one
// green line under the block, the only "done" moment here.
//
// Two rows log in place because the action is one tap: water adds a glass,
// and mood opens its five choices inside the row. Meals, sleep and steps
// need a form, so their pill opens the existing one (Nutrition's meal logger,
// the readiness sheet's sleep and steps cards). One implementation of each
// logger, not two.
//
// No orange. Hero D spends it on its ring and its button; green here means
// done, blue is water, everything else is neutral.

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Utensils, Droplet, Moon, Smile, Footprints, Plus, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { triggerHaptic } from '@/lib/haptic';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import useCountUp from '@/hooks/useCountUp';
import { localDateKey } from '@/hooks/useLocalDateKey';
import { useTodayFuel } from '@/hooks/useTodayFuel';
import * as nutritionData from '@/lib/data/nutrition';
import { waterFoodName } from '@/lib/waterEntries';
import { rewardWaterLog, WATER_DAILY_CAP_OZ } from '@/lib/waterLogging';
import { getTodayStepLog } from '@/lib/data/stepLogs';
import { MOOD_LABELS } from '@/lib/data/moodLogs';
import { logMoodAction } from '@/lib/data/logMoodAction';
import ReadinessRing, { readinessColors } from '@/components/dashboard/ReadinessRing';
import { ACTION_BY_LABEL } from '@/components/dashboard/ReadinessCard';

// A glass is 8 oz, the + sheet's small step and the unit the water rows in
// nutrition_logs are written in most often.
export const GLASS_OZ = 8;
// Enough glasses to show any sane goal without the row wrapping.
const MAX_GLASSES = 12;
// A DISPLAY reference for the steps bar, not a stored goal. step_logs holds a
// count and nothing else, so no "of your goal" copy goes with it.
const STEP_REFERENCE = 10000;

/** Glasses to draw for a goal, and how many of them are full. */
export function glassesFor(waterOz, waterGoalOz) {
  const total = Math.max(1, Math.min(MAX_GLASSES, Math.round((waterGoalOz || 64) / GLASS_OZ)));
  const full = Math.max(0, Math.min(total, Math.floor((waterOz || 0) / GLASS_OZ)));
  return { total, full };
}


/** The pill at the end of an unlogged row. A real button, so it is its own tap target. */
function AddPill({ label, onClick, ariaLabel, expanded }) {
  return (
    <motion.button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      whileTap={{ scale: 0.92 }}
      aria-label={ariaLabel}
      aria-expanded={expanded}
      className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border ps-2 pe-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 transition-colors"
    >
      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </motion.button>
  );
}

/** A thin bar whose fill grows to `pct`. */
function Bar({ pct, tone = 'bg-foreground' }) {
  return (
    <span className="block h-1 rounded-full bg-border overflow-hidden" aria-hidden="true">
      <span
        className={`block h-full rounded-full ${tone} transition-[width] duration-700 ease-out motion-reduce:transition-none`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </span>
  );
}

/**
 * One row. The row itself opens the detail (a tap anywhere but the pill); the
 * pill logs. Two targets, never nested: the row is a div with a button inside
 * for the detail and the pill beside it.
 */
function Row({ lead, title, value, children, onOpen, openLabel, trailing, done }) {
  return (
    <div className="flex items-center gap-3 px-4 border-t border-border min-h-[52px]">
      <button
        type="button"
        onClick={onOpen}
        aria-label={openLabel}
        className="flex-1 min-w-0 flex items-center gap-3 py-2.5 text-start rounded-sm active:bg-secondary/40 transition-colors"
      >
        <span className={`shrink-0 transition-colors duration-300 ${done ? 'text-foreground' : 'text-muted-foreground'}`}>
          {lead}
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold truncate">{title}</span>
            {value != null && <span className="text-sm font-semibold tabular-nums shrink-0">{value}</span>}
          </span>
          {children}
        </span>
      </button>
      {trailing}
    </div>
  );
}

export default function TodayLogCard({ userProfile = {}, readiness, onOpenReadiness }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ── Food and water ────────────────────────────────────────────────
  const { today, calories, waterOz, calorieGoal, waterGoal } = useTodayFuel(userProfile);
  const countedCalories = useCountUp(calories, { duration: 650 });
  const glasses = glassesFor(waterOz, waterGoal);

  const addGlass = useMutation({
    mutationFn: () => nutritionData.create({ date: today, food_name: waterFoodName(GLASS_OZ), calories: 0 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nutritionLogs'] });
      rewardWaterLog({ user, date: today, oz: GLASS_OZ, queryClient: qc, via: 'today' });
    },
    onError: (err) => {
      reportError(err, { feature: 'today.water', userEmail: user?.email });
      toast.error(tFallback('bodyMetrics.errors.saveFailed', 'Could not save. Try again.'));
    },
  });
  const logGlass = () => {
    if (addGlass.isPending) return;
    // Same cap and same message as the Nutrition page and the + sheet.
    if (waterOz + GLASS_OZ > WATER_DAILY_CAP_OZ) {
      toast.error(tFallback('nutrition.toast.waterCap', "That's plenty of water for today. Stay safe!"));
      return;
    }
    triggerHaptic(waterOz + GLASS_OZ >= waterGoal && waterOz < waterGoal ? 'success' : 'subtle');
    addGlass.mutate();
  };
  // The glass fills the moment it is tapped, not when the refetch lands.
  const shownGlasses = Math.min(glasses.total, glasses.full + (addGlass.isPending ? 1 : 0));

  // ── Sleep, mood, steps ────────────────────────────────────────────
  // Sleep and mood arrive through the Dashboard's useReadiness; steps is the
  // one signal it does not hold, so it is the one query this card adds.
  // `today` (from useTodayFuel, which rolls over at local midnight) is in the
  // key, or yesterday's steps stay cached on a screen left open overnight.
  const { data: stepLog } = useQuery({
    queryKey: ['stepLogToday', user?.id, today],
    queryFn: getTodayStepLog,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });
  const hours = readiness?.sleep?.hours ?? null;
  const serverMood = readiness?.mood?.mood ?? null;
  const steps = stepLog?.steps ?? null;
  const countedSteps = useCountUp(steps, { duration: 700 });

  const scored = !!(readiness?.breakdown?.sleep?.logged || readiness?.breakdown?.soreness?.logged);
  const score = readiness?.score ?? 0;
  const countedScore = useCountUp(scored ? score : null, { duration: 900 });
  const safeLabel = ACTION_BY_LABEL[readiness?.label] ? readiness.label : 'Ready';
  const readinessLine = scored
    ? `${tFallback(`readiness.label.${safeLabel.toLowerCase()}`, safeLabel)}. ${tFallback(ACTION_BY_LABEL[safeLabel].key, ACTION_BY_LABEL[safeLabel].fallback)}`
    : tFallback('today.log.sleepSub', 'Scores your readiness');

  // Mood logs in the row. Optimistic, so the choice shows while it saves.
  const [moodOpen, setMoodOpen] = useState(false);
  // The optimistic pick carries its date, so one made just before midnight
  // cannot stand in for the new day's mood.
  const [optimisticMood, setOptimisticMood] = useState(null);
  const mood = (optimisticMood?.date === localDateKey() ? optimisticMood.n : null) ?? serverMood;
  useEffect(() => { if (serverMood != null) setOptimisticMood(null); }, [serverMood]);
  const pickMood = async (n) => {
    const date = localDateKey();
    setMoodOpen(false);
    setOptimisticMood({ n, date });
    triggerHaptic('primary');
    const res = await logMoodAction({ user, mood: n, date, qc, t: tFallback });
    if (!res.ok) setOptimisticMood(null);
  };
  const moodLabel = (n) => tFallback(`mood.label.${n}`, MOOD_LABELS[n - 1]);

  // ── The five, and the one "done" moment ───────────────────────────
  const logged = [calories > 0, waterOz > 0, hours != null, mood != null, steps != null];
  const loggedCount = logged.filter(Boolean).length;
  const allLogged = loggedCount === logged.length;
  // Fire the success haptic only on the transition into "all five", never
  // for a day that loads already complete.
  const wasAllLogged = useRef(null);
  useEffect(() => {
    if (wasAllLogged.current === false && allLogged) triggerHaptic('success');
    wasAllLogged.current = allLogged;
  }, [allLogged]);

  if (!user?.id) return null;

  const logLabel = tFallback('today.recovery.log', 'Log');
  const colors = readinessColors(readiness?.label);

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-3">
        <h3 className="font-heading font-bold text-sm tracking-tight truncate">
          {tFallback('today.log.title', 'Log today')}
        </h3>
        <span className="ms-auto flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1" aria-hidden="true">
            {logged.map((on, i) => (
              <motion.span
                key={i}
                className={`block w-3.5 h-1 rounded-full transition-colors duration-300 ${i < loggedCount ? 'bg-success' : 'bg-border'}`}
                initial={false}
                animate={i < loggedCount ? { scaleY: [1, 2, 1] } : { scaleY: 1 }}
                transition={{ duration: 0.35 }}
              />
            ))}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {tFallback('today.log.count', '{n} of {total}', { n: loggedCount, total: logged.length })}
          </span>
        </span>
      </div>

      {/* Meals */}
      <Row
        lead={<Utensils className="w-4 h-4" aria-hidden="true" />}
        title={tFallback('today.log.meals', 'Meals')}
        value={calories > 0 ? (
          <>
            {fmt(Math.round(countedCalories ?? calories))}
            <span className="text-xs font-medium text-muted-foreground"> / {fmt(calorieGoal)} {tFallback('today.fuel.kcal', 'kcal')}</span>
          </>
        ) : null}
        done={calories > 0}
        onOpen={() => navigate('/nutrition')}
        openLabel={tFallback('today.fuel.open', 'Open Nutrition')}
        trailing={<AddPill label={tFallback('today.log.meal', 'Meal')} onClick={() => { triggerHaptic('primary'); navigate('/nutrition?openLogMeal=1'); }} />}
      >
        {calories > 0 && <Bar pct={(calories / Math.max(1, calorieGoal)) * 100} />}
      </Row>

      {/* Water: a glass per 8 oz of the goal, and + adds one in place. */}
      <Row
        lead={<Droplet className="w-4 h-4" aria-hidden="true" />}
        title={tFallback('today.fuel.water', 'Water')}
        value={
          <>
            {shownGlasses}
            <span className="text-xs font-medium text-muted-foreground"> / {glasses.total}</span>
          </>
        }
        done={waterOz > 0}
        onOpen={() => navigate('/nutrition')}
        openLabel={tFallback('today.fuel.open', 'Open Nutrition')}
        trailing={<AddPill label={tFallback('today.log.glass', 'Glass')} onClick={logGlass} ariaLabel={tFallback('today.log.addGlass', 'Add a glass of water')} />}
      >
        <span className="flex gap-1" aria-hidden="true">
          {Array.from({ length: glasses.total }, (_, i) => (
            <span key={i} className="relative flex-1 h-2.5 rounded-sm border border-border overflow-hidden">
              <span
                className="absolute inset-x-0 bottom-0 bg-info transition-[height] duration-500 ease-out motion-reduce:transition-none"
                style={{ height: i < shownGlasses ? '100%' : 0 }}
              />
            </span>
          ))}
        </span>
      </Row>

      {/* Sleep. Once logged, the moon becomes the readiness ring, because
          sleep is what produces the score. */}
      <Row
        lead={hours != null && scored ? (
          <ReadinessRing score={score} color={colors.ring} size={34} stroke={3}>
            <span className="font-heading font-black text-[11px] tabular-nums text-foreground">
              {Math.round(countedScore ?? score)}
            </span>
          </ReadinessRing>
        ) : <Moon className="w-4 h-4" aria-hidden="true" />}
        title={tFallback('today.log.sleep', 'Sleep')}
        value={hours != null ? `${hours} h` : null}
        done={hours != null}
        onOpen={() => onOpenReadiness?.(hours != null ? undefined : 'sleep')}
        openLabel={tFallback('readiness.openLabel', 'Readiness. Tap for details')}
        trailing={hours == null ? (
          <AddPill label={logLabel} onClick={() => onOpenReadiness?.('sleep')}
            ariaLabel={tFallback('today.log.addSleep', 'Log sleep')} />
        ) : null}
      >
        <span className="text-xs text-muted-foreground leading-snug">{readinessLine}</span>
      </Row>

      {/* Mood: the five choices open inside the row. */}
      <div>
        <Row
          lead={<Smile className="w-4 h-4" aria-hidden="true" />}
          title={tFallback('today.log.mood', 'Mood')}
          value={mood != null ? moodLabel(mood) : null}
          done={mood != null}
          onOpen={() => onOpenReadiness?.('mood')}
          openLabel={tFallback('dashboard.tonight.moodLogged', 'Mood logged. Open readiness')}
          trailing={mood == null ? (
            <AddPill label={logLabel} expanded={moodOpen}
              ariaLabel={tFallback('today.log.addMood', 'Log mood')}
              onClick={() => { triggerHaptic('subtle'); setMoodOpen((o) => !o); }} />
          ) : null}
        />
        <AnimatePresence initial={false}>
          {moodOpen && mood == null && (
            <motion.div
              key="moods"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-1.5 ps-11 pe-4 pb-3 -mt-1" role="group"
                aria-label={tFallback('mood.prompt', 'How are you feeling?')}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => pickMood(n)}
                    className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold hover:border-muted-foreground/60 active:scale-95 transition-[border-color,transform]"
                  >
                    {moodLabel(n)}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Steps */}
      <Row
        lead={<Footprints className="w-4 h-4" aria-hidden="true" />}
        title={tFallback('today.log.steps', 'Steps')}
        value={steps != null ? fmt(Math.round(countedSteps ?? steps)) : null}
        done={steps != null}
        onOpen={() => onOpenReadiness?.('steps')}
        openLabel={tFallback('dashboard.tonight.stepsLogged', 'Steps logged. Open readiness')}
        trailing={steps == null ? (
          <AddPill label={logLabel} onClick={() => onOpenReadiness?.('steps')}
            ariaLabel={tFallback('today.log.addSteps', 'Log steps')} />
        ) : null}
      >
        {steps != null && <Bar pct={((countedSteps || 0) / STEP_REFERENCE) * 100} tone="bg-success" />}
      </Row>

      <AnimatePresence initial={false}>
        {allLogged && (
          <motion.div
            key="all"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-xs font-semibold text-success">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {tFallback('today.log.allDone', 'Everything logged for today')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
