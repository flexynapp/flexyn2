// src/components/crews/CrewTopBoard.jsx
//
// The Top tab — every public crew ranked against every other one.
//
// Distinct from CrewLeaguePanel, which shows ONE crew's division table. This
// is the global ladder; that is the local one. They must not look alike, so
// this carries a rank column and a metric switch and no promotion zones.
//
// Built to the rules in docs/crews-hub-prompt.md:
//
//   * rank comes from the server and is rendered, never derived from the array
//     index — the rows are top-N plus a window around your own crew, so the
//     indices are deliberately non-contiguous and the gap is where the
//     ellipsis goes
//   * hairline rows, no card per row: this is one table, not a stack of
//     objects (same treatment as CrewLeaguePanel's StandingRow)
//   * four type sizes, counts abbreviated through useNumberFormatter
//   * a crew on a zero metric is shown, not filtered — at time of writing
//     every crew scores zero on every metric, and an empty board would be
//     less true than an honest one

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Shield, Trophy, Loader2 } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { getTopCrews } from '@/lib/data/crewDirectory';

const METRICS = [
  { key: 'volume',   label: 'Volume' },
  { key: 'trophies', label: 'Trophies' },
  { key: 'points',   label: 'Points' },
];

/** Unit that follows the value, per metric. Volume is the product's headline. */
const UNIT = {
  volume:   ['crew.top.unit.volume',   'lbs'],
  trophies: ['crew.top.unit.trophies', 'trophies'],
  points:   ['crew.top.unit.points',   'pts'],
};

/** What "nobody has any yet" says, per metric. */
const ZERO_COPY = {
  volume:   ['crew.top.zero.volume',   'No crew has logged any volume yet. Ranked by size until one does.'],
  trophies: ['crew.top.zero.trophies', 'No crew has won a war yet. Ranked by size until one does.'],
  points:   ['crew.top.zero.points',   'No crew has scored this season yet. Ranked by size until one does.'],
};

function BoardRow({ row, metric, fmt, tFallback }) {
  const mine  = !!row.is_member;
  const value = Number(row.value ?? 0);

  return (
    <div
      className={`flex items-center gap-2 py-2.5 border-b border-border/60 ${
        mine ? 'bg-primary/[0.07] -mx-2 px-2 rounded-lg border-b-transparent' : ''
      }`}
    >
      <span className="text-sm text-muted-foreground w-7 shrink-0 tabular-nums">
        {row.rank}
      </span>

      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
        style={{ background: 'hsl(var(--primary) / 0.15)' }}
      >
        {row.avatar_url
          ? <img loading="lazy" src={row.avatar_url} alt="" className="w-full h-full object-cover" draggable={false} />
          : <Shield className="w-4 h-4" style={{ color: 'hsl(var(--primary))' }} />}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${mine ? 'font-bold text-foreground' : 'text-foreground'}`}>
          {row.name}
        </p>
        {/* A number gets screen space only with something to compare against.
            Size is the comparison that is always true, even at zero. */}
        <p className="text-xs text-muted-foreground truncate">
          {row.tag ? <>#{row.tag} · </> : null}
          <span className="tabular-nums">{fmt(row.member_count ?? 0)}</span>
          {' '}{tFallback('crew.top.members', 'members')}
        </p>
      </div>

      <span className={`text-sm font-bold shrink-0 tabular-nums ${mine ? 'text-primary' : 'text-foreground'}`}>
        {value === 0
          ? '—'
          : <>{fmt(value, { notation: 'compact', maximumFractionDigits: 1 })}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                {tFallback(...UNIT[metric])}
              </span>
            </>}
      </span>
    </div>
  );
}

export default function CrewTopBoard() {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const [metric, setMetric] = useState('volume');

  const { data: board, isLoading } = useQuery({
    queryKey: ['crewTopBoard', metric],
    queryFn:  () => getTopCrews({ metric, limit: 25 }),
    staleTime: 60_000,
  });

  const rows = board?.rows ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allZero = rows.length > 0 && rows.every(r => Number(r.value ?? 0) === 0);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="pt-2 lg:pb-6"
      aria-label={tFallback('crew.top.aria', 'Top crews')}
    >
      {/* Metric switch — one row, three short labels. */}
      <div className="flex gap-1 p-1 bg-secondary rounded-xl mb-2">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
              metric === m.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground active:text-foreground'
            }`}
            aria-pressed={metric === m.key}
          >
            {tFallback(`crew.top.metric.${m.key}`, m.label)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
          <div
            className="w-16 h-16 rounded-3xl flex items-center justify-center mb-2"
            style={{ background: 'hsl(var(--primary) / 0.1)' }}
          >
            <Trophy className="w-8 h-8" style={{ color: 'hsl(var(--primary))' }} />
          </div>
          <p className="font-heading font-bold text-base mb-2">
            {tFallback('crew.top.emptyTitle', 'No crews on the board yet')}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {tFallback(
              'crew.top.emptyBody',
              'Only crews that make themselves public are ranked here. Make yours public from the Crew page and it lands on the board.',
            )}
          </p>
        </div>
      ) : (
        <>
          {/* Said plainly rather than rendering a table of proud zeros. */}
          {allZero && (
            <p className="text-sm text-muted-foreground leading-relaxed mb-2">
              {tFallback(...ZERO_COPY[metric])}
            </p>
          )}

          <div>
            {rows.map((row, i) => {
              const prev = i === 0 ? null : rows[i - 1];
              // Non-contiguous ranks are the point: the server sends the top N
              // and a window around your crew, and the gap between them is
              // where the rest of the ladder is.
              const gap = prev && Number(row.rank) - Number(prev.rank) > 1;
              return (
                <React.Fragment key={row.id}>
                  {gap && (
                    <p className="text-sm text-muted-foreground py-2 ps-7" aria-hidden="true">
                      ···
                    </p>
                  )}
                  <BoardRow row={row} metric={metric} fmt={fmt} tFallback={tFallback} />
                </React.Fragment>
              );
            })}
          </div>

          <p className="text-sm text-muted-foreground mt-2">
            {board?.myRank
              ? <>
                  {tFallback('crew.top.yourCrew', 'Your crew is')}{' '}
                  <b className="text-foreground font-bold tabular-nums">#{fmt(board.myRank)}</b>
                  {' '}{tFallback('crew.top.of', 'of')}{' '}
                  <span className="tabular-nums">{fmt(board.total)}</span>
                </>
              : tFallback('crew.top.joinToRank', 'Join a public crew to take a place on the board.')}
          </p>
        </>
      )}
    </motion.section>
  );
}
