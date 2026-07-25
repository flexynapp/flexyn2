// src/lib/errorToast.js
//
// Specific error toasts with a "Retry" action — the difference between
// "Something went wrong" and "Couldn't save your workout. Retry?" is
// the difference between giving up and trying again. Users are kind to
// apps that own their failures.
//
// Backed by sonner (the dominant toast library in this codebase). A
// thin wrapper so call sites don't have to construct the action object
// shape themselves — keeping them readable and ensuring every error
// toast carries a recovery affordance when one is possible.
//
// USAGE
//
//   import { errorToast } from '@/lib/errorToast';
//
//   try {
//     await saveWorkout();
//   } catch (err) {
//     errorToast({
//       title: 'Workout not saved',
//       description: 'Lost connection — your draft is safe.',
//       retry: () => saveWorkout(),
//     });
//   }
//
// The `retry` action is rendered automatically when a callback is
// provided. Omit `retry` for non-recoverable errors.

import { toast } from '@/lib/toast';

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {() => any} [opts.retry]     Called when the user taps the action.
 * @param {string} [opts.retryLabel]   Defaults to "Retry".
 */
export function errorToast({
  title,
  description,
  retry,
  retryLabel = 'Retry',
} = {}) {
  const opts = {};
  if (description) opts.description = description;
  if (retry) {
    opts.action = {
      label: retryLabel,
      onClick: () => { try { retry(); } catch { /* swallow */ } },
    };
  }
  toast.error(title, opts);
}
