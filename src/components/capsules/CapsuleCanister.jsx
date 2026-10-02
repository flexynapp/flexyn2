// src/components/capsules/CapsuleCanister.jsx
//
// The capsule as a machined canister: a turned body, a knurled collar, a lid
// with the swoosh embossed on it and grade bars stamped under a rule on the
// base. From the round 2 capsule design.
//
// The tier reads as MATERIAL: a bronze, silver, gold ladder (Kegan's pick,
// option 5, 2026-10-02), so the value order is one everybody already knows
// from medals. Elite also carries a dark band round its body, and the number
// of grade bars under the rule (one, two, three) says the same thing to
// anyone who cannot tell the finishes apart. None of the three uses a rarity
// hue: the rarity colours belong to what comes OUT of a capsule.
//
// The design stamped a serial number ("No. 0182") above the rule. Capsules
// have no serial in the database, so the stamp is left off rather than
// invented; the rule and the grade bars stay.
//
// Drawn flat: bands of solid colour for the turning, no gradients, no glow.

import { useId } from 'react';

// Body bands (shade, base, highlight, hot line, dark edge), collar, groove
// ticks, the stamp ink and the lid's swoosh. Straight from the design.
export const CANISTER_FINISH = {
  standard: {
    base: '#B0703F', shade: '#8A522A', hi: '#D79A66', hot: '#F2C9A2',
    collar: '#2E363E', collarHi: '#434D56', groove: '#4C565F', ink: '#5E3519',
    swooshHi: '#D79A66', swoosh: '#8A522A', bars: 1, brushed: null,
  },
  premium: {
    base: '#BFC8D0', shade: '#8E99A3', hi: '#E3E9EE', hot: '#FFFFFF',
    collar: '#2E363E', collarHi: '#434D56', groove: '#4C565F', ink: '#5C656E',
    swooshHi: '#E3E9EE', swoosh: '#8E99A3', bars: 2, brushed: null,
  },
  elite: {
    base: '#D9A93B', shade: '#A87A1E', hi: '#F2CE6A', hot: '#FFF3C4',
    collar: '#2E363E', collarHi: '#434D56', groove: '#4C565F', ink: '#7A5512',
    swooshHi: '#F2CE6A', swoosh: '#A87A1E', bars: 3, brushed: null,
    gem: '#F37616',
    rings: [{ top: 104, h: 4, color: '#262D34', hi: '#46515C' }],
  },
};

const EDGE = '#0F1215';
const FLOOR = '#0B0E10';

const BODY = 'M26 74A34 7.5 0 0 0 94 74V140C94 156 84 160 60 160C36 160 26 156 26 140Z';
const LID = 'M26 32C26 16 36 12 60 12C84 12 94 16 94 32V74A34 7.5 0 0 1 26 74Z';
const SWOOSH = 'M43 51H63C69.5 51 73.5 48 76 41.5';

// The knurling on the collar: [x, y, stroke width], foreshortened toward the
// edges the way a turned band is.
const KNURL = [
  [26.52, 78.3, 0.58], [28.05, 79.57, 0.85], [30.56, 80.75, 1.1], [33.95, 81.82, 1.33],
  [38.15, 82.75, 1.53], [43, 83.5, 1.69], [48.37, 84.05, 1.8], [54.1, 84.39, 1.88],
  [60, 84.5, 1.9], [65.9, 84.39, 1.88], [71.63, 84.05, 1.8], [77, 83.5, 1.69],
  [81.85, 82.75, 1.53], [86.05, 81.82, 1.33], [89.44, 80.75, 1.1], [91.95, 79.57, 0.85],
  [93.48, 78.3, 0.58],
];

const BRUSH_LINES = Array.from({ length: 34 }, (_, i) => 14 + i * 4.4);

/**
 * A painted ring round the turning: a strip that follows the canister's
 * curvature, with a thin highlight along its top edge. `top` and `h` are in
 * the drawing's units.
 */
function Ring({ top, h, color, hi }) {
  return (
    <>
      <path d={`M26 ${top}A34 7.5 0 0 0 94 ${top}V${top + h}A34 7.5 0 0 1 26 ${top + h}Z`} fill={color} />
      {hi && <path d={`M26 ${top + 0.8}A34 7.5 0 0 0 94 ${top + 0.8}`} fill="none" stroke={hi} strokeWidth="0.9" opacity="0.8" />}
    </>
  );
}

/** The turned bands every surface of the canister shares. */
function Turning({ f }) {
  return (
    <>
      <rect x="26" y="0" width="68" height="176" fill={f.base} />
      <rect x="26" y="0" width="7" height="176" fill={f.shade} opacity="0.55" />
      <rect x="35" y="0" width="13" height="176" fill={f.hi} />
      <rect x="39" y="0" width="3" height="176" fill={f.hot} />
      <rect x="78" y="0" width="16" height="176" fill={f.shade} />
      <rect x="90" y="0" width="2" height="176" fill={f.hi} opacity="0.5" />
      {f.brushed && BRUSH_LINES.map(y => (
        <path key={y} d={`M26 ${y}H94`} stroke={f.brushed} strokeWidth="0.6" opacity="0.55" />
      ))}
    </>
  );
}

