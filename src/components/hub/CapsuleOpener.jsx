// src/components/hub/CapsuleOpener.jsx
// Premium capsule opening experience with slot-reel animation.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, BookOpen } from 'lucide-react';
import { toast } from '@/lib/toast';
import { ITEMS, BRANDED_ITEMS, getItemsByRarity, VARIANTS } from '@/lib/lootCatalog';
import { rarityTint } from '@/components/loot/RarityVisuals';
import CapsuleIcon from '@/components/loot/CapsuleIcon';
import { pickItemForRoll, buildCandidateMenu, hydrateItemById } from '@/lib/lootRoll';
import { LOOT_THEMES, getLootThemeById } from '@/lib/lootThemes';
import { LOOT_FRAMES } from '@/lib/lootFrames';
// LOOT_TITLES is still used by pickItemForRoll for title items.
import { LOOT_TITLES } from '@/lib/lootTitles';
import { THEMES_ENABLED } from '@/lib/featureFlags';
import { tileRow } from '@/lib/tileRows';
import { buildLabel, copyDiagnostics } from '@/lib/buildInfo';
import { supabase } from '@/api/supabaseClient';
import { triggerHaptic } from '@/lib/haptic';
import StickerDisplay from './StickerDisplay';
import CapsuleRarityOdds from './CapsuleRarityOdds';
import CapsuleStreak from './CapsuleStreak';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

// The capsule's "what's in here?" link now opens the same Collection
// surface as the Marketplace and the Bag, so the odds you just read
// sit next to the slots you haven't filled.
const CollectionModal = lazy(() => import('@/components/loot/CollectionModal'));

// ─── Constants ────────────────────────────────────────────────────────────────
// The batch haul: 3 cards per row on a phone, 5 from sm. Wrapped and centred
// rather than laid out on grid tracks — see src/lib/tileRows.js for why every
// collection in the app is built this way.
const HAUL = tileRow({ gap: 2, cols: 3, smCols: 5 });

const CARD_W     = 130; // px
const CARD_GAP   = 12;  // px
// Stride is derived per-reel now (CapsuleReel takes a cardW), because a
// stacked batch renders smaller cards than a single open.
// The winning slot is NOT a constant. It used to be: every reel was 22
// cards with the win pinned at index 18, so every spin travelled exactly
// the same distance and the only thing that changed between opens was the
// easing curve. Users read that as "it's the same spin every time, just a
// different item" — which it was. See buildReel.

// ─── The spin ─────────────────────────────────────────────────────────────────
// ONE curve, always.
//
// There used to be five "personas" with different durations AND different
// easings, on the theory that varying the animation kept repeat opens
// interesting. It did the opposite: the feel changed spin to spin, and one
// of them was actively broken. `snap` used cubic-bezier(0.5, 0, 0.75, 0.2)
// — an ease-IN curve, whose derivative is still high at t=1. The reel was
// travelling at speed the instant it stopped. That is a cut, not a settle,
// and it's what "cuts and stops" described.
//
// So the character is now fixed and smooth: a strong ease-out whose
// terminal velocity is effectively zero, meaning every reel glides into
// its stop. Every reel in a stack shares it, so a four-high stack reads as
// one coherent motion instead of four different animations racing.
//
// Variety comes from WHERE IT LANDS instead — see LANDING_JITTER. The
// centre line settles on a different part of the winning card each time,
// which is what a real reel does and what sells the randomness. Changing
// the destination costs nothing in smoothness; changing the curve cost
// everything.
//
// Curve choice, since it's the whole point: for a cubic-bezier(x1,y1,x2,y2)
// the start velocity is y1/x1 and the end velocity is (1-y2)/(1-x2). The
// reel begins at a standstill and must come to rest, so BOTH need to be 0.
//
//   snap  (0.5, 0, 0.75, 0.2)  end = 0.8/0.25 = 3.2  → moving fast at the
//                                                      stop. The "cut".
//   easeOutQuint (0.22, 1, ...) start = 1/0.22 = 4.5 → snaps into motion.
//
// This one is 0 at both ends, with P2 pulled far left so most of the travel
// happens early and the last stretch is a long, slow glide into the
// indicator — the anticipation a reel is supposed to have.
const SPIN_EASING = 'cubic-bezier(0.32, 0, 0.06, 1)';
const SPIN_DURATION = 3.6;   // seconds, before the per-reel jitter below

// Small timing jitter ONLY. Same curve, slightly different lengths, so a
// stack doesn't land in mechanical unison — a difference in when, never in
// how.
const SPIN_DURATION_JITTER = 0.45;

// How far off-centre the indicator may stop within the winning card, as a
// fraction of card width. Kept under half so the line is unambiguously on
// the winner and never straddles a neighbour.
const LANDING_JITTER = 0.32;

const SPIN_KICKERS = ['Rolling…', 'Building up…', 'Cracking…', 'Spinning…', 'Locking in…'];

// Caption only. Text variety is free and cannot affect how the spin feels.
function pickKicker() {
  return SPIN_KICKERS[Math.floor(Math.random() * SPIN_KICKERS.length)];
}

/** A spin's timing + where in the card it settles. Same curve every time. */
function makeSpin() {
  return {
    duration: SPIN_DURATION + (Math.random() * 2 - 1) * SPIN_DURATION_JITTER,
    easing: SPIN_EASING,
    // -1..1 → left edge .. right edge of the allowed band.
    landing: (Math.random() * 2 - 1) * LANDING_JITTER,
    kicker: pickKicker(),
  };
}

// ─── Rarity ladder ────────────────────────────────────────────────────────────
// Declared up here because buildReel's near-miss seeding reads it. Keeping
// it below would trip no-use-before-define, which this repo treats as a
// real hazard after the 2026-05-23 production TDZ crash.
const RARITY_LADDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'animated'];
function rarityRank(r) {
  const i = RARITY_LADDER.indexOf(r);
  return i < 0 ? 0 : i;
}

const LEGENDARY_RANK = RARITY_LADDER.indexOf('legendary');

// Gold is the LEGENDARY tier's own treatment — brushed metal instead of an
// amber outline. Mythic and animated keep their rose/pink identity, which
// the badge, the bag and the marketplace all use; painting them gold too
// would make the top of the ladder read as one undifferentiated tier.
const GOLD_RIM  = '#fcd34d';
const GOLD_GLOW = 'rgba(252, 211, 77, 0.55)';
export function isGoldCard(rarity) {
  return rarity === 'legendary';
}

// …but the ENCORE is for legendary AND everything above it. A mythic pull
// is rarer than a legendary one; it would be absurd for it to get less of
// a moment. The encore reel draws from this same shelf, so nothing below
// legendary ever appears in it.
export function isEncoreTier(rarity) {
  return rarityRank(rarity) >= LEGENDARY_RANK;
}

