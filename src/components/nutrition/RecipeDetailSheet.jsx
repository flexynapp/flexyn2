// src/components/nutrition/RecipeDetailSheet.jsx
//
// Boards C and F of the Penpot page "Recipes" — one component, two modes.
//
//   mode="mine"      your own recipe: log it, edit it, share it, ⋯
//   mode="community" someone else's: who wrote it, and save your own copy
//
// This screen exists because tapping a recipe used to open the EDIT form.
// "Look at what's in this" and "change what's in this" were the same gesture,
// so the safe, common intent was served by the destructive, rare one. Editing
// is now a deliberate second choice behind the overflow.
//
// TODO(i18n): English-only, matching the rest of the Recipes surface.

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
  ChevronLeft, MoreHorizontal, ImageIcon, Loader2, Download, Info, Globe,
} from 'lucide-react';
import {
  perServingCals, perServingMacros, servingsLabel, scaledIngredients, microChips,
} from '@/lib/recipeFormat';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

function MacroTiles({ recipe }) {
  const { p, c, f } = perServingMacros(recipe);
  const tiles = [
    { v: perServingCals(recipe), l: 'Calories', cls: 'text-orange-500' },
    { v: `${p} g`, l: 'Protein', cls: 'text-red-500' },
    { v: `${c} g`, l: 'Carbs',   cls: 'text-blue-500' },
    { v: `${f} g`, l: 'Fat',     cls: 'text-yellow-500' },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {tiles.map((t) => (
        <div key={t.l} className="rounded-lg bg-secondary/40 p-2">
          <p className={`font-heading text-base font-bold tabular-nums ${t.cls}`}>{t.v}</p>
          <p className="text-micro text-muted-foreground mt-0.5">{t.l}</p>
        </div>
      ))}
    </div>
  );
}

export default function RecipeDetailSheet({
  open, recipe, mode = 'mine', busy = false,
  onLog, onEdit, onSave, onOverflow, onTogglePublish, onClose,
}) {
  const { tFallback } = useLanguage();
  useBodyScrollLock(open);
  if (!open || !recipe) return null;

  const isMine = mode === 'mine';
  const ingredients = scaledIngredients(recipe, 1);
  const chips = microChips(recipe);
  const meta = isMine
    ? `Yours · ${servingsLabel(recipe)}`
    : `Community recipe${recipe.author_username ? ` · by @${recipe.author_username}` : ''}`;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[9999] bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-lg bg-card border border-border rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-xl flex flex-col"
          style={{ maxHeight: '92vh' }}
        >
          {/* The photo is this screen's one dominant element, so it is the
              only thing allowed to bleed to the edges. */}
          <div className="relative shrink-0">
            {recipe.image_url ? (
              <img src={recipe.image_url} alt="" className="w-full h-40 object-cover" />
            ) : (
              <div className="w-full h-24 bg-secondary/50 flex items-center justify-center">
                <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
              </div>
            )}
            <button
              onClick={onClose}
              aria-label={tFallback("achievements.vault.back", "Back")}
              className="absolute top-3 start-3 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {isMine && (
              <button
                onClick={() => onOverflow?.(recipe)}
                aria-label={tFallback("recipeDetailSheet.moreActions", "More actions")}
                className="absolute top-3 end-3 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-4 pt-3">
              <h2 className="font-heading font-bold text-lg leading-tight">{recipe.name}</h2>
              <p className="text-caption text-muted-foreground mt-0.5">{meta}</p>
            </div>

            <div className="px-4 pt-6">
              <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mb-2">
                Per serving
              </p>
              <MacroTiles recipe={recipe} />
            </div>

            {ingredients.length > 0 && (
              <div className="px-4 pt-6">
                <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mb-1">
                  Ingredients · scaled to 1 serving
                </p>
                <ul className="divide-y divide-border/60">
                  {ingredients.map((ing, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2 py-2">
                      <span className="text-label font-medium min-w-0">{ing.name}</span>
                      <span className="text-caption text-muted-foreground shrink-0">{ing.amount}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {recipe.directions && (
              <div className="px-4 pt-6">
                <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mb-1">
                  Directions
                </p>
                <p className="text-caption text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {recipe.directions}
                </p>
              </div>
            )}

            {chips.length > 0 && (
              <div className="px-4 pt-6">
                <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mb-2">
                  More nutrients · per serving
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((chip, i) => (
                    <span key={i} className="px-2 py-1 rounded-full bg-secondary/50 text-micro text-muted-foreground">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Sharing is named and its consequence is written down. It used
                to be an unlabelled globe icon on the list row. */}
            {isMine && (
              <div className="px-4 pt-6">
                <div className="flex items-center gap-3 pt-3 border-t border-border">
                  <span className="min-w-0 flex-1">
                    <span className="block text-label font-semibold">{tFallback("recipeDetailSheet.sharedToDiscover", "Shared to Discover")}</span>
                    <span className="block text-micro text-muted-foreground">
                      {recipe.is_public
                        ? 'Anyone can find and save this recipe'
                        : 'Only you can see this recipe'}
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!recipe.is_public}
                    aria-label={tFallback("recipeDetailSheet.sharedToDiscover", "Shared to Discover")}
                    disabled={busy}
                    onClick={() => onTogglePublish?.(recipe)}
                    className={`w-11 h-6 shrink-0 rounded-full transition-colors relative ${
                      recipe.is_public ? 'bg-success' : 'bg-secondary'
                    } disabled:opacity-60`}
                  >
                    <span
                      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                        recipe.is_public ? 'start-[22px]' : 'start-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {!isMine && (
              <div className="px-4 pt-6">
                <div className="flex items-start gap-2 rounded-lg bg-secondary/40 p-3">
                  <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-micro text-muted-foreground leading-relaxed">
                    Macros were entered by the author, not verified. Saving makes your own
                    editable copy — the original is untouched.
                  </p>
                </div>
              </div>
            )}

            <div className="h-4" />
          </div>

          <div className="px-4 py-3 border-t border-border flex gap-2 safe-sheet-bottom">
            {isMine ? (
              <>
                <button
                  type="button"
                  onClick={() => onLog?.(recipe)}
                  className="flex-1 h-12 rounded-lg bg-primary text-primary-foreground text-sm font-bold"
                >
                  Log {perServingCals(recipe)} cal
                </button>
                <button
                  type="button"
                  onClick={() => onEdit?.(recipe)}
                  className="w-24 h-12 rounded-lg border border-border bg-secondary/40 text-label font-semibold"
                >
                  Edit
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onSave?.(recipe)}
                  disabled={busy}
                  className="flex-1 h-12 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Save to My Recipes
                </button>
                <button
                  type="button"
                  onClick={() => onLog?.(recipe)}
                  className="w-24 h-12 rounded-lg border border-border bg-secondary/40 text-label font-semibold"
                >
                  Log
                </button>
              </>
            )}
          </div>

          {/* Screen readers get the sharing state as text, not as a colour. */}
          {isMine && recipe.is_public && (
            <span className="sr-only">
              <Globe className="w-3 h-3" /> This recipe is shared to Discover
            </span>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
