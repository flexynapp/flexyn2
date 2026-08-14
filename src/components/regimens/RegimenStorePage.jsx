// src/components/regimens/RegimenStorePage.jsx
//
// Full-page inline Regimen Store. Browse every public regimen sorted by
// download count (copy_count). Filter by muscle group. Adopt any regimen
// into your own library in one tap.
//
// Rendered inline inside Workout.jsx when the user clicks "Explore Regimens"
// — not a dialog/modal, a full-view replacement.

import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/lib/toast';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search, Download, ChevronLeft, ChevronDown, ChevronUp,
  Dumbbell, Users, Star, Flame, Plus, X,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as regimens from '@/lib/data/regimens';
import * as regimenReviews from '@/lib/data/regimenReviews';
import { regimenLoad } from '@/lib/regimenLoad';
import { LIST_PRESENCE, listItemMotion } from '@/lib/listMotion';
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

// How many regimens train a given group. Used only by the no-matches
// copy, so it can tell someone their SEARCH emptied the list rather than
// their chip — the chip always has something behind it.
function muscleCount(templates, group) {
  const g = group.toLowerCase();
  return templates.filter(t => regimenMuscles(t).some(m => m?.toLowerCase() === g)).length;
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
  const { tFallback } = useLanguage();
  if (index === 0 && count > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-micro font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 rounded-full px-2 py-0.5">
        <Star className="w-2.5 h-2.5 fill-current" /> {tFallback("league.info.terminal", "Top")}
      </span>
    );
  }
  if (count >= 10) {
    return (
      <span className="inline-flex items-center gap-0.5 text-micro font-bold uppercase tracking-wider text-orange-500 bg-orange-500/10 rounded-full px-2 py-0.5">
        <Flame className="w-2.5 h-2.5" /> {tFallback("regimenStorePage.hot", "Hot")}
      </span>
    );
  }
  return null;
}

