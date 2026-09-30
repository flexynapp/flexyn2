// The band across the top of a profile: league colour, level and streak.
//
// Kegan's pick, option B "League plate" (2026-09-30), after the athlete
// summary read as bland. The colour is the owner's league, so the plate
// changes as they climb, and a promotion shows on their profile rather
// than only on the standings screen. It is flat on purpose: no gradient,
// no texture, no glow. The one thing that moves is the XP bar along the
// bottom edge, which fills when the page opens.
//
// The colour comes from leagueTiers.js and nowhere else, so a change to a
// tier's colour there reaches this plate too.
//
// Ink is a fixed near-black rather than a theme token. Every league colour
// is a light metal, in light and dark mode alike, and --foreground flips to
// near-white in dark mode, which would put white text on silver.
//
// The level is the number and nothing else. The XP tier name ("Bronze" at
// levels 1 to 9) is a different ladder from Bronze League, and printing the
// two side by side told people they were the same thing.
import { motion, useReducedMotion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { getTier as getLeagueTier, leagueTierName } from '@/lib/leagueTiers';
import LeagueTierIcon from '@/components/leagues/LeagueTierIcon';

const INK = '#17130d';

export default function ProfileLeaguePlate({ leagueId, level, progress, streak, onOpenLeague, t, tFallback, fmtNumber }) {
  const reduce = useReducedMotion();
  const league = leagueId ? getLeagueTier(leagueId) : null;
  const hasLeague = !!league?.id && league.id === leagueId;
  const bg = hasLeague ? league.color : 'hsl(var(--secondary))';
  const ink = hasLeague ? INK : 'hsl(var(--foreground))';
  const pct = Math.max(0, Math.min(1, Number(progress) || 0));

  const Tag = onOpenLeague ? 'button' : 'div';
  return (
    <Tag
      type={onOpenLeague ? 'button' : undefined}
      onClick={onOpenLeague}
      aria-label={onOpenLeague ? tFallback('profile.openLeague', 'Open league standings') : undefined}
      data-testid="profile-league-plate"
      className="block w-auto -mx-4 md:-mx-6 relative overflow-hidden text-start"
      style={{ height: 148, background: bg, color: ink }}
    >
      <div className="absolute inset-x-4 md:inset-x-6 top-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="stamp truncate flex items-center gap-1" style={{ color: ink, opacity: 0.7 }}>
            {hasLeague && <LeagueTierIcon tier={league.id} className="w-3.5 h-3.5 shrink-0" />}
            {hasLeague ? leagueTierName(league, tFallback) : tFallback('league.leagueSuffix', 'League')}
          </p>
          <p className="font-display text-5xl !leading-none mt-1 tabular-nums">
            {t('levelBar.level', { n: level })}
          </p>
        </div>
        {streak > 0 && (
          <div className="text-end shrink-0">
            <p className="stamp" style={{ color: ink, opacity: 0.7 }}>
              {tFallback('profile.streak', 'Streak')}
            </p>
            <p className="font-display text-5xl !leading-none mt-1 inline-flex items-center gap-1 tabular-nums">
              <Flame className="w-8 h-8" strokeWidth={2.5} aria-hidden="true" />
              {fmtNumber(streak)}
            </p>
          </div>
        )}
      </div>
      <div
        className="absolute inset-x-0 bottom-0 h-1.5"
        style={{ background: hasLeague ? 'rgba(23,19,13,0.22)' : 'hsl(var(--border))' }}
        role="progressbar"
        aria-label={tFallback('profile.levelProgress', 'Progress to the next level')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
      >
        <motion.div
          className="h-full"
          style={{ background: hasLeague ? INK : 'hsl(var(--primary))' }}
          initial={{ width: reduce ? `${pct * 100}%` : 0 }}
          animate={{ width: `${pct * 100}%` }}
          transition={reduce ? { duration: 0 } : { duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        />
      </div>
    </Tag>
  );
}
