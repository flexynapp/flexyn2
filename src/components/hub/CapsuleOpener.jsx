// src/components/hub/CapsuleOpener.jsx
//
// The capsule open, from the round 2 design: a full-screen stage where the
// canister's lid comes off, one reel per capsule rolls under a pointer, and
// the reveal lays the item on a plate with where it sits in the set.
//
// Presentation only. Every capsule is spent and its item granted by
// open_capsule_atomic (migration 255) before the first reel moves; the reel
// is theatre over a decision the server already made. On a pre-255 database
// the legacy claim_capsule_loot roll is used and useBagFlow finalizes it on
// Collect. Nothing in this file writes a capsule row.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { ITEMS, BRANDED_ITEMS, getItemsByRarity, VARIANTS, lootDescription } from '@/lib/lootCatalog';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { pickItemForRoll, buildCandidateMenu, hydrateItemById } from '@/lib/lootRoll';
import { LOOT_THEMES } from '@/lib/lootThemes';
import { LOOT_FRAMES } from '@/lib/lootFrames';
// LOOT_TITLES is still used by pickItemForRoll for title items.
import { LOOT_TITLES } from '@/lib/lootTitles';
import { THEMES_ENABLED } from '@/lib/featureFlags';
import { buildLabel, copyDiagnostics } from '@/lib/buildInfo';
import { supabase } from '@/api/supabaseClient';
import { triggerHaptic } from '@/lib/haptic';
import { useAuth } from '@/lib/AuthContext';
import * as inventory from '@/lib/data/inventory';
import { buildCollection, ownershipFrom } from '@/lib/collection';
import { setNumber, formatSetNo } from '@/lib/capsuleShelf';
import { sellPriceFor } from '@/lib/sellPrice';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import Sticker from '@/components/capsules/Sticker';
import CapsuleCanister from '@/components/capsules/CapsuleCanister';
import PityMeter from '@/components/capsules/PityMeter';
import { PunchStrip, NotchedCorner } from '@/components/capsules/parts';
import { tierName, tierFinish, rarityName } from '@/components/capsules/words';
import FlexCoinIcon from '@/components/FlexCoinIcon';

// ─── Constants ────────────────────────────────────────────────────────────────
// A reel card, from the design: 112 by 164, 12 apart.
const CARD_W   = 112; // px
const CARD_H   = 164; // px
const CARD_GAP = 12;  // px
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

