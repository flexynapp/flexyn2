// src/lib/data/crewTreasury.js
//
// The crew treasury and its perk shop (migration 251).
//
// Wars and challenges now pay the crew as well as its members, and a leader
// can spend that balance on something everyone keeps. Every movement is
// written to crew_treasury_ledger with the balance after it, so "where did
// it go" is answerable and not just "who funded it".
//
// As with every other crew module, there is no client write path: the
// balance lives on crews (pinned by crews_guard_write), the ledger and the
// purchase rows have INSERT/UPDATE/DELETE revoked from `authenticated`, and
// purchase_crew_perk is the only door. A leader spending the treasury is a
// server action with a price attached, not a client-side decrement.

import { supabase } from '@/api/supabaseClient';
import { enT } from '@/lib/translatorArg';

function notDeployed(error) {
  return error?.code === '42883' || error?.code === '42P01';
}

/**
 * Balance, the perk catalogue priced for THIS crew, and the recent ledger.
 *
 * Returns null for a non-member (the server decides that) and for a host
 * that hasn't run 251 yet, so the panel hides rather than rendering an
 * empty shop.
 *
 * Perk rows arrive with `price` already escalated for how many the crew
 * owns, plus `affordable` and `maxed`, so the UI never has to recompute
 * pricing and can't disagree with what the purchase RPC will charge.
 */
export async function getTreasury(crewId) {
  if (!crewId) return null;

  const { data, error } = await supabase.rpc('get_crew_treasury', {
    p_crew_id: crewId,
  });

  if (error) {
    if (!notDeployed(error)) console.warn('[crewTreasury] getTreasury failed:', error);
    return null;
  }
  if (!data) return null;

  return {
    balance:     Number(data.balance) || 0,
    maxCapacity: Number(data.max_capacity) || 16,
    perks:       Array.isArray(data.perks)  ? data.perks  : [],
    ledger:      Array.isArray(data.ledger) ? data.ledger : [],
  };
}

/**
 * Buy a perk with crew funds (leader only, enforced server-side).
 *
 * The RPC re-reads the balance and the owned count under a row lock on the
 * crew before charging, so two leaders tapping at the same instant can't
 * buy the same seat twice out of one balance. That means 'insufficient' and
 * 'maxed' can come back even when the screen said otherwise — they're
 * normal outcomes, not errors, and are returned rather than thrown.
 */
export async function purchasePerk(crewId, perkKey) {
  if (!crewId || !perkKey) return { ok: false, reason: 'missing' };

  const { data, error } = await supabase.rpc('purchase_crew_perk', {
    p_crew_id:  crewId,
    p_perk_key: perkKey,
  });

  if (error) {
    if (error.code === '42501') return { ok: false, reason: 'not_leader' };
    if (notDeployed(error))     return { ok: false, reason: 'not_deployed' };
    console.warn('[crewTreasury] purchasePerk failed:', error);
    return { ok: false, reason: 'db_error' };
  }

  if (data?.ok !== true) {
    return {
      ok: false,
      reason:  data?.reason ?? 'db_error',
      price:   data?.price ?? null,
      balance: data?.balance ?? null,
    };
  }

  return {
    ok:      true,
    perkKey: data.perk_key ?? perkKey,
    price:   Number(data.price) || 0,
    balance: Number(data.balance) || 0,
    owned:   Number(data.owned) || 0,
  };
}

/**
 * Human wording for a ledger row's `reason`.
 *
 * Deposits are stored as the bare result ('win', 'loss', 'draw',
 * 'challenge') and spends as 'perk:<key>', because the database should
 * record what happened, not a sentence — the sentence is a display concern
 * and has to be translatable.
 */
export function describeLedgerReason(reason, tFallback) {
  const t = tFallback || enT;
  if (typeof reason !== 'string') return t('treasury.unknown', 'Adjustment');

  if (reason.startsWith('perk:')) {
    const key = reason.slice(5);
    if (key === 'extra_seat')  return t('treasury.boughtSeat',   'Bought a seat');
    if (key === 'crew_banner') return t('treasury.boughtBanner', 'Bought the banner');
    return t('treasury.boughtPerk', 'Bought a perk');
  }

  switch (reason) {
    case 'win':       return t('treasury.warWon',    'War won');
    case 'loss':      return t('treasury.warLost',   'War fought');
    case 'draw':      return t('treasury.warDrawn',  'War drawn');
    case 'challenge': return t('treasury.challenge', 'Challenge completed');
    default:          return t('treasury.unknown',   'Adjustment');
  }
}