function Lid({ f: base, clipId }) {
  // A finish may give the lid its own material (`lid`), and paint rings on
  // it (`lidRings`); without either the lid is turned from the body's stock.
  const f = base.lid ? { ...base, ...base.lid } : base;
  return (
    <>
      <clipPath id={clipId}><path d={LID} /></clipPath>
      <g clipPath={`url(#${clipId})`}>
        <Turning f={f} />
        {base.lidRings?.map(r => <Ring key={r.top} {...r} />)}
      </g>
      <path d="M29 25C40 21 80 21 91 25" fill="none" stroke={EDGE} strokeWidth="1" opacity="0.5" />
      <path d={SWOOSH} transform="translate(0 1.4)" fill="none" stroke={f.swooshHi} strokeWidth="4.2" strokeLinecap="round" />
      <path d={SWOOSH} fill="none" stroke={f.swoosh} strokeWidth="4.2" strokeLinecap="round" />
      <path d={LID} fill="none" stroke={EDGE} strokeWidth="2.2" strokeLinejoin="round" />
    </>
  );
}

/**
 * @param {'standard'|'premium'|'elite'} [tier]
 * @param {number|string} [height]  px (or any css length); width follows the 120:166 box
 * @param {boolean} [open]          lid lifted off, as on the spin screen
 * @param {boolean} [liftLid]       animate the lid coming up (open only)
 * @param {boolean} [lidFly]        the lid is blown off and lands on its rest (open only)
 * @param {string}  [seam]          colour leaking from the seam of a closed canister
 * @param {number}  [seamMs]        how long that leak takes to build
 * @param {string} [label]          exposes the drawing to screen readers
 */
export default function CapsuleCanister({
  tier = 'standard', height = 176, open = false, liftLid = false, lidFly = false,
  seam = null, seamMs = 2000, label, className = '', style,
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const f = CANISTER_FINISH[tier] ?? CANISTER_FINISH.standard;
  const bodyClip = `cnb${uid}`;
  const lidClip = `cnl${uid}`;
  const barsStart = 60 - (f.bars * 5 - 2) / 2;

  return (
    <svg
      viewBox="0 0 120 166"
      height={height}
      style={{ overflow: 'visible', display: 'block', aspectRatio: '120 / 166', ...style }}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      {/* The contact shadow, centred on the base so the canister stands on
          it. It sat 5 units below the base and the box ran 11 units past
          it, so on the shelf every canister floated over the plank. Soft on
          a light ground, solid on a dark one (see .canister-floor). */}
      <ellipse className="canister-floor" cx="60" cy="160" rx={open ? 42 : 39} ry="5" fill={FLOOR} />

      {/* Base */}
      <clipPath id={bodyClip}><path d={BODY} /></clipPath>
      <g clipPath={`url(#${bodyClip})`}>
        <Turning f={f} />
        {f.rings?.map(r => <Ring key={r.top} {...r} />)}
      </g>
      <path d="M26 74A34 7.5 0 0 0 94 74V86A34 7.5 0 0 1 26 86Z" fill={f.collar} />
      <path d="M26 75.5A34 7.5 0 0 0 94 75.5" fill="none" stroke={f.collarHi} strokeWidth="1.2" />
      {KNURL.map(([x, y, w]) => (
        <path key={x} d={`M${x} ${y}V${y + 6}`} stroke={f.groove} strokeWidth={w} strokeLinecap="round" />
      ))}
      <path d="M46 126.5H74" stroke={f.ink} strokeWidth="0.9" />
      {Array.from({ length: f.bars }, (_, i) => (
        <rect key={i} x={barsStart + i * 5} y="138" width="3" height="7" rx="0.6" fill={f.ink} />
      ))}
      <path d={BODY} fill="none" stroke={EDGE} strokeWidth="2.2" strokeLinejoin="round" />

      {open ? (
        <>
          {/* The mouth of the open base, then the lid lifted off to one side. */}
          <ellipse cx="60" cy="74" rx="34" ry="7.5" fill={f.collar} stroke={EDGE} strokeWidth="2.2" />
          <ellipse cx="60" cy="74.8" rx="29" ry="5.3" fill={FLOOR} />
          <path d="M32 72.5A28 4.5 0 0 1 88 72.5" fill="none" stroke={f.collarHi} strokeWidth="1" />
          <g className={lidFly ? 'canister-lid-fly' : liftLid ? 'canister-lid-lift' : undefined}>
            <g transform="translate(-6 -30) rotate(24 94 74)">
              <ellipse cx="60" cy="74" rx="34" ry="7.5" fill={EDGE} />
              <ellipse cx="60" cy="73.4" rx="29" ry="5.1" fill={f.shade} />
              <Lid f={f} clipId={lidClip} />
            </g>
          </g>
        </>
      ) : (
        <>
          <Lid f={f} clipId={lidClip} />
          <path d="M26 74A34 7.5 0 0 0 94 74" fill="none" stroke={EDGE} strokeWidth="2.6" />
          {/* Light from inside, through the seam: a line, not a glow. */}
          {seam && (
            <path
              className="canister-seam"
              d="M27 74.6A33 7 0 0 0 93 74.6"
              fill="none" stroke={seam} strokeWidth="2.4" strokeLinecap="round"
              style={{ animationDuration: `${seamMs}ms` }}
            />
          )}
          {/* The latch. */}
          <rect x="77.64" y="67.75" width="8.43" height="22" rx="2" fill={f.collar} stroke={EDGE} strokeWidth="1.4" />
          <rect x="79.24" y="70.25" width="5.23" height="6" rx="1" fill={f.gem ?? f.collarHi} />
          <circle cx="81.85" cy="84.75" r="1.6" fill={EDGE} />
        </>
      )}
    </svg>
  );
}
