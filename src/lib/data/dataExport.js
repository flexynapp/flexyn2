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
import { asT } from '@/lib/translatorArg';
import { LISTING_COLUMNS } from './marketplace';
import { OWN_COLUMNS as OWN_REGIMEN_COLUMNS } from './regimens';
import { POST_COLUMNS } from './hubPosts';
import { COMMENT_COLUMNS } from './hubComments';
import { TEMPLATE_COLUMNS } from './templates';

// (table, owner-filter-column) pairs we know how to export.
//
// A wrong table or column here never throws: the section just reads
// { error: 'fetch_failed' } inside the downloaded file, which nobody opens
// to check. Five entries were wrong until 2026-09-28 (a missing
// `achievements` table, and injury_logs, gym_feed_comments, crew_messages
// and trainer_purchases keyed on email columns those tables do not have).
// `npm run schema:columns` now reads the `table:` / `column:` pairs below,
// so the production check covers them.
// Belt + suspenders: RLS already restricts these reads, but the
// explicit filter means the test-able call shape is clear.
const EXPORT_TABLES = [
  { name: 'profile',          table: 'user_profiles',  column: 'id',           via: 'id' },
  { name: 'workouts',         table: 'workout_logs',   column: 'created_by',   via: 'email' },
  { name: 'cardio',           table: 'cardio_logs',    column: 'created_by',   via: 'email' },
  { name: 'goals',            table: 'goals',          column: 'created_by',   via: 'email' },
  { name: 'regimens',         table: 'regimens',       column: 'user_id',      via: 'id', select: OWN_REGIMEN_COLUMNS },
  { name: 'nutrition',        table: 'nutrition_logs', column: 'created_by',   via: 'email' },
  { name: 'body_metrics',     table: 'body_metrics',   column: 'created_by',   via: 'email' },
  // Achievements live on the profile row (exported above). There is no
  // `achievements` table; this entry asked for one and every export carried
  // { error: 'fetch_failed' } here. Trophies are their own table.
  { name: 'trophies',         table: 'user_trophies',  column: 'user_id',      via: 'id', select: 'id, user_id, trophy_id, earned_at' },
  { name: 'workout_templates',table: 'workout_templates', column: 'user_id',    via: 'id', select: TEMPLATE_COLUMNS },
  { name: 'hub_posts',        table: 'hub_posts',      column: 'user_id',      via: 'id', select: POST_COLUMNS },
  { name: 'hub_comments',     table: 'hub_comments',   column: 'user_id',      via: 'id', select: COMMENT_COLUMNS },
  { name: 'hub_messages_sent',table: 'hub_messages',   column: 'sender_email', via: 'email' },
  // Health / wellness logs — GDPR Article 20 (right to data portability)
  // covers ALL user-furnished data. The export previously omitted these
  // even though _invokeDeleteAccount knew about them. (Audit 14 #20.)
  { name: 'injury_logs',      table: 'injury_logs',    column: 'user_id',      via: 'id' },
  { name: 'sleep_logs',       table: 'sleep_logs',     column: 'user_id',      via: 'id' },
  { name: 'mood_logs',        table: 'mood_logs',      column: 'user_id',      via: 'id' },
  { name: 'cycle_logs',       table: 'cycle_logs',     column: 'user_id',      via: 'id' },
  // Added 2026-08-05. Both were being written and read — step_logs has its
  // own dashboard card, journal_entries is the My Journal editor — and
  // neither appeared here, so a user exercising Article 20 got an export
  // missing their step history and every word of their own journal. Found
  // while answering "where does this data even go?", which is a fair
  // question to be able to answer with the export itself.
  { name: 'step_logs',        table: 'step_logs',      column: 'user_id',      via: 'id' },
  { name: 'journal_entries',  table: 'journal_entries', column: 'user_id',     via: 'id' },
  // Social membership + interactions
  { name: 'gym_members',          table: 'gym_members',          column: 'user_id',      via: 'id', select: 'id, gym_id, user_id, joined_at' },
  { name: 'gym_event_rsvps',      table: 'gym_event_rsvps',      column: 'user_id',      via: 'id' },
  { name: 'gym_feed_posts',       table: 'gym_feed_posts',       column: 'author_id',    via: 'id', select: 'id, gym_id, author_id, body, media_url, like_count, comment_count, reaction_count, created_at, edited_at, is_pinned, pinned_at' },
  { name: 'gym_feed_comments',    table: 'gym_feed_comments',    column: 'author_id',    via: 'id', select: 'id, post_id, parent_id, author_id, body, created_at, edited_at' },
  { name: 'crew_messages_sent',   table: 'crew_messages',        column: 'sender_id',    via: 'id' },
  // Mig 130 actually names the table `crew_message_reactions` (singular
  // "message") and the owning column is `user_id` (UUID), not user_email.
  // The previous entry's table name had an extra 's' and the column
  // didn't exist — every GDPR export silently returned
  // `{ error: 'fetch_failed', detail: 'relation does not exist' }` for
  // emoji reactions. Wave 54 (Settings audit) caught this.
  { name: 'crew_message_reactions', table: 'crew_message_reactions', column: 'user_id', via: 'id' },
  // Marketplace + trainer purchase history
  // Tables that grant SELECT column by column (other people's emails are
  // not readable) refuse select('*'), so these name their columns.
  { name: 'marketplace_listings', table: 'marketplace_listings', column: 'seller_user_id', via: 'id', select: LISTING_COLUMNS },
  { name: 'trainer_purchases',    table: 'trainer_purchases',    column: 'user_id',      via: 'id' },
  { name: 'organization_members', table: 'organization_members', column: 'user_id',      via: 'id' },
  // Privacy-list and device subs
  { name: 'user_blocks',          table: 'user_blocks',          column: 'blocker_id',   via: 'id' },
  { name: 'user_mutes',           table: 'user_mutes',           column: 'muter_id',     via: 'id' },
  { name: 'push_subscriptions',   table: 'push_subscriptions',   column: 'user_id',      via: 'id' },
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
        .select(spec.select || '*')
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
export async function downloadExport(exportData, filename, t) {
  const tf = asT(t);
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const stamp = (exportData?.exported_at || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19);
  const name = filename || `flexyn-data-${stamp}.json`;

  // iOS Safari quirk: `<a download>` opens the JSON inline in a new
  // tab rather than saving it. Try the Web Share API first so the
  // user gets a real share sheet (Files / iCloud / Mail). Fall back
  // to the `<a download>` path on other browsers. (Audit 14 #21.)
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !/Edg|Chrome/.test(ua);
  if (isIOS && typeof navigator !== 'undefined' && navigator.canShare) {
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: tf('dataExport.shareTitle', 'Flexyn data export') });
        return;
      }
    } catch {
      // user cancelled or share failed — fall through to download path
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
