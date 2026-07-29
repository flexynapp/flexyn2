// src/components/hub/CapsuleOpener.jsx
// Premium capsule opening experience with slot-reel animation.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, BookOpen } from 'lucide-react';
import { toast } from '@/lib/toast';
import { ITEMS, BRANDED_ITEMS, getItemsByRarity, VARIANTS } from '@/lib/lootCatalog';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { pickItemForRoll } from '@/lib/lootRoll';
import { LOOT_THEMES, getLootThemeById } from '@/lib/lootThemes';
import { LOOT_FRAMES } from '@/lib/lootFrames';
// LOOT_TITLES is still used by pickItemForRoll for title items.
import { LOOT_TITLES } from '@/lib/lootTitles';
import { supabase } from '@/api/supabaseClient';
import { triggerHaptic } from '@/lib/haptic';
import StickerDisplay from './StickerDisplay';
import CapsuleRarityOdds from './CapsuleRarityOdds';
import CapsuleStreak from './CapsuleStreak';

// The capsule's "what's in here?" link now opens the same Collection
// surface as the Marketplace and the Bag, so the odds you just read
// sit next to the slots you haven't filled.
const CollectionModal = lazy(() => import('@/components/loot/CollectionModal'));

// ─── Constants ────────────────────────────────────────────────────────────────
const CARD_W     = 130; // px
const CARD_GAP   = 12;  // px
// Stride is derived per-reel now (CapsuleReel takes a cardW), because a
// stacked batch renders smaller cards than a single open.
// The winning slot is NOT a constant. It used to be: every reel was 22
// cards with the win pinned at index 18, so every spin travelled exactly
// the same distance and the only thing that changed between opens was the
// easing curve. Users read that as "it's the same spin every time, just a
// different item" — which it was. See buildReel.

