// src/components/hub/SweatJetpackModal.jsx
//
// "Sweat Jetpack" easter-egg — Jetpack-Joyride-flavor side-scroller
// where a sweating, FARTING fat dude propels himself through scrolling
// biomes by ripping farts. Hold to thrust, release to fall. You can
// run on the floor or stick to the ceiling — going off-edge just
// clamps, doesn't kill. Bars come at you from the right at varying
// heights; fly OVER or UNDER them. Yellow coins along the way bump
// your coin count.
//
// 16-bit sprite vibe at PIXEL=2, landscape 640×360. Crispy pixel-art
// rendering (imageSmoothingEnabled=false, imageRendering: 'pixelated').
// Slow day/night cycle plus a rotating biome chain — City → Desert →
// Plains → repeat.
//
// Triggered only from gated profiles in HubProfile (currently
// @calason44 + @jaxf). Mounted on demand so the canvas isn't burning
// cycles on any other profile.

import { useEffect, useRef, useState } from 'react';

const W = 640;
const H = 360;
const PIXEL = 2;

const FLOOR_Y  = H - 30;
const CEILING_Y = 20;
const DUDE_W   = PIXEL * 14;   // 28px wide
const DUDE_H   = PIXEL * 18;   // 36px tall
const DUDE_X   = 80;

const px = (n) => Math.floor(n / PIXEL) * PIXEL;

// HSL-blend two colors for the day/night palette interpolation.
function lerp(a, b, t) { return a + (b - a) * t; }
function blendRGB(c1, c2, t) {
  return `rgb(${Math.round(lerp(c1[0], c2[0], t))}, ${Math.round(lerp(c1[1], c2[1], t))}, ${Math.round(lerp(c1[2], c2[2], t))})`;
}

// Sky palettes for the day/night cycle. Cycle progress 0→1 walks
// dawn → day → dusk → night → dawn.
const SKY_PHASES = [
  // [top, bottom]
  [[ 80,  40,  80], [255, 160, 110]], // dawn (purple → peach)
  [[ 90, 170, 240], [200, 230, 255]], // day  (blue → pale)
  [[200,  80,  60], [ 70,  40,  90]], // dusk (red → indigo)
  [[ 10,  10,  35], [ 30,  30,  60]], // night (almost black)
];

function skyColor(progress, isTop) {
  const phaseFloat = progress * SKY_PHASES.length;
  const idx = Math.floor(phaseFloat) % SKY_PHASES.length;
  const t = phaseFloat - Math.floor(phaseFloat);
  const cur = SKY_PHASES[idx][isTop ? 0 : 1];
  const nxt = SKY_PHASES[(idx + 1) % SKY_PHASES.length][isTop ? 0 : 1];
  return blendRGB(cur, nxt, t);
}

// Biome name from distance — cycles every 600m. Used to switch the
// silhouette layer underneath the player.
function currentBiome(distance) {
  const phase = Math.floor(distance / 600) % 3;
  return ['city', 'desert', 'plains'][phase];
}

// Fart cloud particle pool (greenish puffs that ARE the jetpack).
function makeFarts() {
  return Array.from({ length: 36 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, r: PIXEL }));
}
// Sweat droplet pool (cosmetic — flies off his head while moving).
function makeDroplets() {
  return Array.from({ length: 16 }, () => ({ x: 0, y: 0, vy: 0, life: 0 }));
}
// Foreground silhouette block pool (parallax buildings/dunes/trees).
function makeSilhouette() {
  // Three layers at different speeds for parallax depth.
  return {
    layer0: [], layer1: [], layer2: [],
    seed0: 0, seed1: 0, seed2: 0,
  };
}

