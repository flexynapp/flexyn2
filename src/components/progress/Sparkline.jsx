import React, { useMemo } from 'react';

/**
 * Sparkline — a hand-rolled SVG trend line for a collapsed exercise row.
 *
 * Deliberately NOT recharts. The point of the collapsed row is that it
 * shows a trend without paying for a chart: entering the Trends tab used
 * to mount one `ResponsiveContainer` + `LineChart` per exercise the user
 * had ever logged, all of them expanded, whether or not any were on
 * screen. Forty exercises meant forty recharts instances and eighty
 * ResizeObservers for a screen showing three rows. This is ~40 lines of
 * SVG and no dependency, so a long list stays cheap and the real chart
 * mounts only when a row is opened.
 *
 * `values` may contain nulls — a session where this metric has no real
 * value. The line BREAKS there rather than drawing through it, matching
 * the full chart's `connectNulls={false}`.
 *
 * Decorative by contract: the row states the current value and its delta
 * in text beside this, so nothing here is the only carrier of anything.
 * Hence `aria-hidden`.
 */
export default function Sparkline({ values = [], width = 56, height = 20, className = '' }) {
  const { segments, last } = useMemo(() => {
    const real = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (real.length < 2) return { segments: [], last: null };

    const min = Math.min(...real);
    const max = Math.max(...real);
    const span = max - min;

    // 1.5px of inset top and bottom so the stroke never clips on a flat
    // series or at an extreme.
    const pad = 1.5;
    const usable = height - pad * 2;
    const x = (i) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * width);
    const y = (v) => (span === 0 ? height / 2 : pad + (1 - (v - min) / span) * usable);

    // Split into runs of consecutive non-null values; each run is its
    // own polyline, so a gap in the data reads as a gap in the line.
    const runs = [];
    let run = [];
    values.forEach((v, i) => {
      if (typeof v === 'number' && Number.isFinite(v)) {
        run.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      } else if (run.length) {
        runs.push(run);
        run = [];
      }
    });
    if (run.length) runs.push(run);

    const lastIdx = values.reduce((acc, v, i) => (typeof v === 'number' && Number.isFinite(v) ? i : acc), -1);

    return {
      segments: runs.filter((r) => r.length > 1).map((r) => r.join(' ')),
      last: lastIdx >= 0 ? { cx: x(lastIdx), cy: y(values[lastIdx]) } : null,
    };
  }, [values, width, height]);

  if (!segments.length) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`shrink-0 overflow-visible ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {segments.map((pts, i) => (
        <polyline
          key={i}
          points={pts}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {last && <circle cx={last.cx} cy={last.cy} r="2" fill="currentColor" />}
    </svg>
  );
}