/** A spin's timing + where in the card it settles. Same curve every time. */
function makeSpin() {
  return {
    duration: SPIN_DURATION + (Math.random() * 2 - 1) * SPIN_DURATION_JITTER,
    easing: SPIN_EASING,
    // -1..1 → left edge .. right edge of the allowed band.
    landing: (Math.random() * 2 - 1) * LANDING_JITTER,
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

// Legendary is the tier the encore is named for. The round 2 design draws
// every card the same way (a flat card, the sticker in its rarity colour),
// so this no longer changes how a card looks; it is kept because the encore
// logic and its tests describe the ladder with it.
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


// ─── One reel card ────────────────────────────────────────────────────────────
function ReelCard({ item, landed }) {
  const isMystery = item.id === '__mystery__' || item.id === '__filler__';
  return (
    <div
      className="flex-none flex flex-col items-center justify-center gap-2 rounded-lg bg-card border select-none"
      style={{
        width: CARD_W,
        height: CARD_H,
        // The landed card takes its rarity on the rim. A colour change, not
        // a glow: the pointer already says where to look.
        borderColor: landed ? rarityTint(item.rarity).color : 'hsl(var(--border))',
      }}
    >
      {isMystery
        ? <span className="font-display text-display text-muted-foreground" aria-hidden="true">?</span>
        : <Sticker itemId={item.id} emoji={item.emoji} rarity={item.rarity} size={74} />}
      <span className="text-caption font-semibold text-foreground/85 max-w-[100px] truncate">
        {isMystery ? '???' : item.name}
      </span>
    </div>
  );
}

// Honors prefers-reduced-motion for the reel's travel time.
const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};

// The ruler along the top and bottom edges of the reel band. Ticks only: the
// design numbered them in 7px type, under the app's 11px floor, and the
// numbers meant nothing.
function Ruler({ flip = false }) {
  const id = `ruler-${flip ? 'b' : 't'}`;
  return (
    <svg className={`absolute inset-x-0 ${flip ? 'bottom-0' : 'top-0'} w-full h-4 text-border`} aria-hidden="true">
      <defs>
        <pattern id={id} width="80" height="16" patternUnits="userSpaceOnUse">
          {[0, 16, 32, 48, 64].map((x) => (
            <path
              key={x}
              d={flip ? `M${x + 0.5} 16V${x === 0 ? 7 : 11}` : `M${x + 0.5} 0V${x === 0 ? 9 : 5}`}
              stroke="currentColor" strokeWidth="1.2"
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="16" fill={`url(#${id})`} />
    </svg>
  );
}

// ─── One spinning reel ────────────────────────────────────────────────────────
// Owns its own container measurement, double-RAF kick-off, CSS transition
// and transitionend teardown. `onSettled` fires once, when this reel's own
// transform finishes (or its safety timer does).
function CapsuleReel({ cards, winIndex, variant, speed = 1, onSettled }) {
  const containerRef = useRef(null);
  const settledRef   = useRef(false);
  const timerRef     = useRef(null);
  const [settled, setSettled] = useState(false);
  const stride = CARD_W + CARD_GAP;
  const dur = prefersReducedMotion() ? 0.01 : variant.duration * speed;

  const settle = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setSettled(true);
    triggerHaptic('primary');
    onSettled?.();
  }, [onSettled]);

  // Safety net: transitionend can genuinely go missing (a backgrounded tab,
  // an interrupted transition), and a reel that never settles strands the
  // user on a spinning screen with the capsule already spent.
  useEffect(() => {
    const ms = dur * 1000 + 600;
    timerRef.current = setTimeout(settle, ms);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [dur, settle]);

  const setTrackRef = useCallback((el) => {
    if (!el) return;
    // Double-RAF so the browser paints at translateX(0) first; without it
    // the transition has no "from" position and the reel jumps.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!el.isConnected) return;
        const ct = containerRef.current;
        // Guard against a zero/absurd offsetWidth from a corrupt layout pass.
        const raw = (ct && ct.offsetWidth > 0) ? ct.offsetWidth : 390;
        const containerWidth = (raw >= 120 && raw <= 1200) ? raw : 390;
        const centerOffset = containerWidth / 2 - CARD_W / 2 - CARD_GAP;
        // The pointer lands somewhere WITHIN the winning card, not dead
        // centre every time: that is where spin-to-spin variety comes from.
        const jitter    = (variant.landing ?? 0) * CARD_W;
        const winOffset = winIndex * stride - centerOffset + jitter;

        el.style.transition = 'none';
        el.style.transform  = 'translateX(0px)';
        void el.offsetWidth;
        el.style.transition = `transform ${dur.toFixed(2)}s ${variant.easing}`;
        el.style.transform  = `translateX(${-winOffset}px)`;

        const done = (ev) => {
          if (ev.propertyName && ev.propertyName !== 'transform') return;
          el.removeEventListener('transitionend', done);
          settle();
        };
        el.addEventListener('transitionend', done);
      });
    });
  }, [stride, winIndex, variant, dur, settle]);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden border-y bg-black/25"
      style={{ height: CARD_H + 48 }}
      data-testid="capsule-reel"
    >
      <Ruler />
      <Ruler flip />
      <div
        ref={setTrackRef}
        className="absolute top-6 start-0 flex"
        style={{ gap: CARD_GAP, paddingInlineStart: CARD_GAP, willChange: 'transform' }}
      >
        {cards.map((item, idx) => (
          <ReelCard key={`${item.id}-${idx}`} item={item} landed={settled && idx === winIndex} />
        ))}
      </div>
      {/* The pointer: a triangle at each edge and a line between. */}
      <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" className="absolute start-1/2 -ms-2.5 -top-px text-foreground">
        <path d="M0 0h20L10 11z" fill="currentColor" />
      </svg>
      <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" className="absolute start-1/2 -ms-2.5 -bottom-px text-foreground">
        <path d="M0 12h20L10 1z" fill="currentColor" />
      </svg>
      <div className="absolute start-1/2 -ms-px top-2.5 bottom-2.5 w-0.5 bg-foreground" aria-hidden="true" />
    </div>
  );
}

