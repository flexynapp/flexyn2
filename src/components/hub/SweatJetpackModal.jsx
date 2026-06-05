// src/components/hub/SweatJetpackModal.jsx
//
// Hidden easter-egg "Sweat Jetpack" — a fat sweating dude propelled
// upward by his own sweat (the "jetpack"). Endless-runner mechanics
// modeled after Jetpack Joyride: hold to thrust, release to fall,
// dodge bars sliding in from the right. Surfaced only from the
// @calason44 profile (gated in HubProfile, mirroring @sean's Iron
// Snake and @keganbergeron's Heavy Bird).
//
// Zero-dependency canvas engine, 360×640 design space, mounted on
// demand. All coordinates floored to integers for the pixelated
// aesthetic (no anti-aliased curves — only fillRect blocks).

import { useEffect, useRef, useState } from 'react';

const W = 360;
const H = 640;
const PIXEL = 4; // block size — every shape is multiples of this

// Floor-to-grid for the chunky pixel look.
const px = (n) => Math.floor(n / PIXEL) * PIXEL;

// Initial sweat-droplet pool. We pre-allocate so the rAF loop never
// allocates inside a frame.
function makeDroplets() {
  return Array.from({ length: 24 }, () => ({
    x: 0, y: 0, vx: 0, vy: 0, life: 0, r: PIXEL,
  }));
}

// Background heat-shimmer specks. Pure decoration.
function makeShimmer() {
  return Array.from({ length: 20 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vy: Math.random() * 0.3 + 0.05,
    a: Math.random() * 0.25 + 0.05,
  }));
}

