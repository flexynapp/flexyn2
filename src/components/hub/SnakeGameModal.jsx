// src/components/hub/SnakeGameModal.jsx
//
// Hidden easter-egg Snake game. Surfaced only from the @sean admin
// profile (gated in HubProfile via the 👾 trigger). Lazy-loaded so its
// canvas/game code never enters the entry bundle.
//
// THEME: weight-room reskin of classic Snake. The snake body is a chain
// of metallic weight plates (rings with a dark center cutout); the head
// is amber-tinted. The food is a tiny barbell that spawns on a free cell.
//
// STATE MACHINE (the only legal game states):
//   'ready'      — board drawn, waiting for first input / Start
//   'playing'    — loop advancing on a rAF accumulator
//   'paused'     — frozen, loop suspended (Space / pause button)
//   'game_over'  — collision; frame frozen, overlay shown
//
// HOOK DISCIPLINE: every hook is declared unconditionally at the top of
// the component (no early returns before them) and all mutable per-frame
// game state lives in refs, so the production minified build can't trip a
// TDZ on a const read before its initializer (see CLAUDE.md TDZ note).

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Pause, Play, RotateCcw, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import AnimatedNumber from '@/components/AnimatedNumber';

// ── Board geometry ────────────────────────────────────────────────────
const GRID = 17;             // cells per side
const CELL = 18;             // px per cell (logical)
const SIZE = GRID * CELL;    // 306px square board

// ── Speed / scoring ───────────────────────────────────────────────────
const BASE_INTERVAL = 150;   // ms per step at level 0
const MIN_INTERVAL = 70;     // floor so it stays playable
const STEP_MS_PER_LEVEL = 12;
const FOODS_PER_SPEEDUP = 5; // +1 difficulty level every 5 barbells
const POINTS_PER_FOOD = 10;

