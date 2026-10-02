// src/components/glance/GlanceFocals.jsx
//
// The rest of Today's hero carousel: fuel, a duel, the crew war, quests,
// the goal nearest done, and the weekly pattern. Same layout as WeekFocal
// and TrendFocal (figure left, sentence beside it, one visual row under
// them at the trend graph's height), so the pages turn without the hero
// changing size and the sentence starts at the same x on every slide.
//
// Each visual draws the rule rather than describing it: two bars racing for
// a contest, a bar per macro against its target, a check per quest, a bar
// per weekday. Bars grow from zero when their slide first comes on screen,
// on the same clock and curve as the trend line's draw, and once only.
// Reduced motion shows the final state.
//
// Colour: primary for the viewer's own number, a neutral for the other
// side, success for done, and the chart ramp for macros (the composition
// rules route macros there so a healthy protein bar is never "destructive").

import React, { useContext, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter, useDateFormatter, formatDuration } from '@/lib/intl';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { goalTitle, goalTargetLabel } from '@/lib/goalProgress';
import FocalHero from '@/components/glance/FocalHero';
import {
  HEIGHT as VISUAL_H, DRAW_S, SETTLE_WAIT_S, DRAW_EASE, TrendTimeScale,
} from '@/components/glance/TrendGraph';

const NUMERAL = 'font-display tabular-nums text-foreground leading-none whitespace-nowrap';
const NUMERAL_SIZE = { fontSize: 'clamp(2.25rem, 11vw, 2.75rem)' };
// Sentence case, no tracking: the label rule (Kegan, 2-Oct). Becomes .kicker
// once that class lands with the font rule.
const CAPTION = 'text-label font-medium text-muted-foreground';
const FIGURE_W = 132;
const ROW_LABEL = 'text-micro text-muted-foreground truncate';
const ROW_VALUE = 'text-micro font-semibold text-foreground tabular-nums whitespace-nowrap';

/** The big number and its caption, in the same column on every slide. */
export function Figure({ value, unit, caption }) {
  return (
    <div className="shrink-0 flex flex-col items-start" style={{ width: FIGURE_W }}>
      <span className={NUMERAL} style={NUMERAL_SIZE}>
        {value}
        {unit && <span className="text-muted-foreground" style={{ fontSize: '0.45em' }}> {unit}</span>}
      </span>
      <span className={`${CAPTION} mt-2`}>{caption}</span>
    </div>
  );
}

// Plays once: the first time the slide is on screen. Paging back to it
// shows the finished bars, as the trend line does.
function usePlayed(active) {
  const [played, setPlayed] = useState(false);
  useEffect(() => { if (active) setPlayed(true); }, [active]);
  return played;
}

/** A horizontal bar on a track, filled to `pct`, growing in when played. */
function Bar({ pct, played, color = 'bg-primary', thick = false, order = 0 }) {
  const reduce = useReducedMotion();
  const k = useContext(TrendTimeScale) || 1;
  const width = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <span className={`relative block w-full overflow-hidden rounded-full bg-secondary ${thick ? 'h-2.5' : 'h-1.5'}`}>
      <motion.span
        className={`absolute inset-y-0 start-0 rounded-full origin-left rtl:origin-right ${color}`}
        style={{ width: `${width}%` }}
        initial={false}
        animate={{ scaleX: played || reduce ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : {
          duration: DRAW_S * k,
          ease: DRAW_EASE,
          delay: (SETTLE_WAIT_S + order * 0.08) * k,
        }}
      />
    </span>
  );
}

function Visual({ children, label }) {
  return (
    <div className="flex flex-col justify-center gap-2" style={{ height: VISUAL_H }} role="img" aria-label={label}>
      {children}
    </div>
  );
}

// ── Fuel ─────────────────────────────────────────────────────────────────

