import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { X, UtensilsCrossed, Flame, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { db } from '@/api/db';
import { filterAfterReset } from '@/lib/accountReset';
import { useState } from 'react';

function formatDateHeading(dateStr) {
  try {
    const d = parseISO(dateStr);
    if (isToday(d)) return 'Today';
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'EEEE, MMMM d, yyyy');
  } catch {
    return dateStr;
  }
}

function MacroPill({ label, value, color }) {
  if (!value || value <= 0) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${color}`}>
      {label} {Math.round(value)}g
    </span>
  );
}

function DaySection({ dateStr, entries }) {
  const [expanded, setExpanded] = useState(true);

  const totals = useMemo(() => entries.reduce((acc, e) => ({
    calories: acc.calories + (e.calories || 0),
    protein:  acc.protein  + (e.protein_g  || 0),
    carbs:    acc.carbs    + (e.carbs_g    || 0),
    fat:      acc.fat      + (e.fat_g      || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [entries]);

  return (
    <div className="mb-3">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-secondary/60 rounded-xl hover:bg-secondary/80 transition-colors"
      >
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-sm font-heading font-bold tracking-tight">
            {formatDateHeading(dateStr)}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <Flame className="w-3 h-3 text-orange-400" />
              {Math.round(totals.calories)} kcal
            </span>
            <span className="text-muted-foreground/40 text-xs">·</span>
            <span className="text-xs text-muted-foreground">{entries.length} item{entries.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex gap-1">
            <MacroPill label="P" value={totals.protein} color="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
            <MacroPill label="C" value={totals.carbs}   color="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
            <MacroPill label="F" value={totals.fat}     color="bg-rose-500/10 text-rose-600 dark:text-rose-400" />
          </div>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="pt-1 space-y-1 px-1">
              {entries.map((entry, i) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.18 }}
                  className="flex items-center justify-between px-4 py-3 rounded-xl bg-card border border-border/50 hover:border-primary/20 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{entry.food_name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      {entry.protein_g > 0 && (
                        <MacroPill label="P" value={entry.protein_g} color="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
                      )}
                      {entry.carbs_g > 0 && (
                        <MacroPill label="C" value={entry.carbs_g} color="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
                      )}
                      {entry.fat_g > 0 && (
                        <MacroPill label="F" value={entry.fat_g} color="bg-rose-500/10 text-rose-600 dark:text-rose-400" />
                      )}
                    </div>
                  </div>
                  <div className="ml-3 text-right shrink-0">
                    <p className="text-sm font-heading font-bold">{Math.round(entry.calories || 0)}</p>
                    <p className="text-[10px] text-muted-foreground">kcal</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MealHistoryModal({ open, onClose, userProfile }) {
  const { user } = useAuth();
  const { t } = useLanguage();

  const { data: rawLogs = [], isLoading } = useQuery({
    queryKey: ['nutritionHistory', user?.email],
    queryFn: () => db.entities.NutritionLog.filter({ created_by: user.email }, '-date', 500),
    enabled: !!user?.email && open,
  });

  const mealLogs = useMemo(() => {
    const filtered = filterAfterReset(rawLogs, userProfile)
      .filter(e => !(e.food_name === 'Water' && e.water_oz > 0));
    return filtered;
  }, [rawLogs, userProfile]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const entry of mealLogs) {
      const key = entry.date || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [mealLogs]);

  const allTimeCalories = useMemo(
    () => mealLogs.reduce((s, e) => s + (e.calories || 0), 0),
    [mealLogs]
  );

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          onClick={e => e.stopPropagation()}
          className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-card border border-border flex flex-col"
          style={{ maxHeight: '92vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
            <div>
              <h2 className="font-heading font-bold text-xl tracking-tight">Meal History</h2>
              {!isLoading && mealLogs.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {mealLogs.length} entries · {Math.round(allTimeCalories).toLocaleString()} kcal total
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/70 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Stats bar */}
          {!isLoading && mealLogs.length > 0 && (
            <div className="grid grid-cols-3 gap-3 px-5 py-3 border-b border-border shrink-0">
              {[
                { label: 'Days logged', value: grouped.length },
                { label: 'Meals logged', value: mealLogs.length },
                { label: 'Avg kcal/day', value: grouped.length > 0 ? Math.round(allTimeCalories / grouped.length) : 0 },
              ].map(stat => (
                <div key={stat.label} className="text-center">
                  <p className="font-heading font-bold text-lg leading-none">{stat.value.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-secondary/40 animate-pulse" />
                ))}
              </div>
            ) : grouped.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
                  <UtensilsCrossed className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="font-heading font-bold text-base">No meal history yet</p>
                <p className="text-sm text-muted-foreground mt-1">Start logging meals to see your history here.</p>
              </div>
            ) : (
              <div>
                {grouped.map(([dateStr, entries]) => (
                  <DaySection key={dateStr} dateStr={dateStr} entries={entries} />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-border shrink-0">
            <Button onClick={onClose} className="w-full font-heading font-semibold">
              Close
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
