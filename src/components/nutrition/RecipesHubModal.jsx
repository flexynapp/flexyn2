// src/components/nutrition/RecipesHubModal.jsx
//
// The Recipes home. Opening "Recipes" from the Nutrition page lands here
// rather than jumping straight into the builder. Two tabs:
//
//   • My Recipes — the user's saved recipes. Create a new one, edit,
//     delete (remove), or publish/unpublish to the community feed.
//   • Discover   — every user's published recipes. Browse, expand to see
//     ingredients + directions, and "Save" to clone one into My Recipes.
//
// The builder modal (RecipeBuilderModal) is owned here so new/edit flows
// stay self-contained within the hub.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
  X, Plus, Trash2, Loader2, ChefHat, Globe, Lock, Download,
  ChevronDown, Utensils, ImageIcon,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import * as recipes from '@/lib/data/nutritionRecipes';
import RecipeBuilderModal from './RecipeBuilderModal';

// Per-serving calorie headline for a recipe row.
function perServingCals(recipe) {
  const s = Number(recipe?.servings) > 0 ? Number(recipe.servings) : 1;
  return Math.round((Number(recipe?.totals?.calories) || 0) / s);
}
function macroLine(recipe) {
  const s = Number(recipe?.servings) > 0 ? Number(recipe.servings) : 1;
  const t = recipe?.totals || {};
  const p = Math.round((Number(t.protein_g) || 0) / s);
  const c = Math.round((Number(t.carbs_g) || 0) / s);
  const f = Math.round((Number(t.fat_g) || 0) / s);
  return `${p}P · ${c}C · ${f}F`;
}

// Square thumbnail — the recipe photo, or a fork/knife placeholder.
function RecipeThumb({ recipe, className = 'w-12 h-12' }) {
  return recipe?.image_url ? (
    <img src={recipe.image_url} alt="" className={`${className} rounded-md object-cover shrink-0`} />
  ) : (
    <div className={`${className} rounded-md bg-secondary flex items-center justify-center shrink-0`}>
      <ImageIcon className="w-4 h-4 text-muted-foreground/50" />
    </div>
  );
}

function RecipeDetails({ recipe }) {
  const ings = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const micros = Array.isArray(recipe.micros) ? recipe.micros : [];
  return (
    <div className="mt-2 pt-2 border-t border-border/60 space-y-2 text-[12px]">
      <div>
        <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Ingredients</p>
        <ul className="space-y-0.5">
          {ings.map((ing, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>{ing.name}</span>
              <span className="text-muted-foreground shrink-0">
                {ing.amount || ing.grams || 0}{ing.unit ? ` ${ing.unit}` : ' g'} · {Math.round(Number(ing.calories) || 0)} cal
              </span>
            </li>
          ))}
        </ul>
      </div>
      {micros.length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Nutrients</p>
          <div className="flex flex-wrap gap-1">
            {micros.map((m, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded-full bg-secondary/50 text-[11px]">
                {m.label}: {m.amount}{m.unit}
              </span>
            ))}
          </div>
        </div>
      )}
      {recipe.directions && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Directions</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{recipe.directions}</p>
        </div>
      )}
    </div>
  );
}