export function FuelFocal({ fuel, active }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const played = usePlayed(active);
  const over = fuel.left < 0;

  const headline = fuel.calories === 0
    ? tFallback('dashboard.glance.fuel.none', 'Nothing logged yet today.')
    : over
      ? tFallback('dashboard.glance.fuel.over', '{n} kcal over your target.', { n: fmt(-fuel.left) })
      : tFallback('dashboard.glance.fuel.eaten', '{eaten} of {goal} kcal eaten.', { eaten: fmt(fuel.calories), goal: fmt(fuel.goal) });
  // No detail line: the macro rows under the bar already say it.
  const detail = null;

  const macros = [
    { key: 'protein', label: tFallback('dashboard.glance.fuel.proteinLabel', 'Protein'), color: 'bg-chart-1', ...fuel.protein },
    { key: 'carbs', label: tFallback('dashboard.glance.fuel.carbsLabel', 'Carbs'), color: 'bg-chart-2', ...fuel.carbs },
    { key: 'fat', label: tFallback('dashboard.glance.fuel.fatLabel', 'Fat'), color: 'bg-chart-3', ...fuel.fat },
  ].filter((m) => m.target > 0);

  return (
    <FocalHero
      figure={<Figure
        value={fmt(Math.abs(fuel.left))}
        caption={over
          ? tFallback('dashboard.glance.fuel.captionOver', 'kcal over')
          : tFallback('dashboard.glance.fuel.captionLeft', 'kcal left')}
      />}
      headline={headline}
      detail={detail}
    >
      <Visual label={[headline, detail].filter(Boolean).join(' ')}>
        <Bar pct={(fuel.calories / Math.max(1, fuel.goal)) * 100} played={played} thick color="bg-primary" />
        {macros.map((m, i) => (
          <div key={m.key} className="grid items-center gap-2" style={{ gridTemplateColumns: '5.5rem 1fr auto' }}>
            <span className={ROW_LABEL}>{m.label}</span>
            <Bar pct={(m.have / Math.max(1, m.target)) * 100} played={played} color={m.color} order={i + 1} />
            <span className={ROW_VALUE}>{fmt(m.have)}<span className="text-muted-foreground font-normal">/{fmt(m.target)} g</span></span>
          </div>
        ))}
      </Visual>
    </FocalHero>
  );
}

// ── Contests: a duel and the crew war share one shape ────────────────────

