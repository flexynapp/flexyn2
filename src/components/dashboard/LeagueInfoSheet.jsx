// src/components/dashboard/LeagueInfoSheet.jsx
//
// "How leagues work" — the explainer for the ladder, qualification, seasons
// and inactivity.
//
// This exists because the standings screen states the RULES OF THIS WEEK
// ("0 qualified — 5 needed before anyone moves") without ever stating the
// system. A user reading that line has no way to learn what Bronze is worth,
// what it takes to leave it, or what happens if they take a week off. Every
// number here is read from `leagueTiers.js`, which mirrors the resolver's
// config, so the card cannot drift from what the server actually does — the
// failure mode that had the old standings header promising "Top 10 promoted"
// in a bracket of six.
//
// Six tiers, not five: Legend sits above Diamond and is the terminal rank,
// which is worth showing precisely because it is the thing being climbed
// toward.

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowUp, ArrowDown, Dumbbell } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import {
  TIERS,
  MIN_QUALIFIED_TO_MOVE,
  DECAY_GRACE_WEEKS,
  SHIELD_LIFETIME_CAP,
} from '@/lib/leagueTiers';
import { LeagueTierBadge } from '@/components/leagues/LeagueTierIcon';

const pct = (n) => `${Math.round(n * 100)}%`;

function LadderRow({ tier, isLast }) {
  const { tFallback } = useLanguage();
  return (
    <div className={`flex items-center gap-2 py-2 ${isLast ? '' : 'border-b border-border/50'}`}>
      {/* The tier colour lives here and nowhere else on the sheet — same rule
          the card and the standings follow, so the four-hue budget holds. */}
      <LeagueTierBadge tier={tier.id} size={24} />
      <span className="text-caption font-bold flex-1 min-w-0 truncate">
        {tFallback(`trophy.seasonTier.${tier.id}`, tier.label)}
      </span>

      <span className="flex items-center gap-1 w-16 justify-end tabular-nums">
        {tier.promotePct > 0 ? (
          <>
            <ArrowUp className="w-3 h-3 text-success shrink-0" aria-hidden="true" />
            <span className="text-micro text-success font-semibold">{pct(tier.promotePct)}</span>
          </>
        ) : (
          <span className="text-micro text-muted-foreground">
            {tFallback('league.info.terminal', 'Top')}
          </span>
        )}
      </span>

      <span className="flex items-center gap-1 w-16 justify-end tabular-nums">
        {tier.demotePct > 0 ? (
          <>
            <ArrowDown className="w-3 h-3 text-destructive shrink-0" aria-hidden="true" />
            <span className="text-micro text-destructive font-semibold">{pct(tier.demotePct)}</span>
          </>
        ) : (
          <span className="text-micro text-muted-foreground">
            {tFallback('league.info.floor', 'Floor')}
          </span>
        )}
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

export default function LeagueInfoSheet({ open, onClose }) {
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
              'league.info.intro',
              'Every Monday you join a bracket of up to 30 people at your tier. You are ranked by the XP you earn that week.',
            )}
          </p>

          {/* ── The ladder ─────────────────────────────────────────── */}
          <div className="pt-6">
            <p className="text-micro font-bold uppercase tracking-widest text-muted-foreground">
              {tFallback('league.info.ladder', 'The ladder')}
            </p>
            <div className="flex items-center gap-2 pt-2 pb-1 border-b border-border">
              <span className="w-6 shrink-0" />
              <span className="text-micro text-muted-foreground flex-1">
                {tFallback('league.info.colTier', 'Tier')}
              </span>
              <span className="text-micro text-muted-foreground w-16 text-end">
                {tFallback('league.info.colUp', 'Promote')}
              </span>
              <span className="text-micro text-muted-foreground w-16 text-end">
                {tFallback('league.info.colDown', 'Drop')}
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
                'league.info.ladderNote',
                'Percentages are of the people who qualified that week. Not of the whole bracket. Days is how many you need to train to be ranked at all.',
              )}
            </p>
          </div>

          {/* ── The rules ──────────────────────────────────────────── */}
          <div className="pt-6 flex flex-col gap-6">
            <Rule
              title={tFallback('league.info.qualifyTitle', 'Training is what ranks you')}
              body={tFallback(
                'league.info.qualifyBody',
                'XP alone is not enough. Train on the number of separate days your tier asks for, and strength or cardio both count. Miss that and you finish Unranked, earn nothing, and cannot be promoted no matter how much XP you have.',
              )}
            />
            <Rule
              title={tFallback('league.info.bracketTitle', 'Small brackets hold')}
              body={tFallback(
                'league.info.bracketBody',
                'If fewer than {n} people qualify, nobody moves up or down that week. Everyone keeps their tier and qualified members still get a payout.',
                { n: MIN_QUALIFIED_TO_MOVE },
              )}
            />
            <Rule
              title={tFallback('league.info.seasonTitle', 'Seasons last 28 days')}
              body={tFallback(
                'league.info.seasonBody',
                'Four weeks to one season. Qualify in any two of them and you keep a permanent title and trophy for the highest tier you reached. Everyone drops one tier when the next season opens, so the climb resets but the trophies do not.',
              )}
            />
            <Rule
              title={tFallback('league.info.quietTitle', 'A rest week costs you nothing')}
              body={tFallback(
                'league.info.quietBody',
                'Miss one week and nothing happens. Miss {grace} and you get a nudge. From the next one you drop a tier per quiet week, down to Bronze. A single workout stops it. A Shield holds one drop, and you can own {cap} in total.',
                { grace: DECAY_GRACE_WEEKS, cap: SHIELD_LIFETIME_CAP },
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
