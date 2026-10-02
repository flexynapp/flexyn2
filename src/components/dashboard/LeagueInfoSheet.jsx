// src/components/dashboard/LeagueInfoSheet.jsx
//
// "How leagues work": the explainer for the ladder, the Strength Score, the
// weekly race and seasons.
//
// Two separate systems live behind one card and this sheet is where the
// reader learns they are separate (Kegan, 2026-09-30): STRENGTH decides your
// league, TRAINING decides your week. Every number here is read from
// `leagueTiers.js`, which mirrors the server's config, so the sheet cannot
// drift from what `league_apply_strength_placement` and
// `resolve_league_bracket_internal` actually do.
//
// Six tiers, not five: Legend sits above Diamond and is the terminal rank,
// which is worth showing precisely because it is the thing being climbed
// toward.

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Dumbbell } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import {
  TIERS,
  MIN_QUALIFIED_FOR_PRIZE,
  DEMOTE_MARGIN,
  SHIELD_LIFETIME_CAP,
  MAX_LEAGUE_LEVEL,
  levelNumeral,
} from '@/lib/leagueTiers';
import { LeagueTierBadge } from '@/components/leagues/LeagueTierIcon';

const pct = (n) => `${Math.round(n * 100)}%`;

function LadderRow({ tier, isLast }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  return (
    <div className={`flex items-center gap-2 py-2 ${isLast ? '' : 'border-b border-border/50'}`}>
      {/* The tier colour lives here and nowhere else on the sheet, the same
          rule the card and the standings follow, so the four-hue budget holds. */}
      <LeagueTierBadge tier={tier.id} size={32} />
      <span className="text-caption font-bold flex-1 min-w-0 truncate">
        {tFallback(`trophy.seasonTier.${tier.id}`, tier.label)}
      </span>

      <span className="w-16 text-end tabular-nums text-micro font-semibold">
        {tier.strengthFloor > 0
          ? fmt(tier.strengthFloor)
          : <span className="text-muted-foreground font-normal">{tFallback('league.info.start', 'Start')}</span>}
      </span>

      <span className="w-14 text-end tabular-nums text-micro text-muted-foreground font-semibold">
        {pct(tier.prizePct)}
      </span>

      <span className="flex items-center gap-1 w-10 justify-end tabular-nums">
        <Dumbbell className="w-3 h-3 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-micro text-muted-foreground font-semibold">{tier.minWorkouts}</span>
      </span>
    </div>
  );
}

function Rule({ title, body }) {
  return (
    <div>
      <p className="text-caption font-bold">{title}</p>
      <p className="text-caption text-muted-foreground pt-1">{body}</p>
    </div>
  );
}