// ─── Batch opens ──────────────────────────────────────────────────────────────
// Kept for its tests and any caller that still wants stacks. The round 2
// design runs a batch as one reel per capsule, in turn ("Capsule 2 of 3"),
// which is splitIntoWaves with a size of one.
export const BATCH_WAVE_SIZE = 4;

/** Split results into consecutive waves of at most `size`. */
export function splitIntoWaves(results, size = BATCH_WAVE_SIZE) {
  const waves = [];
  for (let i = 0; i < results.length; i += size) waves.push(results.slice(i, i + size));
  return waves;
}

// Ten capsules is the most one open runs; the bag and the Capsules page
// both cap at this.
const MAX_BATCH = 10;

// One more thing a single reveal says: where this item sits in the set and
// how many the user now holds. Derived from the inventory read AFTER the
// roll, so it describes what the server granted.
function describeResult(item, results, inv) {
  // A legacy roll is not in inventory until Collect finalizes it; count it
  // as held so the reveal does not say "0 copies".
  const pendingSame = results.filter(r => !r.granted && r.item.id === item.id).length;
  const pendingAll = results.filter(r => !r.granted).map(r => ({ item_id: r.item.id }));
  const copies = (inv ?? []).filter(r => r?.item_id === item.id).length + pendingSame;
  const inThisOpen = results.filter(r => r.item.id === item.id).length;
  const isNew = copies - inThisOpen <= 0;
  const set = setNumber(item.id);
  const stickers = inv ? buildCollection('stickers', ownershipFrom([...inv, ...pendingAll])) : null;
  return { copies: Math.max(copies, 1), isNew, set, owned: stickers?.owned ?? null, total: stickers?.total ?? null };
}

