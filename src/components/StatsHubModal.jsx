// src/components/StatsHubModal.jsx
//
// "Stats Hub" — single modal that consolidates the gamification surface:
// level, coins, daily quests, login + workout streaks, weekly league,
// achievements collection, leaderboards, capsules. Opens by tapping the
// LevelBar in the header so users can reach it from any page.

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import {
  Trophy, Sparkles, Coins, Package, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import LeagueCard from '@/components/dashboard/LeagueCard';
import DailyQuestsCard from '@/components/dashboard/DailyQuestsCard';
import LoginStreakBanner from '@/components/dashboard/LoginStreakBanner';
import WorkoutStreakBanner from '@/components/dashboard/WorkoutStreakBanner';
import LeagueStandingsModal from '@/components/dashboard/LeagueStandingsModal';
import LeaderboardsModal from '@/components/LeaderboardsModal';
import CoinShopModal from '@/components/hub/CoinShopModal';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function StatsHubModal({ open, onClose }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const navigate = useNavigate();
  const [leagueOpen, setLeagueOpen] = useState(false);
  const [leaderboardsOpen, setLeaderboardsOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ['statsHubProfile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('user_profiles')
        .select('total_xp, flex_coins, login_streak, workout_streak, longest_workout_streak')
        .eq('id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user?.id && open,
    staleTime: 15_000,
  });

  const totalXp = profile?.total_xp || 0;
  const levelInfo = calculateLevelFromXp(totalXp);
  const coins = profile?.flex_coins || 0;

  const handleNavigate = (path) => {
    onClose();
    setTimeout(() => navigate(path), 150);
  };

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

          {/* Hero — level + coins. Radix DialogContent ships its own close X
              in the corner; we don't add a second one. */}
          <div className="relative bg-gradient-to-br from-primary via-fuchsia-500 to-violet-500 px-5 pt-5 pb-6 text-white">
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 mb-1">
              {tFallback('statsHub.title', 'Your stats')}
            </p>
            <div className="flex items-end justify-between">
              <div>
                <p className="font-heading font-black text-5xl leading-none drop-shadow">
                  {tFallback('levelBar.level', 'Lv').replace('{n}', '').trim() || 'Lv'} {levelInfo.level}
                </p>
                <p className="text-xs opacity-80 mt-1">
                  {(levelInfo.xpInLevel || 0).toLocaleString()} / {(levelInfo.xpNeeded || 0).toLocaleString()} XP
                </p>
              </div>
              <div className="text-right">
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
            {/* XP progress bar */}
            <div className="mt-4 h-2 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full bg-white"
                style={{ width: `${Math.min(100, levelInfo.progressPercent || 0)}%` }}
              />
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
                  - Achievements: navigate to /progress?tab=achievements
                                  (Progress.jsx reads ?tab= and selects it)
                  - Bag: navigate to /hub?bag=open (Hub reads ?bag= and opens)
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
                onClick={() => handleNavigate('/progress?tab=achievements')}
              />
              <NavTile
                icon={Package}
                label={tFallback('statsHub.bag', 'Bag & Capsules')}
                onClick={() => handleNavigate('/hub?bag=open')}
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
