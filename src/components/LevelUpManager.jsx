import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useSettings } from '@/lib/SettingsContext';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import LevelUpOverlay from '@/components/LevelUpOverlay';
import * as capsules from '@/lib/data/capsules';
import { reportError } from '@/lib/reportError';
import { CAPSULE_GLYPH } from '@/lib/lootCatalog';

// Capsule glyph per type. These land inside toast TITLE strings, so they
// have to be text — the drawn capsule (CapsuleIcon) can't go here. Single
// source of truth is lootCatalog so the Bag and a toast can't disagree.
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
    //
    // localStorage is written in .then(), NOT before the call. This branch is
    // the ONLY thing that ever grants the welcome capsule, and it is gated on
    // "no baseline on this device" — so writing the baseline first burns the
    // one shot whether or not the grant landed. A user who was offline, or
    // whose token was mid-refresh, lost their welcome capsule permanently:
    // the branch never runs again on that device, and a console.warn is
    // invisible in production.
    //
    // That is not hypothetical. It is exactly why migration 278 had to exist
    // — a one-time backfill for every user the grant had silently failed for
    // — and 278's head comment names this write as the reason the loss could
    // not self-heal. Migration 277 fixed the server side; this is the client
    // half that was left behind.
    //
    // The level-up branch below already does it this way, with the same
    // reasoning spelled out. grant_welcome_capsule is idempotent server-side
    // (it checks the marker under a row lock), so retrying on the next mount
    // is safe and cheap.
    if (lastSeenLevel === null || Number.isNaN(lastSeenLevel)) {
      lastFiredForRef.current = currentLevel;
      // Grant a starter capsule if the user has never received one.
      capsules
        .grantWelcomeCapsule(userProfile.id, user.email)
        .then(() => {
          try { localStorage.setItem(storageKey, String(currentLevel)); } catch {}
          queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
          queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
        })
        .catch((err) => {
          // Leave localStorage unwritten so the next mount retries, and roll
          // the in-session flag back so a re-render this session retries too.
          lastFiredForRef.current = null;
          reportError(err, {
            feature: 'capsules.welcome-grant',
            level: 'warning',
            userEmail: user.email,
          });
        });
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

    // 2. Grant capsule(s) and Flex Coins — gate localStorage on
    //    SUCCESS so a failed grant doesn't permanently advance the
    //    "last seen level" baseline. The previous version updated
    //    localStorage immediately; if grantForLevelUp threw, the user
    //    saw the overlay but no capsule and next mount didn't retry.
    //    Migration 070's RPC is idempotent (tracks awarded_through
    //    server-side), so a retry on the next render is safe.
    //
    //    Lock the in-session fire flag immediately so we don't double-
    //    fire WITHIN this session, but only persist to localStorage
    //    after the server confirms the grant. The flag resets on
    //    refresh, so a failed grant + page reload will retry the
    //    grant — the RPC will return already_granted if the previous
    //    attempt happened to land server-side anyway.
    lastFiredForRef.current = currentLevel;
    capsules
      .grantForLevelUp(userProfile.id, user.email, currentLevel)
      .then(() => {
        try { localStorage.setItem(storageKey, String(currentLevel)); } catch {}
        queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
        queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
        queryClient.invalidateQueries({ queryKey: ['userInventory', user.email] });
        queryClient.invalidateQueries({ queryKey: ['userProfile', user.email] });
      })
      .catch((err) => {
        reportError(err, {
          feature: 'capsules.level-up-grant',
          level: 'warning',
          userEmail: user.email,
        });
        // Roll the in-session flag back so the next render attempts
        // again. localStorage stays at the OLD level so a refresh
        // also retries.
        lastFiredForRef.current = lastSeenLevel;
      });
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
      const emoji = CAPSULE_GLYPH[type] || CAPSULE_GLYPH.standard;
      const label = CAPSULE_LABEL[type] || 'Capsule';
      // Tailor the subtitle by source so the message lands. The
      // welcome-source case is load-bearing for day-0 retention —
      // this is the moment a new user learns the loot economy exists.
      let subtitle = 'Open it in your Bag to see what dropped.';
      let title    = `${emoji} ${label} earned!`;
      if (source === 'achievement_milestone' && threshold) {
        subtitle = `${threshold} achievements unlocked — open it in your Bag!`;
      } else if (source === 'welcome') {
        title    = `${emoji} Welcome gift — your first capsule!`;
        subtitle = 'Tap your profile → My Bag to open it and see what dropped.';
      } else if (source === 'first_workout') {
        title    = `${emoji} First workout reward — Premium Capsule!`;
        subtitle = 'You showed up. Open this one in your Bag — premium tier drops better loot.';
      }
      toast.success(title, { description: subtitle, duration: 6000 });
      // Refresh the bag's capsule count so the badge updates immediately.
      queryClient.invalidateQueries({ queryKey: ['userCapsules', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user?.email] });
    };
    window.addEventListener('flexyn:capsule-granted', handler);
    return () => window.removeEventListener('flexyn:capsule-granted', handler);
  }, [queryClient, user?.email]);

  // Stable identity. The overlay holds this in a ref so an inline arrow no
  // longer restarts its auto-dismiss timer, but this component re-renders
  // on every profile refetch and a fresh callback per render is the kind of
  // thing the next effect to depend on it will trip over too.
  const dismiss = useCallback(() => setEvent(null), []);

  return <LevelUpOverlay event={event} onDismiss={dismiss} />;
}
