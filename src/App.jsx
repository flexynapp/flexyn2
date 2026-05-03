import { getWasFirstLaunchThisSession, isReturningUser } from '@/lib/firstLaunch';
// Consume the first-launch flag once at module load time, before any render.
getWasFirstLaunchThisSession();

import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ThemeProvider } from '@/lib/ThemeContext';
import { SettingsProvider } from '@/lib/SettingsContext';
import { LanguageProvider } from '@/lib/LanguageContext';
import { WeightUnitProvider } from '@/lib/WeightUnitContext';
import { DistanceUnitProvider } from '@/lib/DistanceUnitContext';
import { RestTimerProvider } from '@/lib/RestTimerContext';
import RestTimerOverlay from '@/components/RestTimerOverlay';
import LevelUpManager from '@/components/LevelUpManager';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from './components/Layout';
import Splash from './pages/Splash';
import Onboarding from './pages/Onboarding';
import SignInToContinue from './pages/SignInToContinue';
import Dashboard from './pages/Dashboard';
import Nutrition from './pages/Nutrition';
import Workout from './pages/Workout';
import Progress from './pages/Progress';
import Hub from './pages/Hub';


const AuthenticatedApp = () => {
  const { user, isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, checkUserAuth } = useAuth();

  // Auto-heal: if the user has a username (meaning they completed onboarding
  // before) but onboarding_complete is false (e.g. after an account reset),
  // silently set the flag and re-fetch so they land on the dashboard.
  useEffect(() => {
    if (user?.username && !user?.onboarding_complete && !user?.onboarding_completed && !isLoadingAuth) {
      import('@/api/base44Client').then(({ base44 }) => {
        base44.auth.updateMe({ onboarding_complete: true, onboarding_completed: true })
          .then(() => checkUserAuth())
          .catch(() => {}); // fail silently if columns not yet migrated
      });
    }
  }, [user?.username, user?.onboarding_complete, user?.onboarding_completed, isLoadingAuth]);

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
  // onboarding_completed (migration 001). Having a username also counts as done.
  const onboardingDone = user?.onboarding_complete || user?.onboarding_completed || user?.username;
  if (user && !onboardingDone && !isLoadingAuth) {
    return <Onboarding />;
  }

  // Render the main app
  return (
    <>
      <Routes>
        <Route path="/" element={<Splash />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/nutrition" element={<Nutrition />} />
          <Route path="/workout" element={<Workout />} />
          <Route path="/hub" element={<Hub />} />
          <Route path="/progress" element={<Progress />} />
        </Route>
        <Route path="*" element={<PageNotFound />} />
      </Routes>
      <RestTimerOverlay />
      <LevelUpManager />
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
