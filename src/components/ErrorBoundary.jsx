/**
 * ErrorBoundary.jsx
 *
 * Catches any unhandled JS errors thrown during render, lifecycle, or event
 * handlers of child components. Without this, a single thrown error unmounts
 * the entire React tree and leaves a blank screen.
 *
 * Usage:
 *   <ErrorBoundary label="BodyMetrics">
 *     <BodyMetricsTab />
 *   </ErrorBoundary>
 *
 * The `label` prop appears in the fallback UI and in the console error, making
 * it easy to locate the broken component in production. Errors are also
 * captured by Sentry with `boundary.label` as a tag.
 *
 * ── Recovery affordances ────────────────────────────────────────────────────
 * The fallback gives the user three explicit ways out, in priority order:
 *
 *   1. **Go to Home** — navigates to /dashboard. Most reliable recovery
 *      because the broken section unmounts entirely. Recommended first
 *      action when a section is persistently broken (e.g. a migration
 *      hasn't been applied — re-rendering won't fix that).
 *
 *   2. **Try again** — clears local error state and re-renders. Useful
 *      for transient failures (network blip, race condition during
 *      hydration) where the second attempt succeeds.
 *
 *   3. **Copy details** — puts the error message, stack, and component
 *      stack onto the clipboard so the user can paste them into a bug
 *      report. This unblocks support without requiring them to share
 *      a screenshot of stack-trace text.
 *
 * Additionally: if the route changes (location.pathname), the wrapping
 * functional component remounts the inner class via a `key` so the
 * boundary resets automatically. Users who tap a nav item to leave the
 * broken page never see the error state persist after they've moved on.
 *
 * ── i18n ────────────────────────────────────────────────────────────────────
 * Class components can't call hooks, so we wrap the boundary class with a
 * tiny functional default export that reads `tFallback` from
 * LanguageContext (when available) and threads it through as a prop.
 *
 * If the boundary is mounted OUTSIDE LanguageProvider (rare — would have
 * to be a near-root crash before context mounts), `tFallback` is undefined
 * and the class falls back to English literals. That's intentional —
 * having the safety net work in degraded mode beats having it crash
 * during its own setup.
 */

import React, { useContext } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { LanguageContext } from '@/lib/LanguageContext';
import { isChunkLoadError, reloadOnce } from '@/lib/staleDeployGuard';

