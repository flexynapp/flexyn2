// src/components/hub/profile/ProfileTrophies.jsx
//
// The trophy case and the earned trophies on one screen.
//
// These were always the same mental model — "what has this athlete got" —
// but shipped as two separate bordered cards with two separate headers, one
// above the other. The case is the curated five; the grid is the earned
// twenty-four. Together they read as one collection.
//
// Two changes beyond the merge:
//   • The 7px uppercase tier label under every earned trophy is gone. 7px is
//     below the legibility floor on a phone, and it was repeating information
//     the trophy's own colour already carries. It's now a 2px tier stripe.
//   • Locked slots render. A collection you can see the shape of is one you
//     want to complete; "8/24" with fifteen empty frames says something that
//     "8/24" alone doesn't.
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { TROPHIES, TROPHY_TIERS, getTrophy } from '@/lib/trophyDefinitions';

function SectionLabel({ children, aside }) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
      {aside && <span className="text-xs text-muted-foreground tabular-nums">{aside}</span>}
    </div>
  );
}

export default function ProfileTrophies({
  isSelf,
  trophyCase,
  trophyVisible,
  earnedTrophies,
  onPickSlot,
  trophyLabels,
  tFallback,
}) {
  const earnedIds = new Set(earnedTrophies.map((row) => row.trophy_id));
  const lockedCount = Math.max(0, TROPHIES.length - earnedIds.size);
  const showCase = isSelf || (trophyVisible && trophyCase.some((slot) => slot?.value));

  return (
    <div className="space-y-6">
      {showCase && (
        <section>
          <SectionLabel aside={isSelf ? tFallback('hub.profile.tapToSwap', 'Tap to swap') : null}>
            {tFallback('hub.profile.trophyCase', 'Trophy case')}
          </SectionLabel>
          <div className="flex gap-2">
            {Array(5).fill(null).map((_, i) => {
              const slot = trophyCase[i] ?? null;
              const label = slot ? (trophyLabels[slot.value] || slot.value) : null;
              return (
                <motion.button
                  key={i}
                  type="button"
                  onClick={isSelf ? () => onPickSlot(i) : undefined}
                  whileTap={isSelf ? { scale: 0.9 } : undefined}
                  disabled={!isSelf}
                  aria-label={slot
                    ? `${tFallback('hub.profile.slot', 'Slot')} ${i + 1}: ${label}`
                    : `${tFallback('hub.profile.emptySlot', 'Empty slot')} ${i + 1}`}
                  className={`flex-1 aspect-square rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${
                    slot
                      ? 'bg-secondary/40'
                      : isSelf
                        ? 'border border-dashed border-primary/45 hover:bg-secondary/40'
                        : 'bg-secondary/20'
                  } ${isSelf ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  {slot ? (
                    <>
                      <span className="text-2xl leading-none">{slot.value}</span>
                      <span className="text-xs text-muted-foreground leading-tight text-center truncate w-full px-1">
                        {label}
                      </span>
                    </>
                  ) : isSelf ? (
                    <Plus className="w-4 h-4 text-primary/50" />
                  ) : (
                    <span className="text-muted-foreground/25 text-sm">—</span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <SectionLabel aside={`${earnedIds.size} / ${TROPHIES.length}`}>
          {tFallback('hub.profile.earnedTrophies', 'Earned')}
        </SectionLabel>

        {earnedIds.size === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-4 text-center">
            <p className="text-sm text-muted-foreground">
              {isSelf
                ? tFallback('hub.profile.noTrophiesSelf', 'Log your first workout to earn your first trophy.')
                : tFallback('hub.profile.noTrophies', 'No trophies earned yet.')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            {earnedTrophies.map((row) => {
              const trophy = getTrophy(row.trophy_id);
              if (!trophy) return null;
              const tierMeta = TROPHY_TIERS[trophy.tier] || TROPHY_TIERS.bronze;
              return (
                <div
                  key={row.trophy_id}
                  title={`${trophy.name} — ${trophy.description}`}
                  className="relative aspect-square rounded-xl bg-secondary/40 flex items-center justify-center overflow-hidden"
                >
                  <span className="text-2xl leading-none" aria-hidden="true">{trophy.emoji}</span>
                  <span className="sr-only">{`${trophy.name} (${tierMeta.label})`}</span>
                  {/* Tier as a stripe, not a 7px caption. */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0"
                    style={{ height: 2, background: tierMeta.color }}
                  />
                </div>
              );
            })}
            {/* Locked frames — the shape of what's left to collect. */}
            {Array(lockedCount).fill(null).map((_, i) => (
              <div
                key={`locked-${i}`}
                aria-hidden="true"
                className="aspect-square rounded-xl bg-secondary/20 flex items-center justify-center"
              >
                <span className="text-base opacity-25">🔒</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
