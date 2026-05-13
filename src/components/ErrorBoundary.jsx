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
 * it easy to locate the broken component in production.
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
import * as Sentry from '@sentry/react';
import { LanguageContext } from '@/lib/LanguageContext';

class ErrorBoundaryClass extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(
      `[ErrorBoundary] Crash in "${this.props.label || 'unknown'}":\n`,
      error,
      '\nComponent stack:',
      info.componentStack
    );
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
    // No language context — return the English fallback with simple
    // {placeholder} interpolation so labels still substitute.
    let out = fallback;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return out;
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="flex flex-col items-center justify-center py-16 px-6 text-center"
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
          <p className="text-sm text-muted-foreground mb-4">
            {this.tr('errorBoundary.desc', 'This section failed to load. Try refreshing the page.')}
            {this.props.label && (
              <span className="block text-[11px] text-muted-foreground/70 mt-1">
                {this.tr('errorBoundary.section', 'Section: {label}', { label: this.props.label })}
              </span>
            )}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null, showDetails: false })}
              className="text-xs text-primary underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
            >
              {this.tr('errorBoundary.tryAgain', 'Try again')}
            </button>
            {this.state.error && (
              <button
                type="button"
                onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
                aria-expanded={!!this.state.showDetails}
                className="text-xs text-muted-foreground underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
              >
                {this.state.showDetails
                  ? this.tr('errorBoundary.hideDetails', 'Hide details')
                  : this.tr('errorBoundary.showDetails', 'Show details')}
              </button>
            )}
          </div>
          {/*
            Error details — always visible in dev. In production they're
            behind the Show-details toggle so the casual user doesn't see
            a wall of stack but a support-tier user can copy/paste it
            when reporting.
          */}
          {(import.meta.env.DEV || this.state.showDetails) && this.state.error && (
            <pre className="mt-4 text-left text-[10px] text-destructive bg-destructive/5 rounded-lg p-3 max-w-full overflow-x-auto whitespace-pre-wrap">
              {this.state.error.toString()}
              {this.state.error.stack && '\n\n' + this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Default export — functional wrapper that injects tFallback from
 * LanguageContext. We use `useContext` directly (not `useLanguage()`)
 * because the latter throws when there's no provider above us, and we
 * want the boundary to keep working even in that degraded state.
 */
export default function ErrorBoundary(props) {
  const ctx = useContext(LanguageContext);
  return <ErrorBoundaryClass tFallback={ctx?.tFallback} {...props} />;
}
