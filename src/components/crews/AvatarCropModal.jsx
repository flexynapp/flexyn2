// src/components/crews/AvatarCropModal.jsx
//
// Canvas-based circular crop + zoom UI for crew avatar uploads.
// No external crop library — uses a <canvas> drawImage with a clip
// circle. Drag to pan, slider to zoom.
//
// Props:
//   file      File object from <input type="file">
//   onCrop    (blob: Blob) => void  — called with the cropped JPEG blob
//   onClose   () => void

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, ZoomIn, ZoomOut, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PREVIEW_SIZE = 260; // px — the circular viewport diameter
const OUTPUT_SIZE  = 512; // px — exported canvas size

export default function AvatarCropModal({ file, onCrop, onClose }) {
  const [imgSrc,  setImgSrc]  = useState(null);
  const [zoom,    setZoom]     = useState(1);          // 1x – 3x
  const [offset,  setOffset]   = useState({ x: 0, y: 0 }); // pan in px (screen-space)
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef(null);
  const canvasRef = useRef(null);
  const imgRef    = useRef(null);

  // Load file → data URL
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Re-draw canvas every time zoom / offset / imgSrc changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;

    const ctx = canvas.getContext('2d');
    const s   = PREVIEW_SIZE;
    canvas.width  = s;
    canvas.height = s;
    ctx.clearRect(0, 0, s, s);

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.clip();

    // Scale image so its shorter side fills the viewport at zoom 1.
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const base = (iw < ih ? s / iw : s / ih) * zoom;
    const dw = iw * base;
    const dh = ih * base;
    const dx = (s - dw) / 2 + offset.x;
    const dy = (s - dh) / 2 + offset.y;

    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  });

  // ── Drag handlers ────────────────────────────────────────────────
  const startDrag = (clientX, clientY) => {
    setDragging(true);
    dragStart.current = { clientX, clientY, ox: offset.x, oy: offset.y };
  };
  const moveDrag = useCallback((clientX, clientY) => {
    if (!dragging || !dragStart.current) return;
    setOffset({
      x: dragStart.current.ox + (clientX - dragStart.current.clientX),
      y: dragStart.current.oy + (clientY - dragStart.current.clientY),
    });
  }, [dragging]);
  const endDrag = () => setDragging(false);

  // Mouse
  const onMouseDown = (e) => { e.preventDefault(); startDrag(e.clientX, e.clientY); };
  const onMouseMove = useCallback((e) => moveDrag(e.clientX, e.clientY), [moveDrag]);
  const onMouseUp   = endDrag;

  // Touch
  const onTouchStart = (e) => {
    const t = e.touches[0];
    startDrag(t.clientX, t.clientY);
  };
  const onTouchMove = (e) => {
    e.preventDefault();
    const t = e.touches[0];
    moveDrag(t.clientX, t.clientY);
  };

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup',   onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, [dragging, onMouseMove]);

  // ── Crop & export ────────────────────────────────────────────────
  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img) return;

    const out = document.createElement('canvas');
    out.width  = OUTPUT_SIZE;
    out.height = OUTPUT_SIZE;
    const ctx  = out.getContext('2d');
    const s    = OUTPUT_SIZE;

    // Clip to circle on the output canvas too
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.clip();

    // Scale preview coords → output coords
    const scale = OUTPUT_SIZE / PREVIEW_SIZE;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const base = ((iw < ih ? PREVIEW_SIZE / iw : PREVIEW_SIZE / ih) * zoom) * scale;
    const dw = iw * base;
    const dh = ih * base;
    const dx = (s - dw) / 2 + offset.x * scale;
    const dy = (s - dh) / 2 + offset.y * scale;

    ctx.drawImage(img, dx, dy, dw, dh);

    out.toBlob(
      (blob) => { if (blob) onCrop(blob); },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="bg-background rounded-2xl shadow-2xl flex flex-col gap-4 p-5 w-full max-w-sm"
        initial={{ scale: 0.95, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 12 }}
        transition={{ duration: 0.2 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm">Crop crew photo</p>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Canvas preview */}
        <div className="flex justify-center">
          <div
            className="relative rounded-full overflow-hidden cursor-grab active:cursor-grabbing ring-2 ring-primary/30"
            style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE, touchAction: 'none' }}
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={endDrag}
          >
            <canvas
              ref={canvasRef}
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              className="w-full h-full"
            />
            {/* Hidden img tag drives the canvas draw */}
            {imgSrc && (
              <img
                ref={imgRef}
                src={imgSrc}
                alt=""
                className="sr-only"
                onLoad={() => {
                  // Trigger a re-draw by forcing a tiny state change
                  setZoom(z => z);
                }}
              />
            )}
            {!imgSrc && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
                Loading…
              </div>
            )}
          </div>
        </div>

        {/* Zoom slider */}
        <div className="flex items-center gap-3">
          <ZoomOut className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="flex-1 accent-primary"
          />
          <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
        </div>

        <p className="text-[10px] text-muted-foreground text-center -mt-2">
          Drag to reposition · Slide to zoom
        </p>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 gap-1.5" onClick={handleConfirm} disabled={!imgSrc}>
            <Check className="w-4 h-4" /> Use photo
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
