// src/components/gyms/GymSignageCard.jsx
//
// Printable in-gym signage. Renders a big QR (encoded with the
// Flexyn Code as the data URL) + the 8-char code in mono type, sized
// to print clean on US Letter / A4 at a useful eye-distance.
//
// Owner taps "Print signage" inside their Gym Hub → modal renders →
// browser print dialog produces a quarter-page poster.
//
// The QR encodes `flexyn://gym/<CODE>` so a generic QR reader on a
// member's phone opens the Flexyn app (when installed) or shows the
// code as fallback text. The in-app QrCodeScanner accepts both bare
// codes and this deep-link form.

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X, Printer, Download, Loader2, FileText } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { downloadSignageKit, SIGNAGE_PLACEMENT_COUNT } from '@/lib/gymSignageKit';

export default function GymSignageCard({ open, onClose, gym }) {
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
        const origin = (typeof window !== 'undefined' && window.location.origin) || 'https://flexyn.netlify.app';
        const dataUrl = await QRCode.toDataURL(`${origin}/checkin/${gym.flexyn_code}`, {
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

  const [buildingKit, setBuildingKit] = useState(false);

  if (!open || !gym) return null;

  const handleKit = async () => {
    if (buildingKit) return;
    setBuildingKit(true);
    const res = await downloadSignageKit(gym);
    setBuildingKit(false);
    if (res.ok) {
      toast.success(`Signage kit downloaded — ${SIGNAGE_PLACEMENT_COUNT} posters.`);
    } else {
      toast.error("Couldn't build the PDF kit — try again.");
    }
  };

  const handlePrint = () => window.print();
  const handleDownload = () => {
    if (!pngUrl) return;
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = `flexyn-${gym.flexyn_code}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4 print:bg-white print:p-0"
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl flex flex-col print:max-w-none print:border-0 print:shadow-none print:rounded-none"
      >
        {/* Modal chrome — hidden on print */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 print:hidden">
          <h2 className="font-heading font-bold text-base">Gym signage</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-full bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Printable surface — A4 / letter quarter-page friendly */}
        <div
          id="gym-signage-print-area"
          className="bg-white text-black p-8 mx-auto print:p-12 print:m-0"
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
              alt="Flexyn Code QR"
              className="w-full aspect-square object-contain mb-4"
              ref={canvasRef}
            />
          ) : (
            <div className="aspect-square bg-slate-100 rounded-2xl flex items-center justify-center mb-4 text-slate-500 text-sm">
              QR generation failed
            </div>
          )}

          <p className="text-center text-xs text-slate-500 mb-1">Or type this code in the app:</p>
          <p className="text-center font-mono text-3xl font-bold tracking-[0.4em] text-slate-900">
            {gym.flexyn_code}
          </p>

          <p className="text-center text-xs text-slate-500 mt-6">
            Open the Flexyn app → My Gyms → tap the scan icon or type the code above.
          </p>
        </div>

        {/* Actions — hidden on print */}
        <div className="p-4 print:hidden space-y-2">
          {/* Primary: one-click multi-poster PDF kit */}
          <Button onClick={handleKit} disabled={generating || buildingKit} className="w-full gap-2">
            {buildingKit ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {buildingKit ? 'Building kit…' : `Download print kit (PDF · ${SIGNAGE_PLACEMENT_COUNT} posters)`}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleDownload} disabled={!pngUrl} className="flex-1 gap-2">
              <Download className="w-4 h-4" />
              PNG
            </Button>
            <Button variant="outline" onClick={handlePrint} disabled={generating} className="flex-1 gap-2">
              <Printer className="w-4 h-4" />
              Print
            </Button>
          </div>
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
