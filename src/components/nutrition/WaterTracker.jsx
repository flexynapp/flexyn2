import React, { useMemo, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Droplet, Check } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { parseLocalDate } from '@/lib/dateUtils';

/* ── Smooth count-up from previous value ──────────────────────────────── */
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
      // Cubic ease-out for a very smooth deceleration
      const t = step / steps;
      const eased = 1 - Math.pow(1 - t, 3);
      const current = step >= steps ? target : from + diff * eased;
      displayRef.current = current;
      setDisplay(current);
      if (step >= steps) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, duration / steps);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
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
      // parseLocalDate interprets `YYYY-MM-DD` in the user's local zone.
      // `new Date('1985-04-15')` would parse as UTC midnight, which for
      // anyone west of UTC ticks the birthday boundary a day early and
      // ages users 0-365 days off. (Audit 11 #40.)
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
      const referenceWeight = gender === 'female' ? 125 : 154;
      const clampedFactor = Math.min(Math.max(weight / referenceWeight, 0.7), 1.3);
      baseOz = Math.round(baseOz * clampedFactor);
    }
    if (age < 18) baseOz = Math.round(baseOz * 0.9);
    else if (age > 55) baseOz = Math.round(baseOz * 0.95);
    return Math.round(baseOz / 8) * 8;
  }, [userProfile]);

  const progressPercent = Math.min((waterOz / dailyRecOz) * 100, 100);
  const isGoalReached = progressPercent >= 100;

  // Droplet grid
  const TOTAL_DROPLETS = 8;
  const ozPerDroplet = dailyRecOz / TOTAL_DROPLETS;
  const numFilledDroplets = Math.floor(waterOz / ozPerDroplet);
  const partialFillPercent = ((waterOz % ozPerDroplet) / ozPerDroplet) * 100;
  const isEmpty = waterOz === 0;

  // Animated values
  const animatedOz = useAnimatedValue(ozToDisplay(waterOz));
  const animatedProgress = useAnimatedValue(progressPercent);

  // Ring geometry — bigger ring
  // Ring sized down from 160→120 + R 62→48 to make the whole water
  // tracker more compact and more square-shaped per user feedback.
  const R = 48;
  const SIZE = 120;
  const circumference = 2 * Math.PI * R;
  const strokeDashoffset = circumference - (animatedProgress / 100) * circumference;

  // Detect a new addition to pulse the ring
  const prevOzRef = useRef(waterOz);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (waterOz > prevOzRef.current) {
      setPulse(true);
      setTimeout(() => setPulse(false), 700);
    }
    prevOzRef.current = waterOz;
  }, [waterOz]);

  const fmt = (v) => {
    if (waterUnit === 'L') return parseFloat(v).toFixed(2);
    return Math.round(v);
  };

  const displayDailyRec = waterUnit === 'ml'
    ? Math.round(ozToDisplay(dailyRecOz))
    : waterUnit === 'L'
    ? parseFloat(ozToDisplay(dailyRecOz).toFixed(1))
    : Math.round(ozToDisplay(dailyRecOz));

  const ringColor = 'hsl(var(--primary))';

  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 gap-3 md:gap-4">
        {/* LEFT: DROPLET GRID — empty state suppressed per user
            feedback; an empty droplet grid is self-evident enough
            without the "Start hydrating / Log first" copy. */}
        <div>
          <AnimatePresence mode="wait">
            {!isEmpty && (
              <motion.div
                key="grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-4 gap-2"
              >
                {Array.from({ length: TOTAL_DROPLETS }).map((_, idx) => {
                  const isFilled = idx < numFilledDroplets;
                  const isPartial = idx === numFilledDroplets && partialFillPercent > 0;
                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20, delay: idx * 0.04 }}
                      className="h-12 rounded-xl flex items-center justify-center relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-border/20 border border-dashed border-border/40 rounded-xl" />
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-br from-blue-400 to-blue-500 rounded-xl"
                        initial={{ scaleY: 0, opacity: 0 }}
                        animate={{
                          scaleY: isFilled ? 1 : isPartial ? partialFillPercent / 100 : 0,
                          opacity: isFilled || isPartial ? 1 : 0,
                        }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        style={{ originY: 1 }}
                      />
                      {(isFilled || isPartial) && (
                        <Droplet className="relative z-10 w-5 h-5 text-white" />
                      )}
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT: ANIMATED RING — single source of truth */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative" style={{ width: SIZE, height: SIZE }}>
            {/* Outer glow pulse on new water added */}
            <AnimatePresence>
              {pulse && (
                <motion.div
                  key="pulse"
                  initial={{ opacity: 0.6, scale: 0.95 }}
                  animate={{ opacity: 0, scale: 1.18 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.65, ease: 'easeOut' }}
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: `radial-gradient(circle, ${ringColor}33 0%, transparent 70%)`,
                    pointerEvents: 'none',
                  }}
                />
              )}
            </AnimatePresence>

            <svg
              width={SIZE}
              height={SIZE}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              style={{ transform: 'rotate(-90deg)' }}
            >
              <defs>
                <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" />
                </linearGradient>
              </defs>
              {/* Track */}
              <circle
                cx={SIZE / 2} cy={SIZE / 2} r={R}
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth="8"
              />
              {/* Progress arc */}
              <motion.circle
                cx={SIZE / 2} cy={SIZE / 2} r={R}
                fill="none"
                stroke="url(#ringGradient)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                animate={{ strokeDashoffset }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              />
            </svg>

            {/* Center content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.span
                key={fmt(animatedOz)}
                animate={pulse ? { scale: [1, 1.08, 1] } : {}}
                transition={{ duration: 0.4 }}
                className="font-heading font-black tabular-nums leading-none"
                style={{ fontSize: 26, color: ringColor, transition: 'color 0.6s ease' }}
              >
                {fmt(animatedOz)}
              </motion.span>
              <span className="text-xs font-medium text-muted-foreground mt-1">{waterUnit}</span>
              <span className="text-xs text-muted-foreground">
                {t('nutrition.macros.of')} {displayDailyRec}
              </span>
            </div>
          </div>

          {/* Compact stats — goal + progress only */}
          <div className="grid grid-cols-2 gap-2 w-full">
            {[
              { label: t('nutrition.water.daily'), value: `${displayDailyRec} ${waterUnit}` },
              { label: t('progress.title'), value: `${Math.round(animatedProgress)}%` },
            ].map((stat, idx) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08 }}
                className="bg-secondary/50 rounded-xl px-3 py-2 text-center"
              >
                <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
                <p className="font-heading font-bold text-sm text-foreground mt-0.5">{stat.value}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Goal reached banner */}
      <AnimatePresence>
        {isGoalReached && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -8 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="flex items-center justify-center gap-2 p-4 rounded-xl bg-green-500/10 border border-green-500/30"
          >
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
              <Check className="w-5 h-5 text-green-600" />
            </motion.div>
            <span className="text-sm font-semibold text-green-700 dark:text-green-400">
              {t('nutrition.water.goalReached')}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
