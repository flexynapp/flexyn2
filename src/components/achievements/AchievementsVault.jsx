// src/components/achievements/AchievementsVault.jsx
//
// Full-screen overlay that hosts the existing AchievementsTab UI.
//
// Achievements used to live as a tab on the Progress page, but the
// Trophy chip looked stranded between Trends / Analytics / Body /
// Photos (which are all numerical / chart-style sections). Moving
// the surface into ProfileMenu — next to Debrief Vault, which is
// the same "your accumulated milestones" mental model — gives the
// feature a stable home and frees up the Progress tab strip for
// data-only sections.
//
// This component:
//   1. Fetches `achievements` itself (deduped via React Query
//      against the existing ['achievements', email] key so other
//      consumers don't double-fetch).
//   2. Renders the existing AchievementsTab inside an overlay
//      that mirrors DebriefVault's frame (back chevron, header
//      strip, safe-area padding).
//
// Lazy-imported by ProfileMenu so its chunk only loads when the
// user actually taps "Achievements" — keeping the entry bundle
// small (same pattern as DebriefVault / InjuryForm).

import React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { ChevronLeft, Trophy } from 'lucide-react';
import AchievementsTab from '@/components/progress/AchievementsTab';
import { listEarned, getProgress, grantEligible } from '@/lib/data/trophies';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useOverlayBackButton } from '@/hooks/useOverlayBackButton';
import { useLanguage } from '@/lib/LanguageContext';

// The OPEN_ACHIEVEMENTS_EVENT constant + requestOpenAchievements helper
// live in src/lib/achievementsFlow.js so callers can import the
// lightweight event name without pulling in this whole component
// (which would defeat ProfileMenu's lazy() chunking).

export default function AchievementsVault({ onClose }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  useBodyScrollLock(true);
  // Back dismisses this sheet rather than navigating the page beneath it.
  // Without it, back changed route while this fixed z-200 portal kept
  // covering the screen, so the app looked stuck on Achievements.
  useOverlayBackButton(true, onClose);

  // Opening the vault is a grant checkpoint. The criteria are evaluated
  // server-side from live stats, so anything earned since the last check
  // lands before the page paints its counts — otherwise you finish a
  // 50th workout, open Achievements to look at the badge, and it isn't
  // there until something else happens to call the RPC.
  //
  // grantEligible() runs first and the trophy list keys off its
  // completion, so the two can't race into showing a stale board.
  const { data: granted } = useQuery({
    queryKey: ['trophyGrant', user?.id],
    queryFn: grantEligible,
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const { data: trophies = [] } = useQuery({
    queryKey: ['trophies', user?.id, granted?.newlyGranted?.length ?? 0],
    queryFn: () => listEarned(user.id),
    enabled: !!user?.id && !!granted,
  });

  const { data: progress = {} } = useQuery({
    queryKey: ['trophyProgress', user?.id],
    queryFn: getProgress,
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 32 }}
      transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      className="fixed inset-0 z-[200] bg-background flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Header — mirrors DebriefVault frame so the two "vault"
          surfaces feel like the same UI family. */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {tFallback('achievements.vault.back', 'Back')}
        </button>
        <div className="flex items-center gap-1.5">
          <Trophy className="w-4 h-4 text-yellow-500" />
          <span className="font-heading font-bold text-base">
            {tFallback('achievements.vault.title', 'Achievements')}
          </span>
        </div>
        <div className="w-16" />
      </div>

      {/* Body — reuse the existing inline AchievementsTab. It
          already handles category tabs, locked/unlocked split,
          and empty states. */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <AchievementsTab trophies={trophies} progress={progress} user={user} />
      </div>
    </motion.div>,
    document.body,
  );
}