export default function SweatJetpackModal({ onClose, userId }) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const storageKey      = `flexyn.sweatJetpackHighScore.${userId || 'anon'}`;
  const coinsKey        = `flexyn.sweatJetpackBestCoins.${userId || 'anon'}`;
  const [highScore, setHighScore] = useState(() => {
    try { return Number(localStorage.getItem(storageKey)) || 0; } catch { return 0; }
  });
  const [bestCoins, setBestCoins] = useState(() => {
    try { return Number(localStorage.getItem(coinsKey)) || 0; } catch { return 0; }
  });
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [distance, setDistance] = useState(0);
  const [coinCount, setCoinCount] = useState(0);

  const thrusting = useRef(false);
  const lastTouchRef = useRef(0);

  const state = useRef({
    y: H / 2,
    vy: 0,
    // Easier than v1: weaker thrust, lower gravity, slower scroll.
    gravity:    0.40,
    thrustForce: -0.55,
    maxVy:       9,
    speed:       2.4,
    obstacles: [],
    coins:     [],
    farts:     makeFarts(),
    droplets:  makeDroplets(),
    nextFart:  0,
    nextDrop:  0,
    silhouette: makeSilhouette(),
    frame: 0,
    score: 0,
    coinsCollected: 0,
    runFrame: 0, // cycles the leg animation while on floor
    cycleProgress: 0, // 0..1 day/night
  });

  const resetGame = () => {
    state.current = {
      y: H / 2, vy: 0, gravity: 0.40, thrustForce: -0.55, maxVy: 9, speed: 2.4,
      obstacles: [], coins: [], farts: makeFarts(), droplets: makeDroplets(),
      nextFart: 0, nextDrop: 0, silhouette: makeSilhouette(), frame: 0, score: 0,
      coinsCollected: 0, runFrame: 0, cycleProgress: Math.random(),
    };
    thrusting.current = false;
    setDistance(0);
    setCoinCount(0);
    setGameOver(false);
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

    const spawnCoinArc = (sx) => {
      // Arc of 5 coins arching across the screen at a random height band.
      const cy = 90 + Math.random() * 180;
      for (let i = 0; i < 5; i += 1) {
        const xx = sx + i * 28;
        const arc = Math.sin((i / 4) * Math.PI) * 36;
        state.current.coins.push({ x: xx, y: cy - arc, r: 7, taken: false });
      }
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

        // Clamp at ceiling and floor — DON'T die there. Running on the
        // floor or skidding along the ceiling is fine; that's part of
        // the new feel.
        if (s.y < CEILING_Y)              { s.y = CEILING_Y;              if (s.vy < 0) s.vy = 0; }
        if (s.y > FLOOR_Y - DUDE_H)       { s.y = FLOOR_Y - DUDE_H;       if (s.vy > 0) s.vy = 0; }

        // Leg cycle when on the floor (running anim).
        const onFloor = (s.y >= FLOOR_Y - DUDE_H - 1);
        if (onFloor) s.runFrame = (s.runFrame + 1) % 16;

        // Score / cycles
        s.score += s.speed * 0.5;
        s.cycleProgress = (s.cycleProgress + 0.00025) % 1; // ~2.7 min full cycle

        const dist = Math.floor(s.score);
        setDistance(dist);

        // Difficulty ramp — small bump every ~400 frames, capped low.
        if (s.frame % 400 === 0 && s.speed < 3.6) s.speed += 0.12;

        // Spawn obstacles — single horizontal bar at random height.
        // Single bar = fly above OR below, very flappy-bird-NOT.
        if (s.frame % 130 === 0) {
          const bandY = 80 + Math.random() * (H - 180);
          const barW = 60 + Math.floor(Math.random() * 60);
          const barH = 18 + Math.floor(Math.random() * 14);
          s.obstacles.push({ x: W + 20, y: bandY, w: barW, h: barH, passed: false });
        }

        // Spawn coin arcs less often than obstacles.
        if (s.frame % 220 === 80) spawnCoinArc(W + 30);

        // Scroll obstacles + collision
        for (let i = s.obstacles.length - 1; i >= 0; i -= 1) {
          const o = s.obstacles[i];
          o.x -= s.speed;
          if (o.x + o.w < -10) { s.obstacles.splice(i, 1); continue; }
          // Collision (AABB)
          const dudeLeft   = DUDE_X;
          const dudeRight  = DUDE_X + DUDE_W;
          const dudeTop    = s.y;
          const dudeBottom = s.y + DUDE_H;
          if (dudeRight > o.x && dudeLeft < o.x + o.w
            && dudeBottom > o.y && dudeTop < o.y + o.h) {
            setGameOver(true);
          }
        }

        // Scroll coins + pickup
        for (let i = s.coins.length - 1; i >= 0; i -= 1) {
          const c = s.coins[i];
          c.x -= s.speed;
          if (c.x < -20) { s.coins.splice(i, 1); continue; }
          if (c.taken) { s.coins.splice(i, 1); continue; }
          // Pickup (circle vs rect — close enough)
          const cx = DUDE_X + DUDE_W / 2;
          const cy = s.y + DUDE_H / 2;
          const dx = c.x - cx;
          const dy = c.y - cy;
          if (dx * dx + dy * dy < (c.r + 14) * (c.r + 14)) {
            c.taken = true;
            s.coinsCollected += 1;
            setCoinCount(s.coinsCollected);
          }
        }

        // Spit a fart on every frame while thrusting — these ARE the jetpack
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
        // Sweat droplet occasionally regardless of thrust
        if (s.frame % 22 === 0) {
          const d = s.droplets[s.nextDrop];
          s.nextDrop = (s.nextDrop + 1) % s.droplets.length;
          d.x = DUDE_X + DUDE_W * 0.5 + (Math.random() - 0.5) * 6;
          d.y = s.y + 2;
          d.vy = 1.2 + Math.random() * 0.6;
          d.life = 28;
        }

        // Bump best score
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
      // Sky gradient, day/night palette interpolation
      const topRGB    = skyColor(s.cycleProgress, true);
      const bottomRGB = skyColor(s.cycleProgress, false);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, topRGB);
      sky.addColorStop(1, bottomRGB);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Stars (visible during night phase)
      const nightAmount = (() => {
        const p = s.cycleProgress * SKY_PHASES.length;
        const ph = Math.floor(p) % SKY_PHASES.length;
        // 0=dawn, 1=day, 2=dusk, 3=night
        if (ph === 2) return p - Math.floor(p);      // approaching night
        if (ph === 3) return 1;                       // night
        if (ph === 0) return 1 - (p - Math.floor(p)); // leaving night
        return 0;
      })();
      if (nightAmount > 0.05) {
        const starCount = 30;
        for (let i = 0; i < starCount; i += 1) {
          // Deterministic star pseudo-positions so they don't shimmer-jitter
          const sx = (i * 73 + 11) % W;
          const sy = ((i * 41 + 7) % (H - 80));
          ctx.fillStyle = `rgba(255,255,255,${nightAmount * 0.7})`;
          ctx.fillRect(px(sx), px(sy), PIXEL, PIXEL);
        }
      }

      // Far parallax layer — distant biome silhouette (slowest)
      const biome = currentBiome(Math.floor(s.score));
      drawBiomeFar(ctx, biome, s.frame, nightAmount);
      // Middle parallax layer — closer biome detail
      drawBiomeMid(ctx, biome, s.frame, nightAmount);

      // Floor
      ctx.fillStyle = nightAmount > 0.5 ? '#0a0a18' : '#3a2418';
      ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
      ctx.fillStyle = nightAmount > 0.5 ? '#1a1a28' : '#5a3828';
      ctx.fillRect(0, FLOOR_Y, W, PIXEL);

      // Ceiling
      ctx.fillStyle = nightAmount > 0.5 ? '#050510' : '#2a1418';
      ctx.fillRect(0, 0, W, CEILING_Y);

      // Obstacles — chunky concrete bars
      for (const o of s.obstacles) {
        const ox = px(o.x), oy = px(o.y);
        ctx.fillStyle = '#3a3a4a';
        ctx.fillRect(ox, oy, o.w, o.h);
        // Top/bottom edge highlight
        ctx.fillStyle = '#5a5a72';
        ctx.fillRect(ox, oy, o.w, PIXEL);
        ctx.fillStyle = '#1a1a24';
        ctx.fillRect(ox, oy + o.h - PIXEL, o.w, PIXEL);
        // End caps
        ctx.fillStyle = '#5a5a72';
        ctx.fillRect(ox, oy, PIXEL, o.h);
        ctx.fillStyle = '#1a1a24';
        ctx.fillRect(ox + o.w - PIXEL, oy, PIXEL, o.h);
      }

      // Coins
      for (const c of s.coins) {
        if (c.taken) continue;
        const cx = px(c.x), cy = px(c.y);
        // Outer dark ring
        ctx.fillStyle = '#a07000';
        ctx.fillRect(cx - 4, cy - 6, 10, 12);
        ctx.fillRect(cx - 6, cy - 4, 14, 8);
        // Inner shiny
        ctx.fillStyle = '#ffd84a';
        ctx.fillRect(cx - 2, cy - 4, 6, 8);
        ctx.fillRect(cx - 4, cy - 2, 10, 4);
        // Sparkle
        if ((s.frame + Math.floor(c.x)) % 30 < 4) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(cx - 2, cy - 4, 2, 2);
        }
      }

      // Fart clouds — green puffs trailing behind the dude
      for (const f of s.farts) {
        if (f.life <= 0) continue;
        f.x += f.vx; f.y += f.vy; f.life -= 1;
        const a = Math.min(1, f.life / 30);
        // 3-pixel cloud blob (center + 4 neighbors for the puff shape)
        ctx.fillStyle = `rgba(120,170,80,${a * 0.85})`;
        const fx = px(f.x), fy = px(f.y);
        ctx.fillRect(fx, fy, f.r, f.r);
        ctx.fillRect(fx - PIXEL, fy + PIXEL, f.r - PIXEL, f.r - PIXEL);
        ctx.fillStyle = `rgba(170,210,110,${a * 0.6})`;
        ctx.fillRect(fx + PIXEL, fy - PIXEL, PIXEL * 2, PIXEL * 2);
      }

      // Sweat droplets — small blue specks behind the dude's head
      for (const d of s.droplets) {
        if (d.life <= 0) continue;
        d.y += d.vy; d.life -= 1;
        const a = Math.min(1, d.life / 28);
        ctx.fillStyle = `rgba(180,220,255,${a})`;
        ctx.fillRect(px(d.x), px(d.y), PIXEL, PIXEL * 2);
      }

      // ── DUDE — 16-bit sprite ──────────────────────────────────
      drawDude(ctx, DUDE_X, px(s.y), s.runFrame, thrusting.current, gameStarted && !gameOver);

      rafId = requestAnimationFrame(renderLoop);
    };
    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [gameStarted, gameOver, highScore, bestCoins, storageKey, coinsKey]);

  return (
    <div className="fixed inset-0 bg-zinc-950/95 backdrop-blur-md z-[110] flex flex-col items-center justify-center select-none touch-none p-3">
      {/* HUD */}
      <div className="w-full max-w-[640px] flex justify-between items-center px-2 mb-3 text-zinc-100 font-mono tracking-tight">
        <div>
          <span className="text-zinc-500 text-[10px] block uppercase">Distance</span>
          <span className="text-xl font-black text-orange-300">{distance}<span className="text-xs text-zinc-400"> m</span></span>
        </div>
        <div className="text-center">
          <span className="text-zinc-500 text-[10px] block uppercase">Coins</span>
          <span className="text-xl font-black text-amber-300">🪙 {coinCount}</span>
        </div>
        <div className="text-end">
          <span className="text-zinc-500 text-[10px] block uppercase">Best</span>
          <span className="text-base font-bold text-amber-400">{highScore}m · 🪙{bestCoins}</span>
        </div>
      </div>

      {/* Canvas — HOLD to fart, release to fall */}
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
            <h2 className="text-2xl font-black text-zinc-100 tracking-wider uppercase mb-1">Sweat Jetpack</h2>
            <p className="text-zinc-400 text-xs max-w-[320px] mb-4">Hold to fart. Farts lift you. Release to fall. Fly over OR under the bars. Grab coins. Ceiling and floor are safe to skid on.</p>
            <p className="text-zinc-500 text-[10px] mb-4">📱 turn your phone sideways for more room.</p>
            <span className="animate-pulse bg-orange-300 text-zinc-950 font-mono text-xs px-4 py-2 font-bold uppercase tracking-widest rounded">Hold to start</span>
          </div>
        )}

        {gameOver && (
          <div className="absolute inset-0 bg-red-950/75 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 pointer-events-none">
            <h2 className="text-3xl font-black text-red-400 tracking-tighter uppercase mb-1">Splat</h2>
            <p className="text-zinc-300 text-xs font-mono mb-2">{distance} m · 🪙 {coinCount}</p>
            <span className="bg-orange-300 text-zinc-950 font-mono text-xs px-4 py-2 font-bold uppercase rounded">Tap to retry</span>
          </div>
        )}
      </div>

      <button
        onClick={onClose}
        className="mt-4 px-6 py-2 text-zinc-500 hover:text-zinc-300 text-xs font-mono uppercase tracking-widest transition-colors"
      >
        Close & cool off
      </button>
    </div>
  );
}

