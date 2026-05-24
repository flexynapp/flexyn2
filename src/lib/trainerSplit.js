// src/lib/trainerSplit.js
//
// Platform-fee split math, mirrored from the checkout Edge Function
// (supabase/functions/checkout-session/index.ts). Used client-side to
// PREVIEW the breakdown before checkout — the authoritative split is
// always recomputed server-side from the listing price, never trusted
// from the client.

export const PLATFORM_CUT_PERCENT = 0.15;

export function calculateSplit(priceCents) {
  const cents = Math.max(0, Math.round(Number(priceCents) || 0));
  const platformFeeCents = Math.round(cents * PLATFORM_CUT_PERCENT);
  const trainerPayoutCents = cents - platformFeeCents;
  return { platformFeeCents, trainerPayoutCents };
}

/** Format integer cents as "$12.00". */
export function formatCents(cents) {
  const n = Number(cents) || 0;
  return `$${(n / 100).toFixed(2)}`;
}

/** Parse a "$12.00" / "12" / "12.5" dollar string to integer cents. */
export function dollarsToCents(input) {
  const cleaned = String(input ?? '').replace(/[^0-9.]/g, '');
  const dollars = parseFloat(cleaned);
  if (!Number.isFinite(dollars) || dollars < 0) return 0;
  return Math.round(dollars * 100);
}
