// src/lib/data/photoAiQuota.js
//
// Client-side read of the Photo-AI (recognize-meal) daily usage counter so the
// UI can show "X / 3 used" and pop the out-of-scans upsell BEFORE spending a
// recognition attempt. The authoritative gate is still the server RPC
// consume_recognize_meal_quota() (migration 174 / 229) — this only mirrors the
// per-user/day count for display + a pre-emptive check.
//
// Note: owner/tester-exempt accounts (migration 231) never increment the
// counter, so their count stays 0 and they are never pre-empted — exactly what
// we want (they have unlimited scans).

import { supabase } from '@/api/supabaseClient';

// Mirrors v_cap in consume_recognize_meal_quota() (migration 229). If the
// server cap changes, update here too — but the server stays authoritative,
// so a mismatch only affects the pre-emptive check, never correctness.
export const PHOTO_AI_DAILY_CAP = 3;

// The counter keys on the UTC day (the RPC uses now() AT TIME ZONE 'utc').
function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

// Recognitions the user has consumed today. Fails OPEN (returns 0) on any error
// so a counter-read hiccup can never block the feature.
export async function getPhotoAiUsedToday(userId) {
  if (!userId) return 0;
  try {
    const { data, error } = await supabase
      .from('recognize_meal_quota')
      .select('call_count')
      .eq('user_id', userId)
      .eq('day', utcDay())
      .maybeSingle();
    if (error) return 0;
    return Number(data?.call_count) || 0;
  } catch {
    return 0;
  }
}

// True once the user has consumed their whole daily allotment.
export async function isPhotoAiLimitReached(userId, cap = PHOTO_AI_DAILY_CAP) {
  const used = await getPhotoAiUsedToday(userId);
  return used >= cap;
}
