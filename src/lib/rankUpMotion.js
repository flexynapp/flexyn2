// src/lib/rankUpMotion.js
//
// The rank up's motion, as keyframe lists for the Web Animations API.
//
// Why generated rather than a few CSS keyframes: the first two cuts strained
// the crest with a tremor that climbed to 17 cycles a second. At 60 frames a
// second that is three or four frames a cycle, so it sampled as jitter and
// read as the app stuttering (Kegan, 2026-10-01: "choppy or laggy"). Every
// motion here is slow enough to be drawn smoothly, and the build-up comes
// from rhythm instead: heartbeats that come faster and hit harder, the way a
// charge reads in a game.
//
// Each list is dense (one keyframe every few frames) and played with linear
// easing, so the browser only interpolates between points that are already
// on the curve. Only transform and opacity move, so it all runs on the
// compositor.
//
// Pure functions. No DOM.

const f = (n, d = 2) => Number(n.toFixed(d));

/** A heartbeat: a quick rise into `at`, a longer fall after it. */
function beat(p, at, width) {
  const w = p < at ? width * 0.45 : width;
  const z = (p - at) / w;
  return Math.exp(-z * z);
}

/** Where the beats land, as fractions of the charge. Closer together as it
 *  builds; a level step gets fewer. */
export function chargeBeats(kind) {
  return kind === 'tier'
    ? [0.28, 0.48, 0.63, 0.75, 0.84, 0.91]
    : [0.36, 0.62, 0.82];
}

function crestAt(p, kind) {
  const big = kind === 'tier';
  const beats = chargeBeats(kind);
  // It rises off its spot and swells as it fills.
  const lift = (big ? 12 : 6) * p * p * p;
  let scale = 1 + (big ? 0.06 : 0.03) * Math.pow(p, 1.5);
  beats.forEach((at, i) => {
    const gap = (beats[i + 1] ?? 1) - at;
    scale += (big ? 0.03 + 0.008 * i : 0.025) * beat(p, at, gap * 0.5);
  });
  // A breath in just before the break, so the release has something to
  // release. Level steps skip it: they have no break.
  if (big) {
    const s = Math.min(1, Math.max(0, (p - 0.94) / 0.06));
    scale -= 0.05 * s * s * (3 - 2 * s);
  }
  return { lift, scale };
}

/**
 * The charge: the crest rises, swells and throbs on every beat. It does not
 * rotate or sway. Round 3 swayed at up to three cycles a second and Kegan
 * still read it as jitter (2026-10-01), so any side to side motion is out;
 * the build comes from the beats, the heat and the crack alone.
 *
 * @returns {{ crest: Keyframe[], hot: Keyframe[], end: object, hotEnd: number }}
 *   `end` is the crest's pose on the last frame ({ x, y, rot, scale }), so
 *   whatever replaces it (the two halves of a break, the new crest of a
 *   level step) can start exactly where it stopped.
 */
export function chargeFrames({ kind }) {
  const big = kind === 'tier';
  const beats = chargeBeats(kind);
  const N = 120;
  const crest = [];
  const hot = [];
  let end = null;
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    const { lift, scale } = crestAt(p, kind);
    const rot = 0;
    crest.push({ transform: `translate(0px, ${f(-lift)}px) rotate(${f(rot)}deg) scale(${f(scale, 4)})` });
    if (i === N) end = { x: 0, y: f(-lift), rot: f(rot), scale: f(scale, 4) };
    // Heat climbs with the charge and flares on every beat.
    let o = (big ? 0.55 : 0.25) * Math.pow(p, 2.2);
    beats.forEach((at, j) => {
      const gap = (beats[j + 1] ?? 1) - at;
      o += (big ? 0.18 : 0.1) * beat(p, at, gap * 0.45);
    });
    hot.push({ opacity: f(Math.min(0.8, o), 3) });
  }
  return { crest, hot, end, hotEnd: hot[N].opacity };
}

