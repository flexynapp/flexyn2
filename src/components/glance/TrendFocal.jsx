// src/components/glance/TrendFocal.jsx
//
// A trend slide in Today's hero carousel. Same layout as WeekFocal, so the
// carousel reads as one component: the focal figure on the left, the
// sentence beside it, and a visual row under them. On the week slide that
// row is the Monday to Sunday dots; here it is the line.
//
// The figure is today's value (estimated max, or latest weigh-in) in the
// user's unit. The sentence says what changed and over how long, and the
// quieter line says where the trend is heading, both from heroTrends.js.
//
// Not ready yet (fewer than three points, or too short a span): no line is
// drawn. The graph row becomes three slots, filled for each session the
// user has logged on that lift, the same visual language as the day dots,
// so the slide says how close it is rather than pretending to a trend.

import React from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter, useDateFormatter } from '@/lib/intl';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { translateExerciseName } from '@/lib/exerciseTranslations';
import { MIN_SPAN_DAYS } from '@/lib/heroTrends';
import FocalHero from '@/components/glance/FocalHero';
import TrendGraph, { HEIGHT as GRAPH_HEIGHT } from '@/components/glance/TrendGraph';
import { IconRing } from '@/components/glance/GlanceFocals';
import { TrendingUp, Scale } from 'lucide-react';


const isToday = (t) => new Date(t).toDateString() === new Date().toDateString();

/**
 * @param {object} props
 * @param {ReturnType<import('@/lib/heroTrends').strengthTrend>} props.trend
 * @param {boolean} props.active   the slide is on screen (plays the draw)
 */
export default function TrendFocal({ trend, active }) {
  const { tFallback, language } = useLanguage();
  const fmt = useNumberFormatter();
  const fmtDate = useDateFormatter();
  const { weightUnit } = useWeightUnit();

  const dp = weightUnit === 'lbs' ? 0 : 1;
  const num = (lbs) => fmt(Number(fromLbs(lbs, weightUnit).toFixed(dp)));
  const withUnit = (lbs) => `${num(lbs)} ${weightUnit}`;
  // A sentence that ends on an abbreviated month ("29 oct.") would end in
  // two full stops.
  const tidy = (str) => (typeof str === 'string' ? str.replace(/\.\.$/, '.') : str);
  const shortDate = (t) => fmtDate(new Date(t), { month: 'short', day: 'numeric' });
  const lift = trend.lift ? translateExerciseName(trend.lift, language) : null;
  const caption = trend.kind === 'weight'
    ? tFallback('dashboard.trend.caption.weight', 'Body weight')
    : tFallback('dashboard.trend.caption.strength', 'Est. max');

  if (!trend.ready) {
    const enoughPoints = trend.have >= trend.need;
    // The arc fills a third per session logged, as the slots under it do.
    const figure = <IconRing icon={TrendingUp} share={trend.have / trend.need} label={tFallback('dashboard.trend.empty.ringAria', '{have} of {need} sessions', { have: fmt(Math.min(trend.have, trend.need)), need: fmt(trend.need) })} />;
    const headline = enoughPoints
      ? tFallback('dashboard.trend.empty.spanHeadline', 'Your strength line needs a bit more time.')
      : tFallback('dashboard.trend.empty.headline', 'Your strength line starts after 3 sessions.');
    const detail = enoughPoints
      ? tFallback('dashboard.trend.empty.spanDetail', 'It draws once your {lift} sessions span {n} days.', { lift, n: fmt(MIN_SPAN_DAYS.strength) })
      : lift
        ? tFallback('dashboard.trend.empty.liftDetail', '{lift}: {have} of 3 logged.', { lift, have: fmt(trend.have) })
        : tFallback('dashboard.trend.empty.noneDetail', 'Log a lift with weight and reps to start it.');
    return (
      <FocalHero figure={figure} headline={headline} detail={detail}>
        <SessionSlots have={trend.have} need={trend.need} />
      </FocalHero>
    );
  }

  const spanText = trend.spanDays < 14
    ? tFallback('dashboard.trend.span.days', '{n} days', { n: fmt(trend.spanDays) })
    : tFallback('dashboard.trend.span.weeks', '{n} weeks', { n: fmt(Math.round(trend.spanDays / 7)) });
  const delta = withUnit(Math.abs(trend.delta));
  const current = withUnit(trend.last.v);

  let headline;
  if (trend.kind === 'strength') {
    headline = {
      up: () => tFallback('dashboard.trend.strength.up', '{lift} up {delta} in {span}.', { lift, delta, span: spanText }),
      down: () => tFallback('dashboard.trend.strength.down', '{lift} down {delta} since {date}.', { lift, delta, date: shortDate(trend.first.t) }),
      steady: () => tFallback('dashboard.trend.strength.steady', '{lift} holding at {value}.', { lift, value: current }),
    }[trend.direction]();
  } else {
    headline = {
      up: () => tFallback('dashboard.trend.weight.up', 'Up {delta} in {span}.', { delta, span: spanText }),
      down: () => tFallback('dashboard.trend.weight.down', 'Down {delta} in {span}.', { delta, span: spanText }),
      steady: () => tFallback('dashboard.trend.weight.steady', 'Steady at {value}.', { value: current }),
    }[trend.direction]();
  }
  headline = tidy(headline);

  // The figure used to be today's value; with the icon there, it leads the
  // quieter line instead.
  const now = tFallback('dashboard.trend.now', 'Now {value}.', { value: current });
  const detail = trend.projection
    ? tidy(`${now} ${tFallback('dashboard.trend.onPace', 'On pace for {value} by {date}.', {
      value: withUnit(trend.projection.v),
      date: shortDate(trend.projection.t),
    })}`)
    : now;

  // Strength opens Progress and weight is the Log weight row, so each
  // takes that menu's icon. A trend has no target, so the ring is track only.
  const figure = <IconRing icon={trend.kind === 'weight' ? Scale : TrendingUp} label={`${caption}: ${current}`} />;

  return (
    <FocalHero figure={figure} headline={headline} detail={detail}>
      <TrendGraph
        points={trend.points}
        projection={trend.projection}
        play={active}
        formatDate={shortDate}
        formatValue={withUnit}
        lastLabel={isToday(trend.last.t) ? tFallback('common.today', 'Today') : shortDate(trend.last.t)}
        label={[headline, detail].filter(Boolean).join(' ')}
      />
    </FocalHero>
  );
}

// Three slots on a hairline: one per session the line needs, filled for each
// one logged. Points are not plotted by value here on purpose: two points
// on an axis already read as a trend, which is the claim this state exists
// not to make.
function SessionSlots({ have, need }) {
  const slots = Array.from({ length: need }, (_, i) => i < have);
  return (
    <div className="relative flex items-center justify-between px-[6px]" style={{ height: GRAPH_HEIGHT }} aria-hidden="true">
      <span className="absolute inset-x-[6px] top-1/2 h-px bg-border" />
      {slots.map((filled, i) => (
        <span
          key={i}
          className={`relative w-3 h-3 rounded-full ${filled ? 'bg-primary' : 'bg-background border-2 border-border'}`}
        />
      ))}
    </div>
  );
}

