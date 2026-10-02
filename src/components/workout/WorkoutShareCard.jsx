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
import { Download, Share2, Loader2, Trophy, Zap } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { formatDate } from '@/lib/intl';
import { asT } from '@/lib/translatorArg';
import { canvasFont, canvasFontsReady } from '@/lib/canvasFont';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { formatNumber } from '@/lib/intl';
import { totalVolume as computeTotalVolume } from '@/lib/workoutVolume';
import { workoutDurationMin } from '@/lib/workoutDuration';
import { workoutCardioTotals } from '@/lib/data/workoutCardio';
import { metersTo } from '@/lib/distanceUnit';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { track, EVENTS } from '@/lib/analytics';
import { shareCardHost, shareCardLink } from '@/lib/appOrigin';

const CANVAS_W = 1080;
const CANVAS_H = 1080;

/**
 * Compute headline stats from a workout payload.
 * Same shape Workout.jsx saves: { exercises: [{ name, sets: [{ weight, reps }] }], duration_minutes }.
 */
function computeStats(workout, opts = {}) {
  // Volume now flows through the same workoutVolume helper that the
  // live pill, save path, and Saved Workouts list use — including the
  // include_bar_in_volume preference. Previously the share card used
  // inline `w * r` and showed a smaller number than the pill for
  // bar-included users. (Audit 09 #L-1.)
  let totalSets = 0;
  let totalReps = 0;
  let topLift = null;
  // A run logged in the workout is not a lift: it has no sets and must not
  // count as an exercise. Its time and distance are reported on their own.
  const lifts = (workout?.exercises || []).filter((ex) => ex?.kind !== 'cardio');
  const cardio = workoutCardioTotals(workout?.exercises);
  for (const ex of lifts) {
    for (const s of ex.sets || []) {
      const w = Number(s.weight) || 0;
      const r = Number(s.reps) || 0;
      if (r > 0) totalSets += 1;
      totalReps += r;
      if (w > 0 && (!topLift || w > topLift.weight)) {
        topLift = { name: ex.name, weight: w, reps: r };
      }
    }
  }
  return {
    totalVolume: computeTotalVolume(lifts, opts),
    totalSets,
    totalReps,
    exercises: lifts.length,
    // A run-only session with no stated duration still took the run's time.
    duration: workoutDurationMin(workout) || Math.round(cardio.seconds / 60),
    cardioMeters: cardio.meters,
    cardioCount: cardio.count,
    topLift,
  };
}

/** Draw the share card on the given canvas. */
// `t` is the caller's tFallback: a canvas painter cannot call useLanguage().
// FLEXYN stays English (brand). The footer is the app's address, so
// whoever sees the card can find the app; it is not copy to translate. Labels are keyed.
function drawCard(ctx, { username, dateStr, stats, language, t }) {
  const tf = asT(t);
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
  ctx.font = canvasFont('bold 28px');
  ctx.textAlign = 'left';
  ctx.fillText(tf('shareCard.workoutComplete', 'FLEXYN · WORKOUT COMPLETE'), 80, 110);

  // Date
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = canvasFont('24px');
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - 80, 110);

  // ── Username ──────────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.font = canvasFont('bold 64px');
  ctx.fillText(username || 'Athlete', 80, 220);

  // A run-only session has no volume, sets or exercises to report, so the
  // card leads with the run instead of "TOTAL VOLUME —" over "0 EXERCISES"
  // and "0 SETS". Same pair the on-screen FinishStats shows.
  // Runs and nothing else, with or without a distance (a pool swim or a
  // treadmill session may carry only a time).
  const runOnly = stats.exercises === 0 && stats.cardioCount > 0;
  if (runOnly) drawRunStats(ctx, { stats, tf, W });
  else drawLiftStats(ctx, { stats, language, tf, W });

  // ── Top lift highlight (if any), else the distance of a run ────────────
  // A run-only card already leads with its distance.
  if (!runOnly && !stats.topLift && stats.cardioMeters > 0) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = canvasFont('bold 28px');
    ctx.fillText(tf('cardio.field.distance', 'Distance').toUpperCase(), 80, 850);
    ctx.fillStyle = '#ffffff';
    ctx.font = canvasFont('bold 56px');
    ctx.fillText(stats.cardioDistance, 80, 920);
  }
  if (stats.topLift) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = canvasFont('bold 28px');
    ctx.fillText(tf('shareCard.topLift', 'TOP LIFT'), 80, 850);

    ctx.fillStyle = '#ffffff';
    ctx.font = canvasFont('bold 56px');
    const liftUnit = stats.unit === 'kg' ? 'kg' : stats.unit === 'stone' ? 'st' : 'lb';
    const liftLine = `${stats.topLift.name}: ${stats.topLift.weight} ${liftUnit} × ${stats.topLift.reps}`;
    // Truncate if too wide
    let display = liftLine;
    while (ctx.measureText(display).width > W - 160 && display.length > 10) {
      display = display.slice(0, -4) + '…';
    }
    ctx.fillText(display, 80, 920);
  }

  // ── Footer brand mark ─────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = canvasFont('bold 24px');
  ctx.textAlign = 'center';
  ctx.fillText(shareCardHost(), W / 2, H - 60);
}