/** A damped spring from `from` to `to`, sampled over `duration` ms. */
export function spring(from, to, { duration, bounce = 0.35, steps = 60 }) {
  // bounce 0 settles without crossing; 0.35 crosses once and comes back.
  const zeta = 1 - Math.min(0.9, Math.max(0, bounce));
  const omega = 2 * Math.PI * 1.6 / (duration / 1000);
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (duration / 1000);
    const decay = Math.exp(-zeta * omega * t);
    const wd = omega * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
    const x = i === steps ? 0 : decay * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
    out.push(to + (from - to) * x);
  }
  return out;
}

/**
 * The new crest arriving. A promotion drops it in from above the camera on a
 * spring that overshoots once; a level step pops it from where the charge
 * left it.
 *
 * @returns {{ frames: Keyframe[], impact: number }}  impact: ms at which it
 *   first reaches its resting size, for the burst and the haptic.
 */
export function landingFrames({ kind, duration, startScale = 1, startY = 0 }) {
  const steps = 60;
  const frames = [];
  let impact = duration * 0.4;
  if (kind === 'morph') {
    // The shape has already landed, in grey. The colour arrives over it on
    // a soft swell and settles, and the moment it is fully there is the hit.
    const s = spring(1.07, 1, { duration, bounce: 0.3, steps });
    const fade = 0.32;
    s.forEach((v, i) => {
      const u = Math.min(1, i / (steps * fade));
      frames.push({ transform: `translate(0px, 0px) scale(${f(v, 4)})`, opacity: f(u * u * (3 - 2 * u), 3) });
    });
    return { frames, impact: duration * fade };
  }
  if (kind === 'tier') {
    const s = spring(2.2, 1, { duration, bounce: 0.42, steps });
    const y = spring(-26, 0, { duration, bounce: 0.3, steps });
    let hit = false;
    s.forEach((v, i) => {
      if (!hit && v <= 1) { hit = true; impact = (i / steps) * duration; }
      const o = Math.min(1, i / (steps * 0.18));
      frames.push({ transform: `translateY(${f(y[i])}px) scale(${f(v, 4)})`, opacity: f(o, 3) });
    });
  } else {
    // Up to a peak, then the spring brings it home.
    const peak = 1.2;
    const rise = Math.round(steps * 0.22);
    for (let i = 0; i <= rise; i++) {
      const u = i / rise;
      const e = 1 - Math.pow(1 - u, 3);
      frames.push({ transform: `translate(0px, ${f(startY * (1 - e))}px) scale(${f(startScale + (peak - startScale) * e, 4)})`, opacity: 1 });
    }
    const rest = spring(peak, 1, { duration: duration * 0.78, bounce: 0.4, steps: steps - rise });
    rest.slice(1).forEach((v) => frames.push({ transform: `translate(0px, 0px) scale(${f(v, 4)})`, opacity: 1 }));
    impact = duration * 0.22;
  }
  return { frames, impact };
}

/** The whole screen taking the hit: a single smooth dip and recovery,
 *  instead of a rattle of offsets. `amp` in px. */
export function impactFrames(amp) {
  return spring(amp, 0, { duration: 560, bounce: 0.45, steps: 40 })
    .map((y, i) => ({ transform: `translateY(${f(i === 0 ? 0 : y)}px)` }));
}

/** One half of a broken crest leaving, from where the charge left it. */
export function flyFrames(dir, start = { x: 0, y: 0, rot: 0, scale: 1 }) {
  const N = 40;
  const out = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const e = 1 - Math.pow(1 - t, 2.4);
    // A short burst sideways, then gravity takes it.
    const x = start.x + dir * (190 * e);
    const y = start.y - 24 * Math.sin(Math.PI * Math.min(1, t * 1.6)) + 210 * t * t;
    const r = start.rot * (1 - e) + dir * 48 * e;
    const s = start.scale - 0.18 * t;
    out.push({
      transform: `translate(${f(x)}px, ${f(y)}px) rotate(${f(r)}deg) scale(${f(s, 3)})`,
      opacity: f(t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45, 3),
    });
  }
  return out;
}
