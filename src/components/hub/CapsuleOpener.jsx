// src/components/hub/CapsuleOpener.jsx
// Premium capsule opening experience with slot-reel animation.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles } from 'lucide-react';
import { ITEMS, RARITY, rollCapsule, rollVariant, VARIANTS } from '@/lib/lootCatalog';
import StickerDisplay from './StickerDisplay';

// ─── Constants ────────────────────────────────────────────────────────────────
const CARD_W     = 130; // px
const CARD_GAP   = 12;  // px
const CARD_STRIDE = CARD_W + CARD_GAP;
const WIN_INDEX  = 18;  // 0-based; winning item sits at position 18 in a 22-card reel

// ─── Rarity visual config ─────────────────────────────────────────────────────
const RARITY_CARD = {
  common:    { border: 'border-slate-400',  glow: 'shadow-slate-400/60',  ring: '#94a3b8' },
  uncommon:  { border: 'border-green-400',  glow: 'shadow-green-400/60',  ring: '#4ade80' },
  rare:      { border: 'border-blue-400',   glow: 'shadow-blue-400/60',   ring: '#60a5fa' },
  epic:      { border: 'border-purple-400', glow: 'shadow-purple-400/60', ring: '#c084fc' },
  legendary: { border: 'border-amber-400',  glow: 'shadow-amber-400/60',  ring: '#fbbf24' },
  animated:  { border: 'border-pink-400',   glow: 'shadow-pink-400/60',   ring: '#f472b6' },
};

// ─── Weighted random item for reel filler ─────────────────────────────────────
const FILLER_WEIGHTS = { common: 40, uncommon: 30, rare: 15, epic: 10, legendary: 4, animated: 1 };

function weightedRandomItem() {
  const totalWeight = Object.values(FILLER_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;
  for (const [rarity, weight] of Object.entries(FILLER_WEIGHTS)) {
    roll -= weight;
    if (roll <= 0) {
      const pool = ITEMS.filter(i => i.type === 'sticker' && i.rarity === rarity);
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
  }
  return ITEMS.find(i => i.type === 'sticker' && i.rarity === 'common');
}

// ─── Build a 22-card reel array ───────────────────────────────────────────────
// Layout: [17 fillers] [mystery "???"] [winItem] [3 fillers after]
function buildReel(winItem) {
  const cards = [];
  for (let i = 0; i < 17; i++) cards.push(weightedRandomItem());
  cards.push({ id: '__mystery__', emoji: '❓', name: '???', rarity: 'common', type: 'sticker' });
  cards.push(winItem);
  for (let i = 0; i < 3; i++) cards.push(weightedRandomItem());
  return cards; // 22 cards total
}

// ─── ItemCard ─────────────────────────────────────────────────────────────────
function ItemCard({ item, highlight = false }) {
  const rc = RARITY_CARD[item.rarity] ?? RARITY_CARD.common;
  const isMystery = item.id === '__mystery__';
  return (
    <div
      className={[
        'flex-none flex flex-col items-center justify-center rounded-xl border-2 select-none',
        rc.border,
        highlight ? `shadow-lg ${rc.glow}` : '',
        isMystery ? 'bg-gray-900 opacity-60' : 'bg-[#0f0f2a]',
      ].join(' ')}
      style={{ width: CARD_W, height: 130 }}
    >
      <span className="text-4xl leading-none mb-2">{item.emoji}</span>
      <span className={`text-xs font-semibold truncate px-1 ${isMystery ? 'text-gray-500' : 'text-gray-300'}`}>
        {item.name}
      </span>
      {!isMystery && (
        <span
          className="mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            color: RARITY[item.rarity]?.color ?? '#fff',
            border: `1px solid ${RARITY[item.rarity]?.color ?? '#fff'}`,
          }}
        >
          {RARITY[item.rarity]?.label ?? item.rarity}
        </span>
      )}
    </div>
  );
}

