// src/components/hub/SnakeGameModal.jsx
//
// Hidden easter-egg Snake game. Surfaced only from the @sean admin
// profile (gated in HubProfile). Lazy-loaded so its canvas/game code
// never enters the entry/Hub bundles for everyone else.
//
// THEME: retro arcade. A chrome "iron" snake rendered as ONE solid
// rounded line that grows, collecting gold coins, over a soft purple
// space backdrop with drifting embers. Title/score use a pixel font.
//
// STATE MACHINE (only legal states):
//   'ready' | 'playing' | 'paused' | 'game_over'
//
// HOOK DISCIPLINE: every hook is declared unconditionally at the top of
// the component; all per-frame mutable game state lives in refs, so the
// minified production build can't trip a TDZ on a const read before its
// initializer (see CLAUDE.md TDZ note).

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Pause, Play, RotateCcw, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import AnimatedNumber from '@/components/AnimatedNumber';

// ── Board geometry ────────────────────────────────────────────────────
const GRID = 17;
const CELL = 18;
const SIZE = GRID * CELL; // 306px square

// ── Speed / scoring ───────────────────────────────────────────────────
const BASE_INTERVAL = 150;
const MIN_INTERVAL = 70;
const STEP_MS_PER_LEVEL = 12;
const FOODS_PER_SPEEDUP = 5;
const POINTS_PER_FOOD = 10;

