// src/components/dashboard/SeasonCeremonyModal.jsx
//
// The season-end ceremony. Fires once, on first open after a season rolls
// (migration 312), for anyone who cleared the two-week bar.
//
// This is the only moment the league hands out something permanent, so it is
// the only moment that earns a full sheet instead of a toast. Composition
// follows Penpot board C — "League seasons — slots to draw" — with one
// deliberate departure noted below.
//
// WHY THERE IS NO COIN LINE
// ─────────────────────────
// The Penpot mock shows "Flex coins +900" in the receipt. The season does not
// pay coins and should not: weekly resolution already does that, and the whole
// argument for the season reward is that it is status rather than currency
// (Duolingo's Diamond Tournament pays only a profile medal and it is the most
// chased thing in that product). Showing a coin line the server never grants
// would be a lie in the one place the user is being told what they own. The
// receipt lists what award_league_season_internal actually writes: a trophy, a
// title, and a capsule on gold and above.
//
// DESIGN NOTES
// ────────────
// • Tier colour appears ONLY on the trophy plate. The four-hue budget holds
//   everywhere else on the sheet.
// • Two spacing registers, per CLAUDE.md: gap-2 inside a group, gap-6 between
//   groups. Nothing in between.
// • Hairline divider, no shadows, no gradient. A ceremony is the surface that
//   most invites glassmorphism and a coloured glow; both are on the published
//   list of generated-UI tells.
// • The trophy plate is the same geometry for every season — numeral plus tier
//   colourway — so a new season needs no new artwork, and a profile carrying
//   four of them reads as a history.

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { getTier } from '@/lib/leagueTiers';
import LeagueTierIcon from '@/components/leagues/LeagueTierIcon';

/**
 * The plate. One geometry, two variables: the season numeral and the tier
 * colourway. The champion variant swaps the numeral for a ringed "1" and
 * carries a heavier border — it is the only thing on the sheet allowed to
 * look different, because it is the only thing that is.
 */
function TrophyPlate({ seasonNumber, tier, isChampion, tierColor }) {
  const size = isChampion ? 'w-24 h-24' : 'w-[72px] h-[72px]';
  return (
    <div
      className={`${size} shrink-0 rounded-lg bg-muted relative overflow-hidden flex flex-col items-center justify-center`}
      style={{ boxShadow: `inset 0 0 0 ${isChampion ? 2 : 1}px ${tierColor}` }}
      aria-hidden="true"
    >
      {isChampion ? (
        <>
          <span
            className="w-11 h-11 rounded-full flex items-center justify-center font-heading font-bold text-xl"
            style={{ boxShadow: `inset 0 0 0 2px ${tierColor}`, color: tierColor }}
          >
            1
          </span>
          <span className="text-micro font-bold text-muted-foreground mt-1 tracking-wide">
            S{seasonNumber}
          </span>
        </>
      ) : (
        <>
          <span className="font-heading font-bold text-2xl" style={{ color: tierColor }}>
            S{seasonNumber}
          </span>
          {/* Was the raw tier id in capitals ("DIAMOND" in every language).
              The tier's mark says it without a word to translate. */}
          <LeagueTierIcon tier={tier} className="w-8 h-8 mt-0.5" />
        </>
      )}
      <span
        className="absolute inset-x-0 bottom-0"
        style={{ height: isChampion ? 4 : 3, backgroundColor: tierColor }}
      />
    </div>
  );
}

function ReceiptRow({ label, value, hue }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={hue ? { backgroundColor: hue } : undefined}
        // No inline colour means the muted default, which is what an
        // unremarkable line should get.
        aria-hidden="true"
      />
      <span className="text-caption flex-1 min-w-0 truncate">{label}</span>
      <span className="text-caption font-bold tabular-nums text-end">{value}</span>
    </div>
  );
}

/**
 * @param {object}   props
 * @param {boolean}  props.open
 * @param {Function} props.onClose
 * @param {object}   props.result — from leagueSeasons.getLastSeasonResult()
 * @param {Function} [props.onOpenTrophyCase]
 */
