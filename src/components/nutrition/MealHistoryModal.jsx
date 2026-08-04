import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { X, UtensilsCrossed, Flame, ChevronDown, ChevronUp, Calendar as CalendarIcon, BarChart3 } from 'lucide-react';
import NutritionTrendsChart from './NutritionTrendsChart';
import PhotoMealResultModal from './PhotoMealResultModal';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { db } from '@/api/db';
import { filterAfterReset } from '@/lib/accountReset';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useState } from 'react';

// Reconstruct a recognition-shaped result from a stored log row so the saved
// meal can be re-opened in the read-only detail view (photo + macros +, for
// photo meals, the ingredient breakdown). Manual entries have no ai_meta, so
// they show macros only.
function mealEntryToResult(entry) {
  const meta = entry?.ai_meta || {};
  return {
    food_name:        entry?.food_name || 'Meal',
    calories:         Number(entry?.calories) || 0,
    protein_g:        Number(entry?.protein_g ?? entry?.protein) || 0,
    carbs_g:          Number(entry?.carbs_g   ?? entry?.carbs)   || 0,
    fat_g:            Number(entry?.fat_g     ?? entry?.fat)     || 0,
    fiber_g:          Number(entry?.fiber_g   ?? entry?.fiber)   || 0,
    sugar_g:          Number(meta.sugar_g ?? entry?.sugar_g)     || 0,
    sodium_mg:        Number(entry?.sodium_mg ?? entry?.sodium)  || 0,
    items:            Array.isArray(meta.items) ? meta.items : [],
    portion_estimate: meta.portion_estimate || null,
    confidence:       meta.confidence || null,
    notes:            meta.notes || entry?.notes || null,
  };
}

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
    <span className={`inline-flex items-center gap-0.5 text-micro font-semibold px-1.5 py-0.5 rounded-full ${color}`}>
      {label} {Math.round(value)}g
    </span>
  );
}

