// src/lib/data/tradeOffers.js
//
// Real trade offers, backed by public.trade_offers (migration 253).
//
// This replaces a flow where a "trade" was a DM containing a JSON blob and
// "accept" was a text reply — nothing moved, and both parties were
// expected to hand-deliver afterwards. Every function here goes through a
// SECURITY DEFINER RPC that escrows, validates and swaps in one
// transaction.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { reportError } from '@/lib/reportError';

/**
 * Human copy for the exceptions raised by the 253 RPCs. Raw Postgres
 * messages leak schema detail and read like a stack trace; every branch
 * here is a real state a user can legitimately hit.
 */
export function tradeErrorMessage(err) {
  const msg = err?.message || '';
  if (/not_authenticated/.test(msg))           return 'Sign in to trade.';
  if (/cannot_trade_with_self/.test(msg))      return "You can't trade with yourself.";
  if (/offer_item_not_found/.test(msg))        return 'That item is no longer in your bag.';
  if (/not_your_item/.test(msg))               return "That item isn't yours.";
  if (/offer_item_in_escrow/.test(msg))        return "You've already offered that item in another trade.";
  if (/offer_item_is_listed/.test(msg))        return 'Unlist that item before offering it.';
  if (/target_item_not_found/.test(msg))       return 'That item no longer exists.';
  if (/target_item_in_escrow/.test(msg))       return 'That item is tied up in another trade right now.';
  if (/offer_not_found/.test(msg))             return 'That offer no longer exists.';
  if (/not_your_offer/.test(msg))              return "That offer isn't addressed to you.";
  if (/offer_not_pending/.test(msg))           return 'That offer has already been answered.';
  if (/item_no_longer_exists/.test(msg))       return 'One of the items is gone — the trade was cancelled.';
  if (/offer_item_changed_hands/.test(msg))    return 'They no longer own the item they offered.';
  if (/offer_item_not_escrowed/.test(msg))     return 'That offer expired — ask them to send it again.';
  if (/your_item_changed_hands/.test(msg))     return 'You no longer own the item they asked for.';
  if (/your_item_in_escrow/.test(msg))         return "Your item is tied up in another trade — resolve that one first.";
  if (/item_in_escrow/.test(msg))              return "That item is locked in a trade offer and can't be sold.";
  return 'Trade failed — try again.';
}

/**
 * Send an offer. Escrows the offered item server-side before the row is
 * even visible to the recipient, so it cannot also be sold or promised
 * elsewhere while the offer is open.
 *
 * @returns {Promise<string>} the new offer id
 */
export async function createOffer({ fromInventoryId, toInventoryId, listingId = null }) {
  const { data, error } = await supabase.rpc('create_trade_offer', {
    p_from_inventory_id: fromInventoryId,
    p_to_inventory_id:   toInventoryId,
    p_listing_id:        listingId,
  });
  if (error) {
    reportError(error, { feature: 'trade.create', level: 'warning' });
    throw error;
  }
  return data;
}

/** Accept or decline. Accepting performs the swap atomically. */
export async function respond(offerId, accept) {
  const { data, error } = await supabase.rpc('respond_to_trade_offer', {
    p_offer_id: offerId,
    p_accept:   accept,
  });
  if (error) {
    reportError(error, { feature: 'trade.respond', level: 'warning', offerId });
    throw error;
  }
  return data;
}

/** Sender pulls a pending offer back and releases the escrow. */
export async function cancel(offerId) {
  const { data, error } = await supabase.rpc('cancel_trade_offer', {
    p_offer_id: offerId,
  });
  if (error) {
    reportError(error, { feature: 'trade.cancel', level: 'warning', offerId });
    throw error;
  }
  return data;
}

const OFFER_COLUMNS = [
  'id', 'from_user_id', 'to_user_id', 'from_inventory_id', 'to_inventory_id',
  'listing_id', 'status', 'created_at', 'responded_at',
  'from_item_id', 'from_item_name', 'from_item_emoji', 'from_item_rarity',
  'to_item_id', 'to_item_name', 'to_item_emoji', 'to_item_rarity',
];

/**
 * Every offer this user sent or received, newest first.
 *
 * RLS already scopes to the two parties, so no user filter is needed here
 * — and adding one keyed on email would have re-introduced the guest-account
 * hole that listBySeller documents (guests carry an empty auth.email()).
 */
export async function listMine(limit = 100) {
  const { data, error } = await safeSelect({
    columns: OFFER_COLUMNS,
    build: (cols) => supabase
      .from('trade_offers')
      .select(cols)
      .order('created_at', { ascending: false })
      .limit(limit),
  });
  if (error) {
    // Pre-253 hosts have no table. Return empty so TradeHistory renders
    // its empty state rather than an error screen.
    if (error.code === '42P01') return [];
    reportError(error, { feature: 'trade.list', level: 'warning' });
    return [];
  }
  return data ?? [];
}

/** A single offer by id — used to resolve a DM card against live state. */
export async function getById(offerId) {
  if (!offerId) return null;
  const { data, error } = await safeSelect({
    columns: OFFER_COLUMNS,
    build: (cols) => supabase
      .from('trade_offers')
      .select(cols)
      .eq('id', offerId)
      .maybeSingle(),
  });
  if (error) return null;
  return data ?? null;
}

/** True when the string looks like a UUID — i.e. a real offer row. */
export function isRealOfferId(id) {
  return typeof id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