// ─── Reel filler pool ─────────────────────────────────────────────────────────
// EVERY droppable cosmetic, grouped by rarity.
//
// This used to draw from ITEMS stickers only — 19 entries, of which just
// FIVE are common. With the cold weight table putting ~52% of cards in the
// common tier, roughly half of every reel was drawn from a five-item pool,
// so the same handful of icons streamed past on every single spin and only
// the prize at the end differed. Reported by the user, and the numbers back
// it up exactly.
//
// It was wrong on a second axis too: capsules can drop titles, frames and
// themes (see pickItemForRoll), but the reel only ever showed stickers —
// so the run-up never previewed three of the four things you can actually
// win. Folding in BRANDED_ITEMS and the title/frame/theme catalogs takes
// the pool from 19 to ~110 and puts every winnable category on the reel.
const FILLER_POOL = (() => {
  const byRarity = {};
  const seen = new Set();
  const push = (item) => {
    if (!item?.id || !item.rarity || seen.has(item.id)) return;
    seen.add(item.id);
    (byRarity[item.rarity] ||= []).push(item);
  };
  ITEMS.filter(i => i.type === 'sticker').forEach(push);
  BRANDED_ITEMS.forEach(push);
  (LOOT_TITLES || []).forEach(push);
  (LOOT_FRAMES || []).forEach(push);
  // Themes are off (src/lib/featureFlags.js + migration 281). The whole
  // point of the wide filler pool is that the reel previews what you can
  // actually win — streaming themes past someone who can no longer win
  // one inverts that and turns the run-up into a tease.
  if (THEMES_ENABLED) (LOOT_THEMES || []).forEach(push);
  return byRarity;
})();

// Two tables instead of one. A "cold" reel is mostly commons and greys past
// the window; a "hot" reel is stacked with epics and legendaries so the
// run-up looks like it might be building to something. Each spin picks a
// heat value and interpolates, so consecutive opens don't just differ in
// speed — they differ in what streams past your eyes.
const FILLER_COLD = { common: 52, uncommon: 30, rare: 12, epic: 5,  legendary: 1,  animated: 0 };
const FILLER_HOT  = { common: 14, uncommon: 24, rare: 28, epic: 20, legendary: 10, animated: 4 };

function fillerWeights(heat) {
  const out = {};
  for (const k of Object.keys(FILLER_COLD)) {
    out[k] = FILLER_COLD[k] + (FILLER_HOT[k] - FILLER_COLD[k]) * heat;
  }
  return out;
}

/**
 * Draw one filler card.
 *
 * `used` makes the draw WITHOUT REPLACEMENT across the reel: an item that
 * has already streamed past won't come back. With a 19-item pool that was
 * impossible; with ~110 it's the single biggest contributor to a reel
 * feeling fresh. Falls back to the full tier once it's exhausted, so a
 * sparse rarity can never deadlock the draw.
 */
function weightedRandomItem(weights, used) {
  const w = weights || FILLER_COLD;
  const totalWeight = Object.values(w).reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;
  for (const [rarity, weight] of Object.entries(w)) {
    roll -= weight;
    if (roll <= 0) {
      const pool = FILLER_POOL[rarity];
      if (!pool || pool.length === 0) break;
      const fresh = used ? pool.filter(i => !used.has(i.id)) : pool;
      if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];
      // Tier exhausted (animated has a single entry, legendary only a
      // handful). Borrow an unused item from ANY tier rather than
      // repeating one that already streamed past — a visible repeat is
      // the exact thing this whole pool rework is meant to remove.
      break;
    }
  }
  const anyUnused = Object.values(FILLER_POOL)
    .flat()
    .filter(i => !used || !used.has(i.id));
  if (anyUnused.length) return anyUnused[Math.floor(Math.random() * anyUnused.length)];
  const fallback = FILLER_POOL.common || [];
  return fallback[Math.floor(Math.random() * fallback.length)] || null;
}

/** A sticker one tier above the win, for seeding a near-miss. */
function nearMissItem(winRarity, used) {
  const idx = RARITY_LADDER.indexOf(winRarity);
  for (let step = 1; step <= 2; step++) {
    const target = RARITY_LADDER[idx + step];
    if (!target) break;
    const pool = (FILLER_POOL[target] || []).filter(i => !used || !used.has(i.id));
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  return null;
}

// ─── Build a reel ─────────────────────────────────────────────────────────────
// Everything about the shape is rolled per spin. Previously this returned a
// fixed 22-card array — [17 fillers][???][win][3 fillers] — which meant:
//
//   • the travel distance was byte-identical on every open, so the spin
//     "felt" the same no matter which easing variant was picked;
//   • the ??? card sat immediately before the prize EVERY time, so once
//     you'd seen two opens you knew the next card after ??? was yours —
//     the reveal was spoiled a full card early, every single time.
//
// Now the win index, the reel length, whether a ??? appears at all and
// where, the filler heat, and whether a near-miss is seeded next to the
// win are all independent rolls.
//
// Returns { cards, winIndex } — winIndex is no longer a constant, so the
// caller must thread it through to both the scroll offset and the
// highlight.
export function buildReel(winItem) {
  // 12..26 cards before the prize. At a 142px stride that's a ~2000px swing
  // in travel between the shortest and longest reel — the same easing curve
  // reads completely differently across that range.
  const lead    = 12 + Math.floor(Math.random() * 15);
  const trail   = 3 + Math.floor(Math.random() * 4);
  const heat    = Math.random();
  const weights = fillerWeights(heat);

  const placeholder = { id: '__filler__', emoji: '✨', name: '???', rarity: 'common', type: 'sticker' };

  // Avoid back-to-back duplicates so the reel doesn't look like the same
  // card slid by twice — naive Math.random() repeats ~5% of the time and
  // the jitter is obvious during a slow 'tease' spin. Bounded retries so a
  // sparse catalog can't deadlock the loop.
  // Draw without replacement across this reel. Seeded with the PRIZE so no
  // filler can show the same item you're about to win — seeing your reward
  // slide past twice reads as a rendering bug and deflates the reveal.
  const used = new Set([winItem.id]);
  const safeFiller = (prev) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const next = weightedRandomItem(weights, used);
      if (!next) return placeholder;
      if (!prev || next.id !== prev.id) {
        used.add(next.id);
        return next;
      }
    }
    return placeholder;
  };

  // 1. Run-up.
  const cards = [];
  for (let i = 0; i < lead; i++) cards.push(safeFiller(cards[cards.length - 1]));

  // 2. The ??? teaser appears on ~55% of spins, and when it does it sits
  //    1-4 slots back rather than always in the slot immediately before the
  //    prize. Sometimes it's the last thing you see; sometimes it's long
  //    gone by the time the reel stops.
  if (Math.random() < 0.55) {
    const at = lead - (1 + Math.floor(Math.random() * 4));
    if (at >= 0) {
      cards[at] = { id: '__mystery__', emoji: '❓', name: '???', rarity: 'common', type: 'sticker' };
    }
  }

  // 3. Near miss: ~35% of spins park something RARER than the prize in the
  //    slot right before it, so the reel looks briefly like it's landing on
  //    better. Purely cosmetic — the server already decided the win.
  const wantsNearMiss = Math.random() < 0.35;
  if (wantsNearMiss && lead > 0) {
    const tease = nearMissItem(winItem.rarity, used);
    if (tease) { cards[lead - 1] = tease; used.add(tease.id); }
  }

  // 4. The prize, then the run-out.
  const winIndex = cards.length;
  cards.push(winItem);
  for (let i = 0; i < trail; i++) cards.push(safeFiller(cards[cards.length - 1]));

  // 5. Repair adjacent duplicates.
  //
  //    safeFiller only compares against the previous card AT GENERATION
  //    TIME, but steps 2 and 3 overwrite slots after the fact — so the ???
  //    teaser or the near-miss card can land next to an identical filler
  //    and produce the exact "same card slid by twice" jitter safeFiller
  //    exists to prevent. Caught by capsuleReel.test.js, not by eye.
  //
  //    The win slot is never touched: the server decided it.
  for (let i = 1; i < cards.length; i++) {
    if (i === winIndex || i - 1 === winIndex) continue;
    let guard = 0;
    while (cards[i].id === cards[i - 1].id && guard < 5) {
      cards[i] = safeFiller(cards[i - 1]);
      guard += 1;
    }
  }

  return { cards, winIndex };
}

