// src/components/hub/CapsuleStreak.jsx
//
// Where you stand against the pity guarantees.
//
// This panel used to be pure trivia — "47 opens since your last Epic+" —
// with a disclaimer underneath explaining that the number meant nothing
// because every roll was independent. That disclaimer was load-bearing
// and slightly grim: it existed to stop a counter next to a drop-rate
// table reading as "I'm due".
//
// Migration 256 made it true. There are now real guarantees, so the
// counter is a progress bar toward something and the disclaimer is gone.
//
// THRESHOLDS ARE NOT HARDCODED HERE. get_capsule_pity() returns both the
// counters and the rules, so the UI cannot promise a guarantee the server
// doesn't honour. The rates already live in two places (lootCatalog.js for
// display, the SQL for the roll); a third copy in the client would drift,
// and this panel sits directly under a legally-required odds disclosure.

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import * as capsules from '@/lib/data/capsules';
import { computePity } from '@/lib/pity';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { useLanguage } from '@/lib/LanguageContext';

function PityBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const remaining = Math.max(0, max - value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <span className="text-micro text-muted-foreground">{label}</span>
        {/* The bar already shows how close you are. The exact count used to
            be spelled out here ("12 to go"), which publishes the pity
            threshold to the user — progress without the number. */}
        <span className="text-micro font-bold" style={{ color }}>
          {remaining === 0 ? 'next one guaranteed' : 'getting closer'}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function CapsuleStreak() {
  const { tFallback } = useLanguage();
  const { user } = useAuth();

  const { data: pity } = useQuery({
    queryKey: ['capsulePity', user?.email],
    queryFn:  capsules.getPity,
    enabled:  !!user?.email,
    staleTime: 30_000,
  });

  // History is still the source for "best pull ever" — the server tracks
  // streaks, not personal bests.
  const { data: history = [] } = useQuery({
    queryKey: ['capsuleOpenHistory', user?.email],
    queryFn:  () => capsules.listOpenHistory(user.email),
    enabled:  !!user?.email,
    staleTime: 60_000,
  });
  const best = computePity(history);

  // Pre-256 host, or nothing opened yet — stay out of the way.
  if (!pity) return null;
  if (!best.hasHistory && (pity.since_epic ?? 0) === 0) return null;

  const epicTint = rarityTint('epic');
  const legTint  = rarityTint('legendary');
  const bestTint = best.bestRarity ? rarityTint(best.bestRarity) : null;

  return (
    <div className="rounded-lg bg-secondary/50 border border-border px-3 py-2 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <History className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
        <span className="text-micro font-bold uppercase tracking-wide">{tFallback("capsuleStreak.yourProgress", "Your progress")}</span>
      </div>

      <PityBar
        label={`Epic or better · ${pity.since_epic}/${pity.epic_at}`}
        value={pity.since_epic}
        max={pity.epic_at}
        color={epicTint.color}
      />
      <PityBar
        label={`Legendary or better · ${pity.since_legendary}/${pity.legendary_at}`}
        value={pity.since_legendary}
        max={pity.legendary_at}
        color={legTint.color}
      />

      {pity.since_legendary >= (pity.soft_pity_from ?? Infinity) && (
        <p className="text-micro font-semibold" style={{ color: legTint.color }}>
          {tFallback('capsuleStreak.oddsClimbing', 'Legendary odds are climbing with every open from here.')}
        </p>
      )}

      {bestTint && (
        <p className="text-micro text-muted-foreground">
          Best pull:{' '}
          <span className="font-bold" style={{ color: bestTint.color }}>{bestTint.label}</span>
          {best.opens > 0 && <> · {best.opens} opened</>}
        </p>
      )}
    </div>
  );
}
