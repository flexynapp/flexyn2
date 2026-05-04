// src/components/hub/StickerDisplay.jsx
// Renders an animated sticker emoji with optional foil/gold/diamond variant effects.
// Used in UserBag cards, CapsuleOpener reveal, and hub post sticker reactions.

import { motion } from 'framer-motion';

export default function StickerDisplay({ emoji, variant = null, size = 40, className = '' }) {
  const px = size;
  const emojiSize = Math.round(px * 0.72);

  if (!variant) {
    return (
      <span
        className={`inline-flex items-center justify-center select-none ${className}`}
        style={{ fontSize: emojiSize, lineHeight: 1 }}
      >
        {emoji}
      </span>
    );
  }

  // ── Foil: sliding shimmer pass ──────────────────────────────────────────────
  if (variant === 'foil') {
    return (
      <div
        className={`relative inline-flex items-center justify-center rounded-xl overflow-hidden select-none ${className}`}
        style={{ width: px, height: px }}
      >
        <span style={{ fontSize: emojiSize, lineHeight: 1, position: 'relative', zIndex: 1 }}>
          {emoji}
        </span>
        {/* sliding shimmer */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(105deg, transparent 25%, rgba(255,255,255,0.75) 50%, transparent 75%)',
            borderRadius: 'inherit',
          }}
          animate={{ x: ['-110%', '210%'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'linear', repeatDelay: 1.2 }}
        />
        {/* foil border */}
        <div
          className="absolute inset-0 pointer-events-none rounded-xl"
          style={{ border: '1.5px solid rgba(200,220,255,0.55)' }}
        />
      </div>
    );
  }

  // ── Gold: pulsing golden aura ───────────────────────────────────────────────
  if (variant === 'gold') {
    return (
      <motion.div
        className={`relative inline-flex items-center justify-center rounded-xl select-none ${className}`}
        style={{ width: px, height: px }}
        animate={{
          boxShadow: [
            '0 0 6px 1px #f59e0b55',
            '0 0 18px 6px #f59e0baa',
            '0 0 6px 1px #f59e0b55',
          ],
        }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span style={{ fontSize: emojiSize, lineHeight: 1, position: 'relative', zIndex: 1 }}>
          {emoji}
        </span>
        <div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            border: '1.5px solid #f59e0b',
            background: 'linear-gradient(135deg, rgba(245,158,11,0.15), transparent)',
          }}
        />
      </motion.div>
    );
  }

  // ── Diamond: rainbow hue-rotate + corner sparkles ───────────────────────────
  if (variant === 'diamond') {
    return (
      <div
        className={`relative inline-flex items-center justify-center rounded-xl select-none overflow-visible ${className}`}
        style={{ width: px, height: px }}
      >
        <motion.span
          style={{ fontSize: emojiSize, lineHeight: 1, position: 'relative', zIndex: 1, display: 'inline-block' }}
          animate={{
            filter: [
              'hue-rotate(0deg) brightness(1.15) saturate(1.3)',
              'hue-rotate(180deg) brightness(1.35) saturate(1.6)',
              'hue-rotate(360deg) brightness(1.15) saturate(1.3)',
            ],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        >
          {emoji}
        </motion.span>
        <div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            border: '1.5px solid #67e8f9',
            background: 'linear-gradient(135deg, rgba(103,232,249,0.18), transparent, rgba(129,140,248,0.15))',
          }}
        />
        {/* corner sparkles */}
        {[0, 1, 2, 3].map(i => (
          <motion.span
            key={i}
            className="absolute pointer-events-none"
            style={{
              fontSize: Math.max(7, Math.round(px * 0.18)),
              top:  ['8%', '72%', '8%',  '72%'][i],
              left: ['8%', '8%',  '72%', '72%'][i],
              color: '#c7d2fe',
              lineHeight: 1,
              zIndex: 2,
            }}
            animate={{ opacity: [0, 1, 0], scale: [0.4, 1.3, 0.4] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.35, ease: 'easeInOut' }}
          >
            ✦
          </motion.span>
        ))}
      </div>
    );
  }

  // fallback
  return (
    <span className={`inline-flex items-center justify-center select-none ${className}`} style={{ fontSize: emojiSize }}>
      {emoji}
    </span>
  );
}
