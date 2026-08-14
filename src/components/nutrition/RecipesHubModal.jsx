// src/components/nutrition/RecipesHubModal.jsx
//
// The Recipes home — boards A, B and E of the Penpot page "Recipes".
//
//   • My Recipes — your saved recipes. Empty, it offers the three real routes
//     to a first one instead of a glyph and a sentence. Populated, every row
//     carries a Log action, because logging is what a saved recipe is FOR.
//   • Discover   — every user's published recipes, with search and filters.
//
// What moved, and why:
//
//   Tapping a row used to open the EDIT form. It now opens a detail sheet;
//   editing is a deliberate choice behind the overflow (board J).
//
//   Publish and delete used to be two 32px icon buttons crowded against the
//   right edge of every row, one of them an unlabelled globe that silently
//   made a recipe public. Both live in the overflow now, named, with their
//   consequences written underneath them.
//
//   Discover used to lead with a full-width orange "Post a recipe" button
//   that opened a picker of your own unpublished recipes — a publishing tool
//   sitting on top of a browsing surface, and the loudest thing on it.
//   Publishing belongs to the recipe being published: the labelled toggle on
//   the detail sheet.
//
// This component owns the builder and the sheets so the whole flow stays
// self-contained; the only thing it hands upward is the LOG, which goes to
// the Nutrition page's existing save mutation rather than a second write path.
//
// TODO(i18n): this surface has always been English-only; new copy matches it
// rather than half-translating one screen.

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
  X, Plus, Loader2, ChefHat, Globe, Utensils, ImageIcon, Search,
  PencilLine, History, Compass, ChevronRight, MoreHorizontal,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import * as recipes from '@/lib/data/nutritionRecipes';
import { recipeFromLog } from '@/lib/data/nutritionRecipes';
import { perServingCals, perServingMacros, macroLine, servingsLabel } from '@/lib/recipeFormat';
import RecipeBuilderModal from './RecipeBuilderModal';
import RecipeDetailSheet from './RecipeDetailSheet';
import RecipeOverflowSheet from './RecipeOverflowSheet';
import LogRecipeSheet from './LogRecipeSheet';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

// Square thumbnail — the recipe photo, or a placeholder.
function RecipeThumb({ recipe, className = 'w-14 h-14' }) {
  return recipe?.image_url ? (
    <img src={recipe.image_url} alt="" className={`${className} rounded-lg object-cover shrink-0`} />
  ) : (
    <div className={`${className} rounded-lg bg-secondary flex items-center justify-center shrink-0`}>
      <ImageIcon className="w-4 h-4 text-muted-foreground/50" />
    </div>
  );
}

