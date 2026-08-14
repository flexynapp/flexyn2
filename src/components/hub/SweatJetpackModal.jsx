// src/components/hub/SweatJetpackModal.jsx
//
// "Sweat Jetpack" easter-egg — Jetpack-Joyride-flavor side-scroller
// where a sweating, FARTING fat dude in a RED shirt propels himself
// through scrolling biomes by ripping farts. Hold to thrust, release
// to fall.
//
// V3 changes:
// - Red shirt (was blue)
// - Proper running animation: BOTH arms visible swinging opposite,
//   legs drawn as connected thigh+shin+foot units so they no longer
//   visually clip mid-step.
// - 4 obstacle TYPES with different palettes:
//   floating_bar / floor_block / ceiling_block / moving_bar
//   No more ceiling/floor cheese — there's stuff up there now.
// - Coin arcs are placed in the SAFE half opposite the obstacle
//   so they never spawn inside something you'd crash into.
// - Smooth cross-fade between biomes (last 80m of each fades into
//   the next) instead of an abrupt snap.
// - Better city: varied building widths + heights + roof styles
//   (flat / antenna / pointed). Windows are deterministic so they
//   don't shimmer-jitter as they scroll.
// - Background elements (buildings, trees, cactuses) draw fully
//   off-screen instead of getting culled mid-render — no more
//   "tree disappears as soon as it touches the edge."

import { useEffect, useRef, useState } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

const W = 640;
const H = 360;
const PIXEL = 2;

const FLOOR_Y   = H - 30;
const CEILING_Y = 20;
const DUDE_W    = PIXEL * 14;
const DUDE_H    = PIXEL * 18;
const DUDE_X    = 80;

const px = (n) => Math.floor(n / PIXEL) * PIXEL;
function lerp(a, b, t) { return a + (b - a) * t; }
function blendRGB(c1, c2, t) {
  return `rgb(${Math.round(lerp(c1[0], c2[0], t))}, ${Math.round(lerp(c1[1], c2[1], t))}, ${Math.round(lerp(c1[2], c2[2], t))})`;
}

const SKY_PHASES = [
  [[ 80,  40,  80], [255, 160, 110]], // dawn
  [[ 90, 170, 240], [200, 230, 255]], // day
  [[200,  80,  60], [ 70,  40,  90]], // dusk
  [[ 10,  10,  35], [ 30,  30,  60]], // night
];

function skyColor(progress, isTop) {
  const phaseFloat = progress * SKY_PHASES.length;
  const idx = Math.floor(phaseFloat) % SKY_PHASES.length;
  const t = phaseFloat - Math.floor(phaseFloat);
  const cur = SKY_PHASES[idx][isTop ? 0 : 1];
  const nxt = SKY_PHASES[(idx + 1) % SKY_PHASES.length][isTop ? 0 : 1];
  return blendRGB(cur, nxt, t);
}

// Biome index + crossfade alpha. Last 80m of each 600m phase cross-fades
// into the next phase so the swap is smooth, not a snap.
function biomeForDistance(distance) {
  const cycle = 600;
  const inPhase = distance % cycle;
  const idx = Math.floor(distance / cycle) % 3;
  const fadeStart = cycle - 80;
  if (inPhase < fadeStart) return { cur: idx, next: idx, t: 0 };
  const t = (inPhase - fadeStart) / 80;
  return { cur: idx, next: (idx + 1) % 3, t };
}
const BIOMES = ['city', 'desert', 'plains'];

// Obstacle palettes — multiple colors so the level isn't a uniform grey.
const OBSTACLE_PALETTES = [
  { base: '#a44030', hl: '#cc6448', sh: '#5a200a' }, // brick red
  { base: '#3a3a4a', hl: '#5a5a72', sh: '#1a1a24' }, // concrete
  { base: '#3a6890', hl: '#5a8db0', sh: '#1a3a55' }, // steel blue
  { base: '#aa8a20', hl: '#d0b04a', sh: '#665010' }, // industrial yellow
  { base: '#2a5a3a', hl: '#4a8a5a', sh: '#0a2a1a' }, // mossy green
];

function makeFarts() { return Array.from({ length: 36 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, r: PIXEL })); }
function makeDroplets() { return Array.from({ length: 16 }, () => ({ x: 0, y: 0, vy: 0, life: 0 })); }
function makeStars() {
  // Deterministic star field
  const arr = [];
  for (let i = 0; i < 40; i += 1) arr.push({ x: (i * 73 + 11) % W, y: (i * 41 + 7) % (H - 80), tw: (i * 17) % 60 });
  return arr;
}

// Deterministic "city plan" — an infinite skyline. Each call with the
// same building index returns the same building. Built lazily via a
// seeded hash so the city never re-randomizes between frames.
function cityBuildingAt(idx) {
  // Pseudo-random but deterministic.
  const seed = (idx * 2654435761) >>> 0;
  const w = 30 + ((seed >> 0) % 5) * 8;          // 30, 38, 46, 54, 62
  const h = 60 + ((seed >> 8) % 7) * 22;         // up to ~190 tall
  const roof = (seed >> 16) % 4;                 // 0=flat 1=antenna 2=pointed 3=stepped
  // Lit-window mask: per-building 16-bit mask, used together with
  // window position for stable lighting.
  const lit = (seed >> 4) >>> 0;
  return { w, h, roof, lit };
}

