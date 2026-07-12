// src/components/dashboard/WeeklyRecapShareCard.jsx
//
// Generates a branded shareable image of the user's weekly recap.
// Renders to a hidden 1080×1080 canvas, then offers Download + Share
// (Web Share API when available, falls back to download).
//
// Why this exists: WeeklyRecap.jsx shows the user a beautiful summary
// of their week — but it's locked inside the app. A shareable export
// turns the week-in-review moment into an acquisition surface:
// screenshots posted to Instagram Stories or TikTok carry the FLEXYN
// brand watermark and convert friends/followers into installs.
//
// Pattern intentionally mirrors WorkoutShareCard.jsx — same 1080×1080
// dimensions, same Canvas 2D drawing (no html2canvas dependency), same
// share/download flow. Visual consistency across "moments of share"
// matters more than per-card creativity.

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Share2, Loader2 } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { formatNumber } from '@/lib/intl';

const CANVAS_W = 1080;
const CANVAS_H = 1080;

/** Compact volume display: "8.5k" / "12k" / locale-formatted otherwise. */
function compactVolume(n, language) {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`;
  return formatNumber(n, language);
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

/** Draw the weekly recap share card. */
function drawCard(ctx, { username, weekRangeStr, recap, weightUnit, language }) {
  const W = CANVAS_W;
  const H = CANVAS_H;

  // ── Background gradient ────────────────────────────────────────────────
  // Same palette as WorkoutShareCard so the brand has a unified look
  // across "moment of share" cards. Slight rotation: emerald accent in
  // the bottom-right to differentiate the recap (week in review, growth)
  // from the workout card (purple/fuchsia, intensity).
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0,    '#0f1117');
  bgGrad.addColorStop(0.55, '#0a2120');
  bgGrad.addColorStop(1,    '#0a3a30');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Emerald accent top-right (growth motif).
  const r1 = ctx.createRadialGradient(W * 0.85, H * 0.15, 0, W * 0.85, H * 0.15, W * 0.6);
  r1.addColorStop(0, 'rgba(16, 185, 129, 0.40)');
  r1.addColorStop(1, 'rgba(16, 185, 129, 0)');
  ctx.fillStyle = r1;
  ctx.fillRect(0, 0, W, H);

  // Cyan accent bottom-left.
  const r2 = ctx.createRadialGradient(W * 0.15, H * 0.85, 0, W * 0.15, H * 0.85, W * 0.55);
  r2.addColorStop(0, 'rgba(6, 182, 212, 0.35)');
  r2.addColorStop(1, 'rgba(6, 182, 212, 0)');
  ctx.fillStyle = r2;
  ctx.fillRect(0, 0, W, H);

  // Grid overlay.
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // ── Header band ────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = 'bold 28px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('FLEXYN · WEEK IN REVIEW', 80, 110);

  // Week range, right-aligned.
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '24px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(weekRangeStr, W - 80, 110);

  // ── Username ──────────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.font = 'bold 64px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(username || 'Athlete', 80, 220);

  // ── Hero stat: workouts this week ─────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 30px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('WORKOUTS THIS WEEK', 80, 320);

  const workoutsStr = String(recap?.workouts ?? 0);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 220px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(workoutsStr, 80, 510);

  // Workouts delta (vs last week) appended to the right of the big number.
  const delta = recap?.workoutsDelta ?? 0;
  if (delta !== 0) {
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    const deltaColor = delta > 0 ? 'rgba(16, 185, 129, 0.85)' : 'rgba(244, 63, 94, 0.85)';
    ctx.fillStyle = deltaColor;
    ctx.font = 'bold 48px ui-sans-serif, system-ui, sans-serif';
    const wStrW = (() => {
      ctx.font = 'bold 220px ui-sans-serif, system-ui, sans-serif';
      return ctx.measureText(workoutsStr).width;
    })();
    ctx.font = 'bold 48px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${deltaStr} vs last`, 80 + wStrW + 24, 510);
  }

  // ── Stat row: three secondary boxes ───────────────────────────────────
  const volume = Math.round(fromLbs(recap?.volumeLbs ?? 0, weightUnit));
  const volumeUnit = weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lb';
  const statBoxes = [
    {
      label: 'TOTAL VOLUME',
      value: compactVolume(volume, language),
      suffix: volumeUnit,
    },
    {
      label: 'DAYS ACTIVE',
      value: String(recap?.daysActive ?? 0),
      suffix: '/ 7',
    },
    {
      label: 'NEW PRS',
      value: String(recap?.prs?.length ?? 0),
      suffix: null,
    },
  ];
  const boxW = (W - 160 - 40) / 3; // 80 padding each side, 20 gap × 2
  let boxX = 80;
  const boxY = 600;
  const boxH = 200;
  for (const box of statBoxes) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, boxX, boxY, boxW, boxH, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.stroke();

    // Value (centered)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 76px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(box.value, boxX + boxW / 2, boxY + 105);

    // Suffix (small, below value)
    if (box.suffix) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = 'bold 24px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(box.suffix, boxX + boxW / 2, boxY + 135);
    }

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(box.label, boxX + boxW / 2, boxY + 175);

    boxX += boxW + 20;
  }

  // ── Top lift highlight (when present) ─────────────────────────────────
  if (recap?.bestLift) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 28px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('HEAVIEST LIFT', 80, 870);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px ui-sans-serif, system-ui, sans-serif';
    const liftWeight = Math.round(fromLbs(recap.bestLift.weight, weightUnit));
    const liftLine = `${recap.bestLift.name}: ${liftWeight} ${volumeUnit} × ${recap.bestLift.reps}`;
    // Truncate if too wide for the canvas.
    let display = liftLine;
    while (ctx.measureText(display).width > W - 160 && display.length > 10) {
      display = display.slice(0, -4) + '…';
    }
    ctx.fillText(display, 80, 935);
  }

  // ── Footer brand mark ─────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = 'bold 24px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('LOG. PROGRESS. LEVEL UP.', W / 2, H - 50);
}

