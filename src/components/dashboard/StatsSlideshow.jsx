import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Flame, Dumbbell, TrendingUp, Target, Zap, Trophy, BarChart2 } from 'lucide-react';
import { subDays, isAfter, format } from 'date-fns';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs, formatWeight } from '@/lib/weightUnit';
import { translateExerciseName } from '@/lib/exerciseTranslations';
import { parseLocalDate } from '@/lib/dateUtils';

const SLIDE_DURATION = 4000;

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '11px',
    padding: '6px 10px',
  },
};

// ─── Chart Slide Components ───────────────────────────────────────────────────

function WeeklyVolumeChart({ logs = [] }) {
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);
  // Map BCP-47 → app language code for toLocaleString. The previous
  // bare `.toLocaleString()` used the browser's default locale, which
  // means an English-locale browser displaying the German UI would
  // still show '1,234' instead of '1.234' for the chart tooltip.
  const bcp47 = language === 'zh' ? 'zh-CN' : language === 'ja' ? 'ja-JP' : language;
  const data = useMemo(() => {
    // parseLocalDate so 'YYYY-MM-DD' strings sort and format in local
    // TZ. Plain `new Date('YYYY-MM-DD')` is UTC midnight, which can
    // flip a workout's label to the previous day in negative-offset
    // zones (visible in the chart axis).
    return [...logs]
      .filter(l => parseLocalDate(l.date))
      .sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date))
      .slice(-8)
      .map(log => {
        const vol = (log.exercises || []).reduce((s, ex) =>
          s + (ex.sets || []).reduce((ss, set) => ss + ((set.weight || 0) * (set.reps || 0)), 0), 0);
        return { date: format(parseLocalDate(log.date), 'MMM d', { locale: dateLocale }), volumeDisplay: fromLbs(Math.round(vol), weightUnit) };
      });
  }, [logs, dateLocale, weightUnit]);

  return (
    <motion.div
      className="w-full flex flex-col items-center gap-2"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: 'easeOut' }}
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center">
          <BarChart2 className="w-4 h-4 text-info" />
        </div>
        <div className="text-start">
          <p className="text-sm font-heading font-bold">{t('widgets.weeklyVolume')}</p>
          <p className="text-xs text-muted-foreground">{t('stats.lbsPerSession')}</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={110} key={weightUnit}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          {/* `v` here is the Y-axis value, which is already converted
              into display units via `fromLbs(vol, weightUnit)` in the
              chart data above. The previous `formatWeight(v, weightUnit)`
              re-converted as if it were lbs, halving the tooltip value
              for kg users. Now we render the already-converted number
              with the unit suffix directly. */}
          <Tooltip
            {...CHART_TOOLTIP_STYLE}
            formatter={v => [`${Math.round(Number(v) || 0).toLocaleString(bcp47)} ${weightUnit}`, t('widgets.weeklyVolume')]}
          />
          <Bar dataKey="volumeDisplay" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} isAnimationActive animationDuration={900} animationEasing="ease-out" />
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

function TopExerciseChart({ logs = [] }) {
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);
  // Same locale mapping as WeeklyVolumeChart — toLocaleString needs an
  // explicit BCP-47 tag to override the browser default.
  const bcp47Top = language === 'zh' ? 'zh-CN' : language === 'ja' ? 'ja-JP' : language;
  // Find the most-logged exercise and chart its max weight over time
  const { exName, data } = useMemo(() => {
    const count = {};
    logs.forEach(log => {
      (log.exercises || []).forEach(ex => { if (ex.name) count[ex.name] = (count[ex.name] || 0) + 1; });
    });
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    if (!top) return { exName: null, data: [] };
    const name = top[0];
    const points = [...logs]
      .filter(l => parseLocalDate(l.date) && l.exercises?.some(e => e.name === name))
      .sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date))
      .slice(-8)
      .map(log => {
        const ex = log.exercises.find(e => e.name === name);
        const maxW = (ex?.sets || []).reduce((m, s) => Math.max(m, s.weight || 0), 0);
        return { date: format(parseLocalDate(log.date), 'MMM d', { locale: dateLocale }), Weight: fromLbs(maxW, weightUnit) };
      })
      .filter(d => d.Weight > 0);
    return { exName: name, data: points };
  }, [logs, dateLocale, weightUnit]);

  if (!exName || data.length < 2) return null;

  return (
    <motion.div
      className="w-full flex flex-col items-center gap-2"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: 'easeOut' }}
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-accent" />
        </div>
        <div className="text-start">
          <p className="text-sm font-heading font-bold truncate max-w-[180px]">{translateExerciseName(exName, language)}</p>
          <p className="text-xs text-muted-foreground">{t('stats.maxWeightTrend')}</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          {/* Same double-convert avoidance as the volume chart — `v` is
              already the converted display-unit weight, not lbs. */}
          <Tooltip
            {...CHART_TOOLTIP_STYLE}
            formatter={v => [`${(Math.round((Number(v) || 0) * 10) / 10).toLocaleString(bcp47Top)} ${weightUnit}`, t('progress.maxWeightLbs')]}
          />
          <Line type="monotone" dataKey="Weight" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: 'hsl(var(--accent))' }} activeDot={{ r: 6, strokeWidth: 0 }} isAnimationActive animationDuration={1000} animationEasing="ease-out" />
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

