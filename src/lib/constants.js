// App-wide constants
// Image assets hosted on Base44 CDN — will be migrated to our own storage before launch.
//
// NOTE: this URL was accidentally rewritten from `media.base44.com` to
// `media.db.com` by the base44 → db codemod earlier in the project. The
// `.db.com` domain isn't ours; the working logo lives at the original
// base44 CDN. Reverting here keeps the existing logo working until we
// move to our own asset host.

export const LOGO_URL = 'https://media.base44.com/images/public/69dfb5d1674e81512478f6f7/a7dcfb0be_transparent-logo.png';

/**
 * How many workout logs the Progress surfaces fetch.
 *
 * Progress.jsx and BodyMetricsTab share the `['workoutLogs', email]` query
 * key, so React Query serves both from one cache entry and whichever mounts
 * first supplies the queryFn — meaning the two MUST request the same limit
 * or the row count depends on mount order. Hence one constant rather than
 * a literal in each file.
 *
 * It was 200, and every lifetime stat on the Progress page is derived from
 * this slice: the workout count, Personal Bests, Top PRs, and Insights'
 * "training since" date. Past 200 sessions all four went quietly wrong with
 * nothing on screen saying the history had been truncated. 1000 matches
 * db.js's own default limit and costs nothing for users below it.
 */
export const LOG_FETCH_LIMIT = 1000;
