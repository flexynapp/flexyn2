// src/lib/data/trophies.js
//
// Earned-trophies data layer. Two operations:
//   • listEarned(userIdOrEmail) — fetch any user's earned trophies
//     for display on their profile.
//   • grantEligible() — server-checks every catalog trophy's criteria
//     against the current user's stats and inserts any newly earned
//     ones. Returns the array of newly-granted IDs so the caller can
//     fire a celebration toast.

import { supabase } from '@/api/supabaseClient';

import { toast } from '@/lib/toast';
import { getTrophy } from '@/lib/trophyDefinitions';

export async function listEarned(userIdOrEmail, byEmail = false) {
  if (!userIdOrEmail) return [];
  try {
    const q = supabase
      .from('user_trophies')
      .select('trophy_id, earned_at');
    const { data, error } = byEmail
      ? await q.eq('user_email', userIdOrEmail).order('earned_at', { ascending: false })
      : await q.eq('user_id', userIdOrEmail).order('earned_at', { ascending: false });
    if (error) {
      if (error.code === '42P01') return []; // table missing, mig not applied
      return [];
    }
    return data || [];
  } catch {
    return [];
  }
}

export async function grantEligible() {
  try {
    const { data, error } = await supabase.rpc('grant_eligible_trophies');
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return { ok: false, error: 'rpc_missing' };
      return { ok: false, error: error.message };
    }
    const granted = (data && Array.isArray(data.newly_granted)) ? data.newly_granted : [];
    return { ok: true, newlyGranted: granted };
  } catch (err) {
    return { ok: false, error: err?.message || 'rpc_threw' };
  }
}

// Convenience: grant + toast each newly earned trophy. Use after
// workout save / streak update / level up.
export async function checkAndCelebrate() {
  const res = await grantEligible();
  if (!res.ok || !res.newlyGranted.length) return res;
  for (const id of res.newlyGranted) {
    const trophy = getTrophy(id);
    if (!trophy) continue;
    toast.success(`${trophy.emoji} Trophy earned: ${trophy.name}`, {
      description: trophy.description,
      duration: 5000,
    });
  }
  return res;
}