// ─── The legendary encore ─────────────────────────────────────────────────────
// A gold pull gets a SECOND spin, and that reel contains nothing but gold.
//
// The normal reel is mostly commons by design — that's what makes the
// landing feel like it beat the odds. But it also means the biggest
// moment in the whole loop plays out identically to a 5-XP sticker: same
// grey run-up, same stop. The encore re-runs the spin with the run-up
// replaced by the legendary/mythic/animated shelf, so the thing you see
// streaming past is the company your prize now keeps.
//
// It is PURELY cosmetic and it re-lands on the SAME item. The server
// already granted it (open_capsule_atomic) before the first reel moved —
// nothing here can change, re-roll or re-grant a prize.
const GOLD_POOL = (() => {
  const pool = [];
  for (const rarity of RARITY_LADDER.slice(LEGENDARY_RANK)) {
    for (const item of FILLER_POOL[rarity] || []) pool.push(item);
  }
  return pool;
})();

/**
 * A reel of gold-tier cards only, landing on `winItem`.
 *
 * Draws WITH replacement, unlike buildReel: the gold shelf is ~11 items
 * across every catalog and a 12–20 card reel would exhaust it. Adjacent
 * repeats are still forbidden — a card sliding past twice in a row is the
 * thing that reads as a rendering bug.
 */
export function buildLegendaryReel(winItem) {
  // Shorter than a normal reel. This is the encore, not a second wait —
  // the user has already watched one spin and knows what they won.
  const lead  = 9 + Math.floor(Math.random() * 7);   // 9..15
  const trail = 3 + Math.floor(Math.random() * 3);   // 3..5
  const pool  = GOLD_POOL.filter(i => i.id !== winItem.id);

  const draw = (prev) => {
    if (pool.length === 0) return winItem;
    for (let attempt = 0; attempt < 6; attempt++) {
      const next = pool[Math.floor(Math.random() * pool.length)];
      if (!prev || next.id !== prev.id) return next;
    }
    return pool[0];
  };

  const cards = [];
  for (let i = 0; i < lead; i++) cards.push(draw(cards[cards.length - 1]));
  const winIndex = cards.length;
  cards.push(winItem);
  for (let i = 0; i < trail; i++) cards.push(draw(cards[cards.length - 1]));

  // Repair the two seams around the prize — draw() only ever compared
  // against the card before it, and the prize was inserted between.
  for (let i = 1; i < cards.length; i++) {
    let guard = 0;
    while (cards[i].id === cards[i - 1].id && guard < 6) {
      if (i === winIndex) { cards[i - 1] = draw(cards[i - 2]); }
      else                { cards[i]     = draw(cards[i - 1]); }
      guard += 1;
    }
  }

  return { cards, winIndex };
}

// ─── Rarity ranking + a single server-authoritative roll ──────────────────────
// Pulled out of handleOpen so one capsule and ten capsules share exactly
// one roll path. Every roll is its own claim_capsule_loot call (migration
// 028), which locks that capsule row and rolls server-side — batching is
// purely a UI affordance, it does not touch how loot is decided.
// Codes that mean "this function isn't deployed here".
// PGRST202 comes from PostgREST's schema cache before the request ever
// reaches Postgres; 42883/42P01 come from Postgres itself.
const MISSING_FN_CODES = new Set(['PGRST202', '42883', '42P01']);

async function rollOneCapsule(capsuleId) {
  // ── Atomic path (migration 255) ──────────────────────────────────────
  // One call spends the capsule AND grants the item. Nothing is owed
  // afterwards, so an interrupted reveal can no longer destroy loot.
  const { data, error } = await supabase.rpc('open_capsule_atomic', {
    p_capsule_id: capsuleId,
    p_candidates: buildCandidateMenu(),
  });

  if (!error) {
    if (!data) return null;
    const variant = (data.variant && VARIANTS && VARIANTS[data.variant]) ? data.variant : null;
    // Rehydrate the full catalog entry (description, theme preview, frame
    // css) from the id the server granted, then fall back to the server's own
    // fields if this bundle's catalog doesn't know the id.
    //
    // This used to call pickItemForRoll(category, rarity) — i.e. re-roll an
    // item of the same tier locally — and only accept it if it happened to
    // match data.item_id. Since migration 267 the server picks from
    // loot_catalog, so a local re-roll almost never matches, and every theme
    // and frame drop would have fallen through to the bare server fields and
    // lost its preview colours and CSS. Look up by id instead.
    const catalogItem = hydrateItemById(data.item_id, data.category);
    const base = catalogItem
      ? catalogItem
      : { id: data.item_id, name: data.item_name, emoji: data.item_emoji,
          rarity: data.rarity, type: data.item_type };
    const item = { ...base, rarity: data.rarity };
    return { item: variant ? { ...item, variant } : item, granted: true };
  }

  // ── Legacy two-step fallback ─────────────────────────────────────────
  // The frontend auto-deploys from main while the SQL is pasted by hand,
  // so a new client WILL meet a pre-255 database. Only "the function does
  // not exist" falls through; anything else is a real error.
  //
  // PGRST202 is the important one and it is easy to miss: a missing RPC
  // never reaches Postgres, so PostgREST answers from its schema cache
  // with PGRST202 rather than Postgres's 42883. Probing the undeployed
  // function returned exactly that, so a 42883-only check would have
  // thrown instead of falling back — breaking capsule opening for every
  // user in the window between the deploy and the SQL being run.
  if (!MISSING_FN_CODES.has(error.code)) {
    const e = new Error(error.message || 'open_capsule_atomic failed');
    e.missingRpc = false;
    throw e;
  }

  const legacy = await supabase.rpc('claim_capsule_loot', { p_capsule_id: capsuleId });
  if (legacy.error) {
    const e = new Error(legacy.error.message || 'claim_capsule_loot failed');
    // Pre-028 hosts fail closed. The removed alternative was a client-side
    // Math.random() roll, i.e. "open DevTools and force legendary".
    e.missingRpc = MISSING_FN_CODES.has(legacy.error.code);
    throw e;
  }
  const d = legacy.data;
  if (!d) return null;

  const variant = (d.variant && VARIANTS && VARIANTS[d.variant]) ? d.variant : null;
  let item = pickItemForRoll(d.category, d.rarity);
  if (!item) {
    const fallback = getItemsByRarity(d.rarity);
    item = fallback.length ? fallback[0] : null;
  }
  if (!item) return null;
  // granted:false — the caller must still finalize this one on Claim.
  return { item: variant ? { ...item, variant } : item, granted: false };
}

