import React, { useState, useMemo, useId } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { translateExerciseName } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight } from '@/lib/weightUnit';
import { buildTrendPoints, metricsFor, seriesFor, headlineFor, METRIC_IS_WEIGHT } from '@/lib/exerciseTrend';
import Sparkline from './Sparkline';
import ExerciseTrendChart from './ExerciseTrendChart';

/**
 * One exercise in the Trends list.
 *
 * Three things changed from the card this replaces, and they are all the
 * same change: **a collapsed row has to be worth reading on its own.**
 *
 *   • It is a row, not a Card. Forty identical elevated surfaces is the
 *     literal description of the generated look CLAUDE.md is written to
 *     avoid, and these are read-only data, not user-arranged objects —
 *     so hairlines. (The old one was `border-none shadow-sm`, which is
 *     neither of the two elevation levels: it dropped the hairline for
 *     the shadow the rules call pointless.)
 *   • It carries the current value, its change, and a sparkline, so the
 *     row states a trend without opening. "Data must be earned" — the
 *     old collapsed header showed two bare figures.
 *   • The recharts chart mounts on FIRST EXPAND and not before, and
 *     stays mounted after. Every exercise used to mount one on tab
 *     entry, expanded, on screen or not.
 */
export default function ExerciseTrendRow({ exerciseName, logs, sinceMs }) {
  const { t, tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const fmtNum = useNumberFormatter();
  const panelId = useId();

  const [expanded, setExpanded] = useState(false);
  // Latched: once a row has been opened, its chart stays mounted so
  // re-opening is instant and the height measurement below stays honest.
  // State rather than a ref set during render — a ref mutated in the
  // render body is not safe under concurrent rendering.
  const [everExpanded, setEverExpanded] = useState(false);

  const displayName = translateExerciseName(exerciseName, language);

  const points = useMemo(
    () => buildTrendPoints(logs, exerciseName, sinceMs),
    [logs, exerciseName, sinceMs],
  );

  const metrics = useMemo(() => metricsFor(points), [points]);
  const [metric, setMetric] = useState(null);
  // The available metrics depend on the data, which the period filter
  // changes — so a metric selected under one window can stop existing
  // under another. Fall back to the default rather than plotting a
  // series that is now all nulls.
  const activeMetric = metrics.includes(metric) ? metric : metrics[0];

  const { latest, delta, sessions } = useMemo(
    () => headlineFor(points, activeMetric),
    [points, activeMetric],
  );

  const sparkValues = useMemo(
    () => seriesFor(points, activeMetric).map((d) => d.value),
    [points, activeMetric],
  );

  if (!metrics.length) return null;

  const isWeight = METRIC_IS_WEIGHT[activeMetric];
  const metricLabel = tFallback(`trends.metric.${activeMetric}`, activeMetric);
  const fmtValue = (v) =>
    isWeight ? formatWeight(v, weightUnit) : fmtNum(v, { maximumFractionDigits: 0 });

  const deltaTone =
    delta > 0 ? 'text-success' : delta < 0 ? 'text-destructive' : 'text-muted-foreground';
  // A zero delta is real information — you matched last session — but
  // rendering it as "0 lbs" puts a second number with a unit beside the
  // headline and reads as a measurement rather than a comparison. Say it
  // in words. `null` stays reserved for "there is no previous session",
  // which is a different fact and must not look the same.
  const deltaText =
    delta == null
      ? null
      : delta === 0
        ? tFallback('trends.noChange', 'no change')
        : `${delta > 0 ? '+' : '−'}${
            isWeight
              ? formatWeight(Math.abs(delta), weightUnit)
              : fmtNum(Math.abs(delta), { maximumFractionDigits: 0 })
          }`;

  return (
    <div className="border-t border-border/60 first:border-t-0">
      <button
        onClick={() => { setExpanded((v) => !v); setEverExpanded(true); }}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="w-full flex items-center gap-2 py-2.5 text-start hover:bg-secondary/30 active:bg-secondary/30 transition-colors rounded-sm"
      >
        <div className="min-w-0 flex-1">
          <p className="font-heading font-bold text-sm truncate">{displayName}</p>
          <p className="text-micro text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            {latest ? (
              <>
                <span className="text-foreground font-semibold">{fmtValue(latest[activeMetric])}</span>
                <span>{metricLabel}</span>
                {deltaText && <span className={`font-semibold ${deltaTone}`}>{deltaText}</span>}
              </>
            ) : (
              <span>{tFallback('trends.noneInRange', 'Nothing logged for this lift in this window.')}</span>
            )}
          </p>
        </div>

        {/* Never the sole carrier of anything — the value and the delta
            are stated in text to its left, so this is aria-hidden. */}
        <Sparkline values={sparkValues} className="text-primary" />

        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="shrink-0"
        >
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </motion.div>
      </button>

      {/* `height: 'auto'`, not a measured pixel value.
          Both accordions in this tab used to animate to a height taken
          from a ResizeObserver — two observers per exercise, kept alive
          for the whole list. That is also the fragile shape for what
          this row does: the body's content arrives a frame AFTER the
          open, because the chart mounts on first expand, so the panel
          animates to whatever the observer last reported. Framer
          measures `auto` itself at the moment it animates, so there is
          no stale number and nothing to keep alive. */}
      <motion.div
        id={panelId}
        animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
        initial={false}
        transition={{
          height: { duration: 0.32, ease: [0.4, 0, 0.2, 1] },
          opacity: { duration: 0.24, ease: 'easeInOut' },
        }}
        style={{ overflow: 'hidden' }}
        aria-hidden={!expanded}
      >
        <div className="pb-2">
          {everExpanded && (
            <>
              {/* Metric switch. Rendered only when the exercise's own
                  sets support more than one — a switch with one option
                  is chrome. Bodyweight work always lands here. */}
              {metrics.length > 1 && (
                <div
                  role="group"
                  aria-label={tFallback('trends.metricLabel', 'Measure')}
                  className="flex gap-1 mb-2"
                >
                  {metrics.map((m) => (
                    <button
                      key={m}
                      onClick={() => setMetric(m)}
                      aria-pressed={m === activeMetric}
                      className={`px-2.5 py-1 rounded-sm text-micro font-bold uppercase tracking-wider transition-colors ${
                        m === activeMetric
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:text-foreground active:text-foreground'
                      }`}
                    >
                      {tFallback(`trends.metric.${m}`, m)}
                    </button>
                  ))}
                </div>
              )}

              {sessions >= 2 ? (
                <ExerciseTrendChart points={points} metric={activeMetric} metricLabel={metricLabel} />
              ) : (
                // The one-point state, which per the production data is
                // the state most users are in. It says what is true —
                // one session is one session — where the old copy said
                // "no sets recorded" at a session that recorded sets.
                <p className="text-xs text-muted-foreground py-3 leading-relaxed">
                  {sessions === 1
                    ? tFallback('trends.oneSession', 'One session so far. Log this lift again and the trend appears here.')
                    : tFallback('trends.noneInRange', 'Nothing logged for this lift in this window.')}
                </p>
              )}

              {latest && (
                <div className="mt-2 pt-2 border-t border-border/60">
                  <p className="text-micro text-muted-foreground mb-1 font-medium">
                    {t('progress.latestSets')}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {latest.sets.map((s, i) => (
                      <span
                        key={i}
                        className="text-micro bg-secondary text-secondary-foreground px-2 py-1 rounded-sm font-medium"
                      >
                        {Number(s?.weight) > 0
                          ? `${formatWeight(s.weight, weightUnit)} × ${s.reps}`
                          : `${tFallback('trends.bodyweight', 'Bodyweight')} × ${s.reps}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