// ─── Component ────────────────────────────────────────────────────────────────
// Phases: 'idle' → 'spinning' → ['encore' →] 'revealing'
// The page starts rolling the moment it mounts: the tap that opened it (Open
// on the Capsules page, a capsule in the bag) was the decision. 'idle' is
// only ever on screen while the roll is in flight, or after it failed.
export default function CapsuleOpener({
  rows, next, onClaim, onClaimAndOpenNext, onClose, autoStart = true,
}) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const targets = useMemo(
    () => (Array.isArray(rows) ? rows : []).filter(Boolean).slice(0, MAX_BATCH),
    [rows],
  );
  const isBatch = targets.length > 1;
  const tier = ['standard', 'premium', 'elite'].includes(targets[0]?.capsule_type)
    ? targets[0].capsule_type : 'standard';

  const [phase, setPhase] = useState('idle');
  const [failed, setFailed] = useState(false);
  // [{ capsuleId, item, granted }] — every successful roll from this open.
  const [results, setResults] = useState([]);
  // One reel spec per capsule: { capsuleId, item, cards, winIndex, variant }.
  const [reels, setReels] = useState([]);
  const [reelIndex, setReelIndex] = useState(0);
  const [reelSettled, setReelSettled] = useState(false);
  const [encore, setEncore] = useState(null);
  const [encoreSettled, setEncoreSettled] = useState(false);
  // Which result the reveal plate shows. The best pull first.
  const [pick, setPick] = useState(0);
  // The inventory as the server holds it after the roll.
  const [inv, setInv] = useState(null);
  const [collecting, setCollecting] = useState(false);

  // The pity reading from BEFORE the roll. A fresh read during the spin
  // could show the counter reset to zero, which spoils an epic before the
  // reel lands on it.
  const [pitySnapshot] = useState(() => queryClient.getQueryData(['capsulePity', user?.email]) ?? null);

  // Synchronous guard against a double open (StrictMode, a fast re-tap).
  const openGuardRef = useRef(false);

  const handleOpen = useCallback(async () => {
    if (openGuardRef.current) return;
    openGuardRef.current = true;
    setFailed(false);

    if (targets.length === 0 || targets.some(c => !c?.id)) {
      toast.error(tFallback('capsuleOpener.missing', 'Capsule missing. Refresh and try again.'));
      openGuardRef.current = false;
      setFailed(true);
      return;
    }

    let rolled;
    try {
      // Each capsule is its own server roll; parallel is safe because the
      // RPC locks one row and no two targets share a row.
      rolled = await Promise.all(targets.map(async (c) => {
        const res = await rollOneCapsule(c.id);
        return { capsuleId: c.id, item: res?.item ?? null, granted: !!res?.granted };
      }));
    } catch (err) {
      if (err?.missingRpc) {
        toast.error(tFallback('capsuleOpener.updatePending', 'Capsule system update pending. Try again later.'));
      } else {
        console.error('[CapsuleOpener] roll failed:', err);
        toast.error(tFallback('capsuleOpener.openFailed', 'Could not open capsule. Try again.'));
      }
      openGuardRef.current = false;
      setFailed(true);
      return;
    }

    const ok = rolled.filter(r => r.item);
    if (ok.length === 0) {
      toast.error(targets.length > 1
        ? tFallback('capsuleOpener.alreadyOpenedMany', 'Those capsules were already opened.')
        : tFallback('capsuleOpener.alreadyOpened', 'Capsule already opened.'));
      openGuardRef.current = false;
      setFailed(true);
      return;
    }
    if (ok.length < targets.length) {
      toast.info(tFallback('capsuleOpener.someOpenedElsewhere', '{n} were already opened on another device.', { n: targets.length - ok.length }));
    }

    // Best pull first on the reveal plate; the reels still run in shelf order.
    const best = ok.reduce((a, b) => (rarityRank(b.item.rarity) > rarityRank(a.item.rarity) ? b : a));
    const specs = ok.map(({ capsuleId, item }) => ({ capsuleId, item, ...buildReel(item), variant: makeSpin() }));
    const encoreSpec = isEncoreTier(best.item.rarity)
      ? { ...buildLegendaryReel(best.item), item: best.item, variant: makeSpin() }
      : null;

    setResults(ok);
    setPick(ok.indexOf(best));
    setReels(specs);
    setReelIndex(0);
    setReelSettled(false);
    setEncore(encoreSpec);
    setEncoreSettled(false);
    setPhase('spinning');

    // What the set looks like now. A failed read hides the set lines on the
    // reveal rather than printing numbers from before the open.
    if (user?.email) {
      inventory.listItems(user.email).then(setInv).catch(() => setInv(null));
    }
  }, [targets, tFallback, user?.email]);

  useEffect(() => {
    if (autoStart) handleOpen();
    // Once, on mount. A remount (the next open) is a new component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One reel at a time. When it lands, a beat, then the next capsule, or the
  // encore on a legendary-or-better pull, or the reveal.
  const handleReelSettled = useCallback(() => setReelSettled(true), []);
  useEffect(() => {
    if (phase !== 'spinning' || !reelSettled) return;
    const t = setTimeout(() => {
      if (reelIndex + 1 < reels.length) {
        setReelIndex(i => i + 1);
        setReelSettled(false);
      } else if (encore) {
        setPhase('encore');
      } else {
        setPhase('revealing');
      }
    }, 600);
    return () => clearTimeout(t);
  }, [phase, reelSettled, reelIndex, reels.length, encore]);

  const handleEncoreSettled = useCallback(() => setEncoreSettled(true), []);
  useEffect(() => {
    if (phase !== 'encore' || !encoreSettled) return;
    const t = setTimeout(() => setPhase('revealing'), 800);
    return () => clearTimeout(t);
  }, [phase, encoreSettled]);

  const skip = useCallback(() => setPhase('revealing'), []);

  // Rarity-scaled haptic on the reveal. haptic.js no-ops under reduced
  // motion, the settings toggle and devices without vibration.
  const shown = results[pick]?.item ?? null;
  useEffect(() => {
    if (phase !== 'revealing' || !shown) return;
    const pattern = { legendary: 'success', mythic: 'buzz', animated: 'success' }[shown.rarity]
      ?? (rarityRank(shown.rarity) >= rarityRank('rare') ? 'primary' : null);
    if (pattern) triggerHaptic(pattern);
    // The reveal's arrival only, not every row tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const collect = useCallback(async (andNext) => {
    if (collecting) return;
    setCollecting(true);
    if (andNext && next) await onClaimAndOpenNext?.(results);
    else await onClaim?.(results);
  }, [collecting, next, onClaim, onClaimAndOpenNext, results]);

  const handleCopyBuild = useCallback(async () => {
    const result = await copyDiagnostics();
    if (result === 'ok') toast.success(tFallback('capsuleOpener.buildCopied', 'Copied build info to clipboard.'));
    else if (result === 'unavailable') toast.error(tFallback('capsuleOpener.clipboardUnavailable', 'Clipboard unavailable. The build is shown on the button.'));
    else toast.error(tFallback('capsuleOpener.copyBlocked', 'Could not copy. Your browser blocked clipboard access.'));
  }, [tFallback]);

  // Scroll lock for the opener's whole lifetime (reference-counted).
  useBodyScrollLock();

  // Escape closes only while nothing is rolling: the capsule is spent the
  // moment the roll returns, so leaving mid-spin would hide a granted item
  // behind a closed screen until the bag is reopened.
  const canClose = phase === 'idle' && (failed || !autoStart);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && canClose) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canClose, onClose]);

  const titleText = phase === 'revealing'
    ? (isBatch
      ? tFallback('capsuleOpener.openedMany', '{n} opened', { n: results.length })
      : tFallback('capsuleOpener.opened', 'Opened'))
    : phase === 'encore'
      ? tFallback('capsuleOpener.encoreTitle', 'One more spin')
      : tFallback('capsuleOpener.opening', 'Opening');
  const subtitle = isBatch
    ? tFallback('capsuleOpener.tierCapsules', '{tier} capsules', { tier: tierName(tFallback, tier) })
    : tFallback('capsuleOpener.tierCapsule', '{tier} capsule', { tier: tierName(tFallback, tier) });

  const currentReel = reels[reelIndex];

  return (
    <div
      // `dark` pins the app's own dark tokens for this subtree: the opener
      // is a stage in either theme, and the canister and stickers are drawn
      // against a dark ground.
      className="dark fixed inset-0 z-50 flex flex-col bg-background text-foreground overflow-y-auto overscroll-contain"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="capsule-opener-title"
    >
      <div className="mx-auto w-full max-w-lg flex-1 flex flex-col min-h-0">
        <header className="h-[60px] shrink-0 px-5 pt-2 flex items-center justify-between gap-2">
          <h2 id="capsule-opener-title" className="font-display text-title">{titleText}</h2>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-label text-muted-foreground truncate">{subtitle}</span>
            {canClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={tFallback('capsuleOpener.closeCapsuleDialog', 'Close capsule dialog')}
                className="-me-2 w-11 h-11 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        {/* ── IDLE: rolling, or the roll failed ─────────────────────────── */}
        {phase === 'idle' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5 pb-6">
            <CapsuleCanister tier={tier} height="clamp(150px, 28vh, 240px)" />
            {failed ? (
              <div className="flex flex-col items-center gap-2 w-full max-w-xs">
                <button
                  type="button"
                  onClick={handleOpen}
                  className="w-full h-14 rounded-full bg-primary text-primary-foreground font-display text-title"
                >
                  {tFallback('capsuleOpener.tryAgain', 'Try again')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full h-11 text-label font-semibold text-foreground"
                >
                  {tFallback('common.close', 'Close')}
                </button>
              </div>
            ) : autoStart ? (
              <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground" role="status">
                {tFallback('capsuleOpener.rolling', 'Rolling')}
              </p>
            ) : (
              <button
                type="button"
                onClick={handleOpen}
                className="w-full max-w-xs h-14 rounded-full bg-primary text-primary-foreground font-display text-title"
              >
                {tFallback('capsuleOpener.openCapsule', 'Open Capsule')}
              </button>
            )}
          </div>
        )}

        {/* ── SPINNING: one reel per capsule, in turn ───────────────────── */}
        {phase === 'spinning' && currentReel && (
          <div className="flex-1 flex flex-col">
            <div className="relative flex-1 min-h-[180px] flex items-end justify-center pb-5">
              <CapsuleCanister
                key={currentReel.capsuleId}
                tier={tier}
                open
                liftLid
                height="clamp(150px, 30vh, 250px)"
              />
              {isBatch && (
                <span className="stamp absolute start-5 bottom-5">
                  {tFallback('capsuleOpener.capsuleOf', 'Capsule {i} of {n}', { i: reelIndex + 1, n: reels.length })}
                </span>
              )}
              <span className="stamp absolute end-5 bottom-5">{tierFinish(tFallback, tier)}</span>
            </div>

            <CapsuleReel
              key={currentReel.capsuleId}
              cards={currentReel.cards}
              winIndex={currentReel.winIndex}
              variant={currentReel.variant}
              speed={isBatch ? 0.6 : 1}
              onSettled={handleReelSettled}
            />

            <div className="px-5 pt-6 flex flex-col items-center gap-2">
              <span className="text-label font-semibold uppercase tracking-wider text-muted-foreground" role="status">
                {tFallback('capsuleOpener.rolling', 'Rolling')}
              </span>
              {isBatch && (
                <button
                  type="button"
                  onClick={skip}
                  className="h-11 px-4 text-label font-semibold text-foreground"
                >
                  {tFallback('capsuleOpener.skip', 'Skip to results')}
                </button>
              )}
            </div>

            <div className="px-5 pt-6 pb-6 mt-auto">
              <PityMeter bar snapshot={pitySnapshot} />
            </div>
          </div>
        )}

        {/* ── ENCORE: a legendary or better gets one more spin ───────────── */}
        {phase === 'encore' && encore && (
          <div className="flex-1 flex flex-col justify-center gap-6 pb-6">
            <div className="px-5 flex flex-col items-center gap-1 text-center">
              <span className="font-display text-display" style={{ color: rarityTint(encore.item.rarity).color }}>
                {rarityName(tFallback, encore.item.rarity)}
              </span>
              <span className="text-label text-muted-foreground">
                {tFallback('capsuleOpener.encoreSub', 'Legendary or better only')}
              </span>
            </div>
            <CapsuleReel
              cards={encore.cards}
              winIndex={encore.winIndex}
              variant={encore.variant}
              onSettled={handleEncoreSettled}
            />
          </div>
        )}

        {/* ── REVEAL ─────────────────────────────────────────────────────── */}
        {phase === 'revealing' && shown && (
          <Reveal
            results={results}
            pick={pick}
            setPick={setPick}
            inv={inv}
            fmt={fmt}
            tier={tier}
            next={next}
            collecting={collecting}
            onCollect={() => collect(false)}
            onCollectNext={() => collect(true)}
          />
        )}

        {/* Build stamp on every phase: the reveal is the screenshot someone
            sends when this screen looks wrong, and the hash answers "which
            build" in one step. 11px floor, muted. */}
        <button
          type="button"
          onClick={handleCopyBuild}
          className="block w-full pb-2 text-center text-micro text-muted-foreground/50 hover:text-muted-foreground"
          aria-label={tFallback('capsuleOpener.copyBuildDiagnosticInfo', 'Copy build diagnostic info to clipboard')}
        >
          {buildLabel()}
        </button>
      </div>
    </div>
  );
}