// ─── Stat Slides Builder ──────────────────────────────────────────────────────

function buildStatSlides(logs, goals, weightUnit, language) {
  const slides = [];
  // Defensive — Dashboard always passes [], but a future call site could
  // forward undefined. Same guard already added to the chart components.
  if (!Array.isArray(logs)) logs = [];
  if (!Array.isArray(goals)) goals = [];
  const thisWeekLogs = logs.filter(l => {
    const d = parseLocalDate(l.date);
    return d && isAfter(d, subDays(new Date(), 7));
  });

  slides.push({
    id: 'week', icon: Flame, iconColor: 'text-primary', iconBg: 'bg-primary/10',
    value: thisWeekLogs.length, label: 'Workouts This Week', labelKey: 'statsSlide.week.label',
    sub: thisWeekLogs.length > 0 ? '{n} sessions logged 🔥' : 'Get one in today!',
    subKey: thisWeekLogs.length > 0 ? 'statsSlide.week.sub.some' : 'statsSlide.week.sub.none',
    subVars: { n: thisWeekLogs.length },
  });

  slides.push({
    id: 'total', icon: Dumbbell, iconColor: 'text-primary', iconBg: 'bg-primary/10',
    value: logs.length, label: 'Total Workouts', labelKey: 'statsSlide.total.label',
    sub: logs.length > 0 ? 'All-time sessions logged' : 'Log your first workout',
    subKey: logs.length > 0 ? 'statsSlide.total.sub.some' : 'statsSlide.total.sub.none',
  });

  const weeklyVolume = thisWeekLogs.reduce((sum, log) =>
    sum + (log.exercises || []).reduce((s, ex) =>
      s + (ex.sets || []).reduce((ss, set) => ss + ((set.weight || 0) * (set.reps || 0)), 0), 0), 0);
  if (weeklyVolume > 0) {
    slides.push({
      id: 'volume', icon: BarChart2, iconColor: 'text-info', iconBg: 'bg-info/10',
      value: formatWeight(weeklyVolume, weightUnit),
      label: 'Lifted This Week', labelKey: 'statsSlide.volume.label',
      sub: 'Total volume this week', subKey: 'statsSlide.volume.sub',
    });
  }

  const pbMap = {};
  [...logs].sort((a, b) => (parseLocalDate(a.date) || 0) - (parseLocalDate(b.date) || 0)).forEach(log => {
    (log.exercises || []).forEach(ex => {
      (ex.sets || []).forEach(set => {
        if (set.weight && set.reps && (!pbMap[ex.name] || set.weight > pbMap[ex.name].weight)) {
          pbMap[ex.name] = { weight: set.weight, date: log.date };
        }
      });
    });
  });
  const recentPBs = Object.entries(pbMap).sort((a, b) => (parseLocalDate(b[1].date) || 0) - (parseLocalDate(a[1].date) || 0)).slice(0, 1);
  if (recentPBs.length > 0) {
    const [exName, pb] = recentPBs[0];
    slides.push({
      id: 'pb', icon: Trophy, iconColor: 'text-primary', iconBg: 'bg-primary/10',
      value: formatWeight(pb.weight, weightUnit),
      label: (() => { const d = translateExerciseName(exName, language); return `PB · ${d.length > 16 ? d.slice(0, 16) + '…' : d}`; })(),
      sub: 'Personal best', subKey: 'statsSlide.pb.sub',
    });
  }

  const completedGoals = goals.filter(g => g.status === 'completed');
  slides.push({
    id: 'goals', icon: Target, iconColor: 'text-accent', iconBg: 'bg-accent/10',
    value: completedGoals.length, label: 'Goals Achieved', labelKey: 'statsSlide.goals.label',
    sub: completedGoals.length > 0 ? 'Crushed it' : 'Set your first goal',
    subKey: completedGoals.length > 0 ? 'statsSlide.goals.sub.some' : 'statsSlide.goals.sub.none',
  });

  const streak = (() => {
    if (!logs.length) return 0;
    const sorted = [...logs].sort((a, b) => (parseLocalDate(b.date) || 0) - (parseLocalDate(a.date) || 0));
    let s = 0;
    let cur = new Date(); cur.setHours(0, 0, 0, 0);
    for (const log of sorted) {
      const d = parseLocalDate(log.date);
      if (!d) continue;
      d.setHours(0, 0, 0, 0);
      if (Math.round((cur - d) / 86400000) === s) { s++; cur = d; } else break;
    }
    return s;
  })();
  slides.push({
    id: 'streak', icon: Zap, iconColor: 'text-primary', iconBg: 'bg-primary/10',
    value: streak, label: 'Day Streak', labelKey: 'statsSlide.streak.label',
    sub: streak > 0 ? "You're on fire" : 'Start your streak today',
    subKey: streak > 0 ? 'statsSlide.streak.sub.some' : 'statsSlide.streak.sub.none',
  });

  const exCount = {};
  thisWeekLogs.forEach(log => { (log.exercises || []).forEach(ex => { exCount[ex.name] = (exCount[ex.name] || 0) + 1; }); });
  const topEx = Object.entries(exCount).sort((a, b) => b[1] - a[1])[0];
  if (topEx) {
    const topExDisplay = translateExerciseName(topEx[0], language);
    slides.push({
      id: 'trending', icon: TrendingUp, iconColor: 'text-success', iconBg: 'bg-success/10',
      value: topExDisplay.length > 14 ? topExDisplay.slice(0, 14) + '…' : topExDisplay,
      label: 'Trending This Week', labelKey: 'statsSlide.trending.label',
      sub: 'Logged {n}x this week', subKey: 'statsSlide.trending.sub', subVars: { n: topEx[1] }, small: true,
    });
  }

  return slides;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StatsSlideshow({ logs = [], goals = [], isLoading }) {
  const { t, tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const hasData = (logs?.length ?? 0) >= 3;

  const statSlides = useMemo(() => buildStatSlides(logs, goals, weightUnit, language), [logs, goals, weightUnit, language]);

  // Build combined slide list: stat slides + chart slides (if data exists)
  const allSlides = useMemo(() => {
    if (!hasData) return statSlides.map(s => ({ ...s, type: 'stat' }));
    return [
      ...statSlides.map(s => ({ ...s, type: 'stat' })),
      { id: 'chart-volume', type: 'chart-volume' },
      { id: 'chart-exercise', type: 'chart-exercise' },
    ];
  }, [statSlides, hasData]);

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  useEffect(() => {
    setIndex(0);
  }, [hasData]);

  useEffect(() => {
    if (allSlides.length < 2) return;
    // Pause auto-advance when the tab is hidden — the animation runs
    // off-screen and burns battery otherwise. Same pattern recommended
    // for DailyQuestsCard / SyncStatus.
    let timer = null;
    const tick = () => {
      // Guard slides.length === 0 — `% 0` is NaN, which sets index to
      // NaN and breaks the render (slide becomes undefined past the
      // length check below). The auto-advance effect already has a
      // `< 2` early-return at start time, but a race where allSlides
      // shrinks to 0 between tick scheduling and tick firing would
      // hit this otherwise.
      if (allSlides.length === 0) return;
      setDirection(1);
      setIndex(i => (i + 1) % allSlides.length);
    };
    const start = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(tick, SLIDE_DURATION);
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVis = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [allSlides.length]);

  const slide = allSlides.length > 0 ? allSlides[Math.min(index, allSlides.length - 1)] : null;

  const variants = {
    enter: (dir) => ({ opacity: 0, y: dir > 0 ? 18 : -18, scale: 0.97 }),
    center: { opacity: 1, y: 0, scale: 1 },
    exit: (dir) => ({ opacity: 0, y: dir > 0 ? -18 : 18, scale: 0.97 }),
  };

  const isChartSlide = slide?.type?.startsWith('chart');

  return (
    <Card className={`px-4 pt-4 pb-3 flex flex-col items-center border-none shadow-sm col-span-2 overflow-hidden relative ${isChartSlide ? 'min-h-[210px]' : 'min-h-[130px]'}`}>
      {isLoading ? (
        <div className="space-y-2 flex flex-col items-center">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      ) : slide ? (
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={slide.id}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className={`w-full ${isChartSlide ? '' : 'flex flex-col items-center gap-3 text-center'}`}
          >
            {slide.type === 'stat' && (
              <>
                <div className={`w-10 h-10 rounded-lg ${slide.iconBg} flex items-center justify-center`}>
                  <slide.icon className={`w-5 h-5 ${slide.iconColor}`} />
                </div>
                <div>
                  <motion.p
                    className={`font-heading font-bold ${slide.small ? 'text-xl md:text-2xl' : 'text-2xl md:text-3xl'}`}
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 20 }}
                  >
                    {slide.value}
                  </motion.p>
                  <p className="text-xs text-muted-foreground mt-0.5 font-medium">{slide.labelKey ? tFallback(slide.labelKey, slide.label) : slide.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{slide.subKey ? tFallback(slide.subKey, slide.sub, slide.subVars) : slide.sub}</p>
                </div>
              </>
            )}
            {slide.type === 'chart-volume' && <WeeklyVolumeChart logs={logs} />}
            {slide.type === 'chart-exercise' && <TopExerciseChart logs={logs} />}
          </motion.div>
        </AnimatePresence>
      ) : null}

      {/* Dot indicators */}
      <div className="flex gap-1 mt-3 justify-center">
        {allSlides.map((s, i) => (
          <button
            key={s.id}
            onClick={() => { setDirection(i > index ? 1 : -1); setIndex(i); }}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? 'bg-primary w-3' : 'bg-border w-1.5'}`}
          />
        ))}
      </div>
    </Card>
  );
}