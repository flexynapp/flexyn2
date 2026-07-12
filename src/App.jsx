import { getWasFirstLaunchThisSession, isReturningUser } from '@/lib/firstLaunch';
// Consume the first-launch flag once at module load time, before any render.
getWasFirstLaunchThisSession();

import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import React, { useEffect, useState, lazy, Suspense } from 'react';
import { MotionConfig } from 'framer-motion';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useParams, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import ErrorBoundary from '@/components/ErrorBoundary';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ThemeProvider } from '@/lib/ThemeContext';
import { SettingsProvider } from '@/lib/SettingsContext';
import { LanguageProvider } from '@/lib/LanguageContext';
import { WeightUnitProvider } from '@/lib/WeightUnitContext';
import { DistanceUnitProvider } from '@/lib/DistanceUnitContext';
import { RestTimerProvider } from '@/lib/RestTimerContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import AppUpdatePrompt from '@/components/AppUpdatePrompt';
import LoginStreakSync from '@/components/LoginStreakSync';
import LaunchSplash from './components/LaunchSplash';
import Layout from './components/Layout';

// Overlay components — each renders null until its trigger fires, so
// they can safely lazy-load AFTER first paint. Wrapping them in
// Suspense fallback={null} keeps the visual idle state empty (matches
// the "renders nothing yet" state of the eager version). Combined
// savings: the framer-motion-using overlay bodies stay out of the
// entry chunk until needed.
//
//   • LevelUpManager  — fires on workout-XP boundary crosses
//   • RestTimerOverlay— fires when user starts a workout set
//   • ThemeAnimationLayer — fires on equip of nebula/legendary themes
//
// LevelUpManager registers a useQuery; lazy-loading delays the first
// query by milliseconds. Other queries already fetch the profile, so
// React Query dedupes and there's no data race.
import Splash from './pages/Splash';
import Onboarding from './pages/Onboarding';
import SignInToContinue from './pages/SignInToContinue';
// DuelInviteLanding is rendered OUTSIDE the auth gate so anonymous
// recipients of a shareable invite URL can see the challenger's name
// + avatar without being bounced to the sign-in screen first. Eager
// because it's the destination of a viral acquisition link — any
// loading delay here is conversion lost.
import DuelInviteLanding from './pages/DuelInviteLanding';
// Public surfaces — bypass the auth gate entirely so unauthenticated
// visitors can see profile and gym pages before signing up.
// Both components call useAuth() internally and adapt their UI based
// on whether a session exists (action buttons vs. "Join Flexyn" CTA).
import PublicProfile    from './pages/PublicProfile';
import PublicGymLanding from './pages/PublicGymLanding';
import CheckInPage      from './pages/CheckInPage';
import { readPendingToken, clearPendingToken } from './lib/data/duelInvites';
import { supabase } from '@/api/supabaseClient';

const LevelUpManager      = lazy(() => import('@/components/LevelUpManager'));
const RestTimerOverlay    = lazy(() => import('@/components/RestTimerOverlay'));
const ThemeAnimationLayer = lazy(() => import('@/components/ThemeAnimationLayer'));

// Page-level code-splitting. Each route is a separate chunk so the initial
// load only fetches the page the user is actually visiting. The main bundle
// drops by hundreds of KB because pages no longer pull every other page's
// dependencies into the entry chunk transitively.
//
// Splash + SignIn + Onboarding are eagerly imported above (during auth
// bootstrap — lazy-loading them would introduce a visible loading flash).

