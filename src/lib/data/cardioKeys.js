// src/lib/data/cardioKeys.js
//
// React Query keys for cardio_logs reads. ZERO IMPORTS, and that is the
// point of the file.
//
// These started life in `data/cardio.js`, which imports `@/api/db` — and
// db.js registers a `supabase.auth.onAuthStateChange` listener at module
// scope. So a component importing nothing but a key string still dragged
// that listener in, and every test stubbing the supabase client died on
// `Cannot read properties of undefined (reading 'onAuthStateChange')`.
// cardioGoalsScreen.test.jsx failed the moment CardioGoals imported the
// key. CLAUDE.md documents this exact trap — it is how `gymRival.js` broke
// `gymRivalOverthrow.test.js` — and a key factory is the purest thing in
// the codebase, so it has no business being behind a side effect.
//
// ── Why the keys are scoped ────────────────────────────────────────────
// Seven components read cardio_logs, and all seven used the bare key
// `['cardioLogs', email]` with different queryFns and different limits —
// 1, 50, 100, 500, 500, 1000, 1000. React Query caches by key, so that was
// not seven queries, it was one, and whichever observer happened to
// trigger the fetch decided what all the others got. The cardio home
// asking for a single row to render "Repeat last" could populate the cache
// that Progress then read as the user's entire history.
//
// Nothing failed loudly. Every consumer received well-formed rows — just
// not necessarily the ones it asked for, and never reproducibly, because
// the winner depends on mount order.
//
// ── Invalidation is deliberately untouched ─────────────────────────────
// React Query matches `queryKey` as a PREFIX unless you pass
// `exact: true`, so the six existing
// `invalidateQueries({ queryKey: ['cardioLogs', email] })` calls still
// clear every scope without being edited. Verified against
// @tanstack/react-query 5.90 in cardioLogsKey.test.js, because the fix
// being small depends entirely on that being true.

/**
 * @param {string} email  the owner
 * @param {string} scope  which reader — 'lastLog' | 'savedList' |
 *   'goalProgress' | 'nutritionTargets' | 'progress' | 'dashboard' |
 *   'workout'. A NEW reader gets a new scope; it does not reuse one,
 *   because two readers sharing a scope is the original bug in miniature.
 */
export const cardioLogsKey = (email, scope) => ['cardioLogs', email, scope];

export default cardioLogsKey;
