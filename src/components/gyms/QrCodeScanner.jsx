// src/components/gyms/QrCodeScanner.jsx
//
// In-camera QR code scanner for the gym join-by-code flow. Reuses
// the same @zxing/browser library the Nutrition barcode scanner
// pulls in (dynamic import keeps the ~80 KB out of the entry chunk
// for users who never tap "Scan code").
//
// Decoded payload formats accepted:
//   • Bare 8-char code         "ABCD2345"
//   • flexyn://gym/CODE        deep-link form (future-friendly)
//   • https://flexyn.app/gym/<gymId>?code=CODE   (web share form)
// We normalize each to the bare 8-char string before calling
// onDetect — the parent only sees a clean code.
//
// Closes automatically on detect so callers don't have to manage
// stop() — they get a single callback per scan session.

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle, ScanLine } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const CODE_RE = /[A-HJ-NP-Z2-9]{8}/;

function extractCode(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  // Bare code
  if (/^[A-HJ-NP-Z2-9]{8}$/.test(s)) return s;
  // flexyn://gym/<CODE>
  const m1 = s.match(/^FLEXYN:\/\/GYM\/([A-HJ-NP-Z2-9]{8})/);
  if (m1) return m1[1];
  // Any URL with code= param
  try {
    const u = new URL(raw);
    const code = u.searchParams.get('code') || u.searchParams.get('c');
    if (code) {
      const cleaned = code.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8);
      if (cleaned.length === 8) return cleaned;
    }
  } catch { /* not a URL — fall through */ }
  // Last resort: find an 8-char run anywhere in the payload
  const m2 = s.match(CODE_RE);
  return m2 ? m2[0] : null;
}

export default function QrCodeScanner({ open, onClose, onDetect }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const videoRef    = useRef(null);
  const readerRef   = useRef(null);
  const controlsRef = useRef(null);
  const detectedRef = useRef(false); // guard against multi-fire
  // Keep the latest onDetect in a ref so the camera-start effect only
  // depends on `open`. Previously `onDetect` was a fresh closure every
  // parent render (it captures the `joining` state via joinWithCode),
  // tearing down and re-initializing the camera on every parent
  // re-render. (Audit 12 #14.)
  const onDetectRef = useRef(onDetect);
  useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);

  const [status, setStatus] = useState('idle'); // idle | initializing | scanning | error
  const [error,  setError]  = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    detectedRef.current = false;
    setStatus('initializing');
    setError(null);

    let cancelled = false;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera not available on this browser.');
        }
        // Lazy-import zxing so the chunk only ships when the scanner mounts.
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled) return;
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (cancelled) return;
        if (!devices.length) throw new Error('No camera found on this device.');
        // Prefer back/environment-facing camera when available.
        const back = devices.find(d => /back|rear|environment/i.test(d.label || ''));
        const deviceId = (back || devices[0]).deviceId;

        readerRef.current = new BrowserMultiFormatReader();
        setStatus('scanning');
        controlsRef.current = await readerRef.current.decodeFromVideoDevice(
          deviceId,
          videoRef.current,
          (result, err, controls) => {
            if (cancelled) { controls?.stop(); return; }
            if (result && !detectedRef.current) {
              const code = extractCode(result.getText());
              if (code) {
                detectedRef.current = true;
                try { controls.stop(); } catch { /* ignore */ }
                onDetectRef.current?.(code);
              }
            }
          },
        );
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          // Map common DOMException names to friendly copy. The native
          // .message varies by browser ("Permission denied" on Chrome,
          // "The request is not allowed..." on Safari, etc.) and isn't
          // helpful. (Audit 12 #15.)
          const name = e?.name || '';
          if (name === 'NotAllowedError' || name === 'SecurityError') {
            setError('Camera permission denied — enable camera access in your browser settings to scan.');
          } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
            setError('No camera found on this device.');
          } else if (name === 'NotReadableError') {
            setError('Camera is in use by another app. Close it and try again.');
          } else {
            setError(e?.message || 'Camera failed to start.');
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      try { controlsRef.current?.stop(); } catch { /* ignore */ }
      controlsRef.current = null;
      readerRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-black flex flex-col"
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-black/70 z-10">
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center"
            aria-label="Close scanner"
          >
            <X className="w-4 h-4" />
          </button>
          <p className="text-white text-sm font-medium flex items-center gap-1.5">
            <ScanLine className="w-4 h-4" />
            Scan gym QR code
          </p>
          <div className="w-8" />
        </div>

        {/* Video / status */}
        <div className="flex-1 relative bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
            autoPlay
          />

          {/* Aim reticle */}
          {status === 'scanning' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-60 h-60 border-2 border-white/70 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div
                    initial={{ y: -80, opacity: 0 }}
                    animate={{ y: 80, opacity: 1 }}
                    transition={{ duration: 1.6, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
                    className="w-56 h-0.5 bg-primary shadow-[0_0_10px_2px_rgba(124,58,237,0.7)]"
                  />
                </div>
              </div>
            </div>
          )}

          {status === 'initializing' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <Loader2 className="w-6 h-6 animate-spin text-white" />
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-black/80">
              <AlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
              <p className="text-white text-sm">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 px-4 py-2 rounded-lg bg-white/15 text-white text-sm font-medium"
              >
                Close
              </button>
            </div>
          )}
        </div>

        {/* Hint */}
        <div className="bg-black/70 px-4 py-3 text-center">
          <p className="text-white/80 text-xs">
            Point at the Flexyn Code printed inside the gym.
          </p>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
