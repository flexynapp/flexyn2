// src/pages/CapsuleOpenPreview.jsx
//
// A test bench for the capsule open, so the crack can be tried with a thumb
// on a real phone. Tapping is the whole point of it, and a recording cannot
// show what a tap feels like.
//
// Only reachable on a Netlify deploy preview or localhost (see App.jsx);
// production never routes here. It renders the real CapsuleOpener with a
// stand-in roll, so nothing is spent, granted or written.

import { useState } from 'react';
import CapsuleOpener from '@/components/hub/CapsuleOpener';
import { ITEMS } from '@/lib/lootCatalog';
import { rarityTint } from '@/components/loot/RarityVisuals';

// Labels here are for the bench only and never ship to a user, so they are
// plain English rather than catalog keys.
const LABEL = { capsule: 'Capsule', one: 'Open one', random: 'Random, real odds', four: 'Open 4 (first is epic)' };
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'animated'];
const TIERS = ['standard', 'premium', 'elite'];

function itemFor(rarity) {
  const pool = ITEMS.filter(i => i.rarity === rarity && i.type === 'sticker');
  const any = pool.length ? pool : ITEMS.filter(i => i.rarity === rarity);
  return any[Math.floor(Math.random() * any.length)] ?? ITEMS[0];
}

function fakeRoll(rarityFor) {
  let n = 0;
  return async () => {
    await new Promise(r => setTimeout(r, 300));
    const it = itemFor(rarityFor(n++));
    return { granted: true, item: { ...it, category: 'sticker' } };
  };
}

export default function CapsuleOpenPreview() {
  const [tier, setTier] = useState('standard');
  const [run, setRun] = useState(null);

  const start = (rarity, count = 1) => {
    // Random follows the standard capsule's real odds, so a run of opens
    // feels like a run of opens.
    const odds = () => {
      const x = Math.random();
      return x < 0.6 ? 'common' : x < 0.88 ? 'uncommon' : x < 0.98 ? 'rare' : x < 0.998 ? 'epic' : 'legendary';
    };
    const pickFor = rarity === 'random' ? odds : (i) => (count > 1 && i > 0 ? odds() : rarity);
    setRun({
      key: Date.now(),
      rows: Array.from({ length: count }, (_, i) => ({ id: `bench-${i}`, capsule_type: tier })),
      roll: fakeRoll(pickFor),
    });
  };

  const chip = (on) => `h-11 px-4 rounded-full text-label font-semibold border ${on ? 'bg-foreground text-background border-foreground' : 'text-foreground'}`;

  return (
    <div className="dark min-h-screen bg-background text-foreground px-4 py-6 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">{LABEL.capsule}</span>
        <div className="flex flex-wrap gap-2">
          {TIERS.map(k => (
            <button key={k} type="button" className={chip(tier === k)} onClick={() => setTier(k)}>{k}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="eyebrow">{LABEL.one}</span>
        <button type="button" className="h-12 rounded-full bg-primary text-primary-foreground font-semibold" onClick={() => start('random')}>
          {LABEL.random}
        </button>
        <div className="grid grid-cols-3 gap-2">
          {RARITIES.map(r => (
            <button
              key={r}
              type="button"
              className="h-12 rounded-lg border text-label font-semibold"
              style={{ color: rarityTint(r).color }}
              onClick={() => start(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <button type="button" className="h-12 rounded-full border font-semibold" onClick={() => start('epic', 4)}>
          {LABEL.four}
        </button>
      </div>
      {run && (
        <CapsuleOpener
          key={run.key}
          rows={run.rows}
          next={null}
          rollCapsule={run.roll}
          loadInventory={async () => []}
          onClaim={async () => setRun(null)}
          onClose={() => setRun(null)}
        />
      )}
    </div>
  );
}
