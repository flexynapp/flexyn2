// src/components/dashboard/ReadinessCard.jsx
//
// Composite "Readiness Score" 0-100 combining last night's sleep
// (S6), today's mood (S7), days-since-last-workout, and the
// workoutFatigue signal. Pure-client composition over the data we
// already collect — no new tables.
//
// Drives a single daily decision: hit it hard / maintain / deload /
// rest. Replaces vibes-based "should I go to the gym" with a
// number the user can trust.

import React from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useReadiness } from '@/hooks/useReadiness';
import useCountUp from '@/hooks/useCountUp';
import ReadinessRing, { readinessColors } from '@/components/dashboard/ReadinessRing';

// The palette moved to ReadinessRing, which is now its only renderer and
// is also imported by the readiness sheet (board 02 puts the same dial in
// its header). Two components reading one map beats two copies drifting.

// Each label maps to its English fallback + an i18n key that the
// render path looks up via tFallback. Stored at module scope (rather
// than hardcoded inline at the render site) so translators only need
// to mirror this one map — but the lookup happens inside the
// component so the user's language always wins.
export const ACTION_BY_LABEL = {
  Primed:   { key: 'readiness.action.Primed',   fallback: 'Hit it hard. Take a PR shot.' },
  Ready:    { key: 'readiness.action.Ready',    fallback: 'Train as planned.' },
  Moderate: { key: 'readiness.action.Moderate', fallback: 'Train, cap intensity. Leave 1-2 in reserve.' },
  Tired:    { key: 'readiness.action.Tired',    fallback: 'Light cardio or mobility today.' },
  Depleted: { key: 'readiness.action.Depleted', fallback: 'Take a rest day. Sleep + protein.' },
};

export default function ReadinessCard({ logs = [], compact = false, onClick }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();

  // Shared score source — the same hook feeds the Dashboard readiness
  // explainer, so the number here and the breakdown there never drift.
  const { score, label, breakdown } = useReadiness(logs);
  // Sleep and mood/soreness carry 85% of the score. With neither logged,
  // every input sits on its neutral default and the "score" is 70 for
  // everyone, a brand new account included: a green "Ready" measured from
  // nothing. So the card shows no number until one of them exists, and asks
  // for the signal instead. The sheet it opens is where they are logged.
  const scored = !!(breakdown?.sleep?.logged || breakdown?.soreness?.logged);
  // The ring already sweeps from empty (ReadinessRing); the number inside it
  // now counts up alongside so the two arrive together. 800ms matches the
  // ring's own sweep. Reduced motion returns the score as is.
  const counted = useCountUp(score, { duration: 800 });
  const shownScore = typeof counted === 'number' ? Math.round(counted) : counted;

  // readinessColors() carries the unmapped-label fallback that used to
  // live here; safeLabel is still needed for ACTION_BY_LABEL below.
  const colors = scored
    ? readinessColors(label)
    : { bg: 'bg-card', border: 'border-border', text: 'text-muted-foreground', ring: 'hsl(var(--muted-foreground))' };
  const safeLabel = ACTION_BY_LABEL[label] ? label : 'Ready';
  // Pull key + fallback from the map (i18n at render time) rather than
  // building the key inline. The map is the single source of truth
  // for both the i18n key the translator needs to write and the
  // English fallback the en-locale user sees.
  const action = scored
    ? tFallback(ACTION_BY_LABEL[safeLabel].key, ACTION_BY_LABEL[safeLabel].fallback)
    : tFallback('today.readiness.unscored', 'Log last night\'s sleep to get a score.');
  const labelText = scored
    ? tFallback(`readiness.label.${safeLabel.toLowerCase()}`, safeLabel)
    : tFallback('today.readiness.unscoredLabel', 'Not scored');
  const scoreText = scored ? shownScore : '—';

  // Ring geometry — the arc itself is ReadinessRing now.
  const SIZE = compact ? 28 : 64;
  const STROKE = compact ? 3 : 6;

  if (!user?.id) return null;

  // Wraps the card in a button when an onClick is provided so users
  // get keyboard focus + the proper affordance. Default is a static div.
  const Wrapper = onClick ? 'button' : 'div';
  const wrapperProps = onClick
    ? {
        type: 'button',
        onClick,
        'aria-label': tFallback('readiness.openLabel', 'Readiness. Tap for details'),
      }
    : {};

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="h-full"
      >
        <Card
          // Tint the top accent strip with the readiness status colour
          // (green / amber / orange / rose) instead of the app's orange
          // primary, so it matches the card rather than clashing with it.
          style={{ '--card-accent': scored ? `${colors.ring}73` : 'transparent' }}
          className={`px-2 py-1 border ${colors.border} ${colors.bg} h-full flex flex-col items-center justify-center gap-0.5 ${onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
          // Compact mode hides the action copy — surface it as a
          // tooltip + aria-label so screen readers + hover users still
          // get the context behind the bare score number.
          title={scored
            ? `${tFallback('readiness.kicker', 'READINESS')} ${score}. ${action}`
            : action}
          {...(onClick ? { role: 'button', tabIndex: 0, onClick, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } } : {})}
        >
          <ReadinessRing score={scored ? score : 0} color={colors.ring} size={SIZE} stroke={STROKE}>
            <span className="font-heading font-black text-xs tabular-nums">{scoreText}</span>
          </ReadinessRing>
          <span className={`text-micro font-bold tracking-[0.04em] ${colors.text} leading-none`}>
            {tFallback('readiness.kicker', 'READINESS')}
          </span>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <Wrapper
        {...wrapperProps}
        className={`block w-full text-start ${onClick ? 'cursor-pointer hover:opacity-95 transition-opacity' : ''}`}
      >
      <Card style={{ '--card-accent': scored ? `${colors.ring}73` : 'transparent' }} className={`px-4 py-3 border ${colors.border} ${colors.bg}`}>
        <div className="flex items-center gap-3">
          <ReadinessRing score={scored ? score : 0} color={colors.ring} size={SIZE} stroke={STROKE}>
            <span className="font-heading font-black text-base tabular-nums">{scoreText}</span>
          </ReadinessRing>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Activity className={`w-3.5 h-3.5 ${colors.text}`} aria-hidden="true" />
              <span className={`text-micro font-bold tracking-[0.04em] ${colors.text}`}>
                {tFallback('readiness.kicker', 'READINESS')}
              </span>
              <span className={`text-sm font-heading font-bold ${colors.text}`}>{labelText}</span>
            </div>
            <p className="text-xs text-foreground leading-snug mt-0.5">
              {action}
            </p>
          </div>
        </div>
      </Card>
      </Wrapper>
    </motion.div>
  );
}
