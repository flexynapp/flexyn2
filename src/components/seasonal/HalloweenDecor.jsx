// src/components/seasonal/HalloweenDecor.jsx
//
// The Halloween skin's ornaments: cobwebs hanging from the header's bottom
// corners, a spider bobbing on a thread, and a witch on a broomstick who
// crosses the top of the screen now and then with a few bats behind her.
//
// Rules this holds to, because it sits over every screen for a month:
//   • pointer-events none, always. It must never eat a tap.
//   • z-[35]: above page content, below the header (z-40), dialogs (z-50)
//     and toasts, so it never covers anything the user has to read to act.
//   • transform/opacity animation only (index.css, `hw-*` keyframes), so it
//     composites on the GPU and does not re-layout the page.
//   • prefers-reduced-motion keeps the webs and drops everything that moves.
//   • drawn from --foreground, so it reads bone on dark and ink on light.
//     No new hue.
//
// Mounted from App.jsx beside the prompt; renders nothing unless the skin
// is on and in season.

import { useTheme } from '@/lib/ThemeContext';

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

function Cobweb({ className }) {
  return (
    <svg viewBox={`0 0 ${WEB_SIZE} ${WEB_SIZE}`} width={WEB_SIZE} height={WEB_SIZE} className={className} aria-hidden="true">
      <path d={WEB_D} fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  );
}

function Spider() {
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

function Witch() {
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

function Bat({ className, style }) {
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

export default function HalloweenDecor() {
  const theme = useTheme();
  if (!theme?.halloween || !theme?.halloweenAvailable) return null;

  return (
    <div
      className="hw-decor fixed inset-x-0 top-[calc(56px+env(safe-area-inset-top))] lg:top-0 bottom-0 z-[35] pointer-events-none overflow-hidden text-foreground"
      aria-hidden="true"
      data-testid="halloween-decor"
    >
      <Cobweb className="absolute top-0 start-0 opacity-40 rtl:scale-x-[-1]" />
      <Cobweb className="absolute top-0 end-0 opacity-40 scale-x-[-1] rtl:scale-x-100" />

      {/* Spider on a thread from the right web. */}
      <div className="absolute top-0 end-9 flex flex-col items-center opacity-70 hw-dangle">
        <span className="block w-px h-14 bg-current opacity-60" />
        <Spider />
      </div>

      {/* The flyover. One timeline for the witch and her bats, so they
          cross together and the screen is quiet the rest of the cycle. */}
      <div className="hw-motion absolute inset-x-0 top-[14%] h-24">
        <div className="hw-fly absolute start-0 top-0">
          <div className="hw-bob opacity-80"><Witch /></div>
        </div>
        <Bat className="hw-fly hw-fly-b absolute start-0 top-10 opacity-70" />
        <Bat className="hw-fly hw-fly-c absolute start-0 top-1 opacity-60" />
        <Bat className="hw-fly hw-fly-d absolute start-0 top-16 opacity-60" />
      </div>
    </div>
  );
}
