// src/components/regimens/RegimenStorePage.jsx
//
// Full-page inline Regimen Store. Browse every public regimen sorted by
// download count (copy_count). Filter by muscle group. Adopt any regimen
// into your own library in one tap.
//
// Rendered inline inside Workout.jsx when the user clicks "Explore Regimens"
// — not a dialog/modal, a full-view replacement.

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search, Download, ChevronLeft, ChevronDown, ChevronUp,
  Dumbbell, Users, Star, Flame,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as regimens from '@/lib/data/regimens';

// All muscle groups the app recognises — hardcoded so the chips are always
// shown even when the loaded templates don't cover every group.
const ALL_MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Legs', 'Glutes', 'Core', 'Full Body', 'Cardio',
];

// Returns the muscle groups that appear in a regimen's exercise list.
function regimenMuscles(regimen) {
  const seen = new Set();
  (regimen.exercises || []).forEach(ex => {
    const groups = ex.muscle_groups?.length
      ? ex.muscle_groups
      : ex.muscle_group ? [ex.muscle_group] : [];
    groups.forEach(g => seen.add(g));
  });
  return Array.from(seen);
}

// ── Download badge ────────────────────────────────────────────────────────────
function DownloadBadge({ count }) {
  const n = Number(count) || 0;
  if (n === 0) return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground/60">
      <Download className="w-3 h-3" />0
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-primary">
      <Download className="w-3 h-3" />{n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n}
    </span>
  );
}

// ── Popularity tier badge ─────────────────────────────────────────────────────
function PopularityBadge({ count, index }) {
  if (index === 0 && count > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 rounded-full px-2 py-0.5">
        <Star className="w-2.5 h-2.5 fill-current" /> Top
      </span>
    );
  }
  if (count >= 10) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-500 bg-orange-500/10 rounded-full px-2 py-0.5">
        <Flame className="w-2.5 h-2.5" /> Hot
      </span>
    );
  }
  return null;
}

