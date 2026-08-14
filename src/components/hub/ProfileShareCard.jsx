// src/components/hub/ProfileShareCard.jsx
//
// 1080×1080 profile share card. Renders a user's stat showcase as a
// single image: top-3 lifts + total tonnage + workout streak + their
// 3 most recent workouts. Triggered from the HubProfile (own-profile
// only) so users can brag with one tap.
//
// Pattern: pure Canvas 2D, Web Share API with download fallback —
// same shape as PRShareCard / WorkoutShareCard / WeeklyRecapShareCard.
// Palette: indigo + violet + emerald (distinct from the other three
// share artifacts; emerald draws the eye to the tonnage stat).

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Share2, Loader2 } from 'lucide-react';
import { loadTwemoji } from '@/lib/twemoji';
import { format } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';

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

function drawCard(ctx, { username, topLifts, tonnage, streak, recentWorkouts, unit }, fireIcon = null) {
  const W = CANVAS_W;
  const H = CANVAS_H;

  // Background — indigo → violet → emerald split. Emerald glow in the
  // top-right corner so tonnage (the headline brag stat) catches the
  // eye first.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0,    '#1e1b4b'); // indigo-950
  bg.addColorStop(0.5,  '#3b0764'); // violet-950
  bg.addColorStop(1,    '#022c22'); // emerald-950
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Emerald radial glow top-right
  const glow = ctx.createRadialGradient(W * 0.85, 140, 0, W * 0.85, 140, 380);
  glow.addColorStop(0, 'rgba(16, 185, 129, 0.45)');
  glow.addColorStop(1, 'rgba(16, 185, 129, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid overlay
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let i = 0; i < W; i += 60) ctx.fillRect(i, 0, 1, H);
  for (let i = 0; i < H; i += 60) ctx.fillRect(0, i, W, 1);

  // ── Header ─────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('FLEXYN · ATHLETE CARD', 80, 90);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 72px sans-serif';
  ctx.fillText(`@${username || 'athlete'}`, 80, 180);

  // ── Hero stat — tonnage ────────────────────────────────────────────
  ctx.fillStyle = 'rgba(16, 185, 129, 0.85)';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('TOTAL TONNAGE', 80, 270);

  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 128px sans-serif';
  const tonnageDisplay = tonnage >= 1_000_000
    ? `${(tonnage / 1_000_000).toFixed(1)}M`
    : tonnage >= 1_000
      ? `${Math.round(tonnage / 1000).toLocaleString()}k`
      : `${Math.round(tonnage).toLocaleString()}`;
  ctx.fillText(tonnageDisplay, 80, 400);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(` ${unit}`, 80 + ctx.measureText(tonnageDisplay).width + 12, 396);

  // ── Streak chip ────────────────────────────────────────────────────
  if (streak > 0) {
    const chipX = 80;
    const chipY = 430;
    const chipW = 280;
    const chipH = 56;
    ctx.fillStyle = 'rgba(249, 115, 22, 0.18)';
    roundRect(ctx, chipX, chipY, chipW, chipH, 28);
    ctx.fill();
    ctx.fillStyle = '#fb923c';
    ctx.font = 'bold 28px sans-serif';
    // Draw the flame from BUNDLED Twemoji artwork rather than ctx.fillText('🔥').
    // fillText would bake the device's own emoji font — Apple Color Emoji on
    // iOS — into a PNG we then save and share, i.e. redistributing Apple's
    // proprietary glyphs. If the asset didn't decode we render the text alone;
    // we never fall back to the OS glyph.
    if (fireIcon) {
      ctx.drawImage(fireIcon, chipX + 22, chipY + 14, 28, 28);
      ctx.fillText(`${streak}-day streak`, chipX + 58, chipY + 38);
    } else {
      ctx.fillText(`${streak}-day streak`, chipX + 26, chipY + 38);
    }
  }

  // ── Top lifts ──────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('TOP LIFTS · ESTIMATED 1RM', 80, 560);

  (topLifts || []).slice(0, 3).forEach((lift, i) => {
    const y = 600 + i * 76;
    // Rank chip
    ctx.fillStyle = i === 0 ? '#fbbf24' : i === 1 ? '#cbd5e1' : '#fb923c';
    ctx.beginPath();
    ctx.arc(96, y + 12, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a0a1a';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${i + 1}`, 96, y + 21);
    ctx.textAlign = 'start';
    // Name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(lift.name, 140, y + 22);
    // Value
    ctx.fillStyle = '#a7f3d0';
    ctx.font = 'bold 36px sans-serif';
    const valText = `${Math.round(lift.value)} ${unit}`;
    ctx.textAlign = 'end';
    ctx.fillText(valText, W - 80, y + 22);
    ctx.textAlign = 'start';
  });

  // ── Recent workouts ────────────────────────────────────────────────
  if (recentWorkouts && recentWorkouts.length > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('RECENT WORKOUTS', 80, 870);

    recentWorkouts.slice(0, 3).forEach((w, i) => {
      const y = 910 + i * 44;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(96, y - 8, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '24px sans-serif';
      const title = w.title || 'Workout';
      const date  = w.date  || '';
      ctx.fillText(title.slice(0, 32), 120, y);
      if (date) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'end';
        ctx.fillText(date, W - 80, y);
        ctx.textAlign = 'start';
      }
    });
  }

  // ── Footer ─────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '20px sans-serif';
  ctx.fillText('flexyn.app', 80, H - 50);
}

export default function ProfileShareCard({ open, onClose, profile }) {
  const { tFallback } = useLanguage();
  const canvasRef = useRef(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [busy, setBusy]   = useState(false);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let cancelled = false;
    // Decode the bundled Twemoji flame first so the rasterized card never
    // contains the device's own emoji glyphs. Null on failure — drawCard then
    // renders the streak text without an icon.
    loadTwemoji('fire').then((fireIcon) => {
      if (cancelled) return;
      drawCard(ctx, profile, fireIcon);
      canvas.toBlob((blob) => {
        if (!blob || cancelled) return;
        const url = URL.createObjectURL(blob);
        setImgUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      }, 'image/png', 0.95);
    });
    return () => { cancelled = true; };
  }, [open, profile]);

  useEffect(() => () => {
    if (imgUrl) URL.revokeObjectURL(imgUrl);
  }, [imgUrl]);

  const blobFromCanvas = () => new Promise((resolve) => {
    const c = canvasRef.current;
    if (!c) return resolve(null);
    c.toBlob((b) => resolve(b), 'image/png', 0.95);
  });

  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await blobFromCanvas();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flexyn-profile-${profile?.username || 'athlete'}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  };

  const handleShare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await blobFromCanvas();
      if (!blob) return;
      const file = new File([blob], `flexyn-profile-${Date.now()}.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'My Flexyn stats',
            text: `@${profile?.username || 'athlete'} on Flexyn`,
          });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;
        }
      }
      await handleDownload();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto p-0 gap-0">
        <div className="p-5">
          <DialogHeader className="mb-3">
            <DialogTitle>{tFallback("profileShareCard.shareYourAthleteCard", "Share your athlete card")}</DialogTitle>
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
                <img loading="lazy" src={imgUrl} alt={tFallback("profileShareCard.profileCard", "Profile card")} className="w-full block" />
              </motion.div>
            ) : (
              <div className="aspect-square rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </AnimatePresence>
          <div className="flex gap-2">
            <Button onClick={handleDownload} variant="outline" disabled={busy || !imgUrl} className="flex-1 gap-2">
              <Download className="w-4 h-4" /> {tFallback("common.save", "Save")}
            </Button>
            <Button onClick={handleShare} disabled={busy || !imgUrl} className="flex-1 gap-2">
              <Share2 className="w-4 h-4" /> {tFallback("common.share", "Share")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Helper: build the share-card props from raw data the hub profile
// already has (workout logs + PR index + streak). Pure transform so
// it's easy to test if needed.
export function buildProfileShareProps({ username, logs, topLifts, tonnage, streak, weightUnit }) {
  const unit = weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lb';
  const recentWorkouts = (logs || [])
    .slice(0, 3)
    .map(l => ({
      title: l.regimen_name || 'Workout',
      date:  l.date ? format(new Date(l.date), 'MMM d') : '',
    }));
  return {
    username,
    topLifts: (topLifts || []).map(l => ({
      name: l.name,
      value: l.value,
    })),
    tonnage,
    streak: streak || 0,
    recentWorkouts,
    unit,
  };
}
