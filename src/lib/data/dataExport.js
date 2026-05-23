// src/lib/data/dataExport.js
//
// "Download my data" — gathers every row the user owns across the
// known tables and produces a single JSON document the caller can
// hand to the browser as a downloadable file.
//
// SECURITY
//   The fetches use the regular supabase client, so RLS enforces that
//   we never include another user's rows even if a bug here asked for
//   them. Each table is filtered explicitly on a user-owning column
//   (created_by / user_id / sender_email) as a belt + suspenders.
//
// FAILURE SEMANTICS
//   Per-table fetches are independent and tolerated. If one table
//   times out, that section ends up as { error: 'fetch_failed' } in
//   the output rather than blocking the entire export. Users get
//   PARTIAL data instead of nothing.

import { supabase } from '@/api/supabaseClient';

// (table, owner-filter-column) pairs we know how to export.
// Belt + suspenders: RLS already restricts these reads, but the
// explicit filter means the test-able call shape is clear.
const EXPORT_TABLES = [
  { name: 'profile',          table: 'user_profiles',  column: 'id',           via: 'id' },
  { name: 'workouts',         table: 'workout_logs',   column: 'created_by',   via: 'email' },
  { name: 'cardio',           table: 'cardio_logs',    column: 'created_by',   via: 'email' },
  { name: 'goals',            table: 'goals',          column: 'created_by',   via: 'email' },
  { name: 'regimens',         table: 'regimens',       column: 'created_by',   via: 'email' },
  { name: 'nutrition',        table: 'nutrition_logs', column: 'created_by',   via: 'email' },
  { name: 'body_metrics',     table: 'body_metrics',   column: 'created_by',   via: 'email' },
  { name: 'achievements',     table: 'achievements',   column: 'created_by',   via: 'email' },
  { name: 'workout_templates',table: 'workout_templates', column: 'created_by', via: 'email' },
  { name: 'hub_posts',        table: 'hub_posts',      column: 'author_email', via: 'email' },
  { name: 'hub_comments',     table: 'hub_comments',   column: 'created_by',   via: 'email' },
  { name: 'hub_messages_sent',table: 'hub_messages',   column: 'sender_email', via: 'email' },
];

/**
 * Run all the per-table fetches and return a structured object the
 * caller can JSON.stringify. Pure-ish — supabase is mocked in tests.
 *
 * @param {{ id: string, email: string }} user
 * @returns {Promise<object>}
 */
export async function buildExport(user) {
  if (!user?.id || !user?.email) {
    throw new Error('user_required');
  }
  const exportedAt = new Date().toISOString();
  const out = {
    schema_version: 1,
    exported_at:    exportedAt,
    user: { id: user.id, email: user.email },
    sections: {},
  };

  await Promise.all(EXPORT_TABLES.map(async (spec) => {
    try {
      const value = spec.via === 'id' ? user.id : user.email;
      const { data, error } = await supabase
        .from(spec.table)
        .select('*')
        .eq(spec.column, value)
        .limit(5000);
      if (error) {
        out.sections[spec.name] = { error: 'fetch_failed', detail: error.message };
        return;
      }
      out.sections[spec.name] = data || [];
    } catch (err) {
      out.sections[spec.name] = { error: 'fetch_threw', detail: err?.message };
    }
  }));

  return out;
}

/**
 * Trigger a browser download of the export object as a JSON file.
 *
 * @param {object} exportData  the result of buildExport()
 * @param {string} [filename]  override the default filename
 */
export function downloadExport(exportData, filename) {
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = (exportData?.exported_at || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = filename || `flexyn-data-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
