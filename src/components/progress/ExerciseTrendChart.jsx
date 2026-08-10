import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useLanguage } from '@/lib/LanguageContext';
import { useDateFormatter, useNumberFormatter } from '@/lib/intl';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { seriesFor, valueDomain, axisTicks, tickTimes, METRIC_IS_WEIGHT } from '@/lib/exerciseTrend';

/**
 * ExerciseTrendChart — ONE series, ONE axis.
 *
 * The card this replaces drew max weight against a left axis and max
 * reps against a right one. Two y-scales is the first anti-pattern the
 * dataviz reference lists, and for good reason: with two independent
 * domains the crossings, the gaps and the relative slopes are all
 * artefacts of where the two scales happened to land, so the picture
 * changes meaning when either series' range changes. The metric switch
 * above this chart replaced that — you compare one thing at a time.
 *
 * A single series also means no legend: the switch names the metric, so
 * a legend box would restate it while eating a tenth of a 200px plot on
 * a phone.
 *
 * The x axis is REAL TIME, not a category axis of formatted date
 * strings. Recharts spaces categories evenly, so the old chart drew
 * three sessions scattered across ninety days as three equidistant
 * points — a lift touched twice in January and once in March looked like
 * steady weekly progress. Here the gap between two sessions is the gap
 * between them.
 */
export default function ExerciseTrendChart({ points, metric, metricLabel, height = 190 }) {
  const { language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const fmtDate = useDateFormatter();
  const fmtNum = useNumberFormatter();

  const isWeight = METRIC_IS_WEIGHT[metric];

  // Everything is STORED in pounds; the axis, the ticks and the tooltip
  // all read the user's unit, so convert once here and let the rest of
  // the chart work in display units.
  const data = useMemo(
    () => seriesFor(points, metric).map((d) => ({
      t: d.t,
      value: d.value == null
        ? null
        : (METRIC_IS_WEIGHT[metric] ? fromLbs(d.value, weightUnit) : d.value),
    })),
    [points, metric, weightUnit],
  );

  const values = data.map((d) => d.value);
  const domain = valueDomain(values);
  const yTicks = axisTicks(values);
  const xTicks = tickTimes(points, 4);

  const axisNum = (v) => fmtNum(v, { maximumFractionDigits: v < 100 ? 1 : 0 });
  const axisDate = (t) => fmtDate(t, { month: 'short', day: 'numeric' });

  return (
    // `key` on the container, not the chart: recharts caches its own
    // measured geometry, and a language or unit switch changes tick
    // widths without changing the data shape.
    <ResponsiveContainer width="100%" height={height} key={`${language}-${weightUnit}-${metric}`}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        {/* Recessive: horizontal only, and a hairline at low opacity.
            The old grid was a solid --border in both directions, which
            competed with the series it was meant to sit behind. */}
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} vertical={false} />

        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          ticks={xTicks}
          tickFormatter={axisDate}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
          minTickGap={8}
        />

        {/* Non-zero baseline, which is why both real bounds are always
            ticked — the reader can see where the axis starts. A zero
            baseline would flatten 185 → 195 into a straight line, and
            "did it go up" is the only question this chart answers. */}
        <YAxis
          domain={domain}
          ticks={yTicks}
          tickFormatter={axisNum}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
          width={40}
        />

        <Tooltip
          cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeOpacity: 0.4 }}
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: '12px',
            padding: '6px 10px',
          }}
          labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: '11px', marginBottom: 2 }}
          itemStyle={{ color: 'hsl(var(--foreground))', padding: 0 }}
          labelFormatter={(t) => fmtDate(t, { dateStyle: 'medium' })}
          formatter={(v) => [
            `${fmtNum(v, { maximumFractionDigits: 1 })}${isWeight ? ` ${weightUnit}` : ''}`,
            metricLabel,
          ]}
        />

        <Line
          type="monotone"
          dataKey="value"
          stroke="hsl(var(--chart-1))"
          strokeWidth={2}
          // A session with no real value for this metric breaks the
          // line instead of being drawn through, so a gap in the data
          // reads as a gap.
          connectNulls={false}
          dot={{ r: 3, fill: 'hsl(var(--chart-1))', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
          activeDot={{ r: 5, fill: 'hsl(var(--chart-1))', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
