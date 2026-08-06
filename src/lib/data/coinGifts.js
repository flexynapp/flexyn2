// src/lib/data/coinGifts.js
//
// Peer-to-peer flex-coin gifting. Sender debits their own balance,
// recipient gets the coins + an in-app notification (push fan-out when
// secrets are configured).
//
// Server enforces: balance check, 1..10000 per gift cap, atomic debit
// + credit + audit row + notification all in one tx. See migration
// 124_coin_gifting.sql.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';


/**
 * Send flex coins to another user.
 *
 * @param {object} opts
 * @param {string} opts.recipientId  recipient user_profiles.id (UUID)
 * @param {number} opts.amount       1..10000
 * @param {string} [opts.message]    optional short note
 * @returns {Promise<{ ok: boolean, giftId?: string, error?: string, balance?: number }>}
 */
export async function giftCoins({ recipientId, amount, message } = {}) {
  if (!recipientId || !Number.isFinite(amount) || amount < 1) {
    return { ok: false, error: 'INVALID' };
  }
  const { data, error } = await supabase.rpc('gift_flex_coins', {
    p_recipient_id: recipientId,
    p_amount:       Math.floor(amount),
    p_message:      message || null,
  });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') {
      // Pre-124 host — RPC missing.
      return { ok: false, error: 'PIPELINE_MISSING' };
    }
    return { ok: false, error: error.message || 'UNKNOWN' };
  }
  // RPC returns a jsonb shape: { ok, ... }
  return data || { ok: false, error: 'EMPTY' };
}

/**
 * Fetch the caller's coin-gift history (sent + received). Used for an
 * audit view in Settings or HubProfile.
 *
 * @param {object} opts
 * @param {'sent'|'received'|'all'} [opts.direction='all']
 * @param {number} [opts.limit=20]
 */
export async function listMyGifts({ direction = 'all', limit = 20 } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return [];
  const { data, error } = await safeSelect({
    columns: ['id', 'sender_id', 'recipient_id', 'amount', 'message', 'created_at'],
    // Built fresh per attempt, including the direction filter: safeSelect
    // may retry, and a supabase query builder is single-use.
    build: (cols) => {
      const q = supabase
        .from('coin_gifts')
        .select(cols)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (direction === 'sent')     return q.eq('sender_id', user.id);
      if (direction === 'received') return q.eq('recipient_id', user.id);
      return q;
    },
  });
  if (error) return [];
  return data || [];
}