function drawLiftStats(ctx, { stats, language, tf, W }) {
  // ── Big primary stat: Total Volume ────────────────────────────────────
  const volumeStr = stats.totalVolume > 0
    ? formatNumber(stats.totalVolume, language)
    : '—';

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = canvasFont('bold 30px');
  ctx.fillText(tf('shareCard.totalVolume', 'TOTAL VOLUME'), 80, 320);

  ctx.fillStyle = '#ffffff';
  ctx.font = canvasFont('bold 200px');
  ctx.fillText(volumeStr, 80, 490);

  // Weight-unit suffix (lb / kg / stone) — pulled from stats.unit so the
  // card shows the user's preferred unit, not the lbs internal storage.
  const unitSuffix = stats.unit === 'kg' ? ' kg'
                   : stats.unit === 'stone' ? ' st'
                   : ' lb';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = canvasFont('bold 60px');
  const volWidth = ctx.measureText(volumeStr).width;
  ctx.font = canvasFont('bold 200px');
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = canvasFont('bold 60px');
  ctx.fillText(unitSuffix, 80 + volWidth, 490);

  // ── Stat row: 3 secondary stats ───────────────────────────────────────
  const statBoxes = [
    { label: 'EXERCISES', value: String(stats.exercises) },
    { label: 'SETS',      value: String(stats.totalSets) },
    { label: 'DURATION',  value: stats.duration > 0 ? `${stats.duration} min` : '—' },
  ];
  drawStatBoxes(ctx, statBoxes, W);
}

// The run-only headline: distance big where volume would be, then time. A
// run logged by time alone leads with the time and needs no box under it.
function drawRunStats(ctx, { stats, tf, W }) {
  const time = stats.duration > 0 ? `${stats.duration} min` : '—';
  const hasDistance = stats.cardioMeters > 0;
  const label = hasDistance ? tf('cardio.field.distance', 'Distance') : tf('finish.time', 'Time');
  const headline = hasDistance ? stats.cardioDistance : time;

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = canvasFont('bold 30px');
  ctx.fillText(label.toUpperCase(), 80, 320);

  ctx.fillStyle = '#ffffff';
  let size = 200;
  ctx.font = canvasFont(`bold ${size}px`);
  while (ctx.measureText(headline).width > W - 160 && size > 80) {
    size -= 10;
    ctx.font = canvasFont(`bold ${size}px`);
  }
  ctx.fillText(headline, 80, 490);

  if (hasDistance) {
    drawStatBoxes(ctx, [{ label: tf('finish.time', 'Time').toUpperCase(), value: time }], W);
  }
}

function drawStatBoxes(ctx, statBoxes, W) {
  const n = statBoxes.length;
  const boxW = (W - 160 - 20 * (n - 1)) / n; // 80 padding each side, 20 gap
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
    ctx.font = canvasFont('bold 84px');
    ctx.textAlign = 'center';
    ctx.fillText(box.value, boxX + boxW / 2, boxY + 110);

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = canvasFont('bold 22px');
    ctx.fillText(box.label, boxX + boxW / 2, boxY + 160);

    boxX += boxW + 20;
  }
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

// "5.1 km" in the person's distance unit, one decimal, localised digits.
function formatRunDistance(meters, distanceUnit, language) {
  const u = distanceUnit === 'km' ? 'km' : 'mi';
  return `${formatNumber(Math.round(metersTo(u, meters) * 10) / 10, language)} ${u}`;
}

