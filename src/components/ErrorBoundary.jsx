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
 */

import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log to console with enough context to find the component quickly
    console.error(
      `[ErrorBoundary] Crash in "${this.props.label || 'unknown'}":\n`,
      error,
      '\nComponent stack:',
      info.componentStack
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <p className="font-heading font-bold text-base mb-1">Something went wrong</p>
          <p className="text-sm text-muted-foreground mb-4">
            This section failed to load. Try refreshing the page.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-xs text-primary underline underline-offset-2"
          >
            Try again
          </button>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-4 text-left text-[10px] text-destructive bg-destructive/5 rounded-lg p-3 max-w-full overflow-x-auto whitespace-pre-wrap">
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
