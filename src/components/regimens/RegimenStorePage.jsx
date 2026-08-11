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
import { toast } from '@/lib/toast';
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
import { regimenLoad } from '@/lib/regimenLoad';
import StarRating from './StarRating';
import RegimenReviewsBlock from './RegimenReviewsBlock';

// All muscle groups the app recognises — hardcoded so the chips are always
// shown even when the loaded templates don't cover every group.
// Keep in step with MuscleGroupSelector.jsx and RegimenForm.jsx — the same
// array, three times. See the note in MuscleGroupSelector for why 'Traps'
// is here. Here it is the FILTER vocabulary, so omitting it would hide the
// neck exercises from the store's muscle filter rather than just from a
// picker dropdown.
const ALL_MUSCLE_GROUPS = [
  'Chest', 'Back', 'Traps', 'Shoulders', 'Biceps', 'Triceps', 'Forearms',
  'Legs', 'Glutes', 'Core', 'Full Body', 'Cardio',
];

// How many muscle chips a card will draw before collapsing the rest into
// a "+N". Four is one row at 390 pt.
//
// Found by rendering: "Full Body Strength" resolves to EIGHT groups, which
// wrapped to a second row and made that card visibly taller than its
// neighbours. The chips are on the card to tell two regimens apart at a
// glance — a regimen that lists everything is not being distinguished by
// them, it is just being made expensive. The first four are the groups of
// the opening (usually compound) lifts, since `regimenMuscles` walks the
// exercises in order.
const MUSCLE_CHIP_CAP = 4;

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
// Renders NOTHING at zero. It used to render a grey "0", which is the app
// telling the reader nobody wanted this — and copy_count is 0 on every
// public regimen in the store, so that was every card, always. The badge
// is correct the moment the number is real; until then it is absent
// rather than damning. Same reasoning governs PopularityBadge and the
// rating block below.
function DownloadBadge({ count }) {
  const n = Number(count) || 0;
  if (n === 0) return null;
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
      <span className="inline-flex items-center gap-0.5 text-micro font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 rounded-full px-2 py-0.5">
        <Star className="w-2.5 h-2.5 fill-current" /> Top
      </span>
    );
  }
  if (count >= 10) {
    return (
      <span className="inline-flex items-center gap-0.5 text-micro font-bold uppercase tracking-wider text-orange-500 bg-orange-500/10 rounded-full px-2 py-0.5">
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

  // NO AUTHOR ON THE CARD, DELIBERATELY. This used to read
  // `handle(regimen)`, which rendered "@Back & Shoulders Builder" —
  // the regimen's own title, presented as the person who wrote it.
  // `displayName` walks `username || … || u.name`, and a regimen row's
  // `name` is its title, so a row that carries no author name always
  // resolves to itself. `listPublic` does `select('*')` off `regimens`
  // with no join, so there is no author name on the row to find.
  //
  // Showing "@athlete" instead would be honest and useless. The fragment
  // is dropped until the query actually carries an author; putting it
  // back means joining `public_profiles` in `listPublic`, not calling a
  // different display helper here.

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

  // First-exercise preview — the first three lifts WITH their prescribed
  // load, as rows rather than a truncated "Includes: A · B · C" line.
  // This is the thing being adopted, and it was already in the payload
  // the card renders from.
  const exercisePreview = useMemo(() => {
    const list = (regimen.exercises || [])
      .map(e => ({
        name: e.name || e.exercise_name,
        load: e.target_sets && e.target_reps
          ? `${e.target_sets} × ${e.target_reps}`
          : e.target_sets ? `${e.target_sets} sets` : null,
      }))
      .filter(e => e.name);
    if (list.length === 0) return null;
    return { lifts: list.slice(0, 3), total: list.length };
  }, [regimen.exercises]);

  // What the regimen costs you — exercises, sets, and roughly how long.
  // Derived, not stored; see src/lib/regimenLoad.js for why this replaced
  // the difficulty badge as the card's deciding signal.
  const load = useMemo(() => regimenLoad(regimen), [regimen]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="rounded-xl border bg-card shadow-sm overflow-hidden"
    >
      <div className="p-4">
        {/* Title — full width. Nothing shares the line: the Adopt button
            and the Preview toggle used to take a right-hand column, which
            squeezed every title into two-thirds of the card for no
            benefit, since both actions now sit at the foot of the card. */}
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-heading font-bold text-base leading-tight">
            {regimen.name}
          </h3>
          <PopularityBadge count={copyCount} index={index} />
          {isMine && (
            <Badge variant="outline" className="text-micro shrink-0">Yours</Badge>
          )}
        </div>

        {/* Cost line — who wrote it, and what it asks of you. Every
            fragment is dropped when it cannot be derived rather than
            rendered as a zero, so a regimen with no set counts shows the
            author and the exercise count and stops there. */}
        <p className="text-xs text-muted-foreground mt-1">
          {load.exercises > 0 && <>{load.exercises} exercises</>}
          {load.sets > 0 && <> · {load.sets} sets</>}
          {load.minutes !== null && (
            <span className="font-bold text-primary ms-1.5">~{load.minutes} min</span>
          )}
        </p>

        {/* Earned signals, on their own line and only once they exist.
            They sat in the action row first, and rendering the traction
            case showed why that fails: downloads + five stars + the score
            + Add on one 390 pt row squeezed "Preview all 8" down to
            "Previe…". They are facts ABOUT the regimen, so they belong
            with the cost line, not competing with the buttons. Absent on
            every regimen in the store today, so this row costs nothing
            until it is true. */}
        {(copyCount > 0 || (ratingAgg && ratingAgg.review_count > 0)) && (
          <div className="flex items-center gap-3 mt-1">
            <DownloadBadge count={copyCount} />
            {ratingAgg && ratingAgg.review_count > 0 && (
              <span className="flex items-center gap-1 text-xs">
                <StarRating value={ratingAgg.avg_rating} size="sm" />
                <span className="text-muted-foreground">
                  {ratingAgg.avg_rating.toFixed(1)} · {ratingAgg.review_count}
                </span>
              </span>
            )}
          </div>
        )}

        {/* Muscle chips, promoted above the description — they are the one
            line that separates "Legs & Core Destroyer" from "Back &
            Shoulders Builder". They used to sit last, under a stats row on
            which every number was identical across every card. */}
        {muscles.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {muscles.slice(0, MUSCLE_CHIP_CAP).map(m => (
              <Badge key={m} variant="secondary" className="text-micro font-normal px-2 py-0.5">
                {m}
              </Badge>
            ))}
            {muscles.length > MUSCLE_CHIP_CAP && (
              <Badge variant="secondary" className="text-micro font-normal px-2 py-0.5 text-muted-foreground">
                +{muscles.length - MUSCLE_CHIP_CAP}
              </Badge>
            )}
          </div>
        )}

        {regimen.description ? (
          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
            {regimen.description}
          </p>
        ) : null}

        {/* The first three lifts, with load. */}
        {exercisePreview && (
          <div className="mt-2 pt-2 border-t border-border/50">
            {exercisePreview.lifts.map((lift, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2 py-0.5">
                <span className="text-sm truncate">{lift.name}</span>
                {lift.load && (
                  <span className="text-xs font-semibold text-muted-foreground shrink-0 tabular-nums">
                    {lift.load}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Action row. `Add` is a repeated 34 pt pill rather than a
            full-width primary — one dominant element per screen, and four
            stacked full-width primaries would fight for the page. */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 -ms-1 px-1 py-1.5 rounded-sm text-xs font-semibold text-muted-foreground hover:text-foreground active:text-foreground transition-colors min-w-0"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
            <span className="truncate">
              {expanded ? 'Show less' : `Preview all ${load.exercises}`}
            </span>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {!isMine ? (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => adoptMutation.mutate()}
                disabled={adoptMutation.isPending || adoptMutation.isSuccess}
                className={[
                  'flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-bold transition-colors',
                  adoptMutation.isSuccess
                    ? 'bg-emerald-500/15 text-emerald-500 cursor-default'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/90 disabled:opacity-60',
                ].join(' ')}
              >
                <Download className="w-3.5 h-3.5" />
                {adoptMutation.isSuccess ? 'Saved!' : adoptMutation.isPending ? '…' : 'Add'}
              </motion.button>
            ) : (
              <span className="text-micro text-muted-foreground">Your regimen</span>
            )}
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
                    <span className="font-medium truncate me-2">{ex.name || ex.exercise_name}</span>
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
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors px-2 py-1.5 rounded-lg hover:bg-secondary active:bg-secondary"
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
                <span className="ms-1.5">
                  · <Users className="inline w-3 h-3 mb-0.5" /> {totalDownloads} total downloads
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* ── Search bar ───────────────────────────────────────────────────── */}
      <div className="relative mb-3">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={searchRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search regimens, exercises…"
          className="ps-9 h-11 text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground active:text-foreground transition-colors text-xs"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Muscle group filter chips ─────────────────────────────────────── */}
      <div
        ref={chipRowRef}
        className="flex gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-hide"
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
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground active:text-foreground bg-card',
              ].join(' ')}
            >
              {group}
            </motion.button>
          );
        })}
      </div>

      {/* ── Difficulty filter chips (mig 120) ───────────────────────────── */}
      <div className="flex gap-1.5 pb-2 mb-4 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
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
                'shrink-0 px-3 py-1 rounded-full text-micro font-bold uppercase tracking-wide border transition-colors',
                isActive
                  ? 'bg-foreground/90 text-background border-foreground/90'
                  : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground active:text-foreground bg-card/50',
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
            className="group w-full rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-card hover:bg-primary/5 active:bg-primary/5 transition-colors p-5 flex items-center gap-4 text-start"
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
            className="group w-full rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-card hover:bg-primary/5 active:bg-primary/5 transition-colors p-5 flex items-center gap-4 text-start"
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
