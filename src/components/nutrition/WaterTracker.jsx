import React, { useMemo, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { parseLocalDate } from '@/lib/dateUtils';

function useAnimatedValue(target, duration = 550) {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const timerRef = useRef(null);
  useEffect(() => {
    const from = displayRef.current;
    if (target === from) return;
    if (timerRef.current) clearInterval(timerRef.current);
    const steps = 36;
    const diff = target - from;
    let step = 0;
    timerRef.current = setInterval(() => {
      step++;
      const t = step / steps;
      const eased = 1 - Math.pow(1 - t, 3);
      const current = step >= steps ? target : from + diff * eased;
      displayRef.current = current;
      setDisplay(current);
      if (step >= steps) { clearInterval(timerRef.current); timerRef.current = null; }
    }, duration / steps);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [target, duration]);
  return display;
}

export default function WaterTracker({ waterOz = 0, userProfile = {}, waterUnit = 'oz', ozToDisplay = (v) => v }) {
  const { t } = useLanguage();

  const dailyRecOz = useMemo(() => {
    const weight = userProfile?.weight_lbs;
    const gender = userProfile?.gender || 'male';
    let age = 30;
    if (userProfile?.birthday) {
      const birth = parseLocalDate(userProfile.birthday) || new Date(userProfile.birthday);
      const now = new Date();
      age = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    } else if (userProfile?.age) {
      age = userProfile.age;
    }
    let baseOz = gender === 'female' ? 73 : 100;
    if (weight) {
      const ref = gender === 'female' ? 125 : 154;
      baseOz = Math.round(baseOz * Math.min(Math.max(weight / ref, 0.7), 1.3));
    }
    if (age < 18) baseOz = Math.round(baseOz * 0.9);
    else if (age > 55) baseOz = Math.round(baseOz * 0.95);
    return Math.round(baseOz / 8) * 8;
  }, [userProfile]);

  const progressPercent = Math.min((waterOz / dailyRecOz) * 100, 100);
  const isGoalReached = progressPercent >= 100;

  const animatedOz = useAnimatedValue(ozToDisplay(waterOz));
  const animatedProgress = useAnimatedValue(progressPercent);

  const prevOzRef = useRef(waterOz);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (waterOz > prevOzRef.current) { setPulse(true); setTimeout(() => setPulse(false), 700); }
    prevOzRef.current = waterOz;
  }, [waterOz]);

  const fmt = (v) => waterUnit === 'L' ? parseFloat(v).toFixed(2) : Math.round(v);
  const displayDailyRec = waterUnit === 'ml'
    ? Math.round(ozToDisplay(dailyRecOz))
    : waterUnit === 'L'
    ? parseFloat(ozToDisplay(dailyRecOz).toFixed(1))
    : Math.round(ozToDisplay(dailyRecOz));

  // Water reads as blue, not the app's orange primary.
  // Water reads cool. This is the same ring as HydrationRing on the
  // Dashboard, which already draws from --info; leaving a private hex
  // here meant the app's two water rings could drift apart on a theme
  // change. Alpha is composed with hsl()'s slash syntax rather than
  // appending hex digits, which stops working the moment the value
  // isn't a 6-digit hex.
  const ringColor = 'hsl(var(--info))';
  const ringColorLight = 'hsl(var(--info) / 0.65)';

  // Compact ring dimensions
  const R = 30, SIZE = 72, circumference = 2 * Math.PI * R;
  const strokeDashoffset = circumference - (animatedProgress / 100) * circumference;

  return (
    <div className="space-y-3">
      {/* ── Single long horizontal strip ── */}
      <div className="flex items-center gap-4">
        {/* Mini ring — left side */}
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <AnimatePresence>
            {pulse && (
              <motion.div key="pulse"
                initial={{ opacity: 0.6, scale: 0.95 }} animate={{ opacity: 0, scale: 1.25 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{ background: `radial-gradient(circle, hsl(var(--info) / 0.2) 0%, transparent 70%)` }}
              />
            )}
          </AnimatePresence>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ transform: 'rotate(-90deg)' }}>
            <defs>
              <linearGradient id="wRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={ringColor} stopOpacity="0.7" />
                <stop offset="100%" stopColor={ringColor} />
              </linearGradient>
            </defs>
            <circle cx={SIZE/2} cy={SIZE/2} r={R} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
            <motion.circle
              cx={SIZE/2} cy={SIZE/2} r={R} fill="none"
              stroke="url(#wRingGrad)" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={circumference}
              animate={{ strokeDashoffset }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0">
            <motion.span
              animate={pulse ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 0.4 }}
              className="font-heading font-black tabular-nums leading-none"
              style={{ fontSize: 17, color: ringColor }}
            >
              {fmt(animatedOz)}
            </motion.span>
            <span className="text-[9px] font-medium text-muted-foreground leading-tight">{waterUnit}</span>
          </div>
        </div>

        {/* Right side: label + progress bar */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline mb-1.5">
            <span className="text-sm font-bold text-foreground">
              {fmt(animatedOz)} <span className="text-muted-foreground font-normal text-xs">{waterUnit}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {t('nutrition.macros.of')} {displayDailyRec} {waterUnit}
            </span>
          </div>
          {/* Progress bar */}
          <div className="h-2.5 bg-border/30 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${ringColorLight}, ${ringColor})` }}
              animate={{ width: `${Math.min(animatedProgress, 100)}%` }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {Math.round(animatedProgress)}% {t('progress.title') || 'of daily goal'}
          </p>
        </div>
      </div>

      {/* Goal reached banner */}
      <AnimatePresence>
        {isGoalReached && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-success/10 border border-success/30"
          >
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
              <Check className="w-4 h-4 text-success" />
            </motion.div>
            <span className="text-sm font-semibold text-success dark:text-success">
              {t('nutrition.water.goalReached')}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