export default function SeasonCeremonyModal({ open, onClose, result, onOpenTrophyCase }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();

  if (!open || !result) return null;

  const {
    seasonNumber, tier, weeksQualified, seasonXp, isChampion, capsule,
  } = result;

  const tierMeta = getTier(tier);
  const tierColor = tierMeta.color;
  const tierLabel = tFallback(`trophy.seasonTier.${tier}`, tierMeta.label);
  // The same two strings the trophy catalog already carries — a season trophy
  // IS this ceremony's outcome, so they must not be worded twice.
  const titleName = isChampion
    ? tFallback('trophy.season.champion.name', 'Champion, S{n}', { n: seasonNumber })
    : tFallback('trophy.season.tier.name', 'Season {n} {tier}', { n: seasonNumber, tier: tierLabel });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="px-6 pt-6 pb-6">
          {/* ── Result ────────────────────────────────────────────── */}
          <DialogHeader className="space-y-0 text-start">
            <p
              className="text-micro font-bold uppercase tracking-widest"
              style={isChampion ? { color: tierColor } : undefined}
            >
              <span className={isChampion ? '' : 'text-muted-foreground'}>
                {isChampion
                  ? tFallback('league.ceremony.championEyebrow', 'Season {n} · Legend', { n: seasonNumber })
                  : tFallback('league.ceremony.eyebrow', 'Season {n} complete', { n: seasonNumber })}
              </span>
            </p>
            <DialogTitle className="font-heading font-bold text-2xl leading-tight pt-2">
              {isChampion
                ? tFallback('league.ceremony.champion', 'Champion')
                : tFallback('league.ceremony.finished', 'You finished {tier}', { tier: tierLabel })}
            </DialogTitle>
          </DialogHeader>

          <p className="text-caption text-muted-foreground pt-2">
            {isChampion
              ? tFallback('league.ceremony.championSub',
                  'First across the Legend season board · {xp} XP', { xp: fmt(seasonXp) })
              : tFallback('league.ceremony.sub',
                  'Best tier held across 4 weeks · qualified {n} of 4', { n: weeksQualified })}
          </p>

          {/* ── The mark ──────────────────────────────────────────── */}
          <div className="flex items-start gap-2 pt-6">
            <TrophyPlate
              seasonNumber={seasonNumber}
              tier={tier}
              isChampion={isChampion}
              tierColor={tierColor}
            />
            <div className="flex-1 min-w-0 pt-1">
              <p className="font-heading font-bold text-sm">{titleName}</p>
              <p className="text-caption text-muted-foreground pt-1">
                {isChampion
                  ? tFallback('league.ceremony.championNote',
                      'One per season, forever. Nobody else can earn this one.')
                  : tFallback('league.ceremony.note',
                      'Permanent. Pin it to your profile from the trophy case.')}
              </p>
            </div>
          </div>

          {/* ── Receipt ───────────────────────────────────────────── */}
          <div className="pt-6">
            <div className="border-t border-border pt-2" />
            <p className="text-micro font-bold uppercase tracking-widest text-muted-foreground">
              {tFallback('league.ceremony.alsoEarned', 'Also earned')}
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <ReceiptRow
                label={tFallback('league.ceremony.trophy', 'Trophy')}
                value={titleName}
                hue={tierColor}
              />
              <ReceiptRow
                label={tFallback('league.ceremony.title', 'Profile title')}
                value={`“${titleName}”`}
              />
              {capsule && (
                <ReceiptRow
                  label={tFallback('league.ceremony.capsule', 'Capsule')}
                  value={tFallback('league.ceremony.capsuleQty', '{kind} ×1', {
                    kind: capsule.charAt(0).toUpperCase() + capsule.slice(1),
                  })}
                />
              )}
            </div>
          </div>

          {/* ── Out ───────────────────────────────────────────────────
              One button. DialogContent already renders an X, and the sibling
              LeagueStandingsModal dismisses on that alone — a second "Close"
              under the CTA reads as indecision about which one to press. */}
          <div className="pt-6">
            <Button
              className="w-full h-11"
              onClick={() => {
                onClose();
                onOpenTrophyCase?.();
              }}
            >
              {tFallback('league.ceremony.cta', 'Open trophy case')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
