// src/components/hub/profile/ProfileTierBanner.jsx
//
// The profile cover. Before this existed, the XP tier lived in an 84px card
// three items down the page, rendered at `bg-<colour>-500/10` — ten percent
// opacity on a system that ships ten hand-tuned gradients (see xpTier.js).
// Here that same gradient runs at full saturation as the cover image, which
// is a banner no other fitness app can copy: ours is earned, and it regrades
// as the user levels.
//
// Layout notes:
//   • 148px tall, matching the ~150pt convention that leaves room for a
//     94px avatar to overlap the seam without crowding the identity block.
//   • The XP bar is the banner's bottom edge, not a widget — progress as
//     chrome. It reads as part of the frame, so it can be present on every
//     profile view without competing for attention.
//   • Overscroll grows the banner (iOS rubber-band drives scrollY negative).
//     This replaces four staggered mount animations: motion attached to the
//     finger reads as premium every time, motion attached to mount reads as
//     latency after the first visit.
import { useEffect, useState } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';

// Ambient dots. Particles.jsx hardcodes `rounded-3xl` on its root, which
// would clip a rectangular banner's corners — so the dots are inlined here
// against the same `.fx-dot` keyframes already defined in index.css.
const BANNER_DOTS = {
  golden: [
    { x: '8%',  y: '24%', size: 4,   c: '#fde68a', d: 0    },
    { x: '78%', y: '16%', size: 3,   c: '#fed7aa', d: 0.3  },
    { x: '46%', y: '70%', size: 3,   c: '#fef3c7', d: 0.6  },
    { x: '24%', y: '58%', size: 2,   c: '#fde68a', d: 0.9  },
    { x: '66%', y: '52%', size: 3,   c: '#fff7ed', d: 0.15 },
    { x: '90%', y: '74%', size: 2,   c: '#fde68a', d: 0.5  },
    { x: '14%', y: '82%', size: 2.5, c: '#fef3c7', d: 0.7  },
    { x: '58%', y: '12%', size: 3,   c: '#fed7aa', d: 1.0  },
  ],
  sparkle: [
    { x: '14%', y: '26%', size: 3,   c: '#ffffff', d: 0    },
    { x: '74%', y: '20%', size: 2.5, c: '#f5f3ff', d: 0.4  },
    { x: '54%', y: '64%', size: 3,   c: '#ffffff', d: 0.7  },
    { x: '30%', y: '54%', size: 2,   c: '#faf5ff', d: 1.0  },
    { x: '84%', y: '68%', size: 2.5, c: '#ffffff', d: 0.2  },
    { x: '44%', y: '16%', size: 2,   c: '#f5f3ff', d: 0.6  },
  ],
  pulse: [
    { x: '20%', y: '30%', size: 3,   c: '#ffffff', d: 0    },
    { x: '70%', y: '58%', size: 2.5, c: '#f8fafc', d: 0.5  },
    { x: '86%', y: '24%', size: 3,   c: '#ffffff', d: 0.9  },
    { x: '38%', y: '72%', size: 2,   c: '#f8fafc', d: 0.3  },
  ],
  none: [],
};

const DOT_ANIM = {
  golden:  'fx-dot-golden 1.8s',
  sparkle: 'fx-dot-sparkle 1.3s',
  pulse:   'fx-dot-default 2.4s',
};