export default function SweatJetpackModal({ onClose, userId }) {
  const canvasRef = useRef(null);
  const storageKey = `flexyn.sweatJetpackHighScore.${userId || 'anon'}`;
  const [highScore, setHighScore] = useState(() => {
    try { return Number(localStorage.getItem(storageKey)) || 0; } catch { return 0; }
  });
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [distance, setDistance] = useState(0);

  // Hold-to-thrust uses a boolean ref so the rAF loop reads the latest
  // state without re-binding the listener every render.
  const thrusting = useRef(false);

  const state = useRef({
    y: 280,
    vy: 0,
    gravity: 0.55,
    thrustForce: -0.85, // accel applied while sweating
    maxVy: 11,
    obstacles: [],
    droplets: makeDroplets(),
    nextDroplet: 0,
    shimmer: makeShimmer(),
    frame: 0,
    score: 0,
    speed: 3.2, // pixels per frame the world moves left
  });

  // Synthetic mouse events fire after touch — guard so a single tap
  // doesn't both register as touch AND mouse.
  const lastTouchRef = useRef(0);

  const resetGame = () => {
    state.current = {
      y: 280, vy: 0, gravity: 0.55, thrustForce: -0.85, maxVy: 11,
      obstacles: [], droplets: makeDroplets(), nextDroplet: 0,
      shimmer: makeShimmer(), frame: 0, score: 0, speed: 3.2,
    };
    thrusting.current = false;
    setDistance(0);
    setGameOver(false);
  };

  const startThrust = (e) => {
    if (e) e.preventDefault();
    if (!gameStarted) { setGameStarted(true); thrusting.current = true; return; }
    if (gameOver) { resetGame(); return; }
    thrusting.current = true;
  };

  const stopThrust = (e) => {
    if (e) e.preventDefault();
    thrusting.current = false;
  };

  const handleTouchStart = (e) => { lastTouchRef.current = Date.now(); startThrust(e); };
  const handleTouchEnd   = (e) => { lastTouchRef.current = Date.now(); stopThrust(e); };
  const handleMouseDown  = (e) => { if (Date.now() - lastTouchRef.current < 600) return; startThrust(e); };
  const handleMouseUp    = (e) => { if (Date.now() - lastTouchRef.current < 600) return; stopThrust(e); };

  // Keyboard support — space / up arrow holds thrust. Mainly for
  // desktop testing; mobile gets touch.
  useEffect(() => {
    const down = (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); startThrust(); }
    };
    const up = (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); stopThrust(); }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStarted, gameOver]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    // Disable anti-aliasing on text + scaling for crispy pixels.
    ctx.imageSmoothingEnabled = false;
    let rafId;

    const renderLoop = () => {
      const s = state.current;
      s.frame += 1;

      // ── Physics ─────────────────────────────────────────────────
      if (gameStarted && !gameOver) {
        // Apply thrust or gravity
        if (thrusting.current) {
          s.vy += s.thrustForce;
        } else {
          s.vy += s.gravity;
        }
        if (s.vy > s.maxVy) s.vy = s.maxVy;
        if (s.vy < -s.maxVy) s.vy = -s.maxVy;
        s.y += s.vy;

        // World scrolls; distance increments
        s.score += s.speed * 0.5;
        const dist = Math.floor(s.score);
        setDistance(dist);
        if (dist > highScore) {
          setHighScore(dist);
          try { localStorage.setItem(storageKey, String(dist)); } catch { /* ignore */ }
        }

        // Difficulty ramp — speed creeps up slowly
        if (s.frame % 240 === 0 && s.speed < 5.5) s.speed += 0.18;

        // Spawn obstacles
        if (s.frame % 90 === 0) {
          const gapSize = 200 - Math.min(50, Math.floor(s.score / 100));
          const gapY = Math.floor(Math.random() * (H - gapSize - 120)) + 60;
          s.obstacles.push({
            x: W,
            gapTop: gapY,
            gapBottom: gapY + gapSize,
            width: PIXEL * 8,
            passed: false,
          });
        }

        // Update obstacles
        for (let i = s.obstacles.length - 1; i >= 0; i -= 1) {
          const o = s.obstacles[i];
          o.x -= s.speed;
          if (o.x < -o.width) s.obstacles.splice(i, 1);
        }

        // Spit sweat droplets while thrusting — these ARE the jetpack
        if (thrusting.current) {
          for (let n = 0; n < 2; n += 1) {
            const d = s.droplets[s.nextDroplet];
            s.nextDroplet = (s.nextDroplet + 1) % s.droplets.length;
            d.x = 76 + Math.random() * 12;
            d.y = s.y + 46;
            d.vx = (Math.random() - 0.5) * 1.5;
            d.vy = 2 + Math.random() * 2.5;
            d.life = 28;
          }
        }

        // Boundaries — touching floor or ceiling = game over
        if (s.y < -10 || s.y > H - 80) setGameOver(true);

        // Collision
        const dudeLeft   = 60;
        const dudeRight  = 60 + PIXEL * 10;
        const dudeTop    = s.y;
        const dudeBottom = s.y + PIXEL * 11;
        for (const o of s.obstacles) {
          if (dudeRight > o.x && dudeLeft < o.x + o.width) {
            if (dudeTop < o.gapTop || dudeBottom > o.gapBottom) {
              setGameOver(true);
              break;
            }
          }
        }
      }

      // ── Render ──────────────────────────────────────────────────
      // Sky — orange/sunset palette (it's HOT in here)
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#1e1b2e');
      sky.addColorStop(0.5, '#5e2a3e');
      sky.addColorStop(1, '#c97a3b');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Heat shimmer
      for (const sh of s.shimmer) {
        sh.y -= sh.vy;
        if (sh.y < 0) { sh.y = H; sh.x = Math.random() * W; }
        ctx.fillStyle = `rgba(255,180,120,${sh.a})`;
        ctx.fillRect(px(sh.x), px(sh.y), PIXEL, PIXEL);
      }

      // Background pixel grid suggesting horizon distance
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      const scroll = Math.floor(s.score) % (PIXEL * 16);
      for (let x = -scroll; x < W; x += PIXEL * 16) {
        ctx.fillRect(x, H - 60, PIXEL * 2, 60);
      }

      // Floor
      ctx.fillStyle = '#3a1a0a';
      ctx.fillRect(0, H - 24, W, 24);
      ctx.fillStyle = '#5a2a1a';
      ctx.fillRect(0, H - 24, W, PIXEL);

      // Ceiling
      ctx.fillStyle = '#1e0a14';
      ctx.fillRect(0, 0, W, 16);

      // Obstacles — chunky concrete pillars
      for (const o of s.obstacles) {
        const ox = px(o.x);
        // Top pillar
        ctx.fillStyle = '#2d2d3a';
        ctx.fillRect(ox, 0, o.width, o.gapTop);
        ctx.fillStyle = '#4a4a5e';
        ctx.fillRect(ox, o.gapTop - PIXEL, o.width, PIXEL);
        // Bottom pillar
        ctx.fillStyle = '#2d2d3a';
        ctx.fillRect(ox, o.gapBottom, o.width, H - o.gapBottom - 24);
        ctx.fillStyle = '#4a4a5e';
        ctx.fillRect(ox, o.gapBottom, o.width, PIXEL);
      }

      // Sweat droplets — render BEHIND the dude so they trail him
      for (const d of s.droplets) {
        if (d.life <= 0) continue;
        d.x += d.vx;
        d.y += d.vy;
        d.life -= 1;
        const alpha = Math.min(1, d.life / 28);
        ctx.fillStyle = `rgba(180,220,255,${alpha})`;
        ctx.fillRect(px(d.x), px(d.y), PIXEL, PIXEL);
        ctx.fillStyle = `rgba(240,250,255,${alpha * 0.7})`;
        ctx.fillRect(px(d.x), px(d.y), PIXEL / 2, PIXEL / 2);
      }

      // ── The Dude ───────────────────────────────────────────────
      // All blocks aligned to PIXEL grid. Origin at (60, s.y).
      const dx = 60;
      const dy = px(s.y);
      // Body — big round-ish belly (squished oval out of rects)
      const SKIN = '#fde0a3';
      const SKIN_DK = '#d9b070';
      const SHIRT = '#3d6b9c';
      const SHIRT_DK = '#27486b';
      const PANTS = '#1f2937';
      const HAIR = '#3a2a1a';
      const SHOE = '#0a0a14';

      // Belly (largest mass)
      ctx.fillStyle = SHIRT;
      ctx.fillRect(dx,                dy + PIXEL * 3, PIXEL * 10, PIXEL * 5);
      // Belly shading
      ctx.fillStyle = SHIRT_DK;
      ctx.fillRect(dx,                dy + PIXEL * 7, PIXEL * 10, PIXEL);
      ctx.fillRect(dx + PIXEL * 9,    dy + PIXEL * 3, PIXEL,      PIXEL * 5);
      // Belly button hint (shirt fold)
      ctx.fillRect(dx + PIXEL * 5,    dy + PIXEL * 5, PIXEL,      PIXEL);

      // Head — round-ish, big jowls
      ctx.fillStyle = SKIN;
      ctx.fillRect(dx + PIXEL * 2,    dy,             PIXEL * 6, PIXEL * 3);
      ctx.fillRect(dx + PIXEL,        dy + PIXEL,     PIXEL * 8, PIXEL * 2);
      // Jowls (extra cheek width)
      ctx.fillStyle = SKIN_DK;
      ctx.fillRect(dx + PIXEL,        dy + PIXEL * 2, PIXEL,     PIXEL);
      ctx.fillRect(dx + PIXEL * 8,    dy + PIXEL * 2, PIXEL,     PIXEL);
      // Hair tuft (small — mostly bald)
      ctx.fillStyle = HAIR;
      ctx.fillRect(dx + PIXEL * 4,    dy,             PIXEL * 2, PIXEL);
      // Eyes — squinting from effort
      ctx.fillStyle = '#000000';
      ctx.fillRect(dx + PIXEL * 3,    dy + PIXEL,     PIXEL,     PIXEL / 2);
      ctx.fillRect(dx + PIXEL * 6,    dy + PIXEL,     PIXEL,     PIXEL / 2);
      // Mouth — open, panting
      ctx.fillStyle = '#7a1a1a';
      ctx.fillRect(dx + PIXEL * 4,    dy + PIXEL * 2, PIXEL * 2, PIXEL);

      // Arms (short, stubby) — flap with thrust
      const armOffset = thrusting.current ? (s.frame % 8 < 4 ? -PIXEL : 0) : 0;
      ctx.fillStyle = SKIN;
      ctx.fillRect(dx - PIXEL,        dy + PIXEL * 4 + armOffset, PIXEL,     PIXEL * 2);
      ctx.fillRect(dx + PIXEL * 10,   dy + PIXEL * 4 - armOffset, PIXEL,     PIXEL * 2);

      // Pants / legs (tucked under belly)
      ctx.fillStyle = PANTS;
      ctx.fillRect(dx + PIXEL * 2,    dy + PIXEL * 8, PIXEL * 3, PIXEL * 2);
      ctx.fillRect(dx + PIXEL * 5,    dy + PIXEL * 8, PIXEL * 3, PIXEL * 2);
      // Shoes
      ctx.fillStyle = SHOE;
      ctx.fillRect(dx + PIXEL,        dy + PIXEL * 10, PIXEL * 4, PIXEL);
      ctx.fillRect(dx + PIXEL * 5,    dy + PIXEL * 10, PIXEL * 4, PIXEL);

      // Sweat on the head — always there, more visible when thrusting
      ctx.fillStyle = thrusting.current ? '#80c0ff' : '#a0d0ff';
      // Forehead droplet
      ctx.fillRect(dx + PIXEL * 3,    dy + PIXEL / 2, PIXEL / 2, PIXEL);
      // Side droplet
      if (s.frame % 30 < 15) {
        ctx.fillRect(dx + PIXEL * 8,    dy + PIXEL * 2, PIXEL / 2, PIXEL);
      }

      rafId = requestAnimationFrame(renderLoop);
    };
    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [gameStarted, gameOver, highScore, storageKey]);

  return (
    <div className="fixed inset-0 bg-zinc-950/95 backdrop-blur-md z-[110] flex flex-col items-center justify-center select-none touch-none p-4">
      {/* HUD */}
      <div className="w-[360px] max-w-full flex justify-between items-center px-2 mb-4 text-zinc-100 font-mono tracking-tight">
        <div>
          <span className="text-zinc-500 text-xs block uppercase">Distance</span>
          <span className="text-2xl font-black text-orange-300">{distance} <span className="text-sm text-zinc-400">m</span></span>
        </div>
        <div className="text-end">
          <span className="text-zinc-500 text-xs block uppercase">Personal Best</span>
          <span className="text-xl font-bold text-amber-400">{highScore} m</span>
        </div>
      </div>

      {/* Canvas — HOLD to sweat, release to drop */}
      <div
        className="relative overflow-hidden rounded-xl border-2 border-zinc-800 shadow-2xl active:scale-[0.99] transition-transform"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="block max-w-full"
          style={{ imageRendering: 'pixelated' }}
        />

        {!gameStarted && (
          <div className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center text-center p-6 pointer-events-none">
            <h2 className="text-2xl font-black text-zinc-100 tracking-wider uppercase mb-1">Sweat Jetpack</h2>
            <p className="text-zinc-400 text-xs max-w-[260px] mb-6">Hold to sweat. The sweat lifts you. Release to drop. Dodge the pillars.</p>
            <span className="animate-pulse bg-orange-300 text-zinc-950 font-mono text-xs px-4 py-2 font-bold uppercase tracking-widest rounded">Hold to start</span>
          </div>
        )}

        {gameOver && (
          <div className="absolute inset-0 bg-red-950/75 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 pointer-events-none">
            <h2 className="text-3xl font-black text-red-400 tracking-tighter uppercase mb-1">Dehydrated</h2>
            <p className="text-zinc-300 text-xs font-mono mb-4">You made it {distance} m.</p>
            <span className="bg-orange-300 text-zinc-950 font-mono text-xs px-4 py-2 font-bold uppercase rounded">Tap to re-hydrate</span>
          </div>
        )}
      </div>

      <button
        onClick={onClose}
        className="mt-6 px-6 py-2 text-zinc-500 hover:text-zinc-300 text-xs font-mono uppercase tracking-widest transition-colors"
      >
        Close & Cool Off
      </button>
    </div>
  );
}
