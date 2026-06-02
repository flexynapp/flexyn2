// src/components/nutrition/PortionGuide.jsx
//
// "How big is a serving?" cheat sheet — visual estimates for the
// most-confused portions. Inspired by the printable handouts every
// nutritionist gives clients. Folded into a collapsible card so users
// who know the math don't have to look at it; users who don't can
// expand it the first time they log a meal.
//
// Estimates are common visual analogs:
//   • Palm    ≈ 3 oz protein (chicken, fish)
//   • Cupped hand ≈ 1 cup carbs (rice, pasta cooked)
//   • Thumb   ≈ 1 tbsp fats (peanut butter, butter)
//   • Fist    ≈ 1 cup vegetables / fruit

import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const GUIDES = [
  { emoji: '🖐️', name: 'Open palm',     equals: '3 oz protein',      examples: 'Chicken, fish, lean beef' },
  { emoji: '🤲', name: 'Cupped hand',    equals: '1 cup carbs',       examples: 'Cooked rice, pasta, oats' },
  { emoji: '👍', name: 'Thumb',          equals: '1 tbsp fats',       examples: 'Nut butter, oil, butter' },
  { emoji: '✊', name: 'Closed fist',    equals: '1 cup veg/fruit',   examples: 'Berries, broccoli, leafy greens' },
  { emoji: '🃏', name: 'Deck of cards',  equals: '~3 oz protein',     examples: 'Steak, pork chop' },
  { emoji: '🎾', name: 'Tennis ball',    equals: '~1 cup',            examples: 'Pasta serving, ice cream' },
];

export default function PortionGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-start hover:bg-secondary/30 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">🤲</span>
          <div>
            <p className="text-sm font-bold">Portion guide</p>
            <p className="text-[10px] text-muted-foreground">No scale? Eyeball it.</p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <ul className="px-4 pb-3 space-y-2 border-t border-border/40 pt-2">
          {GUIDES.map((g) => (
            <li key={g.name} className="flex items-start gap-3 text-xs">
              <span className="text-xl shrink-0 leading-none" aria-hidden="true">{g.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">
                  {g.name}
                  <span className="text-muted-foreground font-normal"> ≈ </span>
                  <span className="text-primary">{g.equals}</span>
                </p>
                <p className="text-[10px] text-muted-foreground">{g.examples}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
