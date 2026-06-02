// src/components/workout/PRShareCard.jsx
//
// 1080×1080 PR share card. Triggered from the firePRCelebration toast's
// action button — when a user hits a PR, one tap renders this card
// and opens the native Web Share sheet (Instagram, TikTok, Twitter,
// Messages, etc.) for them to brag.
//
// Pattern intentionally mirrors WorkoutShareCard + WeeklyRecapShareCard:
// pure Canvas 2D (no html2canvas), Web Share API with download fallback,
// same gradient mesh + grid overlay aesthetic. Color rotation: blood-red
// + gold + amber for "I just crushed it" energy, distinct from the
// workout card's purple and the recap card's emerald.

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Share2, Loader2 } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { formatNumber } from '@/lib/intl';

const CANVAS_W = 1080;
const CANVAS_H = 1080;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

/** Draw the PR card. */
function drawCard(ctx, { username, exerciseName, newPR, oldPR, delta, unit, language }) {
  const W = CANVAS_W;
  const H = CANVAS_H;

  // Background — bloody red + black for that "I just lifted heavy" energy.
  // Distinct from the workout card (purple/fuchsia) and the recap card
  // (emerald/cyan).
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0,    '#0f0606');
  bgGrad.addColorStop(0.55, '#251010');
  bgGrad.addColorStop(1,    '#420a0a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Amber accent top-center (crown / spotlight motif).
  const r1 = ctx.createRadialGradient(W * 0.5, H * 0.1, 0, W * 0.5, H * 0.1, W * 0.7);
  r1.addColorStop(0, 'rgba(251, 191, 36, 0.50)');
  r1.addColorStop(1, 'rgba(251, 191, 36, 0)');
  ctx.fillStyle = r1;
  ctx.fillRect(0, 0, W, H);

  // Crimson accent bottom-right.
  const r2 = ctx.createRadialGradient(W * 0.85, H * 0.85, 0, W * 0.85, H * 0.85, W * 0.55);
  r2.addColorStop(0, 'rgba(220, 38, 38, 0.45)');
  r2.addColorStop(1, 'rgba(220, 38, 38, 0)');
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

  // Header band.
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = 'bold 28px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('FLEXYN · NEW PR', 80, 110);

  // Username.
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.font = 'bold 64px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(username || 'Athlete', 80, 220);

  // Exercise label.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 30px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('EXERCISE', 80, 320);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px ui-sans-serif, system-ui, sans-serif';
  // Truncate if longer than the canvas width allows.
  let exDisplay = exerciseName || 'PR';
  while (ctx.measureText(exDisplay).width > W - 160 && exDisplay.length > 4) {
    exDisplay = exDisplay.slice(0, -2) + '…';
  }
  ctx.fillText(exDisplay, 80, 380);

  // The big number — new PR value.
  const newRounded = Math.round(newPR);
  const newStr = formatNumber(newRounded, language);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 30px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('NEW RECORD', 80, 480);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 220px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(newStr, 80, 680);

  // Unit suffix.
  const newWidth = (() => {
    ctx.font = 'bold 220px ui-sans-serif, system-ui, sans-serif';
    return ctx.measureText(newStr).width;
  })();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 60px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(' ' + unit, 80 + newWidth, 680);

  // Delta box — the satisfying "+X" gain.
  if (delta != null && delta > 0) {
    const deltaStr = '+' + formatNumber(Math.round(delta * 10) / 10, language);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.18)';
    roundRect(ctx, 80, 750, W - 160, 130, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
    ctx.stroke();

    ctx.fillStyle = 'rgba(251, 191, 36, 0.85)';
    ctx.font = 'bold 30px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('GAIN', 120, 800);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 64px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${deltaStr} ${unit}`, W - 120, 838);

    ctx.textAlign = 'left'; // restore
  }

  // Footer brand mark.
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = 'bold 24px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('LOG. PROGRESS. LEVEL UP.', W / 2, H - 50);
}

export default function PRShareCard({ open, onClose, pr, unit = 'lb', username }) {
  const { tFallback, language } = useLanguage();
  const canvasRef = useRef(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !pr) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    drawCard(ctx, {
      username:     username || 'Athlete',
      exerciseName: pr.displayName,
      newPR:        pr.newPR,
      oldPR:        pr.oldPR,
      delta:        pr.delta,
      unit,
      language,
    });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const nextUrl = URL.createObjectURL(blob);
      // Revoke the previous URL before swapping to avoid blob-URL
      // accumulation on rapid re-renders.
      setImgUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
    }, 'image/png');
  }, [open, pr, unit, username, language]);

  useEffect(() => {
    return () => { if (imgUrl) URL.revokeObjectURL(imgUrl); };
  }, [imgUrl]);

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
      a.download = `flexyn-pr-${Date.now()}.png`;
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
      const file = new File([blob], `flexyn-pr-${Date.now()}.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          // Fallbacks ensure the share text reads correctly even if `pr`
          // is somehow null (closure race between event + state).
          const exName = pr?.displayName || 'PR';
          const newPRNum = Math.round(pr?.newPR ?? 0);
          await navigator.share({
            files: [file],
            title: 'New PR',
            text: `New PR — ${exName}: ${newPRNum} ${unit}`,
          });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;
        }
      }
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
              {tFallback('pr.share.title', 'Share your PR')}
            </DialogTitle>
          </DialogHeader>

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
                <img loading="lazy" src={imgUrl} alt="PR card" className="w-full block" />
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
              {tFallback('pr.share.download', 'Save image')}
            </Button>
            <Button onClick={handleShare} disabled={busy || !imgUrl} className="flex-1 gap-2">
              <Share2 className="w-4 h-4" />
              {tFallback('pr.share.share', 'Share')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
