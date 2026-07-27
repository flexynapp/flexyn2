// src/components/crews/CrewLeaguePanel.jsx
//
// Seasonal division standings for one crew (migration 248).
//
// Deliberately built to the rules in docs/profile-ui-premium-research.md,
// because the same failure mode was about to repeat here:
//
//   * no bordered, filled, rounded container per row — separation is a
//     hairline and whitespace, so the table reads as one object rather
//     than a stack of cards
//   * metrics are text taking their hierarchy from weight and colour,
//     never from a tile with an icon above it
//   * four type sizes total (text-xs / text-sm / text-base / text-xl),
//     none of the 7-11px micro-labels the research flagged as below the
//     legibility floor on a phone
//   * counts go through useNumberFormatter, so 2,604 renders per locale
//     rather than as a raw integer
//
// Self-hides when there's nothing true to say: no season open, the crew
// isn't seated in a division, or migration 248 hasn't been applied on this
// host yet. An empty standings table is worse than no standings table.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { getDivisionStandings, zoneForRow, placingFor } from '@/lib/data/crewSeasons';

const ORDINAL_RULES = { one: 'st', two: 'nd', few: 'rd', other: 'th' };

/** 1 -> 1st, 2 -> 2nd, 11 -> 11th. English-only; other locales get the bare number. */
function ordinal(n, language) {
  if (!Number.isFinite(n)) return null;
  if (language && !String(language).startsWith('en')) return String(n);
  try {
    const pr = new Intl.PluralRules('en-US', { type: 'ordinal' });
    return `${n}${ORDINAL_RULES[pr.select(n)] ?? 'th'}`;
  } catch {
    return String(n);
  }
}

function ZoneLabel({ kind, division, tFallback }) {
  const promotion = kind === 'promotion';
  return (
    <p
      className="text-xs font-semibold pt-3 pb-1.5"
      style={{ color: promotion ? 'hsl(142 62% 40%)' : 'hsl(4 68% 52%)' }}
    >
      {promotion
        ? tFallback('league.promotion', `Promotion to Division ${Math.max(1, division - 1)}`)
        : tFallback('league.relegation', `Relegation to Division ${division + 1}`)}
    </p>
  );
}

function StandingRow({ row, index, mine, fmt }) {
  return (
    <div
      className={`flex items-center gap-3 py-2.5 border-b border-border/60 ${
        mine ? 'bg-primary/[0.07] -mx-2 px-2 rounded-lg border-b-transparent' : ''
      }`}
    >
      <span className="text-sm text-muted-foreground w-5 shrink-0 tabular-nums">
        {index + 1}
      </span>
      <span
        className={`flex-1 min-w-0 truncate text-sm ${mine ? 'font-bold text-foreground' : 'text-foreground'}`}
      >
        {row.name}
      </span>
      <span className="text-sm text-muted-foreground shrink-0 tabular-nums">
        {fmt(row.won || 0)}W
      </span>
      <span
        className={`text-sm font-bold shrink-0 tabular-nums ${mine ? 'text-primary' : 'text-foreground'}`}
      >
        {fmt(row.points || 0)}
      </span>
    </div>
  );
}

export default function CrewLeaguePanel({ crewId, crewName }) {
  const { tFallback, language } = useLanguage();
  const fmt = useNumberFormatter();

  const { data: standings, isLoading } = useQuery({
    queryKey: ['crewStandings', crewId],
    queryFn:  () => getDivisionStandings(crewId),
    enabled:  !!crewId,
    staleTime: 60_000,
  });

  // Nothing true to say yet — render nothing rather than an empty table.
  if (isLoading || !standings || standings.rows.length === 0) return null;

  const { division, rows, seasonNumber, endsAt } = standings;
  const placing = placingFor(standings, crewId);

  let endsIn = null;
  try {
    if (endsAt) endsIn = formatDistanceToNow(new Date(endsAt), { addSuffix: true });
  } catch { endsIn = null; }

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="mb-6"
      aria-label={tFallback('league.aria', 'Crew league standings')}
    >
      {/* Identity block — one region, no internal borders. */}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading font-bold text-base">
          {tFallback('league.division', `Division ${division}`)}
        </h3>
        {placing && (
          <span className="text-base font-bold text-primary tabular-nums">
            {ordinal(placing, language)}
            <span className="text-sm font-normal text-muted-foreground">
              {' '}{tFallback('league.of', 'of')} {fmt(rows.length)}
            </span>
          </span>
        )}
      </div>

      {/* Metrics as text — weight and colour only, no tiles. */}
      <p className="text-sm text-muted-foreground mt-0.5">
        {seasonNumber != null && (
          <>{tFallback('league.season', 'Season')} {fmt(seasonNumber)}</>
        )}
        {endsIn && (
          <> · {tFallback('league.ends', 'ends')} {endsIn}</>
        )}
      </p>

      <div className="mt-3">
        {rows.map((row, i) => {
          const zone     = zoneForRow(i, rows.length, division);
          const prevZone = i === 0 ? null : zoneForRow(i - 1, rows.length, division);
          const mine     = row.crew_id === crewId;

          return (
            <React.Fragment key={row.crew_id}>
              {zone && zone !== prevZone && (
                <ZoneLabel kind={zone} division={division} tFallback={tFallback} />
              )}
              <StandingRow row={row} index={i} mine={mine} fmt={fmt} />
            </React.Fragment>
          );
        })}
      </div>

      {rows.length === 1 && (
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
          {tFallback(
            'league.lonely',
            `${crewName || 'Your crew'} is the only crew in this division so far. Win a war to start banking points.`,
          )}
        </p>
      )}
    </motion.section>
  );
}
