// src/components/nutrition/RecipeOverflowSheet.jsx
//
// Board J of the Penpot page "Recipes" — where edit, duplicate, sharing and
// removal went once they left the list row.
//
// Two 32px icon buttons used to sit crowded against the right edge of every
// row: a trash can, and an unlabelled globe that silently made a recipe
// public. Neither said what it did, and one of them was destructive. They are
// now named rows in a sheet you have to open on purpose, each with the
// consequence written underneath it.
//
// The removal confirm is in-app rather than `window.confirm()` — the browser's
// own grey dialog, rendered inside an installed PWA, is the one piece of
// chrome in this flow the app does not control.
//
// TODO(i18n): English-only, matching the rest of the Recipes surface.

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Pencil, Copy, Globe, Lock, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { servingsLabel } from '@/lib/recipeFormat';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

function ActionRow({ Icon, tint, label, sub, danger, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 py-3 text-start disabled:opacity-50"
    >
      <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${tint}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold ${danger ? 'text-destructive' : ''}`}>{label}</span>
        <span className="block text-micro text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}

export default function RecipeOverflowSheet({
  open, recipe, busy = false, onEdit, onDuplicate, onTogglePublish, onRemove, onClose,
}) {
  const { tFallback } = useLanguage();
  useBodyScrollLock(open);
  const [confirming, setConfirming] = useState(false);

  // Never open straight onto the destructive confirm — a sheet that was
  // dismissed mid-confirm and reopened must start at the menu again.
  useEffect(() => { if (open) setConfirming(false); }, [open, recipe?.id]);

  if (!open || !recipe) return null;
  const isPublic = !!recipe.is_public;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={busy ? undefined : onClose}
        className="fixed inset-0 z-[10000] bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-lg bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-xl safe-sheet-bottom"
        >
          {confirming ? (
            <div className="p-4">
              <span className="w-9 h-9 rounded-lg bg-destructive/15 text-destructive flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </span>
              <h2 className="mt-3 font-heading font-bold text-base">
                Remove “{recipe.name}”?
              </h2>
              <p className="mt-1 text-caption text-muted-foreground">
                Meals you already logged stay in your history, and planned meals keep
                what you planned. This can’t be undone.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="flex-1 h-11 rounded-lg border border-border bg-secondary/40 text-sm font-semibold disabled:opacity-60"
                >
                  {tFallback("recipeOverflowSheet.keep", "Keep it")}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove?.(recipe)}
                  disabled={busy}
                  className="flex-1 h-11 rounded-lg bg-destructive text-destructive-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  {tFallback('recipeOverflowSheet.remove', 'Remove')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 pt-4 pb-3 border-b border-border">
                <h2 className="font-heading font-bold text-base truncate">{recipe.name}</h2>
                <p className="text-micro text-muted-foreground mt-0.5">
                  {servingsLabel(recipe)}{isPublic ? ' · shared to Discover' : ''}
                </p>
              </div>

              <div className="px-4 divide-y divide-border">
                <ActionRow
                  Icon={Pencil}
                  tint="bg-primary/15 text-primary"
                  label="Edit recipe"
                  sub="Ingredients, macros, directions"
                  disabled={busy}
                  onClick={() => onEdit?.(recipe)}
                />
                <ActionRow
                  Icon={Copy}
                  tint="bg-info/15 text-info"
                  label="Duplicate"
                  sub="A private copy you can change freely"
                  disabled={busy}
                  onClick={() => onDuplicate?.(recipe)}
                />
                <ActionRow
                  Icon={isPublic ? Lock : Globe}
                  tint="bg-success/15 text-success"
                  label={isPublic ? 'Unshare from Discover' : 'Share to Discover'}
                  sub={isPublic
                    ? 'Copies people already saved stay theirs'
                    : 'Anyone can find and save this recipe'}
                  disabled={busy}
                  onClick={() => onTogglePublish?.(recipe)}
                />
                <ActionRow
                  Icon={Trash2}
                  tint="bg-destructive/15 text-destructive"
                  label="Remove from My Recipes"
                  sub="Logged meals stay in your history"
                  danger
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                />
              </div>

              <div className="p-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full h-11 rounded-lg text-sm font-semibold text-muted-foreground"
                >
                  {tFallback("coach.plan.cancel", "Cancel")}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
