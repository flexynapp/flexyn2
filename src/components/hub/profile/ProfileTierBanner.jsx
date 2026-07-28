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

// 148 -> 176 to fit two rows of content without crowding either. Still under
// the ~150pt cover convention plus one row of chrome.
const HERO_HEIGHT = 176;

// Fine monochrome noise, inline so there's no request and nothing to 404.
// `overlay` lets it darken the lights and lighten the darks rather than
// greying the whole surface down.
const GRAIN = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
  opacity: 0.17,
  mixBlendMode: 'overlay',
};

// Below this the chip is a scold rather than a brag, so it doesn't render.
// One day is not a streak; it's a Tuesday.
const STREAK_CHIP_MIN = 2;

export default function ProfileTierBanner({
  tier,
  level,
  levelLabel,
  levelWord,
  xpInLevel,
  xpNeeded,
  progressPercent,
  isAdminProfile = false,
  week = [],
  streak = 0,
  tFallback,
  contests = null,
  primaryTrophy = null,
}) {
  // Fall back to English when the caller doesn't pass a translator — the
  // component is rendered in tests and previews without LanguageContext.
  const tf = tFallback || ((_k, fb) => fb);

  const xpToNext = Number.isFinite(xpNeeded) && Number.isFinite(xpInLevel)
    ? Math.max(0, Math.round(xpNeeded - xpInLevel))
    : null;
  const xpToNextLabel = tf('profile.hero.xpToNext', '{n} XP to {lv} {next}')
    .replace('{n}', xpToNext != null ? xpToNext.toLocaleString() : '')
    .replace('{lv}', levelWord || '')
    .replace('{next}', String((level ?? 0) + 1));
  const streakLabel = tf('profile.hero.days', 'days');
  const trainedCount = week.filter((d) => d.trained).length;
  const weekLabel = tf('profile.hero.weekSummary', 'Trained {n} of the last 7 days')
    .replace('{n}', String(trainedCount));
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
      style={{ height: HERO_HEIGHT }}
    >
      {/* Gradient plate. Scaled from the bottom edge so growth pushes up
          into the status bar rather than down over the avatar. */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          // tier.surface is a three-layer mesh: specular highlight, chroma
          // bloom in a different hue, deep base. The old `bg-gradient-to-br
          // ${tier.badge}` was two adjacent hues in one direction, which is
          // a tint ramp — no light source, no chroma travel, visible banding.
          background: tier.surface,
          ...(reduceMotion ? {} : { scale, filter, transformOrigin: 'center bottom' }),
        }}
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

      {/* Primary trophy — the crest.
          Slot 1 of the trophy case, rendered large behind everything. It sits
          UNDER the grain and vignette rather than on top of them, so it reads
          as struck into the banner's material rather than as a sticker placed
          over it — the same reason a watermark on paper looks like part of
          the page and a decal doesn't.

          Positioned centre-right and cropped by the edge, which is the one
          region no widget occupies: week strip and streak take the top row,
          contests the middle, XP and tier the bottom. */}
      {primaryTrophy && (
        <div
          aria-hidden="true"
          className="absolute pointer-events-none select-none"
          style={{
            // Centred just right of middle, NOT pinned to the edge. At the
            // edge it sat directly behind the tier block and the crown's
            // points cut through "BRONZE". Here it clears the tier lockup on
            // the right and the week strip on the left, and where the contest
            // pills cross it they're glass — so it reads through the blur,
            // which is what glass is for.
            left: '52%',
            top: '50%',
            transform: 'translate(-50%, -50%) rotate(-8deg)',
            fontSize: 120,
            lineHeight: 1,
            opacity: 0.75,
            filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.35))',
          }}
        >
          {primaryTrophy}
        </div>
      )}

      {/* Grain. An inline feTurbulence over `overlay` — it destroys the
          banding an 8-bit gradient produces across 390px and gives the
          surface a tactile quality flat vector colour can't have. One rule,
          no network request. This is the single largest cheap-to-premium
          lever on the whole page. */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={GRAIN} />

      {/* Vignette, not a scrim. A flat black ramp over the bottom half
          turned the richest part of the gradient into mud; corner-weighting
          keeps the text contrast and keeps the colour. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            // A touch of darkening along the very top too, so the week strip
            // and streak chip keep their contrast on Silver, Platinum and
            // Diamond — the three tiers whose highlight is close to white
            // exactly where those two widgets sit.
            'linear-gradient(to bottom, rgba(0,0,0,0.22) 0%, transparent 26%),'
            + 'radial-gradient(120% 95% at 50% -10%, transparent 40%, rgba(0,0,0,0.30) 100%),'
            + 'linear-gradient(to bottom, transparent 46%, rgba(0,0,0,0.42) 100%)',
        }}
      />

      {/* Week strip — top-left, over the one large region nothing else wants.
          Seven rolling days, filled means trained, today gets a ring.

          This is the answer to "what do lifters actually check", arrived at
          independently by two OSS fitness apps: workout-cool puts a five-day
          square strip in its APP HEADER, and workout-tracker ships both a
          heatmap and a profile calendar. Neither leads with totals, because
          lifetime numbers only go up and so say nothing about how you're
          doing now. Consistency is the only stat that can look bad, which is
          exactly what makes it worth showing. */}
      {week?.length > 0 && (
        <div
          className="absolute start-4 top-4 z-10 flex gap-1.5"
          role="img"
          aria-label={weekLabel}
        >
          {week.map((day) => (
            <div key={day.key} className="text-center" aria-hidden="true">
              <span
                className="block text-[9px] font-extrabold uppercase tracking-wider mb-1 leading-none"
                style={{
                  color: 'rgba(255,255,255,0.82)',
                  // Silver and Platinum are near-white at the top of the
                  // gradient, where the vignette barely reaches. Without this
                  // the labels vanish on two of the ten tiers.
                  textShadow: '0 1px 4px rgba(0,0,0,0.55)',
                }}
              >
                {day.label}
              </span>
              <span
                className="block"
                style={{
                  width: 19,
                  height: 19,
                  // Explicit, not `rounded-md` — that resolves through the
                  // theme's --radius token, which on a 19px box renders as a
                  // near-circle and loses the day-square read.
                  borderRadius: 6,
                  background: day.trained ? '#fff' : 'rgba(255,255,255,0.07)',
                  border: `1.5px solid ${day.trained ? '#fff' : 'rgba(255,255,255,0.38)'}`,
                  boxShadow: day.isToday
                    ? '0 0 0 2px rgba(0,0,0,0.3), 0 0 0 3.5px rgba(255,255,255,0.9)'
                    : day.trained ? '0 1px 6px rgba(255,255,255,0.45)' : undefined,
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Streak — top-right. Hidden below two days: "🔥 0" reads as a scold,
          and one day isn't a streak, it's a Tuesday. Derived from the same
          logs as the strip above, so the two can never contradict. */}
      {streak >= STREAK_CHIP_MIN && (
        <div
          className="absolute end-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full text-white"
          style={{
            background: 'rgba(0,0,0,0.26)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.16)',
            padding: '5px 11px 5px 8px',
          }}
        >
          <span aria-hidden="true">🔥</span>
          <span className="font-heading font-bold text-base leading-none tabular-nums">{streak}</span>
          <span className="text-[9.5px] font-extrabold uppercase tracking-wider opacity-90">
            {streakLabel}
          </span>
        </div>
      )}

      {/* Live contests — the middle band, between the week strip and the
          avatar's top edge. Absent entirely when there's nothing running,
          which is why the hero doesn't grow for it. */}
      {contests}

      {/* Tier + level. Bottom-right so it never collides with the avatar,
          which punches through the bottom-left of the same seam.

          Stacked and explicitly labelled. It used to render as "BRONZE 1" on
          one line, where the numeral had nothing to say what it counted —
          a bare "1" next to a tier name reads just as easily as a rank, a
          position, or a badge count. The tier is the eyebrow; the level is
          the headline, because the level is the thing that moves. */}
      <div className="absolute end-4 bottom-3.5 z-10 text-white text-end">
        <div
          className="font-heading font-bold text-xs uppercase tracking-[0.2em] opacity-90 leading-none"
          style={{ textShadow: '0 1px 6px rgba(0,0,0,0.55)' }}
        >
          {tier.name}
        </div>
        <div
          className="flex items-baseline justify-end gap-1.5 mt-1"
          style={{ textShadow: '0 1px 8px rgba(0,0,0,0.55)' }}
        >
          <span className="font-heading font-bold text-xs uppercase tracking-[0.16em] opacity-90">
            {levelWord}
          </span>
          <span className="font-heading font-bold text-3xl leading-none tabular-nums">
            {level}
          </span>
        </div>

        {/* XP as a pill under the level, spanning the lockup's own width —
            from the left edge of the tier name to the right edge of the
            level numeral, because the block is shrink-to-fit and this is
            w-full inside it.

            This replaces both the floating "150 XP to Lv 2" text AND the
            3px rail along the banner's bottom edge. Those were two renderings
            of one number in two places, which invites the reader to check
            whether they agree. Attached to the level it's unambiguous about
            what is progressing. */}
        <div
          className="w-full rounded-full overflow-hidden mt-1.5"
          style={{ height: 4, background: 'rgba(0,0,0,0.32)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)' }}
          role="progressbar"
          aria-valuenow={Math.round(progressPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={xpToNext != null ? xpToNextLabel : levelLabel}
        >
          <div
            className="h-full rounded-full bg-white"
            style={{
              width: `${railWidth}%`,
              boxShadow: '0 0 8px rgba(255,255,255,0.75)',
              transition: reduceMotion ? undefined : 'width 0.7s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        </div>
      </div>

    </div>
  );
}
