import { getWasFirstLaunchThisSession, isReturningUser } from '@/lib/firstLaunch';
// Consume the first-launch flag once at module load time, before any render.
getWasFirstLaunchThisSession();

// NOTE: the shadcn <Toaster /> that used to be mounted here is gone. Every
// toast in the app goes through `@/lib/toast` → sonner, and nothing ever
// called shadcn's `useToast()`, so it could never render a toast. What it
// DID render was two stacked `fixed top-0 w-full z-[100] p-4` divs that
// covered the top 32px of the screen with pointer-events:auto — sitting on
// top of the Header and eating taps on the messages / bell / profile
// buttons. Sonner is the only toaster.
import FeedbackPill from "@/components/feedback/FeedbackPill"
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
import SkinPrompt from '@/components/skins/SkinPrompt';
import SkinSlot from '@/components/skins/SkinSlot';
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
import SignInToContinue from './pages/SignInToContinue';
// Onboarding is ~3,400 lines and ONLY new users ever see it — lazy-loaded so it
// stays out of the eager index chunk (every returning user was paying for it).
// Splash + SignIn stay eager (they're the genuine first-paint bootstrap screens
// where a loading flash would look broken); Onboarding renders behind a
// PageLoader fallback, same as the lazy route pages.
const Onboarding = lazy(() => import('./pages/Onboarding'));
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
import { PrivacyPolicy, TermsOfService } from './pages/Legal';
import ComingSoon from './pages/ComingSoon';
import { isEnabled } from '@/lib/featureFlags';
import { readPendingToken, clearPendingToken } from './lib/data/duelInvites';
import { supabase } from '@/api/supabaseClient';
import { useLanguage } from '@/lib/LanguageContext';

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
    // Resolve username → user_id via get_public_profile_by_username (mig 206,
    // anon-callable so shared /@username links resolve for logged-out
    // visitors). Redirecting by id (not email) keeps email out of the URL and
    // matches the id-keyed profile route — no email round-trip needed.
    supabase
      .rpc('get_public_profile_by_username', { p_username: handle })
      .then(({ data }) => setTarget(data?.id || false));
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
const You       = lazy(() => import('./pages/You'));
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
const AdminReports = lazy(() => import('./pages/AdminReports'));
const TradeHistory = lazy(() => import('./pages/TradeHistory'));
const RegisterGym  = lazy(() => import('./pages/RegisterGym'));
const MyGym        = lazy(() => import('./pages/MyGym'));
const GymHub       = lazy(() => import('./pages/GymHub'));
const GymMap       = lazy(() => import('./pages/GymMap'));
const AdminGyms    = lazy(() => import('./pages/AdminGyms'));
const GymEdit      = lazy(() => import('./pages/GymEdit'));
const Profile     = lazy(() => import('./pages/Profile'));
const Settings    = lazy(() => import('./pages/Settings'));

