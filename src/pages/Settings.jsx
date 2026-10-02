// src/pages/Settings.jsx
//
// Settings, as a route with an index and seven subpages.
//
// It used to be a 1,585-line component rendered inside the ProfileMenu
// dropdown, which is pinned `start-4 end-4` — 361px wide on an iPhone 15 —
// with `max-h-[calc(100vh-4rem)]`. About forty controls across ten
// headings shared that one scroll, always fully expanded, and everything
// in it had been shrunk to fit: two type sizes total (12px and 11px, the
// bottom two of six), headings the same size as their own rows, and
// switches 20px tall. It read as cramped because it was: a settings screen
// wearing a menu's dimensions.
//
// Two things fix that, and the route is the one that makes the other
// possible. With the full viewport, the page can spend the type scale it
// already has: `text-title` (20) for the heading, `text-body` (15) for
// rows, `text-caption` (12) for hints, `text-micro` (11) kept for badges
// only — four steps where there were two — plus a 44px row floor. With
// seven subpages, the entry point is seven rows instead of forty
// controls, which is also the convention every phone user already knows
// from iOS and Android.
//
// Deep-linkable on purpose: `/settings/notifications` is a real URL, so
// the hardware back button steps subpage → index → wherever they came
// from, and a support reply can point at one.

import { lazy, Suspense } from 'react';
import { useParams, useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  ArrowLeft, SlidersHorizontal, Bell, Dumbbell, HeartPulse,
  Lock, UserCog, Info, Loader2,
} from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Group, NavRow } from '@/components/settings/SettingsPrimitives';

// Each subpage is its own chunk. Settings is reached from a menu two taps
// in and most visits touch one page, so loading all seven would be paying
// for six of them every time. The index itself is this file and carries no
// section code at all.
const PreferencesSection  = lazy(() => import('@/components/settings/PreferencesSection'));
const NotificationsSection = lazy(() => import('@/components/settings/NotificationsSection'));
const TrainingSection     = lazy(() => import('@/components/settings/TrainingSection'));
const BodySection         = lazy(() => import('@/components/settings/BodySection'));
const PrivacySection      = lazy(() => import('@/components/settings/PrivacySection'));
const AccountSection      = lazy(() => import('@/components/settings/AccountSection'));
const AboutSection        = lazy(() => import('@/components/settings/AboutSection'));

// The index, and the routing table, in one place. `slug` is the URL, so
// renaming one breaks a link somebody may have been given — add rather
// than rename.
//
// The order is by how often a setting is changed after install, not
// alphabetically and not by size: preferences and notifications are what
// people come here for, About is what they need once.
const SECTIONS = [
  {
    slug: 'preferences',
    icon: SlidersHorizontal,
    title: ['settings.section.preferences', 'Preferences'],
    hint: ['settings.section.preferences.hint', 'Language, units, appearance, tips, haptics & sound'],
    Component: PreferencesSection,
  },
  {
    slug: 'notifications',
    icon: Bell,
    title: ['settings.section.notifications', 'Notifications'],
    hint: ['settings.section.notifications.hint', 'In-app alerts, push, categories & quiet hours'],
    Component: NotificationsSection,
  },
  {
    slug: 'training',
    icon: Dumbbell,
    title: ['settings.section.training', 'Training'],
    hint: ['settings.section.training.hint', 'Auto-pause, rest timer & volume math'],
    Component: TrainingSection,
  },
  {
    slug: 'body',
    icon: HeartPulse,
    title: ['settings.section.body', 'Body & nutrition'],
    hint: ['settings.section.body.hint', 'Weight, height, age, sex & nutrition display'],
    Component: BodySection,
  },
  {
    slug: 'privacy',
    icon: Lock,
    title: ['settings.section.privacy', 'Privacy & safety'],
    hint: ['settings.section.privacy.hint', 'Who sees you, stories, blocked & muted accounts'],
    Component: PrivacySection,
  },
  {
    slug: 'account',
    icon: UserCog,
    title: ['settings.section.account', 'Account'],
    hint: ['settings.section.account.hint', 'Two-factor auth, connected apps & data export'],
    Component: AccountSection,
  },
  {
    slug: 'about',
    icon: Info,
    title: ['settings.section.about', 'About'],
    hint: ['settings.section.about.hint', 'Report a bug, build version & credits'],
    Component: AboutSection,
  },
];

export default function Settings() {
  const { section: slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, tFallback } = useLanguage();

  const section = slug ? SECTIONS.find(s => s.slug === slug) : null;

  // An unknown slug is a stale or mistyped link, not an error worth a page
  // for. Replace rather than push so Back doesn't bounce off it.
  if (slug && !section) return <Navigate to="/settings" replace />;

  const title = section ? tFallback(...section.title) : t('profile.settings');

  // Is this the first location the router has seen — i.e. is there nothing
  // of ours behind us to go back to?
  //
  // `key === 'default'` is react-router's marker for the session's initial
  // entry, which is what someone deep-linking `/settings/privacy` from a
  // support reply gets. `window.history.length` cannot answer this: it
  // counts the whole TAB, so arriving from a search result reads as 2 and
  // `navigate(-1)` would walk out of the app instead of into the Dashboard.
  // `settingsRoot` carries the same fact across the one replace below.
  const atSessionStart = location.key === 'default' || !!location.state?.settingsRoot;

  const goBack = () => {
    // A subpage POPS the index rather than pushing it.
    //
    // Pushing is what broke back-from-the-index, and it was reproducible:
    // caller → index → subpage → back left the stack at
    // [caller, /settings, /settings/x, /settings], so the index's own
    // navigate(-1) went to `/settings/x`. You tapped Back on Settings and
    // landed back inside Settings. Popping keeps it [caller, /settings], so
    // one more Back reaches the caller — and it makes this arrow agree with
    // the hardware back button, which it previously did not.
    if (section) {
      if (atSessionStart) navigate('/settings', { replace: true, state: { settingsRoot: true } });
      else navigate(-1);
      return;
    }
    // From the index, back means the page they were looking at before
    // Settings. With nothing of ours behind us, fall back to a safe parent
    // rather than leaving the app.
    if (atSessionStart) navigate('/dashboard');
    else navigate(-1);
  };

  return (
    <div className="px-4 md:px-8 pb-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 pt-4 pb-6 sticky top-0 bg-background z-10">
        <button
          type="button"
          onClick={goBack}
          className="w-11 h-11 -ms-2 rounded-lg flex items-center justify-center hover:bg-secondary active:bg-secondary transition-colors shrink-0"
          aria-label={tFallback('common.back', 'Back')}
        >
          <ArrowLeft className="w-5 h-5 rtl:scale-x-[-1]" aria-hidden="true" />
        </button>
        <h1 className="font-heading font-bold text-title leading-tight truncate">{title}</h1>
      </div>

      {section ? (
        <ErrorBoundary label={`Settings:${section.slug}`}>
          <Suspense
            fallback={
              <div className="flex justify-center py-8">
                <Loader2
                  className="w-5 h-5 animate-spin text-muted-foreground"
                  role="status"
                  aria-label={tFallback('common.loading', 'Loading…')}
                />
              </div>
            }
          >
            <section.Component />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <Group>
          {SECTIONS.map(({ slug: s, icon, title: tk, hint }) => (
            <NavRow
              key={s}
              icon={icon}
              label={tFallback(...tk)}
              hint={tFallback(...hint)}
              to={`/settings/${s}`}
            />
          ))}
        </Group>
      )}
    </div>
  );
}