export default function LeagueInfoSheet({ open, onClose, tierId = 'bronze', level = 1 }) {
  const { tFallback } = useLanguage();
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

          {/* ── The ladder ─────────────────────────────────────────── */}
          <div className="pt-6">
            <p className="kicker">
              {tFallback('league.info.ladder', 'The ladder')}
            </p>
            <div className="flex items-center gap-2 pt-2 pb-1 border-b border-border">
              <span className="w-6 shrink-0" />
              <span className="text-micro text-muted-foreground flex-1">
                {tFallback('league.info.colTier', 'Tier')}
              </span>
              <span className="text-micro text-muted-foreground w-16 text-end">
                {tFallback('league.info.colStrength', 'Strength')}
              </span>
              <span className="text-micro text-muted-foreground w-14 text-end">
                {tFallback('league.info.colPrize', 'Prize')}
              </span>
              <span className="text-micro text-muted-foreground w-10 text-end">
                {tFallback('league.info.colDays', 'Days')}
              </span>
            </div>
            {TIERS.map((t, i) => (
              <LadderRow key={t.id} tier={t} isLast={i === TIERS.length - 1} />
            ))}
            <p className="text-micro text-muted-foreground pt-2">
              {tFallback(
                'league.info.ladderNoteStrength',
                'Strength is the score a league starts at. Prize is the share of qualified people who win the full reward each week. Days is how many separate days you need to train to be ranked.',
              )}
            </p>
          </div>

          {/* ── The rules ──────────────────────────────────────────── */}
          <div className="pt-6 flex flex-col gap-6">
            <Rule
              title={tFallback('league.info.startTitle', 'Where you start')}
              body={tFallback(
                'league.info.startBody',
                'You get your first league when you finish your first workout. Until you have a Strength Score, your onboarding answers pick it, up to Silver. Your first real score then replaces that guess, up or down.',
              )}
            />
            <Rule
              title={tFallback('league.info.scoreTitle', 'Your Strength Score')}
              body={tFallback(
                'league.info.scoreBodyAll',
                'We read your presses, squats and deadlifts from the last 90 days, barbell, dumbbell, machine or push-ups, and turn each into a barbell equivalent. The total is compared to your bodyweight and adjusted for age from 40 and under 23, so lifters of every size and age compete fairly. Each lift counts at your second best session, so one great day or one typo cannot place you.',
              )}
            />
            <Rule
              title={tFallback('league.info.moveTitle', 'Moving between leagues')}
              body={tFallback(
                'league.info.moveBody',
                'Your first score places you straight into the league it earns. After that you move one league per Monday: up when your score reaches the next league, down only when it falls {margin} below your own. A Shield blocks one drop, and you can own {cap} in total.',
                { margin: pct(1 - DEMOTE_MARGIN), cap: SHIELD_LIFETIME_CAP },
              )}
            />
            <Rule
              title={tFallback('league.info.restTitle', 'Time off never drops you')}
              body={tFallback(
                'league.info.restBody',
                'If there is no score to read, because you have not lifted in 90 days or have no bodyweight saved, you keep your league until there is.',
              )}
            />
            <Rule
              title={tFallback('league.info.raceTitle', 'The weekly race')}
              body={tFallback(
                'league.info.raceBody',
                'Every Monday you join a bracket of up to 30 people. You are ranked by days trained, then XP. Once {n} people qualify, the top of the bracket wins the full reward for their league and everyone else who trained wins a quarter of it. The race pays out but never moves your league.',
                { n: MIN_QUALIFIED_FOR_PRIZE },
              )}
            />
            <Rule
              title={tFallback('league.info.mixedTitle', 'Small leagues share a bracket')}
              body={tFallback(
                'league.info.mixedBody',
                'When too few people in your league are training that week, you race in the nearest bracket instead. You still play for your own league’s reward.',
              )}
            />
            <Rule
              title={tFallback('league.info.seasonTitle', 'Seasons last 28 days')}
              body={tFallback(
                'league.info.seasonBodyStrength',
                'Four weeks to one season. Qualify in any two of them and you keep a permanent title and trophy for the highest league you reached. A new season does not move your league.',
              )}
            />
            <Rule
              title={tFallback('league.info.legendTitle', 'Legend is the end of the ladder')}
              body={tFallback(
                'league.info.legendBody',
                'There is nothing above it, so Legend plays a season-long board instead. Whoever tops it when the season ends takes a champion trophy minted once and never issued again.',
              )}
            />
          </div>

          {/* ── Levels ─────────────────────────────────────────────
              Drawn in the reader's own league, with their current level
              marked, so the rule is shown rather than described. Last,
              after the weekly race it depends on: it sat between the
              ladder and the Strength Score that explains the ladder. */}
          <div className="pt-6">
            <p className="text-caption font-bold">
              {tFallback('league.info.levelsTitle', 'Four levels in every league')}
            </p>
            <p className="text-caption text-muted-foreground pt-1">
              {tFallback(
                'league.info.levelsBody',
                'Every week you qualify adds a level, up to IV. Moving to another league starts you at I again. Levels show how long you have held your league and do not change your bracket.',
              )}
            </p>
            <div className="flex justify-between pt-2">
              {Array.from({ length: MAX_LEAGUE_LEVEL }, (_, i) => i + 1).map((lv) => (
                <div key={lv} className="flex flex-col items-center gap-1">
                  <LeagueTierBadge tier={tierId} level={lv} size={48} />
                  <span
                    className={`text-micro tabular-nums ${lv === level ? 'font-bold text-foreground' : 'text-muted-foreground'}`}
                    aria-current={lv === level ? 'true' : undefined}
                  >
                    {levelNumeral(lv)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
