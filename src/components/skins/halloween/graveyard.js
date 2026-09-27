// src/components/skins/halloween/graveyard.js
//
// The graveyard's ground and everything planted in it, as DATA, so the
// shapes are derived from the ground instead of hand-placed beside it.
//
// It used to be hand-placed: each headstone, the cross, the fence and the
// tree carried a literal bottom y, and the ground was a separate curve. The
// curve rises and falls, the literals did not, so the tilted headstone
// floated above the hill, the fence posts stood on air at one end, and the
// cross hovered. Nothing looked broken in the code; it only looked wrong.
//
// Now every figure names its footprint on the x axis and is sunk SINK units
// below the LOWEST ground point under that footprint, so its base is buried
// at every point it spans. The fence goes further: each post finds its own
// ground, so the fence follows the hill the way a real one does. The buried
// part is invisible because figures and ground are one fill in one group.
//
// skinGrounding.test.js samples the ground under every figure and fails if
// any base sits above it anywhere. All units are the 400x160 viewBox.

// Ground: one quadratic segment then two smooth continuations (SVG Q then
// T, T). Stored as explicit segments so both the path and groundY() come
// from the same numbers.
const START = [0, 128];
const SEGMENTS = [
  { ctrl: [60, 110], end: [130, 122] },
  { ctrl: [200, 134], end: [260, 118] }, // reflection of the previous ctrl
  { ctrl: [320, 102], end: [400, 124] }, // reflection of the previous ctrl
];

export const SINK = 3;

export const GROUND_PATH = `M0 160L${START.join(' ')}${SEGMENTS
  .map((s) => `Q${s.ctrl.join(' ')} ${s.end.join(' ')}`)
  .join('')}L400 160Z`;

const quad = (a, b, c, t) => (1 - t) ** 2 * a + 2 * (1 - t) * t * b + t ** 2 * c;

/** Height of the ground surface at x (smaller y = higher, as in SVG). */
export function groundY(x) {
  let from = START;
  for (const { ctrl, end } of SEGMENTS) {
    if (x <= end[0]) {
      // x(t) is monotonic on every segment here, so bisect for t.
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 40; i += 1) {
        const mid = (lo + hi) / 2;
        if (quad(from[0], ctrl[0], end[0], mid) < x) lo = mid; else hi = mid;
      }
      return quad(from[1], ctrl[1], end[1], (lo + hi) / 2);
    }
    from = end;
  }
  return from[1];
}

/** The base that buries a footprint [x0, x1] at every point: its lowest ground plus SINK. */
export function plantedBase(x0, x1) {
  let low = -Infinity;
  for (let x = x0; x <= x1; x += 0.5) low = Math.max(low, groundY(x));
  return Math.round((Math.max(low, groundY(x1)) + SINK) * 10) / 10;
}

const r1 = (n) => Math.round(n * 10) / 10;

function headstone(x, w, h, tilt = 0) {
  // A tilt swings the base corners up and down by half the width times
  // sin(tilt); sink by that much more so the raised corner stays buried.
  const lift = (w / 2) * Math.abs(Math.sin((tilt * Math.PI) / 180));
  const b = r1(plantedBase(x, x + w) + lift);
  const r = w / 2;
  return {
    kind: 'headstone', x0: x, x1: x + w, base: b, tilt,
    d: `M${x} ${b}v${-(h - r)}a${r} ${r} 0 0 1 ${w} 0v${h - r}Z`,
    transform: tilt ? `rotate(${tilt} ${x + r} ${b})` : undefined,
  };
}

function cross(x, h) {
  // 6 wide upright, 22 wide arm at a third of the way down.
  const b = plantedBase(x, x + 6);
  const top = b - h;
  const arm = top + 8;
  return {
    kind: 'cross', x0: x, x1: x + 6, base: b,
    d: `M${x} ${b}V${arm + 6}H${x - 8}V${arm}H${x}V${top}H${x + 6}V${arm}H${x + 14}V${arm + 6}H${x + 6}V${b}Z`,
  };
}

function fence(x0, count, gap) {
  // Each post finds its own ground and stands the same height above it, and
  // the rails run straight from the first post to the last at a fixed
  // height above each end, so the fence follows the hill the way a real
  // one does. The test checks the rails clear the ground everywhere between.
  const posts = Array.from({ length: count }, (_, i) => x0 + i * gap);
  const x1 = posts[posts.length - 1] + 5;
  const pickets = posts.map((x) => {
    const b = plantedBase(x, x + 5);
    const top = r1(groundY(x + 2.5) - 18);
    return { kind: 'picket', x0: x, x1: x + 5, base: b, d: `M${x} ${b}V${top}l2.5-4 2.5 4V${b}Z` };
  });
  const ya = groundY(x0);
  const yb = groundY(x1);
  const rails = [14, 7].map((above) => {
    const a = r1(ya - above);
    const z = r1(yb - above);
    return {
      kind: 'rail', x0: x0 - 2, x1: x1 + 2, thickness: 2.5,
      // Top edge height at any x along the rail.
      topAt: (x) => a + ((z - a) * (x - (x0 - 2))) / (x1 - x0 + 4),
      d: `M${x0 - 2} ${a}L${x1 + 2} ${z}v2.5L${x0 - 2} ${a + 2.5}Z`,
    };
  });
  return { pickets, rails };
}

function tree(x) {
  const b = plantedBase(x, x + 11);
  return {
    kind: 'trunk', x0: x, x1: x + 11, base: b,
    d: `M${x} ${b}C${x + 2} ${b - 24} ${x - 2} ${b - 44} ${x + 4} ${b - 64}L${x + 8} ${b - 64}C${x + 6} ${b - 42} ${x + 10} ${b - 24} ${x + 11} ${b}Z`,
    branches: `M${x + 5} ${b - 54}Q${x - 12} ${b - 69} ${x - 26} ${b - 72}L${x - 34} ${b - 80}M${x + 6} ${b - 60}Q${x + 20} ${b - 76} ${x + 36} ${b - 80}L${x + 42} ${b - 88}M${x + 4} ${b - 40}Q${x - 8} ${b - 48} ${x - 18} ${b - 46}M${x + 9} ${b - 46}Q${x + 22} ${b - 52} ${x + 32} ${b - 50}`,
  };
}

const { pickets, rails } = fence(206, 10, 7);

/** Everything that stands on the ground. Tests read this list. */
export const PLANTED = [
  headstone(40, 20, 32),
  cross(96, 40),
  headstone(150, 26, 30, -6),
  headstone(300, 18, 25),
  ...pickets,
  tree(352),
];

export const RAILS = rails;
