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
// it is one. The overlays are still owned by ProfileMenu, which stays
// mounted in the header with its trigger hidden; see profilePanels.js.

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, TrendingUp, Apple, ShoppingBag, Trophy, Dumbbell, Book,
  CalendarCheck, ShieldAlert, Backpack, Settings, UserCircle, Building2, LogOut, Trash2,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { requestOpenJournal } from '@/lib/journalOverlay';
import { requestOpenBag } from '@/lib/inventoryFlow';
import { OPEN_ACHIEVEMENTS_EVENT } from '@/lib/achievementsFlow';
import { requestProfilePanel } from '@/lib/profilePanels';
import { isEnabled } from '@/lib/featureFlags';
import { initialsFor } from '@/lib/initials';
import { handle } from '@/lib/userDisplay';
import LevelBar from '@/components/LevelBar';

function Row({ icon: Icon, label, hint, onClick, tone }) {
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
      {tone !== 'danger' && <ChevronRight className="w-4 h-4 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />}
    </button>
  );
}

function Group({ children }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
      {children}
    </div>
  );
}

export default function You() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const name = user?.full_name || handle(user) || tFallback('you.title', 'You');

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

      <LevelBar totalXp={user?.total_xp || 0} compact={false} />

      <Group>
        <Row icon={TrendingUp} label={tFallback('nav.progress', 'Progress')} onClick={() => navigate('/progress')} />
        <Row icon={Apple} label={tFallback('nav.nutrition', 'Nutrition')} onClick={() => navigate('/nutrition')} />
      </Group>

      <Group>
        <Row icon={ShoppingBag} label={tFallback('you.rewards', 'Rewards')} hint={tFallback('you.rewardsHint', 'Market and daily chest')}
          onClick={() => navigate('/market')} />
        <Row icon={Backpack} label={tFallback('profile.myBag', 'My Bag')} onClick={requestOpenBag} />
        <Row icon={Trophy} label={tFallback('profile.achievements', 'Achievements')} onClick={openAchievements} />
        <Row icon={Dumbbell} label={tFallback('profile.myGym', 'My Gym')} onClick={() => navigate('/my-gym')} />
      </Group>

      <Group>
        <Row icon={Book} label={tFallback('profile.myJournal', 'My Journal')} onClick={requestOpenJournal} />
        <Row icon={CalendarCheck} label={tFallback('profile.debriefVault', 'Weekly Reviews')} onClick={() => requestProfilePanel('reviews')} />
        <Row icon={ShieldAlert} label={tFallback('profile.myInjuries', 'My Injuries')} onClick={() => requestProfilePanel('injuries')} />
      </Group>

      <Group>
        <Row icon={Settings} label={tFallback('profile.settings', 'Settings')} onClick={() => navigate('/settings')} />
        {isEnabled('corporatePortal') && (
          <Row icon={Building2} label={tFallback('profile.corporate', 'Corporate Wellness')} onClick={() => navigate('/corporate')} />
        )}
      </Group>

      <Group>
        <Row icon={LogOut} label={tFallback('profile.signOut', 'Sign out')} onClick={() => requestProfilePanel('signOut')} tone="danger" />
        <Row icon={Trash2} label={tFallback('profile.deleteAccount', 'Delete account')} onClick={() => requestProfilePanel('deleteAccount')} tone="danger" />
      </Group>
    </div>
  );
}
