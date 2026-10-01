// src/lib/data/admin.js
//
// Client wrappers for the moderator RPCs added in migration 084.
// All three are gated server-side via is_app_admin(); a non-admin
// caller gets a 42501 thrown back. Callers should already gate the
// UI via isAppAdmin() in adminRoles.js — these wrappers are the
// belt to the suspenders.

import { supabase } from '@/api/supabaseClient';

/**
 * Paginated report queue.
 *
 * @param {object} opts
 * @param {'pending'|'reviewed'|'actioned'|'dismissed'} [opts.status]
 * @param {number} [opts.limit]
 * @returns {Promise<Array<{
 *   id: string, reporter_email: string, reported_type: string,
 *   reported_id: string, reported_author_email: string|null,
 *   reason: string, detail: string|null, status: string,
 *   content_snippet: string|null, created_at: string,
 * }>>}
 */
export async function listReports({ status = 'pending', limit = 50, kind = null } = {}) {
  // kind: 'user' = player reports, 'content' = posts/comments/stories,
  // null = everything.
  const { data, error } = await supabase.rpc('list_reports_for_admin', {
    p_status: status,
    p_limit:  limit,
    p_kind:   kind,
  });
  if (error) throw error;
  return data || [];
}

/**
 * Transition a report's status WITHOUT touching the underlying content.
 * Used when the admin reviews and decides to either ack ('reviewed') or
 * dismiss the report.
 *
 * @param {string} reportId
 * @param {'reviewed'|'actioned'|'dismissed'} action
 */
export async function resolveReport(reportId, action) {
  const { error } = await supabase.rpc('resolve_report', {
    p_report_id: reportId,
    p_action:    action,
  });
  if (error) throw error;
}

/**
 * Delete the reported content AND mark the report 'actioned' in one
 * server-side transaction.
 *
 * @param {string} reportId
 */
export async function deleteReportedContent(reportId) {
  const { error } = await supabase.rpc('delete_reported_content', {
    p_report_id: reportId,
  });
  if (error) throw error;
}

/**
 * Admin-gated bug-report queue (mig 144). Bug reports filed from
 * Settings → "Report a bug" land in `bug_reports`, which the content-
 * report reader (list_reports_for_admin) never touched — they were
 * invisible to admins. This reads them.
 *
 * @param {object} opts
 * @param {'pending'|'reviewed'|'dismissed'} [opts.status]
 * @param {number} [opts.limit]
 */
export async function listBugReports({ status = 'pending', limit = 50 } = {}) {
  const { data, error } = await supabase.rpc('list_bug_reports_for_admin', {
    p_status: status,
    p_limit:  limit,
  });
  if (error) {
    // Pre-migration host → empty queue rather than a thrown error.
    if (error.code === '42883' || error.code === '42P01') return [];
    throw error;
  }
  return data || [];
}

/** Transition a bug report's status (admin only, mig 144). */
export async function resolveBugReport(reportId, status) {
  const { error } = await supabase.rpc('resolve_bug_report', {
    p_report_id: reportId,
    p_status:    status,
  });
  if (error) throw error;
}

/**
 * Admin-gated food-request queue (mig 343).
 *
 * A barcode nothing recognises files a `food_item_requests` row rather than
 * writing straight into the shared catalogue. Nothing else reads that table
 * across users — its RLS only lets you see your own — so this RPC is the
 * only way the queue is visible at all.
 *
 * @param {object} opts
 * @param {'pending'|'approved'|'rejected'} [opts.status]
 * @param {number} [opts.limit]
 */
export async function listFoodItemRequests({ status = 'pending', limit = 50 } = {}) {
  const { data, error } = await supabase.rpc('list_food_item_requests_for_admin', {
    p_status: status,
    p_limit:  limit,
  });
  if (error) {
    // Pre-migration host → empty queue rather than a thrown error, matching
    // how the bug-report reader above degrades.
    if (error.code === '42883' || error.code === '42P01') return [];
    throw error;
  }
  return data || [];
}

/**
 * Approve a request — the ONLY path that writes a `food_items` row from one
 * (mig 343). Returns the new catalogue row's id.
 *
 * The RPC is not idempotent on purpose: approving an already-reviewed request
 * raises `22023 already reviewed` rather than quietly creating a second
 * catalogue row. Callers should surface that as a message, not a crash.
 */
export async function approveFoodItemRequest(requestId) {
  const { data, error } = await supabase.rpc('approve_food_item_request', {
    p_request_id: requestId,
  });
  if (error) throw error;
  return data;
}

/** Reject a request (admin only, mig 343). Nothing reaches the catalogue. */
export async function rejectFoodItemRequest(requestId) {
  const { error } = await supabase.rpc('reject_food_item_request', {
    p_request_id: requestId,
  });
  if (error) throw error;
}