// ─── Star field backdrop ──────────────────────────────────────────────────────
function StarField() {
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
          className="absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, opacity: s.opacity }}
          animate={{ opacity: [s.opacity, s.opacity * 0.3, s.opacity] }}
          transition={{ duration: s.duration, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
// Phases: 'idle' → 'spinning' → 'revealing' → 'claimed'
export default function CapsuleOpener({ capsule, onClaim, onClose }) {
  const [phase,   setPhase]   = useState('idle');
  const [wonItem, setWonItem] = useState(null);
  const [reel,    setReel]    = useState([]);

  const reelRef      = useRef(null);
  const containerRef = useRef(null);

  // ── Callback ref: fires the instant the reel div enters the DOM ─────────────
  // useEffect fires too early — with AnimatePresence mode="wait", the spinning
  // div isn't mounted when the effect runs (idle is still exiting). A callback
  // ref fires at the exact mount moment, guaranteeing the element is in DOM.
  const setReelRef = useCallback((el) => {
    reelRef.current = el;
    if (!el) return; // unmounting — nothing to do

    // Double-RAF so the browser paints the element at translateX=0 first.
    // If we skip this, the CSS transition has no "from" position and the reel
    // jumps straight to the final offset without animating.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        if (!el.isConnected) return; // unmounted between frames
        const ct = containerRef.current;
        const containerWidth = ct ? ct.offsetWidth : 400;
        const centerOffset   = Math.floor(containerWidth / 2) - Math.floor(CARD_W / 2);
        const winOffset      = WIN_INDEX * CARD_STRIDE - centerOffset;

        // 1. Pin to start with no transition, then force a reflow so the
        //    browser has a concrete "from" state for the transition.
        el.style.transition = 'none';
        el.style.transform  = 'translateX(0px)';
        void el.offsetWidth; // synchronous reflow

        // 2. Kick off the slide animation.
        el.style.transition = 'transform 3.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        el.style.transform  = `translateX(${-winOffset}px)`;

        // 3. Advance to revealing after the transition finishes.
        el.addEventListener('transitionend', () => {
          setTimeout(() => setPhase('revealing'), 200);
        }, { once: true });
      });
      // Store raf2 ID on the element so we can cancel it if the element
      // unmounts during the first RAF (rare but possible).
      el._raf2 = raf2;
    });
    el._raf1 = raf1;
  }, []); // no deps — callback identity stays stable for the lifetime of the open

  const capsuleEmoji = capsule?.capsule_type === 'elite'
    ? '💠' : capsule?.capsule_type === 'premium'
    ? '🎁' : '📦';

  // ── Trigger spin ────────────────────────────────────────────────────────────
  const handleOpen = useCallback(() => {
    const capsuleType = capsule?.capsule_type ?? 'standard';
    const won  = rollCapsule(capsuleType);
    const variant = rollVariant(capsuleType);
    const wonWithVariant = { ...won, variant };
    const cards = buildReel(won);
    setWonItem(wonWithVariant);
    setReel(cards);
    setPhase('spinning');
    // Actual CSS animation is kicked off in the useEffect below once the
    // reel DOM element is mounted.
  }, [capsule]);

  // ── Claim ────────────────────────────────────────────────────────────────────
  const handleClaim = useCallback(() => {
    setPhase('claimed');
    onClaim?.(wonItem);
  }, [wonItem, onClaim]);

  const rarityConfig = wonItem ? (RARITY[wonItem.rarity] ?? RARITY.common) : null;
  const cardStyle    = wonItem ? (RARITY_CARD[wonItem.rarity] ?? RARITY_CARD.common) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={phase === 'idle' ? onClose : undefined}
      />

      {/* Panel */}
      <motion.div
        className="relative z-10 w-full max-w-lg rounded-2xl overflow-hidden bg-[#0a0a1a] border border-white/10 shadow-2xl"
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        <StarField />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            Open Capsule
          </h2>
          {(phase === 'idle' || phase === 'claimed') && (
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
            >
              <X className="w-5 h-5" />
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
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="relative"
              >
                <div className="absolute inset-0 rounded-full bg-purple-500/20 blur-2xl scale-150" />
                <span className="relative text-8xl">{capsuleEmoji}</span>
              </motion.div>

              <div className="text-center">
                <p className="text-white font-semibold text-lg capitalize">
                  {capsule?.capsule_type ?? 'Standard'} Capsule
                </p>
                <p className="text-gray-400 text-sm mt-1">Crack it open to reveal your prize</p>
              </div>

              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleOpen}
                className="px-8 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-base shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 transition-shadow"
              >
                Open Capsule
              </motion.button>
            </motion.div>
          )}

          {/* ── SPINNING ───────────────────────────────────────────────────── */}
          {phase === 'spinning' && (
            <motion.div
              key="spinning"
              className="flex flex-col items-center py-10 gap-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <p className="text-gray-400 text-sm font-medium tracking-widest uppercase">Rolling…</p>

              {/* Reel container */}
              <div
                ref={containerRef}
                className="w-full relative overflow-hidden"
                style={{ height: 148 }}
              >
                {/* Center indicator */}
                <div className="absolute inset-y-0 left-1/2 -translate-x-px z-10 w-0.5 bg-purple-400/70 pointer-events-none" />
                {/* Left fade */}
                <div
                  className="absolute inset-y-0 left-0 z-10 w-20 pointer-events-none"
                  style={{ background: 'linear-gradient(to right, #0a0a1a, transparent)' }}
                />
                {/* Right fade */}
                <div
                  className="absolute inset-y-0 right-0 z-10 w-20 pointer-events-none"
                  style={{ background: 'linear-gradient(to left, #0a0a1a, transparent)' }}
                />

                {/* Reel track — animated imperatively via callback ref */}
                <div
                  ref={setReelRef}
                  className="absolute top-2 flex"
                  style={{ gap: CARD_GAP, paddingLeft: CARD_GAP, willChange: 'transform' }}
                >
                  {reel.map((item, idx) => (
                    <ItemCard key={`${item.id}-${idx}`} item={item} highlight={idx === WIN_INDEX} />
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── REVEALING ──────────────────────────────────────────────────── */}
          {phase === 'revealing' && wonItem && (
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

              <motion.div
                className={[
                  'relative flex flex-col items-center justify-center rounded-2xl border-2',
                  cardStyle.border, cardStyle.glow, 'bg-[#0f0f2a] shadow-2xl',
                ].join(' ')}
                style={{ width: 180, height: 200 }}
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
                <span className="text-white font-bold text-base relative z-10">{wonItem.name}</span>
              </motion.div>

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
                {wonItem.variant && (
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
                <p className="text-gray-400 text-sm text-center max-w-xs">{wonItem.description}</p>
              </motion.div>

              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleClaim}
                className="px-8 py-3 rounded-xl font-bold text-base text-white shadow-lg transition-shadow"
                style={{
                  background: `linear-gradient(135deg, ${rarityConfig.color}cc, ${rarityConfig.color}88)`,
                  boxShadow: `0 4px 24px ${rarityConfig.color}44`,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                Claim!
              </motion.button>
            </motion.div>
          )}

          {/* ── CLAIMED ────────────────────────────────────────────────────── */}
          {phase === 'claimed' && wonItem && (
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
              <p className="text-white font-bold text-lg">{wonItem.name} added to your bag!</p>
              <p className="text-gray-400 text-sm">Check your inventory to see it.</p>
              <button
                onClick={onClose}
                className="mt-2 px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold transition-colors"
              >
                Close
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </div>
  );
}
