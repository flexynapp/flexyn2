// One ⋯ button per exercise in the active session. It collects what used to
// be two bare icons on the card (pair, remove) and two full width buttons
// above the list (plate calculator, Form Coach), so the card keeps its
// header for the exercise itself and the tools sit next to the lift they
// are for. "How to do it" joined them: it was a full width row on every
// card, paid for by everyone who already knows the lift.

import React from 'react';
import { MoreHorizontal, Link2, Calculator, Camera, BookOpen, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
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

// Move up / Move down replaced the grip pill that sat on top of every card.
// A drag handle is one more look-alike control, it is invisible to a
// keyboard or a screen reader, and it caught scrolls; two menu rows do the
// same job and work everywhere. Each is offered only when there is
// somewhere to move to.
//
// `compact` keeps the old 32px look (44px hit area) for the cardio card,
// which floats the menu over its own header. The exercise card puts it in
// its header row, where it is a 44px ghost button.
export default function ExerciseActionsMenu({ name, onPair, onPlateCalc, onFormCheck, onHowTo, onMoveUp, onMoveDown, onRemove, compact = false }) {
  const { tFallback } = useLanguage();
  const reduceMotion = useReducedMotion();
  const hasTools = !!(onPair || onPlateCalc || onFormCheck || onHowTo);
  const hasMoves = !!(onMoveUp || onMoveDown);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <motion.button
          type="button"
          whileTap={reduceMotion ? undefined : { scale: 0.97 }}
          className={compact
            ? "relative w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary data-[state=open]:bg-secondary data-[state=open]:text-foreground transition-colors after:absolute after:-inset-1.5 after:content-['']"
            : 'w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary data-[state=open]:bg-secondary data-[state=open]:text-foreground transition-colors'}
          aria-label={tFallback('workout.exerciseOptions', 'Options for {name}', { name })}
        >
          <MoreHorizontal className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
        </motion.button>
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
        {/* Offered only when the exercise has a guide; a custom lift the
            user typed in has none, and a row that opens nothing is worse
            than no row. */}
        {onHowTo && (
          <DropdownMenuItem onSelect={onHowTo} className={ITEM}>
            <BookOpen aria-hidden="true" /> {tFallback('exerciseForm.howTo', 'How to do it')}
          </DropdownMenuItem>
        )}
        {hasTools && hasMoves && <DropdownMenuSeparator className="mx-2 my-1 bg-border" />}
        {onMoveUp && (
          <DropdownMenuItem onSelect={onMoveUp} className={ITEM}>
            <ArrowUp aria-hidden="true" /> {tFallback('workout.moveUp', 'Move up')}
          </DropdownMenuItem>
        )}
        {onMoveDown && (
          <DropdownMenuItem onSelect={onMoveDown} className={ITEM}>
            <ArrowDown aria-hidden="true" /> {tFallback('workout.moveDown', 'Move down')}
          </DropdownMenuItem>
        )}
        {/* A hairline only when there is something above it to separate. */}
        {(hasTools || hasMoves) && <DropdownMenuSeparator className="mx-2 my-1 bg-border" />}
        <DropdownMenuItem onSelect={onRemove} className={DESTRUCTIVE}>
          <Trash2 aria-hidden="true" /> {tFallback('workout.removeExercise', 'Remove exercise')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
