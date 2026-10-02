// src/components/glance/WeekFocal.jsx
//
// The training week as a focal goal (hero option D): the sessions done
// against the user's own weekly target in a ring, the sentence that says what
// that means today, the quieter line under it, and the Monday to Sunday dots.
//
// Shared by Progress (ProgressFocal) and Today (Dashboard's HeroCard), so the
// two pages cannot disagree about the week: same ring, same sentence, same
// dots, from the same weekSummary(). The caller computes `week`, so the page
// keeps one clock for everything it renders (Progress also builds its next
// step from it).
//
// What sits under the sentence is the caller's: Progress puts "Start a
// session" there for someone who has never trained, Today puts the training
// streak there. `aside` is rendered in FocalHero's action slot.

import React from 'react';
import { Dumbbell } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter, useDateFormatter, useListFormatter } from '@/lib/intl';
import { weekHeadline, weekDetail, ringShare } from '@/lib/focalGoal';
import FocalHero from '@/components/glance/FocalHero';
import FocalRing from '@/components/glance/FocalRing';
import WeekDots from '@/components/glance/WeekDots';

const NUMERAL = 'font-display tabular-nums text-foreground';
const NUMERAL_SIZE = { fontSize: 'clamp(2.25rem, 11vw, 2.75rem)' };
const CAPTION = 'kicker';

/**
 * @param {object} props
 * @param {ReturnType<import('@/lib/focalGoal').weekSummary>} props.week
 * @param {React.ReactNode} [props.aside]  under the sentence (an action or a line)
 * @param {string} [props.headline]  replaces the week sentence (the ring still says the week)
 * @param {string} [props.detail]    replaces the line under it
 * @param {React.ReactNode} [props.visual]  replaces the Monday to Sunday dots
 */
export default function WeekFocal({ week, aside = null, className = '', headline: headlineOver = null, detail: detailOver = null, visual = null }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const fmtDate = useDateFormatter();
  const list = useListFormatter();

  const t = (desc) => {
    if (!desc) return null;
    const vars = {};
    for (const [k, v] of Object.entries(desc.vars || {})) vars[k] = typeof v === 'number' ? fmt(v) : v;
    return tFallback(desc.key, desc.fallback, vars);
  };
  const dayName = (i) => fmtDate(week.days[i].date, { weekday: 'long' });

  const headline = headlineOver ?? t(weekHeadline(week));
  const detail = detailOver ?? t(weekDetail(week, (idx) => list(idx.map(dayName))));

  let figure;
  if (!week.everTrained) {
    // Nothing logged, ever. No "0": the ring holds the goal they chose, or an
    // icon when they chose none.
    figure = (
      <FocalRing share={0} advance={week.done}>
        {week.target ? (
          <>
            <span className={NUMERAL} style={NUMERAL_SIZE}>{fmt(week.target)}</span>
            <span className={`${CAPTION} mt-1 px-3`}>{tFallback('progress.focal.ring.perWeek', 'Per week')}</span>
          </>
        ) : (
          <Dumbbell className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
        )}
      </FocalRing>
    );
  } else if (week.target) {
    figure = (
      <FocalRing
        share={ringShare(week.done, week.target)}
        advance={week.done}
        label={tFallback('progress.focal.ring.aria', '{done} of {target} sessions this week', { done: fmt(week.done), target: fmt(week.target) })}
      >
        <span className={NUMERAL} style={NUMERAL_SIZE}>
          {fmt(week.done)}
          <span className="text-muted-foreground" style={{ fontSize: '0.6em' }}>/{fmt(week.target)}</span>
        </span>
        <span className={`${CAPTION} mt-1`}>{tFallback('progress.focal.ring.thisWeek', 'This week')}</span>
      </FocalRing>
    );
  } else {
    // No target: the count, with no ring to fill against a goal nobody set.
    figure = (
      <div className="shrink-0 flex flex-col items-start min-w-[88px]">
        <span className={NUMERAL} style={NUMERAL_SIZE}>{fmt(week.done)}</span>
        <span className={`${CAPTION} mt-1`}>{tFallback('progress.focal.ring.thisWeek', 'This week')}</span>
      </div>
    );
  }

  return (
    <FocalHero figure={figure} headline={headline} detail={detail} action={aside} className={className}>
      {visual ?? <WeekDots days={week.days} />}
    </FocalHero>
  );
}