export default function SweatJetpackModal({ onClose, userId }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock();
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const storageKey  = `flexyn.sweatJetpackHighScore.${userId || 'anon'}`;
  const coinsKey    = `flexyn.sweatJetpackBestCoins.${userId || 'anon'}`;
  const [highScore, setHighScore] = useState(() => { try { return Number(localStorage.getItem(storageKey)) || 0; } catch { return 0; } });
  const [bestCoins, setBestCoins] = useState(() => { try { return Number(localStorage.getItem(coinsKey)) || 0; } catch { return 0; } });
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [distance, setDistance] = useState(0);
  const [coinCount, setCoinCount] = useState(0);

  const thrusting = useRef(false);
  const lastTouchRef = useRef(0);

  const state = useRef({
    y: H / 2,
    vy: 0,
    gravity:     0.40,
    thrustForce: -0.55,
    maxVy:       9,
    speed:       2.4,
    obstacles:   [],
    coins:       [],
    farts:       makeFarts(),
    droplets:    makeDroplets(),
    stars:       makeStars(),
    nextFart:    0,
    nextDrop:    0,
    frame:       0,
    score:       0,
    coinsCollected: 0,
    runFrame:    0,
    cycleProgress: 0,
    obstacleIdx: 0, // count so we can vary types
    bgScrollFar: 0,
    bgScrollMid: 0,
  });

  const resetGame = () => {
    state.current = {
      y: H / 2, vy: 0, gravity: 0.40, thrustForce: -0.55, maxVy: 9, speed: 2.4,
      obstacles: [], coins: [], farts: makeFarts(), droplets: makeDroplets(),
      stars: makeStars(), nextFart: 0, nextDrop: 0, frame: 0, score: 0,
      coinsCollected: 0, runFrame: 0, cycleProgress: Math.random(),
      obstacleIdx: 0, bgScrollFar: 0, bgScrollMid: 0,
    };
    thrusting.current = false;
    setDistance(0); setCoinCount(0); setGameOver(false);
  };

  const startThrust = (e) => {
    if (e) e.preventDefault();
    if (!gameStarted) { setGameStarted(true); thrusting.current = true; return; }
    if (gameOver)    { resetGame(); return; }
    thrusting.current = true;
  };
  const stopThrust = (e) => { if (e) e.preventDefault(); thrusting.current = false; };
  const handleTouchStart = (e) => { lastTouchRef.current = Date.now(); startThrust(e); };
  const handleTouchEnd   = (e) => { lastTouchRef.current = Date.now(); stopThrust(e); };
  const handleMouseDown  = (e) => { if (Date.now() - lastTouchRef.current < 600) return; startThrust(e); };
  const handleMouseUp    = (e) => { if (Date.now() - lastTouchRef.current < 600) return; stopThrust(e); };

  useEffect(() => {
    const down = (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); startThrust(); } };
    const up   = (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); stopThrust(); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStarted, gameOver]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    let rafId;

    // ── Obstacle spawn with paired coin arc placement.
    // Pairs each obstacle with a coin arc in the OPPOSITE safe half so
    // coins never spawn inside something you'd crash into.
    const spawnNext = () => {
      const s = state.current;
      const palette = OBSTACLE_PALETTES[(s.obstacleIdx * 7) % OBSTACLE_PALETTES.length];
      // Pick a type — bias variety, but ensure floating bars stay common.
      const typeRoll = s.obstacleIdx % 7;
      let obs;
      let coinBand; // y range we'll spawn the coin arc in
      const spawnX = W + 30;
      if (typeRoll === 0 || typeRoll === 4) {
        // floating_bar
        const barW = 60 + Math.floor(Math.random() * 80);
        const barH = 20 + Math.floor(Math.random() * 14);
        const bandY = 70 + Math.random() * (H - 200);
        obs = { type: 'floating_bar', x: spawnX, y: bandY, w: barW, h: barH, palette };
        // Coins go in the larger gap (over OR under the bar)
        const upperGap = bandY - CEILING_Y;
        const lowerGap = (FLOOR_Y - 30) - (bandY + barH);
        coinBand = upperGap > lowerGap
          ? { yMin: CEILING_Y + 10,        yMax: bandY - 18 }
          : { yMin: bandY + barH + 10,     yMax: FLOOR_Y - 40 };
      } else if (typeRoll === 1) {
        // floor_block — sticks up from the floor
        const barW = 50 + Math.floor(Math.random() * 60);
        const barH = 35 + Math.floor(Math.random() * 30);
        obs = { type: 'floor_block', x: spawnX, y: FLOOR_Y - barH, w: barW, h: barH, palette };
        coinBand = { yMin: CEILING_Y + 20, yMax: FLOOR_Y - barH - 40 };
      } else if (typeRoll === 2) {
        // ceiling_block — hangs from the ceiling
        const barW = 50 + Math.floor(Math.random() * 60);
        const barH = 35 + Math.floor(Math.random() * 30);
        obs = { type: 'ceiling_block', x: spawnX, y: CEILING_Y, w: barW, h: barH, palette };
        coinBand = { yMin: CEILING_Y + barH + 40, yMax: FLOOR_Y - 40 };
      } else if (typeRoll === 3) {
        // moving_bar — floats and ping-pongs vertically
        const barW = 60 + Math.floor(Math.random() * 60);
        const barH = 18 + Math.floor(Math.random() * 12);
        const yMin = 60 + Math.random() * 100;
        const yMax = yMin + 80 + Math.random() * 80;
        obs = {
          type: 'moving_bar', x: spawnX, y: yMin, w: barW, h: barH,
          yMin, yMax, vy: 0.8 + Math.random() * 0.8,
          palette: OBSTACLE_PALETTES[3], // industrial yellow — moving = danger
        };
        // Coins in the safer half
        coinBand = yMin > H / 2
          ? { yMin: CEILING_Y + 20, yMax: yMin - 20 }
          : { yMin: yMax + 20,      yMax: FLOOR_Y - 40 };
      } else {
        // pair of floor + ceiling (Scylla & Charybdis)
        const barW = 50 + Math.floor(Math.random() * 40);
        const floorH = 30 + Math.floor(Math.random() * 25);
        const ceilH  = 30 + Math.floor(Math.random() * 25);
        obs = {
          type: 'pair', x: spawnX, w: barW, floorH, ceilH,
          palette,
        };
        coinBand = { yMin: CEILING_Y + ceilH + 15, yMax: FLOOR_Y - floorH - 30 };
      }
      s.obstacles.push(obs);
      // Place a coin arc in the safe band
      const safeMid = (coinBand.yMin + coinBand.yMax) / 2;
      const safeRange = Math.max(20, coinBand.yMax - coinBand.yMin);
      const arcAmp = Math.min(safeRange / 3, 40);
      for (let i = 0; i < 5; i += 1) {
        const cx = spawnX + 130 + i * 26;
        const cy = safeMid - Math.sin((i / 4) * Math.PI) * arcAmp;
        s.coins.push({ x: cx, y: cy, r: 7, taken: false });
      }
      s.obstacleIdx += 1;
    };

    const renderLoop = () => {
      const s = state.current;
      s.frame += 1;

      // ── PHYSICS ────────────────────────────────────────────────
      if (gameStarted && !gameOver) {
        if (thrusting.current) s.vy += s.thrustForce;
        else                   s.vy += s.gravity;
        if (s.vy >  s.maxVy) s.vy =  s.maxVy;
        if (s.vy < -s.maxVy) s.vy = -s.maxVy;
        s.y += s.vy;

        // Clamp at ceiling and floor (still safe to skid on)
        if (s.y < CEILING_Y)              { s.y = CEILING_Y;              if (s.vy < 0) s.vy = 0; }
        if (s.y > FLOOR_Y - DUDE_H)       { s.y = FLOOR_Y - DUDE_H;       if (s.vy > 0) s.vy = 0; }

        s.runFrame = (s.runFrame + 1) % 16;

        s.score += s.speed * 0.5;
        s.cycleProgress = (s.cycleProgress + 0.00025) % 1;

        const dist = Math.floor(s.score);
        setDistance(dist);

        if (s.frame % 400 === 0 && s.speed < 3.6) s.speed += 0.12;

        // Background scroll trackers (parallax)
        s.bgScrollFar = (s.bgScrollFar + s.speed * 0.35) % 100000;
        s.bgScrollMid = (s.bgScrollMid + s.speed * 0.85) % 100000;

        // Spawn obstacles + paired coin arcs together
        if (s.frame % 150 === 0) spawnNext();

        // Move + collide obstacles
        for (let i = s.obstacles.length - 1; i >= 0; i -= 1) {
          const o = s.obstacles[i];
          o.x -= s.speed;
          if (o.type === 'moving_bar') {
            o.y += o.vy;
            if (o.y < o.yMin) { o.y = o.yMin; o.vy = -o.vy; }
            if (o.y > o.yMax) { o.y = o.yMax; o.vy = -o.vy; }
          }
          if (o.x + (o.w || 0) < -40) { s.obstacles.splice(i, 1); continue; }

          const dudeLeft = DUDE_X, dudeRight = DUDE_X + DUDE_W;
          const dudeTop  = s.y,    dudeBottom = s.y + DUDE_H;
          if (o.type === 'pair') {
            // top half
            if (dudeRight > o.x && dudeLeft < o.x + o.w
              && dudeTop < CEILING_Y + o.ceilH) { setGameOver(true); }
            // bottom half
            if (dudeRight > o.x && dudeLeft < o.x + o.w
              && dudeBottom > FLOOR_Y - o.floorH) { setGameOver(true); }
          } else {
            if (dudeRight > o.x && dudeLeft < o.x + o.w
              && dudeBottom > o.y && dudeTop < o.y + o.h) {
              setGameOver(true);
            }
          }
        }

        // Coins scroll + pickup
        for (let i = s.coins.length - 1; i >= 0; i -= 1) {
          const c = s.coins[i];
          c.x -= s.speed;
          if (c.x < -20 || c.taken) { s.coins.splice(i, 1); continue; }
          const cx = DUDE_X + DUDE_W / 2;
          const cy = s.y + DUDE_H / 2;
          const dx = c.x - cx, dy = c.y - cy;
          if (dx * dx + dy * dy < (c.r + 14) * (c.r + 14)) {
            c.taken = true;
            s.coinsCollected += 1;
            setCoinCount(s.coinsCollected);
          }
        }

        // Farts while thrusting
        if (thrusting.current) {
          for (let n = 0; n < 3; n += 1) {
            const f = s.farts[s.nextFart];
            s.nextFart = (s.nextFart + 1) % s.farts.length;
            f.x = DUDE_X - 4 + Math.random() * 6;
            f.y = s.y + DUDE_H * 0.55 + Math.random() * 4;
            f.vx = -1.4 - Math.random() * 1.2;
            f.vy = -0.4 + Math.random() * 0.8;
            f.life = 30 + Math.floor(Math.random() * 12);
            f.r = PIXEL * (3 + Math.floor(Math.random() * 3));
          }
        }
        if (s.frame % 22 === 0) {
          const d = s.droplets[s.nextDrop];
          s.nextDrop = (s.nextDrop + 1) % s.droplets.length;
          d.x = DUDE_X + DUDE_W * 0.5 + (Math.random() - 0.5) * 6;
          d.y = s.y + 2; d.vy = 1.2 + Math.random() * 0.6; d.life = 28;
        }

        if (dist > highScore) {
          setHighScore(dist);
          try { localStorage.setItem(storageKey, String(dist)); } catch { /* ignore */ }
        }
        if (s.coinsCollected > bestCoins) {
          setBestCoins(s.coinsCollected);
          try { localStorage.setItem(coinsKey, String(s.coinsCollected)); } catch { /* ignore */ }
        }
      }

      // ── RENDER ─────────────────────────────────────────────────
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, skyColor(s.cycleProgress, true));
      sky.addColorStop(1, skyColor(s.cycleProgress, false));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Night amount
      const nightAmount = (() => {
        const p = s.cycleProgress * SKY_PHASES.length;
        const ph = Math.floor(p) % SKY_PHASES.length;
        if (ph === 2) return p - Math.floor(p);
        if (ph === 3) return 1;
        if (ph === 0) return 1 - (p - Math.floor(p));
        return 0;
      })();
      if (nightAmount > 0.05) {
        for (const star of s.stars) {
          const a = nightAmount * (0.5 + 0.4 * Math.sin((s.frame + star.tw) * 0.04));
          ctx.fillStyle = `rgba(255,255,255,${a})`;
          ctx.fillRect(px(star.x), px(star.y), PIXEL, PIXEL);
        }
      }

      // Biome cross-fade
      const { cur, next, t: fade } = biomeForDistance(Math.floor(s.score));
      const curBiome  = BIOMES[cur];
      const nextBiome = BIOMES[next];
      if (fade > 0 && curBiome !== nextBiome) {
        drawBackgroundLayered(ctx, curBiome,  s.bgScrollFar, s.bgScrollMid, nightAmount, 1 - fade);
        drawBackgroundLayered(ctx, nextBiome, s.bgScrollFar, s.bgScrollMid, nightAmount, fade);
      } else {
        drawBackgroundLayered(ctx, curBiome, s.bgScrollFar, s.bgScrollMid, nightAmount, 1);
      }

      // Floor + ceiling
      ctx.fillStyle = nightAmount > 0.5 ? '#0a0a18' : '#3a2418';
      ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
      ctx.fillStyle = nightAmount > 0.5 ? '#1a1a28' : '#5a3828';
      ctx.fillRect(0, FLOOR_Y, W, PIXEL);
      ctx.fillStyle = nightAmount > 0.5 ? '#050510' : '#2a1418';
      ctx.fillRect(0, 0, W, CEILING_Y);
      ctx.fillStyle = nightAmount > 0.5 ? '#1a1a28' : '#5a2828';
      ctx.fillRect(0, CEILING_Y - PIXEL, W, PIXEL);

      // Obstacles
      for (const o of s.obstacles) {
        drawObstacle(ctx, o);
      }

      // Coins
      for (const c of s.coins) {
        if (c.taken) continue;
        const cx = px(c.x), cy = px(c.y);
        ctx.fillStyle = '#a07000';
        ctx.fillRect(cx - 4, cy - 6, 10, 12);
        ctx.fillRect(cx - 6, cy - 4, 14, 8);
        ctx.fillStyle = '#ffd84a';
        ctx.fillRect(cx - 2, cy - 4, 6, 8);
        ctx.fillRect(cx - 4, cy - 2, 10, 4);
        if ((s.frame + Math.floor(c.x)) % 30 < 4) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(cx - 2, cy - 4, 2, 2);
        }
      }

      // Fart clouds
      for (const f of s.farts) {
        if (f.life <= 0) continue;
        f.x += f.vx; f.y += f.vy; f.life -= 1;
        const a = Math.min(1, f.life / 30);
        ctx.fillStyle = `rgba(120,170,80,${a * 0.85})`;
        const fx = px(f.x), fy = px(f.y);
        ctx.fillRect(fx, fy, f.r, f.r);
        ctx.fillRect(fx - PIXEL, fy + PIXEL, f.r - PIXEL, f.r - PIXEL);
        ctx.fillStyle = `rgba(170,210,110,${a * 0.6})`;
        ctx.fillRect(fx + PIXEL, fy - PIXEL, PIXEL * 2, PIXEL * 2);
      }

      // Sweat droplets
      for (const d of s.droplets) {
        if (d.life <= 0) continue;
        d.y += d.vy; d.life -= 1;
        const a = Math.min(1, d.life / 28);
        ctx.fillStyle = `rgba(180,220,255,${a})`;
        ctx.fillRect(px(d.x), px(d.y), PIXEL, PIXEL * 2);
      }

      // Dude
      drawDude(ctx, DUDE_X, px(s.y), s.runFrame, thrusting.current, gameStarted && !gameOver);

      rafId = requestAnimationFrame(renderLoop);
    };
    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [gameStarted, gameOver, highScore, bestCoins, storageKey, coinsKey]);

  return (
    <div className="fixed inset-0 bg-zinc-950/95 backdrop-blur-md z-[110] flex flex-col items-center justify-center select-none touch-none p-3">
      <div className="w-full max-w-[640px] flex justify-between items-center px-2 mb-3 text-zinc-100 font-mono tracking-tight">
        <div>
          <span className="text-zinc-500 text-micro block uppercase">{tFallback("cardio.field.distance", "Distance")}</span>
          <span className="text-xl font-black text-orange-300">{distance}<span className="text-xs text-zinc-400"> m</span></span>
        </div>
        <div className="text-center">
          <span className="text-zinc-500 text-micro block uppercase">{tFallback("sweatJetpackModal.coins", "Coins")}</span>
          <span className="text-xl font-black text-amber-300">🪙 {coinCount}</span>
        </div>
        <div className="text-end">
          <span className="text-zinc-500 text-micro block uppercase">{tFallback("dashboard.best", "Best")}</span>
          <span className="text-base font-bold text-primary">{highScore}m · 🪙{bestCoins}</span>
        </div>
      </div>

      <div
        ref={wrapperRef}
        className="relative overflow-hidden rounded-lg border-2 border-zinc-800 shadow-2xl active:scale-[0.99] transition-transform max-w-full"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ aspectRatio: '16 / 9', width: 'min(96vw, 92vh * 16/9)' }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="block w-full h-full"
          style={{ imageRendering: 'pixelated' }}
        />

        {!gameStarted && (
          <div className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center text-center p-6 pointer-events-none">
            <h2 className="text-2xl font-black text-zinc-100 tracking-wider uppercase mb-1">{tFallback("sweatJetpackModal.sweatJetpack", "Sweat Jetpack")}</h2>
            <p className="text-zinc-400 text-xs max-w-[320px] mb-2">Hold to fart. Farts lift you. Release to fall.</p>
            <p className="text-zinc-500 text-micro max-w-[320px] mb-3">Dodge bars in the air, blocks on the floor and ceiling, and the yellow moving ones. Grab coins.</p>
            <p className="text-zinc-500 text-micro mb-3">📱 turn your phone sideways for more room.</p>
            <span className="animate-pulse bg-orange-300 text-zinc-950 font-mono text-xs px-4 py-2 font-bold uppercase tracking-widest rounded">{tFallback("sweatJetpackModal.holdToStart", "Hold to start")}</span>
          </div>
        )}

        {gameOver && (
          <div className="absolute inset-0 bg-red-950/75 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 pointer-events-none">
            <h2 className="text-3xl font-black text-destructive tracking-tighter uppercase mb-1">{tFallback("sweatJetpackModal.splat", "Splat")}</h2>
            <p className="text-zinc-300 text-xs font-mono mb-2">{distance} m · 🪙 {coinCount}</p>
            <span className="bg-orange-300 text-zinc-950 font-mono text-xs px-4 py-2 font-bold uppercase rounded">{tFallback("sweatJetpackModal.tapToRetry", "Tap to retry")}</span>
          </div>
        )}
      </div>

      <button
        onClick={onClose}
        className="mt-4 px-6 py-2 text-zinc-500 hover:text-zinc-300 active:text-zinc-300 text-xs font-mono uppercase tracking-widest transition-colors"
      >
        Close & cool off
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Obstacle renderer — varied colors and types
function drawObstacle(ctx, o) {
  const drawBlock = (x, y, w, h, p) => {
    const ox = px(x), oy = px(y);
    ctx.fillStyle = p.base;
    ctx.fillRect(ox, oy, w, h);
    ctx.fillStyle = p.hl;
    ctx.fillRect(ox, oy, w, PIXEL);            // top edge
    ctx.fillRect(ox, oy, PIXEL, h);            // left edge
    ctx.fillStyle = p.sh;
    ctx.fillRect(ox, oy + h - PIXEL, w, PIXEL); // bottom
    ctx.fillRect(ox + w - PIXEL, oy, PIXEL, h); // right
    // Rivet dots for character — every 8 px on the long axis
    ctx.fillStyle = p.sh;
    for (let bx = 4; bx < w - 4; bx += 12) {
      ctx.fillRect(ox + bx, oy + PIXEL * 2, PIXEL, PIXEL);
      ctx.fillRect(ox + bx, oy + h - PIXEL * 3, PIXEL, PIXEL);
    }
  };
  if (o.type === 'pair') {
    drawBlock(o.x, CEILING_Y, o.w, o.ceilH, o.palette);
    drawBlock(o.x, FLOOR_Y - o.floorH, o.w, o.floorH, o.palette);
  } else if (o.type === 'moving_bar') {
    drawBlock(o.x, o.y, o.w, o.h, o.palette);
    // Warning stripes — diagonal lines for the moving bar
    const ox = px(o.x), oy = px(o.y);
    ctx.fillStyle = '#1a1a1a';
    for (let bx = 0; bx < o.w; bx += 8) {
      ctx.fillRect(ox + bx, oy + PIXEL * 2, PIXEL, PIXEL);
    }
  } else {
    drawBlock(o.x, o.y, o.w, o.h, o.palette);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Dude sprite — 16-bit red-shirted fat guy.
// Now draws BOTH arms (back arm visible at left, swinging opposite to
// the front arm) and uses connected thigh+shin+foot leg units that
// don't break apart mid-step.
function drawDude(ctx, x, y, runFrame, thrusting, alive) {
  // Red shirt palette
  const SKIN     = '#f6c690';
  const SKIN_DK  = '#cc925e';
  const SKIN_SH  = '#a36138';
  const SHIRT    = '#c8312a';
  const SHIRT_DK = '#7a1a18';
  const SHIRT_HL = '#ee5040';
  const PANTS    = '#22252a';
  const PANTS_HL = '#3a3d44';
  const HAIR     = '#3c241a';
  const SHOE     = '#0a0a14';
  const SHOE_HL  = '#26262e';
  const TOOTH    = '#fafafa';
  const MOUTH    = '#5a1212';
  const SWEAT    = '#bbe3ff';

  // Cycle stance 0..3 over 16 frames
  const stance = Math.floor(runFrame / 4) % 4;

  // ── BACK ARM (draw first so it's behind the body)
  // Swings opposite to the front arm. Visible only when behind silhouette.
  const backArmOffset = thrusting
    ? (Math.floor(runFrame / 2) % 2 === 0 ? PIXEL : -PIXEL)
    : (stance === 0 ? -PIXEL : stance === 2 ? PIXEL : 0);
  const bay = y + PIXEL * 6;
  ctx.fillStyle = SKIN_DK; // shadowed because behind body
  ctx.fillRect(x + PIXEL,     bay + PIXEL * 2 + backArmOffset, PIXEL * 2, PIXEL * 3);
  ctx.fillStyle = SKIN_SH;
  ctx.fillRect(x + PIXEL,     bay + PIXEL * 5 + backArmOffset, PIXEL * 2, PIXEL);

  // ── Head
  ctx.fillStyle = SKIN;
  ctx.fillRect(x + PIXEL * 2, y,             PIXEL * 10, PIXEL * 2);
  ctx.fillRect(x + PIXEL,     y + PIXEL,     PIXEL * 12, PIXEL * 4);
  ctx.fillRect(x + PIXEL * 2, y + PIXEL * 5, PIXEL * 10, PIXEL * 1);
  ctx.fillStyle = HAIR;
  ctx.fillRect(x + PIXEL * 5, y,             PIXEL * 4, PIXEL);
  ctx.fillRect(x + PIXEL * 4, y - PIXEL / 2, PIXEL * 6, PIXEL / 2);
  ctx.fillStyle = SKIN_DK;
  ctx.fillRect(x + PIXEL,     y + PIXEL * 4, PIXEL,      PIXEL);
  ctx.fillRect(x + PIXEL * 12, y + PIXEL * 4, PIXEL,     PIXEL);
  ctx.fillStyle = SKIN_SH;
  ctx.fillRect(x + PIXEL,     y + PIXEL * 5, PIXEL * 2,  PIXEL);
  ctx.fillRect(x + PIXEL * 11, y + PIXEL * 5, PIXEL * 2, PIXEL);
  ctx.fillStyle = '#000';
  ctx.fillRect(x + PIXEL * 3, y + PIXEL * 2, PIXEL * 2, PIXEL);
  ctx.fillRect(x + PIXEL * 9, y + PIXEL * 2, PIXEL * 2, PIXEL);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + PIXEL * 3, y + PIXEL * 2 - PIXEL / 2, PIXEL * 2, PIXEL / 2);
  ctx.fillRect(x + PIXEL * 9, y + PIXEL * 2 - PIXEL / 2, PIXEL * 2, PIXEL / 2);
  ctx.fillStyle = MOUTH;
  ctx.fillRect(x + PIXEL * 5, y + PIXEL * 4, PIXEL * 4, PIXEL * 2);
  ctx.fillStyle = TOOTH;
  ctx.fillRect(x + PIXEL * 6, y + PIXEL * 4, PIXEL,     PIXEL);
  ctx.fillStyle = SWEAT;
  ctx.fillRect(x + PIXEL * 4, y + PIXEL, PIXEL, PIXEL);

  // ── Belly (red shirt)
  const ty = y + PIXEL * 6;
  ctx.fillStyle = SHIRT;
  ctx.fillRect(x,             ty + PIXEL,     PIXEL * 14, PIXEL * 6);
  ctx.fillRect(x + PIXEL,     ty,             PIXEL * 12, PIXEL);
  ctx.fillRect(x - PIXEL / 2, ty + PIXEL * 2, PIXEL,      PIXEL * 4);
  ctx.fillRect(x + PIXEL * 14, ty + PIXEL * 2, PIXEL,     PIXEL * 4);
  ctx.fillStyle = SHIRT_DK;
  ctx.fillRect(x,             ty + PIXEL * 6, PIXEL * 14, PIXEL);
  ctx.fillRect(x + PIXEL * 12, ty + PIXEL,    PIXEL * 2,  PIXEL * 5);
  ctx.fillStyle = SHIRT_HL;
  ctx.fillRect(x + PIXEL * 2, ty + PIXEL,     PIXEL * 4,  PIXEL);
  ctx.fillStyle = SHIRT_DK;
  ctx.fillRect(x + PIXEL * 6, ty + PIXEL * 3, PIXEL * 2,  PIXEL); // belly fold

  // ── FRONT ARM (drawn after body so it overlaps)
  const frontArmOffset = thrusting
    ? (Math.floor(runFrame / 2) % 2 === 0 ? -PIXEL : PIXEL)
    : (stance === 0 ? PIXEL : stance === 2 ? -PIXEL : 0);
  ctx.fillStyle = SKIN;
  ctx.fillRect(x + PIXEL * 13, ty + PIXEL * 2 + frontArmOffset, PIXEL * 2, PIXEL * 3);
  ctx.fillStyle = SKIN_DK;
  ctx.fillRect(x + PIXEL * 13, ty + PIXEL * 4 + frontArmOffset, PIXEL * 2, PIXEL);

  // ── Pants waistband + thighs (always two visible blocks)
  const py = ty + PIXEL * 7;
  ctx.fillStyle = PANTS;
  ctx.fillRect(x + PIXEL * 2, py,             PIXEL * 10, PIXEL * 2);
  ctx.fillStyle = PANTS_HL;
  ctx.fillRect(x + PIXEL * 2, py,             PIXEL * 10, PIXEL / 2);

  // ── Legs — proper running cycle, each leg is a connected unit
  // (thigh + shin + shoe) so it can't visually break apart mid-stride.
  drawLeg(ctx, x, py, stance, /*isFront*/false, PANTS, SHOE, SHOE_HL);
  drawLeg(ctx, x, py, stance, /*isFront*/true,  PANTS, SHOE, SHOE_HL);

  // Game-over X
  if (!alive) {
    ctx.fillStyle = '#ff5555';
    ctx.fillRect(x + PIXEL * 3, y + PIXEL * 2,         PIXEL, PIXEL);
    ctx.fillRect(x + PIXEL * 4, y + PIXEL * 2 + PIXEL, PIXEL, PIXEL);
    ctx.fillRect(x + PIXEL * 9, y + PIXEL * 2,         PIXEL, PIXEL);
    ctx.fillRect(x + PIXEL * 10, y + PIXEL * 2 + PIXEL, PIXEL, PIXEL);
  }
}

// Each leg drawn as a unified ribbon: 2 px wide thigh+shin column +
// horizontal shoe at the bottom. stance and side determine angle/height.
function drawLeg(ctx, x, py, stance, isFront, PANTS, SHOE, SHOE_HL) {
  // Base position: back leg at x+PIXEL*2, front leg at x+PIXEL*8
  const baseX = isFront ? x + PIXEL * 8 : x + PIXEL * 2;
  const baseY = py + PIXEL * 2; // top of thigh
  // Vary thigh slant / shin length by stance.
  // Stride pattern (per leg):
  //   stance 0: front=back-extend  back=fwd-up
  //   stance 1: both legs together
  //   stance 2: front=fwd-up       back=back-extend
  //   stance 3: both legs together
  let dx = 0;       // horizontal foot offset from base
  let footY = 0;    // foot Y offset (negative = raised)
  if (stance === 0) {
    if (isFront) { dx = -PIXEL; footY = 0; }
    else         { dx =  PIXEL; footY = -PIXEL; }
  } else if (stance === 2) {
    if (isFront) { dx =  PIXEL; footY = -PIXEL; }
    else         { dx = -PIXEL; footY = 0; }
  }
  // Thigh — vertical block from waist down
  ctx.fillStyle = PANTS;
  ctx.fillRect(baseX, baseY, PIXEL * 3, PIXEL * 2);
  // Shin — angles toward dx
  ctx.fillRect(baseX + dx, baseY + PIXEL * 2, PIXEL * 3, PIXEL * 2 + footY);
  // Foot / shoe — at the end of the shin
  const shoeY = baseY + PIXEL * 4 + footY;
  ctx.fillStyle = SHOE;
  ctx.fillRect(baseX + dx - PIXEL, shoeY, PIXEL * 5, PIXEL);
  ctx.fillStyle = SHOE_HL;
  ctx.fillRect(baseX + dx - PIXEL, shoeY, PIXEL, PIXEL / 2);
}

// ─────────────────────────────────────────────────────────────────────
// Background — two parallax layers with biome-specific silhouettes.
// `globalAlpha` cross-fades during biome transitions. Buildings/trees
// render fully off-screen so they don't pop at the edges.
function drawBackgroundLayered(ctx, biome, scrollFar, scrollMid, nightAmount, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  drawBiomeFar(ctx, biome, scrollFar, nightAmount);
  drawBiomeMid(ctx, biome, scrollMid, nightAmount);
  ctx.restore();
}

function drawBiomeFar(ctx, biome, scroll, nightAmount) {
  const dark = nightAmount > 0.5;
  if (biome === 'city') {
    // Tiny distant skyline
    const baseColor = dark ? '#0e0e22' : '#604030';
    ctx.fillStyle = baseColor;
    const bandH = 40;
    for (let i = 0; i < 200; i += 1) {
      const buildingW = 14 + ((i * 11) % 14);
      const buildingH = 16 + ((i * 23) % bandH);
      const worldX = i * 18 - (scroll | 0);
      // wrap into visible-ish range
      const screenX = ((worldX % (W * 4)) + (W * 4)) % (W * 4);
      if (screenX > W + 30) continue;
      ctx.fillRect(px(screenX), FLOOR_Y - buildingH, buildingW, buildingH);
    }
  } else if (biome === 'desert') {
    ctx.fillStyle = dark ? '#1a1024' : '#7a4220';
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    for (let xx = 0; xx <= W; xx += PIXEL * 4) {
      const h = 14 + Math.sin((xx + scroll) * 0.012) * 12 + Math.sin((xx + scroll) * 0.04) * 4;
      ctx.lineTo(xx, FLOOR_Y - h);
    }
    ctx.lineTo(W, FLOOR_Y);
    ctx.closePath();
    ctx.fill();
  } else {
    // plains
    ctx.fillStyle = dark ? '#0c1a14' : '#3a5a30';
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    for (let xx = 0; xx <= W; xx += PIXEL * 4) {
      const h = 12 + Math.sin((xx + scroll) * 0.018) * 8 + Math.cos((xx + scroll) * 0.05) * 3;
      ctx.lineTo(xx, FLOOR_Y - h);
    }
    ctx.lineTo(W, FLOOR_Y);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBiomeMid(ctx, biome, scroll, nightAmount) {
  const dark = nightAmount > 0.5;
  if (biome === 'city') {
    drawCityMid(ctx, scroll, dark, nightAmount);
  } else if (biome === 'desert') {
    drawDesertMid(ctx, scroll, dark);
  } else {
    drawPlainsMid(ctx, scroll, dark);
  }
}

// City — varied skyline w/ deterministic windows (no shimmer).
function drawCityMid(ctx, scroll, dark, nightAmount) {
  // Each building gets a fixed 80px lane in world space. We render
  // every building whose lane intersects [0, W]. Buildings are allowed
  // to render slightly off-screen so they don't pop in/out.
  const laneW = 80;
  const startLane = Math.floor(scroll / laneW) - 1;
  const endLane   = startLane + Math.ceil(W / laneW) + 2;
  for (let lane = startLane; lane <= endLane; lane += 1) {
    const b = cityBuildingAt(lane);
    const laneX = lane * laneW - scroll;
    // Center building within its lane
    const bx = laneX + (laneW - b.w) / 2;
    const by = FLOOR_Y - b.h;
    // Don't continue early — partial render is fine, we just clip via the
    // canvas naturally.
    // Body
    ctx.fillStyle = dark ? '#0c0c20' : '#2a1a18';
    ctx.fillRect(px(bx), by, b.w, b.h);
    // Side highlight
    ctx.fillStyle = dark ? '#16162e' : '#3a2820';
    ctx.fillRect(px(bx), by, PIXEL, b.h);
    // Top edge
    ctx.fillStyle = dark ? '#1c1c3a' : '#3a2820';
    ctx.fillRect(px(bx), by, b.w, PIXEL);
    // Roof variety
    if (b.roof === 1) {
      // antenna
      ctx.fillStyle = '#0a0a14';
      ctx.fillRect(px(bx + b.w / 2 - 1), by - 18, PIXEL, 18);
      ctx.fillStyle = '#aa3030';
      ctx.fillRect(px(bx + b.w / 2 - 2), by - 18, PIXEL * 2, PIXEL);
    } else if (b.roof === 2) {
      // pointed roof
      ctx.fillStyle = dark ? '#0c0c20' : '#2a1a18';
      ctx.beginPath();
      ctx.moveTo(px(bx),              by);
      ctx.lineTo(px(bx + b.w / 2),    by - 14);
      ctx.lineTo(px(bx + b.w),        by);
      ctx.fill();
    } else if (b.roof === 3) {
      // stepped: small top block
      ctx.fillStyle = dark ? '#0c0c20' : '#2a1a18';
      ctx.fillRect(px(bx + b.w * 0.25), by - 14, b.w * 0.5, 14);
    }
    // Windows — DETERMINISTIC lit/dark based on (lane, row, col) so they
    // don't shimmer-flicker on scroll. Only lit at night.
    if (dark || nightAmount > 0.4) {
      const cols = Math.max(1, Math.floor((b.w - 8) / 8));
      const rows = Math.max(1, Math.floor((b.h - 14) / 10));
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const bit = ((lane * 31 + r * 7 + c) >>> 0);
          const litBit = ((b.lit >>> ((r * 3 + c) % 30)) & 1);
          if (litBit && (bit % 5) < 3) {
            const wx = px(bx + 4 + c * 8);
            const wy = px(by + 6 + r * 10);
            ctx.fillStyle = `rgba(255,220,140,${0.6 + 0.3 * nightAmount})`;
            ctx.fillRect(wx, wy, PIXEL * 2, PIXEL * 2);
            ctx.fillStyle = 'rgba(180,140,80,0.6)';
            ctx.fillRect(wx, wy + PIXEL * 2, PIXEL * 2, PIXEL);
          }
        }
      }
    }
  }
}

function drawDesertMid(ctx, scroll, dark) {
  // Closer dune line — taller silhouette
  ctx.fillStyle = dark ? '#1a1224' : '#5a3018';
  for (let xx = 0; xx <= W; xx += PIXEL * 6) {
    const h = 22 + Math.sin((xx + scroll) * 0.02) * 14;
    ctx.fillRect(xx, FLOOR_Y - h, PIXEL * 6, h);
  }
  // Cactuses — partial render off-screen allowed
  const laneW = 100;
  const startLane = Math.floor(scroll / laneW) - 1;
  const endLane   = startLane + Math.ceil(W / laneW) + 2;
  for (let lane = startLane; lane <= endLane; lane += 1) {
    const cx = lane * laneW - scroll;
    const seed = (lane * 2654435761) >>> 0;
    const armUp   = (seed & 1) === 0;
    const armDown = (seed & 2) === 0;
    ctx.fillStyle = dark ? '#0c1a12' : '#3a6a40';
    ctx.fillRect(px(cx),     FLOOR_Y - 40, PIXEL * 3, 40);
    if (armUp)   ctx.fillRect(px(cx - 6), FLOOR_Y - 32, PIXEL * 3, 12);
    if (armDown) ctx.fillRect(px(cx + 6), FLOOR_Y - 36, PIXEL * 3, 16);
    // Spines
    ctx.fillStyle = dark ? '#06100a' : '#2a4a28';
    for (let yy = -34; yy < -6; yy += 6) ctx.fillRect(px(cx + 2), FLOOR_Y + yy, PIXEL / 2, PIXEL);
  }
}

function drawPlainsMid(ctx, scroll, dark) {
  ctx.fillStyle = dark ? '#06140a' : '#2a4a28';
  for (let xx = 0; xx <= W; xx += PIXEL * 4) {
    const h = 18 + Math.sin((xx + scroll) * 0.022) * 14;
    ctx.fillRect(xx, FLOOR_Y - h, PIXEL * 4, h);
  }
  const laneW = 80;
  const startLane = Math.floor(scroll / laneW) - 1;
  const endLane   = startLane + Math.ceil(W / laneW) + 2;
  for (let lane = startLane; lane <= endLane; lane += 1) {
    const tx = lane * laneW - scroll;
    const seed = (lane * 2654435761) >>> 0;
    const tall = (seed & 1) === 0;
    const trunkH = tall ? 28 : 20;
    const canopyW = tall ? 18 : 14;
    // Trunk
    ctx.fillStyle = dark ? '#0a0a14' : '#1a2a14';
    ctx.fillRect(px(tx),     FLOOR_Y - trunkH - 12, PIXEL * 2, trunkH);
    // Canopy
    ctx.fillStyle = dark ? '#0c1a10' : '#2a5a2a';
    ctx.fillRect(px(tx - canopyW / 2), FLOOR_Y - trunkH - 24, canopyW, 14);
    ctx.fillRect(px(tx - canopyW / 2 + 2), FLOOR_Y - trunkH - 28, canopyW - 4, 4);
    // Highlight
    ctx.fillStyle = dark ? '#1a3a1a' : '#4a7a3a';
    ctx.fillRect(px(tx - canopyW / 2 + 2), FLOOR_Y - trunkH - 22, PIXEL * 2, PIXEL);
  }
}