// ── Regimen card ──────────────────────────────────────────────────────────────
function RegimenCard({ regimen, index, isMine, user, onAdopted }) {
  const { t, tFallback } = useLanguage();
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
    /* listItemMotion(): layout="position" (these cards change place when
       the filter changes, never size), no first-paint animation, and no
       per-index stagger — filtering is now the main interaction on this
       page, and a stagger costs the most on exactly the frame where the
       user is waiting to read the result. listMotion.js names this
       surface as one of the four the shape was written for. */
    <motion.div
      {...listItemMotion()}
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
            <Badge variant="outline" className="text-micro shrink-0">{t('regimens.yourTemplate')}</Badge>
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
              <span className="text-micro text-muted-foreground">{tFallback("regimenStorePage.yourRegimen", "Your regimen")}</span>
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
  const { t, tFallback } = useLanguage();
  const [search, setSearch] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('All');
  // The search field is collapsed to an icon until asked for. It is a
  // 44 pt control over a store that currently holds four items, which is
  // furniture, not help. It expands in place and focuses THEN — the old
  // mount-time autofocus opened the phone keyboard over the list before
  // anyone had looked at it.
  const [searchOpen, setSearchOpen] = useState(false);
  const chipRowRef = useRef(null);
  const searchRef = useRef(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['publicRegimens'],
    queryFn: () => regimens.listPublic(200),
    staleTime: 30_000,
  });

  // Muscle chips are the groups this store ACTUALLY contains, not a
  // hardcoded vocabulary. ALL_MUSCLE_GROUPS lists eleven; the four public
  // regimens cover eight, so Traps, Full Body and Cardio were drawable
  // chips that could only ever return an empty store — the same defect as
  // the difficulty filter, one step less obvious.
  //
  // Derived from every template, NEVER from the filtered set: recomputing
  // against the current results would make chips vanish as you typed, and
  // the chip you had selected could delete itself.
  const availableMuscles = useMemo(() => {
    const present = new Set();
    templates.forEach(t => regimenMuscles(t).forEach(m => present.add(m)));
    // ALL_MUSCLE_GROUPS supplies the ORDER — an ordering that shifts with
    // the catalogue would move the chips under the user's thumb between
    // visits. Anything a regimen carries that the vocabulary doesn't know
    // still gets a chip, appended, rather than being silently unfilterable.
    const known = ALL_MUSCLE_GROUPS.filter(m => present.has(m));
    const extra = [...present].filter(m => !ALL_MUSCLE_GROUPS.includes(m)).sort();
    return [...known, ...extra];
  }, [templates]);

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

        // NO DIFFICULTY FILTER. It was four chips over `difficulty`,
        // which is NULL on every public regimen — so "Any level" returned
        // the store and each of the other three returned nothing. A
        // filter that can only fail is worse than no filter: it reads as
        // an empty store rather than as an unset column. Bring it back
        // when regimens actually carry a difficulty, which means asking
        // the author for one in RegimenForm.
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

  const filtering = search.trim() !== '' || muscleFilter !== 'All';
  const clearFilters = () => { setSearch(''); setMuscleFilter('All'); setSearchOpen(false); };

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="mb-8"
    >
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2">
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={onBack}
          aria-label={tFallback("achievements.vault.back", "Back")}
          className="flex items-center justify-center w-9 h-9 -ms-2 shrink-0 text-muted-foreground hover:text-foreground active:text-foreground transition-colors rounded-lg hover:bg-secondary active:bg-secondary"
        >
          <ChevronLeft className="w-5 h-5 rtl:scale-x-[-1]" />
        </motion.button>

        <div className="flex-1 min-w-0">
          <h2 className="font-heading font-bold text-xl leading-tight">{tFallback("workout.exploreRegimens", "Explore Regimens")}</h2>
          {!isLoading && templates.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {templates.length === 1 ? '1 program' : `${templates.length} programs`} shared by the community
              {totalDownloads > 0 && (
                <span className="ms-1.5">
                  · <Users className="inline w-3 h-3 mb-0.5" /> {totalDownloads} downloads
                </span>
              )}
            </p>
          )}
        </div>

        {/* Search collapses to a 36 pt target. Only drawn when there is
            something to search — one regimen does not need a search box. */}
        {templates.length > 1 && !searchOpen && (
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 60); }}
            aria-label={tFallback("regimenStorePage.searchRegimens", "Search regimens")}
            aria-expanded={false}
            className="flex items-center justify-center w-9 h-9 shrink-0 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
          >
            <Search className="w-4 h-4" />
          </motion.button>
        )}
      </div>

      {/* ── Search field, once asked for ──────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {searchOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="relative pt-2">
              <Search className="absolute start-3 top-1/2 mt-1 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); setSearchOpen(false); } }}
                placeholder={tFallback("regimenStorePage.searchRegimensExercises", "Search regimens, exercises…")}
                aria-label={tFallback("regimenStorePage.searchRegimens", "Search regimens")}
                className="ps-9 pe-9 h-11 text-sm"
              />
              <button
                onClick={() => { setSearch(''); setSearchOpen(false); }}
                className="absolute end-3 top-1/2 mt-1 -translate-y-1/2 text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                aria-label={search ? 'Clear search' : 'Close search'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Muscle group filter chips ─────────────────────────────────────── */}
      {/* Drawn only when there is more than one group to choose between —
          a lone "All" chip beside a lone "Legs" chip filters nothing. */}
      {availableMuscles.length > 1 && (
        <div
          ref={chipRowRef}
          className="flex gap-1.5 overflow-x-auto pt-3 pb-2 mb-2 scrollbar-hide"
          style={{ scrollbarWidth: 'none' }}
        >
          {['All', ...availableMuscles].map(group => {
            const isActive = muscleFilter === group;
            return (
              <motion.button
                key={group}
                whileTap={{ scale: 0.93 }}
                onClick={() => setMuscleFilter(group)}
                aria-pressed={isActive}
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
      )}

      {/* ── Result count label ────────────────────────────────────────────── */}
      {/* Only while filtering. Unfiltered, it restated the count already in
          the header one line above it — and appended "· ranked by
          downloads", a claim about an ordering that does not exist while
          every copy_count is 0. The ranking clause is kept, but only once
          there is a download to rank on. */}
      {!isLoading && filtering && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mb-2 px-0.5">
          {filtered.length === 1 ? '1 regimen' : `${filtered.length} regimens`}
          {muscleFilter !== 'All' && <> for {muscleFilter}</>}
          {search.trim() && <> matching “{search.trim()}”</>}
          {totalDownloads > 0 && ' · ranked by downloads'}
        </p>
      )}

      {/* ── Regimen list ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        /* ── The store is empty ────────────────────────────────────────
           Nobody has published anything. There is nothing to browse, so
           publishing is not a footnote here — it is the page. Distinct
           from "your filters matched nothing" below, which the old code
           conflated into one branch behind a dashed box. */
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-10"
        >
          <div className="w-16 h-16 rounded-full bg-card border border-border flex items-center justify-center mx-auto mb-4">
            <Dumbbell className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <p className="font-heading font-bold text-base">{tFallback("regimenStorePage.noPublicRegimensYet", "No public regimens yet")}</p>
          <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-xs mx-auto">
            Build a program you actually run, then share it. Yours would be the first.
          </p>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onPublish}
            className="inline-flex items-center gap-2 px-5 h-11 rounded-lg bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 active:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {tFallback("regimenStorePage.publishARegimen2", "Publish a regimen")}
          </motion.button>
        </motion.div>
      ) : filtered.length === 0 ? (
        /* ── Filters matched nothing ───────────────────────────────────
           The store HAS regimens; this search or this combination found
           none of them. Name what is filtering and offer the way back —
           not a dead end with a dashed box on it.

           Note that a muscle chip alone can no longer land here: the
           chips are derived from the catalogue, so every one of them
           matches at least one regimen. This is reachable by search, or
           by search combined with a chip. */
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-10"
        >
          <p className="font-heading font-bold text-base">{tFallback("regimenStorePage.noMatches", "No matches")}</p>
          <p className="text-sm text-muted-foreground mt-1 mb-5 max-w-xs mx-auto">
            {search.trim() && muscleFilter !== 'All'
              ? <>Nothing for “{search.trim()}” in {muscleFilter}. {muscleCount(templates, muscleFilter)} {muscleCount(templates, muscleFilter) === 1 ? 'regimen trains' : 'regimens train'} {muscleFilter} — try clearing the search.</>
              : search.trim()
                ? <>Nothing matches “{search.trim()}” across {templates.length === 1 ? 'the 1 published regimen' : `all ${templates.length} published regimens`}.</>
                : <>Nothing for {muscleFilter} yet.</>}
          </p>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={clearFilters}
            className="inline-flex items-center gap-2 px-4 h-10 rounded-lg border border-border bg-card font-bold text-sm hover:bg-secondary active:bg-secondary transition-colors"
          >
            Show all {templates.length}
          </motion.button>
        </motion.div>
      ) : (
        /* flex + gap on a RELATIVE container, not `space-y`. popLayout
           pins an exiting child at its measured offsetTop against the
           nearest positioned ancestor, and offsetTop already counts a
           space-y margin — so the margin lands twice and a leaving card
           drops one step on its way out. `src/lib/listMotion.js` explains
           it at length and `listMotion.test.js` guards it; that guard
           started failing the moment the publish slot moved out from
           between this container and the AnimatePresence, which is what
           had been hiding the violation from its heuristic.

           gap-2 rather than the old 12 px: the composition rules allow
           8 or 24 and ban the middle, and a list of cards is one group. */
        <div className="relative flex flex-col gap-2">
          <AnimatePresence {...LIST_PRESENCE}>
            {filtered.map((tmpl, i) => (
              <RegimenCard
                key={tmpl.id}
                regimen={tmpl}
                /* Still needed: PopularityBadge gives "Top" to rank 0.
                   It no longer staggers the entrance — see listItemMotion. */
                index={i}
                isMine={tmpl.created_by === user?.email}
                user={user}
              />
            ))}
          </AnimatePresence>

          {/* ── Publish, after the goods ─────────────────────────────────
              This was a 78 pt dashed box in the FIRST slot, taking the
              most valuable position on the page to advertise authoring to
              somebody who arrived to browse. It stays one tap away, below
              what they came for. Hidden while filtering, where it is an
              answer to a question nobody asked. */}
          {!filtering && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={onPublish}
              className="group w-full rounded-lg border border-border hover:border-primary/40 bg-transparent hover:bg-card active:bg-card transition-colors p-4 flex items-center gap-3 text-start"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                  {tFallback("regimenStorePage.builtSomethingThatWorks", "Built something that works?")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {tFallback("regimenStorePage.publishARegimen", "Publish a regimen for the community")}
                </p>
              </div>
              <ChevronLeft className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary transition-colors rotate-180 rtl:rotate-0 shrink-0" />
            </motion.button>
          )}
        </div>
      )}
    </motion.div>
  );
}
