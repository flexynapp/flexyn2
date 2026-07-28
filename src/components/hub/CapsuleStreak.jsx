// src/components/hub/CapsuleStreak.jsx
//
// "47 opens since your last Epic+" — the number every gacha tracker puts
// front and centre and Flexyn never showed. The odds panel right above
// this tells you a Standard capsule is 2% Epic-or-better; this tells you
// where you actually stand against that.
//
// READ THE WARNING IN src/lib/pity.js BEFORE CHANGING THE COPY. Flexyn has
// no pity mechanic — rolls are independent, server-side, every time. A
// streak counter sitting next to drop rates can very easily be read as
// "I'm due", so the disclaimer below is load-bearing, not decoration.

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import * as capsules from '@/lib/data/capsules';
import { computePity } from '@/lib/pity';
import { rarityTint } from '@/components/loot/RarityVisuals';

export default function CapsuleStreak() {
  const { user } = useAuth();

  const { data: history = [] } = useQuery({
    queryKey: ['capsuleOpenHistory', user?.email],
    queryFn:  () => capsules.listOpenHistory(user.email),
    enabled:  !!user?.email,
    staleTime: 60_000,
  });

  const pity = computePity(history);

  // Nothing opened yet — a "0 opens since" line would be noise on the very
  // first capsule, which is exactly when the screen should stay clean.
  if (!pity.hasHistory) return null;

  const bestTint = pity.bestRarity ? rarityTint(pity.bestRarity) : null;

  return (
    <div className="rounded-lg bg-secondary/50 border border-border px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <History className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] font-bold uppercase tracking-wide">Your history</span>
      </div>

      <div className="flex items-baseline gap-1.5 flex-wrap">
        {pity.sinceGood === null ? (
          <span className="text-[11px] text-muted-foreground">
            <span className="font-bold text-foreground tabular-nums">{pity.opens}</span> opened ·
            {' '}no Epic or better yet
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            <span className="font-bold text-foreground tabular-nums">{pity.sinceGood}</span>
            {' '}since your last Epic+ · {pity.opens} opened
          </span>
        )}
      </div>

      {bestTint && (
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Best pull:{' '}
          <span className="font-bold" style={{ color: bestTint.color }}>{bestTint.label}</span>
        </p>
      )}

      {/* Load-bearing. See the header comment. */}
      <p className="text-[10px] text-muted-foreground/70 mt-1 leading-snug">
        Every roll is independent — a long streak doesn&apos;t improve your next odds.
      </p>
    </div>
  );
}