export default function RecipesHubModal({ open, onClose, userProfile }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('mine');           // 'mine' | 'discover'
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [expanded, setExpanded] = useState(null);   // recipe id whose details are open
  const [busyId, setBusyId] = useState(null);       // row-level pending action
  const [showPostPicker, setShowPostPicker] = useState(false); // "+ post to Discover" sheet

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

  const invalidateMine = () => queryClient.invalidateQueries({ queryKey: ['nutritionRecipes', user?.id] });
  const invalidateDiscover = () => queryClient.invalidateQueries({ queryKey: ['nutritionRecipesPublic', user?.id] });

  const openNew = () => { setEditingRecipe(null); setBuilderOpen(true); };
  const openEdit = (recipe) => { setEditingRecipe(recipe); setBuilderOpen(true); };

  const handleDelete = async (recipe) => {
    if (!window.confirm(`Remove "${recipe.name}"? This can't be undone.`)) return;
    setBusyId(recipe.id);
    try {
      await recipes.remove(recipe.id);
      invalidateMine();
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
      toast.success(publishing ? 'Shared to Discover.' : 'Removed from Discover.');
    } catch (err) {
      toast.error(`Couldn't update: ${err?.message || 'try again'}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveCopy = async (recipe) => {
    setBusyId(recipe.id);
    try {
      await recipes.saveCopy({ user, recipe });
      invalidateMine();
      toast.success('Saved to My Recipes.');
      setTab('mine'); // jump to My Recipes so the user sees the clone land
    } catch (err) {
      toast.error(`Couldn't save: ${err?.message || 'try again'}`);
    } finally {
      setBusyId(null);
    }
  };

  // Post a chosen saved recipe to Discover from the "+" picker.
  const handlePost = async (recipe) => {
    setBusyId(recipe.id);
    try {
      await recipes.setPublished({ id: recipe.id, isPublic: true, authorUsername: userProfile?.username || null });
      invalidateMine();
      invalidateDiscover();
      setShowPostPicker(false);
      toast.success('Posted to Discover.');
    } catch (err) {
      toast.error(`Couldn't post: ${err?.message || 'try again'}`);
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  const myRecipes = mine.data || [];
  const publicRecipes = discover.data || [];

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
                <ChefHat className="w-4 h-4" /> Recipes
              </h2>
              <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
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
                    className={`h-8 rounded-md text-[13px] font-semibold transition-colors ${
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
                  <button
                    type="button"
                    onClick={openNew}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 mb-3 rounded-lg bg-primary text-primary-foreground text-sm font-bold"
                  >
                    <Plus className="w-4 h-4" /> New recipe
                  </button>

                  {mine.isLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : myRecipes.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Utensils className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm font-semibold">No saved recipes yet</p>
                      <p className="text-xs mt-1">Build one once, log it in a tap forever.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {myRecipes.map(recipe => (
                        <div key={recipe.id} className="rounded-lg border border-border p-3">
                          <div className="flex items-start gap-2">
                            <button className="flex-1 flex items-center gap-2.5 text-start" onClick={() => openEdit(recipe)}>
                              <RecipeThumb recipe={recipe} />
                              <span className="min-w-0">
                                <span className="font-semibold text-sm leading-tight flex items-center gap-1.5">
                                  <span className="truncate">{recipe.name}</span>
                                  {recipe.is_public && <Globe className="w-3 h-3 text-emerald-500 shrink-0" />}
                                </span>
                                <span className="block text-[11px] text-muted-foreground mt-0.5">
                                  {perServingCals(recipe)} cal/serving · {macroLine(recipe)}
                                  {Number(recipe.servings) > 1 ? ` · ${recipe.servings} servings` : ''}
                                </span>
                              </span>
                            </button>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                onClick={() => handleTogglePublish(recipe)}
                                disabled={busyId === recipe.id}
                                aria-label={recipe.is_public ? 'Unpublish' : 'Publish to Discover'}
                                title={recipe.is_public ? 'Remove from Discover' : 'Share to Discover'}
                                className={`w-8 h-8 rounded-md flex items-center justify-center ${
                                  recipe.is_public ? 'text-emerald-500 hover:bg-emerald-500/10' : 'text-muted-foreground hover:bg-secondary'
                                }`}
                              >
                                {busyId === recipe.id ? <Loader2 className="w-4 h-4 animate-spin" /> : (recipe.is_public ? <Globe className="w-4 h-4" /> : <Lock className="w-4 h-4" />)}
                              </button>
                              <button
                                onClick={() => handleDelete(recipe)}
                                disabled={busyId === recipe.id}
                                aria-label="Remove recipe"
                                className="w-8 h-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* + Post one of your saved recipes to Discover */}
                  <button
                    type="button"
                    onClick={() => setShowPostPicker(v => !v)}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 mb-3 rounded-lg bg-primary text-primary-foreground text-sm font-bold"
                  >
                    <Plus className="w-4 h-4" /> Post a recipe
                  </button>

                  {showPostPicker && (() => {
                    const postable = myRecipes.filter(r => !r.is_public);
                    return (
                      <div className="mb-3 rounded-lg border border-border p-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground px-1 mb-1.5">
                          Choose a recipe to post
                        </p>
                        {postable.length === 0 ? (
                          <p className="text-xs text-muted-foreground px-1 py-2">
                            {myRecipes.length === 0
                              ? 'Create a recipe first, then post it here.'
                              : 'All your recipes are already posted.'}
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {postable.map(recipe => (
                              <button
                                key={recipe.id}
                                onClick={() => handlePost(recipe)}
                                disabled={busyId === recipe.id}
                                className="w-full flex items-center gap-2.5 p-1.5 rounded-md hover:bg-secondary/50 text-start"
                              >
                                <RecipeThumb recipe={recipe} className="w-9 h-9" />
                                <span className="flex-1 min-w-0">
                                  <span className="block text-sm font-semibold truncate">{recipe.name}</span>
                                  <span className="block text-[11px] text-muted-foreground">{perServingCals(recipe)} cal/serving</span>
                                </span>
                                {busyId === recipe.id
                                  ? <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                  : <Plus className="w-4 h-4 text-primary" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {discover.isLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : publicRecipes.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Globe className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm font-semibold">No community recipes yet</p>
                      <p className="text-xs mt-1">Tap “Post a recipe” to share one of yours.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {publicRecipes.map(recipe => {
                        const isOpen = expanded === recipe.id;
                        return (
                          <div key={recipe.id} className="rounded-lg border border-border p-3">
                            <div className="flex items-start gap-2">
                              <button className="flex-1 flex items-center gap-2.5 text-start" onClick={() => setExpanded(isOpen ? null : recipe.id)}>
                                <RecipeThumb recipe={recipe} />
                                <span className="min-w-0">
                                  <span className="block font-semibold text-sm leading-tight truncate">{recipe.name}</span>
                                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                                    {perServingCals(recipe)} cal/serving · {macroLine(recipe)}
                                    {recipe.author_username ? ` · by ${recipe.author_username}` : ''}
                                  </span>
                                </span>
                              </button>
                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  onClick={() => handleSaveCopy(recipe)}
                                  disabled={busyId === recipe.id}
                                  aria-label="Save to My Recipes"
                                  title="Save to My Recipes"
                                  className="w-8 h-8 rounded-md text-primary hover:bg-primary/10 flex items-center justify-center"
                                >
                                  {busyId === recipe.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                </button>
                                <button
                                  onClick={() => setExpanded(isOpen ? null : recipe.id)}
                                  aria-label="Details"
                                  className="w-8 h-8 rounded-md text-muted-foreground hover:bg-secondary flex items-center justify-center"
                                >
                                  <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                </button>
                              </div>
                            </div>
                            {isOpen && <RecipeDetails recipe={recipe} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>

      <RecipeBuilderModal
        open={builderOpen}
        editingRecipe={editingRecipe}
        onClose={() => { setBuilderOpen(false); setEditingRecipe(null); }}
      />
    </>,
    document.body,
  );
}
