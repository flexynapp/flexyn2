// src/lib/data/playerReports.js
// Reporting a PLAYER (suspected cheating, fake sessions, harassment), as
// opposed to a post or comment (hubReports.js). Both land in hub_reports and
// the same /admin/reports queue.
//
// Filing goes through the report_user RPC, never a direct insert: the
// database refuses a direct player report so the one-open-report-per-reason
// rule and the 10-a-day cap cannot be walked around. The reported player is
// never told and cannot read the row.

import { supabase } from '@/api/supabaseClient';

export const PLAYER_REPORT_REASONS = [
  'cheating',
  'fake_activity',
  'harassment',
  'inappropriate',
  'spam',
  'other',
];

/**
 * @param {{ userId: string, reason: string, context?: string|null,
 *           contextId?: string|null, detail?: string }} args
 * @returns {Promise<'filed'|'already'>}
 * Throws with `code === 'rate_limited'` when the daily cap is reached.
 */
export async function reportPlayer({ userId, reason, context = null, contextId = null, detail = '' }) {
  const { data, error } = await supabase.rpc('report_user', {
    p_user_id: userId,
    p_reason: reason,
    p_context: context,
    p_context_id: contextId,
    p_detail: detail?.trim() || null,
  });
  if (error) {
    if (error.code === '54000') {
      const e = new Error('rate_limited');
      e.code = 'rate_limited';
      throw e;
    }
    throw error;
  }
  return data?.status === 'already' ? 'already' : 'filed';
}

/**
 * Reasons the current user already has an open report for against this
 * player, so the sheet can mark them as sent instead of letting the user file
 * the same thing twice. RLS limits the read to the caller's own reports.
 * @returns {Promise<Set<string>>}
 */
export async function myOpenReportReasons(userId) {
  if (!userId) return new Set();
  const { data, error } = await supabase
    .from('hub_reports')
    .select('reason')
    .eq('reported_type', 'user')
    .eq('reported_id', userId)
    .eq('status', 'pending');
  if (error) return new Set();
  return new Set((data || []).map((r) => r.reason));
}