export default function ProfileTierBanner({
  tier,
  level,
  levelLabel,
  xpInLevel,
  xpNeeded,
  progressPercent,
  isAdminProfile = false,
}) {
  const reduceMotion = useReducedMotion();
  const { scrollY } = useScroll();

  // Overscroll only. Positive scroll (normal downward reading) leaves the
  // banner at scale 1 so nothing shifts under the user's thumb; pulling the
  // page down past the top grows it. Clamped so a hard fling can't balloon it.
  const scale = useTransform(scrollY, [-160, 0], [1.45, 1], { clamp: true });
  const blur  = useTransform(scrollY, [-300, -70, -12], [7, 4, 0], { clamp: true });
  const filter = useTransform(blur, (b) => (b > 0.1 ? `blur(${b}px)` : 'none'));

  // The XP rail animates from 0 on first paint only — a progress bar that
  // doesn't fill has no way to communicate that it IS a progress bar.
  const [railWidth, setRailWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setRailWidth(progressPercent));
    return () => cancelAnimationFrame(id);
  }, [progressPercent]);

  const dots = BANNER_DOTS[tier.particles] ?? BANNER_DOTS.none;
  const dotAnim = DOT_ANIM[tier.particles];

  return (
    // Full-bleed: Hub.jsx wraps the profile in `px-4 md:px-6 max-w-3xl`,
    // so the banner cancels that padding to reach both screen edges.
    <div
      className="relative overflow-hidden -mx-4 md:-mx-6"
      style={{ height: 148 }}
    >
      {/* Gradient plate. Scaled from the bottom edge so growth pushes up
          into the status bar rather than down over the avatar. */}
      <motion.div
        aria-hidden="true"
        className={`absolute inset-0 bg-gradient-to-br ${tier.badge}`}
        style={
          reduceMotion
            ? undefined
            : { scale, filter, transformOrigin: 'center bottom' }
        }
      >
        {dots.map((dot, i) => (
          <div
            key={i}
            className="fx-dot absolute rounded-full"
            style={{
              left: dot.x,
              top: dot.y,
              width: dot.size,
              height: dot.size,
              backgroundColor: dot.c,
              boxShadow: `0 0 ${dot.size * 2.5}px ${dot.c}`,
              animation: dotAnim ? `${dotAnim} ${dot.d}s infinite ease-in-out` : undefined,
            }}
          />
        ))}

        {/* Steel wash for admin profiles — the tint that used to live on the
            header card's border now belongs to the cover. */}
        {isAdminProfile && (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(135deg, rgba(148,163,184,0.35) 0%, rgba(30,41,59,0.45) 100%)' }}
          />
        )}
      </motion.div>

      {/* Scrim — earns the white text its contrast without dimming the
          gradient's top half, which is the part people actually see. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(0,0,0,0.5) 100%)' }}
      />

      {/* Tier + level. Bottom-right so it never collides with the avatar,
          which punches through the bottom-left of the same seam. */}
      <div className="absolute end-4 bottom-4 z-10 flex items-baseline gap-2 text-white">
        <span
          className="font-heading font-bold text-sm uppercase tracking-widest"
          style={{ textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}
        >
          {tier.name}
        </span>
        <span
          className="font-heading font-bold text-3xl leading-none tabular-nums"
          style={{ textShadow: '0 1px 8px rgba(0,0,0,0.5)' }}
        >
          {level}
        </span>
      </div>

      {/*
        XP as the banner's bottom edge. aria-label carries the numbers the old
        card printed underneath, so nothing is lost to screen readers.

        The start inset clears the avatar, which punches through this exact
        edge on the left. Full-bleed it drew a 3px dark line straight across
        the avatar's face — its z-10 beat the avatar's z-index:auto, so the
        track won the paint order.

        Insetting rather than re-stacking is deliberate: if the avatar simply
        painted on top, the first ~22% of the bar would sit behind it, and a
        level-1 user — everyone on day one — would see a progress bar that
        never appears to start. The numbers are the container's padding
        (16px / 24px at md, cancelled by this banner's -mx-4 md:-mx-6), plus
        the 88px avatar, plus a 12px gap.
      */}
      <div
        className="absolute end-0 bottom-0 z-10 start-[116px] md:start-[124px]"
        style={{ height: 3, background: 'rgba(0,0,0,0.28)' }}
        role="progressbar"
        aria-valuenow={Math.round(progressPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${levelLabel} — ${Math.round(xpInLevel)} of ${xpNeeded} XP`}
      >
        <div
          className="h-full bg-white"
          style={{
            width: `${railWidth}%`,
            boxShadow: '0 0 8px rgba(255,255,255,0.8)',
            transition: reduceMotion ? undefined : 'width 0.7s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </div>
    </div>
  );
}
