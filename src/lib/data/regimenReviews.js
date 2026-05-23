// src/lib/data/regimenReviews.js
//
// Star-rating + comment system for public regimens (migration 118).
// Each user can submit ONE review per regimen (PK enforced) AFTER
// they've cloned/adopted the regimen — the insert trigger enforces
// the adoption guard server-side, so a malicious client can't drive-
// by review.
//
// Aggregates (avg_rating + review_count) come from a denormalized
// view (regimen_review_aggregates) so the regimen card can render
// the badge with a single read per visible card.

import { supabase } from '@/api/supabaseClient';

/** List reviews for one regimen, newest first. Returns []. */
export async function listForRegimen(regimenId, limit = 20) {
  if (!regimenId) return [];
  const { data, error } = await supabase
    .from('regimen_reviews')
    .select('id, reviewer_id, reviewer_email, rating, comment, created_at, updated_at')
    .eq('regimen_id', regimenId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}

/**
 * Submit (or update) the current user's review for a regimen.
 * Returns { ok, code?, message? }. Codes the UI cares about:
 *   • 'needs_adoption' — the user hasn't cloned this regimen yet
 *   • 'rpc_error'      — any other DB failure
 *   • 'network'        — fetch threw
 */
export async function submit({ regimenId, rating, comment, userId, email }) {
  if (!regimenId || !userId || !email) return { ok: false, code: 'invalid_args' };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, code: 'invalid_rating' };
  }
  try {
    const { error } = await supabase
      .from('regimen_reviews')
      .upsert(
        {
          regimen_id:     regimenId,
          reviewer_id:    userId,
          reviewer_email: email,
          rating,
          comment:        (comment || '').trim() || null,
        },
        { onConflict: 'regimen_id,reviewer_id' },
      );
    if (error) {
      const msg = error.message || '';
      if (/review_requires_adoption/i.test(msg) || error.code === '42501') {
        return { ok: false, code: 'needs_adoption' };
      }
      return { ok: false, code: 'rpc_error', message: msg };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, code: 'network', message: err?.message };
  }
}

/**
 * Look up aggregates for a set of regimen ids in a single query.
 * Returns a Map<regimen_id, { avg_rating, review_count }>.
 * Missing ids in the result Map mean "no reviews yet" — the caller
 * treats that as a default 0/0.
 */
export async function aggregatesFor(regimenIds) {
  if (!Array.isArray(regimenIds) || regimenIds.length === 0) return new Map();
  // De-dupe — the input might be a flat post list with repeats.
  const ids = Array.from(new Set(regimenIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('regimen_review_aggregates')
    .select('regimen_id, avg_rating, review_count')
    .in('regimen_id', ids);
  if (error) return new Map();
  const map = new Map();
  for (const row of data || []) {
    map.set(row.regimen_id, {
      avg_rating:   Number(row.avg_rating) || 0,
      review_count: Number(row.review_count) || 0,
    });
  }
  return map;
}

/** The current viewer's existing review for one regimen, or null. */
export async function getMyReview(regimenId, userId) {
  if (!regimenId || !userId) return null;
  const { data, error } = await supabase
    .from('regimen_reviews')
    .select('id, rating, comment, created_at, updated_at')
    .eq('regimen_id', regimenId)
    .eq('reviewer_id', userId)
    .maybeSingle();
  if (error) return null;
  return data || null;
}
