// src/lib/data/hubReports.js
// Content reports (posts and comments) + bug reports.
// All writes go through Supabase with RLS enforced.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';


/**
 * Submit a content report for a post or comment.
 * @param {{
 *   reporterEmail: string,
 *   reporterUserId: string,
 *   reportedType:   'post'|'comment',
 *   reportedId:     string,
 *   reportedAuthorEmail: string,
 *   reason:   string,
 *   detail?:  string,
 * }} data
 */
export async function fileReport(data) {
  const { error } = await supabase.from('hub_reports').insert({
    reporter_email:        data.reporterEmail,
    reporter_user_id:      data.reporterUserId,
    reported_type:         data.reportedType,
    reported_id:           data.reportedId,
    reported_author_email: data.reportedAuthorEmail || null,
    reason:                data.reason,
    detail:                data.detail?.trim() || null,
  });
  if (error) throw error;
}

/**
 * Check whether the current user has already filed a report for this content.
 * Returns true if a report already exists (used to show "already reported" state).
 */
export async function checkAlreadyReported(reporterEmail, reportedType, reportedId) {
  if (!reporterEmail) return false;
  const { data, error } = await safeSelect({
    columns: ['id'],
    build: (cols) => supabase
    .from('hub_reports')
    .select(cols)
    .eq('reporter_email', reporterEmail)
    .eq('reported_type', reportedType)
    .eq('reported_id', reportedId)
    .maybeSingle(),
  });
  if (error) return false;
  return !!data;
}

/**
 * List the current user's filed reports + their current status. RLS
 * already restricts SELECT to `reporter_user_id = auth.uid()`, so this
 * is just a regular query — backs the "My reports" tab in Settings.
 */
export async function listMyReports({ limit = 25 } = {}) {
  const { data, error } = await supabase
    .from('hub_reports')
    .select('id, reported_type, reported_id, reason, detail, status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}

/**
 * Submit a bug report.
 * @param {{
 *   reporterEmail:  string,
 *   reporterUserId: string,
 *   description:    string,
 *   pageContext?:   string,
 * }} data
 */
export async function fileBugReport(data) {
  const { error } = await supabase.from('bug_reports').insert({
    reporter_email:   data.reporterEmail || null,
    reporter_user_id: data.reporterUserId || null,
    description:      data.description.trim(),
    page_context:     data.pageContext || null,
  });
  if (error) throw error;
}
