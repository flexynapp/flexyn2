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

const SURFACE = `${START.join(' ')}${SEGMENTS
  .map((s) => `Q${s.ctrl.join(' ')} ${s.end.join(' ')}`)
  .join('')}`;

export const GROUND_PATH = `M0 160L${SURFACE}L400 160Z`;

// Everything above the ground. Jack o lanterns are clipped to it, so the part
// of a pumpkin buried in the hill is hidden rather than painted over the
// ground, and the two inks never stack.
export const SKY_PATH = `M0 0L${SURFACE}L400 0Z`;

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

function scarecrow(cx) {
  // Only the post touches the ground; the shirt, arms and hat hang off it.
  // Shoulders at 40 above the ground, hat top at 60.
  const b = plantedBase(cx - 1.5, cx + 1.5);
  const g = groundY(cx);
  const y = (above) => r1(g - above);
  return {
    kind: 'scarecrow', x0: cx - 1.5, x1: cx + 1.5, base: b,
    d: `M${cx - 1.5} ${b}V${y(47)}H${cx + 1.5}V${b}Z`,
    parts: [
      // Crossbar, a little crooked.
      `M${cx - 19} ${y(40)}L${cx + 19} ${y(41.5)}v2.5L${cx - 19} ${y(37.5)}Z`,
      // Shirt with ragged sleeves and hem.
      `M${cx - 17} ${y(41)}H${cx + 17}l1 5-2.5-1.5-1.5 3-2-2.5-2 1.5L${cx + 8} ${y(24)}l-2.5 2-2-3-2.5 2.5-2-2.5-2.5 2.5-2-3-2.5 2L${cx - 8} ${y(33)}l-2 -1.5-2 2.5-1.5-3-2.5 1.5Z`,
      // Straw poking out of each sleeve.
      `M${cx - 17} ${y(40.5)}L${cx - 23} ${y(43)}L${cx - 21.5} ${y(40)}L${cx - 24} ${y(38.5)}L${cx - 21} ${y(38)}L${cx - 22} ${y(35.5)}L${cx - 17} ${y(38)}Z`,
      `M${cx + 17} ${y(41.5)}L${cx + 22} ${y(44.5)}L${cx + 21} ${y(41.5)}L${cx + 24} ${y(40.5)}L${cx + 21} ${y(39.5)}L${cx + 22.5} ${y(37)}L${cx + 17} ${y(39)}Z`,
      // Sack head.
      `M${cx} ${y(56)}a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11Z`,
      // Hat: brim then a crumpled crown, tipped to one side.
      `M${cx - 10} ${y(54)}L${cx + 9} ${y(55.5)}v1.8L${cx - 10} ${y(55.8)}Z`,
      `M${cx - 5.5} ${y(55)}L${cx - 3} ${y(63)}L${cx + 3} ${y(64)}L${cx + 5} ${y(56)}Z`,
    ],
  };
}

function jackOLantern(x, w) {
  // A pumpkin sits on a flat patch in the middle of its belly, so that patch
  // is its footprint and the rest curves up and away from the ground.
  const h = r1(w * 1.05);
  const fx0 = r1(x + w * 0.25);
  const fx1 = r1(x + w * 0.75);
  const b = plantedBase(fx0, fx1);
  const cx = x + w / 2;
  const top = b - h;
  const Y = (t) => r1(b - h * t);
  const X = (t) => r1(x + w * t);
  const body = `M${fx0} ${b}C${x} ${b} ${x} ${r1(top + h * 0.12)} ${X(0.3)} ${r1(top + h * 0.06)}`
    + `Q${X(0.42)} ${top} ${r1(cx)} ${r1(top + h * 0.12)}Q${X(0.58)} ${top} ${X(0.7)} ${r1(top + h * 0.06)}`
    + `C${x + w} ${r1(top + h * 0.12)} ${x + w} ${b} ${fx1} ${b}Z`;
  // Carved face, cut out of the body with evenodd so it shows the page.
  const eye = (ex) => `M${r1(ex - w * 0.09)} ${Y(0.56)}H${r1(ex + w * 0.09)}L${r1(ex)} ${Y(0.72)}Z`;
  const face = eye(cx - w * 0.2) + eye(cx + w * 0.2)
    + `M${X(0.24)} ${Y(0.44)}L${X(0.34)} ${Y(0.38)}L${X(0.42)} ${Y(0.44)}L${X(0.5)} ${Y(0.38)}L${X(0.58)} ${Y(0.44)}L${X(0.66)} ${Y(0.38)}L${X(0.76)} ${Y(0.44)}`
    + `Q${r1(cx)} ${Y(0.14)} ${X(0.24)} ${Y(0.44)}Z`;
  return {
    kind: 'jack', lantern: true, x0: fx0, x1: fx1, base: b,
    d: body + face,
    stem: `M${r1(cx - 1)} ${r1(top + h * 0.14)}L${r1(cx - 0.6)} ${r1(top - h * 0.12)}L${r1(cx + 1.6)} ${r1(top - h * 0.2)}L${r1(cx + 1)} ${r1(top + h * 0.14)}Z`,
  };
}

const { pickets, rails } = fence(206, 10, 7);

/**
 * Everything that stands on the ground. Tests read this list. Jack o
 * lanterns are in it too (`lantern: true`) so they are checked like the
 * rest, but the backdrop draws them in the moon's orange, not the ground's ink.
 */
export const PLANTED = [
  headstone(40, 20, 32),
  jackOLantern(64, 17),
  cross(96, 40),
  scarecrow(132),
  jackOLantern(139, 15),
  headstone(160, 26, 30, -6),
  headstone(300, 18, 25),
  ...pickets,
  tree(352),
];

export const RAILS = rails;