// ── @username profile redirect ────────────────────────────────────────────────
// Resolves a username to an email, then redirects to /hub?profile=EMAIL.
// This is the shareable profile link surface: flexyn.app/@sean opens Sean's
// profile without exposing the email in the shareable URL.
function ProfileRedirect() {
  const { username } = useParams();
  const [target, setTarget] = React.useState(null); // null=loading, false=not found
  useEffect(() => {
    if (!username) { setTarget(false); return; }
    const handle = username.replace(/^@/, '');
    // Resolve username → email via the narrow resolve_profile_email RPC
    // (migration 195). email was removed from the public_profiles view to
    // stop bulk harvesting via the anon key; this RPC returns the single
    // matching email for an exact username (still anon-callable so shared
    // /@username links resolve for logged-out visitors).
    supabase
      .rpc('resolve_profile_email', { p_username: handle })
      .then(({ data }) => setTarget(data || false));
  }, [username]);
  if (target === null) {
    return <div className="fixed inset-0 flex items-center justify-center"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>;
  }
  if (!target) {
    return <Navigate to="/hub" replace />;
  }
  return <Navigate to={`/hub?profile=${encodeURIComponent(target)}`} replace />;
}

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Nutrition = lazy(() => import('./pages/Nutrition'));
const Workout   = lazy(() => import('./pages/Workout'));
const Progress  = lazy(() => import('./pages/Progress'));
const Hub       = lazy(() => import('./pages/Hub'));
const Duels     = lazy(() => import('./pages/Duels'));
const Bounties  = lazy(() => import('./pages/Bounties'));
const Gauntlet  = lazy(() => import('./pages/Gauntlet'));
const Messages  = lazy(() => import('./pages/Messages'));
const Market    = lazy(() => import('./pages/Market'));
const TrainerStudio = lazy(() => import('./pages/TrainerStudio'));
const TrainerMarket = lazy(() => import('./pages/TrainerMarket'));
const CorporatePortal = lazy(() => import('./pages/CorporatePortal'));
const Coach     = lazy(() => import('./pages/Coach'));
const Notifications = lazy(() => import('./pages/Notifications'));
const AdminReports = lazy(() => import('./pages/AdminReports'));
const TradeHistory = lazy(() => import('./pages/TradeHistory'));
const RegisterGym  = lazy(() => import('./pages/RegisterGym'));
const MyGyms       = lazy(() => import('./pages/MyGyms'));
const GymHub       = lazy(() => import('./pages/GymHub'));
const GymMap       = lazy(() => import('./pages/GymMap'));
const AdminGyms    = lazy(() => import('./pages/AdminGyms'));
const GymEdit      = lazy(() => import('./pages/GymEdit'));
const Profile     = lazy(() => import('./pages/Profile'));

// Tiny fallback shown while a lazy page chunk loads. Designed to match the
// loading spinner used during auth bootstrap so the visual transition is
// continuous — same color, same size, same position.
function PageLoader() {
  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
    </div>
  );
}