// ─── ItemCard ─────────────────────────────────────────────────────────────────
function ItemCard({ item, highlight = false, settled = false, width = CARD_W }) {
  const tint = rarityTint(item.rarity);
  const isMystery = item.id === '__mystery__';
  // A legendary renders as a gold card — brushed metal, gold rim, gold
  // bloom — so the card the reel stops on is unmistakably a gold one. A
  // rarity chip and a 2px border were the only difference between winning
  // a legendary and winning a 5-coin common, at 130px, in motion.
  const isGold = !isMystery && isGoldCard(item.rarity);
  return (
    <div
      className={[
        'flex-none flex flex-col items-center justify-center rounded-xl border-2 select-none',
        isGold ? 'reel-card-gold relative overflow-hidden' : (isMystery ? 'bg-secondary opacity-60' : 'bg-card'),
        settled ? 'reel-winner-settled' : '',
      ].join(' ')}
      style={{
        width,
        height: width,
        borderColor: isGold ? GOLD_RIM : tint.border,
        // The bloom keyframe drives box-shadow once settled, so don't fight
        // it with an inline one.
        boxShadow: settled
          ? undefined
          : (highlight ? (isGold ? `0 0 26px ${GOLD_GLOW}` : tint.glow) : undefined),
        '--bloom': isGold ? GOLD_GLOW : `${tint.color}80`,
      }}
    >
      <span className="relative leading-none mb-1" style={{ fontSize: Math.round(width * 0.3) }}>{item.emoji}</span>
      <span
        className={`relative font-semibold truncate px-1 ${isMystery ? 'text-muted-foreground' : 'text-foreground/80'}`}
        style={{ fontSize: Math.max(8, Math.round(width * 0.09)) }}
      >
        {item.name}
      </span>
      {!isMystery && width >= 100 && (
        <span
          className="relative mt-1 text-micro font-bold px-2 py-0.5 rounded-full"
          style={{
            color: isGold ? GOLD_RIM : tint.color,
            border: `1px solid ${isGold ? GOLD_RIM : tint.color}`,
          }}
        >
          {tint.label}
        </span>
      )}
    </div>
  );
}

// Honors prefers-reduced-motion at the component level — the OS toggle
// means "no infinite-loop ambient animation", which covers both the
// breathing capsule emoji and the twinkling starfield. Defined once so
// every animation site can branch on the same flag.
const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};