function ContestFocal({ caption, mine, theirs, myLabel, theirLabel, headline, detail, active, formatValue }) {
  const fmt = useNumberFormatter();
  const played = usePlayed(active);
  const top = Math.max(mine, theirs, 1);
  const margin = mine - theirs;
  const sign = margin > 0 ? '+' : margin < 0 ? '−' : '';
  const rows = [
    { key: 'me', label: myLabel, value: mine, color: 'bg-primary' },
    { key: 'them', label: theirLabel, value: theirs, color: 'bg-muted-foreground/50' },
  ];
  return (
    <FocalHero
      figure={<Figure value={`${sign}${fmt(Math.abs(margin))}`} caption={caption} />}
      headline={headline}
      detail={detail}
    >
      <Visual label={[headline, detail].filter(Boolean).join(' ')}>
        {rows.map((r, i) => (
          <div key={r.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className={`${ROW_LABEL} ${r.key === 'me' ? 'text-foreground font-semibold' : ''}`}>{r.label}</span>
              <span className={ROW_VALUE}>{formatValue(r.value)}</span>
            </div>
            <Bar pct={(r.value / top) * 100} played={played} thick color={r.color} order={i} />
          </div>
        ))}
      </Visual>
    </FocalHero>
  );
}

export function DuelFocal({ duel, active }) {
  const { tFallback, language } = useLanguage();
  const fmt = useNumberFormatter();
  const { weightUnit } = useWeightUnit();
  const name = duel.opponentName ? `@${duel.opponentName}` : tFallback('dashboard.glance.duel.rival', 'your rival');
  const Name = duel.opponentName ? `@${duel.opponentName}` : tFallback('dashboard.glance.duel.rivalStart', 'Your rival');
  const bySets = duel.unit === 'sets';
  const unit = bySets ? tFallback('dashboard.glance.duel.sets', 'sets') : weightUnit;
  const toUnit = (v) => (bySets ? v : Math.round(fromLbs(v, weightUnit)));
  const formatValue = (v) => `${fmt(v)} ${unit}`;
  const left = duel.msLeft != null && duel.msLeft > 60_000
    ? tFallback('dashboard.glance.timeLeft', '{time} left.', { time: formatDuration(duel.msLeft, language) })
    : null;

  if (duel.pending) {
    return (
      <ContestFocal
        caption={tFallback('dashboard.glance.duel.caption', 'Duel')}
        mine={0} theirs={0}
        myLabel={tFallback('dashboard.glance.you', 'You')} theirLabel={Name}
        headline={tFallback('dashboard.glance.duel.pending', '{name} challenged you to a duel.', { name: Name })}
        detail={left ? tFallback('dashboard.glance.duel.answer', 'Answer within {time}.', { time: formatDuration(duel.msLeft, language) }) : null}
        active={active}
        formatValue={formatValue}
      />
    );
  }

  // From the converted sides, so the sentence matches the figure exactly.
  const margin = formatValue(Math.abs(toUnit(duel.mine) - toUnit(duel.theirs)));
  const headline = duel.mine > duel.theirs
    ? tFallback('dashboard.glance.duel.leading', 'You lead {name} by {margin}.', { name, margin })
    : duel.mine < duel.theirs
      ? tFallback('dashboard.glance.duel.trailing', '{name} leads you by {margin}.', { name: Name, margin })
      : tFallback('dashboard.glance.duel.tied', 'Level with {name}.', { name });
  return (
    <ContestFocal
      caption={tFallback('dashboard.glance.duel.caption', 'Duel')}
      mine={toUnit(duel.mine)} theirs={toUnit(duel.theirs)}
      myLabel={tFallback('dashboard.glance.you', 'You')} theirLabel={Name}
      headline={headline}
      detail={left}
      active={active}
      formatValue={(v) => `${fmt(v)} ${unit}`}
    />
  );
}

export function WarFocal({ war, active }) {
  const { tFallback, language } = useLanguage();
  const fmt = useNumberFormatter();
  const crew = war.crewName || tFallback('dashboard.glance.war.yourCrew', 'Your crew');
  const pts = tFallback('dashboard.glance.war.points', 'pts');
  const margin = `${fmt(Math.abs(war.mine - war.theirs))} ${pts}`;
  const headline = war.mine > war.theirs
    ? tFallback('dashboard.glance.war.leading', '{crew} leads by {margin}.', { crew, margin })
    : war.mine < war.theirs
      ? tFallback('dashboard.glance.war.trailing', '{crew} trails by {margin}.', { crew, margin })
      : tFallback('dashboard.glance.war.tied', '{crew} is level.', { crew });
  const left = war.msLeft != null && war.msLeft > 60_000
    ? tFallback('dashboard.glance.timeLeft', '{time} left.', { time: formatDuration(war.msLeft, language) })
    : null;
  return (
    <ContestFocal
      caption={tFallback('dashboard.glance.war.caption', 'Crew war')}
      mine={war.mine} theirs={war.theirs}
      myLabel={crew} theirLabel={tFallback('dashboard.glance.war.rivalCrew', 'Rival crew')}
      headline={headline}
      detail={left}
      active={active}
      formatValue={(v) => `${fmt(v)} ${pts}`}
    />
  );
}

// ── Quests ───────────────────────────────────────────────────────────────

function questLabel(q, t) {
  const id = q.quest_id;
  const k = `quest.${id}.label`;
  const v = t(k);
  return v === k ? (q.definition?.label || q.label || id) : v;
}

export function QuestsFocal({ quests, active }) {
  const { t, tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const played = usePlayed(active);
  const left = quests.total - quests.done;

  let headline;
  if (left === 0 && quests.unclaimed > 0) {
    headline = quests.unclaimed === 1
      ? tFallback('dashboard.glance.quests.claimOne', 'All done. One reward to claim.')
      : tFallback('dashboard.glance.quests.claimMany', 'All done. {n} rewards to claim.', { n: fmt(quests.unclaimed) });
  } else if (left === 0) {
    headline = tFallback('dashboard.glance.quests.allDone', 'Every quest done today.');
  } else {
    headline = left === 1
      ? tFallback('dashboard.glance.quests.leftOne', 'One quest left today.')
      : tFallback('dashboard.glance.quests.leftMany', '{n} quests left today.', { n: fmt(left) });
  }
  // No detail line: the list under it already shows what is left.
  const detail = null;

  return (
    <FocalHero
      figure={<Figure
        value={<>{fmt(quests.done)}<span className="text-muted-foreground" style={{ fontSize: '0.6em' }}>/{fmt(quests.total)}</span></>}
        caption={tFallback('dashboard.glance.quests.caption', 'Quests')}
      />}
      headline={headline}
      detail={detail}
    >
      <Visual label={[headline, detail].filter(Boolean).join(' ')}>
        {quests.quests.slice(0, 4).map((q, i) => {
          const done = !!(q.completed_at || q.claimed_at);
          const target = Number(q.target) || 1;
          const pct = done ? 100 : (Number(q.progress) || 0) / target * 100;
          return (
            <div key={q.id ?? q.quest_id} className="grid items-center gap-2" style={{ gridTemplateColumns: '1rem minmax(0,1fr) 3.5rem' }}>
              <span className={`flex items-center justify-center w-4 h-4 rounded-full ${done ? 'bg-success text-success-foreground' : 'border-2 border-border'}`}>
                {done && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
              </span>
              <span className={`text-micro truncate ${done ? 'text-muted-foreground' : 'text-foreground'}`}>{questLabel(q, t)}</span>
              <Bar pct={pct} played={played} color={done ? 'bg-success' : 'bg-primary'} order={i} />
            </div>
          );
        })}
      </Visual>
    </FocalHero>
  );
}

// ── Goal ─────────────────────────────────────────────────────────────────

export function GoalFocal({ goal, active }) {
  const { t, tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();
  const played = usePlayed(active);
  const pct = Math.floor(goal.progress);
  let title = goal.goal.title || '';
  try { title = goalTitle(goal.goal, { t, tFallback }) || title; } catch { /* keep the stored title */ }
  let target = null;
  try { target = goalTargetLabel(goal.goal, { tFallback, weightUnit, distanceUnit }); } catch { target = null; }

  const headline = title;
  const detail = goal.activeCount > 1
    ? tFallback('dashboard.glance.goal.closest', 'Your closest of {n} goals.', { n: fmt(goal.activeCount) })
    : null;

  return (
    <FocalHero
      figure={<Figure
        value={<>{fmt(pct)}<span className="text-muted-foreground" style={{ fontSize: '0.6em' }}>%</span></>}
        caption={tFallback('dashboard.glance.goal.caption', 'Goal')}
      />}
      headline={headline}
      detail={detail}
    >
      <Visual label={[headline, `${pct}%`, target].filter(Boolean).join(' ')}>
        <Bar pct={goal.progress} played={played} thick />
        {target && <span className={`${ROW_VALUE} self-end`}>{target}</span>}
      </Visual>
    </FocalHero>
  );
}

// ── Pattern ──────────────────────────────────────────────────────────────

// 2026-01-05 was a Monday: a fixed week to name the days in the user's
// language without a locale bundle.
const weekdayDate = (i) => new Date(2026, 0, 5 + i, 12);

export function PatternFocal({ pattern, active }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const fmtDate = useDateFormatter();
  const played = usePlayed(active);
  const reduce = useReducedMotion();
  const k = useContext(TrendTimeScale) || 1;
  const longDay = (i) => fmtDate(weekdayDate(i), { weekday: 'long' });
  const shortDay = (i) => fmtDate(weekdayDate(i), { weekday: 'short' }).replace(/\.$/, '');
  const narrowDay = (i) => fmtDate(weekdayDate(i), { weekday: 'narrow' });
  const max = Math.max(...pattern.counts, 1);
  const top = pattern.topDays;

  const headline = top.length === 2
    ? tFallback('dashboard.glance.pattern.twoDays', '{a} and {b} are your most trained days.', { a: longDay(top[0]), b: longDay(top[1]) })
    : top.length === 1
      ? tFallback('dashboard.glance.pattern.oneDay', '{day} is your most trained day.', { day: longDay(top[0]) })
      : tFallback('dashboard.glance.pattern.spread', 'You spread your training across the week.');
  const perWeek = fmt(pattern.perWeek);
  let detail;
  if (pattern.usualHour != null) {
    const at = new Date(2026, 0, 5, Math.floor(pattern.usualHour), (pattern.usualHour % 1) * 60);
    detail = tFallback('dashboard.glance.pattern.detailTime', '{n} sessions a week, usually done by {time}.', {
      n: perWeek, time: fmtDate(at, { hour: 'numeric', minute: '2-digit' }),
    });
  } else {
    detail = tFallback('dashboard.glance.pattern.detail', '{n} sessions a week.', { n: perWeek });
  }
  const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  return (
    <FocalHero
      figure={<Figure
        value={top.length ? capital(shortDay(top[0])) : fmt(pattern.perWeek)}
        caption={top.length
          ? tFallback('dashboard.glance.pattern.caption', 'Top day')
          : tFallback('dashboard.glance.pattern.captionPerWeek', 'A week')}
      />}
      headline={capital(headline)}
      detail={detail}
    >
      <div className="flex items-end justify-between gap-2" style={{ height: VISUAL_H }} role="img" aria-label={`${capital(headline)} ${detail}`}>
        {pattern.counts.map((c, i) => {
          const isTop = top.includes(i);
          // Room for the count above and the day under each bar.
          const h = c > 0 ? Math.max(6, (c / max) * (VISUAL_H - 48)) : 2;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <span className={`text-micro tabular-nums ${c ? 'text-muted-foreground' : 'text-transparent'}`}>{fmt(c)}</span>
              <motion.span
                className={`w-full max-w-7 rounded-sm origin-bottom ${isTop ? 'bg-primary' : 'bg-muted-foreground/35'}`}
                style={{ height: h }}
                initial={false}
                animate={{ scaleY: played || reduce ? 1 : 0 }}
                transition={reduce ? { duration: 0 } : { duration: DRAW_S * k, ease: DRAW_EASE, delay: (SETTLE_WAIT_S + i * 0.04) * k }}
              />
              <span className={`text-micro ${isTop ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{narrowDay(i)}</span>
            </div>
          );
        })}
      </div>
    </FocalHero>
  );
}