// ── Regimen card ──────────────────────────────────────────────────────────────
function RegimenCard({ regimen, index, isMine, user, onAdopted }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const muscles = useMemo(() => regimenMuscles(regimen), [regimen]);

  const authorHandle = regimen.author_username
    ? `@${regimen.author_username}`
    : `@${(regimen.created_by || '').split('@')[0]}`;

  const adoptMutation = useMutation({
    mutationFn: () => regimens.copyTemplate(regimen, user),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regimens', user?.email] });
      qc.invalidateQueries({ queryKey: ['publicTemplates'] });
      qc.invalidateQueries({ queryKey: ['publicRegimens'] });
      toast.success(`"${regimen.name}" saved to your Regimens!`);
      onAdopted?.();
    },
    onError: () => toast.error('Could not adopt regimen — try again.'),
  });

  const copyCount = regimen.copy_count || regimen.clone_count || 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="rounded-xl border bg-card shadow-sm overflow-hidden"
    >
      <div className="p-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h3 className="font-heading font-bold text-base leading-tight">
                {regimen.name}
              </h3>
              <PopularityBadge count={copyCount} index={index} />
              {isMine && (
                <Badge variant="outline" className="text-[10px] shrink-0">Yours</Badge>
              )}
            </div>

            <p className="text-xs text-muted-foreground">{authorHandle}</p>

            {regimen.description ? (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {regimen.description}
              </p>
            ) : null}

            {/* Stats row */}
            <div className="flex items-center gap-3 mt-2">
              <DownloadBadge count={copyCount} />
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Dumbbell className="w-3 h-3" />
                {regimen.exercises?.length || 0} exercises
              </span>
            </div>

            {/* Muscle group chips */}
            {muscles.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {muscles.map(m => (
                  <Badge key={m} variant="secondary" className="text-[11px] font-normal px-2 py-0.5">
                    {m}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Right action column */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {!isMine ? (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => adoptMutation.mutate()}
                disabled={adoptMutation.isPending || adoptMutation.isSuccess}
                className={[
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors',
                  adoptMutation.isSuccess
                    ? 'bg-emerald-500/15 text-emerald-500 cursor-default'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60',
                ].join(' ')}
              >
                <Download className="w-3.5 h-3.5" />
                {adoptMutation.isSuccess ? 'Saved!' : adoptMutation.isPending ? '…' : 'Adopt'}
              </motion.button>
            ) : (
              <span className="text-[11px] text-muted-foreground px-1">Your regimen</span>
            )}

            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded ? 'Less' : 'Preview'}
            </button>
          </div>
        </div>

        {/* Expanded exercise list */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-border/50 space-y-1.5">
                {(regimen.exercises || []).map((ex, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-0.5">
                    <span className="font-medium truncate mr-2">{ex.name || ex.exercise_name}</span>
                    <span className="text-muted-foreground text-xs shrink-0">
                      {ex.target_sets && ex.target_reps
                        ? `${ex.target_sets} × ${ex.target_reps}`
                        : ex.target_sets
                          ? `${ex.target_sets} sets`
                          : '—'}
                    </span>
                  </div>
                ))}
                {(regimen.exercises || []).length === 0 && (
                  <p className="text-xs text-muted-foreground">No exercises listed.</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Main store page ───────────────────────────────────────────────────────────

export default function RegimenStorePage({ onBack }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('All');
  const chipRowRef = useRef(null);
  const searchRef = useRef(null);

  // Auto-focus search bar on mount
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 200);
  }, []);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['publicRegimens'],
    queryFn: () => regimens.listPublic(200),
    staleTime: 30_000,
  });

  // Sort: always by copy_count desc (listPublic already does this, but we
  // re-sort after filtering so filtered results remain ranked correctly)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return templates
      .filter(tmpl => {
        // Text search — name, description, exercise names
        const matchSearch = !q
          || tmpl.name?.toLowerCase().includes(q)
          || tmpl.description?.toLowerCase().includes(q)
          || (tmpl.exercises || []).some(ex =>
              (ex.name || ex.exercise_name || '').toLowerCase().includes(q)
            );

        // Muscle group filter
        const matchMuscle = muscleFilter === 'All'
          || (tmpl.exercises || []).some(ex => {
              const groups = ex.muscle_groups?.length
                ? ex.muscle_groups
                : ex.muscle_group ? [ex.muscle_group] : [];
              return groups.some(g =>
                g?.toLowerCase() === muscleFilter.toLowerCase()
              );
            });

        return matchSearch && matchMuscle;
      })
      // Re-sort by download count descending after filter
      .sort((a, b) => {
        const ca = (a.copy_count || a.clone_count || 0);
        const cb = (b.copy_count || b.clone_count || 0);
        return cb - ca;
      });
  }, [templates, search, muscleFilter]);

  const totalDownloads = useMemo(
    () => templates.reduce((s, t) => s + (t.copy_count || t.clone_count || 0), 0),
    [templates]
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="mb-8"
    >
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5">
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg hover:bg-secondary"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </motion.button>

        <div className="flex-1 min-w-0">
          <h2 className="font-heading font-bold text-xl leading-tight">Explore Regimens</h2>
          {!isLoading && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {templates.length} public programs
              {totalDownloads > 0 && (
                <span className="ml-1.5">
                  · <Users className="inline w-3 h-3 mb-0.5" /> {totalDownloads} total downloads
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* ── Search bar ───────────────────────────────────────────────────── */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={searchRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search regimens, exercises…"
          className="pl-9 h-11 text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors text-xs"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Muscle group filter chips ─────────────────────────────────────── */}
      <div
        ref={chipRowRef}
        className="flex gap-1.5 overflow-x-auto pb-2 mb-4 no-scrollbar"
        style={{ scrollbarWidth: 'none' }}
      >
        {['All', ...ALL_MUSCLE_GROUPS].map(group => {
          const isActive = muscleFilter === group;
          return (
            <motion.button
              key={group}
              whileTap={{ scale: 0.93 }}
              onClick={() => setMuscleFilter(group)}
              className={[
                'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground bg-card',
              ].join(' ')}
            >
              {group}
            </motion.button>
          );
        })}
      </div>

      {/* ── Result count label ────────────────────────────────────────────── */}
      {!isLoading && (
        <p className="text-xs text-muted-foreground mb-3 px-0.5">
          {filtered.length === 0
            ? 'No matching regimens'
            : filtered.length === 1
              ? '1 regimen'
              : `${filtered.length} regimens`}
          {(search || muscleFilter !== 'All') && ' matching your filters'}
          {!search && muscleFilter === 'All' && ' · ranked by downloads'}
        </p>
      )}

      {/* ── Regimen list ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16"
        >
          <Dumbbell className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="font-heading font-bold text-base mb-1">
            {search || muscleFilter !== 'All' ? 'No results' : 'No public regimens yet'}
          </p>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            {search
              ? 'Try different keywords or clear the search.'
              : muscleFilter !== 'All'
                ? `No public regimens targeting ${muscleFilter} yet.`
                : 'Be the first — make a regimen public in your Regimens tab.'}
          </p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((tmpl, i) => (
              <RegimenCard
                key={tmpl.id}
                regimen={tmpl}
                index={i}
                isMine={tmpl.created_by === user?.email}
                user={user}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
