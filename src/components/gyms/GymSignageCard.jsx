// src/components/gyms/GymSignageCard.jsx
//
// In-gym signage: a big QR plus the 8-char Flexyn Code in mono type,
// sized to stay legible at arm's length whether it's on a phone screen
// or taped to a wall.
//
// Opened from the Flexyn Code block in Gym Hub. Not owner-only: a
// community gym has no owner by design (mig 275), so anyone at a gym
// with members can get its signage out.
//
// The QR encodes the CHECK-IN URL — <canonical origin>/checkin/<CODE>,
// see appOrigin.js — not a flexyn:// scheme. A PWA cannot register a
// custom scheme, so a camera-app scan of flexyn:// would open nothing;
// an https URL opens, checks the member in, and lands them on that
// gym's page. The in-app QrCodeScanner still pulls the bare code out of
// that path.
//
// Two actions, both full width, both doable from a phone: Share (the
// image, through the OS sheet) and Save. There is no Print button and no
// PDF kit — those were desktop actions on an app that ships to the App
// Store and Play Store.

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X, Share2, Download, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { gymCheckinUrl } from '@/lib/appOrigin';
import { useLanguage } from '@/lib/LanguageContext';

export default function GymSignageCard({ open, onClose, gym }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open && !!gym);
  const canvasRef = useRef(null);
  const [generating, setGenerating] = useState(true);
  const [pngUrl, setPngUrl] = useState(null);

  useEffect(() => {
    if (!open || !gym?.flexyn_code) return undefined;
    setGenerating(true);

    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import('qrcode')).default;
        if (cancelled) return;
        const dataUrl = await QRCode.toDataURL(gymCheckinUrl(gym.flexyn_code), {
          errorCorrectionLevel: 'H',
          margin: 1,
          width: 600,
          color: { dark: '#0f0f2a', light: '#ffffff' },
        });
        if (!cancelled) {
          setPngUrl(dataUrl);
          setGenerating(false);
        }
      } catch (err) {
        console.error('[GymSignageCard] QR generation failed:', err);
        if (!cancelled) setGenerating(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, gym?.flexyn_code]);

  const [sharing, setSharing] = useState(false);

  if (!open || !gym) return null;

  const handleSave = () => {
    if (!pngUrl) return;
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = `flexyn-${gym.flexyn_code}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Share the QR itself, as a file, so the receiving app gets an image it
  // can display rather than a link it has to fetch. On iOS the resulting
  // sheet carries "Save Image", which is the only route a web app has to
  // the camera roll — there is no browser API that writes to Photos.
  const handleShare = async () => {
    if (!pngUrl || sharing) return;
    setSharing(true);
    try {
      const blob = await (await fetch(pngUrl)).blob();
      const file = new File([blob], `flexyn-${gym.flexyn_code}.png`, { type: 'image/png' });
      const text = `Join ${gym.name} on Flexyn — scan this, or type ${gym.flexyn_code} in the app.`;

      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: gym.name, text });
      } else if (navigator.share) {
        // Sharing files isn't supported here — send the link instead, which
        // resolves to this gym either way.
        await navigator.share({ title: gym.name, text, url: gymCheckinUrl(gym.flexyn_code) });
      } else {
        handleSave();
      }
    } catch (err) {
      // Dismissing the share sheet is a decision, not a failure.
      if (err?.name !== 'AbortError') {
        toast.error("Couldn't share the code — saving it instead.");
        handleSave();
      }
    } finally {
      setSharing(false);
    }
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[9999] bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4 print:bg-white print:p-0 print:backdrop-blur-none"
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        // max-h + a scrolling middle, because this modal is 743px tall and
        // an iPhone SE viewport is 667. Unbounded, it centred itself at
        // top: -40 — the close button off the top of the screen, "Save to
        // Camera Roll" clipped 19px off the bottom, and nothing scrollable
        // in between, so the only way out was a backdrop tap you had to
        // guess at. Header and actions stay pinned; the poster scrolls.
        className="w-full max-w-md max-h-[calc(100dvh-2rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden print:max-w-none print:max-h-none print:border-0 print:shadow-none print:rounded-none print:overflow-visible"
      >
        {/* Modal chrome — hidden on print */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0 print:hidden">
          <h2 className="font-heading font-bold text-base">{tFallback("gymSignageCard.gymSignage", "Gym Signage")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tFallback("common.close", "Close")}
            className="w-7 h-7 rounded-full bg-secondary text-muted-foreground hover:text-foreground active:text-foreground flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Printable surface — A4 / letter quarter-page friendly */}
        <div
          id="gym-signage-print-area"
          className="bg-white text-black p-8 mx-auto overflow-y-auto print:p-12 print:m-0 print:overflow-visible"
          style={{ width: '100%', maxWidth: '480px' }}
        >
          <p className="text-center text-xs font-bold uppercase tracking-[0.3em] text-slate-500">
            Flexyn Gym
          </p>
          <h1 className="text-center font-bold text-2xl mt-1 mb-6 text-slate-900">
            {gym.name}
          </h1>

          {generating ? (
            <div className="aspect-square bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
              <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
            </div>
          ) : pngUrl ? (
            <img loading="lazy" src={pngUrl}
              alt={tFallback("gymSignageCard.flexynCodeQr", "Flexyn Code QR")}
              className="w-full aspect-square object-contain mb-4"
              ref={canvasRef}
            />
          ) : (
            <div className="aspect-square bg-slate-100 rounded-2xl flex items-center justify-center mb-4 text-slate-500 text-sm">
              QR generation failed
            </div>
          )}

          <p className="text-center text-xs text-slate-500 mb-1">{tFallback("gymSignageCard.orTypeThisCode", "Or type this code in the app:")}</p>
          <p className="text-center font-mono text-3xl font-bold tracking-[0.4em] text-slate-900">
            {gym.flexyn_code}
          </p>

          <p className="text-center text-xs text-slate-500 mt-6">
            Open the Flexyn app → My Gym → tap the scan icon or type the code above.
          </p>
        </div>

        {/* Actions — hidden on print.
            Two, both full width, both things you can do from a phone. The
            PDF kit and the Print button that used to live here were desktop
            actions on an app that ships to the App Store and Play Store. */}
        <div className="p-4 shrink-0 print:hidden space-y-2">
          <Button onClick={handleShare} disabled={generating || !pngUrl || sharing} className="w-full gap-2">
            {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
            Share
          </Button>
          <Button variant="outline" onClick={handleSave} disabled={!pngUrl} className="w-full gap-2">
            <Download className="w-4 h-4" />
            Save to Camera Roll
          </Button>
        </div>
      </motion.div>

      {/* Print stylesheet — hide everything except the signage area */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #gym-signage-print-area, #gym-signage-print-area * { visibility: visible !important; }
          #gym-signage-print-area {
            position: absolute !important;
            left: 0; top: 0;
            width: 100%;
          }
        }
      `}</style>
    </motion.div>,
    document.body,
  );
}
