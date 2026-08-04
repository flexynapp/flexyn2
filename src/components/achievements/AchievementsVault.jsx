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
import { db } from '@/api/db';
import { ChevronLeft, Trophy } from 'lucide-react';
import AchievementsTab from '@/components/progress/AchievementsTab';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// The OPEN_ACHIEVEMENTS_EVENT constant + requestOpenAchievements helper
// live in src/lib/achievementsFlow.js so callers can import the
// lightweight event name without pulling in this whole component
// (which would defeat ProfileMenu's lazy() chunking).

export default function AchievementsVault({ onClose }) {
  const { user } = useAuth();
  useBodyScrollLock(true);
  // user_id, not created_by: server-granted achievements (mig 189) stamp
  // created_by='' for guests — the email filter hid them from the vault.
  const { data: achievements = [] } = useQuery({
    queryKey: ['achievements', user?.id],
    queryFn: () => db.entities.Achievement.filter({ user_id: user.id }),
    enabled: !!user?.id,
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
          Back
        </button>
        <div className="flex items-center gap-1.5">
          <Trophy className="w-4 h-4 text-yellow-500" />
          <span className="font-heading font-bold text-base">Achievements</span>
        </div>
        <div className="w-16" />
      </div>

      {/* Body — reuse the existing inline AchievementsTab. It
          already handles category tabs, locked/unlocked split,
          and empty states. */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <AchievementsTab achievements={achievements} />
      </div>
    </motion.div>,
    document.body,
  );
}