// ── Sprite + scenery helpers (kept outside the component so they're
//    not re-allocated per render). All coords already PIXEL-aligned by
//    the caller. ────────────────────────────────────────────────────

function drawDude(ctx, x, y, runFrame, thrusting, alive) {
  // Palette — 16-bit dudefriend
  const SKIN     = '#f6c690';
  const SKIN_DK  = '#cc925e';
  const SKIN_SH  = '#a36138';   // deep shadow under jowls
  const SHIRT    = '#3868a8';
  const SHIRT_DK = '#234a82';
  const SHIRT_HL = '#5a8dd0';
  const PANTS    = '#22252a';
  const PANTS_HL = '#3a3d44';
  const HAIR     = '#3c241a';
  const SHOE     = '#0a0a14';
  const SHOE_HL  = '#26262e';
  const TOOTH    = '#fafafa';
  const MOUTH    = '#5a1212';
  const SWEAT    = '#bbe3ff';

  // Head — round-ish 12×8 with jowls
  ctx.fillStyle = SKIN;
  ctx.fillRect(x + PIXEL * 2, y,             PIXEL * 10, PIXEL * 2);
  ctx.fillRect(x + PIXEL,     y + PIXEL,     PIXEL * 12, PIXEL * 4);
  ctx.fillRect(x + PIXEL * 2, y + PIXEL * 5, PIXEL * 10, PIXEL * 1);

  // Hair tuft — small
  ctx.fillStyle = HAIR;
  ctx.fillRect(x + PIXEL * 5, y,             PIXEL * 4, PIXEL);
  ctx.fillRect(x + PIXEL * 4, y - PIXEL / 2, PIXEL * 6, PIXEL / 2);

  // Jowl shadow
  ctx.fillStyle = SKIN_DK;
  ctx.fillRect(x + PIXEL,     y + PIXEL * 4, PIXEL,      PIXEL);
  ctx.fillRect(x + PIXEL * 12, y + PIXEL * 4, PIXEL,     PIXEL);
  ctx.fillStyle = SKIN_SH;
  ctx.fillRect(x + PIXEL,     y + PIXEL * 5, PIXEL * 2,  PIXEL);
  ctx.fillRect(x + PIXEL * 11, y + PIXEL * 5, PIXEL * 2, PIXEL);

  // Eyes — squinting
  ctx.fillStyle = '#000';
  ctx.fillRect(x + PIXEL * 3, y + PIXEL * 2, PIXEL * 2, PIXEL);
  ctx.fillRect(x + PIXEL * 9, y + PIXEL * 2, PIXEL * 2, PIXEL);
  // Eye-white slits above (for that strained look)
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + PIXEL * 3, y + PIXEL * 2 - PIXEL / 2, PIXEL * 2, PIXEL / 2);
  ctx.fillRect(x + PIXEL * 9, y + PIXEL * 2 - PIXEL / 2, PIXEL * 2, PIXEL / 2);

  // Mouth — open, panting (one tooth peek)
  ctx.fillStyle = MOUTH;
  ctx.fillRect(x + PIXEL * 5, y + PIXEL * 4, PIXEL * 4, PIXEL * 2);
  ctx.fillStyle = TOOTH;
  ctx.fillRect(x + PIXEL * 6, y + PIXEL * 4, PIXEL,     PIXEL);

  // Forehead sweat droplet
  ctx.fillStyle = SWEAT;
  ctx.fillRect(x + PIXEL * 4, y + PIXEL, PIXEL, PIXEL);

  // ── Body — big belly. Anchored at y + PIXEL*6
  const ty = y + PIXEL * 6;
  // Belly outline + base
  ctx.fillStyle = SHIRT;
  ctx.fillRect(x,             ty + PIXEL,     PIXEL * 14, PIXEL * 6);
  ctx.fillRect(x + PIXEL,     ty,             PIXEL * 12, PIXEL);
  ctx.fillRect(x - PIXEL / 2, ty + PIXEL * 2, PIXEL,      PIXEL * 4); // far side bulge
  ctx.fillRect(x + PIXEL * 14, ty + PIXEL * 2, PIXEL,     PIXEL * 4); // back bulge
  // Belly shading bottom
  ctx.fillStyle = SHIRT_DK;
  ctx.fillRect(x,             ty + PIXEL * 6, PIXEL * 14, PIXEL);
  ctx.fillRect(x + PIXEL * 12, ty + PIXEL,    PIXEL * 2,  PIXEL * 5);
  // Belly highlight
  ctx.fillStyle = SHIRT_HL;
  ctx.fillRect(x + PIXEL * 2, ty + PIXEL,     PIXEL * 4,  PIXEL);
  // Belly button hint (shirt fold)
  ctx.fillStyle = SHIRT_DK;
  ctx.fillRect(x + PIXEL * 6, ty + PIXEL * 3, PIXEL * 2,  PIXEL);

  // Arms — front arm visible (back arm hidden behind body)
  // Animate arms forward/back slightly while running OR flapping while thrust.
  const armSwing = thrusting
    ? (Math.floor(runFrame / 2) % 2 === 0 ? -PIXEL : PIXEL)
    : (Math.floor(runFrame / 4) % 2 === 0 ? -PIXEL : 0);
  ctx.fillStyle = SKIN;
  ctx.fillRect(x + PIXEL * 13, ty + PIXEL * 2 + armSwing, PIXEL * 2, PIXEL * 3);
  ctx.fillStyle = SKIN_DK;
  ctx.fillRect(x + PIXEL * 13, ty + PIXEL * 4 + armSwing, PIXEL * 2, PIXEL);

  // Pants
  const py = ty + PIXEL * 7;
  ctx.fillStyle = PANTS;
  ctx.fillRect(x + PIXEL * 2, py,             PIXEL * 10, PIXEL * 2);
  ctx.fillStyle = PANTS_HL;
  ctx.fillRect(x + PIXEL * 2, py,             PIXEL * 10, PIXEL / 2);

  // Legs — running animation when alive. Cycles between two stances.
  const stance = Math.floor(runFrame / 4) % 4;
  // stances: 0 = left fwd, 1 = together, 2 = right fwd, 3 = together
  const ly = py + PIXEL * 2;
  ctx.fillStyle = PANTS;
  if (stance === 0) {
    ctx.fillRect(x + PIXEL,     ly,         PIXEL * 4, PIXEL * 2);
    ctx.fillRect(x + PIXEL * 8, ly + PIXEL, PIXEL * 4, PIXEL * 2);
  } else if (stance === 2) {
    ctx.fillRect(x + PIXEL,     ly + PIXEL, PIXEL * 4, PIXEL * 2);
    ctx.fillRect(x + PIXEL * 8, ly,         PIXEL * 4, PIXEL * 2);
  } else {
    ctx.fillRect(x + PIXEL * 2, ly,         PIXEL * 4, PIXEL * 2);
    ctx.fillRect(x + PIXEL * 7, ly,         PIXEL * 4, PIXEL * 2);
  }
  // Shoes
  ctx.fillStyle = SHOE;
  ctx.fillRect(x + PIXEL,     ly + PIXEL * 2, PIXEL * 4, PIXEL);
  ctx.fillRect(x + PIXEL * 7, ly + PIXEL * 2, PIXEL * 4, PIXEL);
  ctx.fillStyle = SHOE_HL;
  ctx.fillRect(x + PIXEL,     ly + PIXEL * 2, PIXEL,     PIXEL / 2);
  ctx.fillRect(x + PIXEL * 7, ly + PIXEL * 2, PIXEL,     PIXEL / 2);

  // Game-over X over eyes
  if (!alive) {
    ctx.fillStyle = '#ff5555';
    ctx.fillRect(x + PIXEL * 3, y + PIXEL * 2,         PIXEL, PIXEL);
    ctx.fillRect(x + PIXEL * 4, y + PIXEL * 2 + PIXEL, PIXEL, PIXEL);
    ctx.fillRect(x + PIXEL * 9, y + PIXEL * 2,         PIXEL, PIXEL);
    ctx.fillRect(x + PIXEL * 10, y + PIXEL * 2 + PIXEL, PIXEL, PIXEL);
  }
}

