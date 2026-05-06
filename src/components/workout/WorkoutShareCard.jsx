// src/components/workout/WorkoutShareCard.jsx
//
// Generates a branded shareable image after a workout. Renders to a hidden
// canvas, then offers Download + Share (uses navigator.share when available,
// falls back to download).
//
// Why canvas: no external libraries, no server, instant.
// The output is a 1080x1080 square (Instagram square / story-friendly).

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Share2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';

const CANVAS_W = 1080;
const CANVAS_H = 1080;

/**
 * Compute headline stats from a workout payload.
 * Same shape Workout.jsx saves: { exercises: [{ name, sets: [{ weight, reps }] }], duration_minutes }.
 */
function computeStats(workout) {
  let totalVolume = 0;
  let totalSets = 0;
  let totalReps = 0;
  let topLift = null;
  for (const ex of workout?.exercises || []) {
    for (const s of ex.sets || []) {
      const w = Number(s.weight) || 0;
      const r = Number(s.reps) || 0;
      totalVolume += w * r;
      if (r > 0) totalSets += 1;
      totalReps += r;
      if (w > 0 && (!topLift || w > topLift.weight)) {
        topLift = { name: ex.name, weight: w, reps: r };
      }
    }
  }
  return {
    totalVolume,
    totalSets,
    totalReps,
    exercises: (workout?.exercises || []).length,
    duration: Number(workout?.duration_minutes) || 0,
    topLift,
  };
}

/** Draw the share card on the given canvas. */
function drawCard(ctx, { username, dateStr, stats }) {
  const W = CANVAS_W;
  const H = CANVAS_H;

  // ── Background — gradient mesh ────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0,    '#0f1117');
  bgGrad.addColorStop(0.55, '#1a1227');
  bgGrad.addColorStop(1,    '#2a0a3f');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Soft radial accent top-right
  const r1 = ctx.createRadialGradient(W * 0.85, H * 0.15, 0, W * 0.85, H * 0.15, W * 0.6);
  r1.addColorStop(0, 'rgba(244, 114, 182, 0.40)');  // fuchsia
  r1.addColorStop(1, 'rgba(244, 114, 182, 0)');
  ctx.fillStyle = r1;
  ctx.fillRect(0, 0, W, H);

  // Soft radial accent bottom-left
  const r2 = ctx.createRadialGradient(W * 0.15, H * 0.85, 0, W * 0.15, H * 0.85, W * 0.55);
  r2.addColorStop(0, 'rgba(124, 58, 237, 0.40)');   // violet
  r2.addColorStop(1, 'rgba(124, 58, 237, 0)');
  ctx.fillStyle = r2;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid overlay
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // ── Header ────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = 'bold 28px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('FLEXYN · WORKOUT COMPLETE', 80, 110);

  // Date
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '24px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - 80, 110);

  // ── Username ──────────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.font = 'bold 64px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(username || 'Athlete', 80, 220);

  // ── Big primary stat: Total Volume ────────────────────────────────────
  const volumeStr = stats.totalVolume > 0
    ? stats.totalVolume.toLocaleString()
    : '—';

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 30px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('TOTAL VOLUME', 80, 320);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 200px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(volumeStr, 80, 490);

  // "lb" suffix
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = 'bold 60px ui-sans-serif, system-ui, sans-serif';
  const volWidth = ctx.measureText(volumeStr).width;
  ctx.font = 'bold 200px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 60px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(' lb', 80 + volWidth, 490);

  // ── Stat row: 3 secondary stats ───────────────────────────────────────
  const statBoxes = [
    { label: 'EXERCISES', value: String(stats.exercises) },
    { label: 'SETS',      value: String(stats.totalSets) },
    { label: 'DURATION',  value: stats.duration > 0 ? `${stats.duration} min` : '—' },
  ];
  const boxW = (W - 160 - 40) / 3; // 80 padding each side, 20 gap × 2
  let boxX = 80;
  const boxY = 580;
  const boxH = 200;
  for (const box of statBoxes) {
    // Card background
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, boxX, boxY, boxW, boxH, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.stroke();

    // Value
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 84px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(box.value, boxX + boxW / 2, boxY + 110);

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(box.label, boxX + boxW / 2, boxY + 160);

    boxX += boxW + 20;
  }

  // ── Top lift highlight (if any) ────────────────────────────────────────
  if (stats.topLift) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 28px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('TOP LIFT', 80, 850);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px ui-sans-serif, system-ui, sans-serif';
    const liftLine = `${stats.topLift.name}: ${stats.topLift.weight} lb × ${stats.topLift.reps}`;
    // Truncate if too wide
    let display = liftLine;
    while (ctx.measureText(display).width > W - 160 && display.length > 10) {
      display = display.slice(0, -4) + '…';
    }
    ctx.fillText(display, 80, 920);
  }

  // ── Footer brand mark ─────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = 'bold 24px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('LOG. PROGRESS. LEVEL UP.', W / 2, H - 60);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

