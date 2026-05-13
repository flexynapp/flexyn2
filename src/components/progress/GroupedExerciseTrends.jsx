import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import ExerciseProgressCard from './ExerciseProgressCard';
import { useLanguage } from '@/lib/LanguageContext';
import { muscleKey } from '@/lib/exerciseTranslations';

const MUSCLE_GROUP_COLORS = {
  'Chest': 'bg-red-500/20 text-red-600',
  'Back': 'bg-blue-500/20 text-blue-600',
  'Shoulders': 'bg-purple-500/20 text-purple-600',
  'Biceps': 'bg-amber-500/20 text-amber-600',
  'Triceps': 'bg-orange-500/20 text-orange-600',
  'Legs': 'bg-emerald-500/20 text-emerald-600',
  'Glutes': 'bg-pink-500/20 text-pink-600',
  'Core': 'bg-cyan-500/20 text-cyan-600',
  'Forearms': 'bg-yellow-500/20 text-yellow-600',
  'Cardio': 'bg-indigo-500/20 text-indigo-600',
  'Full Body': 'bg-slate-500/20 text-slate-600',
  'Other': 'bg-slate-500/20 text-slate-600',
};

// Accordion panel — always rendered so ResizeObserver can measure,
// height animated between 0 and real pixel value for smooth open/close.
function AccordionPanel({ isOpen, children }) {
  const innerRef = useRef(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!innerRef.current) return;
    const ro = new ResizeObserver(() => {
      setHeight(innerRef.current?.scrollHeight ?? 0);
    });
    ro.observe(innerRef.current);
    setHeight(innerRef.current.scrollHeight);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.div
      animate={{ height: isOpen ? height : 0, opacity: isOpen ? 1 : 0 }}
      initial={false}
      transition={{
        height: { duration: 0.4, ease: [0.4, 0, 0.2, 1] },
        opacity: { duration: 0.3, ease: 'easeInOut' },
      }}
      style={{ overflow: 'hidden' }}
    >
      <div ref={innerRef} className="space-y-3 mt-3 ml-1 pb-1">
        {children}
      </div>
    </motion.div>
  );
}

export default function GroupedExerciseTrends({ exerciseNames, regimenLogs, timeRange, selectedMuscleGroup, scrollRef }) {
  const { t } = useLanguage();

  // Scroll the trends section into view whenever the muscle group filter changes
  const prevMuscleGroup = useRef(selectedMuscleGroup);
  useEffect(() => {
    if (prevMuscleGroup.current !== selectedMuscleGroup) {
      prevMuscleGroup.current = selectedMuscleGroup;
      // Always scroll, regardless of which option was picked
      const el = scrollRef?.current;
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    }
  }, [selectedMuscleGroup, scrollRef]);

  const groupedExercises = useMemo(() => {
    const groups = new Map();

    const filteredNames = exerciseNames.filter(name => {
      if (selectedMuscleGroup === 'all') return true;
      const exercise = regimenLogs
        .flatMap(log => log.exercises || [])
        .find(ex => ex.name === name);
      return exercise?.muscle_groups?.includes(selectedMuscleGroup) ||
             exercise?.muscle_group === selectedMuscleGroup;
    });

    filteredNames.forEach(name => {
      const mostRecentEx = regimenLogs
        .slice()
        .reverse()
        .flatMap(log => log.exercises || [])
        .find(ex => ex.name === name);

      const groupLabel = mostRecentEx?.muscle_groups?.[0] || mostRecentEx?.muscle_group || 'Other';
      if (!groups.has(groupLabel)) groups.set(groupLabel, []);
      groups.get(groupLabel).push(name);
    });

    const sorted = Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });

    sorted.forEach(([, names]) => names.sort());
    return new Map(sorted);
  }, [exerciseNames, regimenLogs, selectedMuscleGroup]);

  const [expandedGroups, setExpandedGroups] = useState(() => {
    const initial = {};
    groupedExercises.forEach((_, label) => { initial[label] = true; });
    return initial;
  });

  const headerRefs = useRef({});

  const toggleGroup = (label) => {
    const isOpening = !expandedGroups[label];
    setExpandedGroups(prev => ({ ...prev, [label]: !prev[label] }));
    if (isOpening) {
      // Wait for the accordion animation to finish (400ms duration + buffer) then
      // scroll so the group header sits near the top, letting the chart content flow into view
      setTimeout(() => {
        const el = headerRefs.current[label];
        if (!el) return;
        const top = el.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top, behavior: 'smooth' });
      }, 450);
    }
  };

  return (
    <div className="space-y-4">
      {Array.from(groupedExercises).map(([groupLabel, exercises], groupIdx) => (
        <motion.div
          key={groupLabel}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 24, delay: groupIdx * 0.05 }}
        >
          {/* Group Header */}
          <motion.button
            ref={el => { headerRefs.current[groupLabel] = el; }}
            onClick={() => toggleGroup(groupLabel)}
            className={`w-full px-4 py-3 rounded-lg border border-border transition-colors flex items-center justify-between ${
              expandedGroups[groupLabel]
                ? 'bg-secondary/40'
                : 'bg-secondary/20 hover:bg-secondary/30'
            }`}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${MUSCLE_GROUP_COLORS[groupLabel]?.split(' ')[0] || 'bg-slate-400'}`} />
              <span className="font-heading font-bold text-sm">{t(`muscleGroups.${muscleKey(groupLabel)}`)}</span>
              <span className="text-xs text-muted-foreground font-medium">
                · {exercises.length} {exercises.length === 1 ? t('analytics.exercise') : t('analytics.exercises')}
              </span>
            </div>
            <motion.div
              animate={{ rotate: expandedGroups[groupLabel] ? 180 : 0 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            >
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </motion.div>
          </motion.button>

          {/* Smooth accordion panel */}
          <AccordionPanel isOpen={expandedGroups[groupLabel]}>
            {exercises.map(name => (
              <ExerciseProgressCard
                key={name}
                exerciseName={name}
                logs={regimenLogs}
                timeRange={timeRange}
              />
            ))}
          </AccordionPanel>
        </motion.div>
      ))}
    </div>
  );
}