// supabase/functions/checkout-session/index.ts
//
// Trainer-tier checkout. Calculates the 15% platform split and
// fulfills a purchase of a paywalled trainer_listing.
//
// ── TWO MODES ────────────────────────────────────────────────────────
//
//   MOCK MODE (default, while STRIPE_SECRET_KEY is unset):
//     Skips the real Stripe charge, mints a mock payment-intent id,
//     and writes the trainer_purchases row immediately via the
//     service-role client. This makes the gated-content flow work
//     end-to-end for the prototype with no payments infrastructure.
//     Every mock row is tagged is_mock = TRUE so it can be filtered
//     / purged before going live.
//
//   LIVE MODE (when STRIPE_SECRET_KEY is set):
//     Creates a Stripe PaymentIntent with application_fee_amount +
//     transfer_data[destination] = the trainer's connected account,
//     so Stripe performs the split at the payment layer. Fulfillment
//     then happens in the stripe-webhook function on
//     payment_intent.succeeded — NOT here. This function returns the
//     client_secret for the frontend to confirm. (Scaffolded below
//     with the exact call shape; it is never reached until the key
//     is configured.)
//
// ── SETUP (when ready to go live) ────────────────────────────────────
//   1. supabase secrets set STRIPE_SECRET_KEY="sk_live_..."
//   2. Implement the stripe-webhook function for fulfillment.
//   3. Trainers complete Stripe Connect onboarding so
//      user_profiles.stripe_connect_id is populated.
//   4. supabase functions deploy checkout-session
//
// ── Request shape ────────────────────────────────────────────────────
//   POST  Authorization: Bearer <user JWT>
//   { "listing_id": "<uuid>" }
//
// ── Response (mock mode) ─────────────────────────────────────────────
//   { "ok": true, "mock": true, "purchase": { ...row } }
//   { "ok": false, "error": "ALREADY_OWNED" }
//   { "ok": false, "error": "NOT_PUBLISHED" }
//   { "ok": false, "error": "UNAUTHORIZED" }

// @ts-ignore — Deno runtime
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PLATFORM_CUT_PERCENT = 0.15;

