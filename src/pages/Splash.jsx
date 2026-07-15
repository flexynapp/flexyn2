import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/db';
import { markReturningUser } from '@/lib/firstLaunch';
import { reportError } from '@/lib/reportError';

export default function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    const check = async () => {
      // With Supabase, a valid session means we already have a JWT token.
      // The old Base44 localStorage key check has been removed — it was
      // causing an infinite OAuth redirect loop on every page load.
      const isAuthed = await db.auth.isAuthenticated();

      if (!isAuthed) {
        // Brand-new visitor or signed-out user — go to the welcome screen.
        navigate('/onboarding', { replace: true });
        return;
      }

      // Authenticated — check if onboarding is done.
      const user = await db.auth.me().catch(() => null);
      const onboardingDone =
        user?.onboarding_complete || user?.onboarding_completed || user?.username;

      if (!user || !onboardingDone) {
        navigate('/onboarding', { replace: true });
      } else {
        markReturningUser();
        navigate('/dashboard', { replace: true, state: { fromSplash: true } });
      }
    };
    // Critical: if isAuthenticated() throws (Supabase slow, JWT decode
    // error, network blip mid-bootstrap), the user would otherwise be
    // stuck on the splash screen forever with no recovery short of a
    // hard refresh. Catch and fall back to onboarding — worst case they
    // re-sign-in. The splash IS the first screen every visitor sees;
    // having no error handling here is a single point of failure for
    // the whole app.
    check().catch((err) => {
      reportError(err, { feature: 'splash.bootstrap', level: 'error' });
      navigate('/onboarding', { replace: true });
    });
  }, [navigate]);

  // Render only a neutral fill — NO branding. This route exists purely to
  // run the auth check + redirect above; the visible launch animation is
  // owned by <LaunchSplash> (mounted at the app root), which crossfades
  // away once auth resolves. Previously this returned a full branded splash
  // (flame icon + "Flexyn" + tagline), so on cold start the user saw the
  // animated opener crossfade onto THIS second, static splash before it
  // navigated to the dashboard — the "two splash screens" flash. Keeping it
  // a bare background lets the opener land directly on the dashboard.
  return <div className="fixed inset-0 bg-background" aria-hidden="true" />;
}
