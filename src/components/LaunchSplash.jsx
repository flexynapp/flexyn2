// src/components/LaunchSplash.jsx
//
// App-launch overlay: plays SplashScreen once per fresh launch, held until
// BOTH the animation finishes AND Supabase auth resolves, then dismisses to
// reveal whatever the existing auth gate (AuthenticatedApp) settled on —
// dashboard, a deep-linked page, or the sign-in screen. Does NO routing of
// its own; the existing gate already handles that (and deep links).
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import SplashScreen from '@/components/SplashScreen';

const LAUNCH_FLAG = 'flexyn.launchSplashShown';
// Matches the App Opener design's default canvas (slate) so the backdrop
// and the splash read as one surface.
const BG = '#3F4D5A';

export default function LaunchSplash() {
  const { authChecked } = useAuth();            // = !isLoadingAuth (session/no-session known)
  // Show only on a fresh app/tab launch. sessionStorage survives internal
  // route changes, remounts and HMR, but not a new tab / PWA cold start.
  const [active, setActive] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return !sessionStorage.getItem(LAUNCH_FLAG); } catch { return true; }
  });
  const [animDone, setAnimDone] = useState(false);
  const dismissed = useRef(false);

  // Persist immediately so a remount mid-launch doesn't restart the animation.
  useEffect(() => {
    if (!active) return;
    try { sessionStorage.setItem(LAUNCH_FLAG, '1'); } catch { /* private mode */ }
  }, [active]);

  // Dismiss only once BOTH conditions are met — whichever finishes last wins.
  useEffect(() => {
    if (active && animDone && authChecked && !dismissed.current) {
      dismissed.current = true;
      setActive(false);
    }
  }, [active, animDone, authChecked]);

  if (!active) return null;
  return (
    <>
      {/* Brand backdrop under the splash: if auth resolves slower than the
          animation (SplashScreen fades itself at drawMs), this keeps a solid
          #12161B fill instead of flashing the app/spinner until auth is known. */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 9998, background: BG }} />
      <SplashScreen onComplete={() => setAnimDone(true)} background={BG} drawMs={1700} />
    </>
  );
}