// A "chunk load" error means the user's cached index bundle points at a
// hash-named chunk URL that no longer exists on the CDN — almost always
// because the user has an outdated index.html / service-worker cache
// while a new deploy has replaced the chunk hashes. The fix is a hard
// reload to fetch the fresh index.html that references current chunks.
// One-shot reload guarded by sessionStorage so we never loop forever
// if the underlying cause is a real bug rather than stale cache.
// isChunkLoadError / reloadOnce live in staleDeployGuard so this boundary
// and the window-level listeners share one reload guard.
class ErrorBoundaryClass extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null, copied: false, reloading: false };
  }

  static getDerivedStateFromError(error) {
    // A chunk error starts out hidden: componentDidCatch either reloads the
    // page (and it stays hidden) or clears this and shows the fallback.
    return { hasError: true, error, reloading: isChunkLoadError(error) };
  }

  componentDidCatch(error, info) {
    // Stash component stack so the Copy-details button can include it.
    this.setState({ info });
    console.error(
      `[ErrorBoundary] Crash in "${this.props.label || 'unknown'}":\n`,
      error,
      '\nComponent stack:',
      info.componentStack
    );

    // Stale-deploy / dynamic-import-chunk failure path. Auto-reload once
    // to pick up the new index.html. If we DO trigger the reload, we
    // skip Sentry capture — repeated stale-cache events would otherwise
    // swamp the error budget with non-actionable noise.
    // While that reload is in flight the fallback renders nothing, so the
    // user sees the page refresh rather than a crash card first.
    if (isChunkLoadError(error) && reloadOnce()) return;
    if (this.state.reloading) this.setState({ reloading: false });

    Sentry.captureException(error, {
      contexts: {
        react: { componentStack: info.componentStack },
        boundary: { label: this.props.label || 'unknown' },
      },
    });
  }

  // Tiny local translation helper. Mirrors tFallback semantics so the
  // boundary works WITH or WITHOUT a language context above it.
  tr = (key, fallback, vars) => {
    const fb = this.props.tFallback;
    if (fb) return fb(key, fallback, vars);
    let out = fallback;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return out;
  };

  // Build the diagnostic blob users can copy. Includes the label, full
  // error text, error stack, and React component stack — everything an
  // engineer needs to triage from a bug report without a screen recording.
  buildDetailsText = () => {
    const lines = [
      `Section: ${this.props.label || 'unknown'}`,
      `URL:     ${typeof window !== 'undefined' ? window.location.href : 'n/a'}`,
      `Time:    ${new Date().toISOString()}`,
      '',
      `Error:   ${this.state.error?.toString?.() || String(this.state.error)}`,
    ];
    if (this.state.error?.stack) {
      lines.push('', 'Stack:', this.state.error.stack);
    }
    if (this.state.info?.componentStack) {
      lines.push('', 'Component stack:', this.state.info.componentStack);
    }
    return lines.join('\n');
  };

  handleCopyDetails = async () => {
    const text = this.buildDetailsText();
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    } catch {
      // Older browsers / iframes without clipboard permission — fall
      // back to selecting a hidden textarea. If that also fails, surface
      // the text in a window.prompt so the user can copy manually.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        this.setState({ copied: true });
        setTimeout(() => this.setState({ copied: false }), 2500);
      } catch {
        // Last resort — show it for manual selection.
        window.prompt('Copy this error report:', text);
      }
    }
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, info: null, copied: false, reloading: false });
  };

  render() {
    if (this.state.hasError && this.state.reloading) return null;
    if (this.state.hasError) {
      const { onGoHome, fallback } = this.props;
      // Custom fallback (e.g. for an inline element like a map tile
      // inside a feed post) — caller passes a ready-to-render React
      // node. Bypasses the full "Something went wrong" UI which would
      // be visually disruptive in those contexts.
      if (fallback) {
        return typeof fallback === 'function'
          ? fallback({ error: this.state.error, reset: this.handleReset })
          : fallback;
      }
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="flex flex-col items-center justify-center py-12 px-6 text-center"
        >
          <div
            aria-hidden="true"
            className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4"
          >
            <span className="text-2xl">⚠️</span>
          </div>
          <p className="font-heading font-bold text-base mb-1">
            {this.tr('errorBoundary.title', 'Something went wrong')}
          </p>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">
            {this.tr('errorBoundary.desc', 'This section failed to load.')}
            {this.props.label && (
              <span className="block text-micro text-muted-foreground/70 mt-1">
                {this.tr('errorBoundary.section', 'Section: {label}', { label: this.props.label })}
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
            {onGoHome && (
              <button
                type="button"
                onClick={onGoHome}
                className="text-xs font-semibold px-3 h-8 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {this.tr('errorBoundary.goHome', 'Go to Home')}
              </button>
            )}
            <button
              type="button"
              onClick={this.handleReset}
              className="text-xs font-semibold px-3 h-8 rounded-md border border-border bg-card text-foreground hover:bg-secondary active:bg-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {this.tr('errorBoundary.tryAgain', 'Try again')}
            </button>
            {this.state.error && (
              <button
                type="button"
                onClick={this.handleCopyDetails}
                className="text-xs font-semibold px-3 h-8 rounded-md border border-border bg-card text-foreground hover:bg-secondary active:bg-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-live="polite"
              >
                {this.state.copied
                  ? this.tr('errorBoundary.copied', 'Copied!')
                  : this.tr('errorBoundary.copyDetails', 'Copy details')}
              </button>
            )}
          </div>
          {/*
            Error details — auto-expanded in dev for fast iteration; in
            production they're behind a `<details>` toggle so the casual
            user doesn't see a wall of stack on first paint but a
            support-tier user (or anyone tapping it) can still self-serve.
          */}
          {this.state.error && (
            <details
              className="mt-2 text-start max-w-full w-full max-w-2xl"
              open={import.meta.env.DEV}
            >
              <summary className="text-xs text-muted-foreground cursor-pointer select-none mb-2">
                {this.tr('errorBoundary.showDetails', 'Show details')}
              </summary>
              <pre className="text-micro text-destructive bg-destructive/5 rounded-lg p-3 max-w-full overflow-x-auto whitespace-pre-wrap">
                {this.buildDetailsText()}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Default export — functional wrapper that:
 *   1. Injects `tFallback` from LanguageContext for i18n inside the
 *      class, while keeping the class usable without a provider above.
 *   2. Auto-resets the boundary when the route changes by passing
 *      `location.pathname` as React's `key`. A user who taps the bottom
 *      nav to leave a broken page never sees the error state persist
 *      after the location updates.
 *   3. Provides a "Go to Home" handler that navigates to /dashboard.
 *      This gives users an obvious recovery action even when "Try again"
 *      would just re-trip the same crash (e.g. missing migration).
 *
 * `useLocation` / `useNavigate` are only available inside a <Router>,
 * which is true for every render path that mounts boundaries today.
 * If a boundary is ever mounted outside Router (unlikely — would mean
 * crashing before App's Router mounts), the wrapper degrades gracefully
 * because the hooks return undefined-style values and we no-op the
 * navigation affordance.
 */
export default function ErrorBoundary(props) {
  const ctx = useContext(LanguageContext);
  // useLocation/useNavigate throw if used outside Router. We mount the
  // boundary inside Router on every real code path, so the safe-guard
  // is purely defensive — let the hooks crash loudly if someone
  // misplaces a boundary (better signal than a silent bug).
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <ErrorBoundaryClass
      // Key on pathname so the boundary state resets when navigating
      // between routes. Without this, the boundary inside a route
      // element retains hasError=true if React happens to reuse the
      // instance across renders.
      key={location.pathname}
      tFallback={ctx?.tFallback}
      onGoHome={() => navigate('/dashboard')}
      {...props}
    />
  );
}
