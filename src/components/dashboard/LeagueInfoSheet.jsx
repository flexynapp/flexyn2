// src/components/dashboard/LeagueInfoSheet.jsx
//
// "How leagues work": the explainer for the ladder, the Strength Score, the
// weekly race and seasons.
//
// Two separate systems live behind one card and this sheet is where the
// reader learns they are separate (Kegan, 2026-09-30): STRENGTH decides your
// league, TRAINING decides your week. Since 2026-10-02 that split IS the
// layout: one tab per system, so a reader sees only the half they asked
// about. Each rule is a figure and one line (FigureRow) rather than a
// paragraph, the ladder shows where the reader stands on it, and the edge
// cases sit in a collapsed Fine print. The sheet used to be 475 words.
//
// Every number here is read from `leagueTiers.js`, which mirrors the
// server's config, so the sheet cannot drift from what
// `league_apply_strength_placement` and `resolve_league_bracket_internal`
// actually do.
//
// Six tiers, not five: Legend sits above Diamond and is the terminal rank,
// which is worth showing precisely because it is the thing being climbed
// toward.

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Scale, ArrowUp, PauseCircle, ChevronDown, Trophy } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import {
  TIERS,
  MIN_QUALIFIED_FOR_PRIZE,
  MAX_LEAGUE_SIZE,
  DEMOTE_MARGIN,
  SHIELD_LIFETIME_CAP,
  MAX_LEAGUE_LEVEL,
  getTier,
  nextTier,
  levelNumeral,
} from '@/lib/leagueTiers';
import { LeagueTierBadge } from '@/components/leagues/LeagueTierIcon';
import FigureRow, { FigureRows } from '@/components/ui/FigureRow';

const pct = (n) => Math.round(n * 100);

// Seasons are four weekly brackets and two qualified weeks keep the title
// (league_season_stats, migration 312). Drawn, not computed: this is the
// rule, not the reader's own season.
const SEASON_WEEKS = 4;
const SEASON_WEEKS_TO_KEEP = 2;

function Tabs({ value, onChange, options }) {
  return (
    <div role="tablist" className="flex rounded-lg bg-secondary p-1">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`flex-1 rounded-sm py-1.5 text-caption font-semibold transition-colors ${
            value === id ? 'bg-background text-foreground' : 'text-muted-foreground'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function FinePrint({ children }) {
  const { tFallback } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-h-[44px] items-center justify-between text-caption font-semibold text-muted-foreground"
      >
        {tFallback('league.info.finePrint', 'Fine print')}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && <div className="flex flex-col gap-2 text-caption text-muted-foreground">{children}</div>}
    </div>
  );
}

// The ladder, top down, with the reader marked on it. Their own row is the
// only one at full strength; the rest recede so the eye lands on "you".
function Ladder({ tierId, score }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const mine = tierId ? getTier(tierId) : null;
  const next = mine ? nextTier(mine.id) : null;
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const span = next && mine ? next.strengthFloor - mine.strengthFloor : 0;
  const into = hasScore && mine ? Math.max(0, Math.min(span, score - mine.strengthFloor)) : 0;

  return (
    <div className="pt-4">
      <div className="flex flex-col">
        {[...TIERS].reverse().map((t) => {
          const isMine = mine?.id === t.id;
          return (
            <div key={t.id} className={`flex items-center gap-2 py-1 ${mine && !isMine ? 'opacity-70' : ''}`}>
              <span className="w-9 flex justify-center shrink-0">
                <LeagueTierBadge tier={t.id} size={isMine ? 36 : 28} />
              </span>
              <span className={`flex-1 min-w-0 truncate text-caption ${isMine ? 'font-bold' : 'font-semibold'}`}>
                {tFallback(`trophy.seasonTier.${t.id}`, t.label)}
              </span>
              {isMine && (
                <span className="shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 text-micro font-bold text-primary tabular-nums">
                  {hasScore
                    ? tFallback('league.info.youScore', 'You · {n}', { n: fmt(Math.round(score)) })
                    : tFallback('league.info.you', 'You')}
                </span>
              )}
              <span className="w-12 shrink-0 text-end tabular-nums text-micro text-muted-foreground">
                {t.strengthFloor > 0 ? fmt(t.strengthFloor) : tFallback('league.info.start', 'Start')}
              </span>
            </div>
          );
        })}
      </div>
      {hasScore && next && span > 0 && (
        <div className="pt-2">
          <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(into / span) * 100}%` }} />
          </div>
          <p className="pt-1 text-micro text-muted-foreground">
            {tFallback('league.info.toNext', '{n} to {tier}', {
              n: fmt(Math.max(0, Math.ceil(next.strengthFloor - score))),
              tier: tFallback(`trophy.seasonTier.${next.id}`, next.label),
            })}
          </p>
        </div>
      )}
    </div>
  );
}