export default function WeeklyRecapShareCard({ open, onClose, recap, username }) {
  const { tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const canvasRef = useRef(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [drawFailed, setDrawFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Compute week-range string for the header: "May 16 – May 22"
  const weekRangeStr = (() => {
    try {
      const today = new Date();
      const start = subDays(today, 6);
      return `${format(start, 'MMM d')} – ${format(today, 'MMM d')}`;
    } catch {
      return '';
    }
  })();

  useEffect(() => {
    if (!open || !recap) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Draw synchronously and read the preview back with toDataURL rather
    // than the async toBlob(). toBlob's callback can never fire (it hands
    // back a null blob in some WebViews / when the tab is backgrounded),
    // which left imgUrl null forever and the modal spinning indefinitely.
    // toDataURL is synchronous and universally supported, so the preview
    // is guaranteed to resolve the moment we've drawn. (Download / Share
    // still use toBlob below — those are user-gestured and fall back to a
    // download, so a null there degrades gracefully instead of hanging.)
    try {
      const ctx = canvas.getContext('2d');
      drawCard(ctx, {
        username: username || 'Athlete',
        weekRangeStr,
        recap,
        weightUnit,
        language,
      });
      setImgUrl(canvas.toDataURL('image/png'));
      setDrawFailed(false);
    } catch (err) {
      setDrawFailed(true);
      setImgUrl(null);
      import('@/lib/reportError')
        .then(({ reportError }) => reportError(err, { feature: 'recap.share.draw' }))
        .catch(() => {});
    }
  }, [open, recap, username, weekRangeStr, weightUnit, language]);

  const blobFromCanvas = () => new Promise((resolve) => {
    canvasRef.current?.toBlob((b) => resolve(b), 'image/png');
  });

  const handleDownload = async () => {
    setBusy(true);
    try {
      const blob = await blobFromCanvas();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flexyn-recap-${Date.now()}.png`;
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
      const blob = await blobFromCanvas();
      if (!blob) return;
      const file = new File([blob], `flexyn-recap-${Date.now()}.png`, { type: 'image/png' });
      // Web Share API with file support (modern Chrome / Safari iOS 15+).
      // Safari <15 has navigator.share but NOT navigator.canShare — the
      // file-share attempt throws synchronously there. The full triple-
      // check (share + canShare + canShare({files})) routes those
      // older Safari builds straight to the download fallback below
      // instead of attempting a share that will reject.
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'My Flexyn week',
            text: 'My week in Flexyn',
          });
          return;
        } catch (err) {
          // User cancelled the share sheet — don't auto-fall-through to
          // download in that case. Only fall through on actual errors.
          if (err?.name === 'AbortError') return;
        }
      }
      // Fallback: trigger a download (desktop, older browsers).
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
              {tFallback('recap.share.title', 'Share your week')}
            </DialogTitle>
          </DialogHeader>

          {/* Hidden full-res canvas — output is sampled to an <img> below */}
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ display: 'none' }}
          />

          <AnimatePresence>
            {imgUrl ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-2xl overflow-hidden border border-border shadow-md mb-4"
              >
                {/* aspect-square locks the image to the canvas's
                    1080×1080 ratio so the loading-skeleton sibling
                    (aspect-square below) doesn't make the modal jump
                    in size when the img loads. Previously the img
                    sized itself to its natural width while the
                    skeleton was square — visible reflow on every
                    open. */}
                <img loading="lazy" src={imgUrl} alt="Weekly recap" className="w-full block aspect-square object-cover" />
              </motion.div>
            ) : drawFailed ? (
              <div className="aspect-square rounded-2xl bg-muted flex items-center justify-center mb-4 px-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {tFallback('recap.share.failed', "Couldn't render your recap image. Try reopening this.")}
                </p>
              </div>
            ) : (
              <div className="aspect-square rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </AnimatePresence>

          <div className="flex gap-2">
            <Button onClick={handleDownload} variant="outline" disabled={busy || !imgUrl} className="flex-1 gap-2">
              <Download className="w-4 h-4" />
              {tFallback('recap.share.download', 'Save image')}
            </Button>
            <Button onClick={handleShare} disabled={busy || !imgUrl} className="flex-1 gap-2">
              <Share2 className="w-4 h-4" />
              {tFallback('recap.share.share', 'Share')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 text-center">
            {tFallback('recap.share.hint', 'Posts to Instagram, TikTok, or download for anywhere else.')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
