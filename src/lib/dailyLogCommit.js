// src/lib/dailyLogCommit.js
//
// "Commit anything you have pending" — for surfaces that host log cards
// with a typed field, so a dismiss can flush them deterministically.
//
// Board 02 draws the Readiness sheet's CTA as "Save & close", and that
// label is only honest if the sheet can actually make the cards inside it
// save. StepsLogCard holds a draft that commits on Enter, on its own
// check button, and on blur — but a dismiss cannot rely on blur: it
// depends on the element having real focus, which is not true in every
// environment (a backgrounded document dispatches no focus events at
// all), and "the label is true as long as the browser cooperates" is not
// a promise worth making about someone's data.
//
// Same shape as OPEN_BAG_EVENT / OPEN_JOURNAL_EVENT: a window event, so
// the sheet needs no ref into cards it renders through an ErrorBoundary.

import { useEffect } from 'react';

export const COMMIT_DAILY_LOGS_EVENT = 'flexyn-commit-daily-logs';

/**
 * Register a card's flush. `fn` should be a no-op when nothing is pending.
 * Kept in a ref-free effect deliberately: the handler is re-registered
 * whenever `fn` changes, so it always closes over current draft state.
 */
export function useCommitDailyLogOnRequest(fn) {
  useEffect(() => {
    const handler = () => { try { fn(); } catch { /* a flush must never break a dismiss */ } };
    window.addEventListener(COMMIT_DAILY_LOGS_EVENT, handler);
    return () => window.removeEventListener(COMMIT_DAILY_LOGS_EVENT, handler);
  }, [fn]);
}

/** Ask every registered card to commit whatever it is holding. */
export function requestCommitDailyLogs() {
  window.dispatchEvent(new CustomEvent(COMMIT_DAILY_LOGS_EVENT));
}
