// src/components/nutrition/FoodPhotoCaptureModal.jsx
//
// Guided in-app camera for Photo-AI meal capture — the plate equivalent of
// the barcode scanner. Shows a live rear-camera preview with a framing guide
// (rounded reticle + corner brackets, everything outside it dimmed) so the
// user centers the whole dish before shooting. Snaps a single frame to a JPEG
// File and hands it back via onCapture for the normal recognition flow.
//
// Falls back gracefully: if the camera can't start (denied / unsupported /
// desktop with no webcam) it shows a message and a "Choose from library"
// button. That same button is always available so the user can pick an
// existing photo instead of shooting a new one.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Images, Zap, ZapOff, Loader2, CameraOff, Sparkles } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

export default function FoodPhotoCaptureModal({ open, onClose, onCapture, onPickLibrary }) {
  const { tFallback } = useLanguage();
  useBodyScrollLock(open);
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const trackRef  = useRef(null);
  // Flipped by close/unmount so an in-flight startCamera (several awaits before
  // the stream is assigned) can tell the user already left and tear the
  // just-created stream down instead of leaving the camera light stuck on.
  const cancelledRef = useRef(false);

  const [status, setStatus] = useState('starting'); // starting | ready | capturing | error
  const [errorKind, setErrorKind] = useState(null);  // 'denied' | 'failed'
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    cancelledRef.current = false;
    startCamera();
    return () => {
      cancelledRef.current = true;
      stopCamera();
    };
  }, [open]);

  const stopCamera = () => {
    try { trackRef.current?.applyConstraints?.({ advanced: [{ torch: false }] }); } catch { /* noop */ }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => { try { tr.stop(); } catch { /* noop */ } });
      streamRef.current = null;
    }
    trackRef.current = null;
    if (videoRef.current) { try { videoRef.current.srcObject = null; } catch { /* noop */ } }
    setTorchOn(false);
  };

  const startCamera = async () => {
    setStatus('starting');
    setErrorKind(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupported' });

      // Prefer the rear camera for plates; fall back to any camera (desktop
      // webcam / front cam) so the preview still works.
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (cancelledRef.current) { stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } }); return; }

      streamRef.current = stream;
      trackRef.current = stream.getVideoTracks()[0] || null;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play().catch(() => {}); // autoplay may reject; frames still flow
      }
      const caps = trackRef.current?.getCapabilities?.() || {};
      setTorchAvailable('torch' in caps);
      setStatus('ready');
    } catch (err) {
      if (cancelledRef.current) return;
      setErrorKind(err?.name === 'NotAllowedError' ? 'denied' : 'failed');
      setStatus('error');
    }
  };

  const toggleTorch = async () => {
    if (!trackRef.current) return;
    const next = !torchOn;
    try {
      await trackRef.current.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch { /* some tracks advertise torch but reject — ignore */ }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || status !== 'ready') return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    setStatus('capturing');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) { setStatus('ready'); return; }
        const file = new File([blob], `meal-${w}x${h}.jpg`, { type: 'image/jpeg' });
        stopCamera();
        onCapture?.(file);
      },
      'image/jpeg',
      0.92,
    );
  };

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9998] bg-black"
      >
        {/* Live preview */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Framing guide — a centered rounded reticle with everything outside
            it dimmed, plus corner brackets. Only while the preview is live. */}
        {status === 'ready' && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="relative rounded-[2rem]"
                style={{
                  width: 'min(80vw, 70vh)',
                  height: 'min(80vw, 70vh)',
                  boxShadow: '0 0 0 100vmax rgba(0,0,0,0.55)',
                }}
              >
                {/* Corner brackets */}
                {['top-3 start-3 border-t-2 border-s-2 rounded-tl-xl',
                  'top-3 end-3 border-t-2 border-e-2 rounded-tr-xl',
                  'bottom-3 start-3 border-b-2 border-s-2 rounded-bl-xl',
                  'bottom-3 end-3 border-b-2 border-e-2 rounded-br-xl',
                ].map((c) => (
                  <span key={c} className={`absolute w-8 h-8 border-white/90 ${c}`} />
                ))}
              </div>
            </div>
            {/* Instruction */}
            <div className="absolute inset-x-0 top-[14%] flex flex-col items-center px-8 text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5">
                <Sparkles className="w-3.5 h-3.5 text-white" />
                <span className="text-sm font-semibold text-white">{tFallback("foodPhotoCaptureModal.fitTheWholePlate", "Fit the whole plate in the frame")}</span>
              </span>
              <span className="mt-2 text-micro text-white/70">{tFallback("foodPhotoCaptureModal.goodEvenLightingGives", "Good, even lighting gives the best results")}</span>
            </div>
          </div>
        )}

        {/* Starting / error states */}
        {status === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
            <Loader2 className="w-7 h-7 animate-spin" />
            <p className="text-sm">Starting camera…</p>
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-10 text-center">
            <CameraOff className="w-9 h-9 text-white/70" />
            <p className="text-white font-semibold">
              {errorKind === 'denied' ? 'Camera access is off' : "Couldn't start the camera"}
            </p>
            <p className="text-white/60 text-sm">
              {errorKind === 'denied'
                ? 'Allow camera access in your settings, or pick a photo from your library instead.'
                : 'Pick a photo from your library instead.'}
            </p>
            <button
              onClick={onPickLibrary}
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-white text-black px-5 py-2.5 text-sm font-bold"
            >
              <Images className="w-4 h-4" /> Choose from library
            </button>
          </div>
        )}

        {/* Top bar — close + torch */}
        <div className="absolute top-0 inset-x-0 flex items-center justify-between p-4">
          <button
            onClick={onClose}
            aria-label={tFallback("photos.closeCamera", "Close camera")}
            className="w-10 h-10 rounded-full bg-black/45 text-white flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
          {status === 'ready' && torchAvailable && (
            <button
              onClick={toggleTorch}
              aria-label={tFallback("foodPhotoCaptureModal.toggleFlashlight", "Toggle flashlight")}
              className={`w-10 h-10 rounded-full flex items-center justify-center ${torchOn ? 'bg-white text-black' : 'bg-black/45 text-white'}`}
            >
              {torchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}
        </div>

        {/* Bottom bar — library + shutter */}
        {status !== 'error' && (
          <div className="absolute bottom-0 inset-x-0 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6 px-8">
            <div className="flex items-center justify-between">
              <button
                onClick={onPickLibrary}
                aria-label={tFallback("foodPhotoCaptureModal.chooseFromLibrary", "Choose from library")}
                className="w-12 h-12 rounded-2xl bg-white/15 text-white flex items-center justify-center backdrop-blur-sm"
              >
                <Images className="w-5 h-5" />
              </button>

              {/* Shutter */}
              <button
                onClick={capture}
                disabled={status !== 'ready'}
                aria-label={tFallback("photos.takePhoto", "Take photo")}
                className="w-[72px] h-[72px] rounded-full bg-white/25 flex items-center justify-center disabled:opacity-50"
              >
                <span className="w-[58px] h-[58px] rounded-full bg-white flex items-center justify-center">
                  {status === 'capturing' && <Loader2 className="w-6 h-6 animate-spin text-black" />}
                </span>
              </button>

              {/* Spacer to keep the shutter centered */}
              <div className="w-12 h-12" />
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