// Shared split math — kept in sync with src/lib/trainerSplit.js on the
// client (which previews the breakdown before checkout).
export function calculateSplit(priceCents: number) {
  const platformFeeCents = Math.round(priceCents * PLATFORM_CUT_PERCENT);
  const trainerPayoutCents = priceCents - platformFeeCents;
  return { platformFeeCents, trainerPayoutCents };
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// @ts-ignore — Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  // @ts-ignore — Deno env
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  // @ts-ignore — Deno env
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  // @ts-ignore — Deno env
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  // Mock mode is opt-in via an EXPLICIT env var. Previously mock-mode
  // was selected purely by the ABSENCE of STRIPE_SECRET_KEY — meaning
  // a no-Stripe-key deploy to production silently shipped every paid
  // listing as free (any authenticated user could call this Edge
  // Function and receive a permanent trainer_purchases row granting
  // paid-content access; RLS honors `is_mock=true` rows identically
  // to paid ones). Now: a deploy without EITHER a Stripe key OR
  // ALLOW_MOCK_CHECKOUT=true returns SERVER_MISCONFIGURED, so a
  // misconfigured prod fails closed.
  // @ts-ignore — Deno env
  const allowMock = (Deno.env.get('ALLOW_MOCK_CHECKOUT') || '').toLowerCase() === 'true';
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'SERVER_MISCONFIGURED' }, 500);
  }
  if (!stripeKey && !allowMock) {
    return json({ ok: false, error: 'PAYMENTS_NOT_CONFIGURED' }, 503);
  }

  // Resolve the caller from their JWT using an anon-scoped client.
  const userClient = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  let body: { listing_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'BAD_REQUEST' }, 400);
  }
  const listingId = body?.listing_id;
  if (!listingId) {
    return json({ ok: false, error: 'BAD_REQUEST' }, 400);
  }

  // Service-role client — trusted server boundary for reads + the
  // fulfillment write (bypasses RLS).
  const admin = createClient(supabaseUrl, serviceKey);

  // Load the listing. Price + trainer come from the DB, never the
  // client — so a tampered request can't change the amount charged.
  const { data: listing, error: listErr } = await admin
    .from('trainer_listings')
    .select('id, trainer_id, regimen_id, price_cents, is_published')
    .eq('id', listingId)
    .maybeSingle();
  if (listErr || !listing) {
    return json({ ok: false, error: 'NOT_FOUND' }, 404);
  }
  if (!listing.is_published) {
    return json({ ok: false, error: 'NOT_PUBLISHED' }, 409);
  }
  if (listing.trainer_id === user.id) {
    return json({ ok: false, error: 'CANNOT_BUY_OWN' }, 409);
  }

  // Already owned? UNIQUE(user_id, listing_id) also guards this, but we
  // check first for a clean error instead of a constraint violation.
  const { data: existing } = await admin
    .from('trainer_purchases')
    .select('id')
    .eq('user_id', user.id)
    .eq('listing_id', listingId)
    .maybeSingle();
  if (existing) {
    return json({ ok: false, error: 'ALREADY_OWNED' }, 409);
  }

  const price = listing.price_cents;
  const { platformFeeCents, trainerPayoutCents } = calculateSplit(price);

  // ── LIVE MODE (Stripe configured) ──────────────────────────────────
  if (stripeKey) {
    // Pull the trainer's connected account for the destination split.
    const { data: trainer } = await admin
      .from('user_profiles')
      .select('stripe_connect_id')
      .eq('id', listing.trainer_id)
      .maybeSingle();
    if (!trainer?.stripe_connect_id) {
      return json({ ok: false, error: 'TRAINER_NOT_ONBOARDED' }, 409);
    }
    // ── Real Stripe PaymentIntent with native split ──────────────────
    // Fulfillment happens in the stripe-webhook function on
    // payment_intent.succeeded, which inserts the trainer_purchases
    // row with is_mock = FALSE. This block only creates the intent.
    //
    //   const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
    //   const intent = await stripe.paymentIntents.create({
    //     amount: price,
    //     currency: 'usd',
    //     application_fee_amount: platformFeeCents,
    //     transfer_data: { destination: trainer.stripe_connect_id },
    //     metadata: { listing_id: listingId, user_id: user.id,
    //                 trainer_id: listing.trainer_id,
    //                 regimen_id: listing.regimen_id ?? '' },
    //   });
    //   return json({ ok: true, mock: false, client_secret: intent.client_secret });
    return json({ ok: false, error: 'STRIPE_NOT_IMPLEMENTED' }, 501);
  }

  // ── MOCK MODE (no Stripe key) ───────────────────────────────────────
  // Simulate a successful charge and fulfill immediately so the
  // gated-content flow is demonstrable. Tagged is_mock = TRUE.
  const mockIntentId = `pi_mock_${crypto.randomUUID()}`;
  const { data: purchase, error: insErr } = await admin
    .from('trainer_purchases')
    .insert({
      user_id: user.id,
      listing_id: listingId,
      trainer_id: listing.trainer_id,
      regimen_id: listing.regimen_id,
      stripe_payment_intent_id: mockIntentId,
      amount_paid_cents: price,
      platform_fee_cents: platformFeeCents,
      trainer_payout_cents: trainerPayoutCents,
      is_mock: true,
    })
    .select('*')
    .single();
  if (insErr) {
    // 23505 = the UNIQUE(user,listing) raced us → already owned.
    if (insErr.code === '23505') {
      return json({ ok: false, error: 'ALREADY_OWNED' }, 409);
    }
    return json({ ok: false, error: 'FULFILLMENT_FAILED', detail: insErr.message }, 500);
  }

  return json({ ok: true, mock: true, purchase });
});