// One of the three routes on the empty state.
function RouteCard({ Icon, tint, title, sub, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-lg border border-border text-start hover:bg-secondary/30 active:bg-secondary/30"
    >
      <span className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${tint}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-label font-semibold">{title}</span>
        <span className="block text-micro text-muted-foreground">{sub}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
}

const DISCOVER_FILTERS = [
  { id: 'all',     label: 'All',            test: () => true },
  { id: 'protein', label: 'High protein',   test: (r) => perServingMacros(r).p >= 25 },
  { id: 'light',   label: 'Under 400 cal',  test: (r) => perServingCals(r) < 400 },
];

export default function RecipesHubModal({
  open, onClose, userProfile,
  logDate, defaultMealType = 'snack', onLogRecipe, logBusy = false,
}) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('mine');             // 'mine' | 'discover'
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [builderSeed, setBuilderSeed] = useState(null); // pre-filled from a diary row
  const [detail, setDetail] = useState(null);         // { recipe, mode }
  const [overflowRecipe, setOverflowRecipe] = useState(null);
  const [logTarget, setLogTarget] = useState(null);   // recipe being logged
  const [busyId, setBusyId] = useState(null);         // row-level pending action
  const [pickingLog, setPickingLog] = useState(false);// "from a meal you logged"
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const mine = useQuery({
    queryKey: ['nutritionRecipes', user?.id],
    queryFn:  () => recipes.listMine(user.id),
    enabled:  !!user?.id && open,
  });
  const discover = useQuery({
    queryKey: ['nutritionRecipesPublic', user?.id],
    queryFn:  () => recipes.listPublic({ excludeUserId: user.id }),
    enabled:  !!user?.id && open && tab === 'discover',
  });

  // Recent diary rows for "from a meal you logged". Shares the query key with
  // LogMealForm's history tab and the Meal History page, so this costs a
  // fetch only when none of them has run — and only while the empty state,
  // the one screen that offers the route, is on screen.
  const history = useQuery({
    queryKey: ['nutritionHistory', user?.email],
    queryFn:  () => db.entities.NutritionLog.filter({ created_by: user.email }, '-created_at', 300),
    enabled:  !!user?.email && open && tab === 'mine' && (mine.data?.length === 0),
    staleTime: 60_000,
  });

  // Two cache keys hold the same list: this hub and the planner use
  // ['nutritionRecipes'], while FoodSearchSheet uses ['nutritionRecipesMine']
  // with a 60s staleTime. Invalidating only the first left a recipe you had
  // just created missing from food search for a minute.
  const invalidateMine = () => {
    queryClient.invalidateQueries({ queryKey: ['nutritionRecipes', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['nutritionRecipesMine', user?.id] });
  };
  const invalidateDiscover = () => queryClient.invalidateQueries({ queryKey: ['nutritionRecipesPublic', user?.id] });

  const myRecipes = useMemo(() => mine.data || [], [mine.data]);
  const publicRecipes = discover.data || [];

  // Search and filters run over the rows listPublic() already returned — no
  // query, no migration, and instant on every keystroke.
  const visibleDiscover = useMemo(() => {
    const q = query.trim().toLowerCase();
    const test = DISCOVER_FILTERS.find((f) => f.id === filter)?.test || (() => true);
    return publicRecipes.filter((r) => {
      if (!test(r)) return false;
      if (!q) return true;
      return (r.name || '').toLowerCase().includes(q)
        || (r.author_username || '').toLowerCase().includes(q);
    });
  }, [publicRecipes, query, filter]);

  // Only meals — water rows are the majority of nutrition_logs and are not
  // something anyone builds a recipe from. See the CLAUDE.md note on how
  // hydration is encoded in this table.
  const seedableLogs = useMemo(() => {
    const seen = new Set();
    return (history.data || [])
      .filter((l) => {
        if (!l?.food_name || !(Number(l.calories) > 0)) return false;
        if (/^water(\||$)/i.test(l.food_name)) return false;
        const key = l.food_name.trim().toLowerCase();
        if (seen.has(key)) return false;   // one row per distinct meal
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  }, [history.data]);

  const openNew = () => { setEditingRecipe(null); setBuilderSeed(null); setBuilderOpen(true); };
  const openEdit = (recipe) => { setEditingRecipe(recipe); setBuilderSeed(null); setBuilderOpen(true); };
  const openFromLog = (log) => {
    setEditingRecipe(null);
    setBuilderSeed(recipeFromLog(log));
    setPickingLog(false);
    setBuilderOpen(true);
  };
  const closeBuilder = () => { setBuilderOpen(false); setEditingRecipe(null); setBuilderSeed(null); };

  const handleRemove = async (recipe) => {
    setBusyId(recipe.id);
    try {
      await recipes.remove(recipe.id);
      invalidateMine();
      setOverflowRecipe(null);
      setDetail(null);
      toast.success('Recipe removed.');
    } catch (err) {
      toast.error(`Couldn't remove: ${err?.message || 'try again'}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleTogglePublish = async (recipe) => {
    const publishing = !recipe.is_public;
    setBusyId(recipe.id);
    try {
      await recipes.setPublished({
        id: recipe.id,
        isPublic: publishing,
        authorUsername: userProfile?.username || null,
      });
      invalidateMine();
      invalidateDiscover();
      // Keep the open sheets showing what the row now is, without a refetch
      // round-trip — the toggle must not flick back while the query settles.
      const next = { ...recipe, is_public: publishing };
      setDetail((d) => (d && d.recipe?.id === recipe.id ? { ...d, recipe: next } : d));
      setOverflowRecipe((o) => (o?.id === recipe.id ? next : o));
      toast.success(publishing ? 'Shared to Discover.' : 'Removed from Discover.');
    } catch (err) {
      toast.error(`Couldn't update: ${err?.message || 'try again'}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveCopy = async (recipe) => {
    // Saving the same community recipe twice used to write a second identical
    // row with no warning, and the two are indistinguishable in the list.
    const already = myRecipes.some(
      (r) => (r.name || '').trim().toLowerCase() === (recipe.name || '').trim().toLowerCase(),
    );
    if (already) {
      toast.info('You already have a recipe with that name.');
      setTab('mine');
      setDetail(null);
      return;
    }
    setBusyId(recipe.id);
    try {
      await recipes.saveCopy({ user, recipe });
      invalidateMine();
      setDetail(null);
      toast.success('Saved to My Recipes.');
      setTab('mine'); // jump to My Recipes so the user sees the clone land
    } catch (err) {
      toast.error(`Couldn't save: ${err?.message || 'try again'}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDuplicate = async (recipe) => {
    setBusyId(recipe.id);
    try {
      await recipes.saveCopy({ user, recipe: { ...recipe, name: `${recipe.name} (copy)` } });
      invalidateMine();
      setOverflowRecipe(null);
      toast.success('Duplicated.');
    } catch (err) {
      toast.error(`Couldn't duplicate: ${err?.message || 'try again'}`);
    } finally {
      setBusyId(null);
    }
  };

  // The log itself is the Nutrition page's job — see the head comment.
  const handleLogSubmit = (payload, context) => {
    onLogRecipe?.(payload, context);
    setLogTarget(null);
    setDetail(null);
  };

  if (!open) return null;

  const overflowBusy = !!busyId && busyId === overflowRecipe?.id;
  const detailBusy = !!busyId && busyId === detail?.recipe?.id;

  return createPortal(
    <>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[9998] bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <motion.div
            initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg bg-card border border-border rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-xl flex flex-col"
            style={{ maxHeight: '92vh' }}
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="font-heading font-bold text-base flex items-center gap-2">
                <ChefHat className="w-4 h-4" /> {tFallback("recipesHubModal.recipes", "Recipes")}
              </h2>
              <button onClick={onClose} aria-label={tFallback("common.close", "Close")} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-4 pb-2">
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-secondary/50">
                {[
                  { id: 'mine', label: 'My Recipes' },
                  { id: 'discover', label: 'Discover' },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`h-8 rounded-md text-label font-semibold transition-colors ${
                      tab === t.id ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {tab === 'mine' ? (
                <>
                  {mine.isLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : myRecipes.length === 0 ? (
                    /* ── Empty state — board A ─────────────────────────── */
                    <div className="pt-2">
                      {pickingLog ? (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">
                              {tFallback("recipesHubModal.pickAMealToStart", "Pick a meal to start from")}
                            </p>
                            <button
                              type="button"
                              onClick={() => setPickingLog(false)}
                              className="text-micro font-semibold text-muted-foreground"
                            >
                              {tFallback("achievements.vault.back", "Back")}
                            </button>
                          </div>
                          {seedableLogs.length === 0 ? (
                            <p className="text-caption text-muted-foreground py-6 text-center">
                              Nothing logged yet to start from — build one from scratch instead.
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {seedableLogs.map((log) => (
                                <button
                                  key={log.id}
                                  type="button"
                                  onClick={() => openFromLog(log)}
                                  className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-secondary/40 active:bg-secondary/40 text-start"
                                >
                                  <RecipeThumb recipe={log} className="w-10 h-10" />
                                  <span className="flex-1 min-w-0">
                                    <span className="block text-label font-semibold truncate">{log.food_name}</span>
                                    <span className="block text-micro text-muted-foreground">
                                      {Math.round(Number(log.calories) || 0)} cal
                                    </span>
                                  </span>
                                  <Plus className="w-4 h-4 text-primary shrink-0" />
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <h3 className="font-heading font-bold text-base">{tFallback("recipesHubModal.saveAMealYouEat", "Save a meal you eat often")}</h3>
                          <p className="text-caption text-muted-foreground mt-1">
                            Build it once. From then on it logs in one tap, with the macros
                            already filled in.
                          </p>
                          <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mt-6 mb-2">
                            {tFallback("recipesHubModal.threeWaysToStart", "Three ways to start")}
                          </p>
                          <div className="space-y-2">
                            <RouteCard
                              Icon={PencilLine}
                              tint="bg-primary/15 text-primary"
                              title={tFallback("recipesHubModal.buildFromScratch", "Build from scratch")}
                              sub="Ingredients, macros, directions"
                              onClick={openNew}
                            />
                            <RouteCard
                              Icon={History}
                              tint="bg-info/15 text-info"
                              title={tFallback("recipesHubModal.fromAMealYouLogged", "From a meal you logged")}
                              sub={seedableLogs.length
                                ? `Turn “${seedableLogs[0].food_name}” into one`
                                : 'Reuse something already in your diary'}
                              onClick={() => setPickingLog(true)}
                            />
                            <RouteCard
                              Icon={Compass}
                              tint="bg-success/15 text-success"
                              title={tFallback("recipesHubModal.browseDiscover", "Browse Discover")}
                              sub="Save someone else’s, then make it yours"
                              onClick={() => setTab('discover')}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    /* ── Saved list — board B ──────────────────────────── */
                    <>
                      <div className="flex items-baseline justify-between mb-2">
                        <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">{tFallback("journal.saved", "Saved")}</p>
                        <p className="text-micro text-muted-foreground">values per serving</p>
                      </div>
                      <div className="space-y-2">
                        {myRecipes.map(recipe => (
                          <div key={recipe.id} className="rounded-lg border border-border p-3">
                            <div className="flex items-center gap-2">
                              <button
                                className="flex-1 flex items-center gap-2.5 text-start min-w-0"
                                onClick={() => setDetail({ recipe, mode: 'mine' })}
                              >
                                <RecipeThumb recipe={recipe} />
                                <span className="min-w-0">
                                  <span className="block font-semibold text-sm leading-tight truncate">
                                    {recipe.name}
                                  </span>
                                  <span className="block text-micro text-muted-foreground mt-0.5">
                                    {perServingCals(recipe)} cal · {macroLine(recipe)}
                                  </span>
                                  <span className="flex items-center gap-1.5 mt-1">
                                    {recipe.is_public && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-success/60 text-micro font-bold text-success">
                                        <Globe className="w-2.5 h-2.5" /> {tFallback("recipesHubModal.shared", "Shared")}
                                      </span>
                                    )}
                                    <span className="text-micro text-muted-foreground">
                                      {servingsLabel(recipe)}
                                    </span>
                                  </span>
                                </span>
                              </button>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => setLogTarget(recipe)}
                                  className="h-8 px-3 rounded-md border border-primary text-primary text-caption font-bold"
                                >
                                  {tFallback("cardio.start.cta.manual", "Log")}
                                </button>
                                <button
                                  onClick={() => setOverflowRecipe(recipe)}
                                  aria-label={`More actions for ${recipe.name}`}
                                  className="w-8 h-8 rounded-md text-muted-foreground hover:bg-secondary active:bg-secondary flex items-center justify-center"
                                >
                                  {busyId === recipe.id
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <MoreHorizontal className="w-4 h-4" />}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={openNew}
                        className="w-full flex items-center justify-center gap-1.5 py-3 mt-6 rounded-lg bg-primary text-primary-foreground text-sm font-bold"
                      >
                        <Plus className="w-4 h-4" /> {tFallback("recipesHubModal.newRecipe", "New recipe")}
                      </button>
                    </>
                  )}
                </>
              ) : (
                /* ── Discover — board E ───────────────────────────────── */
                <>
                  <div className="relative mb-2">
                    <Search className="w-4 h-4 text-muted-foreground absolute start-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={tFallback("recipesHubModal.searchCommunityRecipes", "Search community recipes")}
                      aria-label={tFallback("recipesHubModal.searchCommunityRecipes", "Search community recipes")}
                      // text-base keeps iOS Safari from zooming the viewport
                      // on focus — anything under 16px triggers the auto-zoom.
                      className="w-full h-10 ps-9 pe-3 rounded-lg border border-input bg-background text-base"
                    />
                  </div>
                  <div className="flex gap-1.5 mb-2 overflow-x-auto scrollbar-hide">
                    {DISCOVER_FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilter(f.id)}
                        aria-pressed={filter === f.id}
                        className={`h-8 px-3 shrink-0 rounded-full text-micro font-semibold border transition-colors ${
                          filter === f.id
                            ? 'bg-foreground text-background border-transparent'
                            : 'border-border text-muted-foreground'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {discover.isLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : visibleDiscover.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Utensils className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      {publicRecipes.length === 0 ? (
                        <>
                          <p className="text-sm font-semibold">{tFallback("recipesHubModal.noCommunityRecipesYet", "No community recipes yet")}</p>
                          <p className="text-xs mt-1">
                            Share one of yours from its detail screen and it lands here.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold">{tFallback("recipesHubModal.nothingMatches", "Nothing matches that")}</p>
                          <p className="text-xs mt-1">Try a different search or filter.</p>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {visibleDiscover.map(recipe => (
                        <div key={recipe.id} className="rounded-lg border border-border p-3">
                          <div className="flex items-center gap-2">
                            <button
                              className="flex-1 flex items-center gap-2.5 text-start min-w-0"
                              onClick={() => setDetail({ recipe, mode: 'community' })}
                            >
                              <RecipeThumb recipe={recipe} />
                              <span className="min-w-0">
                                <span className="block font-semibold text-sm leading-tight truncate">{recipe.name}</span>
                                <span className="block text-micro text-muted-foreground mt-0.5">
                                  {recipe.author_username ? `by @${recipe.author_username}` : 'Community recipe'}
                                </span>
                                <span className="block text-micro text-muted-foreground mt-0.5">
                                  {perServingCals(recipe)} cal · {macroLine(recipe)}
                                </span>
                              </span>
                            </button>
                            <button
                              onClick={() => handleSaveCopy(recipe)}
                              disabled={busyId === recipe.id}
                              className="h-8 px-3 shrink-0 rounded-md border border-info text-info text-caption font-bold disabled:opacity-60"
                            >
                              {busyId === recipe.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : 'Save'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>

      <RecipeDetailSheet
        open={!!detail}
        recipe={detail?.recipe}
        mode={detail?.mode}
        busy={detailBusy}
        onClose={() => setDetail(null)}
        onLog={(recipe) => setLogTarget(recipe)}
        onEdit={(recipe) => { setDetail(null); openEdit(recipe); }}
        onSave={handleSaveCopy}
        onTogglePublish={handleTogglePublish}
        onOverflow={(recipe) => setOverflowRecipe(recipe)}
      />

      <RecipeOverflowSheet
        open={!!overflowRecipe}
        recipe={overflowRecipe}
        busy={overflowBusy}
        onClose={() => setOverflowRecipe(null)}
        onEdit={(recipe) => { setOverflowRecipe(null); setDetail(null); openEdit(recipe); }}
        onDuplicate={handleDuplicate}
        onTogglePublish={handleTogglePublish}
        onRemove={handleRemove}
      />

      <LogRecipeSheet
        open={!!logTarget}
        recipe={logTarget}
        date={logDate}
        defaultMealType={defaultMealType}
        busy={logBusy}
        onLog={handleLogSubmit}
        onClose={() => setLogTarget(null)}
      />

      <RecipeBuilderModal
        open={builderOpen}
        editingRecipe={editingRecipe}
        seedRecipe={builderSeed}
        onClose={closeBuilder}
      />
    </>,
    document.body,
  );
}
