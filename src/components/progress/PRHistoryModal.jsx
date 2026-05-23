/**
 * PRHistoryModal — chronological PR timeline for a single exercise.
 *
 * Shows a line chart of best weight per session over time + a scrollable
 * list of every time a new PR was set, with date + delta.
 */
import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { motion } from 'framer-motion';
import { Trophy, TrendingUp, Dumbbell } from 'lucide-react';
import { format } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs, formatWeight } from '@/lib/weightUnit';
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
  const { language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);

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

  const chartData = useMemo(() => sessionHistory.map(e => ({
    date: format(new Date(e.date), 'MMM d'),
    weight: Math.round(fromLbs(e.weightLbs, weightUnit) * 10) / 10,
    isPR: e.isPR,
  })), [sessionHistory, weightUnit]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            {exerciseName} — PR History
          </DialogTitle>
        </DialogHeader>

        {sessionHistory.length === 0 ? (
          <div className="text-center py-12">
            <Dumbbell className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-heading font-semibold">No data yet</p>
            <p className="text-sm text-muted-foreground mt-1">Log this exercise to see your history.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* All-time best banner */}
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-r from-yellow-500/10 via-amber-500/8 to-transparent border border-yellow-500/20">
              <div className="w-10 h-10 rounded-xl bg-yellow-500/15 flex items-center justify-center shrink-0">
                <Trophy className="w-5 h-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">All-time best</p>
                <p className="font-heading font-black text-2xl text-yellow-500">
                  {formatWeight(allTimeBest, weightUnit)}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xs text-muted-foreground">{prTimeline.length} PRs set</p>
                <p className="text-xs text-muted-foreground">{sessionHistory.length} sessions</p>
              </div>
            </div>

            {/* Line chart */}
            {chartData.length >= 2 && (
              <Card className="p-4 border-none shadow-sm">
                <p className="text-xs text-muted-foreground font-medium mb-3 uppercase tracking-wide">Weight over time</p>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={['auto', 'auto']} unit={` ${weightUnit}`} width={55} />
                    <Tooltip {...CHART_STYLE} formatter={(v) => [`${v} ${weightUnit}`, 'Weight']} />
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
                <p className="text-[10px] text-muted-foreground mt-2 text-center">● = new PR at that session</p>
              </Card>
            )}

            {/* PR milestones */}
            {prTimeline.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-3 uppercase tracking-wide">PR milestones</p>
                <div className="space-y-2">
                  {[...prTimeline].reverse().map((pr, idx) => (
                    <motion.div
                      key={pr.date + idx}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.04, type: 'spring', stiffness: 300, damping: 24 }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50"
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${idx === 0 ? 'bg-yellow-500/20' : 'bg-primary/10'}`}>
                        <Trophy className={`w-3.5 h-3.5 ${idx === 0 ? 'text-yellow-500' : 'text-primary'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold leading-tight">
                          {formatWeight(pr.weightLbs, weightUnit)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(pr.date), 'MMMM d, yyyy', { locale: dateLocale })}
                        </p>
                      </div>
                      {pr.prevBest > 0 && (
                        <span className="text-[11px] font-bold text-emerald-500 shrink-0">
                          +{formatWeight(pr.delta, weightUnit)}
                        </span>
                      )}
                      {pr.prevBest === 0 && (
                        <span className="text-[10px] text-muted-foreground shrink-0">first</span>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