function LeagueTab({ tierId, score }) {
  const { tFallback } = useLanguage();
  return (
    <>
      <Ladder tierId={tierId} score={score} />
      <FigureRows className="mt-4">
        <FigureRow figure="90" unit={tFallback('league.info.daysUnit', 'd')} label={tFallback('league.info.fig.window', 'window')}>
          {tFallback('league.info.row.lifts', 'Presses, squats and deadlifts. Your second best session counts.')}
        </FigureRow>
        <FigureRow icon={Scale} label={tFallback('league.info.fig.fair', 'fair')}>
          {tFallback('league.info.row.fair', 'Scaled to your bodyweight and age.')}
        </FigureRow>
        <FigureRow icon={ArrowUp} label={tFallback('league.info.fig.mondays', 'Mondays')}>
          {tFallback('league.info.row.up', 'Up one league when your score passes the next floor.')}
        </FigureRow>
        <FigureRow figure={`−${pct(1 - DEMOTE_MARGIN)}`} unit="%" label={tFallback('league.info.fig.dropLine', 'drop line')}>
          {tFallback('league.info.row.down', 'Down only below this. A Shield blocks one drop, {cap} in total.', { cap: SHIELD_LIFETIME_CAP })}
        </FigureRow>
        <FigureRow icon={PauseCircle} label={tFallback('league.info.fig.rest', 'rest')}>
          {tFallback('league.info.restTitle', 'Time off never drops you')}
        </FigureRow>
      </FigureRows>
      <FinePrint>
        <p>{tFallback('league.info.fine.convert', 'Dumbbell, machine and push-up sets count too, converted to a barbell equivalent. Age adjusts from 40 and under 23.')}</p>
        <p>{tFallback('league.info.fine.start', 'Your first finished workout places you. With no lifts to score yet, your onboarding answers pick the league, up to Silver.')}</p>
        <p>{tFallback('league.info.fine.legend', 'Legend is the top. It plays a season board, and whoever leads it when the season ends takes a champion trophy minted once.')}</p>
      </FinePrint>
    </>
  );
}

