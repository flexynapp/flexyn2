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
import { Trophy } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { db } from '@/api/db';
import { ACHIEVEMENT_DEFINITIONS } from '@/lib/achievementDefinitions';
import { requestOpenAchievements } from '@/lib/achievementsFlow';

const MAX_BADGES = 6;

// Build a lookup map once at module load — O(1) match for each row.
const DEF_BY_ID = ACHIEVEMENT_DEFINITIONS.reduce((acc, def) => {
  acc[def.achievement_id] = def;
  return acc;
}, {});

function Badge({ row, onTap, tappable }) {
  const def = DEF_BY_ID[row.achievement_id];
  const icon = def?.icon || '🏆';
  const name = def?.nameKey || row.name || row.achievement_id;

  return (
    <button
      onClick={tappable ? onTap : undefined}
      disabled={!tappable}
      className={[
        'shrink-0 flex flex-col items-center gap-1 w-16',
        tappable ? 'cursor-pointer' : 'cursor-default',
      ].join(' ')}
      aria-label={`Achievement: ${name}`}
    >
      <div
        className={[
          'w-12 h-12 rounded-xl flex items-center justify-center text-xl',
          'bg-gradient-to-br from-amber-500/15 via-amber-500/8 to-transparent',
          'border border-amber-500/30',
          tappable ? 'transition-transform hover:scale-105' : '',
        ].join(' ')}
      >
        <span aria-hidden="true">{icon}</span>
      </div>
      <span className="text-xs text-muted-foreground text-center leading-tight line-clamp-2 max-w-[60px]">
        {/* Display name: prefer definition i18n key (Best for client
            lookup), fall back to denormalized row name, then to the
            achievement_id itself as a last-resort label. */}
        {def ? row.name || row.achievement_id : name}
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
      try {
        const list = await db.entities.Achievement.filter(
          userId ? { user_id: userId } : { created_by: userEmail },
          '-unlocked_at',
          MAX_BADGES,
        );
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
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
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-amber-500">
            {tFallback('profileBadges.title', 'Recent badges')}
          </span>
        </div>
        {isOwn && rows.length >= MAX_BADGES && (
          <button
            onClick={requestOpenAchievements}
            className="text-xs font-semibold text-muted-foreground hover:text-primary transition-colors"
          >
            {tFallback('profileBadges.viewAll', 'See all')}
          </button>
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
