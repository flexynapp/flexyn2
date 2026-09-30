// src/pages/You.jsx
//
// The You tab (navigation redesign, phase 2). It replaces the header's
// profile menu: that menu held eleven destinations behind an avatar, which
// is a hidden tab by another name, and NN/g measured hidden navigation
// being used 57% of the time against 86% for visible navigation.
//
// Everything personal lives here, once: your progress, your food, your
// rewards, your gym, your journal and reviews, injuries, settings. Social
// things (feed, crews, competing, messages) live in Social.
//
// Rows NAVIGATE where the destination is a page and OPEN an overlay where
// it is one. The overlays are owned by ProfileMenu (the account menu on the
// header avatar and the sidebar foot); see profilePanels.js.
//
// The rows are grouped under headings. Eleven rows in five unlabelled boxes
// read as one long list; the headings say what each box is for, and they are
// where the account menu's old rows (Bag, Gym, Journal, Reviews, Injuries,
// Achievements) now live, so they have to be findable at a glance.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, TrendingUp, Apple, ShoppingBag, Trophy, Dumbbell, Book,
  CalendarCheck, ShieldAlert, Backpack, Settings, UserCircle, Building2, LogOut,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/api/db';
import { useLanguage } from '@/lib/LanguageContext';
import { requestOpenJournal } from '@/lib/journalOverlay';
import { requestOpenBag } from '@/lib/inventoryFlow';
import { OPEN_ACHIEVEMENTS_EVENT } from '@/lib/achievementsFlow';
import { requestProfilePanel } from '@/lib/profilePanels';
import { isEnabled } from '@/lib/featureFlags';
import { initialsFor } from '@/lib/initials';
import { handle } from '@/lib/userDisplay';
import LevelBar from '@/components/LevelBar';
import LoginStreakBanner from '@/components/dashboard/LoginStreakBanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import SkinToggle from '@/components/skins/SkinToggle';
import { useSkin } from '@/components/skins/useSkin';
import * as capsules from '@/lib/data/capsules';

function Row({ icon: Icon, label, hint, count = 0, onClick, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full min-h-12 flex items-center gap-2 px-4 py-3 text-start text-body transition-colors hover:bg-secondary active:bg-secondary ${tone === 'danger' ? 'text-destructive' : ''}`}
    >
      <Icon className={`w-5 h-5 shrink-0 ${tone === 'danger' ? '' : 'text-muted-foreground'}`} aria-hidden="true" />
      <span className="flex-1 min-w-0">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-label text-muted-foreground">{hint}</span>}
      </span>
      {count > 0 && (
        <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-micro font-bold flex items-center justify-center tabular-nums shrink-0">
          {count > 9 ? '9+' : count}
        </span>
      )}
      {tone !== 'danger' && <ChevronRight className="w-4 h-4 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />}
    </button>
  );
}

function Group({ title, children }) {
  const box = (
    <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
      {children}
    </div>
  );
  if (!title) return box;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-label font-semibold text-muted-foreground">{title}</h2>
      {box}
    </section>
  );
}

export default function You() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const { skin } = useSkin();
  const name = user?.full_name || handle(user) || tFallback('you.title', 'You');

  // Same query key as the account menu's badge, so this is one request.
  // XP from the profile query, like Progress. AuthContext's user only
  // reloads on sign-in or a token refresh, so after a workout this bar kept
  // the old level for up to an hour.
  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });

  const { data: capsuleCount = 0 } = useQuery({
    queryKey: ['userCapsulesCount', user?.email],
    queryFn: async () => (await capsules.listUnopenedCapsules(user.email)).length,
    enabled: !!user?.email,
    staleTime: 30_000,
  });

  const openAchievements = () => {
    try { window.dispatchEvent(new CustomEvent(OPEN_ACHIEVEMENTS_EVENT)); } catch { /* ignore */ }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 pb-8 flex flex-col gap-6" style={{ paddingTop: 'var(--fluid-pad-y)' }}>
      <button
        type="button"
        onClick={() => navigate('/profile')}
        className="flex items-center gap-2 text-start"
        aria-label={tFallback('you.openProfile', 'Open your profile')}
      >
        <div className="w-14 h-14 rounded-full bg-primary/10 border border-border flex items-center justify-center overflow-hidden shrink-0 font-bold text-primary">
          {user?.avatar_url
            ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
            : initialsFor(user) || <UserCircle className="w-6 h-6" />}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl !leading-tight truncate">{name}</h1>
          <span className="text-label text-muted-foreground">{tFallback('you.viewProfile', 'View your profile')}</span>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
      </button>

      {/* The login streak lives here rather than on Today, which shows one
          streak: training. It renders nothing on day 0. */}
      <div className="flex flex-col gap-2">
        <LevelBar totalXp={profile?.total_xp ?? user?.total_xp ?? 0} compact={false} />
        <ErrorBoundary label="LoginStreakBanner">
          <LoginStreakBanner />
        </ErrorBoundary>
      </div>

      {/* The in-season skin's switch, deliberately here as well as in Settings › Display:
          the look changes every screen, so the way out has to be one tap
          from the tab people already use, not two screens deep. The row
          disappears with the season. */}
      {skin && (
        <Group>
          <div className="px-4">
            <SkinToggle />
          </div>
        </Group>
      )}

      <Group title={tFallback('you.section.training', 'Training')}>
        <Row icon={TrendingUp} label={tFallback('nav.progress', 'Progress')} onClick={() => navigate('/progress')} />
        <Row icon={Apple} label={tFallback('nav.nutrition', 'Nutrition')} onClick={() => navigate('/nutrition')} />
        <Row icon={Dumbbell} label={tFallback('profile.myGym', 'My Gym')} onClick={() => navigate('/my-gym')} />
      </Group>

      <Group title={tFallback('you.section.records', 'Records')}>
        <Row icon={Book} label={tFallback('profile.myJournal', 'My Journal')} onClick={requestOpenJournal} />
        <Row icon={CalendarCheck} label={tFallback('profile.debriefVault', 'Weekly Reviews')} onClick={() => requestProfilePanel('reviews')} />
        <Row icon={ShieldAlert} label={tFallback('profile.myInjuries', 'My Injuries')} onClick={() => requestProfilePanel('injuries')} />
      </Group>

      <Group title={tFallback('you.section.rewards', 'Rewards')}>
        <Row icon={ShoppingBag} label={tFallback('layout.marketplace', 'Marketplace')} hint={tFallback('you.marketHint', 'Daily chest and trades')}
          onClick={() => navigate('/market')} />
        <Row icon={Backpack} label={tFallback('profile.myBag', 'My Bag')} count={capsuleCount} onClick={requestOpenBag} />
        <Row icon={Trophy} label={tFallback('profile.achievements', 'Achievements')} onClick={openAchievements} />
      </Group>

      <Group title={tFallback('you.section.account', 'Account')}>
        <Row icon={Settings} label={tFallback('profile.settings', 'Settings')} onClick={() => navigate('/settings')} />
        {isEnabled('corporatePortal') && (
          <Row icon={Building2} label={tFallback('profile.corporate', 'Corporate Wellness')} onClick={() => navigate('/corporate')} />
        )}
        <Row icon={LogOut} label={tFallback('profile.signOut', 'Sign out')} onClick={() => requestProfilePanel('signOut')} tone="danger" />
      </Group>
    </div>
  );
}