function WeekTab({ tierId, level }) {
  const { tFallback } = useLanguage();
  const tier = getTier(tierId || 'bronze');
  const tierName = tFallback(`trophy.seasonTier.${tier.id}`, tier.label);
  return (
    <>
      <FigureRows className="mt-4">
        <FigureRow figure={tier.minWorkouts} unit={tFallback('league.info.perWeek', '/wk')} label={tFallback('league.info.fig.needs', '{tier} needs', { tier: tierName })}>
          <span className="flex flex-col gap-1">
            <span className="flex gap-1" aria-hidden="true">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i} className={`h-2 w-2 rounded-full ${i < tier.minWorkouts ? 'bg-primary' : 'bg-foreground/15'}`} />
              ))}
            </span>
            {tFallback('league.info.row.days', 'Train on this many separate days to be ranked.')}
          </span>
        </FigureRow>
        <FigureRow figure={MAX_LEAGUE_SIZE} label={tFallback('league.info.fig.bracket', 'per bracket')}>
          {tFallback('league.info.row.rank', 'Ranked by days trained, then XP.')}
        </FigureRow>
        <FigureRow figure={pct(tier.prizePct)} unit="%" label={tFallback('league.info.fig.top', 'top')}>
          {tFallback('league.info.row.prize', 'Win the full reward. Everyone else who trained wins a quarter.')}
        </FigureRow>
        <FigureRow figure={MIN_QUALIFIED_FOR_PRIZE} label={tFallback('league.info.fig.toPay', 'to pay out')}>
          {tFallback('league.info.row.minQualified', 'Prizes start once this many people qualify.')}
        </FigureRow>
        <FigureRow icon={Trophy} label={tFallback('league.info.fig.payOnly', 'pays only')}>
          {tFallback('league.info.row.noMove', 'The race never moves your league.')}
        </FigureRow>
      </FigureRows>

      <p className="pt-6 text-micro font-bold uppercase tracking-widest text-muted-foreground">
        {tFallback('league.info.seasonHead', 'Season · 28 days')}
      </p>
      <div className="pt-2 flex gap-1" aria-hidden="true">
        {Array.from({ length: SEASON_WEEKS }, (_, i) => (
          <span key={i} className={`h-2 flex-1 rounded-full ${i < SEASON_WEEKS_TO_KEEP ? 'bg-success' : 'bg-foreground/15'}`} />
        ))}
      </div>
      <p className="pt-1 text-caption">
        {tFallback('league.info.seasonLine', 'Qualify in 2 of 4 weeks')}{' '}
        <span className="text-muted-foreground">{tFallback('league.info.seasonPrize', 'for a title and trophy')}</span>
      </p>

      {/* Drawn in the reader's own league, with their current level marked,
          so the rule is shown rather than described. */}
      <p className="pt-6 text-micro font-bold uppercase tracking-widest text-muted-foreground">
        {tFallback('league.info.levelsHead', 'Levels · one per week you qualify')}
      </p>
      <div className="flex justify-between pt-2">
        {Array.from({ length: MAX_LEAGUE_LEVEL }, (_, i) => i + 1).map((lv) => (
          <div key={lv} className="flex flex-col items-center gap-1">
            <LeagueTierBadge tier={tier.id} level={lv} size={lv === level ? 48 : 40} />
            <span
              className={`text-micro tabular-nums ${lv === level ? 'font-bold text-foreground' : 'text-muted-foreground'}`}
              aria-current={lv === level ? 'true' : undefined}
            >
              {levelNumeral(lv)}
            </span>
          </div>
        ))}
      </div>

      <FinePrint>
        <p>{tFallback('league.info.fine.mixed', 'Too few people training in your league? You race in the nearest bracket, still for your own league’s reward.')}</p>
        <p>{tFallback('league.info.fine.levels', 'Moving to another league starts you at I again.')}</p>
      </FinePrint>
    </>
  );
}

export default function LeagueInfoSheet({ open, onClose, tierId = 'bronze', level = 1, score = null }) {
  const { tFallback } = useLanguage();
  const [tab, setTab] = useState('league');
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm max-h-[88vh] overflow-y-auto p-0 gap-0">
        <div className="px-5 py-6">
          <DialogHeader className="space-y-0 text-start">
            <DialogTitle className="font-heading font-bold text-xl pe-8">
              {tFallback('league.info.title', 'How leagues work')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-caption text-muted-foreground pt-2">
            {tFallback(
              'league.info.introStrength',
              'Your strength decides your league. Your training decides your week.',
            )}
          </p>
          <div className="pt-4">
            <Tabs
              value={tab}
              onChange={setTab}
              options={[
                ['league', tFallback('league.info.tabLeague', 'Your league')],
                ['week', tFallback('league.info.tabWeek', 'Your week')],
              ]}
            />
          </div>
          {tab === 'league'
            ? <LeagueTab tierId={tierId} score={score} />
            : <WeekTab tierId={tierId} level={level} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
