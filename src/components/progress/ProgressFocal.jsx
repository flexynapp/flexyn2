// src/components/progress/ProgressFocal.jsx
//
// Progress's hero, option D (kegan, 2026-09-27; spec board "Focal"): the
// week's sessions against the user's own weekly target, drawn big in a ring,
// with one sentence that says what it means today and the Monday to Sunday
// dots under it. Then a quieter stat row (Level, this week's volume, PRs) and
// one next step taken from the user's own data.
//
// It replaces ProgressCarousel, four rotating slides (streak, workouts,
// volume, level) whose focal point moved every few seconds.
//
// Every number here has a comparison beside it: the ring against the target,
// Level against the next level, Volume against its own eight weeks, PRs
// against the week. Cells with nothing behind them are dropped, not zeroed.
//
// XP and level are READ from the profile (total_xp is server-owned). Nothing
// here computes an award.

import React, { useMemo } from 'react';
import { Dumbbell, Trophy, CalendarCheck, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter, useDateFormatter, useListFormatter } from '@/lib/intl';
import { fromLbs } from '@/lib/weightUnit';
import { calculateLevelFromXp, MAX_LEVEL } from '@/lib/xpSystem';
import { parseLocalDate, toLocalDateString } from '@/lib/dateUtils';
import { workoutTitle } from '@/lib/workoutTitle';
import { track, EVENTS } from '@/lib/analytics';
import { weekSummary, weekHeadline, weekDetail, ringShare } from '@/lib/focalGoal';
import { personalBestEvents, personalBestCounts, weeklyVolumeSeries } from '@/lib/glanceStats';
import FocalHero from '@/components/glance/FocalHero';
import FocalRing from '@/components/glance/FocalRing';
import WeekDots from '@/components/glance/WeekDots';
import GlanceStatRow, { StatMeter, Sparkline } from '@/components/glance/GlanceStatRow';
import NextStepRow from '@/components/glance/NextStepRow';

const DAY_MS = 24 * 60 * 60 * 1000;
// A PR stays a "moment" for a week; after that it is history.
const PR_FRESH_DAYS = 7;
// Long enough since the last session that repeating it is worth offering.
const COMEBACK_DAYS = 5;

