// src/api/safeSelect.js
//
// Read-side equivalent of the strip-and-retry pattern in db.js's
// updateMe() / makeEntity().create(). When a supabase .select() names
// columns explicitly and one of them doesn't exist in the schema cache
// yet (migration pending), PostgREST returns either:
//
//   - 42703   PostgreSQL undefined_column: `column "x" does not exist`
//   - PGRST204 PostgREST schema-cache miss: `the 'x' column ...`
//
// Without this helper, those errors crash the component that issued
// the read — which is exactly how the Hub broke for the user when
// migration 049 was pending and HubProfile asked for country_flag /
// trophy_case. The boundary caught it; this helper prevents it.
//
// Contract:
//
//   safeSelect({ columns, build }) returns whatever supabase's
//   terminal call returns (`{ data, error }` for normal, the same
//   shape for `.single()`). If the error is one of the recognized
//   schema-cache misses AND the offending column appears in `columns`,
//   it's stripped and the build is retried. Up to 20 retries — enough
//   to strip every column in a wide payload before giving up.
//
//   Any OTHER error (RLS, network, type mismatch, real query bug) is
//   returned verbatim. The helper does not swallow real failures.
//
//   When a column is stripped, the returned row simply lacks that
//   property. Existing consumers already use `??` / `?.` fallback
//   patterns on these fields, so missing-column rows render exactly
//   the same as null-valued rows. Avoiding magic field-injection
//   keeps the helper honest about what's in the schema.
//
// Usage:
//
//   import { safeSelect } from '@/api/safeSelect';
//
//   const { data, error } = await safeSelect({
//     columns: ['email', 'username', 'country_flag', 'trophy_case'],
//     build: (cols) =>
//       supabase.from('user_profiles').select(cols).eq('email', e).single(),
//   });

// Patterns Supabase / PostgREST use to name the offending column.
// Both extract a column name into capture group 1.
const PG_42703_RE  = /column\s+(?:"|`)?([a-zA-Z0-9_]+)(?:"|`)?\s+does not exist/i;
const PG_42703_QUALIFIED_RE = /column\s+[a-zA-Z0-9_]+\.([a-zA-Z0-9_]+)\s+does not exist/i;
const PGRST204_RE  = /the\s+'([a-zA-Z0-9_]+)'\s+column/i;
const PGRST204_ALT = /column\s+'([a-zA-Z0-9_]+)'/i;

/**
 * Extract the name of the missing column from a Supabase error, or
 * return null if the error doesn't match a recognized schema-cache miss.
 *
 * @param {Object} error  - Supabase error object (has .code, .message, .details, .hint).
 * @param {string[]} known - The current column list; the result must be one of these
 *   so we don't strip a column the caller didn't name (e.g. a join target).
 * @returns {string|null}
 */
function identifyMissingColumn(error, known) {
  if (!error) return null;
  const code = error.code || '';
  const haystack = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;

  if (code === '42703') {
    // Try qualified form first ("column foo.bar does not exist"),
    // then bare. PG often emits qualified form for SELECT.
    const m = haystack.match(PG_42703_QUALIFIED_RE) || haystack.match(PG_42703_RE);
    const name = m?.[1];
    if (name && known.includes(name)) return name;
  }
  if (code === 'PGRST204') {
    const m = haystack.match(PGRST204_RE) || haystack.match(PGRST204_ALT);
    const name = m?.[1];
    if (name && known.includes(name)) return name;
  }
  return null;
}

/**
 * Run a supabase .select() with automatic strip-and-retry on
 * schema-cache-miss errors.
 *
 * @param {Object} opts
 * @param {string[]} opts.columns - Columns to request, as an array.
 * @param {(joinedCols: string) => PromiseLike<{data:any, error:any}>} opts.build
 *   - Builder that takes the joined comma-separated column string and
 *     returns the supabase chain's terminal promise.
 * @returns {Promise<{data:any, error:any}>} Whatever the supabase chain returns.
 */
export async function safeSelect({ columns, build }) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('[safeSelect] `columns` must be a non-empty string[]');
  }
  if (typeof build !== 'function') {
    throw new Error('[safeSelect] `build` must be a function');
  }

  let active = columns.slice();
  // 20 retries covers stripping every column from a wide payload
  // (HubProfile's 13-column select fits comfortably). After 20 we
  // assume the query is broken in a way we can't fix and return
  // whatever the latest error was.
  for (let attempt = 0; attempt < 20; attempt++) {
    // NOT a display list — this is the PostgREST `select=` column list, and
    // its separator is protocol. A locale-aware list formatter here (the
    // 2026-08-10 i18n sweep converted several `.join(', ')` call sites) would
    // send `id، وname` to the API and break every read in the app.
    const result = await build(active.join(', '));
    if (!result?.error) return result;
    const missing = identifyMissingColumn(result.error, active);
    if (!missing) return result; // unrecognized — propagate untouched
    if (active.length === 1) {
      // Down to one column and it's the missing one. Caller can't
      // recover from this; return the error verbatim so they see it.
      return result;
    }
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`[safeSelect] schema-cache miss on "${missing}" — stripping and retrying`);
    }
    active = active.filter((c) => c !== missing);
  }
  return {
    data: null,
    error: new Error('[safeSelect] exhausted retries while stripping missing columns'),
  };
}

// Exposed for unit tests / direct introspection.
export const __testOnly__ = { identifyMissingColumn };
