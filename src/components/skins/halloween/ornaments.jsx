// src/components/skins/halloween/ornaments.jsx
//
// The Halloween skin's drawn figures: corner webs, a spider, the witch and
// her bats. They are pieces of the Backdrop, never an overlay: they live
// behind the page and show only through its gaps, so they can never cover
// content. Drawn in currentColor; the Backdrop sets the ink strength.

// A corner web: spokes fanning out of the corner, joined by sagging
// threads. Generated rather than hand-drawn so it stays symmetrical.
const WEB_SIZE = 76;
const SPOKES = [0, 18, 36, 54, 72, 90];
const RINGS = [14, 27, 41, 56, 72];

function webPath() {
  const pt = (r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  let d = '';
  for (const deg of SPOKES) {
    const [x, y] = pt(RINGS[RINGS.length - 1], deg);
    d += `M0 0L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  for (const r of RINGS) {
    for (let i = 0; i < SPOKES.length - 1; i += 1) {
      const [x1, y1] = pt(r, SPOKES[i]);
      const [x2, y2] = pt(r, SPOKES[i + 1]);
      // Pull the midpoint toward the corner so each thread sags.
      const [cx, cy] = pt(r * 0.8, (SPOKES[i] + SPOKES[i + 1]) / 2);
      d += `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    }
  }
  return d;
}
const WEB_D = webPath();

export function Cobweb({ className }) {
  return (
    <svg viewBox={`0 0 ${WEB_SIZE} ${WEB_SIZE}`} width={WEB_SIZE} height={WEB_SIZE} className={className} aria-hidden="true">
      <path d={WEB_D} fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  );
}

export function Spider() {
  return (
    <svg viewBox="0 0 20 16" width="20" height="16" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round">
        <path d="M7 7L2 4M7 8L1 8M7 9L2 12M8 10L4 15M13 7L18 4M13 8L19 8M13 9L18 12M12 10L16 15" />
      </g>
      <ellipse cx="10" cy="8.5" rx="3.6" ry="4" fill="currentColor" />
      <circle cx="10" cy="4.2" r="2.2" fill="currentColor" />
    </svg>
  );
}

export function Witch() {
  return (
    <svg viewBox="0 -8 80 56" width="96" height="67" aria-hidden="true">
      <g fill="currentColor">
        {/* bristles */}
        <path d="M18 33L2 26L5 32L0 36L5 38L2 43Z" />
        {/* cloak, flaring back in the wind */}
        <path d="M33 31L44 13L55 29L46 27Z" />
        <circle cx="46" cy="12" r="4.2" />
        {/* hat: brim plus a cone blown back */}
        <ellipse cx="46" cy="8.5" rx="8" ry="1.7" />
        <path d="M42 8.5L50 8.5L36 -6Z" />
      </g>
      <g stroke="currentColor" strokeLinecap="round" fill="none">
        <path d="M16 33L76 24" strokeWidth="2.4" />
        <path d="M48 18L62 25.5" strokeWidth="2" />
        <path d="M50 28Q56 33 61 30" strokeWidth="2" />
        <path d="M43 13Q37 16 31 13" strokeWidth="1.4" />
      </g>
    </svg>
  );
}

export function Bat({ className, style }) {
  return (
    <span className={className} style={style}>
      <svg viewBox="0 0 24 12" width="28" height="14" className="hw-flap" aria-hidden="true">
        <path
          d="M12 5C10 2 7 1 4 2C5 4 3 6 0 6C3 7 5 9 6 11C8 9 10 9 12 10C14 9 16 9 18 11C19 9 21 7 24 6C21 6 19 4 20 2C17 1 14 2 12 5Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

