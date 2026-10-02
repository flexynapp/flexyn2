// src/components/nutrition/FoodSearchSheet.jsx
//
// "Search" in the Log Meal panel.
//
// Searches ONLY what this user already has: foods they scanned, recipes they
// saved, and meals they have logged. That boundary is what lets it filter on
// every keystroke — the three sources are fetched once when the sheet opens
// and every subsequent character is a pure function over arrays already in
// memory. There is no request per keystroke, so there is nothing to debounce
// and no rate limit to respect.
//
// (A global tier could not work this way. Open Food Facts allows ten searches
// a minute per IP and their docs say plainly not to wire it to
// search-as-you-type, so it would have to sit behind an explicit tap. Not
// built — see docs/nutrition-meal-logging-audit.md.)
//
// Ranking, merging and de-duplication live in `src/lib/foodSearch.js` and are
// tested there against the real production shapes. This file is the surface.

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Loader2, ScanBarcode, BookOpen, History } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as nutritionData from '@/lib/data/nutrition';
import { listMineForSearch } from '@/lib/data/foodItems';
import { listMine as listMyRecipes } from '@/lib/data/nutritionRecipes';
import { rankFoodMatches, recentFoods, FOOD_SOURCE } from '@/lib/foodSearch';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';

// `label` is the English fallback for `foodSearch.source.<key>`, resolved
// where the row renders.
const SOURCE_META = {
  [FOOD_SOURCE.SCAN]:   { Icon: ScanBarcode, label: 'Scanned', cls: 'text-primary' },
  [FOOD_SOURCE.RECIPE]: { Icon: BookOpen,    label: 'Recipe',  cls: 'text-blue-500' },
  [FOOD_SOURCE.RECENT]: { Icon: History,     label: 'Logged',  cls: 'text-muted-foreground' },
};

export default function FoodSearchSheet({ open, onClose, onPick }) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const kbInset = useKeyboardInset();
  useBodyScrollLock(open);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { if (!open) setQuery(''); }, [open]);
  // 80ms so the entrance animation settles before the keyboard comes up —
  // same delay BugReportDialog uses for the same reason.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open]);

  // ── the three sources, fetched once per open ──
  const enabled = open && !!user?.email;

  const { data: logs = [], isLoading: logsLoading } = useQuery({
    // Shares the key the Log Meal form's History tab already uses, so opening
    // one warms the other rather than refetching 300 rows twice.
    queryKey: ['nutritionHistory', user?.email],
    queryFn: () => nutritionData.listRecent(user.id, 300),
    enabled,
    staleTime: 60_000,
  });
  const { data: scans = [], isLoading: scansLoading } = useQuery({
    queryKey: ['foodItemsMine', user?.email],
    queryFn: () => listMineForSearch(user.id),
    enabled,
    staleTime: 60_000,
  });
  const { data: recipes = [], isLoading: recipesLoading } = useQuery({
    queryKey: ['nutritionRecipesMine', user?.id],
    queryFn: () => listMyRecipes(user.id),
    enabled: enabled && !!user?.id,
    staleTime: 60_000,
  });

  const loading = logsLoading || scansLoading || recipesLoading;

  const results = useMemo(() => {
    const sources = { logs, foodItems: scans, recipes };
    return query.trim()
      ? rankFoodMatches({ ...sources, query }, { limit: 30 })
      : recentFoods(sources, { limit: 15 });
  }, [query, logs, scans, recipes]);

  const handlePick = (entry) => {
    onPick?.(entry);
    onClose?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="food-search-overlay"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: kbInset }}
            className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[85vh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <h2 className="font-heading font-bold text-base">
                {tFallback('nutrition.search.title', 'Search')}
              </h2>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-secondary active:bg-secondary transition-colors"
                aria-label={tFallback('common.close', 'Close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Query */}
            <div className="px-5 pt-4 pb-3 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-muted-foreground absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tFallback('nutrition.search.placeholder', 'Search your foods')}
                  className="w-full h-11 ps-9 pe-9 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {query && (
                  <button
                    onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                    className="absolute end-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-secondary active:bg-secondary"
                    aria-label={tFallback('nutrition.search.clear', 'Clear search')}
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-5 pb-5">
              <p className="eyebrow mb-2">
                {query.trim()
                  ? tFallback('nutrition.search.results', 'Results')
                  : tFallback('nutrition.search.recent', 'Your foods')}
              </p>

              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : results.length === 0 ? (
                <div className="text-center py-8">
                  <Search className="w-9 h-9 text-muted-foreground mx-auto mb-2" />
                  <p className="font-heading font-semibold text-sm">
                    {query.trim()
                      ? tFallback('nutrition.search.noneTitle', 'Nothing matches that yet')
                      : tFallback('nutrition.search.emptyTitle', 'No foods yet')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">
                    {tFallback(
                      'nutrition.search.noneBody',
                      'This searches foods you have scanned, recipes you have saved and meals you have logged. Scan a barcode or log a meal and it will show up here.',
                    )}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {results.map((r) => {
                    const meta = SOURCE_META[r.source] || SOURCE_META[FOOD_SOURCE.RECENT];
                    const { Icon } = meta;
                    return (
                      <button
                        key={r.key}
                        onClick={() => handlePick(r)}
                        className="w-full text-start flex items-center gap-2.5 rounded-xl border border-border px-2.5 py-2 hover:bg-secondary/40 active:bg-secondary/40 transition-colors"
                      >
                        <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                          <Icon className={`w-4 h-4 ${meta.cls}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-heading font-semibold text-sm leading-tight truncate">{r.name}</p>
                          <p className="text-micro text-muted-foreground truncate">
                            {[r.brand, r.servingLabel, tFallback(`foodSearch.source.${r.source}`, meta.label)].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        {/* A zero gets no figure. `safeEntry` in Nutrition.jsx
                            maps every blank numeric field to 0 on save, so a
                            stored 0 means "nobody said" at least as often as
                            it means "no calories" — production has such a row
                            (`food_name: 'ck'`, sixteen untouched inputs). It
                            rendered here as a confident "0 cal" beside foods
                            with real numbers. Same gate, same reasoning, as
                            MacroNutrientBox's tiles. */}
                        {r.calories > 0 && (
                          <div className="text-end shrink-0">
                            <p className="font-heading font-bold text-sm tabular-nums">{Math.round(r.calories)}</p>
                            <p className="text-micro text-muted-foreground -mt-0.5">cal</p>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