// ─── The reveal ───────────────────────────────────────────────────────────────
function Reveal({ results, pick, setPick, inv, fmt, tier, next, collecting, onCollect, onCollectNext }) {
  const { tFallback } = useLanguage();
  const item = results[pick].item;
  const tint = rarityTint(item.rarity);
  const info = describeResult(item, results, inv);
  const variant = item.variant ? VARIANTS[item.variant] : null;
  const price = sellPriceFor(item.rarity, item.variant);
  const isBatch = results.length > 1;

  const nextLabel = !next ? null
    : next.tier === 'elite' ? tFallback('capsuleOpener.nextElite', 'Collect and open the next elite')
    : next.tier === 'premium' ? tFallback('capsuleOpener.nextPremium', 'Collect and open the next premium')
    : tFallback('capsuleOpener.nextStandard', 'Collect and open the next standard');

  return (
    <div className="flex-1 flex flex-col" data-tier={tier}>
      <div className="flex flex-col items-center gap-4 px-5 pt-3">
        {/* key: a new plate lands each time a row is picked */}
        <div key={`${results[pick].capsuleId}`} className="sticker-land relative">
          <div
            className="relative rounded-2xl bg-card border flex items-center justify-center"
            style={{ width: 'clamp(140px, 24vh, 200px)', height: 'clamp(140px, 24vh, 200px)' }}
          >
            <Sticker
              itemId={item.id}
              emoji={item.emoji}
              rarity={item.rarity}
              size="70%"
              shadow
              label={item.name}
            />
            <NotchedCorner />
          </div>
          {info.set && (
            <span className="stamp absolute start-3 top-2.5">
              {tFallback('capsules.setNo', 'No. {no}', { no: formatSetNo(info.set.no) })}
            </span>
          )}
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="font-display text-display break-anywhere">{item.name}</span>
          <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-body font-semibold" style={{ color: tint.color }}>
            <span className="w-2 h-2 rounded-full" style={{ background: tint.color }} aria-hidden="true" />
            {rarityName(tFallback, item.rarity)}
            {variant && <span>{variant.badge}</span>}
            <span className="text-muted-foreground font-medium">{lootDescription(item, tFallback)}</span>
          </span>
        </div>
      </div>

      <div className="mx-5 mt-5 py-3 border-y flex flex-col gap-2.5">
        {info.set && info.owned != null && (
          <>
            <div className="flex justify-between items-baseline text-label">
              <span>{tFallback('capsules.set.title', 'The sticker set')}</span>
              <span className="tabular-nums text-muted-foreground">
                {info.isNew
                  ? tFallback('capsules.set.newOf', 'New. {owned} of {total}', { owned: info.owned, total: info.total })
                  : tFallback('capsules.set.of', '{owned} of {total}', { owned: info.owned, total: info.total })}
              </span>
            </div>
            <PunchStrip owned={info.owned} total={info.total} fresh={info.isNew} freshColor={tint.color} />
          </>
        )}
        <div className="flex justify-between text-label text-muted-foreground">
          <span>
            {info.isNew && info.copies === 1
              ? tFallback('capsules.copies.first', 'First copy')
              : tFallback('capsules.copies.have', 'You have {n} copies', { n: info.copies })}
          </span>
          <span className="tabular-nums inline-flex items-center gap-1">
            {tFallback('capsules.sellsFor', 'Sells for')}
            <FlexCoinIcon size={14} />
            <b className="text-foreground font-semibold">{fmt(price)}</b>
          </span>
        </div>
      </div>

      {isBatch && (
        <div className="px-5 pt-4 flex flex-col">
          <span className="eyebrow pb-1">{tFallback('capsuleOpener.inThisOpen', 'In this open')}</span>
          {results.map((r, i) => {
            const t = rarityTint(r.item.rarity);
            const no = setNumber(r.item.id);
            return (
              <button
                key={r.capsuleId}
                type="button"
                onClick={() => setPick(i)}
                aria-pressed={i === pick}
                className="h-14 border-t flex items-center gap-2 text-start"
              >
                <span
                  className="w-[3px] h-7 rounded-full me-1"
                  style={{ background: i === pick ? 'hsl(var(--foreground))' : 'transparent' }}
                  aria-hidden="true"
                />
                <Sticker itemId={r.item.id} emoji={r.item.emoji} rarity={r.item.rarity} size={40} className="me-1" />
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-body font-semibold truncate">{r.item.name}</span>
                  <span className="text-caption" style={{ color: t.color }}>{rarityName(tFallback, r.item.rarity)}</span>
                </span>
                {no && (
                  <span className="stamp">{tFallback('capsules.setNo', 'No. {no}', { no: formatSetNo(no.no) })}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Pinned CTAs. The spacer keeps the last row clear of them. */}
      <div className="h-6 shrink-0" />
      <div className="sticky bottom-0 mt-auto px-5 pt-3 pb-3 bg-background flex flex-col gap-1">
        <button
          type="button"
          onClick={onCollect}
          disabled={collecting}
          className="h-14 rounded-full bg-primary text-primary-foreground font-display text-title disabled:opacity-60"
        >
          {isBatch
            ? tFallback('capsuleOpener.collectAll', 'Collect all {n}', { n: results.length })
            : tFallback('capsuleOpener.collect', 'Collect')}
        </button>
        {nextLabel && (
          <button
            type="button"
            onClick={onCollectNext}
            disabled={collecting}
            className="h-11 text-label font-semibold text-foreground disabled:opacity-60"
          >
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}