export default function WorkoutShareCard({ open, onClose, workout, username }) {
  const { t } = useLanguage();
  const canvasRef = useRef(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  // Render the card whenever the modal opens with a workout
  useEffect(() => {
    if (!open || !workout) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const stats = computeStats(workout);
    const dateStr = (() => {
      try { return format(new Date(workout.date || Date.now()), 'MMM d, yyyy'); }
      catch { return format(new Date(), 'MMM d, yyyy'); }
    })();
    drawCard(ctx, {
      username: username || 'Athlete',
      dateStr,
      stats,
    });
    // Convert to a stable preview URL
    canvas.toBlob((blob) => {
      if (blob) setImgUrl(URL.createObjectURL(blob));
    }, 'image/png');
  }, [open, workout, username]);

  // Clean up object URL
  useEffect(() => {
    return () => { if (imgUrl) URL.revokeObjectURL(imgUrl); };
  }, [imgUrl]);

  const downloadAsBlob = () => new Promise((resolve) => {
    canvasRef.current?.toBlob((b) => resolve(b), 'image/png');
  });

  const handleDownload = async () => {
    setBusy(true);
    try {
      const blob = await downloadAsBlob();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flexyn-workout-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    setBusy(true);
    try {
      const blob = await downloadAsBlob();
      if (!blob) return;
      const file = new File([blob], `flexyn-workout-${Date.now()}.png`, { type: 'image/png' });
      // Use Web Share API when available with file support
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'My Flexyn workout',
            text: 'Just crushed a workout in Flexyn',
          });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;
          // Fall through to download
        }
      }
      // Fallback: trigger download
      await handleDownload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto p-0 gap-0">
        <div className="p-5">
          <DialogHeader className="mb-3">
            <DialogTitle>
              {t('share.title') === 'share.title' ? 'Share your workout' : t('share.title')}
            </DialogTitle>
          </DialogHeader>

          {/* Hidden full-resolution canvas */}
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ display: 'none' }}
          />

          {/* Preview */}
          <AnimatePresence>
            {imgUrl ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-2xl overflow-hidden border border-border shadow-md mb-4"
              >
                <img src={imgUrl} alt="Workout summary" className="w-full block" />
              </motion.div>
            ) : (
              <div className="aspect-square rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </AnimatePresence>

          <div className="flex gap-2">
            <Button onClick={handleDownload} variant="outline" disabled={busy || !imgUrl} className="flex-1 gap-2">
              <Download className="w-4 h-4" />
              {t('share.download') === 'share.download' ? 'Save image' : t('share.download')}
            </Button>
            <Button onClick={handleShare} disabled={busy || !imgUrl} className="flex-1 gap-2">
              <Share2 className="w-4 h-4" />
              {t('share.share') === 'share.share' ? 'Share' : t('share.share')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 text-center">
            {t('share.hint') === 'share.hint' ? 'Posts to Instagram, TikTok, or download for anywhere else.' : t('share.hint')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
