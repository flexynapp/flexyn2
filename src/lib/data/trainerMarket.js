// src/lib/data/trainerMarket.js
//
// Client data layer for the Creator/Trainer Tier (migration 143).
// Talks to trainer_listings / trainer_purchases + the checkout-session
// Edge Function. Every read fails closed (returns [] / null / {ok:false})
// on pre-143 hosts so the UI degrades gracefully when the migration
// hasn't been deployed.

import { supabase } from '@/api/supabaseClient';

const MISSING = (code) => code === '42883' || code === '42P01' || code === '42703' || code === 'PGRST205';

// ── Trainer status ─────────────────────────────────────────────────
/** Flip the calling user into a trainer so they can publish listings. */
export async function becomeTrainer(bio = null) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, error: 'UNAUTHENTICATED' };
  const patch = { is_trainer: true };
  if (bio != null) patch.trainer_bio = bio;
  const { error } = await supabase.from('user_profiles').update(patch).eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── Trainer-side: manage own listings ──────────────────────────────
export async function getMyListings(trainerId) {
  if (!trainerId) return [];
  const { data, error } = await supabase
    .from('trainer_listings')
    .select('id, regimen_id, title, description, price_cents, is_published, sales_count, gross_cents, created_at')
    .eq('trainer_id', trainerId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

export async function createListing({ trainerId, regimenId, title, description, priceCents }) {
  if (!trainerId) return { ok: false, error: 'UNAUTHENTICATED' };
  if (!title?.trim()) return { ok: false, error: 'TITLE_REQUIRED' };
  if (!Number.isFinite(priceCents) || priceCents < 100) return { ok: false, error: 'PRICE_TOO_LOW' };
  const { data, error } = await supabase
    .from('trainer_listings')
    .insert({
      trainer_id:  trainerId,
      regimen_id:  regimenId || null,
      title:       title.trim().slice(0, 120),
      description: description?.trim().slice(0, 2000) || null,
      price_cents: priceCents,
      is_published: false,
    })
    .select('id')
    .single();
  if (error) {
    if (MISSING(error.code)) return { ok: false, error: 'PIPELINE_MISSING' };
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data.id };
}

export async function updateListing(listingId, patch) {
  if (!listingId) return { ok: false };
  const clean = {};
  if (patch.title       !== undefined) clean.title       = String(patch.title).trim().slice(0, 120);
  if (patch.description !== undefined) clean.description = patch.description?.trim().slice(0, 2000) || null;
  if (patch.priceCents  !== undefined) clean.price_cents = patch.priceCents;
  if (patch.regimenId   !== undefined) clean.regimen_id  = patch.regimenId || null;
  clean.updated_at = new Date().toISOString();
  const { error } = await supabase.from('trainer_listings').update(clean).eq('id', listingId);
  return { ok: !error, error: error?.message };
}

export async function setPublished(listingId, isPublished) {
  if (!listingId) return { ok: false };
  const { error } = await supabase
    .from('trainer_listings')
    .update({ is_published: !!isPublished, updated_at: new Date().toISOString() })
    .eq('id', listingId);
  return { ok: !error, error: error?.message };
}

export async function deleteListing(listingId) {
  if (!listingId) return { ok: false };
  const { error } = await supabase.from('trainer_listings').delete().eq('id', listingId);
  return { ok: !error, error: error?.message };
}

/** Aggregate revenue for the studio dashboard. */
export async function getMyRevenue() {
  const { data, error } = await supabase.rpc('get_my_trainer_revenue');
  if (error) {
    if (MISSING(error.code)) return { gross_cents: 0, payout_cents: 0, fee_cents: 0, sales: 0 };
    return { gross_cents: 0, payout_cents: 0, fee_cents: 0, sales: 0 };
  }
  return {
    gross_cents:  Number(data?.gross_cents)  || 0,
    payout_cents: Number(data?.payout_cents) || 0,
    fee_cents:    Number(data?.fee_cents)    || 0,
    sales:        Number(data?.sales)        || 0,
  };
}

// ── Consumer-side: browse + own ────────────────────────────────────
/** Published listings for the storefront grid. */
export async function listPublishedListings() {
  const { data, error } = await supabase
    .from('trainer_listings')
    .select('id, trainer_id, regimen_id, title, description, price_cents, sales_count, created_at')
    .eq('is_published', true)
    .order('sales_count', { ascending: false })
    .limit(100);
  if (error) return [];
  return data || [];
}

/** Listing ids the current user has purchased — drives "owned" state. */
export async function listMyPurchasedListingIds(userId) {
  if (!userId) return new Set();
  const { data, error } = await supabase
    .from('trainer_purchases')
    .select('listing_id')
    .eq('user_id', userId);
  if (error) return new Set();
  return new Set((data || []).map(r => r.listing_id));
}

/**
 * Start checkout for a listing. Invokes the checkout-session Edge
 * Function. In mock mode (no Stripe key) this fulfills immediately and
 * resolves to { ok, mock, purchase }. In live mode it would return a
 * Stripe client_secret for the frontend to confirm.
 */
export async function startCheckout(listingId) {
  if (!listingId) return { ok: false, error: 'NO_LISTING' };
  const { data, error } = await supabase.functions.invoke('checkout-session', {
    body: { listing_id: listingId },
  });
  if (error) return { ok: false, error: error.message || 'CHECKOUT_FAILED' };
  return data || { ok: false, error: 'EMPTY_RESPONSE' };
}