// ─── Star field backdrop ──────────────────────────────────────────────────────
function StarField() {
  const reduce = prefersReducedMotion();
  const stars = useMemo(() =>
    Array.from({ length: 60 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 0.5,
      opacity: Math.random() * 0.6 + 0.2,
      duration: Math.random() * 3 + 2,
    })),
  []);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {stars.map(s => (
        <motion.div
          key={s.id}
          className="absolute rounded-full bg-foreground"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, opacity: s.opacity }}
          // Honor reduced-motion — skip the infinite opacity tween so
          // a vestibular-sensitive user isn't subjected to 60 pulsing
          // dots behind the reel. Static dots still set the mood.
          animate={reduce ? undefined : { opacity: [s.opacity, s.opacity * 0.3, s.opacity] }}
          transition={reduce ? undefined : { duration: s.duration, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

// ─── Crate-unlock burst (Claude Design handoff) ───────────────────────────────
// A premium reveal flourish for ANY Rare+ loot item (sticker / title / frame /
// theme): scrim → crate shakes → lid pops → ray + particle burst, in the item's
// rarity colour. The design's own card is omitted — the existing reveal card
// below sits underneath and is revealed as the scrim fades. Tap to skip.
// The crate-unlock burst that used to play here has been removed. It fired
// a full-screen scrim + shaking crate + lid-pop + ray/particle explosion on
// every Rare+ pull, ON TOP OF the reveal card's own spring-in — two
// competing animations for one event, and the crate re-told a story the
// card was already telling. The tactile half was worth keeping, so the
// rarity-scaled haptic moved onto the reveal itself (see the effect in the
// component). Its ~170 lines of .unlock-* CSS are gone from index.css too.

// ─── One spinning reel ────────────────────────────────────────────────────────
// Self-contained so a batch can run SEVERAL at once, stacked. Previously the
// spin logic lived inline in the component via a single callback ref and
// module-level card constants, which meant exactly one reel could ever
// exist — so "open 6" played one animation and then flipped cards, instead
// of showing six reels actually spinning.
//
// Owns its own container measurement, double-RAF kick-off, CSS transition
// and transitionend teardown. `onSettled` fires once, when this reel's own
// transform finishes.
function CapsuleReel({ cards, winIndex, variant, cardW = CARD_W, speed = 1, onSettled }) {
  const containerRef = useRef(null);
  const settledRef   = useRef(false);
  const timerRef     = useRef(null);
  const [settled, setSettled] = useState(false);
  const stride = cardW + CARD_GAP;
  const dur = variant.duration * speed;

  // Settle exactly once, whichever signal arrives first.
  const settle = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setSettled(true);
    // A tick per reel, not per wave — in a stack of four this is what makes
    // each landing feel like its own event.
    triggerHaptic('primary');
    onSettled?.();
  }, [onSettled]);

  // Safety net. A wave only advances once EVERY reel in it reports back, so
  // one missed transitionend strands the user on a spinning modal with
  // their capsules already consumed. transitionend can genuinely go missing
  // — a backgrounded tab, a display:none ancestor, an interrupted
  // transition — and with four reels per wave there are now four chances
  // for that instead of one. Fires slightly after the animation should
  // have ended; `settle` dedupes against the real event.
  useEffect(() => {
    const ms = dur * 1000 + 600;
    timerRef.current = setTimeout(settle, ms);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [dur, settle]);

  const setTrackRef = useCallback((el) => {
    if (!el) return;
    // Double-RAF so the browser paints at translateX(0) first. Without it
    // the transition has no "from" position and the reel jumps straight to
    // its final offset without animating.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        if (!el.isConnected) return;
        const ct = containerRef.current;
        // Guard against a zero/absurd offsetWidth — a corrupt layout pass
        // on low-end Android has been observed returning 1, which parks
        // the reel off-screen.
        const raw = (ct && ct.offsetWidth > 0) ? ct.offsetWidth : 400;
        const containerWidth = (raw >= 120 && raw <= 1200) ? raw : 400;
        const centerOffset = Math.floor(containerWidth / 2) - Math.floor(cardW / 2);
        // Land the indicator somewhere WITHIN the winning card rather than
        // dead-centre every time. This is where spin-to-spin variety comes
        // from now that the easing is fixed — a real reel doesn't stop
        // perfectly centred, and varying the destination can't make the
        // motion feel worse the way varying the curve did.
        const jitter    = (variant.landing ?? 0) * cardW;
        const winOffset = winIndex * stride - centerOffset + jitter;

        el.style.transition = 'none';
        el.style.transform  = 'translateX(0px)';
        void el.offsetWidth; // force reflow so there IS a "from" state

        el.style.transition = `transform ${dur.toFixed(2)}s ${variant.easing}`;
        el.style.transform  = `translateX(${-winOffset}px)`;

        const done = (ev) => {
          if (ev.propertyName && ev.propertyName !== 'transform') return;
          el.removeEventListener('transitionend', done);
          settle();
        };
        el.addEventListener('transitionend', done);
      });
      el._raf2 = raf2;
    });
    el._raf1 = raf1;
  }, [cardW, stride, winIndex, variant, speed, settle]);

  return (
    <div ref={containerRef} className="w-full relative overflow-hidden" style={{ height: cardW + 18 }}>
      <div
        className={`absolute inset-y-0 start-1/2 -translate-x-px z-10 w-0.5 bg-primary pointer-events-none ${settled ? 'reel-line-settled' : 'opacity-70'}`}
      />
      {/* Edge fades must match the PANEL colour exactly or the reel looks
          like it slides behind a lighter band. */}
      <div
        className="absolute inset-y-0 start-0 z-10 pointer-events-none"
        style={{ width: cardW * 0.6, background: 'linear-gradient(to right, hsl(var(--popover)), transparent)' }}
      />
      <div
        className="absolute inset-y-0 end-0 z-10 pointer-events-none"
        style={{ width: cardW * 0.6, background: 'linear-gradient(to left, hsl(var(--popover)), transparent)' }}
      />
      <div
        ref={setTrackRef}
        className={`absolute top-2 flex ${settled ? '' : 'reel-track-spinning'}`}
        style={{
          gap: CARD_GAP,
          paddingLeft: CARD_GAP,
          willChange: 'transform, filter',
          '--reel-dur': `${dur.toFixed(2)}s`,
        }}
      >
        {cards.map((item, idx) => (
          <ItemCard
            key={`${item.id}-${idx}`}
            item={item}
            highlight={idx === winIndex}
            settled={settled && idx === winIndex}
            width={cardW}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Batch reveal ─────────────────────────────────────────────────────────────
// Results land in WAVES of up to four rather than all at once.
//
// A ten-capsule open used to dump ten cards onto the screen in one
// staggered burst — the whole batch resolved in under a second and there
// was nothing to watch. Opening four, then four, then two gives each wave
// its own beat, and the earlier waves stay on screen so the haul visibly
// accumulates underneath.
//
// Each card starts as the capsule it came from and flips to the item a
// moment after its wave begins, so a wave reads as "these four just
// opened" rather than "four cards appeared".
export const BATCH_WAVE_SIZE = 4;

/** Split results into consecutive waves of at most BATCH_WAVE_SIZE. */
export function splitIntoWaves(results, size = BATCH_WAVE_SIZE) {
  const waves = [];
  for (let i = 0; i < results.length; i += size) waves.push(results.slice(i, i + size));
  return waves;
}

function BatchCard({ entry, isBest, delay }) {
  const { tFallback } = useLanguage();
  const { item } = entry;
  const tint = rarityTint(item.rarity);
  return (
    <motion.div
      className={`relative ${HAUL.item} flex flex-col items-center justify-center rounded-xl border-2 bg-card p-2 gap-1 text-center min-h-[92px]`}
      style={{ borderColor: tint.border, boxShadow: isBest ? tint.glow : undefined }}
      initial={{ scale: 0.6, opacity: 0, y: 8 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22, delay }}
    >
      {isBest && (
        <span
          className="absolute -top-1.5 px-1.5 rounded-full text-micro font-extrabold uppercase tracking-wider"
          style={{ backgroundColor: tint.color, color: '#000' }}
        >
          {tFallback("dashboard.best", "Best")}
        </span>
      )}
      <StickerDisplay emoji={item.emoji} variant={item.variant} size={30} />
      <span className="text-micro font-semibold leading-tight line-clamp-2">{item.name}</span>
      <span className="text-micro font-bold uppercase tracking-wide" style={{ color: tint.color }}>
        {tint.label}
      </span>
    </motion.div>
  );
}


// ─── Component ────────────────────────────────────────────────────────────────
// Phases: 'idle' → 'spinning' → ['encore' →] 'revealing' → 'claimed'
// The 'encore' phase only exists for a legendary-or-better pull: one more
// spin, on a reel with nothing under legendary in it. See buildLegendaryReel.
// Ten capsules used to mean ten full round trips through this modal:
// open bag → tap capsule → 3s spin → claim → close → bag reopens → repeat.
// `batch` runs one spin and reveals every result at once. It is a UI
// affordance only: each capsule is still rolled by its own
// claim_capsule_loot call, server-side, independently.
const MAX_BATCH = 10;

export default function CapsuleOpener({ capsule, batch, onClaim, onClaimBatch, onClose }) {
  const { tFallback } = useLanguage();
  const batchRows = Array.isArray(batch) ? batch.slice(0, MAX_BATCH) : null;
  const isBatch = !!batchRows && batchRows.length > 1;
  // [{ capsuleId, item }] — every successful roll from this open.
  const [results, setResults] = useState([]);
  const reduce = prefersReducedMotion();
  const [phase,   setPhase]   = useState('idle');
  const [wonItem, setWonItem] = useState(null);
  // One reel spec per capsule opened:
  //   { capsuleId, item, cards, winIndex, variant }
  // A single open has exactly one. A batch has N, spun in stacked waves.
  const [reels, setReels] = useState([]);
  // The encore reel — { cards, winIndex, variant } — built at roll time
  // when the best pull is legendary or better, null otherwise.
  const [encore, setEncore] = useState(null);
  const [encoreSettled, setEncoreSettled] = useState(false);
  const [waveIndex, setWaveIndex] = useState(0);
  const [settledInWave, setSettledInWave] = useState(0);
  const [catalogOpen, setCatalogOpen] = useState(false);
  // Kicker caption for the current wave. Each reel carries its own variant
  // so a stack doesn't move in lockstep; this is just the label.
  const [spinVariant, setSpinVariant] = useState(makeSpin);

  // The hero icon. A batch shows the type it's opening, not the single
  // `capsule` prop — which is null for a batch.
  const capsuleType = (isBatch ? batchRows[0]?.capsule_type : capsule?.capsule_type) || 'standard';

  // Synchronous guard against double-tap on Open (in addition to the
  // phase state machine, which is async). Without this a fast mobile
  // double-tap could fire two RPC calls before phase flips.
  const openGuardRef = useRef(false);
  // Release the guard once the spin successfully transitions to
  // revealing — the phase state is now driving the rest of the flow.
  // Previously the guard stayed set until unmount, so any
  // hot-reload / parent-state-shuffle that kept the component mounted
  // could leave the Open button dead.
  useEffect(() => {
    if (phase === 'revealing' || phase === 'claimed') {
      openGuardRef.current = false;
    }
  }, [phase]);

  // Rarity-scaled haptic on reveal. This is what survives of the removed
  // crate burst: the buzz was the part that added something the card
  // couldn't, so it fires on the reveal itself now. haptic.js already
  // no-ops under reduced-motion / the settings toggle / no-vibrate devices.
  useEffect(() => {
    if (phase !== 'revealing' || !wonItem) return;
    const pattern = { legendary: 'success', mythic: 'buzz', animated: 'success' }[wonItem.rarity]
      ?? (rarityRank(wonItem.rarity) >= rarityRank('rare') ? 'primary' : null);
    if (pattern) triggerHaptic(pattern);
  }, [phase, wonItem]);

  // Reels are spun in stacked waves of at most WAVE_SIZE. A wave advances
  // only once EVERY reel in it has settled, so nothing is cut short.
  const reelWaves = useMemo(() => splitIntoWaves(reels), [reels]);
  const currentWave = reelWaves[waveIndex] ?? [];

  const handleReelSettled = useCallback(() => {
    setSettledInWave(n => n + 1);
  }, []);

  useEffect(() => {
    if (phase !== 'spinning' || currentWave.length === 0) return;
    if (settledInWave < currentWave.length) return;
    // Whole wave has landed. Beat, then the next stack — or, on a gold
    // pull, the encore before the reveal.
    const t = setTimeout(() => {
      if (waveIndex + 1 < reelWaves.length) {
        setWaveIndex(i => i + 1);
        setSettledInWave(0);
      } else if (encore) {
        setPhase('encore');
      } else {
        setPhase('revealing');
      }
    }, 700);
    return () => clearTimeout(t);
  }, [phase, settledInWave, currentWave.length, waveIndex, reelWaves.length, encore]);

  // The encore's own settle → reveal. Same shape as the wave hand-off
  // above (state + an effect that owns the timer) so an unmount mid-beat
  // clears it, with a longer pause: the gold card has just bloomed and it
  // should be allowed to sit there.
  const handleEncoreSettled = useCallback(() => setEncoreSettled(true), []);

  // Tapping the build stamp copies the full diagnostic block — hash, build
  // date, UA, URL — which is what a bug report actually needs. The three
  // outcomes are worded here rather than inside copyDiagnostics() so the
  // "unavailable" case can point at the label that IS on screen.
  const handleCopyBuild = useCallback(async () => {
    const result = await copyDiagnostics();
    if (result === 'ok') toast.success('Copied build info to clipboard.');
    else if (result === 'unavailable') toast.error('Clipboard unavailable — the build is shown on the button.');
    else toast.error('Could not copy — your browser blocked clipboard access.');
  }, []);

  useEffect(() => {
    if (phase !== 'encore' || !encoreSettled) return;
    const t = setTimeout(() => setPhase('revealing'), 900);
    return () => clearTimeout(t);
  }, [phase, encoreSettled]);

  // ── Trigger spin ────────────────────────────────────────────────────────────
  // Server-authoritative roll (migration 028). The RPC:
  //   1. Locks the capsule row atomically (concurrent opens fail).
  //   2. Rolls rarity using server random() with capsule-type-specific odds.
  //   3. Rolls category (sticker / theme / title / frame).
  //   4. Rolls variant (foil / gold / diamond — sticker only).
  //   5. Persists the rolled values back onto the capsule row.
  // The client then picks a SPECIFIC item from its catalog matching the
  // server-rolled (category, rarity) tuple. Items in the same tier are
  // equivalent in value so the residual client-side choice is safe.
  //
  // Falls back to the legacy fully-client roll only if the RPC doesn't
  // exist yet (pre-migration-028).
  const handleOpen = useCallback(async () => {
    if (openGuardRef.current) return;
    openGuardRef.current = true;

    // Drives the kicker caption only; each reel carries its own variant.
    setSpinVariant(makeSpin());

    const targets = isBatch ? batchRows : (capsule ? [capsule] : []);
    if (targets.length === 0 || targets.some(c => !c?.id)) {
      toast.error('Capsule missing — refresh and try again.');
      openGuardRef.current = false;
      return;
    }

    let rolled;
    try {
      // Each capsule is an independent server-side roll. Parallel is safe:
      // claim_capsule_loot locks one row and no two targets share a row.
      rolled = await Promise.all(targets.map(async (c) => {
        const res = await rollOneCapsule(c.id);
        return { capsuleId: c.id, item: res?.item ?? null, granted: !!res?.granted };
      }));
    } catch (err) {
      if (err?.missingRpc) {
        console.warn('[CapsuleOpener] claim_capsule_loot missing — apply migration 028');
        toast.error('Capsule system update pending. Try again later.');
      } else {
        console.error('[CapsuleOpener] roll failed:', err);
        toast.error('Could not open capsule. Try again.');
      }
      openGuardRef.current = false;
      return;
    }

    const ok = rolled.filter(r => r.item);
    if (ok.length === 0) {
      // Every target came back null — already opened elsewhere, or the
      // catalog has nothing for the rolled tier.
      toast.error(targets.length > 1 ? 'Those capsules were already opened.' : 'Capsule already opened.');
      openGuardRef.current = false;
      return;
    }
    if (ok.length < targets.length) {
      // Partial: some rows were claimed by another tab/device mid-flight.
      // Say so rather than silently revealing fewer cards than requested.
      toast.info(`${targets.length - ok.length} capsule(s) were already opened elsewhere.`);
    }

    // The reel lands on the BEST pull — with ten results there has to be
    // one payoff moment, and it should be the one worth watching.
    const best = ok.reduce((a, b) => (rarityRank(b.item.rarity) > rarityRank(a.item.rarity) ? b : a));

    // A reel PER capsule. Each gets its own shape AND its own spin persona,
    // so a stack of four lands at four different moments instead of moving
    // as one block.
    const specs = ok.map(({ capsuleId, item }) => {
      const { cards, winIndex } = buildReel(item);
      // Each reel gets its own timing + landing point, same curve.
      return { capsuleId, item, cards, winIndex, variant: makeSpin() };
    });

    // Gold pull → build the encore now, so the transition out of the last
    // wave is a state flip rather than a reel being generated mid-beat.
    // A batch earns one encore, on the best pull, for the same reason the
    // haul has one "Best" crown.
    const encoreSpec = isEncoreTier(best.item.rarity)
      ? { ...buildLegendaryReel(best.item), item: best.item, variant: makeSpin() }
      : null;

    setResults(ok);
    setReels(specs);
    setEncore(encoreSpec);
    setEncoreSettled(false);
    setWaveIndex(0);
    setSettledInWave(0);
    setWonItem(best.item);
    setPhase('spinning');
    // The CSS animation is kicked off by the reel's callback ref once the
    // element mounts.
  }, [capsule, isBatch, batchRows]);

  // ── Claim ────────────────────────────────────────────────────────────────────
  const handleClaim = useCallback(() => {
    setPhase('claimed');
    if (isBatch) onClaimBatch?.(results);
    else onClaim?.(wonItem, { granted: !!results[0]?.granted });
  }, [isBatch, results, wonItem, onClaim, onClaimBatch]);

  // One tint object drives the reveal card's border, glow, chip and CTA.
  // Previously this was two parallel lookups (RARITY for colours, the
  // local RARITY_CARD for Tailwind classes) that could disagree.
  const rarityConfig = wonItem ? rarityTint(wonItem.rarity) : null;
  // Common is the only tier whose colour is too desaturated to work as a
  // button fill; everything from uncommon up is vivid enough.
  const isDrabRarity = wonItem?.rarity === 'common';
  // Which grid card gets the "Best" crown. Recomputed from results rather
  // than stored, so it can't drift out of sync with what's rendered.
  const bestResultId = results.length
    ? results.reduce((a, b) => (rarityRank(b.item.rarity) > rarityRank(a.item.rarity) ? b : a)).capsuleId
    : null;

  // Scroll lock — held for the opener's whole lifetime, deliberately NOT
  // keyed on `phase`. A dep on [phase, onClose] used to re-run the whole
  // effect on every phase change, and the second run's snapshot captured
  // the 'hidden' the first run had set — which leaked into the restore and
  // left the body un-scrollable after the modal closed. The shared lock is
  // reference-counted, so a stray extra lock/unlock pair can no longer
  // strand the page like that, but there's still no reason to churn it.
  useBodyScrollLock();

  // Escape-to-close. Keyboard-only users previously had no way to
  // dismiss this overlay because it's a raw <div> rather than a Radix
  // Dialog. Allow Escape only in the 'idle' phase so a user can't
  // escape mid-reveal animation and re-open a still-unopened capsule
  // (the server-side claim is atomic but the UX would be jarring).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && phase === 'idle') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  return (
    <div
      // `loot-stage` pins the neutral theme tokens dark for this subtree —
      // see the block in index.css for why the opener stays a dark theater
      // while the Marketplace and Bag follow the app theme.
      className="loot-stage fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="capsule-opener-title"
    >
      {/* Backdrop — clickable in both 'idle' and 'claimed' phases. The
          previous gate (idle only) left the user with NO way to
          dismiss after claiming on devices without a visible X button
          edge case. Spinning + revealing phases are still locked so a
          stray tap can't kill the moment mid-animation. */}
      <motion.div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(phase === 'idle' || phase === 'claimed') ? onClose : undefined}
      />

      {/* Panel */}
      <motion.div
        className="relative z-10 w-full max-w-lg rounded-2xl overflow-hidden bg-popover border border-border shadow-2xl"
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        {/* Single StarField — keep this as the only render site for
            the twinkling background. Adding a second instance to the
            backdrop or any nested panel doubles the visual particle
            count and pegs the GPU on low-end Android, which audit
            sweeps have flagged historically. The starfield's z-index
            already covers the full panel; reading both layers as
            overlapping stars was the original concern. */}
        <StarField />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
          <h2 id="capsule-opener-title" className="text-lg font-bold tracking-wide flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
            {tFallback("capsuleOpener.openCapsule", "Open Capsule")}
          </h2>
          {(phase === 'idle' || phase === 'claimed') && (
            <button
              onClick={onClose}
              aria-label={tFallback("capsuleOpener.closeCapsuleDialog", "Close capsule dialog")}
              className="text-muted-foreground hover:text-foreground active:text-foreground transition-colors p-1 rounded-lg hover:bg-secondary active:bg-secondary"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          )}
        </div>

        <AnimatePresence mode="wait">

          {/* ── IDLE ─────────────────────────────────────────────────────────── */}
          {phase === 'idle' && (
            <motion.div
              key="idle"
              className="flex flex-col items-center justify-center py-12 px-6 gap-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <motion.div
                animate={reduce ? undefined : { scale: [1, 1.06, 1] }}
                transition={reduce ? undefined : { duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="relative"
              >
                <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl scale-150" />
                <CapsuleIcon type={capsuleType} size={124} className="relative" />
              </motion.div>

              <div className="text-center">
                <p className="font-semibold text-lg capitalize">
                  {isBatch
                    ? `${batchRows.length} × ${batchRows[0]?.capsule_type ?? 'Standard'} Capsules`
                    : `${capsule?.capsule_type ?? 'Standard'} Capsule`}
                </p>
                <p className="text-muted-foreground text-sm mt-1">
                  {isBatch
                    ? 'One spin, every result at once'
                    : 'Crack it open to reveal your prize'}
                </p>
              </div>

              {/* Loot-box transparency — pre-open drop rates per
                  rarity. Collapsed by default so the dramatic moment
                  stays clean; one tap to expand. */}
              <div className="mb-2 w-72 max-w-full flex flex-col gap-2">
                <CapsuleRarityOdds capsuleType={capsuleType} />
                {/* Where you actually stand against those odds. Display
                    only — see src/lib/pity.js. */}
                <CapsuleStreak />
              </div>
              <button
                type="button"
                onClick={() => setCatalogOpen(true)}
                className="mb-4 inline-flex items-center gap-1.5 text-micro font-semibold text-primary hover:opacity-80 underline-offset-2 hover:underline transition-opacity"
              >
                <BookOpen className="w-3 h-3" aria-hidden="true" />
                {tFallback("capsuleOpener.browseCollection", "Browse collection")}
              </button>

              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleOpen}
                className="px-8 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-base shadow-lg shadow-primary/30 hover:shadow-primary/50 transition-shadow"
              >
                {isBatch ? `Open all ${batchRows.length}` : 'Open Capsule'}
              </motion.button>
            </motion.div>
          )}

          {/* ── SPINNING ───────────────────────────────────────────────────── */}
          {phase === 'spinning' && currentWave.length > 0 && (
            <motion.div
              key={`spinning-${waveIndex}`}
              className="flex flex-col items-center py-8 gap-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
                {reelWaves.length > 1
                  ? `${spinVariant.kicker} ${waveIndex + 1}/${reelWaves.length}`
                  : spinVariant.kicker}
              </p>

              {/* One reel per capsule, stacked. A batch of six spins four
                  here, then the remaining two in the next wave. Reels are
                  scaled down so a full stack of four fits the panel. */}
              <div className="w-full flex flex-col gap-2">
                {currentWave.map((spec) => (
                  <CapsuleReel
                    key={spec.capsuleId}
                    cards={spec.cards}
                    winIndex={spec.winIndex}
                    variant={spec.variant}
                    cardW={isBatch ? 74 : CARD_W}
                    // Batch reels run quicker — four personas at full length
                    // would leave the slowest holding the wave for 4.6s.
                    speed={isBatch ? 0.68 : 1}
                    onSettled={handleReelSettled}
                  />
                ))}
              </div>
            </motion.div>
          )}

          {/* ── ENCORE — one more spin, gold only ──────────────────────────── */}
          {phase === 'encore' && encore && (
            <motion.div
              key="encore"
              className="flex flex-col items-center py-8 gap-3 relative"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {/* Gold wash behind the reel so the encore doesn't just look
                  like the same spin running a second time. */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: `radial-gradient(ellipse 70% 60% at 50% 50%, ${GOLD_GLOW}, transparent 70%)` }}
              />
              <motion.p
                className="relative z-10 text-sm font-extrabold tracking-[0.3em] uppercase"
                style={{ color: GOLD_RIM, textShadow: `0 0 18px ${GOLD_GLOW}` }}
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 16 }}
              >
                {rarityTint(encore.item.rarity).label}
              </motion.p>
              <p className="relative z-10 text-muted-foreground text-micro font-medium tracking-widest uppercase -mt-1">
                One more spin — legendaries only
              </p>

              <div className="relative z-10 w-full">
                <CapsuleReel
                  cards={encore.cards}
                  winIndex={encore.winIndex}
                  variant={encore.variant}
                  cardW={CARD_W}
                  onSettled={handleEncoreSettled}
                />
              </div>
            </motion.div>
          )}

          {/* ── REVEALING (batch) — the haul ───────────────────────────────── */}
          {phase === 'revealing' && wonItem && isBatch && (
            <motion.div
              key="revealing-batch"
              className="flex flex-col items-center py-8 px-5 gap-5 relative"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {/* Rarity wash keyed to the BEST pull. */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: `radial-gradient(ellipse 60% 55% at 50% 40%, ${rarityConfig.color}22, transparent 70%)`,
                }}
              />
              <p className="relative z-10 text-muted-foreground text-xs font-medium tracking-widest uppercase">
                {results.length} opened
              </p>

              {/* The haul is the payoff shot, so it sits under the centre of
                  the panel at any count — see HAUL at the top of this file. */}
              <div className={`relative z-10 w-full ${HAUL.row}`}>
                {results.map((entry, i) => (
                  <BatchCard
                    key={entry.capsuleId}
                    entry={entry}
                    isBest={entry.capsuleId === bestResultId}
                    delay={i * 0.05}
                  />
                ))}
              </div>

              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleClaim}
                className="relative z-10 px-8 py-3 rounded-xl font-bold text-base text-white shadow-lg transition-shadow"
                style={{
                  background: `linear-gradient(135deg, ${rarityConfig.color}cc, ${rarityConfig.color}88)`,
                  boxShadow: `0 4px 24px ${rarityConfig.color}44`,
                }}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + results.length * 0.05 }}
              >
                Claim all {results.length}
              </motion.button>
            </motion.div>
          )}

          {/* ── REVEALING (single) ─────────────────────────────────────────── */}
          {phase === 'revealing' && wonItem && !isBatch && (() => {
            const isThemeDrop = wonItem.type === 'theme';
            const lootTheme   = isThemeDrop ? getLootThemeById(wonItem.id) : null;
            return (
              <motion.div
                key="revealing"
                className="flex flex-col items-center py-10 px-6 gap-6 relative"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                {/* Rarity radial glow */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: `radial-gradient(ellipse 60% 55% at 50% 45%, ${rarityConfig.color}22, transparent 70%)`,
                  }}
                />

                {isThemeDrop && lootTheme ? (
                  /* ── Theme reveal card ── */
                  <motion.div
                    className="relative flex flex-col items-center justify-center rounded-2xl border-2 bg-card shadow-2xl overflow-hidden"
                    style={{
                      width: 200, height: 220,
                      borderColor: rarityConfig.color,
                      boxShadow: `0 0 40px ${rarityConfig.color}55`,
                    }}
                    initial={{ scale: 0.4, opacity: 0, rotate: -6 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                  >
                    {/* Animated shimmer for epic/legendary */}
                    {(wonItem.rarity === 'epic' || wonItem.rarity === 'legendary') && (
                      <motion.div
                        className="absolute inset-0 z-0"
                        animate={{ opacity: [0.4, 0.8, 0.4] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        style={{ background: `linear-gradient(135deg, ${rarityConfig.color}25, transparent 50%, ${rarityConfig.color}25)` }}
                      />
                    )}
                    <span className="relative z-10 text-5xl mb-2">{lootTheme.emoji}</span>
                    {/* Color preview swatches */}
                    <div className="relative z-10 flex gap-2 mb-3">
                      {lootTheme.preview.map((hex, i) => (
                        <div key={i} className="w-8 h-8 rounded-full ring-2 ring-white/20 shadow-lg"
                          style={{ backgroundColor: hex }} />
                      ))}
                    </div>
                    <span className="relative z-10 font-bold text-base text-center px-3">{lootTheme.name}</span>
                    {lootTheme.animated && (
                      <span className="relative z-10 mt-1.5 text-micro font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                        style={{ background: `${rarityConfig.color}30`, color: rarityConfig.color, border: `1px solid ${rarityConfig.color}60` }}>
                        {tFallback("capsuleOpener.animated", "Animated")}
                      </span>
                    )}
                    <div className="relative z-10 mt-2 flex items-center justify-center">
                      <span className="text-micro font-semibold uppercase tracking-widest" style={{ color: rarityConfig.color }}>
                        {tFallback("capsuleOpener.themeDrop", "Theme Drop")}
                      </span>
                    </div>
                  </motion.div>
                ) : (
                  /* ── Sticker reveal card ── */
                  <motion.div
                    className="relative flex flex-col items-center justify-center rounded-2xl border-2 bg-card shadow-2xl"
                    style={{
                      width: 180, height: 200,
                      borderColor: rarityConfig.color,
                      boxShadow: rarityConfig.glow,
                    }}
                    initial={{ scale: 0.4, opacity: 0, rotate: -6 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                  >
                    {wonItem.rarity === 'animated' && (
                      <motion.div
                        className="absolute inset-0 rounded-2xl"
                        animate={{ opacity: [0.3, 0.7, 0.3] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        style={{ background: `linear-gradient(135deg, ${rarityConfig.color}33, transparent, ${rarityConfig.color}33)` }}
                      />
                    )}
                    <div className="mb-3 relative z-10">
                      <StickerDisplay emoji={wonItem.emoji} variant={wonItem.variant} size={80} />
                    </div>
                    <span className="font-bold text-base relative z-10">{wonItem.name}</span>
                  </motion.div>
                )}

                <motion.div
                  className="flex flex-col items-center gap-2"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                >
                  <span
                    className="px-3 py-1 rounded-full text-sm font-bold border"
                    style={{ color: rarityConfig.color, borderColor: rarityConfig.color, background: `${rarityConfig.color}18` }}
                  >
                    {rarityConfig.label}
                  </span>
                  {wonItem.variant && !isThemeDrop && (
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-bold border"
                      style={{
                        color: VARIANTS[wonItem.variant]?.color ?? '#fff',
                        borderColor: VARIANTS[wonItem.variant]?.color ?? '#fff',
                        background: `${VARIANTS[wonItem.variant]?.color ?? '#fff'}18`,
                      }}
                    >
                      {VARIANTS[wonItem.variant]?.badge ?? wonItem.variant}
                    </span>
                  )}
                  <p className="text-muted-foreground text-sm text-center max-w-xs">{wonItem.description}</p>
                </motion.div>

                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleClaim}
                  className={`px-8 py-3 rounded-xl font-bold text-base shadow-lg transition-shadow ${
                    isDrabRarity ? 'bg-primary text-primary-foreground' : 'text-white'
                  }`}
                  style={{
                    // Common's catalog colour is slate — as a button fill
                    // that renders a muted grey pill that reads as DISABLED,
                    // which is a miserable thing to show someone at the
                    // exact moment they won something. Seen on device.
                    // Saturated tiers keep their rarity gradient (a gold
                    // legendary Claim is part of the payoff); the drab end
                    // of the ladder falls back to the primary action colour
                    // and carries its rarity in the glow instead.
                    background: isDrabRarity
                      ? undefined
                      : `linear-gradient(135deg, ${rarityConfig.color}cc, ${rarityConfig.color}88)`,
                    boxShadow: `0 4px 24px ${rarityConfig.color}44`,
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                >
                  {isThemeDrop ? 'Claim Theme!' : 'Claim!'}
                </motion.button>
              </motion.div>
            );
          })()}

          {/* ── CLAIMED ────────────────────────────────────────────────────── */}
          {phase === 'claimed' && isBatch && (
            <motion.div
              key="claimed-batch"
              className="flex flex-col items-center py-10 px-6 gap-4 text-center"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <motion.span
                className="text-5xl"
                animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.15, 1] }}
                transition={{ duration: 0.6 }}
              >
                🎉
              </motion.span>
              <p className="font-bold text-lg">{results.length} items added to your bag!</p>
              <p className="text-muted-foreground text-sm">
                Best pull: <span style={{ color: rarityConfig?.color }}>{wonItem?.name}</span>
              </p>
              <button
                onClick={onClose}
                className="mt-2 px-6 py-2.5 rounded-xl bg-secondary hover:bg-secondary/70 active:bg-secondary/70 text-secondary-foreground font-semibold transition-colors"
              >
                {tFallback("common.close", "Close")}
              </button>
            </motion.div>
          )}

          {phase === 'claimed' && !isBatch && wonItem && (
            <motion.div
              key="claimed"
              className="flex flex-col items-center py-10 px-6 gap-4"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <motion.span
                className="text-5xl"
                animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.15, 1] }}
                transition={{ duration: 0.6 }}
              >
                🎉
              </motion.span>
              <p className="font-bold text-lg">{wonItem.name} added to your bag!</p>
              <p className="text-muted-foreground text-sm">
                {wonItem.type === 'theme'
                  ? 'Apply it from the Themes tab in your bag.'
                  : 'Check your inventory to see it.'}
              </p>
              <button
                onClick={onClose}
                className="mt-2 px-6 py-2.5 rounded-xl bg-secondary hover:bg-secondary/70 active:bg-secondary/70 text-secondary-foreground font-semibold transition-colors"
              >
                {tFallback("common.close", "Close")}
              </button>
            </motion.div>
          )}

        </AnimatePresence>

        {/* Build stamp — on EVERY phase, deliberately, not just idle.
            The REVEAL is the screenshot someone sends when this modal looks
            wrong, and one of those cost a full round trip: the layout fix was
            already live and the device was on a service-worker-cached bundle,
            which the screenshot had no way to show. Reading the hash off the
            picture answers that in one step instead of five (Settings →
            scroll → tap → paste → compare).
            Sits outside AnimatePresence so it doesn't animate in and out with
            each phase, and below the CTA so it never competes with it. 11px
            is the app-wide floor from index.css — muted, never smaller. */}
        <button
          type="button"
          onClick={handleCopyBuild}
          className="relative z-10 block w-full pb-3 text-center text-micro text-muted-foreground/50 hover:text-muted-foreground active:text-muted-foreground transition-colors"
          aria-label={tFallback("capsuleOpener.copyBuildDiagnosticInfo", "Copy build diagnostic info to clipboard")}
        >
          {buildLabel()}
        </button>
      </motion.div>

      {catalogOpen && (
        <Suspense fallback={null}>
          <CollectionModal open={catalogOpen} onClose={() => setCatalogOpen(false)} />
        </Suspense>
      )}

    </div>
  );
}
