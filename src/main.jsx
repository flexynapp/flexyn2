// Flexyn — built by seanjoudrie + keganbergeron. Copyright © 2026.
import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.jsx'
import './index.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { capturePendingReferralCode } from './lib/data/referrals'
import { installStaleDeployGuard } from './lib/staleDeployGuard'
import { track, EVENTS } from './lib/analytics'

// Recover from stale-deploy chunk fetches (see staleDeployGuard) before
// the app mounts, so a cached tab that hits a missing chunk self-heals
// with one reload instead of showing a half-rendered screen.
installStaleDeployGuard()

// Signature for anyone who opens DevTools.
try {
  console.log(
    '%cFlexyn',
    'font-size:28px;font-weight:800;color:#f97316;text-shadow:0 2px 8px rgba(249,115,22,0.4);padding:8px 0;'
  );
  console.log(
    '%cbuilt by seanjoudrie + keganbergeron · © 2026',
    'font-size:12px;color:#94a3b8;font-style:italic;'
  );
} catch (_) {}

// Capture ?ref=ABC123 from the landing URL BEFORE React mounts. This
// has to run early because the URL gets cleaned during React Router's
// initial parse; we read the param first and stash it in localStorage
// where AuthContext can pick it up after sign-up completes. The capture
// helper is a no-op when there's no ref param, so it's cheap to run
// unconditionally.
capturePendingReferralCode();

// Product analytics (src/lib/analytics.js): a no-op unless VITE_POSTHOG_KEY
// is set. One open per page load; the Supabase id is attached once auth
// resolves, and events before that carry this device's random id.
track(EVENTS.APP_OPENED, { standalone: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches === true });

// ── Sentry error monitoring ───────────────────────────────────────────────────
// To activate: replace the dsn placeholder with your real DSN from
// https://sentry.io → Settings → Projects → <your project> → Client Keys (DSN)
// Leave the placeholder in place to run locally with Sentry disabled.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,          // "production" | "development"
    release: import.meta.env.VITE_APP_VERSION,  // optional: set in CI with git SHA
    // Only send traces in production to keep the free-tier quota safe
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
    // Session Replay: record 5 % of sessions, 100 % of sessions with errors
    replaysSessionSampleRate: import.meta.env.PROD ? 0.05 : 0,
    replaysOnErrorSampleRate: import.meta.env.PROD ? 1.0 : 0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
  });
}

// ── i18n completeness check (dev only) ───────────────────────────────────────
if (import.meta.env.DEV) {
  import('./lib/i18n-check').then(({ checkI18nCompleteness }) => {
    setTimeout(checkI18nCompleteness, 100);
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
