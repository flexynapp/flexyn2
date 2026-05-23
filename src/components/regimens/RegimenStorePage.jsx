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
  Dumbbell, Users, Star, Flame, Plus,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as regimens from '@/lib/data/regimens';
import * as regimenReviews from '@/lib/data/regimenReviews';
import StarRating from './StarRating';
import RegimenReviewsBlock from './RegimenReviewsBlock';

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

  // Live aggregate rating for this card. Single-row lookup with
  // generous staleTime — store cards re-render often and this is
  // cosmetic.
  const { data: ratingAgg } = useQuery({
    queryKey: ['regimenReviewAgg', regimen.id],
    queryFn:  async () => (await regimenReviews.aggregatesFor([regimen.id])).get(regimen.id) || null,
    enabled:  !!regimen.id,
    staleTime: 5 * 60_000,
  });

  // First-exercise preview — show 3 names inline below the title so
  // the buyer sees what they're getting without expanding the card.
  const exercisePreview = useMemo(() => {
    const list = (regimen.exercises || [])
      .map(e => e.name || e.exercise_name)
      .filter(Boolean);
    if (list.length === 0) return null;
    return { names: list.slice(0, 3), more: Math.max(0, list.length - 3) };
  }, [regimen.exercises]);

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
              {regimen.difficulty && (
                <Badge variant="outline" className="text-[10px] shrink-0 capitalize">
                  {regimen.difficulty}
                </Badge>
              )}
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

            {/* First-exercise preview — teaser of what's inside the
                regimen without forcing the user to expand the card. */}
            {exercisePreview && (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                <span className="opacity-60">Includes: </span>
                {exercisePreview.names.join(' · ')}
                {exercisePreview.more > 0 && (
                  <span className="opacity-60"> · +{exercisePreview.more} more</span>
                )}
              </p>
            )}

            {/* Stats row */}
            <div className="flex items-center gap-3 mt-2">
              <DownloadBadge count={copyCount} />
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Dumbbell className="w-3 h-3" />
                {regimen.exercises?.length || 0} exercises
              </span>
              {/* Aggregate rating — quiet when no reviews yet. */}
              {ratingAgg && ratingAgg.review_count > 0 && (
                <span className="flex items-center gap-1 text-xs">
                  <StarRating value={ratingAgg.avg_rating} size="sm" />
                  <span className="text-muted-foreground">
                    {ratingAgg.avg_rating.toFixed(1)} · {ratingAgg.review_count}
                  </span>
                </span>
              )}
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

              {/* Reviews — aggregate + list + your-review composer.
                  Adoption-gate is enforced server-side. */}
              <RegimenReviewsBlock regimenId={regimen.id} user={user} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Main store page ───────────────────────────────────────────────────────────

export default function RegimenStorePage({ onBack, onPublish }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('All');
  const [difficultyFilter, setDifficultyFilter] = useState('All');
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

        // Difficulty filter (mig 120). NULL/unset on the regimen
        // means "unrated" — only matches the 'All' option, never a
        // specific bucket. Avoids silently miscategorizing legacy
        // regimens.
        const matchDifficulty = difficultyFilter === 'All'
          || tmpl.difficulty === difficultyFilter;

        return matchSearch && matchMuscle && matchDifficulty;
      })
      // Re-sort by download count descending after filter
      .sort((a, b) => {
        const ca = (a.copy_count || a.clone_count || 0);
        const cb = (b.copy_count || b.clone_count || 0);
        return cb - ca;
      });
  }, [templates, search, muscleFilter, difficultyFilter]);

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

      {/* ── Difficulty filter chips (mig 120) ───────────────────────────── */}
      <div className="flex gap-1.5 pb-2 mb-4 overflow-x-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
        {[
          { id: 'All',          label: 'Any level' },
          { id: 'beginner',     label: 'Beginner' },
          { id: 'intermediate', label: 'Intermediate' },
          { id: 'advanced',     label: 'Advanced' },
        ].map(opt => {
          const isActive = difficultyFilter === opt.id;
          return (
            <motion.button
              key={opt.id}
              whileTap={{ scale: 0.93 }}
              onClick={() => setDifficultyFilter(opt.id)}
              className={[
                'shrink-0 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide border transition-colors',
                isActive
                  ? 'bg-foreground/90 text-background border-foreground/90'
                  : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground bg-card/50',
              ].join(' ')}
            >
              {opt.label}
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
        <div className="space-y-3">
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            onClick={onPublish}
            className="group w-full rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-card hover:bg-primary/5 transition-colors p-5 flex items-center gap-4 text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-primary/10 group-hover:bg-primary/20 border border-primary/20 flex items-center justify-center shrink-0 transition-colors">
              <Plus className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                Publish a Regimen
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Build your own program and share it with the community
              </p>
            </div>
            <ChevronLeft className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors rotate-180 shrink-0" />
          </motion.button>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-10"
          >
            <Dumbbell className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-semibold text-sm">
              {search || muscleFilter !== 'All' ? 'No results' : 'No public regimens yet'}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              {search
                ? 'Try different keywords or clear the search.'
                : muscleFilter !== 'All'
                  ? `No public regimens targeting ${muscleFilter} yet.`
                  : 'Be the first to publish one above!'}
            </p>
          </motion.div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* ── Publish slot — always first ──────────────────────────────── */}
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            onClick={onPublish}
            className="group w-full rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-card hover:bg-primary/5 transition-colors p-5 flex items-center gap-4 text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-primary/10 group-hover:bg-primary/20 border border-primary/20 flex items-center justify-center shrink-0 transition-colors">
              <Plus className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                Publish a Regimen
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Build your own program and share it with the community
              </p>
            </div>
            <ChevronLeft className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors rotate-180 shrink-0" />
          </motion.button>

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