// Far/background silhouette by biome. The frame counter drives a
// slow per-pixel scroll. Color picked from nightAmount.
function drawBiomeFar(ctx, biome, frame, nightAmount) {
  const dark = nightAmount > 0.5;
  const fillBase = dark ? '#1a1a2e' : '#604030';
  // Distant outline — slow parallax.
  const scroll = Math.floor(frame * 0.4) % (W * 2);
  ctx.fillStyle = fillBase;
  if (biome === 'city') {
    // Distant skyscraper bands.
    for (let i = 0; i < 60; i += 1) {
      const bx = ((i * 38) - scroll) % (W * 2);
      const drawX = bx < 0 ? bx + W * 2 : bx;
      if (drawX > W) continue;
      const bh = 30 + (((i * 17) % 60));
      ctx.fillRect(px(drawX), FLOOR_Y - bh, PIXEL * 8, bh);
    }
  } else if (biome === 'desert') {
    // Rolling dunes — sinewy silhouette.
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    for (let x = 0; x <= W; x += PIXEL * 4) {
      const h = 14 + Math.sin((x + scroll) * 0.012) * 12 + Math.sin((x + scroll) * 0.04) * 4;
      ctx.lineTo(x, FLOOR_Y - h);
    }
    ctx.lineTo(W, FLOOR_Y);
    ctx.closePath();
    ctx.fill();
  } else {
    // Plains — trees + rolling hills.
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    for (let x = 0; x <= W; x += PIXEL * 4) {
      const h = 12 + Math.sin((x + scroll) * 0.018) * 8 + Math.cos((x + scroll) * 0.05) * 3;
      ctx.lineTo(x, FLOOR_Y - h);
    }
    ctx.lineTo(W, FLOOR_Y);
    ctx.closePath();
    ctx.fill();
    // Far trees
    for (let i = 0; i < 28; i += 1) {
      const tx = ((i * 60) - scroll) % (W * 2);
      const dx = tx < 0 ? tx + W * 2 : tx;
      if (dx > W) continue;
      ctx.fillStyle = fillBase;
      ctx.fillRect(px(dx),     FLOOR_Y - 28, PIXEL * 2, 18); // trunk
      ctx.fillRect(px(dx - 4), FLOOR_Y - 36, PIXEL * 5, 12); // leaves
    }
  }
}

