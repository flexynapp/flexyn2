// src/components/competition/RulesSheet.jsx
//
// The "i" button and the short ruleset behind it for Duels and Crew Wars.
// A new ruleset is one more entry in RULESETS (Rival is meant to join).
// Each is four or five plain lines a new user can read in ten seconds, not
// the full system: LeagueInfoSheet is the long-form explainer and these
// deliberately are not.
//
// Every line states what the SERVER does, so when a rule changes the copy
// here changes with it:
//   duels     — scored by the trigger on workout_logs (20260927180000)
//   crewWars  — recompute_crew_war: top N lifters per side, N the smaller
//               roster; starting a war is leader only (mig 358)
//
// It can open over full-screen surfaces (the Rival menu sits at z-[9999]),
// so the dialog and its overlay are raised above them.

import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/lib/LanguageContext';
import { haptic } from '@/lib/haptic';

const RULESETS = {
  duels: {
    title: 'How duels work',
    intro: 'Challenge someone to a workout battle. Your workouts score themselves, so all you do is train.',
    rules: [
      ['start', 'Pick a type', 'A Session Duel starts right away: beat their last workout before time runs out. An Open or Mirror Duel starts when they accept.'],
      ['train', 'Just train', 'Your best workout inside the time window counts automatically. There is nothing to submit.'],
      ['win', 'How you win', 'Open: lift the most total weight. Mirror and Session: finish every set of the same workout and lift more in total.'],
      ['end', 'When time runs out', 'The better score wins. In an Open or Mirror Duel, if only one of you trained, they win. If nobody trained, the duel expires.'],
    ],
  },
  crewWars: {
    title: 'How crew wars work',
    intro: 'Your crew takes on another crew of a similar size and strength for seven days.',
    rules: [
      ['start', 'The leader starts it', 'Only the crew leader can enter a war. You are matched with a crew close to yours.'],
      ['train', 'Everyone trains', 'Every workout your members log that week earns points for weight lifted, sessions and days trained.'],
      ['fair', 'Fair on size', 'Both crews count the same number of lifters. A bigger crew only counts its best members, so a small crew can still win.'],
      ['win', 'Most points wins', 'When the week ends, the crew with more points wins the war.'],
    ],
  },
};

export default function RulesSheet({ ruleset, open, onClose }) {
  const { tFallback } = useLanguage();
  const set = RULESETS[ruleset];
  if (!set || !open) return null;
  const k = (s) => `rules.${ruleset}.${s}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="z-[10001] max-w-sm max-h-[88vh] overflow-y-auto p-0 gap-0"
        overlayClassName="z-[10000]"
        closeClassName="focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        <div className="px-5 py-6">
          <DialogHeader className="space-y-0 text-start">
            <DialogTitle className="font-heading font-bold text-xl pe-8">
              {tFallback(k('title'), set.title)}
            </DialogTitle>
          </DialogHeader>
          <p className="text-caption text-muted-foreground pt-2">
            {tFallback(k('intro'), set.intro)}
          </p>
          <ol className="pt-6 flex flex-col gap-6">
            {set.rules.map(([id, title, body], i) => (
              <li key={id} className="flex gap-2">
                <span className="w-6 h-6 rounded-full bg-secondary text-micro font-bold tabular-nums flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-caption font-bold">{tFallback(k(`${id}.title`), title)}</p>
                  <p className="text-caption text-muted-foreground pt-1">{tFallback(k(`${id}.body`), body)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The "i" button. Owns its own open state so a caller adds one element.
export function RulesButton({ ruleset, className = '' }) {
  const { tFallback } = useLanguage();
  const [open, setOpen] = useState(false);
  const set = RULESETS[ruleset];
  if (!set) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => { haptic('subtle'); setOpen(true); }}
        aria-label={tFallback(`rules.${ruleset}.title`, set.title)}
        className={`w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors shrink-0 ${className}`}
      >
        <Info className="w-5 h-5" />
      </button>
      <RulesSheet ruleset={ruleset} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Exported for the catalog test: every line must have a key in en/es/fr.
export const RULE_KEYS = Object.fromEntries(
  Object.entries(RULESETS).flatMap(([id, set]) => [
    [`rules.${id}.title`, set.title],
    [`rules.${id}.intro`, set.intro],
    ...set.rules.flatMap(([r, t, b]) => [[`rules.${id}.${r}.title`, t], [`rules.${id}.${r}.body`, b]]),
  ]),
);