// Fallback shown while a lazy page chunk loads. Instead of a bare spinner
// we render grey placeholder blocks with a sweeping sheen (skeleton-shimmer)
// so a slow connection sees the page's shape filling in — a title bar, a
// hero block, and a grid of card placeholders. The blocks are generic on
// purpose: they approximate every route's layout closely enough to read as
// "content loading" without matching any one page exactly. Rendered in the
// normal content flow (not fixed) so it sits inside the Layout chrome that's
// already painted (header + bottom nav), matching where the real page lands.
function PageLoader() {
  return (
    <div
      className="px-4 pt-4 pb-8 max-w-3xl mx-auto w-full space-y-4"
      aria-hidden="true"
    >
      {/* Page title */}
      <div className="skeleton-shimmer h-7 w-40 rounded-lg" />
      {/* Hero / primary card */}
      <div className="skeleton-shimmer h-36 rounded-2xl" />
      {/* Card grid */}
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-24 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}


const AuthenticatedApp = () => {
  const { tFallback } = useLanguage();
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

  // Legal surfaces: /privacy and /terms. Public on purpose and above the
  // auth gate — an App Review reviewer, a Play Store listing and a GDPR
  // Art. 13 notice all have to reach these without an account, and a policy
  // that only renders once you have signed up is the same as no policy.
  // Statically imported (not lazy) so they can never fail to load behind a
  // chunk fetch on the one surface a reviewer is guaranteed to open.
  if (typeof window !== 'undefined'
      && (window.location.pathname === '/privacy' || window.location.pathname === '/terms')) {
    return (
      <Routes>
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms"   element={<TermsOfService />} />
        <Route path="*"        element={<PrivacyPolicy />} />
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
        : <ErrorBoundary label="Onboarding"><Suspense fallback={<PageLoader />}><Onboarding /></Suspense></ErrorBoundary>;
    }
  }

  // The profile row could not be read (see fetchProfile). Without this the
  // user fell through to Onboarding below, as if they were new.
  if (user?.profileLoadFailed) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center safe-page">
        <p className="text-base font-semibold">
          {tFallback('app.profileLoadFailed.title', 'We could not load your profile')}
        </p>
        <p className="text-sm text-muted-foreground">
          {tFallback('app.profileLoadFailed.body', 'Check your connection and try again.')}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 min-h-[48px] px-6 rounded-xl bg-primary text-primary-foreground font-bold text-sm"
        >
          {tFallback('errorBoundary.tryAgain', 'Try again')}
        </button>
      </div>
    );
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
        <Suspense fallback={<PageLoader />}>
          <Onboarding />
        </Suspense>
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
        <Route path="/onboarding" element={<ErrorBoundary label="Onboarding"><Suspense fallback={<PageLoader />}><Onboarding /></Suspense></ErrorBoundary>} />
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
          <Route path="/you"       element={<ErrorBoundary label="You"><Suspense fallback={<PageLoader />}><You /></Suspense></ErrorBoundary>} />
          <Route path="/duels"     element={<ErrorBoundary label="Duels"><Suspense fallback={<PageLoader />}><Duels /></Suspense></ErrorBoundary>} />
          <Route path="/bounties"  element={<ErrorBoundary label="Bounties"><Suspense fallback={<PageLoader />}><Bounties /></Suspense></ErrorBoundary>} />
          <Route path="/gauntlet"  element={<ErrorBoundary label="Gauntlet"><Suspense fallback={<PageLoader />}><Gauntlet /></Suspense></ErrorBoundary>} />
          {/* /notifications merged into the bell sheet on 2026-08-10 — one
              surface, one type→category map. The page and the panel rendered
              the same table with different classifications, and the drift
              was invisible: `coin_gift` was in neither list. It redirects
              rather than 404s because the route is old enough to be in
              someone's history, and `?notifications=1` is what NotificationBell
              reads to open the sheet on arrival. */}
          <Route path="/notifications" element={<Navigate to="/dashboard?notifications=1" replace />} />
          {/* Settings is an index plus seven subpages. Two routes rather
              than an optional `:section?` param, which react-router only
              honours from 6.5 — this shape works on every version and the
              page reads the param either way. */}
          <Route path="/settings"          element={<ErrorBoundary label="Settings"><Suspense fallback={<PageLoader />}><Settings /></Suspense></ErrorBoundary>} />
          <Route path="/settings/:section" element={<ErrorBoundary label="Settings"><Suspense fallback={<PageLoader />}><Settings /></Suspense></ErrorBoundary>} />
          <Route path="/admin/reports" element={<ErrorBoundary label="AdminReports"><Suspense fallback={<PageLoader />}><AdminReports /></Suspense></ErrorBoundary>} />
          <Route path="/market/trades" element={<ErrorBoundary label="TradeHistory"><Suspense fallback={<PageLoader />}><TradeHistory /></Suspense></ErrorBoundary>} />
          <Route path="/trainer/studio" element={
            // Flagged off — the buy path invokes an Edge Function that has
            // never been deployed, and the payment story has to clear Apple
            // 3.1.1 before this surface can be reachable. See featureFlags.js.
            isEnabled('trainerMarketplace')
              ? <ErrorBoundary label="TrainerStudio"><Suspense fallback={<PageLoader />}><TrainerStudio /></Suspense></ErrorBoundary>
              : <ComingSoon title={tFallback("app.creatorStudio", "Creator Studio")} blurb="Packaging and selling your own programs is coming. Your regimens are safe in the meantime." />
          } />
          <Route path="/trainer/market" element={
            isEnabled('trainerMarketplace')
              ? <ErrorBoundary label="TrainerMarket"><Suspense fallback={<PageLoader />}><TrainerMarket /></Suspense></ErrorBoundary>
              : <ComingSoon title={tFallback("market.trainerPrograms", "Trainer Programs")} blurb="Premium regimens from certified creators are on the way." />
          } />
          <Route path="/corporate" element={
            isEnabled('corporatePortal')
              ? <ErrorBoundary label="CorporatePortal"><Suspense fallback={<PageLoader />}><CorporatePortal /></Suspense></ErrorBoundary>
              : <ComingSoon title={tFallback("app.corporateWellness", "Corporate Wellness")} blurb="Team challenges and company leaderboards are still being built." />
          } />
          <Route path="/register-gym" element={<ErrorBoundary label="RegisterGym"><Suspense fallback={<PageLoader />}><RegisterGym /></Suspense></ErrorBoundary>} />
          {/* /my-gyms merged into /my-gym on 2026-08-09 — one page, one
              profile-menu entry. It redirects rather than 404s because the
              8-character Flexyn Code printed on gym signage tells people to
              open it, and printed signage can't be recalled. */}
          <Route path="/my-gyms"      element={<Navigate to="/my-gym" replace />} />
          <Route path="/my-gym"       element={<ErrorBoundary label="MyGym"><Suspense fallback={<PageLoader />}><MyGym /></Suspense></ErrorBoundary>} />
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
      {/* Skin backdrop (src/components/skins/parts.js): behind the page,
          renders nothing unless a skin is in season and switched on. */}
      <SkinSlot name="Backdrop" />
      <SkinPrompt />
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
        {/* No `future` prop, deliberately. The v6 migration guide has you
            pass v7_startTransition and v7_relativeSplatPath here; on v7 both
            are the default and the keys are dead. They were switched on
            against 6.30.4 first and the suite proved green before the bump,
            so the behaviour change never rode along with the upgrade. */}
        <Router>
          <AuthenticatedApp />
        </Router>
        <FeedbackPill />
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
