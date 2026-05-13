import { getWasFirstLaunchThisSession, isReturningUser } from '@/lib/firstLaunch';
// Consume the first-launch flag once at module load time, before any render.
getWasFirstLaunchThisSession();

import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import React, { useEffect, lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
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
const LevelUpManager      = lazy(() => import('@/components/LevelUpManager'));
const RestTimerOverlay    = lazy(() => import('@/components/RestTimerOverlay'));
const ThemeAnimationLayer = lazy(() => import('@/components/ThemeAnimationLayer'));

// Page-level code-splitting. Each route is a separate chunk so the initial
// load only fetches the page the user is actually visiting. The main bundle
// drops by hundreds of KB because pages no longer pull every other page's
// dependencies into the entry chunk transitively.
//
// Splash + SignIn + Onboarding are eagerly imported because they're shown
// during auth bootstrap — lazy-loading them would introduce a visible
// loading flash during the auth flow, which is bad first-impression UX.
import Splash from './pages/Splash';
import Onboarding from './pages/Onboarding';
import SignInToContinue from './pages/SignInToContinue';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Nutrition = lazy(() => import('./pages/Nutrition'));
const Workout   = lazy(() => import('./pages/Workout'));
const Progress  = lazy(() => import('./pages/Progress'));
const Hub       = lazy(() => import('./pages/Hub'));

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
        .catch(() => {}); // fail silently if columns not yet migrated
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
      return isReturningUser() ? <SignInToContinue /> : <Onboarding />;
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
    return <Onboarding />;
  }

  // Render the main app — each lazy page is wrapped in Suspense so the
  // PageLoader shows for the brief moment its chunk is fetching.
  return (
    <>
      <Routes>
        <Route path="/" element={<Splash />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<ErrorBoundary label="Dashboard"><Suspense fallback={<PageLoader />}><Dashboard /></Suspense></ErrorBoundary>} />
          <Route path="/nutrition" element={<ErrorBoundary label="Nutrition"><Suspense fallback={<PageLoader />}><Nutrition /></Suspense></ErrorBoundary>} />
          <Route path="/workout"   element={<ErrorBoundary label="Workout"><Suspense fallback={<PageLoader />}><Workout /></Suspense></ErrorBoundary>} />
          <Route path="/hub"       element={<ErrorBoundary label="Hub"><Suspense fallback={<PageLoader />}><Hub /></Suspense></ErrorBoundary>} />
          <Route path="/progress"  element={<ErrorBoundary label="Progress"><Suspense fallback={<PageLoader />}><Progress /></Suspense></ErrorBoundary>} />
        </Route>
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
    </>
  );
};


function App() {
  return (
    <ThemeProvider>
    <LanguageProvider>
    <WeightUnitProvider>
    <DistanceUnitProvider>
    <SettingsProvider>
    <AuthProvider>
    <RestTimerProvider>
      <QueryClientProvider client={queryClientInstance}>
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
  )
}

export default App
