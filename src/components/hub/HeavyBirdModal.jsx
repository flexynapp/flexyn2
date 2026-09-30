// src/components/hub/HeavyBirdModal.jsx
//
// Hidden easter-egg "Heavy Bird" (a swole-pigeon Flappy clone). Surfaced
// only from the @keganbergeron profile (gated in HubProfile, mirroring
// @sean's Iron Snake). Zero-dependency canvas engine — mounted on demand.
//
// Standalone 360×640 design space. Tap to flex (jump), dodge the loaded
// barbell racks, stack 45 lb per pass. Personal best persists per user.

import React, { useEffect, useRef, useState } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

// Ambient white embers drifting up over the blue gym backdrop.
function makeEmbers() {
  return Array.from({ length: 18 }, () => ({
    x: Math.random() * 360,
    y: Math.random() * 640,
    r: Math.random() * 1.6 + 0.5,
    vy: Math.random() * 0.4 + 0.15,
    a: Math.random() * 0.4 + 0.2,
  }));
}

export default function HeavyBirdModal({ onClose, userId, onUnlockCosmetic }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock();
  const canvasRef = useRef(null);
  const storageKey = `flexyn.heavyBirdHighScore.${userId || 'anon'}`;
  const [highScore, setHighScore] = useState(() => {
    try { return Number(localStorage.getItem(storageKey)) || 0; } catch { return 0; }
  });
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [currentWeight, setCurrentWeight] = useState(0);

  // Core physics engine mutables (refs so the rAF loop reads fresh values).
  const state = useRef({
    birdY: 250,
    velocity: 0,
    gravity: 0.38,
    jumpForce: -6.8,
    obstacles: [],
    frameCounter: 0,
    score: 0,
    isFlexing: 0,
    embers: makeEmbers(),
  });

  // A touchstart on mobile is immediately followed by a synthetic mousedown;
  // without this guard a single tap registered two hops. Swallow the
  // mousedown if a real touch fired within the debounce window.
  const lastTouchRef = useRef(0);

  const resetGameState = () => {
    state.current = {
      birdY: 250, velocity: 0, gravity: 0.38, jumpForce: -6.8,
      obstacles: [], frameCounter: 0, score: 0, isFlexing: 0,
      embers: makeEmbers(),
    };
    setGameOver(false);
    setCurrentWeight(0);
  };

  const triggerJump = (e) => {
    if (e) e.preventDefault();
    if (!gameStarted) { setGameStarted(true); return; }
    if (gameOver) { resetGameState(); return; }
    state.current.velocity = state.current.jumpForce;
    state.current.isFlexing = 10;
  };

  const handleTouch = (e) => {
    lastTouchRef.current = Date.now();
    triggerJump(e);
  };

  const handleMouse = (e) => {
    if (Date.now() - lastTouchRef.current < 600) return;
    triggerJump(e);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const renderLoop = () => {
      const s = state.current;
      s.frameCounter += 1;

      // 1. Physics + state mutations
      if (gameStarted && !gameOver) {
        s.velocity += s.gravity;
        s.birdY += s.velocity;
        if (s.isFlexing > 0) s.isFlexing -= 1;

        if (s.frameCounter % 110 === 0) {
          const gapY = Math.floor(Math.random() * (400 - 180)) + 120;
          s.obstacles.push({
            x: 360, gapTop: gapY - 67, gapBottom: gapY + 68,
            passed: false, width: 24, plateWidth: 60,
          });
        }

        for (let i = s.obstacles.length - 1; i >= 0; i -= 1) {
          const obs = s.obstacles[i];
          obs.x -= 2.2;
          if (!obs.passed && obs.x + obs.width < 50) {
            obs.passed = true;
            s.score += 45;
            setCurrentWeight(s.score);
            if (s.score > highScore) {
              setHighScore(s.score);
              try { localStorage.setItem(storageKey, String(s.score)); } catch { /* ignore */ }
            }
            if (s.score === 315 && onUnlockCosmetic) onUnlockCosmetic('HEAVY_BIRD_315_CLUB');
          }
          if (obs.x < -60) s.obstacles.splice(i, 1);
        }

        if (s.birdY > 580 || s.birdY < 0) setGameOver(true);
      }

      // 2. Rendering
      ctx.clearRect(0, 0, 360, 640);
      const sky = ctx.createLinearGradient(0, 0, 0, 640);
      sky.addColorStop(0, '#0a2a5e');
      sky.addColorStop(1, '#071a3a');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 360, 640);

      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x < 360; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 640); ctx.stroke();
      }

      // Ambient white embers drifting upward.
      for (const em of s.embers) {
        em.y -= em.vy;
        if (em.y < -4) { em.y = 644; em.x = Math.random() * 360; }
        ctx.beginPath();
        ctx.arc(em.x, em.y, em.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${em.a})`;
        ctx.fill();
      }

      s.obstacles.forEach((obs) => {
        ctx.fillStyle = '#71717a';
        ctx.fillRect(obs.x, 0, obs.width, obs.gapTop);
        ctx.fillRect(obs.x, obs.gapBottom, obs.width, 640 - obs.gapBottom);

        ctx.fillStyle = '#09090b';
        ctx.strokeStyle = '#a1a1aa';
        ctx.lineWidth = 2;
        const px = obs.x - (obs.plateWidth - obs.width) / 2;
        ctx.fillRect(px, obs.gapTop - 24, obs.plateWidth, 24);
        ctx.strokeRect(px, obs.gapTop - 24, obs.plateWidth, 24);
        ctx.fillRect(px, obs.gapBottom, obs.plateWidth, 24);
        ctx.strokeRect(px, obs.gapBottom, obs.plateWidth, 24);

        if (gameStarted && !gameOver) {
          const birdLeft = 50;
          const birdRight = 84;
          const birdTop = s.birdY;
          const birdBottom = s.birdY + 34;
          const obsLeft = obs.x;
          const obsRight = obs.x + obs.width;
          if (birdRight > obsLeft && birdLeft < obsRight) {
            if (birdTop < obs.gapTop || birdBottom > obs.gapBottom) setGameOver(true);
          }
        }
      });

      // Floor
      ctx.fillStyle = '#06142e';
      ctx.fillRect(0, 580, 360, 60);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0, 580, 360, 4);

      // Swole pigeon
      ctx.save();
      ctx.translate(67, s.birdY + 17);
      const tilt = Math.min(Math.max(s.velocity * 0.05, -0.4), 0.7);
      ctx.rotate(tilt);
      if (s.isFlexing > 0) {
        ctx.fillStyle = '#fdba74';
        ctx.fillRect(-17, -17, 34, 34);
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(-27, -12, 10, 14);
        ctx.fillRect(17, -12, 10, 14);
        ctx.fillStyle = '#000000';
        ctx.fillRect(6, -8, 4, 4);
      } else {
        ctx.fillStyle = '#f97316';
        ctx.fillRect(-17, -17, 34, 34);
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.moveTo(17, -4); ctx.lineTo(25, 0); ctx.lineTo(17, 4);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(4, -8, 5, 5);
      }
      ctx.restore();

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [gameStarted, gameOver, highScore, onUnlockCosmetic, storageKey]);

  return (
    <div className="fixed inset-0 bg-zinc-950/95 backdrop-blur-md z-[110] flex flex-col items-center justify-center select-none touch-none p-4">
      {/* Status dashboard */}
      <div className="w-[360px] max-w-full flex justify-between items-center px-2 mb-4 text-zinc-100 font-mono tracking-tight">
        <div>
          <span className="text-zinc-500 text-xs block uppercase">{tFallback("heavyBirdModal.currentLoad", "Current Load")}</span>
          <span className="text-2xl font-black text-success">{currentWeight} <span className="text-sm text-zinc-400">lbs</span></span>
        </div>
        <div className="text-end">
          <span className="text-zinc-500 text-xs block uppercase">{tFallback("gauntlet.type.pr", "Personal Record")}</span>
          <span className="text-xl font-bold text-primary">{highScore} lbs</span>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="relative overflow-hidden rounded-xl border-2 border-zinc-800 shadow-2xl active:scale-[0.99] transition-transform"
        onTouchStart={handleTouch}
        onMouseDown={handleMouse}
      >
        <canvas ref={canvasRef} width="360" height="640" className="block max-w-full" />

        {!gameStarted && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-center p-6 pointer-events-none">
            <h2 className="text-2xl font-black text-zinc-100 tracking-wide mb-1">{tFallback("heavyBirdModal.gainzBird", "Gainz Bird")}</h2>
            <p className="text-zinc-400 text-xs max-w-[240px] mb-6">{tFallback('heavyBird.howTo', 'Tap to contract biceps, dodge heavy racks, and stack plates.')}</p>
            <span className="animate-pulse bg-zinc-100 text-zinc-950 font-mono text-xs px-4 py-2 font-bold uppercase tracking-widest rounded">{tFallback("heavyBirdModal.tapToLift", "Tap to lift")}</span>
          </div>
        )}

        {gameOver && (
          <div className="absolute inset-0 bg-red-950/70 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 pointer-events-none">
            <h2 className="text-3xl font-black text-destructive tracking-tight mb-1">Misfire / Fatigue</h2>
            <p className="text-zinc-300 text-xs font-mono mb-4">You got crushed at {currentWeight} lbs.</p>
            <span className="bg-zinc-100 text-zinc-950 font-mono text-xs px-4 py-2 font-bold uppercase rounded">{tFallback("heavyBirdModal.tapToReRack", "Tap to Re-rack")}</span>
          </div>
        )}
      </div>

      <button
        onClick={onClose}
        className="mt-6 px-6 py-2 text-zinc-500 hover:text-zinc-300 active:text-zinc-300 text-xs font-mono uppercase tracking-widest transition-colors"
      >
        {tFallback('heavyBirdModal.closeResumeLog', 'Close & Resume Log')}
      </button>
    </div>
  );
}
