/**
 * PRHistoryModal — chronological PR timeline for a single exercise.
 *
 * Shows a line chart of best weight per session over time + a scrollable
 * list of every time a new PR was set, with date + delta.
 */
import React, { useMemo } from 'react';
import BottomSheet from '@/components/ui/BottomSheet';
import TapToCopy from '@/components/TapToCopy';
import { motion } from 'framer-motion';
import { Trophy, Dumbbell } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useDateFormatter } from '@/lib/intl';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs, formatWeight } from '@/lib/weightUnit';
import { parseLocalDate } from '@/lib/dateUtils';
import { Card } from '@/components/ui/card';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

const CHART_STYLE = {
  contentStyle: {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
  },
};

export default function PRHistoryModal({ open, onClose, exerciseName, logs }) {
  const { tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  /* `Intl.DateTimeFormat`, already bound to the language, rather than
     date-fns `format()` with a pattern. The axis tick used to be
     `format(d, 'MMM d')` with NO locale at all, so every point on the chart
     read "Aug 9" in all 15 languages; the milestone rows did pass a locale
     but pinned month-day-year order through the pattern, which is not how
     most of those languages write a date. See the date note in CLAUDE.md —
     and ExerciseTrendChart next door, which is the shape copied here. */
  const fmtDate = useDateFormatter();

  // Build chronological history: one entry per workout session that had this exercise.
  // Each entry has date + max weight that session.
  const { sessionHistory, prTimeline, allTimeBest } = useMemo(() => {
    if (!exerciseName || !logs?.length) return { sessionHistory: [], prTimeline: [], allTimeBest: 0 };

    const target = exerciseName.trim().toLowerCase();
    const byDate = {};

    for (const log of logs) {
      if (!log.date) continue;
      const dateKey = log.date.slice(0, 10);
      for (const ex of log.exercises || []) {
        const name = (ex?.name || '').trim().toLowerCase();
        if (name !== target) continue;
        const maxW = (ex.sets || []).reduce((m, s) => Math.max(m, Number(s.weight) || 0), 0);
        if (maxW <= 0) continue;
        if (!byDate[dateKey] || maxW > byDate[dateKey]) byDate[dateKey] = maxW;
      }
    }

    const sorted = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, weightLbs]) => ({ date, weightLbs }));

    // Identify PR moments (new all-time-best at that point in history)
    let runningBest = 0;
    const prTimeline = [];
    const sessionHistory = sorted.map(entry => {
      const isPR = entry.weightLbs > runningBest;
      if (isPR) {
        prTimeline.push({
          date: entry.date,
          weightLbs: entry.weightLbs,
          delta: Math.round((entry.weightLbs - runningBest) * 10) / 10,
          prevBest: runningBest,
        });
        runningBest = entry.weightLbs;
      }
      return { ...entry, isPR };
    });

    return { sessionHistory, prTimeline, allTimeBest: runningBest };
  }, [exerciseName, logs]);

  // e.date is a LOCAL 'yyyy-MM-dd' key — parseLocalDate keeps the label
  // on the right calendar day for users west of UTC.
  const chartData = useMemo(() => sessionHistory.map(e => ({
    date: fmtDate(parseLocalDate(e.date), { month: 'short', day: 'numeric' }),
    weight: Math.round(fromLbs(e.weightLbs, weightUnit) * 10) / 10,
    isPR: e.isPR,
  })), [sessionHistory, weightUnit, fmtDate]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={exerciseName
        ? tFallback('progress.pb.titleFor', '{name} — PR History', { name: exerciseName })
        : tFallback('progress.pb.title', 'PR History')}
    >
        {sessionHistory.length === 0 ? (
          <div className="text-center py-12">
            <Dumbbell className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-heading font-semibold">{tFallback('progress.pb.emptyTitle', 'No data yet')}</p>
            <p className="text-sm text-muted-foreground mt-1">{tFallback('progress.pb.emptyBody', 'Log this exercise to see your history.')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* All-time best banner */}
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-r from-primary/10 via-primary/8 to-transparent border border-primary/20">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Trophy className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">{tFallback('progress.pb.allTimeBest', 'All-time best')}</p>
                <TapToCopy
                  value={tFallback('progress.pb.copyValue', 'All-time PR: {weight}', { weight: formatWeight(allTimeBest, weightUnit) })}
                  label={tFallback('copy.noun.pr', 'PR')}
                >
                  <p className="font-heading font-black text-2xl text-primary">
                    {formatWeight(allTimeBest, weightUnit)}
                  </p>
                </TapToCopy>
              </div>
              <div className="ml-auto text-end">
                <p className="text-xs text-muted-foreground">
                  {tFallback(
                    prTimeline.length === 1 ? 'progress.pb.prsSet_one' : 'progress.pb.prsSet_other',
                    prTimeline.length === 1 ? '{n} PR set' : '{n} PRs set',
                    { n: prTimeline.length },
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tFallback(
                    sessionHistory.length === 1 ? 'progress.pb.sessions_one' : 'progress.pb.sessions_other',
                    sessionHistory.length === 1 ? '{n} session' : '{n} sessions',
                    { n: sessionHistory.length },
                  )}
                </p>
              </div>
            </div>

            {/* Line chart */}
            {chartData.length >= 2 && (
              <Card className="p-4 border-none shadow-sm">
                <p className="text-xs text-muted-foreground font-medium mb-3 uppercase tracking-wide">{tFallback('progress.pb.chartTitle', 'Weight over time')}</p>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={['auto', 'auto']} unit={` ${weightUnit}`} width={55} />
                    <Tooltip {...CHART_STYLE} formatter={(v) => [`${v} ${weightUnit}`, tFallback('progress.pb.chartSeries', 'Weight')]} />
                    <Line
                      type="monotone"
                      dataKey="weight"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={(props) => {
                        const { cx, cy, payload } = props;
                        if (payload.isPR) {
                          return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={5} fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth={2} />;
                        }
                        return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={2.5} fill="hsl(var(--primary))" strokeWidth={0} />;
                      }}
                      activeDot={{ r: 6, strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-micro text-muted-foreground mt-2 text-center">{tFallback('progress.pb.chartLegend', '● = new PR at that session')}</p>
              </Card>
            )}

            {/* PR milestones */}
            {prTimeline.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-3 uppercase tracking-wide">{tFallback('progress.pb.milestones', 'PR milestones')}</p>
                <div className="space-y-2">
                  {[...prTimeline].reverse().map((pr, idx) => (
                    <motion.div
                      key={pr.date + idx}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.04, type: 'spring', stiffness: 300, damping: 24 }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50"
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${idx === 0 ? 'bg-primary/20' : 'bg-primary/10'}`}>
                        {/* The newest PR used to be gold and the rest amber; both
                            collapsed to text-primary when the tiers moved onto the
                            budget, so the row that matters lost its emphasis. Ranked
                            by opacity now — one hue, still ordered. */}
                        <Trophy className={`w-3.5 h-3.5 ${idx === 0 ? 'text-primary' : 'text-primary/60'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold leading-tight">
                          {formatWeight(pr.weightLbs, weightUnit)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fmtDate(parseLocalDate(pr.date), { dateStyle: 'long' })}
                        </p>
                      </div>
                      {pr.prevBest > 0 && (
                        <span className="text-micro font-bold text-success shrink-0">
                          +{formatWeight(pr.delta, weightUnit)}
                        </span>
                      )}
                      {pr.prevBest === 0 && (
                        <span className="text-micro text-muted-foreground shrink-0">{tFallback('progress.pb.first', 'first')}</span>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
    </BottomSheet>
  );
}
