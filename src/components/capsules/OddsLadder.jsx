// src/components/capsules/OddsLadder.jsx
//
// What a capsule can drop, as one list: rarest at the top, each rarity
// wearing a real sticker from the set, its published chance per open and how
// much of that rarity the user owns. The epic pity rule is drawn as a line
// through the list, under the epic row, because everything above that line
// is what the guarantee covers.
//
// It replaced three stacked strips (a rainbow odds bar with a dot legend, the
// set bar and a line of pity text). The exact percentages stay on screen:
// they are the published odds, and paid loot has to show them.
//
// The pity numbers come from get_capsule_pity, the same read PityMeter makes,
// never from a client constant. No reading, no line.

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as capsules from '@/lib/data/capsules';
import { oddsSegments, rarityFace } from '@/lib/capsuleShelf';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { pityReading } from './PityMeter';
import { rarityName } from './words';
import Sticker from './Sticker';

// Rarities the pity guarantee covers: epic or better.
const PITY_COVERS = new Set(['epic', 'legendary', 'mythic', 'animated']);

/** A small progress ring: how much of one rarity the user owns. */
export function OwnRing({ value, max, size = 16, stroke = 2.5, color }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = max ? Math.min(1, value / max) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90 shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={stroke} />
      {share > 0 && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * share} ${c}`}
        />
      )}
    </svg>
  );
}

/**
 * @param {string} tier        capsule tier whose odds to list
 * @param {Array}  [tiers]     setTiers() rows; without them the Yours column is left out
 * @param {Set}    [owned]     owned item ids, for each row's sticker face
 * @param {(n:number)=>string} fmtPct  formats 6.5 as the locale's "6.5%"
 */
export default function OddsLadder({ tier, tiers = null, owned = null, fmtPct }) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const { data: pity } = useQuery({
    queryKey: ['capsulePity', user?.email],
    queryFn: capsules.getPity,
    enabled: !!user?.email,
    staleTime: 30_000,
  });
  const reading = pityReading(pity);
  const rows = [...oddsSegments(tier)].reverse();
  // The line sits under the last row the guarantee covers.
  const lastCovered = rows.reduce((at, r, i) => (PITY_COVERS.has(r.rarity) ? i : at), -1);
  const showYours = Array.isArray(tiers);

  return (
    <div className="flex flex-col" data-testid="odds-ladder">
      <div className="flex items-baseline gap-3 pb-1 text-caption text-muted-foreground">
        <span className="flex-1 text-label font-semibold text-foreground">
          {tFallback('capsuleRarityOdds.dropRates', 'Drop rates')}
        </span>
        <span className="w-16 text-end">{tFallback('capsules.perOpen', 'per open')}</span>
        {showYours && <span className="w-14 text-end">{tFallback('capsules.odds.yours', 'Yours')}</span>}
      </div>
      <ul className="flex flex-col">
        {rows.map((s, i) => {
          const face = rarityFace(s.rarity, owned);
          const mine = showYours ? tiers.find(t => t.rarity === s.rarity) : null;
          const color = rarityTint(s.rarity).color;
          return (
            <li key={s.rarity} className="contents">
              <div className="flex items-center gap-3 h-11" data-rarity={s.rarity}>
                {face
                  ? <Sticker itemId={face.id} emoji={face.emoji} rarity={s.rarity} size={28} dim={!face.owned} />
                  : <span className="w-7 h-7 shrink-0" aria-hidden="true" />}
                <span className="flex-1 min-w-0 truncate text-label font-semibold" style={{ color }}>
                  {rarityName(tFallback, s.rarity)}
                </span>
                <span className="w-16 text-end tabular-nums text-label font-semibold">{fmtPct(s.pct)}</span>
                {showYours && (
                  <span className="w-14 flex items-center justify-end gap-1.5 tabular-nums text-caption text-muted-foreground">
                    {mine && mine.total > 0 && (
                      <>
                        {`${mine.owned}/${mine.total}`}
                        <OwnRing value={mine.owned} max={mine.total} color={color} />
                      </>
                    )}
                  </span>
                )}
              </div>
              {i === lastCovered && reading && (
                <div className="flex items-center gap-2 h-8" data-testid="pity-line">
                  <span className="flex-1 border-t border-dashed border-muted-foreground/50" aria-hidden="true" />
                  <span className="text-caption font-semibold tabular-nums">
                    {reading.left <= 1
                      ? tFallback('capsules.pity.next', 'Epic or better on the next open')
                      : tFallback('capsules.pity.sureWithin', 'Sure within {n} opens', { n: reading.left })}
                  </span>
                  <span
                    className="w-12 h-1 rounded-full bg-border overflow-hidden"
                    role="img"
                    aria-label={tFallback('capsules.pity.count', '{since} of {at}', { since: reading.since, at: reading.at })}
                  >
                    <span className="block h-full bg-foreground" style={{ width: `${(reading.since / reading.at) * 100}%` }} />
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
