// src/components/hub/CapsuleRarityOdds.jsx
//
// Transparent display of the per-rarity drop odds for a capsule before
// the user opens it. Loot-box transparency is now expected user-facing
// behavior — China + several US states REQUIRE odds disclosure for
// monetized loot boxes. Even though Flexyn's economy is in-app coins
// (not real money), surfacing odds builds trust.
//
// Reads from src/lib/lootCatalog.js CAPSULE_ODDS — same map the server
// rolls against. Updates here propagate everywhere automatically.

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Percent } from 'lucide-react';
import { CAPSULE_ODDS } from '@/lib/lootCatalog';
import { RarityDot } from '@/components/loot/RarityVisuals';

export default function CapsuleRarityOdds({ capsuleType = 'standard' }) {
  const [open, setOpen] = useState(false);
  const odds = CAPSULE_ODDS[capsuleType] || CAPSULE_ODDS.standard;
  const rows = Object.entries(odds).filter(([, p]) => p > 0);

  return (
    <div className="rounded-lg bg-secondary/50 border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-start hover:bg-secondary transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide">
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
              <li key={rarity} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 capitalize">
                  <RarityDot rarity={rarity} />
                  <span>{rarity}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{pct}%</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
