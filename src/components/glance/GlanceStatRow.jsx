// src/components/glance/GlanceStatRow.jsx
//
// The quiet row under a focal goal: two or three figures between hairlines,
// divided by hairlines, no card. "Read-only data that is not a widget gets
// no surface" (CLAUDE.md, UI composition).
//
// A cell with nothing behind it is not passed in at all, so the row shrinks
// to the cells that have data rather than rendering a zero. Cells share the
// width equally with flex-1, which is right for a row whose count is
// decided by data: there is no partial row to leave a hole in.

import React from 'react';

const CELL = 'flex-1 min-w-0 min-h-[72px] flex flex-col gap-1 py-2.5 px-2 first:ps-0 last:pe-0 text-start border-e border-border last:border-e-0';

export default function GlanceStatRow({ cells = [], className = '' }) {
  const live = cells.filter(Boolean);
  if (live.length === 0) return null;
  return (
    <div className={`flex border-y border-border ${className}`} data-testid="glance-stat-row">
      {live.map((cell) => {
        const body = (
          <>
            <span className="kicker truncate">{cell.label}</span>
            {cell.value != null && (
              <span className="flex items-baseline gap-1 min-w-0">
                <span className="font-display tabular-nums text-title text-foreground">{cell.value}</span>
                {/* A unit is not display type: "70 G" in the condensed
                    uppercase face reads as a grade, not grams. */}
                {cell.unit && <span className="text-caption text-muted-foreground">{cell.unit}</span>}
              </span>
            )}
            {cell.visual}
            {cell.sub && <span className="text-caption text-muted-foreground truncate">{cell.sub}</span>}
          </>
        );
        return cell.onOpen ? (
          <button key={cell.id} type="button" onClick={cell.onOpen} className={`${CELL} hover:bg-secondary/40 active:bg-secondary/40 transition-colors`}>
            {body}
          </button>
        ) : (
          <div key={cell.id} className={CELL}>{body}</div>
        );
      })}
    </div>
  );
}

/** A thin meter for a stat cell: share of a target, foreground on hairline. */
export function StatMeter({ share, label }) {
  const pct = Math.round(Math.max(0, Math.min(1, Number(share) || 0)) * 100);
  return (
    <div className="h-1 rounded-full bg-border mt-1" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="h-1 rounded-full bg-foreground" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * A sparkline for a stat cell. `series` is oldest first. Drawn in --success
 * because a volume trend is a state ("building"), and flat when every point
 * is equal rather than dividing by zero.
 */
export function Sparkline({ series = [], width = 80, height = 16, label }) {
  const pts = series.map((v) => Number(v) || 0);
  if (pts.length < 2) return null;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const span = max - min || 1;
  const step = width / (pts.length - 1);
  const pad = 2;
  const points = pts
    .map((v, i) => `${(i * step).toFixed(1)},${(height - pad - ((v - min) / span) * (height - pad * 2)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block max-w-full" role="img" aria-label={label}>
      <polyline points={points} fill="none" stroke="hsl(var(--success))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
