// src/components/StatsHubModal.jsx
//
// "Stats Hub" — single modal that consolidates the gamification surface:
// level, coins, leaderboards, weekly league, daily quests. Opens by
// tapping the LevelBar in the header so users can reach it from any page.
//
// Scope was deliberately narrowed: the streak banners and the
// Achievements / Bag & Capsules / Coin Shop nav tiles were removed. Those
// destinations all have their own homes in ProfileMenu, and duplicating
// them here made the modal a second navigation menu rather than a stats
// view. The header's coin balance keeps its shop entry — the one that
// belongs on a stats surface — and IS it: the balance itself is the
// button, rather than the underlined 11px text link it shipped as.

import React, { useEffect, useState } from 'react';
// useNavigate import removed — the remaining destinations use local state
// (setLeagueOpen, setLeaderboardsOpen, setShopOpen) rather than route
// navigation.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import {
  Trophy, ChevronRight,
} from 'lucide-react';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import LeagueCard from '@/components/dashboard/LeagueCard';
import DailyQuestsCard from '@/components/dashboard/DailyQuestsCard';
import LeagueStandingsModal from '@/components/dashboard/LeagueStandingsModal';
import LeaderboardsModal from '@/components/LeaderboardsModal';
import CoinShopModal from '@/components/hub/CoinShopModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import AvatarUploader from '@/components/AvatarUploader';
import prefersReducedMotion from '@/lib/reducedMotion';
import { getLootTitleById } from '@/lib/lootTitles';
import { getLootFrameById } from '@/lib/lootFrames';
import { RARITY } from '@/lib/lootCatalog';

