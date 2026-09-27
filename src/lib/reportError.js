// src/lib/reportError.js
//
// Thin wrapper around Sentry.captureException for ASYNC failures that
// don't reach an ErrorBoundary (catch blocks, .catch() handlers, RPC
// errors, mutation onError callbacks). Without this, those failures
// either become console.warn lines that nobody reads, or get auto-
// captured by Sentry with no context about which feature broke.
//
// Usage:
//   import { reportError } from '@/lib/reportError';
//
//   try { await workouts.create(payload); }
//   catch (err) { reportError(err, { feature: 'workout.save', userEmail: user.email }); }
//
// The console output stays in dev so debugging is unchanged. In prod,
// the same call lands in Sentry as a captured exception with tags
// you can filter by feature/userEmail/etc.
//
// Safe to call when Sentry isn't configured (no DSN) — the wrapper
// degrades to console-only and never throws.

import * as Sentry from '@sentry/react';

const isDev = (typeof import.meta !== 'undefined') && !!import.meta.env?.DEV;

/**
 * Capture an async error with structured context.
 *
 * @param {unknown} err  - The thrown value (typically Error, possibly anything).
 * @param {Object} ctx   - Free-form context. Reserved keys with special handling:
 *   - feature   {string} — short label like 'workout.edit'. Becomes a Sentry tag.
 *   - userEmail {string} — current user. Becomes a Sentry user.
 *   - level     {'warning'|'error'|'fatal'} — Sentry severity (default 'error').
 *   All other keys land in Sentry's `extra` so you can grep them in the issue UI.
 */
export function reportError(err, ctx = {}) {
  const { feature, userEmail, level = 'error', ...extra } = ctx || {};

  // Always log locally — Sentry might be off, network might be down, or the
  // engineer might be debugging without checking Sentry. console.error is
  // the universal channel.
  console.error(
    `[reportError]${feature ? ' ' + feature : ''}:`,
    err,
    Object.keys(extra).length ? extra : ''
  );

  // Defensive: in dev with no Sentry DSN, captureException is a no-op
  // already, but wrapping in try/catch ensures a Sentry SDK bug can't
  // bubble up and mask the original error.
  try {
    Sentry.withScope((scope) => {
      scope.setLevel(level);
      if (feature) scope.setTag('feature', feature);
      if (userEmail) scope.setUser({ email: userEmail });
      if (Object.keys(extra).length) scope.setExtras(extra);
      // Postgres / PostgREST errors expose .code/.details/.hint — surface
      // them so they appear in the Sentry issue without manual digging.
      if (err && typeof err === 'object') {
        const pgFields = ['code', 'details', 'hint'];
        const pg = {};
        for (const k of pgFields) {
          if (err[k] != null) pg[k] = err[k];
        }
        if (Object.keys(pg).length) scope.setExtra('postgrest', pg);
      }
      Sentry.captureException(err);
    });
  } catch (sentryErr) {
    if (isDev) {
          console.error('[reportError] Sentry capture failed:', sentryErr);
    }
  }
}
