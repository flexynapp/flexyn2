import React, { useState, useMemo, useRef, useEffect } from 'react';
import { subDays, isAfter } from 'date-fns';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { Dumbbell, ChevronDown } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { translateExerciseName } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs, formatWeight } from '@/lib/weightUnit';

const CHART_STYLE = {
  contentStyle: {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
  },
};

export default function ExerciseProgressCard({ exerciseName, logs, timeRange }) {
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);
  const [expanded, setExpanded] = useState(true);
  const displayName = translateExerciseName(exerciseName, language);
  const bodyRef = useRef(null);
  const [bodyHeight, setBodyHeight] = useState(0);

  useEffect(() => {
    if (!bodyRef.current) return;
    const ro = new ResizeObserver(() => {
      setBodyHeight(bodyRef.current?.scrollHeight ?? 0);
    });
    ro.observe(bodyRef.current);
    setBodyHeight(bodyRef.current.scrollHeight);
    return () => ro.disconnect();
  }, []);

  const filteredLogs = useMemo(() => {
    const cutoff = subDays(new Date(), parseInt(timeRange));
    return logs
      .filter(l => l.date && isAfter(new Date(l.date), cutoff))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [logs, timeRange]);

  const chartData = useMemo(() => {
    return filteredLogs.map(log => {
      const ex = log.exercises?.find(e => e.name === exerciseName);
      if (!ex || !ex.sets?.length) return null;
      const maxWeightLbs = ex.sets.reduce((max, s) => Math.max(max, s.weight || 0), 0);
      const maxReps = ex.sets.reduce((max, s) => Math.max(max, s.reps || 0), 0);
      return {
        date: format(new Date(log.date), 'MMM d', { locale: dateLocale }),
        'Max Weight (lbs)': maxWeightLbs,
        maxWeightDisplay: fromLbs(maxWeightLbs, weightUnit),
        'Max Reps': maxReps,
      };
    }).filter(Boolean);
  }, [filteredLogs, exerciseName, dateLocale, weightUnit]);

  const latest = chartData[chartData.length - 1];
  const previous = chartData[chartData.length - 2];
  const weightDelta = latest && previous ? latest['Max Weight (lbs)'] - previous['Max Weight (lbs)'] : null;
  const repsDelta = latest && previous ? latest['Max Reps'] - previous['Max Reps'] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 22 }}
    >
    <Card className="border-none shadow-sm overflow-hidden">
      <button
        className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <motion.div
            className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"
            whileHover={{ scale: 1.15, rotate: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
          >
            <Dumbbell className="w-4 h-4 text-primary" />
          </motion.div>
          <span className="font-heading font-bold text-sm">{displayName}</span>
          {latest && (
            <div className="flex gap-3 ms-2">
              <span className="text-xs text-muted-foreground">
                {formatWeight(latest['Max Weight (lbs)'], weightUnit)}
                {weightDelta !== null && (
                  <span className={`ms-1 font-medium ${weightDelta > 0 ? 'text-accent' : weightDelta < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    ({weightDelta > 0 ? '+' : ''}{formatWeight(Math.abs(weightDelta), weightUnit)})
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {latest['Max Reps']} {t('common.reps')}
                {repsDelta !== null && (
                  <span className={`ms-1 font-medium ${repsDelta > 0 ? 'text-accent' : repsDelta < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    ({repsDelta > 0 ? '+' : ''}{repsDelta})
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </motion.div>
      </button>

      <motion.div
        animate={{ height: expanded ? bodyHeight : 0, opacity: expanded ? 1 : 0 }}
        initial={false}
        transition={{
          height: { duration: 0.4, ease: [0.4, 0, 0.2, 1] },
          opacity: { duration: 0.3, ease: 'easeInOut' },
        }}
        style={{ overflow: 'hidden' }}
      >
        <div ref={bodyRef} className="px-4 pb-4">
          {chartData.length < 2 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              {chartData.length === 0 ? t('progress.noData') : t('progress.noSetsRecorded')}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={200} key={`${language}-${weightUnit}`}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="0" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis yAxisId="weight" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" domain={[0, 'auto']} allowDataOverflow={false} />
                <YAxis yAxisId="reps" orientation="right" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" domain={[0, 'auto']} allowDataOverflow={false} />
                <Tooltip {...CHART_STYLE} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line yAxisId="weight" type="monotone" dataKey="maxWeightDisplay" name={t('workout.weightWithUnit').replace('lbs', weightUnit)} stroke="hsl(var(--primary))" strokeWidth={3} dot={{ fill: 'hsl(var(--primary))', stroke: 'hsl(var(--card))', strokeWidth: 2, r: 4 }} activeDot={{ r: 6, strokeWidth: 2 }} />
                <Line yAxisId="reps" type="monotone" dataKey="Max Reps" name={t('progress.maxReps')} stroke="hsl(var(--accent))" strokeWidth={3} dot={{ fill: 'hsl(var(--accent))', stroke: 'hsl(var(--card))', strokeWidth: 2, r: 4 }} activeDot={{ r: 6, strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
          {latest && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2 font-medium">{t('progress.latestSets')}</p>
              <div className="flex flex-wrap gap-2">
                {filteredLogs[filteredLogs.length - 1]?.exercises
                  ?.find(e => e.name === exerciseName)
                  ?.sets?.map((s, i) => (
                    <span key={i} className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded-md font-medium">
                      {t('progress.setLabel').replace('{n}', i + 1)}: {formatWeight(s.weight || 0, weightUnit)} × {s.reps}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </Card>
    </motion.div>
  );
}