export default function ProgressFocal({
  logs = [],
  userProfile = {},
  userId,
  weightUnit = 'lbs',
  onOpenAnalytics,
  onOpenBests,
  onOpenPR,
  onStart,
  onRepeat,
  now: nowProp,
}) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const fmtDate = useDateFormatter();
  const list = useListFormatter();
  // One clock for the whole render, so the ring, the dots and the next step
  // cannot disagree about which day it is across midnight.
  const now = useMemo(() => nowProp || new Date(), [nowProp]);

  const week = useMemo(() => weekSummary({ logs, profile: userProfile, now }), [logs, userProfile, now]);
  const t = (desc) => {
    if (!desc) return null;
    const vars = {};
    for (const [k, v] of Object.entries(desc.vars || {})) vars[k] = typeof v === 'number' ? fmt(v) : v;
    return tFallback(desc.key, desc.fallback, vars);
  };
  const dayName = (i) => fmtDate(week.days[i].date, { weekday: 'long' });

  const headline = t(weekHeadline(week));
  const detail = t(weekDetail(week, (idx) => list(idx.map(dayName))));

  // ── The figure ──────────────────────────────────────────────────────────
  const numeral = 'font-display tabular-nums text-foreground';
  const numeralSize = { fontSize: 'clamp(2.25rem, 11vw, 2.75rem)' };
  const caption = 'text-micro font-bold uppercase tracking-[0.04em] text-muted-foreground';
  let figure;
  if (!week.everTrained) {
    // Nothing logged, ever. No "0": the ring holds the goal they chose, or an
    // icon when they chose none.
    figure = (
      <FocalRing share={0} advance={week.done}>
        {week.target ? (
          <>
            <span className={numeral} style={numeralSize}>{fmt(week.target)}</span>
            <span className={`${caption} mt-1 px-3`}>{tFallback('progress.focal.ring.perWeek', 'Per week')}</span>
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
        <span className={numeral} style={numeralSize}>
          {fmt(week.done)}
          <span className="text-muted-foreground" style={{ fontSize: '0.6em' }}>/{fmt(week.target)}</span>
        </span>
        <span className={`${caption} mt-1`}>{tFallback('progress.focal.ring.thisWeek', 'This week')}</span>
      </FocalRing>
    );
  } else {
    // No target: the count, with no ring to fill against a goal nobody set.
    figure = (
      <div className="shrink-0 flex flex-col items-start min-w-[88px]">
        <span className={numeral} style={numeralSize}>{fmt(week.done)}</span>
        <span className={`${caption} mt-1`}>{tFallback('progress.focal.ring.thisWeek', 'This week')}</span>
      </div>
    );
  }

  // ── Stat row ────────────────────────────────────────────────────────────
  const totalXp = Number(userProfile?.total_xp) || 0;
  const lvl = calculateLevelFromXp(totalXp);
  const prEvents = useMemo(() => personalBestEvents(logs), [logs]);
  const prCounts = useMemo(() => personalBestCounts(prEvents, now), [prEvents, now]);
  const series = useMemo(() => weeklyVolumeSeries(logs, now, 8), [logs, now]);
  const volumeThisWeek = series[series.length - 1] || 0;
  const hasVolumeHistory = series.some((v) => v > 0);
  const openCell = (id, fn) => (fn ? () => { track(EVENTS.GLANCE_TILE_OPENED, { page: 'progress', id }); fn(); } : undefined);

  const cells = [
    // Level 1 with an empty bar is a zero in another shape; the cell waits
    // for the first XP.
    totalXp > 0 && {
      id: 'level',
      label: tFallback('progress.glance.level', 'Lv. {n}', { n: lvl.level }),
      visual: <StatMeter share={lvl.progressPercent / 100} label={tFallback('progress.glance.levelMeter', 'Progress to the next level')} />,
      sub: lvl.level >= MAX_LEVEL
        ? tFallback('progress.glance.maxLevel', 'Top level reached')
        : tFallback('progress.glance.xpToNext', '{xp} XP to Lv. {next}', {
            xp: fmt(Math.max(0, Math.round(lvl.xpNeeded - lvl.xpInLevel))),
            next: lvl.level + 1,
          }),
    },
    hasVolumeHistory && {
      id: 'volume',
      label: tFallback('progress.glance.volume', '{unit} this week', { unit: weightUnit }),
      value: fmt(Math.round(fromLbs(volumeThisWeek, weightUnit))),
      visual: <Sparkline series={series} label={tFallback('progress.glance.volumeTrend', 'Volume over the last eight weeks')} />,
      onOpen: openCell('volume', onOpenAnalytics),
    },
    prEvents.length > 0 && {
      id: 'prs',
      // The figure is THIS MONTH's count; the sub line says the week, or
      // when the last one was. "PRs this month" as the label truncated on
      // an SE, so the month is stated in the sub line when the week is
      // empty rather than in the label.
      label: tFallback('progress.glance.prs', 'PRs'),
      value: fmt(prCounts.month),
      sub: prCounts.week > 0
        ? tFallback('progress.glance.prsWeek', '{n} this week', { n: fmt(prCounts.week) })
        : prCounts.month > 0
          ? tFallback('progress.glance.prsMonth', 'This month')
          : tFallback('progress.glance.prsLast', 'Last on {date}', {
              date: fmtDate(parseLocalDate(prEvents[prEvents.length - 1].date), { month: 'short', day: 'numeric' }),
            }),
      onOpen: openCell('prs', onOpenBests),
    },
  ];

  // ── Next step: a moment from the user's own data ────────────────────────
  const todayKey = toLocalDateString(now);
  const candidates = useMemo(() => {
    const out = [];
    const latestPr = prEvents[prEvents.length - 1];
    const prDate = latestPr && parseLocalDate(latestPr.date);
    if (latestPr && prDate && (now - prDate) / DAY_MS < PR_FRESH_DAYS) {
      const detailStr = latestPr.weight > 0
        // No-break spaces: "185 lbs × 5" is one figure and must not wrap
        // with the "× 5" stranded on a line of its own.
        ? `${fmt(Math.round(fromLbs(latestPr.weight, weightUnit)))}\u00A0${weightUnit}\u00A0×\u00A0${fmt(latestPr.reps)}`
        : tFallback('progress.next.pr.reps', '{n} reps', { n: fmt(latestPr.reps) });
      out.push({
        id: `pr:${latestPr.name}:${latestPr.date}`,
        kind: 'pr',
        eligible: true,
        priority: 3,
        icon: Trophy,
        tone: 'success',
        title: latestPr.date === todayKey
          ? tFallback('progress.next.pr.titleToday', '{exercise} PR today: {detail}', { exercise: latestPr.name, detail: detailStr })
          : tFallback('progress.next.pr.title', '{exercise} PR on {day}: {detail}', {
              exercise: latestPr.name,
              detail: detailStr,
              day: fmtDate(prDate, { weekday: 'long' }),
            }),
        reason: tFallback('progress.next.pr.reason', 'Compare it with every session before it.'),
        actionLabel: tFallback('progress.next.seeIt', 'See it'),
        onOpen: () => onOpenPR?.(latestPr.name),
      });
    }
    const plannedToday = Array.isArray(userProfile?.training_days)
      && userProfile.training_days.map(String).includes(String(week.todayIndex));
    const last = logs[0];
    const lastTitle = last ? workoutTitle(last) : null;
    if (plannedToday && !week.trainedToday && week.everTrained) {
      out.push({
        id: `planned:${todayKey}`,
        kind: 'planned',
        eligible: true,
        priority: 2,
        icon: CalendarCheck,
        tone: 'neutral',
        title: tFallback('progress.next.planned.title', 'Today is one of your training days'),
        reason: lastTitle
          ? tFallback('progress.next.planned.reasonLast', 'Last time you did {workout}.', { workout: lastTitle })
          : null,
        actionLabel: tFallback('progress.next.start', 'Start'),
        onOpen: () => onStart?.(),
      });
    }
    const lastDate = last && parseLocalDate(last.date);
    const since = lastDate ? Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - lastDate) / DAY_MS) : null;
    if (last && since != null && since >= COMEBACK_DAYS) {
      out.push({
        id: `repeat:${last.id || last.date}`,
        kind: 'repeat',
        eligible: true,
        priority: 1,
        icon: RotateCcw,
        tone: 'neutral',
        title: tFallback('progress.next.repeat.title', 'Your last session was {n} days ago', { n: fmt(since) }),
        reason: lastTitle
          ? tFallback('progress.next.repeat.reasonTitled', 'Pick up where you left off with {workout}.', { workout: lastTitle })
          : tFallback('progress.next.repeat.reason', 'Pick up where you left off with the same session.'),
        actionLabel: tFallback('progress.next.repeatIt', 'Repeat it'),
        onOpen: () => onRepeat?.(last),
      });
    }
    return out;
    // fmt/fmtDate/tFallback change only with the language; the pick is held
    // for the visit regardless (NextStepRow decides once).
  }, [prEvents, logs, userProfile, week, now, todayKey, weightUnit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col" style={{ gap: 'var(--fluid-section)' }}>
      <FocalHero
        figure={figure}
        headline={headline}
        detail={detail}
        action={!week.everTrained && onStart ? (
          <button
            type="button"
            onClick={onStart}
            className="self-start min-h-[44px] inline-flex items-center text-label font-bold text-primary hover:text-primary/80 active:text-primary/80 transition-colors"
          >
            {tFallback('progress.focal.start', 'Start a session')}
          </button>
        ) : null}
      >
        <WeekDots days={week.days} />
      </FocalHero>
      <GlanceStatRow cells={cells} />
      <NextStepRow page="progress" userId={userId} candidates={candidates} />
    </div>
  );
}