// ── Directions (frozen so a stray write can't corrupt the vectors) ──────
const DIRECTIONS = Object.freeze({
  up:    Object.freeze({ x: 0, y: -1 }),
  down:  Object.freeze({ x: 0, y: 1 }),
  left:  Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

// Confetti — metallic + gold signature; two-wave burst mirrors
// firePRCelebration's behavior. Fires only on a new high score.
const CONFETTI_COLORS = ['#cbd5e1', '#e2e8f0', '#f59e0b', '#fbbf24', '#a855f7', '#fde68a'];

const storageKeyFor = (userId) => `flexyn.snakeHighScore.${userId || 'anon'}`;
const intervalForLevel = (level) => Math.max(MIN_INTERVAL, BASE_INTERVAL - level * STEP_MS_PER_LEVEL);
const randCell = () => Math.floor(Math.random() * GRID);
const cellCenter = (c) => ({ x: c.x * CELL + CELL / 2, y: c.y * CELL + CELL / 2 });

function spawnFood(snake) {
  let f;
  let guard = 0;
  do {
    f = { x: randCell(), y: randCell() };
    guard += 1;
  } while (guard < 500 && snake.some((s) => s.x === f.x && s.y === f.y));
  return f;
}

// ── Canvas drawing (pure; reads only its args) ──────────────────────────
function drawCoin(ctx, cell) {
  const { x: cx, y: cy } = cellCenter(cell);
  const r = CELL * 0.4;
  ctx.save();
  ctx.shadowColor = 'rgba(245,158,11,0.6)';
  ctx.shadowBlur = 8;
  // Coin body
  const g = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, r);
  g.addColorStop(0, '#fde68a');
  g.addColorStop(0.6, '#f59e0b');
  g.addColorStop(1, '#b45309');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  // Rim
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#92400e';
  ctx.stroke();
  // Inner ring
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(146,64,14,0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Embossed star
  ctx.fillStyle = '#fef3c7';
  const spikes = 5;
  const outer = r * 0.4;
  const inner = r * 0.17;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i += 1) {
    const rad = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  // Shine highlight
  ctx.beginPath();
  ctx.arc(cx - r * 0.32, cy - r * 0.34, r * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  ctx.restore();
}

// Draw the snake as a single continuous rounded chrome line.
function drawSnake(ctx, snake, dir) {
  if (!snake.length) return;
  const pts = snake.map(cellCenter);

  // Outer body line with a soft cyan-white glow.
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(186,230,253,0.5)';
  ctx.shadowBlur = 7;
  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  grad.addColorStop(0, '#f1f5f9');
  grad.addColorStop(1, '#94a3b8');
  ctx.strokeStyle = grad;
  ctx.lineWidth = CELL * 0.74;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, CELL * 0.37, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  } else {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  }
  ctx.restore();

  // Inner highlight ridge — gives the tube a metallic spine.
  if (pts.length > 1) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(248,250,252,0.55)';
    ctx.lineWidth = CELL * 0.26;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();
  }

  // Head knob + eyes (oriented by travel direction).
  const head = pts[0];
  ctx.beginPath();
  ctx.arc(head.x, head.y, CELL * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = '#e2e8f0';
  ctx.fill();
  const perp = { x: -dir.y, y: dir.x };
  const fwd = CELL * 0.1;
  const side = CELL * 0.17;
  [-1, 1].forEach((s) => {
    const ex = head.x + dir.x * fwd + perp.x * side * s;
    const ey = head.y + dir.y * fwd + perp.y * side * s;
    ctx.beginPath();
    ctx.arc(ex, ey, CELL * 0.11, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
  });
}

function fireHighScoreConfetti() {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  try { navigator.vibrate?.([30, 60, 30, 60, 90]); } catch { /* ignore */ }
  import('canvas-confetti')
    .then(({ default: confetti }) => {
      confetti({ particleCount: 140, spread: 90, startVelocity: 42, origin: { x: 0.5, y: 0.42 }, colors: CONFETTI_COLORS, ticks: 200, zIndex: 130 });
      setTimeout(() => confetti({ particleCount: 60, spread: 60, startVelocity: 30, origin: { x: 0.5, y: 0.5 }, colors: CONFETTI_COLORS, zIndex: 130 }), 160);
    })
    .catch(() => { /* decorative — skip */ });
}

export default function SnakeGameModal({ open, onClose, userId }) {
  const canvasRef = useRef(null);
  const snakeRef = useRef([]);
  const dirRef = useRef(DIRECTIONS.right);
  const nextDirRef = useRef(DIRECTIONS.right);
  const foodRef = useRef({ x: 0, y: 0 });
  const foodCountRef = useRef(0);
  const levelRef = useRef(0);
  const scoreRef = useRef(0);

  const [gameState, setGameState] = useState('ready');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [isNewHigh, setIsNewHigh] = useState(false);
  const [shake, setShake] = useState(false);

  // Ambient space layer — purple embers + faint stars (decorative).
  const embers = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    size: Math.random() * 2.5 + 1.5,
    color: ['#a855f7', '#c084fc', '#7c3aed', '#d8b4fe'][i % 4],
    duration: Math.random() * 5 + 4,
    delay: Math.random() * 6,
    drift: (Math.random() - 0.5) * 30,
  })), []);
  const stars = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 1.6 + 0.6,
    duration: Math.random() * 3 + 2,
    delay: Math.random() * 4,
  })), []);

  useEffect(() => {
    try { setHighScore(Number(localStorage.getItem(storageKeyFor(userId))) || 0); } catch { /* ignore */ }
  }, [userId]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Transparent — the DOM space layer behind shows through.
    ctx.clearRect(0, 0, SIZE, SIZE);
    // Faint purple grid
    ctx.strokeStyle = 'rgba(168,139,250,0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i += 1) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(SIZE, i * CELL); ctx.stroke();
    }
    drawCoin(ctx, foodRef.current);
    drawSnake(ctx, snakeRef.current, dirRef.current);
  }, []);

  const endGame = useCallback(() => {
    setGameState('game_over');
    setShake(true);
    setTimeout(() => setShake(false), 450);
    const finalScore = scoreRef.current;
    setHighScore((prev) => {
      if (finalScore > prev) {
        try { localStorage.setItem(storageKeyFor(userId), String(finalScore)); } catch { /* ignore */ }
        setIsNewHigh(true);
        fireHighScoreConfetti();
        return finalScore;
      }
      return prev;
    });
  }, [userId]);

  const startGame = useCallback((dirName = 'right') => {
    const safe = dirName === 'left' ? 'right' : dirName;
    const d = DIRECTIONS[safe] || DIRECTIONS.right;
    const mid = Math.floor(GRID / 2);
    const snake = [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }];
    snakeRef.current = snake;
    dirRef.current = d;
    nextDirRef.current = d;
    foodRef.current = spawnFood(snake);
    foodCountRef.current = 0;
    levelRef.current = 0;
    scoreRef.current = 0;
    setScore(0);
    setIsNewHigh(false);
    setGameState('playing');
  }, []);

  const step = useCallback(() => {
    const dir = nextDirRef.current;
    dirRef.current = dir;
    const snake = snakeRef.current;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID) { endGame(); return; }
    const ate = head.x === foodRef.current.x && head.y === foodRef.current.y;
    const body = ate ? snake : snake.slice(0, snake.length - 1);
    if (body.some((s) => s.x === head.x && s.y === head.y)) { endGame(); return; }
    const newSnake = [head, ...snake];
    if (!ate) newSnake.pop();
    snakeRef.current = newSnake;
    if (ate) {
      foodCountRef.current += 1;
      scoreRef.current += POINTS_PER_FOOD;
      setScore(scoreRef.current);
      if (foodCountRef.current % FOODS_PER_SPEEDUP === 0) levelRef.current += 1;
      foodRef.current = spawnFood(newSnake);
    }
    draw();
  }, [draw, endGame]);

  useEffect(() => {
    if (!open || gameState !== 'playing') return undefined;
    let raf = 0;
    let last = 0;
    let acc = 0;
    const loop = (ts) => {
      raf = requestAnimationFrame(loop);
      if (!last) { last = ts; return; }
      acc += ts - last;
      last = ts;
      const interval = intervalForLevel(levelRef.current);
      if (acc >= interval) { acc %= interval; step(); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, gameState, step]);

  useEffect(() => {
    if (!open) return undefined;
    setGameState('ready');
    setScore(0);
    scoreRef.current = 0;
    setIsNewHigh(false);
    const mid = Math.floor(GRID / 2);
    snakeRef.current = [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }];
    dirRef.current = DIRECTIONS.right;
    foodRef.current = { x: mid + 4, y: mid };
    const id = requestAnimationFrame(() => draw());
    return () => cancelAnimationFrame(id);
  }, [open, draw]);

  const togglePause = useCallback(() => {
    setGameState((s) => (s === 'playing' ? 'paused' : s === 'paused' ? 'playing' : s));
  }, []);

  const handleDir = useCallback((name) => {
    const nd = DIRECTIONS[name];
    if (!nd) return;
    if (gameState === 'ready' || gameState === 'game_over') { startGame(name); return; }
    if (gameState !== 'playing') return;
    const cur = dirRef.current;
    if (nd.x === -cur.x && nd.y === -cur.y) return; // no 180° reversal
    nextDirRef.current = nd;
  }, [gameState, startGame]);

  useEffect(() => {
    if (!open) return undefined;
    const KEY_DIR = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', a: 'left', s: 'down', d: 'right', W: 'up', A: 'left', S: 'down', D: 'right',
    };
    const onKey = (e) => {
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); togglePause(); return; }
      if (e.key === 'Escape') { onClose?.(); return; }
      const dir = KEY_DIR[e.key];
      if (dir) { e.preventDefault(); handleDir(dir); }
    };
    window.addEventListener('keydown', onKey, { passive: false });
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleDir, togglePause, onClose]);

  // ── Game Boy D-pad pieces ─────────────────────────────────────────────
  const dpadArm =
    'absolute flex items-center justify-center text-slate-400 active:bg-white/10 ' +
    'transition-colors touch-manipulation focus:outline-none';
  const crossBar = {
    background: 'linear-gradient(145deg,#3a4252,#11151d)',
    boxShadow: 'inset 0 2px 2px rgba(255,255,255,0.08), inset 0 -4px 6px rgba(0,0,0,0.55), 0 3px 6px rgba(0,0,0,0.45)',
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          onClick={onClose}
          role="presentation"
        >
          {/* Pixel font — loaded only while the game is open. */}
          <style>{"@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap'); .snake-pixel{font-family:'Press Start 2P',ui-monospace,monospace;}"}</style>

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Iron Snake"
            className="relative bg-card border border-border rounded-2xl w-full max-w-[360px] p-4 flex flex-col items-center gap-4"
            style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <span className="text-lg leading-none" aria-hidden="true">👾</span>
                <h3 className="snake-pixel text-[13px] leading-none">Iron Snake</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-1 rounded-md text-muted-foreground hover:bg-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Score row — no pause here (it lives in the D-pad center) */}
            <div className="flex items-end justify-between w-full">
              <div className="flex flex-col gap-1.5">
                <span className="snake-pixel text-[8px] text-muted-foreground leading-none">SCORE</span>
                <AnimatedNumber value={score} className="snake-pixel text-[16px] text-foreground leading-none tabular-nums" />
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className="snake-pixel text-[8px] text-amber-500 leading-none flex items-center gap-1">
                  <Trophy className="w-3 h-3" /> BEST
                </span>
                <span className="snake-pixel text-[16px] text-amber-500 leading-none tabular-nums">{highScore}</span>
              </div>
            </div>

            {/* Board */}
            <motion.div
              animate={shake ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
              transition={{ duration: 0.45 }}
              className="relative rounded-xl overflow-hidden border border-purple-500/20"
              style={{ width: SIZE, height: SIZE, maxWidth: '100%' }}
            >
              {/* Space backdrop */}
              <div
                className="absolute inset-0"
                style={{ background: 'radial-gradient(circle at 50% 38%, #241a40 0%, #0c0818 62%, #050208 100%)' }}
              />
              {/* Stars */}
              {stars.map((s) => (
                <motion.span
                  key={`star-${s.id}`}
                  className="absolute rounded-full bg-white pointer-events-none"
                  style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size }}
                  animate={{ opacity: [0.15, 0.7, 0.15] }}
                  transition={{ duration: s.duration, repeat: Infinity, delay: s.delay, ease: 'easeInOut' }}
                />
              ))}
              {/* Purple embers */}
              {embers.map((e) => (
                <motion.span
                  key={`ember-${e.id}`}
                  className="absolute rounded-full pointer-events-none"
                  style={{ left: `${e.x}%`, bottom: -6, width: e.size, height: e.size, background: e.color, filter: 'blur(0.4px)' }}
                  animate={{ y: [0, -SIZE * 0.9], x: [0, e.drift], opacity: [0, 0.6, 0] }}
                  transition={{ duration: e.duration, repeat: Infinity, delay: e.delay, ease: 'easeOut' }}
                />
              ))}

              <canvas
                ref={canvasRef}
                width={SIZE * (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1)}
                height={SIZE * (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1)}
                className="relative z-10"
                style={{ width: SIZE, height: SIZE, display: 'block' }}
              />

              {/* Overlays */}
              {gameState === 'ready' && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/45 backdrop-blur-[2px]">
                  <p className="text-xs text-slate-300 px-6 text-center">Collect coins. Don't hit the walls or your own tail.</p>
                  <button type="button" onClick={() => startGame('right')} className="snake-pixel text-[11px] px-5 py-3 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity leading-none">START</button>
                  <p className="text-[10px] text-slate-400">Arrows / WASD / D-pad</p>
                </div>
              )}
              {gameState === 'paused' && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-[2px]">
                  <p className="snake-pixel text-base text-white leading-none">PAUSED</p>
                  <button type="button" onClick={togglePause} className="snake-pixel text-[10px] px-5 py-3 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-1.5 leading-none">
                    <Play className="w-3.5 h-3.5" /> RESUME
                  </button>
                </div>
              )}
              {gameState === 'game_over' && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/60 backdrop-blur-[2px]">
                  <p className="snake-pixel text-base text-white leading-tight text-center">GAME<br />OVER</p>
                  {isNewHigh ? (
                    <p className="text-sm font-semibold text-amber-400 flex items-center gap-1"><Trophy className="w-4 h-4" /> New best!</p>
                  ) : (
                    <p className="text-xs text-slate-300">Score {score} · Best {highScore}</p>
                  )}
                  <button type="button" onClick={() => startGame('right')} className="snake-pixel text-[10px] mt-1 px-5 py-3 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-1.5 leading-none">
                    <RotateCcw className="w-3.5 h-3.5" /> AGAIN
                  </button>
                </div>
              )}
            </motion.div>

            {/* Game Boy D-pad */}
            <div className="relative" style={{ width: 150, height: 150 }}>
              {/* Connected plus base */}
              <div className="absolute rounded-[14px]" style={{ left: 50, top: 0, width: 50, height: 150, ...crossBar }} />
              <div className="absolute rounded-[14px]" style={{ left: 0, top: 50, width: 150, height: 50, ...crossBar }} />
              {/* subtle center dish */}
              <div className="absolute rounded-full" style={{ left: 54, top: 54, width: 42, height: 42, background: 'radial-gradient(circle at 50% 40%, #2a3140, #0c1018)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6)' }} />

              {/* Direction arms */}
              <button type="button" aria-label="Up"    className={`${dpadArm} rounded-t-[14px]`} style={{ left: 50, top: 0, width: 50, height: 50 }} onClick={() => handleDir('up')}>
                <ChevronUp className="w-6 h-6" />
              </button>
              <button type="button" aria-label="Down"  className={`${dpadArm} rounded-b-[14px]`} style={{ left: 50, top: 100, width: 50, height: 50 }} onClick={() => handleDir('down')}>
                <ChevronDown className="w-6 h-6" />
              </button>
              <button type="button" aria-label="Left"  className={`${dpadArm} rounded-l-[14px]`} style={{ left: 0, top: 50, width: 50, height: 50 }} onClick={() => handleDir('left')}>
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button type="button" aria-label="Right" className={`${dpadArm} rounded-r-[14px]`} style={{ left: 100, top: 50, width: 50, height: 50 }} onClick={() => handleDir('right')}>
                <ChevronRight className="w-6 h-6" />
              </button>

              {/* Center pause (the only pause control) */}
              <button
                type="button"
                aria-label={gameState === 'paused' ? 'Resume' : 'Pause'}
                onClick={togglePause}
                className="absolute rounded-full flex items-center justify-center text-slate-300 active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                style={{ left: 55, top: 55, width: 40, height: 40 }}
              >
                {gameState === 'paused' ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
