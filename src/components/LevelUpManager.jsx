import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useSettings } from '@/lib/SettingsContext';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import LevelUpOverlay from '@/components/LevelUpOverlay';
import * as capsules from '@/lib/data/capsules';

// Capsule emoji per type — kept in sync with CAPSULE_META in UserBag.
const CAPSULE_EMOJI = { standard: '📦', premium: '🎁', elite: '💠' };
const CAPSULE_LABEL = { standard: 'Standard Capsule', premium: 'Premium Capsule', elite: 'Elite Capsule' };

/**
 * Watches the authenticated user's total_xp and shows LevelUpOverlay when —
 * and only when — the user crosses a level boundary during this session.
 * Also grants capsules and Flex Coins on genuine level-up.
 */
const STORAGE_PREFIX = 'fn-last-seen-level:';

export default function LevelUpManager() {
  const { user } = useAuth();
  const { levelAnimationsEnabled } = useSettings();
  const queryClient = useQueryClient();

  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });

  const [event, setEvent] = useState(null);
  const lastFiredForRef = useRef(null);

  useEffect(() => {
    if (!user?.email) return;
    if (!userProfile || !userProfile.id) return;

    const totalXp = Number(userProfile.total_xp) || 0;
    const currentLevel = calculateLevelFromXp(totalXp).level;
    const storageKey = `${STORAGE_PREFIX}${user.email}`;

    let lastSeenLevel = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) lastSeenLevel = Number(raw);
    } catch {}

    // First time on this device — baseline silently, then ensure welcome capsule.
    if (lastSeenLevel === null || Number.isNaN(lastSeenLevel)) {
      try { localStorage.setItem(storageKey, String(currentLevel)); } catch {}
      lastFiredForRef.current = currentLevel;
      // Grant a starter capsule if the user has never received one.
      capsules
        .grantWelcomeCapsule(userProfile.id, user.email)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
          queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
        })
        .catch((err) => console.warn('[LevelUpManager] welcome capsule grant failed:', err));
      return;
    }

    // Account reset — re-baseline silently.
    if (currentLevel < lastSeenLevel) {
      try { localStorage.setItem(storageKey, String(currentLevel)); } catch {}
      lastFiredForRef.current = currentLevel;
      return;
    }

    if (currentLevel === lastSeenLevel) return;

    // Guard against double-fire within one session.
    if (lastFiredForRef.current === currentLevel) {
      try { localStorage.setItem(storageKey, String(currentLevel)); } catch {}
      return;
    }

    // ── Genuine level-up ──────────────────────────────────────────────────────
    // 1. Show the level-up overlay (if animations enabled)
    if (levelAnimationsEnabled) {
      setEvent({ fromLevel: lastSeenLevel, toLevel: currentLevel, totalXp });
    }

    // 2. Grant capsule(s) and Flex Coins in the background
    capsules
      .grantForLevelUp(userProfile.id, user.email, currentLevel)
      .then(() => {
        // Invalidate so UserBag + capsule count badges refresh
        queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
        queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
        queryClient.invalidateQueries({ queryKey: ['userInventory', user.email] });
        queryClient.invalidateQueries({ queryKey: ['userProfile', user.email] });
      })
      .catch((err) => console.warn('[LevelUpManager] capsule grant failed:', err));

    lastFiredForRef.current = currentLevel;
    try { localStorage.setItem(storageKey, String(currentLevel)); } catch {}
  }, [
    user?.email,
    userProfile?.id,
    userProfile?.total_xp,
    levelAnimationsEnabled,
  ]);

  // Listen for capsule grants from anywhere (achievement milestones, future
  // sources like quest bundles, etc.) and surface a toast. Centralized here
  // because LevelUpManager is already mounted globally + already handles
  // capsule-related celebration UI.
  useEffect(() => {
    const handler = (e) => {
      const { type, source, threshold } = e.detail || {};
      if (!type) return;
      const emoji = CAPSULE_EMOJI[type] || '🎁';
      const label = CAPSULE_LABEL[type] || 'Capsule';
      const subtitle =
        source === 'achievement_milestone' && threshold
          ? `${threshold} achievements unlocked — open it in your Bag!`
          : 'Open it in your Bag to see what dropped.';
      toast.success(`${emoji} ${label} earned!`, { description: subtitle, duration: 4500 });
      // Refresh the bag's capsule count so the badge updates immediately.
      queryClient.invalidateQueries({ queryKey: ['userCapsules', user?.email] });
    };
    window.addEventListener('flexyn:capsule-granted', handler);
    return () => window.removeEventListener('flexyn:capsule-granted', handler);
  }, [queryClient, user?.email]);

  return <LevelUpOverlay event={event} onDismiss={() => setEvent(null)} />;
}
