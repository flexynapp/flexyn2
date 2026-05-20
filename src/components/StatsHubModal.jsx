// src/components/StatsHubModal.jsx
//
// "Stats Hub" — single modal that consolidates the gamification surface:
// level, coins, daily quests, login + workout streaks, weekly league,
// achievements collection, leaderboards, capsules. Opens by tapping the
// LevelBar in the header so users can reach it from any page.

import React, { useEffect, useState } from 'react';
// useNavigate import removed — all nav tiles now use event-dispatch
// helpers (requestOpenBag / requestOpenAchievements) or local state
// (setLeagueOpen, setLeaderboardsOpen, setShopOpen) rather than route
// navigation.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import {
  Trophy, Sparkles, Coins, Package, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import LeagueCard from '@/components/dashboard/LeagueCard';
import DailyQuestsCard from '@/components/dashboard/DailyQuestsCard';
import LoginStreakBanner from '@/components/dashboard/LoginStreakBanner';
import WorkoutStreakBanner from '@/components/dashboard/WorkoutStreakBanner';
import LeagueStandingsModal from '@/components/dashboard/LeagueStandingsModal';
import LeaderboardsModal from '@/components/LeaderboardsModal';
import CoinShopModal from '@/components/hub/CoinShopModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import { requestOpenBag } from '@/lib/inventoryFlow';
import { requestOpenAchievements } from '@/lib/achievementsFlow';
import AvatarUploader from '@/components/AvatarUploader';
import { getLootTitleById } from '@/lib/lootTitles';
import { getLootFrameById } from '@/lib/lootFrames';
import { RARITY } from '@/lib/lootCatalog';

export default function StatsHubModal({ open, onClose }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [leagueOpen, setLeagueOpen] = useState(false);
  const [leaderboardsOpen, setLeaderboardsOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);

  // Live-refresh the showcase when the user equips a new title/frame/theme
  // — without this, the hero would only update on next modal open.
  useEffect(() => {
    const handler = () => qc.invalidateQueries({ queryKey: ['statsHubProfile', user?.id] });
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
  const initials = (profile?.username || user?.username || user?.email || '?')
    .slice(0, 2)
    .toUpperCase();

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
              {tFallback('statsHub.a11yDesc', 'Level, coins, daily quests, league standing, and quick links to leaderboards, achievements, your bag, and the coin shop.')}
            </DialogDescription>
          </VisuallyHidden.Root>

          {/* Hero — avatar (with equipped frame), level, equipped title, coins.
              The avatar + title here close the Steam-style showcase loop:
              cosmetics earned via capsules now render on HubProfile,
              HubPostCard, AND in this Stats Hub. Radix DialogContent
              ships its own close X — we don't add a second one. */}
          <div className="relative bg-gradient-to-br from-primary via-fuchsia-500 to-violet-500 px-5 pt-5 pb-6 text-white">
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 mb-3">
              {tFallback('statsHub.title', 'Your stats')}
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
                        className="text-[11px] font-bold uppercase tracking-wider truncate"
                        style={{ color: titleRarity?.color || 'white' }}
                      >
                        {equippedTitle.name}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs opacity-80 mt-1">
                      {(levelInfo.xpInLevel || 0).toLocaleString()} / {(levelInfo.xpNeeded || 0).toLocaleString()} XP
                    </p>
                  )}
                </div>
              </div>
              {/* Coins */}
              <div className="text-right shrink-0">
                <div className="flex items-center gap-1.5 justify-end">
                  <Coins className="w-4 h-4" />
                  <span className="font-heading font-bold text-2xl tabular-nums">{coins.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => setShopOpen(true)}
                  className="mt-1 text-[11px] underline underline-offset-2 opacity-90 hover:opacity-100"
                >
                  {tFallback('statsHub.openShop', 'Open shop')}
                </button>
              </div>
            </div>
            {/* XP progress bar — always shown, even when title is displayed
                (title replaced the inline XP text but the bar is still useful). */}
            <div className="mt-4">
              {equippedTitle && (
                <p className="text-[10px] opacity-80 mb-1">
                  {(levelInfo.xpInLevel || 0).toLocaleString()} / {(levelInfo.xpNeeded || 0).toLocaleString()} XP
                </p>
              )}
              <div className="h-2 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-white"
                  style={{ width: `${Math.min(100, levelInfo.progressPercent || 0)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="p-4 space-y-4">
            {/* Streaks */}
            <ErrorBoundary label="StatsHub.Streaks">
              <div className="space-y-2">
                <LoginStreakBanner />
                <WorkoutStreakBanner />
              </div>
            </ErrorBoundary>

            {/* League */}
            <ErrorBoundary label="StatsHub.League">
              <LeagueCard onClick={() => { onClose(); setLeagueOpen(true); }} />
            </ErrorBoundary>

            {/* Daily Quests — clicking a quest closes the modal and routes
                to the page where the quest can be completed. */}
            <ErrorBoundary label="StatsHub.Quests">
              <DailyQuestsCard onNavigated={onClose} />
            </ErrorBoundary>

            {/* Quick links — destinations handle their own opening:
                  - Leaderboards: in-modal LeaderboardsModal
                  - Achievements: fires OPEN_ACHIEVEMENTS_EVENT —
                                  ProfileMenu opens AchievementsVault
                                  globally (works from any route).
                                  Previously navigated to
                                  /progress?tab=achievements before the
                                  surface moved off Progress.
                  - Bag: fires OPEN_BAG_EVENT — Layout's useBagFlow opens
                         the bag globally (works from any route)
                  - Coin Shop: in-modal CoinShopModal */}
            <div className="grid grid-cols-2 gap-2">
              {/* Replace-not-stack pattern: clicking these closes the Stats
                  Hub first via onClose(), then opens the target so users
                  see only the destination instead of two stacked modals. */}
              <NavTile
                icon={Trophy}
                label={tFallback('statsHub.leaderboards', 'Leaderboards')}
                onClick={() => { onClose(); setLeaderboardsOpen(true); }}
              />
              <NavTile
                icon={Sparkles}
                label={tFallback('statsHub.achievements', 'Achievements')}
                onClick={() => { onClose(); requestOpenAchievements(); }}
              />
              <NavTile
                icon={Package}
                label={tFallback('statsHub.bag', 'Bag & Capsules')}
                onClick={() => { onClose(); requestOpenBag(); }}
              />
              <NavTile
                icon={Coins}
                label={tFallback('statsHub.shop', 'Coin Shop')}
                onClick={() => { onClose(); setShopOpen(true); }}
              />
            </div>
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

function NavTile({ icon: Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-2.5 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-secondary/50 transition-colors text-left min-w-0"
    >
      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <span className="flex-1 min-w-0 text-sm font-medium leading-tight break-words">{label}</span>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
}
