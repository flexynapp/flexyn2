// src/components/hub/CapsuleRarityOdds.jsx
//
// Transparent display of the per-rarity drop odds for a capsule before
// the user opens it. Loot-box transparency is now expected user-facing
// behavior — China + several US states REQUIRE odds disclosure for
// monetized loot boxes. Even though Flexyn's economy is in-app coins
// (not real money), surfacing odds builds trust.
//
// Reads BASE rates from src/lib/lootCatalog.js CAPSULE_ODDS — mirroring
// the tables the server rolls against.
//
// Base rates are no longer the whole story: migration 256 added pity
// guarantees that override them. A disclosure that states odds while
// omitting a mechanic which supersedes those odds is incomplete, so the
// guarantees are listed too. Their thresholds come from the SERVER
// (get_capsule_pity), never hardcoded here — the rates already live in
// two places and a third client-side copy would drift from the roll.

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Percent } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { CAPSULE_ODDS } from '@/lib/lootCatalog';
import * as capsules from '@/lib/data/capsules';
import { RarityDot } from '@/components/loot/RarityVisuals';

export default function CapsuleRarityOdds({ capsuleType = 'standard' }) {
  const [open, setOpen] = useState(false);
  const odds = CAPSULE_ODDS[capsuleType] || CAPSULE_ODDS.standard;
  const rows = Object.entries(odds).filter(([, p]) => p > 0);

  // The rates below are BASE rates. Since migration 256 there are also
  // guarantees, and a disclosure that states the odds while omitting a
  // mechanic that overrides them is incomplete — this panel exists because
  // loot-box odds disclosure is legally required in several markets.
  // Thresholds come from the server so they cannot drift from the roll.
  const { data: pity } = useQuery({
    queryKey: ['capsulePityRules'],
    queryFn:  capsules.getPity,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="rounded-lg bg-secondary/50 border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-start hover:bg-secondary active:bg-secondary transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-wide">
          <Percent className="w-3 h-3" /> Drop rates
        </span>
        {open
          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <ul className="px-3 pb-2 space-y-1">
          {rows.map(([rarity, prob]) => {
            const pct = (prob * 100).toFixed(prob < 0.01 ? 2 : 1);
            return (
              <li key={rarity} className="flex items-center justify-between text-micro">
                <span className="flex items-center gap-1.5 capitalize">
                  <RarityDot rarity={rarity} />
                  <span>{rarity}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{pct}%</span>
              </li>
            );
          })}
          {pity && (
            <li className="pt-1.5 mt-1 border-t border-border text-micro text-muted-foreground leading-snug">
              Guaranteed <span className="font-semibold">Epic or better</span> every{' '}
              {pity.epic_at} opens, and <span className="font-semibold">Legendary or better</span>{' '}
              every {pity.legendary_at}. Legendary odds rise with every open from {pity.soft_pity_from}.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
