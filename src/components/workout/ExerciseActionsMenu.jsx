// One ⋯ button per exercise in the active session. It collects what used to
// be two bare icons on the card (pair, remove) and two full width buttons
// above the list (plate calculator, Form Coach), so the card keeps its
// header for the exercise itself and the tools sit next to the lift they
// are for.

import React from 'react';
import { MoreHorizontal, Link2, Calculator, Camera, Trash2 } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/lib/LanguageContext';

// Row styling lives here rather than in ui/dropdown-menu.jsx so the other
// menus in the app keep their compact desktop density. This one is opened
// with a thumb mid-set: every row is 44px tall, icons sit in one 16px
// column in the muted tone so the labels carry the row, and only Remove
// takes a colour, the destructive one, icon included.
const ITEM = 'min-h-11 gap-3 px-3 rounded-lg text-sm font-medium text-foreground '
  + 'focus:bg-secondary focus:text-foreground [&>svg]:size-4 [&>svg]:text-muted-foreground';
const DESTRUCTIVE = 'min-h-11 gap-3 px-3 rounded-lg text-sm font-medium text-destructive '
  + 'focus:bg-destructive/10 focus:text-destructive [&>svg]:size-4 [&>svg]:text-destructive';

export default function ExerciseActionsMenu({ name, onPair, onPlateCalc, onFormCheck, onRemove }) {
  const { tFallback } = useLanguage();
  const hasTools = !!(onPair || onPlateCalc || onFormCheck);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {/* 32px to look at, 44px to hit: the ::after extends the target
            6px on every side without widening the header's reserved pe-8. */}
        <button
          type="button"
          className="relative w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary data-[state=open]:bg-secondary data-[state=open]:text-foreground transition-colors after:absolute after:-inset-1.5 after:content-['']"
          aria-label={tFallback('workout.exerciseOptions', 'Options for {name}', { name })}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem] rounded-2xl p-1">
        {onPair && (
          <DropdownMenuItem onSelect={onPair} className={ITEM}>
            <Link2 aria-hidden="true" /> {tFallback('workout.pairAsSuperset', 'Pair as superset')}
          </DropdownMenuItem>
        )}
        {onPlateCalc && (
          <DropdownMenuItem onSelect={onPlateCalc} className={ITEM}>
            <Calculator aria-hidden="true" /> {tFallback('workout.plateCalc', 'Plate calculator')}
          </DropdownMenuItem>
        )}
        {onFormCheck && (
          <DropdownMenuItem onSelect={onFormCheck} className={ITEM}>
            <Camera aria-hidden="true" /> {tFallback('workout.checkMyForm', 'Check my form')}
          </DropdownMenuItem>
        )}
        {/* A hairline only when there is something above it to separate. */}
        {hasTools && <DropdownMenuSeparator className="mx-2 my-1 bg-border" />}
        <DropdownMenuItem onSelect={onRemove} className={DESTRUCTIVE}>
          <Trash2 aria-hidden="true" /> {tFallback('workout.removeExercise', 'Remove exercise')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