// ── Directions (frozen so a stray write can't corrupt the unit vectors) ─
const DIRECTIONS = Object.freeze({
  up:    Object.freeze({ x: 0, y: -1 }),
  down:  Object.freeze({ x: 0, y: 1 }),
  left:  Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

// ── Palette — metallic steel plates + amber barbell ─────────────────────
const PLATE_DARK = '#0f172a';
const PLATE_STEEL = '#64748b';
const PLATE_STEEL_LIGHT = '#cbd5e1';
const BAR_COLOR = '#e2e8f0';
const FOOD_PLATE = '#f59e0b';
const FOOD_COLLAR = '#fbbf24';
// Distinct game signature (metallic + amber) — its own identity, while
// the two-wave burst BEHAVIOR mirrors firePRCelebration.
const CONFETTI_COLORS = ['#94a3b8', '#cbd5e1', '#f59e0b', '#fbbf24', '#e2e8f0', '#fde68a'];

const storageKeyFor = (userId) => `flexyn.snakeHighScore.${userId || 'anon'}`;
const intervalForLevel = (level) => Math.max(MIN_INTERVAL, BASE_INTERVAL - level * STEP_MS_PER_LEVEL);
const randCell = () => Math.floor(Math.random() * GRID);

function spawnFood(snake) {
  // Reject any cell currently occupied by the snake so food never spawns
  // under the body.
  let f;
  let guard = 0;
  do {
    f = { x: randCell(), y: randCell() };
    guard += 1;
  } while (guard < 500 && snake.some((s) => s.x === f.x && s.y === f.y));
  return f;
}

// ── Canvas drawing (module scope — pure, reads only its args) ───────────
function drawPlate(ctx, cell, isHead) {
  const cx = cell.x * CELL + CELL / 2;
  const cy = cell.y * CELL + CELL / 2;
  const r = CELL * 0.46;
  const g = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, r);
  if (isHead) {
    g.addColorStop(0, '#fcd34d');
    g.addColorStop(1, '#d97706');
  } else {
    g.addColorStop(0, PLATE_STEEL_LIGHT);
    g.addColorStop(1, PLATE_STEEL);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = isHead ? '#b45309' : '#475569';
  ctx.stroke();
  // Dark center cutout — the "hole" of the plate.
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = PLATE_DARK;
  ctx.fill();
}

function drawBarbell(ctx, cell) {
  const x = cell.x * CELL;
  const y = cell.y * CELL;
  const cy = y + CELL / 2;
  const ph = CELL * 0.52;
  const pw = CELL * 0.16;
  ctx.save();
  // Bar
  ctx.fillStyle = BAR_COLOR;
  ctx.fillRect(x + CELL * 0.16, cy - 1.5, CELL * 0.68, 3);
  // End plates
  ctx.fillStyle = FOOD_PLATE;
  ctx.fillRect(x + CELL * 0.14, cy - ph / 2, pw, ph);
  ctx.fillRect(x + CELL * 0.70, cy - ph / 2, pw, ph);
  // Inner collars
  ctx.fillStyle = FOOD_COLLAR;
  ctx.fillRect(x + CELL * 0.34, cy - ph * 0.3, pw * 0.7, ph * 0.6);
  ctx.fillRect(x + CELL * 0.60, cy - ph * 0.3, pw * 0.7, ph * 0.6);
  ctx.restore();
}

// Confetti — fires only on a NEW high score. Two-wave burst mirrors the
// firePRCelebration behavior; metallic/amber palette gives it its own
// identity. zIndex sits above the modal (z-[110]).
function fireHighScoreConfetti() {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  try { navigator.vibrate?.([30, 60, 30, 60, 90]); } catch { /* ignore */ }
  import('canvas-confetti')
    .then(({ default: confetti }) => {
      confetti({
        particleCount: 140,
        spread: 90,
        startVelocity: 42,
        origin: { x: 0.5, y: 0.42 },
        colors: CONFETTI_COLORS,
        ticks: 200,
        zIndex: 130,
      });
      setTimeout(() => {
        confetti({
          particleCount: 60,
          spread: 60,
          startVelocity: 30,
          origin: { x: 0.5, y: 0.5 },
          colors: CONFETTI_COLORS,
          zIndex: 130,
        });
      }, 160);
    })
    .catch(() => { /* decorative — skip on load failure */ });
}

export default function SnakeGameModal({ open, onClose, userId }) {
  // ── refs: per-frame mutable game state (never trigger re-render) ──────
  const canvasRef = useRef(null);
  const snakeRef = useRef([]);
  const dirRef = useRef(DIRECTIONS.right);
  const nextDirRef = useRef(DIRECTIONS.right);
  const foodRef = useRef({ x: 0, y: 0 });
  const foodCountRef = useRef(0);
  const levelRef = useRef(0);
  const scoreRef = useRef(0);

  // ── state: render-driving values ─────────────────────────────────────
  const [gameState, setGameState] = useState('ready');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [isNewHigh, setIsNewHigh] = useState(false);
  const [shake, setShake] = useState(false);

  // Load the persisted personal best for this user.
  useEffect(() => {
    try {
      setHighScore(Number(localStorage.getItem(storageKeyFor(userId))) || 0);
    } catch { /* ignore */ }
  }, [userId]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Board background
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Faint grid
    ctx.strokeStyle = 'rgba(148,163,184,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i += 1) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(SIZE, i * CELL); ctx.stroke();
    }
    // Food
    drawBarbell(ctx, foodRef.current);
    // Snake — draw tail→head so the head renders on top at overlaps.
    const snake = snakeRef.current;
    for (let i = snake.length - 1; i >= 0; i -= 1) {
      drawPlate(ctx, snake[i], i === 0);
    }
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
    // Can't start by reversing into the body (snake spawns facing right).
    const safe = dirName === 'left' ? 'right' : dirName;
    const d = DIRECTIONS[safe] || DIRECTIONS.right;
    const mid = Math.floor(GRID / 2);
    const snake = [
      { x: mid, y: mid },
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
    ];
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

    // Wall collision
    if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID) {
      endGame();
      return;
    }
    const ate = head.x === foodRef.current.x && head.y === foodRef.current.y;
    // Self collision — exclude the tail cell when not eating (it moves away).
    const body = ate ? snake : snake.slice(0, snake.length - 1);
    if (body.some((s) => s.x === head.x && s.y === head.y)) {
      endGame();
      return;
    }

    const newSnake = [head, ...snake];
    if (!ate) newSnake.pop();
    snakeRef.current = newSnake;

    if (ate) {
      foodCountRef.current += 1;
      scoreRef.current += POINTS_PER_FOOD;
      setScore(scoreRef.current);
      if (foodCountRef.current % FOODS_PER_SPEEDUP === 0) {
        levelRef.current += 1;
      }
      foodRef.current = spawnFood(newSnake);
    }
    draw();
  }, [draw, endGame]);

  // Main loop — rAF with a time accumulator so speed scales smoothly with
  // levelRef without tearing down/recreating timers each level.
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
      if (acc >= interval) {
        acc %= interval;
        step();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, gameState, step]);

  // On open: reset to a 'ready' board with a static preview snake + food.
  useEffect(() => {
    if (!open) return;
    setGameState('ready');
    setScore(0);
    scoreRef.current = 0;
    setIsNewHigh(false);
    const mid = Math.floor(GRID / 2);
    snakeRef.current = [
      { x: mid, y: mid },
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
    ];
    foodRef.current = { x: mid + 3, y: mid };
    // Draw after the canvas has mounted/painted.
    const id = requestAnimationFrame(() => draw());
    return () => cancelAnimationFrame(id);
  }, [open, draw]);

  const togglePause = useCallback(() => {
    setGameState((s) => {
      if (s === 'playing') return 'paused';
      if (s === 'paused') return 'playing';
      return s;
    });
  }, []);

  const handleDir = useCallback((name) => {
    const nd = DIRECTIONS[name];
    if (!nd) return;
    if (gameState === 'ready' || gameState === 'game_over') {
      startGame(name);
      return;
    }
    if (gameState !== 'playing') return;
    const cur = dirRef.current;
    // Reject a 180° reversal — that's an instant self-collision.
    if (nd.x === -cur.x && nd.y === -cur.y) return;
    nextDirRef.current = nd;
  }, [gameState, startGame]);

  // Keyboard: arrows + WASD steer, Space pauses, Esc closes.
  useEffect(() => {
    if (!open) return undefined;
    const KEY_DIR = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', a: 'left', s: 'down', d: 'right',
      W: 'up', A: 'left', S: 'down', D: 'right',
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

  const dpadBtn =
    'flex items-center justify-center w-12 h-12 rounded-xl bg-secondary/80 border border-border ' +
    'text-foreground active:scale-95 active:bg-primary/20 transition-transform select-none touch-manipulation';

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
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Iron Snake"
            className="relative bg-card border border-border rounded-2xl w-full max-w-[360px] p-4 flex flex-col items-center gap-3"
            style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <span className="text-lg leading-none" aria-hidden="true">👾</span>
                <h3 className="font-heading font-bold text-base">Iron Snake</h3>
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

            {/* Score row */}
            <div className="flex items-center justify-between w-full text-sm">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Score</span>
                <AnimatedNumber value={score} className="font-heading font-bold text-lg tabular-nums" />
              </div>
              <button
                type="button"
                onClick={togglePause}
                disabled={gameState !== 'playing' && gameState !== 'paused'}
                aria-label={gameState === 'paused' ? 'Resume' : 'Pause'}
                className="p-2 rounded-lg bg-secondary/80 border border-border text-foreground disabled:opacity-40 hover:bg-secondary transition-colors"
              >
                {gameState === 'paused'
                  ? <Play className="w-4 h-4" />
                  : <Pause className="w-4 h-4" />}
              </button>
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Trophy className="w-3 h-3 text-amber-500" /> Best
                </span>
                <span className="font-heading font-bold text-lg tabular-nums text-amber-500">{highScore}</span>
              </div>
            </div>

            {/* Board */}
            <motion.div
              animate={shake ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
              transition={{ duration: 0.45 }}
              className="relative rounded-xl overflow-hidden border border-border"
              style={{ width: SIZE, height: SIZE, maxWidth: '100%' }}
            >
              <canvas
                ref={canvasRef}
                width={SIZE * (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1)}
                height={SIZE * (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1)}
                style={{ width: SIZE, height: SIZE, display: 'block' }}
              />

              {/* Ready overlay */}
              {gameState === 'ready' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-[2px]">
                  <p className="text-xs text-muted-foreground px-6 text-center">
                    Collect barbells. Don't hit the walls or your own tail.
                  </p>
                  <button
                    type="button"
                    onClick={() => startGame('right')}
                    className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity"
                  >
                    Start
                  </button>
                  <p className="text-[10px] text-muted-foreground/70">Arrows / WASD / D-pad</p>
                </div>
              )}

              {/* Paused overlay */}
              {gameState === 'paused' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-[2px]">
                  <p className="font-heading font-bold text-lg">Paused</p>
                  <button
                    type="button"
                    onClick={togglePause}
                    className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity flex items-center gap-1.5"
                  >
                    <Play className="w-4 h-4" /> Resume
                  </button>
                </div>
              )}

              {/* Game over overlay */}
              {gameState === 'game_over' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/65 backdrop-blur-[2px]">
                  <p className="font-heading font-bold text-xl">Game Over</p>
                  {isNewHigh ? (
                    <p className="text-sm font-semibold text-amber-400 flex items-center gap-1">
                      <Trophy className="w-4 h-4" /> New personal best!
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Score {score} · Best {highScore}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => startGame('right')}
                    className="mt-1 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4" /> Play again
                  </button>
                </div>
              )}
            </motion.div>

            {/* On-screen D-pad (mobile / touch) */}
            <div className="grid grid-cols-3 grid-rows-3 gap-1.5 w-[156px] select-none">
              <span />
              <button type="button" aria-label="Up" className={dpadBtn} onClick={() => handleDir('up')}>
                <ChevronUp className="w-5 h-5" />
              </button>
              <span />
              <button type="button" aria-label="Left" className={dpadBtn} onClick={() => handleDir('left')}>
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                aria-label={gameState === 'paused' ? 'Resume' : 'Pause'}
                className={dpadBtn}
                onClick={togglePause}
              >
                {gameState === 'paused' ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
              <button type="button" aria-label="Right" className={dpadBtn} onClick={() => handleDir('right')}>
                <ChevronRight className="w-5 h-5" />
              </button>
              <span />
              <button type="button" aria-label="Down" className={dpadBtn} onClick={() => handleDir('down')}>
                <ChevronDown className="w-5 h-5" />
              </button>
              <span />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