export default function StatsHubModal({ open, onClose }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmtNum = useNumberFormatter();
  const qc = useQueryClient();
  const [leagueOpen, setLeagueOpen] = useState(false);
  const [leaderboardsOpen, setLeaderboardsOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);

  // Open a nested modal only AFTER the parent Dialog finishes its
  // exit animation. Without this, both modals briefly overlap at the
  // same z-index for ~150ms — backdrops stack, focus ping-pongs, and
  // the parent's close transition reads as a flicker on top of the
  // child. Radix Dialog exit defaults to ~150ms; 180 gives a margin.
  const openNested = (setOpen) => {
    onClose();
    setTimeout(() => setOpen(true), 180);
  };

  // Live-refresh the showcase when the user equips a new title/frame/theme
  // — without this, the hero would only update on next modal open.
  // Pin the userId at effect time so a sign-out / account switch between
  // event registration and dispatch doesn't invalidate a stale
  // user.id's query (or — worse — the new user's query keyed off the
  // previous user's id).
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return undefined;
    const handler = () => qc.invalidateQueries({ queryKey: ['statsHubProfile', userId] });
    window.addEventListener('flexyn:loot-equipped', handler);
    window.addEventListener('flexyn:theme-changed', handler);
    return () => {
      window.removeEventListener('flexyn:loot-equipped', handler);
      window.removeEventListener('flexyn:theme-changed', handler);
    };
  }, [qc, user?.id]);

  const { data: profile } = useQuery({
    queryKey: ['statsHubProfile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await safeSelect({
        columns: [
          'total_xp', 'flex_coins', 'login_streak', 'workout_streak',
          'longest_workout_streak', 'equipped_title_id', 'equipped_frame_id',
          'avatar_url', 'username',
        ],
        build: (cols) => supabase
          .from('user_profiles')
          .select(cols)
          .eq('id', user.id)
          .maybeSingle(),
      });
      return data;
    },
    enabled: !!user?.id && open,
    staleTime: 15_000,
    // Surface read failures so a regression in user_profiles RLS
    // doesn't silently leave the modal half-rendered with stale data.
    onError: (err) => {
      import('@/lib/reportError').then(({ reportError }) => {
        reportError(err, { feature: 'statsHub.profileFetch', level: 'warning', userId: user?.id });
      }).catch(() => {});
    },
  });

  const totalXp = profile?.total_xp || 0;
  const levelInfo = calculateLevelFromXp(totalXp);
  const coins = profile?.flex_coins || 0;

  // Equipped cosmetics — render in the hero so the Stats Hub feels like a
  // "show off" surface, closing the loop with HubProfile + HubPostCard
  // which already render them. Falls back to useAuth().user if the query
  // hasn't returned yet so the first paint isn't bare.
  const equippedTitleId = profile?.equipped_title_id || user?.equipped_title_id || null;
  const equippedFrameId = profile?.equipped_frame_id || user?.equipped_frame_id || null;
  const equippedTitle = equippedTitleId ? getLootTitleById(equippedTitleId) : null;
  const equippedFrame = equippedFrameId ? getLootFrameById(equippedFrameId) : null;
  const titleRarity = equippedTitle ? (RARITY[equippedTitle.rarity] ?? RARITY.common) : null;
  const avatarUrl = profile?.avatar_url || user?.avatar_url || null;
  // Strip whitespace before slicing — a username like " kegan" would
  // otherwise render initials " K" (a leading space + K) which looks
  // like a one-letter avatar with extra padding. Default to '?' if
  // everything trims to empty.
  const initialsSource = (profile?.username || user?.username || user?.email || '').trim();
  const initials = (initialsSource ? initialsSource.slice(0, 2) : '?').toUpperCase();

  // The XP rail fills from 0 each time the modal opens, the same way
  // ProfileTierBanner's does — a progress bar that arrives already at its
  // width has no way of telling you it IS a progress bar. Reset on close so
  // reopening replays it rather than snapping.
  const progressPercent = Math.min(100, levelInfo.progressPercent || 0);
  const reduceMotion = prefersReducedMotion();
  const [railWidth, setRailWidth] = useState(0);
  useEffect(() => {
    if (!open) { setRailWidth(0); return undefined; }
    if (reduceMotion) { setRailWidth(progressPercent); return undefined; }
    const id = requestAnimationFrame(() => setRailWidth(progressPercent));
    return () => cancelAnimationFrame(id);
  }, [open, progressPercent, reduceMotion]);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg w-[calc(100vw-1rem)] max-h-[92vh] overflow-y-auto p-0 gap-0">
          {/* Visually-hidden DialogTitle + Description for screen readers.
              Radix logs an a11y warning otherwise. The visual hero below
              already shows the title, so we don't repeat it visibly. */}
          <VisuallyHidden.Root>
            <DialogTitle>{tFallback('statsHub.title', 'Your stats')}</DialogTitle>
            <DialogDescription>
              {tFallback('statsHub.a11yDesc', 'Level, coins, leaderboards, league standing, and daily quests.')}
            </DialogDescription>
          </VisuallyHidden.Root>

          {/* Hero — avatar (with equipped frame), level, equipped title, coins.
              The avatar + title here close the Steam-style showcase loop:
              cosmetics earned via capsules now render on HubProfile,
              HubPostCard, AND in this Stats Hub. Radix DialogContent
              ships its own close X — we don't add a second one. */}
          <div className="relative bg-gradient-to-br from-primary via-fuchsia-500 to-violet-500 level-card-aurora px-5 pt-5 pb-6 text-white">
            {/* The eyebrow names the HERO, which is the level lockup — not
                the modal, which also holds leaderboards, league and quests.
                The screen-reader DialogTitle above keeps the modal's own
                name for that reason. */}
            <p className="text-micro uppercase tracking-[0.2em] font-bold opacity-80 mb-3">
              {tFallback('statsHub.levelEyebrow', 'Your level')}
            </p>
            <div className="flex items-start justify-between gap-3">
              {/* Avatar + level + title */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0">
                  <AvatarUploader
                    src={avatarUrl}
                    initials={initials}
                    editable={false}
                    size={64}
                    frameCss={equippedFrame?.css}
                    frameAnimation={equippedFrame?.animation}
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-heading font-black text-4xl leading-none drop-shadow">
                    {tFallback('levelBar.level', 'Lv').replace('{n}', '').trim() || 'Lv'} {levelInfo.level}
                  </p>
                  {equippedTitle ? (
                    <div className="flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full bg-white/15 backdrop-blur w-fit max-w-full">
                      <span className="text-sm leading-none shrink-0">{equippedTitle.emoji}</span>
                      <span
                        className="text-micro font-bold uppercase tracking-wider truncate"
                        style={{ color: titleRarity?.color || 'white' }}
                      >
                        {equippedTitle.name}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs opacity-80 mt-1">
                      {fmtNum(levelInfo.xpInLevel || 0)} / {fmtNum(levelInfo.xpNeeded || 0)} XP
                    </p>
                  )}
                </div>
              </div>
              {/* Coins — balance AND shop entry, one control.
                  It shipped as a balance with an 11px underlined "Open shop"
                  link beneath it: two elements stacked in the narrowest
                  column of the row, competing with the equipped title for
                  width, and an underline is what you reach for when you
                  can't afford a button. Tapping your balance to go buy more
                  is what every game with a currency does, so the balance IS
                  the button — one element, a real 44px target, and the
                  column no longer needs to be tall enough for two things.

                  White pill with a pinned dark number: the hero gradient
                  runs fuchsia to violet, where white on translucent white
                  lands around 2.6:1. Same treatment as the level-up card's
                  Continue button, so "solid action on a coloured surface"
                  means one thing across the app. */}
              <button
                onClick={() => setShopOpen(true)}
                aria-label={tFallback('statsHub.balanceShop', '{n} Flex Coins. Open shop.').replace('{n}', fmtNum(coins))}
                className="group relative shrink-0 h-11 inline-flex items-center"
              >
                {/* 44px tap box, smaller visible pill inside — the same shape
                    Header.jsx uses for its icon buttons, so the thumb target
                    doesn't dictate how heavy the control looks. */}
                <span className="inline-flex items-center gap-1.5 h-9 ps-2 pe-1.5 rounded-full bg-white/95 group-hover:bg-white group-active:bg-white shadow-md transition-colors">
                  <FlexCoinIcon size={20} />
                  <span className="font-heading font-bold text-lg tabular-nums leading-none text-slate-900">{fmtNum(coins)}</span>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                </span>
              </button>
            </div>
            {/* XP progress bar — always shown, even when title is displayed
                (title replaced the inline XP text but the bar is still useful). */}
            <div className="mt-4">
              {equippedTitle && (
                <p className="text-micro opacity-80 mb-1">
                  {fmtNum(levelInfo.xpInLevel || 0)} / {fmtNum(levelInfo.xpNeeded || 0)} XP
                </p>
              )}
              <div className="h-2 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-white rounded-full"
                  style={{
                    width: `${railWidth}%`,
                    transition: reduceMotion ? undefined : 'width 0.7s cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="p-4 space-y-4">
            {/* Leaderboards — first, and full width.
                This modal is the only working way into the global boards:
                LevelBar's own tooltip carried a Leaderboards CTA but was
                unreachable dead code (removed), and the Hub /leaderboards
                tab its header comment advertised was never wired. It used
                to sit fourth, as one of four equal tiles below streaks,
                league and quests. "Level 4 compared to whom?" is the
                question the level badge provokes, and this modal is what
                the badge opens — so the answer goes at the top. */}
            <ErrorBoundary label="StatsHub.Leaderboards">
              <button
                onClick={() => openNested(setLeaderboardsOpen)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-amber-500/10 via-fuchsia-500/10 to-cyan-500/10 level-card-aurora hover:from-amber-500/15 hover:via-fuchsia-500/15 hover:to-cyan-500/15 border border-border/60 transition-colors text-start"
              >
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 via-fuchsia-500 to-cyan-500 level-card-aurora flex items-center justify-center shrink-0 shadow-md">
                  <Trophy className="w-4 h-4 text-white drop-shadow" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-heading font-bold leading-tight">
                    {tFallback('statsHub.leaderboards', 'Leaderboards')}
                  </p>
                  <p className="text-micro text-muted-foreground leading-tight mt-0.5">
                    {tFallback('leaderboards.subtitle', 'See where you stand globally')}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              </button>
            </ErrorBoundary>

            {/* League */}
            <ErrorBoundary label="StatsHub.League">
              <LeagueCard onClick={() => openNested(setLeagueOpen)} />
            </ErrorBoundary>

            {/* Daily Quests — clicking a quest closes the modal and routes
                to the page where the quest can be completed. */}
            <ErrorBoundary label="StatsHub.Quests">
              <DailyQuestsCard onNavigated={onClose} />
            </ErrorBoundary>
          </div>
        </DialogContent>
      </Dialog>

      {/* Nested modals — rendered outside the main dialog so backdrop layers stack right */}
      <LeagueStandingsModal open={leagueOpen} onClose={() => setLeagueOpen(false)} />
      <LeaderboardsModal open={leaderboardsOpen} onClose={() => setLeaderboardsOpen(false)} />
      <CoinShopModal open={shopOpen} onClose={() => setShopOpen(false)} />
    </>
  );
}