function drawBiomeMid(ctx, biome, frame, nightAmount) {
  const dark = nightAmount > 0.5;
  // Closer / darker silhouette — faster parallax than the far layer.
  const scroll = Math.floor(frame * 1.2) % (W * 2);
  if (biome === 'city') {
    // Closer skyscrapers with lit windows during night.
    for (let i = 0; i < 40; i += 1) {
      const bx = ((i * 64) - scroll) % (W * 2);
      const drawX = bx < 0 ? bx + W * 2 : bx;
      if (drawX > W + 30) continue;
      const bh = 60 + (((i * 23) % 90));
      ctx.fillStyle = dark ? '#0c0c20' : '#2a1a18';
      ctx.fillRect(px(drawX), FLOOR_Y - bh, PIXEL * 14, bh);
      // Windows
      if (dark) {
        for (let wy = FLOOR_Y - bh + 6; wy < FLOOR_Y - 6; wy += 8) {
          for (let wx = drawX + 2; wx < drawX + PIXEL * 14 - 2; wx += 6) {
            // Pseudo-random "lit" gate
            if (((i * 13 + Math.floor(wy / 8) * 7 + Math.floor(wx / 6) * 3) % 5) < 2) {
              ctx.fillStyle = 'rgba(255,220,140,0.85)';
              ctx.fillRect(px(wx), px(wy), PIXEL, PIXEL);
            }
          }
        }
      }
    }
  } else if (biome === 'desert') {
    // Cactuses + closer dunes.
    ctx.fillStyle = dark ? '#1a1224' : '#5a3018';
    for (let x = 0; x <= W; x += PIXEL * 6) {
      const h = 22 + Math.sin((x + scroll) * 0.02) * 14;
      ctx.fillRect(x, FLOOR_Y - h, PIXEL * 6, h);
    }
    for (let i = 0; i < 16; i += 1) {
      const cx = ((i * 110) - scroll) % (W * 2);
      const dx = cx < 0 ? cx + W * 2 : cx;
      if (dx > W) continue;
      ctx.fillStyle = dark ? '#0c1a12' : '#3a6a40';
      ctx.fillRect(px(dx), FLOOR_Y - 40, PIXEL * 3, 40);
      ctx.fillRect(px(dx - 6), FLOOR_Y - 32, PIXEL * 3, 12);
      ctx.fillRect(px(dx + 6), FLOOR_Y - 36, PIXEL * 3, 16);
    }
  } else {
    // Plains — close hills + closer trees
    ctx.fillStyle = dark ? '#06140a' : '#2a4a28';
    for (let x = 0; x <= W; x += PIXEL * 4) {
      const h = 18 + Math.sin((x + scroll) * 0.022) * 14;
      ctx.fillRect(x, FLOOR_Y - h, PIXEL * 4, h);
    }
    for (let i = 0; i < 20; i += 1) {
      const tx = ((i * 80) - scroll) % (W * 2);
      const dx = tx < 0 ? tx + W * 2 : tx;
      if (dx > W) continue;
      ctx.fillStyle = dark ? '#0a0a14' : '#1a2a14';
      ctx.fillRect(px(dx),     FLOOR_Y - 36, PIXEL * 2, 24); // trunk
      ctx.fillRect(px(dx - 6), FLOOR_Y - 48, PIXEL * 7, 18); // canopy
    }
  }
}
