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

export default function ExerciseActionsMenu({ name, onPair, onPlateCalc, onFormCheck, onRemove }) {
  const { tFallback } = useLanguage();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors"
          aria-label={tFallback('workout.exerciseOptions', 'Options for {name}', { name })}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        {onPair && (
          <DropdownMenuItem onSelect={onPair}>
            <Link2 /> {tFallback('workout.pairAsSuperset', 'Pair as superset')}
          </DropdownMenuItem>
        )}
        {onPlateCalc && (
          <DropdownMenuItem onSelect={onPlateCalc}>
            <Calculator /> {tFallback('workout.plateCalc', 'Plate calculator')}
          </DropdownMenuItem>
        )}
        {onFormCheck && (
          <DropdownMenuItem onSelect={onFormCheck}>
            <Camera /> {tFallback('workout.checkMyForm', 'Check my form')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onRemove} className="text-destructive focus:text-destructive">
          <Trash2 /> {tFallback('workout.removeExercise', 'Remove')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
