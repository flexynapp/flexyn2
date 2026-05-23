import { motion } from 'framer-motion';

// ── Floating particle dots for higher tiers ────────────────────────────────
//
// Used inside LevelUpOverlay. `type` is derived from the user's current
// tier (see xpTier.js → tier.particles). Additional `burst` prop triggers
// an outward explosion animation from the card centre (fired on level-up).

const DOT_CONFIG = {
  golden: [
    { x: '10%', y: '20%', size: 4,   delay: 0,   color: '#fbbf24' },
    { x: '80%', y: '15%', size: 3,   delay: 0.3, color: '#f97316' },
    { x: '50%', y: '75%', size: 3,   delay: 0.6, color: '#fbbf24' },
    { x: '25%', y: '60%', size: 2,   delay: 0.9, color: '#fcd34d' },
    { x: '70%', y: '55%', size: 3,   delay: 0.15, color: '#f97316' },
    { x: '90%', y: '80%', size: 2,   delay: 0.5, color: '#fbbf24' },
    { x: '15%', y: '85%', size: 2.5, delay: 0.7, color: '#fcd34d' },
    { x: '60%', y: '10%', size: 3,   delay: 1.0, color: '#f97316' },
    { x: '35%', y: '35%', size: 2,   delay: 0.4, color: '#fbbf24' },
  ],
  sparkle: [
    { x: '15%', y: '25%', size: 3,   delay: 0,   color: '#c084fc' },
    { x: '75%', y: '20%', size: 2.5, delay: 0.4, color: '#818cf8' },
    { x: '55%', y: '65%', size: 3,   delay: 0.7, color: '#a78bfa' },
    { x: '30%', y: '55%', size: 2,   delay: 1.0, color: '#c084fc' },
    { x: '85%', y: '70%', size: 2.5, delay: 0.2, color: '#818cf8' },
    { x: '45%', y: '15%', size: 2,   delay: 0.6, color: '#a78bfa' },
  ],
  default: [
    { x: '20%', y: '30%', size: 3,   delay: 0,   color: '#60a5fa' },
    { x: '70%', y: '60%', size: 2.5, delay: 0.5, color: '#34d399' },
    { x: '85%', y: '25%', size: 3,   delay: 0.9, color: '#60a5fa' },
    { x: '40%', y: '70%', size: 2,   delay: 0.3, color: '#34d399' },
  ],
};

// Star-burst ring that fires outward from centre on level-up
function BurstRing({ color, delay, radius }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: 8,
        height: 8,
        top: '50%',
        left: '50%',
        marginTop: -4,
        marginLeft: -4,
        backgroundColor: color,
        opacity: 1,
      }}
      initial={{ x: 0, y: 0, scale: 1, opacity: 0.9 }}
      animate={{
        x: Math.cos((delay / 8) * Math.PI * 2) * radius,
        y: Math.sin((delay / 8) * Math.PI * 2) * radius,
        scale: 0,
        opacity: 0,
      }}
      transition={{
        duration: 0.8,
        ease: 'easeOut',
        delay: 0.1 + (delay % 3) * 0.06,
      }}
    />
  );
}

export default function Particles({ type, burst = false }) {
  if (type === 'none') return null;

  const dots = DOT_CONFIG[type] || DOT_CONFIG.default;
  const burstColors = type === 'golden'
    ? ['#fbbf24', '#f97316', '#fcd34d', '#fb923c']
    : type === 'sparkle'
    ? ['#c084fc', '#818cf8', '#a78bfa', '#e879f9']
    : ['#60a5fa', '#34d399', '#a78bfa', '#f87171'];

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-3xl">
      {/* Floating ambient dots */}
      {dots.map((dot, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            left: dot.x,
            top: dot.y,
            width: dot.size,
            height: dot.size,
            backgroundColor: dot.color,
            boxShadow: `0 0 ${dot.size * 2}px ${dot.color}`,
          }}
          animate={
            type === 'golden'
              ? { opacity: [0, 0.9, 0], scale: [0.4, 1.8, 0.4], y: [0, -10, 0] }
              : type === 'sparkle'
              ? { opacity: [0, 1, 0], scale: [0, 1.4, 0], rotate: [0, 45, 0] }
              : { opacity: [0.2, 0.9, 0.2], scale: [1, 1.6, 1] }
          }
          transition={{
            duration: type === 'golden' ? 1.8 : type === 'sparkle' ? 1.3 : 2.4,
            delay: dot.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}

      {/* Outward burst ring — fires once when level-up event arrives */}
      {burst && Array.from({ length: 16 }, (_, i) => (
        <BurstRing
          key={i}
          color={burstColors[i % burstColors.length]}
          delay={i}
          radius={80 + (i % 4) * 15}
        />
      ))}
    </div>
  );
}