// The finish screen's numbers, above the image. Only what the session
// actually has: a duration nobody recorded is left out rather than drawn
// as "0 min" (CLAUDE.md: a section with no data must not render zeros).
function FinishStats({ workout, includeBarWeight, weightUnit, distanceUnit, summary, tFallback, language }) {
  const raw = computeStats(workout, { includeBarWeight });
  const fmt = (n) => formatNumber(n, language);
  const unit = weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lb';
  const cells = [
    raw.duration > 0 && { label: tFallback('finish.time', 'Time'), value: `${fmt(raw.duration)} ${tFallback('finish.min', 'min')}` },
    raw.cardioMeters > 0 && { label: tFallback('cardio.field.distance', 'Distance'), value: formatRunDistance(raw.cardioMeters, distanceUnit, language) },
    raw.totalVolume > 0 && { label: tFallback('finish.volume', 'Volume'), value: `${fmt(Math.round(fromLbs(raw.totalVolume, weightUnit)))} ${unit}` },
    // A run-only session has no sets, and "0 sets" is not a stat.
    (raw.exercises > 0 || raw.cardioCount === 0) && { label: tFallback('finish.sets', 'Sets'), value: fmt(raw.totalSets) },
  ].filter(Boolean);
  const prs = summary?.prs || [];
  return (
    <div className="flex flex-col gap-2 mb-6">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg border border-border px-2 py-2 text-center">
            <span className="block font-heading text-xl font-bold tabular-nums">{c.value}</span>
            <span className="kicker block">{c.label}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {summary?.xpGained > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-1 text-caption font-semibold">
            <Zap className="w-3.5 h-3.5" aria-hidden="true" />
            {tFallback('finish.xp', '+{xp} XP', { xp: fmt(summary.xpGained) })}
          </span>
        )}
        {prs.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success px-2 py-1 text-caption font-semibold">
            <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
            {prs.length === 1
              ? tFallback('finish.onePr', 'New PR: {name}', { name: prs[0].displayName || prs[0].name })
              : tFallback('finish.manyPrs', '{n} new PRs', { n: fmt(prs.length) })}
          </span>
        )}
      </div>
    </div>
  );
}

export default function WorkoutShareCard({ open, onClose, workout, username, includeBarWeight = false, summary = null }) {
  const { tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();
  const canvasRef = useRef(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  // Render the card whenever the modal opens with a workout
  useEffect(() => {
    if (!open || !workout) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // Volumes stored in lbs internally — convert to the user's preferred
    // unit (kg / stone) so users see the share card in the unit they
    // use everywhere else. Without this, a user on kg sees "TOTAL VOLUME
    // 12500 lb" instead of the kg they actually log in.
    const rawStats = computeStats(workout, { includeBarWeight });
    const stats = {
      ...rawStats,
      totalVolume: Math.round(fromLbs(rawStats.totalVolume, weightUnit)),
      topLift: rawStats.topLift ? {
        ...rawStats.topLift,
        weight: Math.round(fromLbs(rawStats.topLift.weight, weightUnit) * 10) / 10,
      } : null,
      unit: weightUnit, // shown as the suffix in drawCard
      cardioDistance: formatRunDistance(rawStats.cardioMeters, distanceUnit, language),
    };
    // date-fns binds no locale, so this printed an English month onto a
    // fully translated card. Intl is already language-bound.
    const dateStr = (() => {
      const opts = { month: 'short', day: 'numeric', year: 'numeric' };
      try { return formatDate(workout.date || Date.now(), language, opts); }
      catch { return formatDate(new Date(), language, opts); }
    })();
    let cancelled = false;
    canvasFontsReady().then(() => {
      if (cancelled) return;
      drawCard(ctx, {
        username: username || tFallback('shareCard.athlete', 'Athlete'),
        dateStr,
        stats,
        language,
        t: tFallback,
      });
      // Convert to a stable preview URL
      canvas.toBlob((blob) => {
        if (blob) setImgUrl(URL.createObjectURL(blob));
      }, 'image/png');
    });
    return () => { cancelled = true; };
  }, [open, workout, username, language, includeBarWeight, weightUnit, distanceUnit, tFallback]);

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
      track(EVENTS.SHARED, { card: 'workout', method: 'download' });
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
            title: tFallback('shareCard.workoutTitle', 'My Flexyn workout'),
            text: tFallback('shareCard.workoutText', 'Just crushed a workout in Flexyn'),
            url: shareCardLink('share_workout'),
          });
          track(EVENTS.SHARED, { card: 'workout', method: 'share' });
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
              {summary
                ? tFallback('finish.title', 'Workout complete')
                : tFallback('share.title', 'Share your workout')}
            </DialogTitle>
          </DialogHeader>

          {summary && workout && (
            <FinishStats workout={workout} includeBarWeight={includeBarWeight} weightUnit={weightUnit} distanceUnit={distanceUnit}
              summary={summary} tFallback={tFallback} language={language} />
          )}

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
                <img loading="lazy" src={imgUrl} alt={tFallback("workoutShareCard.workoutSummary", "Workout summary")} className="w-full block" />
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
              {tFallback('share.download', 'Save image')}
            </Button>
            <Button onClick={handleShare} disabled={busy || !imgUrl} className="flex-1 gap-2">
              <Share2 className="w-4 h-4" />
              {tFallback('share.share', 'Share')}
            </Button>
          </div>
          <p className="text-micro text-muted-foreground mt-2 text-center">
            {tFallback('share.hint', 'Posts to Instagram, TikTok, or download for anywhere else.')}
          </p>
          {summary && (
            <Button type="button" variant="ghost" onClick={onClose} className="w-full min-h-12 mt-2">
              {tFallback('finish.done', 'Done')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
