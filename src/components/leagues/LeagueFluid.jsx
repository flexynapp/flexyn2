// src/components/leagues/LeagueFluid.jsx
//
// The rank up's backdrop: the league's own colours poured on the floor
// (Kegan, 2026-10-02: "random bits of dark and light gold mixing together
// organically", then "the colour palette of the rank up league, more
// vibrant, flowing in and out of frame like someone dropped paint on the
// floor"). Four flat layers of paint, the crest's own four colours, fold
// through each other, spread out from behind the crest and drift off the
// edges of the screen. Each landing splashes it outward. A first placement
// opens in grey and the league's paint pours in when its colour lands.
//
// One full-screen WebGL fragment shader: domain-warped noise (noise fed its
// own output twice), which is what gives the folds rather than blobs. It
// draws at half the CSS resolution and lets the browser scale it up, which
// keeps the fill rate low enough for an iPhone SE at 60 frames a second.
//
// Time comes from requestAnimationFrame's timestamp, never from a timer, and
// the shader's clock advances by speed times the real frame interval, so a
// change of speed never jumps the picture.
//
// No WebGL: renders nothing and the stage keeps its plain background.
// Reduced motion: one still frame of the final colours.

import { useEffect, useRef } from 'react';

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uT;
uniform float uEnergy;
uniform float uMix;
uniform float uSpread;
uniform vec2 uCentre;
uniform vec3 uA0, uA1, uA2, uA3;
uniform vec3 uB0, uB1, uB2, uB3;
uniform vec3 uBg;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  float s = min(uRes.x, uRes.y);
  vec2 uv = (gl_FragCoord.xy - uCentre * uRes) / s;
  float d = length(uv);
  float t = uT;
  // Paint spreading across a floor from where it was dropped: the field is
  // read from closer to the crest the further it has spread, so every shape
  // is carried outward and off the edge of the screen. It drifts sideways
  // too, so shapes also slide in from one side and out of the other.
  // The pull toward the crest never crosses it (the radius it reads from
  // only shrinks, and shrinks less further out), so nothing folds back on
  // itself however far the paint has spread.
  vec2 p = uv * exp(-uSpread / (d + 0.5)) * 1.25 + vec2(0.16, -0.06) * t;
  // Two rounds of warping: q bends space, r bends it again through q.
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.09)), fbm(p + vec2(5.2, 1.3) - t * 0.07));
  vec2 r = vec2(fbm(p + 3.4 * q + vec2(1.7, 9.2) + t * 0.12),
                fbm(p + 3.4 * q + vec2(8.3, 2.8) - t * 0.1));
  float n = fbm(p + 3.8 * r);
  // Stretch the noise so all four paints get their share of the floor.
  float v = clamp((n - 0.5) * 2.7 + 0.5, 0.0, 1.0);

  // The league's colour pours out from the crest along the folds.
  float pour = clamp(uMix * 2.4 - d * 0.9 + (n - 0.5) * 0.9, 0.0, 1.0);
  pour = pour * pour * (3.0 - 2.0 * pour);
  vec3 c0 = mix(uA0, uB0, pour);
  vec3 c1 = mix(uA1, uB1, pour);
  vec3 c2 = mix(uA2, uB2, pour);
  vec3 c3 = mix(uA3, uB3, pour);

  // Poured paint: flat layers of the league's four colours with thin soft
  // edges between them, the way acrylic lies when it is poured, instead of a
  // haze of one colour.
  float e = 0.03;
  vec3 col = c0;
  col = mix(col, c1, smoothstep(0.3 - e, 0.3 + e, v));
  col = mix(col, c2, smoothstep(0.5 - e, 0.5 + e, v));
  col = mix(col, c3, smoothstep(0.73 - e, 0.73 + e, v));
  // A bright lip along the edge of the lightest paint, where it catches light.
  col += (c3 - col) * 0.5 * smoothstep(0.05, 0.0, abs(v - 0.73));

  // Full colour across the screen, a little calmer under the words and the
  // ladder at the bottom, and a darker pool right behind the crest so a gold
  // crest does not sit on gold paint.
  float pool = 1.0 - 0.5 * (1.0 - smoothstep(0.14, 0.46, d));
  // The words, the ladder and the button sit in a column under the crest:
  // the paint is held back there so they stay readable, and stays at full
  // strength above the crest and out at the sides.
  // Its edges are very soft, so it reads as the paint thinning out rather
  // than as a panel behind the text.
  float column = (1.0 - smoothstep(0.1, 0.95, abs(uv.x))) * (1.0 - smoothstep(-0.5, 0.05, uv.y));
  // The same, lighter, for the header row at the very top.
  float header = 0.7 * smoothstep(0.8, 0.98, gl_FragCoord.y / uRes.y);
  float a = uEnergy * pool * (1.0 - 0.55 * max(column, header));
  gl_FragColor = vec4(mix(uBg, col, clamp(a, 0.0, 1.0)), 1.0);
}
`;

function hexRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

/**
 * The four paints, deepest to lightest, as the shader takes them. Pass the
 * league's own palette as four hexes (deep, dark, mid, light), which is what
 * the rank up does so the floor is painted in exactly the crest's colours;
 * a single hex gets four shades derived from it.
 */
export function fluidPalette(colour) {
  if (Array.isArray(colour)) return colour.slice(0, 4).map(hexRgb);
  const c = hexRgb(colour);
  return [
    c.map((v) => v * 0.35),
    c.map((v) => v * 0.7),
    c,
    c.map((v) => v + (1 - v) * 0.5),
  ];
}

// The stage's ground: the dark theme's --background.
const BG = hexRgb('#13171B');

// Where the energy, speed and colour sit in each phase. `ramp` is how far
// through the phase (0 to 1) the value is reached.
const TARGETS = {
  enter:  { energy: 0.45, speed: 0.4, mix: 0 },
  charge: { energy: 0.85, speed: 1.4, mix: 0.32 },
  break:  { energy: 1, speed: 2.6, mix: 1 },
  // A first placement changes shape instead of breaking: the swirl keeps
  // churning in grey while the shape moves, and pours the colour on landing.
  morph:  { energy: 0.85, speed: 1.1, mix: 0.4 },
  landed: { energy: 0.88, speed: 0.5, mix: 1 },
};
const DOWN = {
  enter:  { energy: 0.4, speed: 0.3, mix: 0 },
  charge: { energy: 0.32, speed: 0.2, mix: 1 },
  morph:  { energy: 0.3, speed: 0.16, mix: 1 },
  landed: { energy: 0.42, speed: 0.18, mix: 1 },
};
// How fast the paint spreads out from the crest: a steady creep, and a
// splash when something lands (the break, and the new crest arriving).
const SPREAD_RATE = 0.05;
const SPLASH = { break: 0.7, landed: 0.5 };
const SPLASH_TAU = 0.45;

/**
 * @param {object} props
 * @param {string|string[]} props.from  paint the stage opens in: a hex, or
 *   four hexes deepest to lightest
 * @param {string|string[]} props.to    paint it ends in
 * @param {string} props.phase   enter | charge | break | morph | landed
 * @param {number} props.chargeMs  how long the charge runs, so it builds over it
 * @param {boolean} [props.down] a demotion: slow, draining, no churn
 * @param {boolean} [props.still] reduced motion: one frame, final colours
 * @param {object} [props.anchorRef] the crest's box; the swirl centres on it
 * @param {number} [props.pulse] a counter; each change stirs the paint once,
 *   so a tap can churn it (the capsule open stirs it on every crack)
 * @param {number} [props.pulseSize] how hard the next stir is, 0 to 1
 * @param {number} [props.strength] how loud the paint runs, 0 to 1 (1 is
 *   the rank up's own level; the capsule open runs a Common quieter)
 *
 * `to` may change while it runs: the colour on screen becomes the new
 * starting colour and the new one pours in from the anchor, so a stage can
 * walk through several colours without a cut.
 */
export default function LeagueFluid({ from, to, phase, chargeMs, down = false, still = false, anchorRef, pulse = 0, pulseSize = 0.5, strength = 1 }) {
  const canvasRef = useRef(null);
  const live = useRef({ phase, chargeMs, down, phaseAt: null });
  live.current.phase = phase;
  live.current.chargeMs = chargeMs;
  live.current.down = down;
  live.current.to = to;
  live.current.pulse = pulse;
  live.current.pulseSize = pulseSize;
  live.current.strength = strength;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let gl = null;
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    } catch { gl = null; }
    if (!gl) { canvas.style.display = 'none'; return undefined; }

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (vs && fs) { gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); }
    if (!vs || !fs || !gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.style.display = 'none'; return undefined; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (name) => gl.getUniformLocation(prog, name);
    const U = {
      res: u('uRes'), t: u('uT'), energy: u('uEnergy'), mix: u('uMix'), spread: u('uSpread'), centre: u('uCentre'), bg: u('uBg'),
      a: [u('uA0'), u('uA1'), u('uA2'), u('uA3')], b: [u('uB0'), u('uB1'), u('uB2'), u('uB3')],
    };
    let palA = fluidPalette(from);
    let palB = fluidPalette(to);
    palA.forEach((c, i) => gl.uniform3fv(U.a[i], c));
    palB.forEach((c, i) => gl.uniform3fv(U.b[i], c));
    gl.uniform3fv(U.bg, BG);

    const size = () => {
      // Half the CSS size: the field is soft everywhere, so the upscale is
      // invisible and the fill rate a quarter of a full-resolution draw.
      const w = Math.max(1, Math.round(canvas.clientWidth * 0.5));
      const h = Math.max(1, Math.round(canvas.clientHeight * 0.5));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(U.res, w, h);
      // Centre on the crest. GL counts y from the bottom.
      const r = anchorRef?.current?.getBoundingClientRect?.();
      const box = canvas.getBoundingClientRect();
      const cx = r && box.width ? (r.left + r.width / 2 - box.left) / box.width : 0.5;
      const cy = r && box.height ? 1 - (r.top + r.height / 2 - box.top) / box.height : 0.62;
      gl.uniform2f(U.centre, cx, cy);
    };

    const cur = { energy: 0, speed: TARGETS.enter.speed, mix: 0, t: 7.3, spread: 0, splash: 0 };
    const draw = () => {
      gl.uniform1f(U.t, cur.t);
      gl.uniform1f(U.spread, cur.spread);
      gl.uniform1f(U.energy, cur.energy);
      gl.uniform1f(U.mix, cur.mix);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    size();
    if (still) {
      Object.assign(cur, (down ? DOWN : TARGETS).landed);
      cur.energy *= strength;
      draw();
      return () => gl.getExtension('WEBGL_lose_context')?.loseContext();
    }

    let raf = 0;
    let last = null;
    let seenPhase = null;
    // A colour is compared by its hexes, so an array prop rebuilt on every
    // render is not mistaken for a new colour.
    const key = (c) => (Array.isArray(c) ? c.join() : String(c));
    let seenTo = key(to);
    let seenPulse = live.current.pulse;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = last == null ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      const L = live.current;
      if (L.phase !== seenPhase) {
        seenPhase = L.phase;
        L.phaseAt = now;
        if (!L.down) cur.splash += SPLASH[L.phase] ?? 0;
      }
      // A new colour: what is on screen now becomes the start, and the new
      // colour pours in over it.
      if (key(L.to) !== seenTo) {
        seenTo = key(L.to);
        palA = palA.map((c, i) => c.map((v, j) => v + (palB[i][j] - v) * cur.mix));
        palB = fluidPalette(L.to);
        palA.forEach((c, i) => gl.uniform3fv(U.a[i], c));
        palB.forEach((c, i) => gl.uniform3fv(U.b[i], c));
        cur.mix = 0;
      }
      // A stir: a kick of energy, speed and spread that eases back on its own.
      if (L.pulse !== seenPulse) {
        seenPulse = L.pulse;
        const k = Math.max(0, Math.min(1, L.pulseSize));
        cur.energy = Math.min(1, cur.energy + 0.35 * k);
        cur.speed += 4 * k;
        cur.splash += 0.4 * k;
      }
      const table = L.down ? DOWN : TARGETS;
      const goal = table[L.phase] ?? table.landed;
      const S = Math.max(0, Math.min(1, L.strength ?? 1));
      // The charge builds across its whole length; every other phase eases
      // toward its target.
      if (L.phase === 'charge' && !L.down) {
        const k = Math.min(1, (now - L.phaseAt) / Math.max(1, L.chargeMs));
        const e = k * k;
        const base = TARGETS.enter;
        cur.energy = (base.energy + (goal.energy - base.energy) * e) * S;
        cur.speed = base.speed + (goal.speed - base.speed) * e;
        cur.mix = goal.mix * Math.pow(k, 2.5);
      } else {
        const tau = L.phase === 'break' ? 0.08 : L.phase === 'landed' ? 0.9 : 0.4;
        const a = 1 - Math.exp(-dt / tau);
        cur.energy += (goal.energy * S - cur.energy) * a;
        cur.speed += (goal.speed - cur.speed) * a;
        // The colour pours fast on the break and never pours back.
        const mixTau = L.phase === 'break' || L.phase === 'landed' ? 0.35 : tau;
        cur.mix += (goal.mix - cur.mix) * (1 - Math.exp(-dt / mixTau));
      }
      cur.t += dt * cur.speed;
      // The spread only ever grows, so paint never pulls back toward the
      // crest; a splash is a burst of speed that dies away.
      cur.spread += dt * ((L.down ? 0.4 : 1) * SPREAD_RATE + cur.splash);
      cur.splash *= Math.exp(-dt / SPLASH_TAU);
      draw();
    };
    raf = requestAnimationFrame(tick);
    const onResize = () => size();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // Colours and mode are fixed for one sequence; phase is read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ imageRendering: 'auto' }}
      aria-hidden="true"
    />
  );
}