function DaySection({ dateStr, entries, onSelect }) {
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
              <Flame className="w-3 h-3 text-primary" />
              {Math.round(totals.calories)} cal
            </span>
            <span className="text-muted-foreground/40 text-xs">·</span>
            <span className="text-xs text-muted-foreground">{entries.length} item{entries.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex gap-1">
            <MacroPill label="P" value={totals.protein} color="bg-info/10 text-info dark:text-info" />
            <MacroPill label="C" value={totals.carbs}   color="bg-primary/10 text-primary dark:text-primary" />
            <MacroPill label="F" value={totals.fat}     color="bg-destructive/10 text-destructive dark:text-destructive" />
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
                  onClick={() => onSelect?.(entry)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(entry); } }}
                  className="flex items-center justify-between px-4 py-3 rounded-xl bg-card border border-border/50 hover:border-primary/40 cursor-pointer transition-colors"
                >
                  {entry.image_url && (
                    <img src={entry.image_url} alt="" className="w-10 h-10 rounded-lg object-cover me-3 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{entry.food_name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      {entry.protein_g > 0 && (
                        <MacroPill label="P" value={entry.protein_g} color="bg-info/10 text-info dark:text-info" />
                      )}
                      {entry.carbs_g > 0 && (
                        <MacroPill label="C" value={entry.carbs_g} color="bg-primary/10 text-primary dark:text-primary" />
                      )}
                      {entry.fat_g > 0 && (
                        <MacroPill label="F" value={entry.fat_g} color="bg-destructive/10 text-destructive dark:text-destructive" />
                      )}
                    </div>
                  </div>
                  <div className="ms-3 text-end shrink-0">
                    <p className="text-sm font-heading font-bold">{Math.round(entry.calories || 0)}</p>
                    <p className="text-micro text-muted-foreground">cal</p>
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
  const fmt = useNumberFormatter();
  // 'browse' (default — day list) vs 'trends' (7-day chart) vs
  // 'picker' (jump to a specific date). The picker is a single
  // <input type="date"> that scrolls the list to that day's section.
  const [tab, setTab] = useState('browse');
  const [pickedDate, setPickedDate] = useState('');
  // Selected saved meal → read-only detail pop-out (image + macros + ingredients).
  const [detail, setDetail] = useState(null);
  const openDetail = (entry) => setDetail({ imageUrl: entry?.image_url || null, result: mealEntryToResult(entry) });
  useBodyScrollLock(open);

  const { data: rawLogs = [], isLoading } = useQuery({
    queryKey: ['nutritionHistory', user?.email],
    // Newest-logged first (created_at, not just date) so today's latest meal
    // is at the top and the user doesn't have to scroll to their latest entry.
    queryFn: () => db.entities.NutritionLog.filter({ created_by: user.email }, '-created_at', 500),
    enabled: !!user?.email && open,
  });

  const mealLogs = useMemo(() => {
    // Filter out water-glass rows from the meal history. The legacy
    // encoding was { food_name: 'Water', water_oz: N } but the new
    // glasses-counter encoding stores { food_name: 'Water|N' } with
    // calories = 0. Both shapes must be excluded — previously only
    // the legacy shape was filtered, so post-migration water entries
    // showed up in history as "Water|3 — 0 cal meal". (Audit 11 #3.)
    const isWaterRow = (e) => {
      const name = (e?.food_name || '').toString();
      if (name === 'Water' && e?.water_oz > 0) return true;
      if (/^Water\|/.test(name)) return true;
      return false;
    };
    return filterAfterReset(rawLogs, userProfile).filter(e => !isWaterRow(e));
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
                  {mealLogs.length} entries · {fmt(Math.round(allTimeCalories))} cal total
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
                { label: 'Avg cal/day', value: grouped.length > 0 ? Math.round(allTimeCalories / grouped.length) : 0 },
              ].map(stat => (
                <div key={stat.label} className="text-center">
                  <p className="font-heading font-bold text-lg leading-none">{fmt(stat.value)}</p>
                  <p className="text-micro text-muted-foreground mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Tab row */}
          {!isLoading && mealLogs.length > 0 && (
            <div className="flex gap-1 px-4 pt-3 border-b border-border/60">
              {[
                { id: 'browse', label: 'Browse',  Icon: UtensilsCrossed },
                { id: 'picker', label: 'Pick day', Icon: CalendarIcon },
                { id: 'trends', label: 'Trends',  Icon: BarChart3 },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wide rounded-t-md transition-colors ${
                    tab === id ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
          )}

          {/* Body */}
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
            ) : tab === 'trends' ? (
              <NutritionTrendsChart entries={mealLogs} userProfile={userProfile} />
            ) : tab === 'picker' ? (
              <div className="space-y-3">
                <div>
                  <label className="text-micro font-bold uppercase tracking-wide text-muted-foreground">
                    Jump to date
                  </label>
                  <input
                    type="date"
                    value={pickedDate}
                    onChange={(e) => setPickedDate(e.target.value)}
                    max={format(new Date(), 'yyyy-MM-dd')}
                    className="w-full mt-1 px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm outline-none focus:border-primary/50"
                  />
                </div>
                {pickedDate && (() => {
                  const found = grouped.find(([d]) => d === pickedDate);
                  if (!found) {
                    return <p className="text-xs text-muted-foreground text-center py-4">No entries on {pickedDate}.</p>;
                  }
                  return <DaySection dateStr={found[0]} entries={found[1]} onSelect={openDetail} />;
                })()}
              </div>
            ) : (
              <div>
                {grouped.map(([dateStr, entries]) => (
                  <DaySection key={dateStr} dateStr={dateStr} entries={entries} onSelect={openDetail} />
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

      {/* Read-only detail for a tapped saved meal (portals above this modal). */}
      <PhotoMealResultModal
        open={!!detail}
        readOnly
        imageUrl={detail?.imageUrl}
        result={detail?.result}
        onClose={() => setDetail(null)}
      />
    </AnimatePresence>
  );
}
