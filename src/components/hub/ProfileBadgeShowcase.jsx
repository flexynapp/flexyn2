// src/components/hub/ProfileBadgeShowcase.jsx
//
// Horizontal showcase of a user's most recently unlocked achievements,
// rendered on the Hub profile. Reads from the existing achievements
// table (no schema change). Joins the user's unlocked rows against
// ACHIEVEMENT_DEFINITIONS for the canonical name + icon — falls back
// to the row's denormalized `name` field if a definition is missing
// (legacy rows from before the definition list froze).
//
// VIEWER MODES
// ────────────
//   Own profile  → showcase is visible. Tapping opens AchievementsVault
//                  for the full grid + active progress.
//   Friend's     → showcase is visible (read-only). Tap does nothing
//                  — viewing someone else's achievements panel would
//                  require server-side access policies that don't
//                  exist yet, and a noop tap is better UX than a 403.
//
// CAPACITY
// ────────
// 6 badges max in the rail. The user might have dozens; we show the
// most-recently-unlocked first because those are the freshest "look
// what I did" moments worth flexing.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useLanguage } from '@/lib/LanguageContext';
import { getTrophy, TROPHY_TIERS } from '@/lib/trophyDefinitions';
import { listEarned } from '@/lib/data/trophies';
import { requestOpenAchievements } from '@/lib/achievementsFlow';

const MAX_BADGES = 6;

function Badge({ row, onTap, tappable }) {
  // getTrophy resolves catalog rungs, generated ladder tails
  // (`sessions_x2`) and league season trophies alike, so the rail shows
  // whatever the user actually holds.
  const trophy = getTrophy(row.trophy_id);
  const icon = trophy?.emoji || '🏆';
  const name = trophy?.name || row.trophy_id;
  const tierMeta = trophy ? (TROPHY_TIERS[trophy.tier] || TROPHY_TIERS.bronze) : null;

  return (
    <button
      onClick={tappable ? onTap : undefined}
      disabled={!tappable}
      className={[
        'shrink-0 flex flex-col items-center gap-1.5 w-16',
        tappable ? 'cursor-pointer' : 'cursor-default',
      ].join(' ')}
      aria-label={`Achievement: ${name}`}
    >
      {/* Plain fill, no border, no gradient — matching the trophy grid in
          ProfileTrophies so badges and trophies read as one collection
          language rather than two competing treatments. */}
      <div
        className={[
          'relative w-14 h-14 rounded-xl flex items-center justify-center text-2xl bg-secondary/40 overflow-hidden',
          tappable ? 'transition-transform hover:scale-105' : '',
        ].join(' ')}
      >
        <span aria-hidden="true">{icon}</span>
        {/* Same 2px tier stripe the trophy grid uses, so the rail and the
            grid read as one collection language rather than two. */}
        {tierMeta && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0"
            style={{ height: 2, background: tierMeta.color }}
          />
        )}
      </div>
      <span className="text-xs text-muted-foreground text-center leading-tight line-clamp-2 max-w-[60px]">
        {name}
      </span>
    </button>
  );
}

export default function ProfileBadgeShowcase({ userEmail, userId, isOwn }) {
  const { tFallback } = useLanguage();

  // Prefer user_id: server-granted achievements (mig 189) stamp
  // created_by='' for guests, so an email-only filter hides a guest's
  // badges. Email stays as the fallback for callers that only know the
  // email (deep-linked profiles before the profile row resolves).
  const { data: rows = [] } = useQuery({
    queryKey: ['profileBadges', userId ?? userEmail],
    queryFn: async () => {
      if (!userId && !userEmail) return [];
      // listEarned already returns newest-first; take the freshest few.
      const list = await listEarned(userId || userEmail, !userId);
      return (Array.isArray(list) ? list : []).slice(0, MAX_BADGES);
    },
    enabled: !!(userId || userEmail),
    staleTime: 60_000,
  });

  // Hide entirely when there's nothing to flex — an empty badge tray
  // is worse than no tray at all (it advertises an unfinished section).
  if (rows.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-4"
    >
      {/* Section label matches the rest of the profile — muted uppercase,
          not amber. The amber was competing with the trophy section for
          "this is the gold one" when they sit two tabs apart. */}
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {tFallback('profileBadges.title', 'Recent badges')}
        </span>
        {isOwn && rows.length >= MAX_BADGES ? (
          <button
            onClick={requestOpenAchievements}
            className="text-xs font-semibold text-muted-foreground hover:text-primary active:text-primary transition-colors"
          >
            {tFallback('profileBadges.viewAll', 'See all')}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">{rows.length}</span>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 px-1 -mx-1 scrollbar-hide">
        {rows.map((row) => (
          <Badge
            key={row.id}
            row={row}
            tappable={!!isOwn}
            onTap={requestOpenAchievements}
          />
        ))}
      </div>
    </motion.div>
  );
}