// ─── Spin variants ────────────────────────────────────────────────────────────
// Five distinct "personas" the reel can take on. We pick one at random
// per spin so the open feels different every time — even when the user
// is opening their twelfth standard capsule. Each variant tunes:
//   • duration  — how long the slide takes (seconds)
//   • easing    — the CSS cubic-bezier driving the velocity curve
//   • kicker    — the small "Rolling…" caption above the reel
//   • overshoot — when true, the bezier briefly slides past the winning
//                 card and settles back, creating a "near miss → snap to
//                 win" feel. Implemented purely via the easing curve
//                 (back-out style), no multi-stage transition needed.
//
// The animated reveal phase below the reel intentionally stays the same
// — that's the moneyshot. Variation lives in the build-up.
const SPIN_VARIANTS = [
  // Classic — the original feel. Smooth deceleration. Default.
  { id: 'classic', duration: 3.2, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', kicker: 'Rolling…' },
  // Tease — slow, drawn-out, builds suspense. Almost no acceleration.
  { id: 'tease',   duration: 4.6, easing: 'cubic-bezier(0.16, 1, 0.3, 1)',        kicker: 'Building up…' },
  // Snap — fast and decisive. Quick blur, hard stop.
  { id: 'snap',    duration: 2.4, easing: 'cubic-bezier(0.5, 0, 0.75, 0.2)',      kicker: 'Cracking…' },
  // Hype — back-out overshoot. Reel briefly blows past the win then
  // settles back. Creates a "wait, is that it?" double-take.
  { id: 'hype',    duration: 3.5, easing: 'cubic-bezier(0.34, 1.32, 0.64, 1)',    kicker: 'Spinning…' },
  // Crawl — long, even, hypnotic. Sometimes the wait is the point.
  { id: 'crawl',   duration: 4.2, easing: 'cubic-bezier(0.23, 1, 0.32, 1)',       kicker: 'Locking in…' },
];

function pickSpinVariant() {
  return SPIN_VARIANTS[Math.floor(Math.random() * SPIN_VARIANTS.length)];
}

// Rarity borders/glows come from the shared `rarityTint`, which derives
// them from the ONE colour in lootCatalog.RARITY. This file used to keep
// its own RARITY_CARD map of Tailwind class names — a fourth private copy
// of the same ladder that had to be edited by hand whenever a tier moved.

// ─── Rarity ladder ────────────────────────────────────────────────────────────
// Declared up here because buildReel's near-miss seeding reads it. Keeping
// it below would trip no-use-before-define, which this repo treats as a
// real hazard after the 2026-05-23 production TDZ crash.
const RARITY_LADDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'animated'];
function rarityRank(r) {
  const i = RARITY_LADDER.indexOf(r);
  return i < 0 ? 0 : i;
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
  (LOOT_THEMES || []).forEach(push);
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

// ─── Rarity ranking + a single server-authoritative roll ──────────────────────
// Pulled out of handleOpen so one capsule and ten capsules share exactly
// one roll path. Every roll is its own claim_capsule_loot call (migration
// 028), which locks that capsule row and rolls server-side — batching is
// purely a UI affordance, it does not touch how loot is decided.
async function rollOneCapsule(capsuleId) {
  const { data, error } = await supabase.rpc('claim_capsule_loot', { p_capsule_id: capsuleId });
  if (error) {
    const e = new Error(error.message || 'claim_capsule_loot failed');
    // Pre-028 hosts fail closed. The removed alternative was a client-side
    // Math.random() roll, i.e. "open DevTools and force legendary".
    e.missingRpc = (error.code === '42883' || error.code === '42P01');
    throw e;
  }
  if (!data) return null; // already opened by another tab/device

  // Validate the variant against the catalog before trusting it — a future
  // server typo like 'gld' would otherwise ride into the item object and
  // break at the render site instead of here.
  const variant = (data.variant && VARIANTS && VARIANTS[data.variant]) ? data.variant : null;

  let item = pickItemForRoll(data.category, data.rarity);
  if (!item) {
    // CATALOG-LOOKUP fallback, not a roll fallback — the server already
    // decided the rarity; the client just has no item of that
    // (category, rarity) pair yet.
    const fallback = getItemsByRarity(data.rarity);
    item = fallback.length ? fallback[0] : null;
  }
  if (!item) return null;
  return variant ? { ...item, variant } : item;
}

// ─── ItemCard ─────────────────────────────────────────────────────────────────
function ItemCard({ item, highlight = false, width = CARD_W }) {
  const tint = rarityTint(item.rarity);
  const isMystery = item.id === '__mystery__';
  return (
    <div
      className={[
        'flex-none flex flex-col items-center justify-center rounded-xl border-2 select-none',
        isMystery ? 'bg-secondary opacity-60' : 'bg-card',
      ].join(' ')}
      style={{
        width,
        height: width,
        borderColor: tint.border,
        boxShadow: highlight ? tint.glow : undefined,
      }}
    >
      <span className="leading-none mb-1" style={{ fontSize: Math.round(width * 0.3) }}>{item.emoji}</span>
      <span
        className={`font-semibold truncate px-1 ${isMystery ? 'text-muted-foreground' : 'text-foreground/80'}`}
        style={{ fontSize: Math.max(8, Math.round(width * 0.09)) }}
      >
        {item.name}
      </span>
      {!isMystery && width >= 100 && (
        <span
          className="mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ color: tint.color, border: `1px solid ${tint.color}` }}
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
  const stride = cardW + CARD_GAP;

  // Settle exactly once, whichever signal arrives first.
  const settle = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
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
    const ms = variant.duration * speed * 1000 + 600;
    timerRef.current = setTimeout(settle, ms);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [variant, speed, settle]);

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
        const winOffset    = winIndex * stride - centerOffset;

        el.style.transition = 'none';
        el.style.transform  = 'translateX(0px)';
        void el.offsetWidth; // force reflow so there IS a "from" state

        el.style.transition = `transform ${(variant.duration * speed).toFixed(2)}s ${variant.easing}`;
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
      <div className="absolute inset-y-0 start-1/2 -translate-x-px z-10 w-0.5 bg-primary/70 pointer-events-none" />
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
        className="absolute top-2 flex"
        style={{ gap: CARD_GAP, paddingLeft: CARD_GAP, willChange: 'transform' }}
      >
        {cards.map((item, idx) => (
          <ItemCard
            key={`${item.id}-${idx}`}
            item={item}
            highlight={idx === winIndex}
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
  const { item } = entry;
  const tint = rarityTint(item.rarity);
  return (
    <motion.div
      className="relative flex flex-col items-center justify-center rounded-xl border-2 bg-card p-2 gap-1 text-center min-h-[92px]"
      style={{ borderColor: tint.border, boxShadow: isBest ? tint.glow : undefined }}
      initial={{ scale: 0.6, opacity: 0, y: 8 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22, delay }}
    >
      {isBest && (
        <span
          className="absolute -top-1.5 px-1.5 rounded-full text-[8px] font-extrabold uppercase tracking-wider"
          style={{ backgroundColor: tint.color, color: '#000' }}
        >
          Best
        </span>
      )}
      <StickerDisplay emoji={item.emoji} variant={item.variant} size={30} />
      <span className="text-[10px] font-semibold leading-tight line-clamp-2">{item.name}</span>
      <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: tint.color }}>
        {tint.label}
      </span>
    </motion.div>
  );
}


// ─── Component ────────────────────────────────────────────────────────────────
// Phases: 'idle' → 'spinning' → 'revealing' → 'claimed'
// Ten capsules used to mean ten full round trips through this modal:
// open bag → tap capsule → 3s spin → claim → close → bag reopens → repeat.
// `batch` runs one spin and reveals every result at once. It is a UI
// affordance only: each capsule is still rolled by its own
// claim_capsule_loot call, server-side, independently.
const MAX_BATCH = 10;

export default function CapsuleOpener({ capsule, batch, onClaim, onClaimBatch, onClose }) {
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
  const [waveIndex, setWaveIndex] = useState(0);
  const [settledInWave, setSettledInWave] = useState(0);
  const [catalogOpen, setCatalogOpen] = useState(false);
  // Kicker caption for the current wave. Each reel carries its own variant
  // so a stack doesn't move in lockstep; this is just the label.
  const [spinVariant, setSpinVariant] = useState(SPIN_VARIANTS[0]);

  const capsuleEmoji = capsule?.capsule_type === 'elite'
    ? '💠' : capsule?.capsule_type === 'premium'
    ? '🎁' : '📦';

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
    // Whole wave has landed. Beat, then either the next stack or the haul.
    const t = setTimeout(() => {
      if (waveIndex + 1 < reelWaves.length) {
        setWaveIndex(i => i + 1);
        setSettledInWave(0);
      } else {
        setPhase('revealing');
      }
    }, 700);
    return () => clearTimeout(t);
  }, [phase, settledInWave, currentWave.length, waveIndex, reelWaves.length]);

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
    setSpinVariant(pickSpinVariant());

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
      rolled = await Promise.all(targets.map(async (c) => ({
        capsuleId: c.id,
        item: await rollOneCapsule(c.id),
      })));
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
      return { capsuleId, item, cards, winIndex, variant: pickSpinVariant() };
    });

    setResults(ok);
    setReels(specs);
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
    else onClaim?.(wonItem);
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

  // Scroll lock — capture the ORIGINAL overflow value once at mount
  // and restore it once at unmount. The previous combined effect's
  // dep on [phase, onClose] meant every phase change ran cleanup +
  // re-setup; on the second run the "prevOverflow" captured the
  // 'hidden' value the FIRST run had set, leaking 'hidden' into the
  // restore path and leaving the body un-scrollable after the modal
  // closed.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

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
            Open Capsule
          </h2>
          {(phase === 'idle' || phase === 'claimed') && (
            <button
              onClick={onClose}
              aria-label="Close capsule dialog"
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-secondary"
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
                <span className="relative text-8xl">{capsuleEmoji}</span>
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
                <CapsuleRarityOdds capsuleType={(isBatch ? batchRows[0]?.capsule_type : capsule?.capsule_type) || 'standard'} />
                {/* Where you actually stand against those odds. Display
                    only — see src/lib/pity.js. */}
                <CapsuleStreak />
              </div>
              <button
                type="button"
                onClick={() => setCatalogOpen(true)}
                className="mb-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:opacity-80 underline-offset-2 hover:underline transition-opacity"
              >
                <BookOpen className="w-3 h-3" aria-hidden="true" />
                Browse collection
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

              <div className="relative z-10 w-full grid grid-cols-3 sm:grid-cols-5 gap-2">
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
                      <span className="relative z-10 mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                        style={{ background: `${rarityConfig.color}30`, color: rarityConfig.color, border: `1px solid ${rarityConfig.color}60` }}>
                        Animated
                      </span>
                    )}
                    <div className="relative z-10 mt-2 flex items-center justify-center">
                      <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: rarityConfig.color }}>
                        Theme Drop
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
                className="mt-2 px-6 py-2.5 rounded-xl bg-secondary hover:bg-secondary/70 text-secondary-foreground font-semibold transition-colors"
              >
                Close
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
                className="mt-2 px-6 py-2.5 rounded-xl bg-secondary hover:bg-secondary/70 text-secondary-foreground font-semibold transition-colors"
              >
                Close
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>

      {catalogOpen && (
        <Suspense fallback={null}>
          <CollectionModal open={catalogOpen} onClose={() => setCatalogOpen(false)} />
        </Suspense>
      )}

    </div>
  );
}
