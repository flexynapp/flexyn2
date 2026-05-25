// src/lib/data/organizations.js
//
// Corporate Wellness Portal client layer (migration 146). Companies
// group employees into an organization, run private org challenges,
// and (admins only) read a privacy-preserving aggregate HR dashboard.
//
// All reads fail closed on pre-146 hosts so the portal degrades to an
// empty/create state rather than crashing.

import { supabase } from '@/api/supabaseClient';

const MISSING = (c) => c === '42883' || c === '42P01' || c === 'PGRST205' || c === '42703';

/** The orgs the current user belongs to (with their role). */
export async function listMyOrganizations(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('organization_members')
    .select('role, joined_at, org:organizations!org_id (id, name, join_code, owner_id, seat_limit, created_at)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });
  if (error) return [];
  return (data || [])
    .map(r => ({ ...r.org, role: r.role, joined_at: r.joined_at }))
    .filter(o => o.id);
}

export async function createOrganization(name) {
  const { data, error } = await supabase.rpc('create_organization', { p_name: name });
  if (error) {
    if (MISSING(error.code)) return { ok: false, error: 'PIPELINE_MISSING' };
    return { ok: false, error: error.message };
  }
  return data || { ok: false };
}

export async function joinOrganizationByCode(code) {
  const cleaned = String(code || '').trim().toUpperCase();
  if (cleaned.length < 4) return { ok: false, error: 'CODE_NOT_FOUND' };
  const { data, error } = await supabase.rpc('join_organization_by_code', { p_code: cleaned });
  if (error) {
    if (MISSING(error.code)) return { ok: false, error: 'PIPELINE_MISSING' };
    return { ok: false, error: error.message };
  }
  return data || { ok: false };
}

export async function leaveOrganization(orgId, userId) {
  if (!orgId || !userId) return { ok: false };
  const { error } = await supabase
    .from('organization_members')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);
  return { ok: !error, error: error?.message };
}

/** Member headcount for an org (used in member view + admin view). */
export async function getMemberCount(orgId) {
  if (!orgId) return 0;
  const { count, error } = await supabase
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);
  if (error) return 0;
  return count || 0;
}

// ── Challenges ──────────────────────────────────────────────────────
export async function listChallenges(orgId) {
  if (!orgId) return [];
  const { data, error } = await supabase
    .from('organization_challenges')
    .select('id, title, metric, target_value, starts_at, ends_at, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

export async function createChallenge(orgId, { title, metric, targetValue, endsAt }) {
  if (!orgId) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, error: 'UNAUTHENTICATED' };
  if (!title?.trim()) return { ok: false, error: 'TITLE_REQUIRED' };
  const { error } = await supabase.from('organization_challenges').insert({
    org_id:       orgId,
    title:        title.trim().slice(0, 120),
    metric,
    target_value: Number(targetValue) || 0,
    ends_at:      endsAt || null,
    created_by:   user.id,
  });
  if (error) {
    if (MISSING(error.code)) return { ok: false, error: 'PIPELINE_MISSING' };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function deleteChallenge(challengeId) {
  if (!challengeId) return { ok: false };
  const { error } = await supabase.from('organization_challenges').delete().eq('id', challengeId);
  return { ok: !error };
}

// ── HR analytics (aggregate-only) ───────────────────────────────────
export async function getOrgAnalytics(orgId) {
  if (!orgId) return null;
  const { data, error } = await supabase.rpc('get_org_analytics', { p_org_id: orgId });
  if (error) {
    if (MISSING(error.code)) return null;
    return null;
  }
  return data;
}
