// src/components/hub/profile/ProfileContestRail.jsx
//
// Live contests, as a row of glass pills across the hero's middle band.
//
// League placement, gym rival and crew war are three different features, but
// to the person looking at them they're one thing: what am I currently in,
// and am I winning it. Rendering them as three differently-shaped widgets
// would be three answers to one question. One family, one row, one read.
//
// Design notes:
//   • Glass rather than solid, so ten different tier gradients show through
//     and the rail belongs to whatever surface it lands on. Same treatment as
//     the streak chip above it — they read as siblings, not neighbours.
//   • In a two-sided contest the LEADING number is white and full weight; the
//     trailing one drops to 55%. Who's ahead should be readable without
//     parsing two numbers and comparing them.
//   • Ahead gets a faint emerald edge. Behind gets nothing — no red, no
//     warning colour. A profile is not the place to be told off.
//   • Each pill is a button. A hero element that shows live state and can't
//     be acted on is a poster; these go to the thing they describe.

import { Trophy, Swords, Shield } from 'lucide-react';
import { formatNumber } from '@/lib/intl';

const GLASS = {
  background: 'rgba(0,0,0,0.26)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
};

const compact = (n, language) =>
  formatNumber(Number(n) || 0, language, { notation: 'compact', maximumFractionDigits: 1 });

/**
 * The hero's glass pill.
 *
 * Exported because the streak pill in ProfileTierBanner has to be exactly the
 * same size and treatment as the league pill it sits under. Sharing the
 * component makes that true by construction — matching it by copying `h-8`
 * and a padding pair into a second file is how two things drift apart the
 * first time either is touched.
 *
 * Renders a <button> when given onClick, a <span> otherwise: the streak isn't
 * a destination, and a button that does nothing is a promise the UI can't keep.
 */
export function HeroPill({ icon: Icon, iconClass, children, onClick, ahead, label }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick } : {})}
      aria-label={label}
      className={`shrink-0 inline-flex items-center gap-1.5 h-8 ps-2.5 pe-3 rounded-full text-white ${
        onClick ? 'transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70' : ''
      }`}
      style={{
        ...GLASS,
        border: `1px solid ${ahead ? 'rgba(52,211,153,0.55)' : 'rgba(255,255,255,0.16)'}`,
        boxShadow: ahead ? '0 0 12px rgba(52,211,153,0.28)' : undefined,
      }}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${iconClass}`} aria-hidden="true" />
      {children}
    </Tag>
  );
}

const Pill = HeroPill;

/** Two scores, with the leading one carrying the emphasis. */
function Versus({ mine, theirs, language }) {
  const iLead = mine >= theirs;
  return (
    <span className="text-xs font-bold tabular-nums leading-none">
      <span style={{ opacity: iLead ? 1 : 0.55 }}>{compact(mine, language)}</span>
      <span className="mx-0.5" style={{ opacity: 0.5 }}>–</span>
      <span style={{ opacity: iLead ? 0.55 : 1 }}>{compact(theirs, language)}</span>
    </span>
  );
}

export default function ProfileContestRail({
  league,
  rival,
  war,
  onOpenLeague,
  onOpenRival,
  onOpenWar,
  language,
  tFallback,
}) {
  const tf = tFallback || ((_k, fb) => fb);
  if (!league && !rival && !war) return null;

  return (
    // In normal flow, not absolutely positioned. The banner stacks this and
    // the streak pill in one column, so the rail no longer owns its own
    // placement — it just lays its pills out in a row.
    <div
      className="flex gap-2 overflow-x-auto scrollbar-hide"
      style={{
        // Can overflow on a narrow phone with all three pills, so it scrolls
        // rather than wrapping — a wrapped second row would push the streak
        // pill down into the avatar, which starts 44px above the hero's edge.
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {league && (
        <Pill
          icon={Trophy}
          iconClass="text-primary"
          onClick={onOpenLeague}
          label={tf('profile.hero.leagueA11y', 'League placement: {r} of {t}')
            .replace('{r}', String(league.rank)).replace('{t}', String(league.total))}
        >
          <span className="text-xs font-bold tabular-nums leading-none">#{league.rank}</span>
          {league.tierLabel && (
            <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ opacity: 0.75 }}>
              {league.tierLabel}
            </span>
          )}
        </Pill>
      )}

      {rival && (
        <Pill
          icon={Swords}
          iconClass="text-primary"
          onClick={onOpenRival}
          ahead={rival.mine > rival.theirs}
          label={tf('profile.hero.rivalA11y', 'Rival: you {a}, them {b}')
            .replace('{a}', String(Math.round(rival.mine))).replace('{b}', String(Math.round(rival.theirs)))}
        >
          <Versus mine={rival.mine} theirs={rival.theirs} language={language} />
        </Pill>
      )}

      {war && (
        <Pill
          icon={Shield}
          iconClass="text-primary"
          onClick={onOpenWar}
          ahead={war.mine > war.theirs}
          label={tf('profile.hero.warA11y', 'Crew war: your crew {a}, theirs {b}')
            .replace('{a}', String(Math.round(war.mine))).replace('{b}', String(Math.round(war.theirs)))}
        >
          <Versus mine={war.mine} theirs={war.theirs} language={language} />
        </Pill>
      )}
    </div>
  );
}
