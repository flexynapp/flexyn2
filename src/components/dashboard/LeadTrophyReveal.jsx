// src/components/dashboard/LeadTrophyReveal.jsx
//
// The reveal for a Lead Lifter trophy (migration 20261001001000). Only one
// lifter holds each one a week, and it is awarded at the Monday roll while
// they are away, so it gets a sheet of its own on the next open rather than
// a toast: the trophy large, its name, and the way to the trophy case.
//
// Same composition rules as SeasonCeremonyModal: no glow, no gradient,
// hairline divider, two spacing registers. The trophy is the only thing on
// the sheet in the league's colour, and the only thing that moves: it lands
// once with a short settle, and holds still for reduced motion.

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/LanguageContext';
import { trophyName, trophyDescription } from '@/lib/trophyDefinitions';
import LeadLifterTrophyIcon from '@/components/leagues/LeadLifterTrophyIcon';

/**
 * @param {object}   props
 * @param {boolean}  props.open
 * @param {Function} props.onClose
 * @param {{ trophy_id: string, trophy: object }[]} props.items  newest first,
 *        the whole-league trophy ahead of a level one
 * @param {Function} [props.onOpenTrophyCase]
 */
export default function LeadTrophyReveal({ open, onClose, items, onOpenTrophyCase }) {
  const { tFallback } = useLanguage();
  const reduce = useReducedMotion();
  if (!open || !items?.length) return null;

  const [hero, ...rest] = items;
  const t = hero.trophy;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="px-6 pt-6 pb-6 flex flex-col">
          <DialogHeader className="space-y-0 text-start">
            <p className="kicker">
              {tFallback('league.leadReveal.eyebrow', 'Lead Lifter, week {week}', { week: t.week })}
            </p>
            <DialogTitle className="font-heading font-bold text-2xl leading-tight pt-2">
              {trophyName(t, tFallback)}
            </DialogTitle>
            <DialogDescription className="text-caption text-muted-foreground pt-2">
              {trophyDescription(t, tFallback)}
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-center pt-6">
            <motion.div
              initial={reduce ? false : { scale: 0.55, rotate: -8, y: 12 }}
              animate={{ scale: 1, rotate: 0, y: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.15 }}
            >
              <LeadLifterTrophyIcon
                tier={t.leagueTier}
                level={t.leadLevel}
                className="w-40 h-40"
              />
            </motion.div>
          </div>

          <p className="text-caption text-muted-foreground text-center pt-2">
            {tFallback('league.leadReveal.sub', 'Only one lifter holds this each week. It is in your trophy case now.')}
          </p>

          {rest.length > 0 && (
            <div className="pt-6">
              <div className="border-t border-border pt-2" />
              <p className="kicker">
                {tFallback('league.leadReveal.alsoWon', 'Also won')}
              </p>
              <div className="flex flex-col gap-2 pt-2">
                {rest.map((r) => (
                  <div key={r.trophy_id} className="flex items-center gap-2">
                    <LeadLifterTrophyIcon
                      tier={r.trophy.leagueTier}
                      level={r.trophy.leadLevel}
                      className="w-8 h-8 shrink-0"
                    />
                    <span className="text-caption font-bold flex-1 min-w-0">
                      {trophyName(r.trophy, tFallback)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-6">
            <Button
              className="w-full h-11"
              onClick={() => {
                onClose();
                onOpenTrophyCase?.();
              }}
            >
              {tFallback('league.ceremony.cta', 'Open trophy case')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