const AuthenticatedApp = () => {
  const { user, isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, checkUserAuth } = useAuth();

  // Public route bypass: anyone landing on /duel-invite/<token> skips
  // the auth gate entirely. The landing component handles both signed-in
  // and signed-out states itself. This is the viral acquisition surface —
  // an unauthenticated recipient must see the challenger info BEFORE
  // we ask them to sign up, or conversion craters.
  //
  // We read window.location.pathname directly (rather than via
  // useLocation) for a stable check during auth bootstrap. NOTE: the
  // top-level <Router> in App() is ABOVE this component — these
  // branches must return bare <Routes>, never a second <Router>.
  // Nesting a second BrowserRouter throws react-router's
  // "cannot render a <Router> inside another <Router>" invariant and
  // blanked all four public surfaces (2026-06 audit, blocker C6).
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/duel-invite/')) {
    return (
      <Routes>
        <Route path="/duel-invite/:token" element={<DuelInviteLanding />} />
        <Route path="*" element={<DuelInviteLanding />} />
      </Routes>
    );
  }

  // Public profile surface: /@username — show PublicProfile for both
  // authed and unauthed visitors. PublicProfile handles the session
  // check internally and shows social buttons vs. "Join Flexyn" CTA.
  if (typeof window !== 'undefined' && /^\/@[^/]/.test(window.location.pathname)) {
    return (
      <Routes>
        <Route path="/@:username" element={<PublicProfile />} />
        <Route path="*" element={<PublicProfile />} />
      </Routes>
    );
  }

  // Public gym landing: /p/gym/:id — lightweight read-only gym page.
  // Unauthenticated visitors see gym info + "Join Flexyn" CTA.
  // Authenticated visitors see "Enter Hub" button (→ /gym/:id).
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/p/gym/')) {
    return (
      <Routes>
        <Route path="/p/gym/:id" element={<PublicGymLanding />} />
        <Route path="*" element={<PublicGymLanding />} />
      </Routes>
    );
  }

  // Gym check-in QR target: /checkin/<CODE> — checks the signed-in user
  // into a gym for a 1.2x XP day. CheckInPage handles the signed-out case
  // (prompts sign-in), so this bypass works for a fresh camera scan too.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/checkin/')) {
    return (
      <Routes>
        <Route path="/checkin/:code" element={<CheckInPage />} />
        <Route path="*" element={<CheckInPage />} />
      </Routes>
    );
  }

  // Auto-heal: if the user has a fully-populated profile but the onboarding
  // flags are false, silently set the flags so they land on dashboard.
  //
  // Narrowed scope (previously this fired whenever ANY username existed):
  // we now ALSO require a fitness-related profile field that onboarding
  // ALWAYS sets (e.g. fitness_level OR fitness_goals OR primary_goal).
  // Without that gate, the heal could fire on a half-completed profile
  // where the user set a username early but never finished onboarding —
  // they'd be silently bounced to dashboard with an empty profile.
  //
  // Accounts with deleted_ usernames must re-onboard — never heal them.
  useEffect(() => {
    const hasRealUsername = user?.username && !user.username.startsWith('deleted_');
    if (!hasRealUsername || isLoadingAuth) return;
    if (user?.onboarding_complete || user?.onboarding_completed) return;
    // Require evidence that onboarding actually produced a full profile.
    // ANY of these being populated indicates the user completed the
    // legacy onboarding flow on a deploy that didn't yet write the
    // onboarding_complete flag.
    const hasFullProfile = !!(
      user?.fitness_level ||
      user?.fitness_goals ||
      user?.primary_goal ||
      user?.training_days_per_week ||
      user?.weight_lbs ||
      user?.height_inches
    );
    if (!hasFullProfile) return;
    import('@/api/db').then(({ db }) => {
      db.auth.updateMe({ onboarding_complete: true, onboarding_completed: true })
        .then(() => checkUserAuth())
        .catch((err) => {
          // Tolerate pre-migration deploys where one of the
          // onboarding_complete columns doesn't exist yet — but route
          // through reportError so a real regression (RLS denial,
          // auth blip) doesn't sit silent. The 42703 / PGRST204 codes
          // are the "expected" schema-drift cases.
          const code = err?.code || err?.error?.code;
          if (code === '42703' || code === 'PGRST204') return;
          import('@/lib/reportError').then(({ reportError }) => {
            reportError(err, { feature: 'app.markOnboardingComplete', level: 'warning' });
          }).catch(() => {});
        });
    });
  }, [
    user?.username,
    user?.onboarding_complete,
    user?.onboarding_completed,
    user?.fitness_level,
    user?.fitness_goals,
    user?.primary_goal,
    user?.training_days_per_week,
    user?.weight_lbs,
    user?.height_inches,
    isLoadingAuth,
  ]);

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Returning users (have completed sign-in here before) see the sign-in screen.
      // Everyone else — brand-new visitors AND users who just deleted their account
      // (which clears `fn-returning-user`) — sees the full Onboarding flow starting
      // at the Welcome screen.
      // Brand-new visitor path also gets ErrorBoundary — same rationale
      // as the post-auth Onboarding render below.
      return isReturningUser()
        ? <SignInToContinue />
        : <ErrorBoundary label="Onboarding"><Onboarding /></ErrorBoundary>;
    }
  }

  // If user is authenticated but onboarding isn't complete, show onboarding.
  // Check both column variants: onboarding_complete (migration 002) and
  // onboarding_completed (migration 001). Having a real username also counts as done.
  //
  // CRITICAL: a username starting with "deleted_" means the account was reset.
  // These users MUST re-onboard regardless of what the boolean flags say — old
  // account-reset code did not always clear onboarding_complete/onboarding_completed,
  // so we cannot trust those flags when a deleted_ placeholder is present.
  const hasRealUsername = !!(user?.username && !user.username.startsWith('deleted_'));
  const isDeletedPlaceholder = !!(user?.username?.startsWith('deleted_'));
  const onboardingDone = !isDeletedPlaceholder &&
    (user?.onboarding_complete || user?.onboarding_completed || hasRealUsername);
  if (user && !onboardingDone && !isLoadingAuth) {
    // Onboarding is the first flow a new user sees — a render throw
    // here would white-screen the entire account. Wrap in ErrorBoundary
    // so a single bug doesn't strand the user mid-flow without a
    // recovery affordance (Go to Home / Try again / Copy details).
    return (
      <ErrorBoundary label="Onboarding">
        <Onboarding />
      </ErrorBoundary>
    );
  }

  // Post-auth resume for the viral duel-invite flow: if the user just
  // finished onboarding and there's a stashed invite token, route them
  // back to the landing page so they can accept with their fresh
  // account. Done via a hard redirect (not a Router push) because we
  // haven't reached the Router yet — we're still in the auth bootstrap
  // region. clearPendingToken happens on the landing page itself once
  // the claim succeeds, so a redirect failure won't loop.
  if (user && onboardingDone && typeof window !== 'undefined') {
    const stashedToken = readPendingToken();
    if (stashedToken && !window.location.pathname.startsWith('/duel-invite/')) {
      // Clear FIRST so an interrupted redirect doesn't loop.
      clearPendingToken();
      window.location.replace(`/duel-invite/${stashedToken}`);
      return null;
    }
  }

  // Render the main app — each lazy page is wrapped in Suspense so the
  // PageLoader shows for the brief moment its chunk is fetching.
  return (
    <>
      <Routes>
        <Route path="/" element={<Splash />} />
        <Route path="/onboarding" element={<ErrorBoundary label="Onboarding"><Onboarding /></ErrorBoundary>} />
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<ErrorBoundary label="Dashboard"><Suspense fallback={<PageLoader />}><Dashboard /></Suspense></ErrorBoundary>} />
          <Route path="/nutrition" element={<ErrorBoundary label="Nutrition"><Suspense fallback={<PageLoader />}><Nutrition /></Suspense></ErrorBoundary>} />
          <Route path="/workout"   element={<ErrorBoundary label="Workout"><Suspense fallback={<PageLoader />}><Workout /></Suspense></ErrorBoundary>} />
          <Route path="/hub"       element={<ErrorBoundary label="Hub"><Suspense fallback={<PageLoader />}><Hub /></Suspense></ErrorBoundary>} />
          {/* Clean own-profile URL — renders Hub, which opens the profile
              sub-view for the signed-in user when the path is /profile. */}
          <Route path="/profile"   element={<ErrorBoundary label="Profile"><Suspense fallback={<PageLoader />}><Profile /></Suspense></ErrorBoundary>} />
          <Route path="/messages"  element={<ErrorBoundary label="Messages"><Suspense fallback={<PageLoader />}><Messages /></Suspense></ErrorBoundary>} />
          <Route path="/market"    element={<ErrorBoundary label="Market"><Suspense fallback={<PageLoader />}><Market /></Suspense></ErrorBoundary>} />
          <Route path="/coach"     element={<ErrorBoundary label="Coach"><Suspense fallback={<PageLoader />}><Coach /></Suspense></ErrorBoundary>} />
          <Route path="/progress"  element={<ErrorBoundary label="Progress"><Suspense fallback={<PageLoader />}><Progress /></Suspense></ErrorBoundary>} />
          <Route path="/duels"     element={<ErrorBoundary label="Duels"><Suspense fallback={<PageLoader />}><Duels /></Suspense></ErrorBoundary>} />
          <Route path="/bounties"  element={<ErrorBoundary label="Bounties"><Suspense fallback={<PageLoader />}><Bounties /></Suspense></ErrorBoundary>} />
          <Route path="/gauntlet"  element={<ErrorBoundary label="Gauntlet"><Suspense fallback={<PageLoader />}><Gauntlet /></Suspense></ErrorBoundary>} />
          <Route path="/notifications" element={<ErrorBoundary label="Notifications"><Suspense fallback={<PageLoader />}><Notifications /></Suspense></ErrorBoundary>} />
          <Route path="/admin/reports" element={<ErrorBoundary label="AdminReports"><Suspense fallback={<PageLoader />}><AdminReports /></Suspense></ErrorBoundary>} />
          <Route path="/market/trades" element={<ErrorBoundary label="TradeHistory"><Suspense fallback={<PageLoader />}><TradeHistory /></Suspense></ErrorBoundary>} />
          <Route path="/trainer/studio" element={<ErrorBoundary label="TrainerStudio"><Suspense fallback={<PageLoader />}><TrainerStudio /></Suspense></ErrorBoundary>} />
          <Route path="/trainer/market" element={<ErrorBoundary label="TrainerMarket"><Suspense fallback={<PageLoader />}><TrainerMarket /></Suspense></ErrorBoundary>} />
          <Route path="/corporate" element={<ErrorBoundary label="CorporatePortal"><Suspense fallback={<PageLoader />}><CorporatePortal /></Suspense></ErrorBoundary>} />
          <Route path="/register-gym" element={<ErrorBoundary label="RegisterGym"><Suspense fallback={<PageLoader />}><RegisterGym /></Suspense></ErrorBoundary>} />
          <Route path="/my-gyms"      element={<ErrorBoundary label="MyGyms"><Suspense fallback={<PageLoader />}><MyGyms /></Suspense></ErrorBoundary>} />
          <Route path="/gym/:id"      element={<ErrorBoundary label="GymHub"><Suspense fallback={<PageLoader />}><GymHub /></Suspense></ErrorBoundary>} />
          <Route path="/gym-map"      element={<ErrorBoundary label="GymMap"><Suspense fallback={<PageLoader />}><GymMap /></Suspense></ErrorBoundary>} />
          <Route path="/admin/gyms"   element={<ErrorBoundary label="AdminGyms"><Suspense fallback={<PageLoader />}><AdminGyms /></Suspense></ErrorBoundary>} />
          <Route path="/gym/:id/edit" element={<ErrorBoundary label="GymEdit"><Suspense fallback={<PageLoader />}><GymEdit /></Suspense></ErrorBoundary>} />
        </Route>
        {/* Shareable profile link: flexyn.app/@username → resolves username to email → /hub?profile=EMAIL */}
        <Route path="/@:username" element={<ProfileRedirect />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
      {/*
        Suspense fallback={null} for all three — they render null in
        their idle state anyway, so a null fallback matches the visual
        baseline and there's no flash. Each is independent so a slow
        load of one doesn't gate the others.
      */}
      <Suspense fallback={null}><ThemeAnimationLayer /></Suspense>
      <Suspense fallback={null}><RestTimerOverlay /></Suspense>
      <Suspense fallback={null}><LevelUpManager /></Suspense>
      <PWAInstallPrompt />
      <AppUpdatePrompt />
      {/*
        Fires recordLogin() exactly once per session, regardless of
        which route the user lands on. Previously this side-effect
        lived inside LoginStreakBanner on /dashboard, so users who
        skipped Dashboard never updated their last_login_date and the
        welcome-back cron mis-fired for them. Renders null.
      */}
      <LoginStreakSync />
    </>
  );
};


function App() {
  return (
    // MotionConfig with reducedMotion="user" tells every framer-motion
    // animation in the tree to honor the OS-level
    // prefers-reduced-motion setting. Users who have toggled
    // "Reduce motion" on macOS / iOS / Windows / Android no longer get
    // the heavy animations that can trigger motion sickness or
    // vestibular issues. WCAG 2.3.3 compliance + real-user comfort.
    <MotionConfig reducedMotion="user">
    <ThemeProvider>
    <LanguageProvider>
    <WeightUnitProvider>
    <DistanceUnitProvider>
    <SettingsProvider>
    <AuthProvider>
    <RestTimerProvider>
      <QueryClientProvider client={queryClientInstance}>
        <LaunchSplash />
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <SonnerToaster position="bottom-center" style={{ bottom: 'calc(4rem + 16px)' }} />
      </QueryClientProvider>
    </RestTimerProvider>
    </AuthProvider>
    </SettingsProvider>
    </DistanceUnitProvider>
    </WeightUnitProvider>
    </LanguageProvider>
    </ThemeProvider>
    </MotionConfig>
  )
}

export default App
