// src/components/LaunchSplash.jsx
//
// App-launch overlay: plays SplashScreen on EVERY entry into the app —
// signed in or not — then CROSSFADES away to reveal whatever the auth gate
// settled on (dashboard, a deep-linked page, or the sign-in screen). Does
// no routing of its own; the existing gate handles that (and deep links).
//
// Mounted once at the app root (App.jsx, above <Router>), so it plays on a
// fresh load / PWA cold start / reload but never re-fires on in-app
// navigation. There is intentionally NO once-per-session guard: the opener
// is meant to greet the user every time they enter the app.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import SplashScreen from '@/components/SplashScreen';

// Matches the App Opener design's default canvas (slate) so the backdrop
// and the splash read as one surface.
const BG = '#3F4D5A';
// Duration of the crossfade from the opener to the app beneath it.
const CROSSFADE_MS = 150;

export default function LaunchSplash() {
  const { authChecked } = useAuth();            // = !isLoadingAuth (session/no-session known)
  const [active, setActive]   = useState(true); // always show on entry
  const [animDone, setAnimDone] = useState(false);
  const [leaving, setLeaving] = useState(false); // crossfade in progress
  const dismissed = useRef(false);

  // Hand off once the animation has finished AND auth is known (whichever is
  // last). Rather than unmounting instantly — a harsh cut to the dashboard —
  // we fade the whole overlay out over the already-rendered app beneath it,
  // then unmount when the fade completes. The app is live under the overlay
  // the entire time, so the crossfade lands directly on the dashboard.
  useEffect(() => {
    if (!active || dismissed.current) return undefined;
    if (animDone && authChecked) {
      dismissed.current = true;
      setLeaving(true);
      const t = setTimeout(() => setActive(false), CROSSFADE_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [active, animDone, authChecked]);

  if (!active) return null;
  return (
    <div
      aria-hidden={leaving || undefined}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        opacity: leaving ? 0 : 1,
        transition: `opacity ${CROSSFADE_MS}ms ease`,
        pointerEvents: leaving ? 'none' : 'auto',
      }}
    >
      {/* Solid brand fill under the splash — covers the app / auth spinner if
          auth resolves slower than the animation, so nothing flashes through
          until we deliberately crossfade the whole overlay away. */}
      <div style={{ position: 'absolute', inset: 0, background: BG }} />
      <SplashScreen onComplete={() => setAnimDone(true)} background={BG} drawMs={1100} />
    </div>
  );
}
