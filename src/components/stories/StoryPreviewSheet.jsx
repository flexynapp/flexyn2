// src/components/stories/StoryPreviewSheet.jsx
//
// Full-screen story editor shown before posting.
//
// Filters (swipe left/right on the preview)
//   Normal | B&W | Vivid | Bright — cycles with horizontal swipe
//
// Text overlay
//   Tap "Aa" or tap background → centered textarea opens for typing
//   Tap positioned text → re-opens textarea to edit
//   One-finger drag on text  → move text anywhere on screen
//   Two-finger pinch (anywhere on preview) → scale + rotate text
//
// Font presets (shown in editing UI above color picker)
//   Normal | Serious | Casual — tap to switch, each rendered in its own font
//
// Color picker (shown once text exists, below font selector)
//   Hue slider: continuous spectrum, slide to any color
//   Quick dots: white, black, red, blue, yellow, green
//   Eyedropper: canvas-based pixel sampler with live loupe

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Pipette, Download, Check } from 'lucide-react';
import { toast } from 'sonner';

const FILTERS = [
  { label: 'Normal', css: 'none' },
  { label: 'B&W',    css: 'grayscale(1) contrast(1.1)' },
  { label: 'Vivid',  css: 'saturate(2.5) contrast(1.1)' },
  { label: 'Bright', css: 'brightness(1.3) contrast(1.05)' },
];

const FONTS = [
  { label: 'Normal',  family: "'Inter', system-ui, sans-serif" },
  { label: 'Serious', family: "Georgia, 'Times New Roman', serif" },
  { label: 'Casual',  family: "'Comic Sans MS', 'Chalkboard SE', cursive" },
];

const QUICK_COLORS = ['#ffffff', '#000000', '#ef4444', '#3b82f6', '#fbbf24', '#22c55e'];

// Map object-contain image coords to canvas coords
function getContainLayout(containerEl, imgW, imgH) {
  if (!containerEl || !imgW || !imgH) return null;
  const { width: cW, height: cH } = containerEl.getBoundingClientRect();
  const scale   = Math.min(cW / imgW, cH / imgH);
  const offsetX = (cW - imgW * scale) / 2;
  const offsetY = (cH - imgH * scale) / 2;
  return { cW, cH, imgW, imgH, scale, offsetX, offsetY };
}

export default function StoryPreviewSheet({ dataUrl, isVideo, uploading, onConfirm, onCancel }) {
  const [overlayText,     setOverlayText]     = useState('');
  const [editingText,     setEditingText]     = useState(false);
  const [fontIdx,         setFontIdx]         = useState(0);
  const [textColor,       setTextColor]       = useState('#ffffff');
  const [hue,             setHue]             = useState(0);
  const [filterIdx,       setFilterIdx]       = useState(0);
  const [filterLabelVis,  setFilterLabelVis]  = useState(false);
  const filterLabelTimer = useRef(null);

  // Eyedropper
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [loupePos,         setLoupePos]         = useState(null); // {x, y, color}
  const canvasRef    = useRef(null);
  const imgNatRef    = useRef({ w: 0, h: 0 });   // natural image dimensions

  const inputRef     = useRef(null);
  const textRef      = useRef(null);
  const containerRef = useRef(null);
  const mediaElRef   = useRef(null);  // <img> or <video> element

  // Gesture state — updated via DOM refs to avoid React re-render lag
  const ts = useRef({
    x: 0, y: 0, scale: 1, rotate: 0,
    mode: null,
    lastX: 0, lastY: 0,
    startDist: 0, startAngle: 0, startScale: 1, startRotate: 0,
    tapStartX: 0, tapStartY: 0,   // for tap-to-re-edit detection
    touchStartTime: 0,
  });

  const cycleFilter = useCallback((direction) => {
    setFilterIdx(i => (i + direction + FILTERS.length) % FILTERS.length);
    setFilterLabelVis(true);
    clearTimeout(filterLabelTimer.current);
    filterLabelTimer.current = setTimeout(() => setFilterLabelVis(false), 1500);
  }, []);

  // Swipe left/right on the preview area to change filter
  useEffect(() => {
    const container = containerRef.current;
    if (!container || editingText) return;
    let startX, startY;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onTouchEnd = (e) => {
      if (startX === undefined || e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      // Only treat as filter swipe if it's clearly horizontal and NOT starting near text
      if (Math.abs(dx) > 60 && Math.abs(dy) < 80) {
        const bounds = textRef.current?.getBoundingClientRect();
        const nearText = bounds && (
          startX >= bounds.left - 24 && startX <= bounds.right + 24 &&
          startY >= bounds.top  - 24 && startY <= bounds.bottom + 24
        );
        if (!nearText) {
          e.preventDefault();
          cycleFilter(dx < 0 ? 1 : -1);
        }
      }
      startX = undefined;
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchend',   onTouchEnd,   { passive: false });
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchend',   onTouchEnd);
    };
  }, [editingText, cycleFilter]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editingText) inputRef.current?.focus();
  }, [editingText]);

  // Apply stored transform to the DOM element directly (no React state = no lag)
  const applyTransform = useCallback(() => {
    if (!textRef.current) return;
    const { x, y, scale, rotate } = ts.current;
    textRef.current.style.transform =
      `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale}) rotate(${rotate}deg)`;
  }, []);

  // ── Container-level touch listeners (fix: second finger fires on container) ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container || editingText || !overlayText.trim()) return;

    const g = ts.current;

    const textBounds = () => textRef.current?.getBoundingClientRect() ?? null;

    const isNearText = (touch) => {
      const bounds = textBounds();
      if (!bounds) return false;
      const SLACK = 24; // px extra hit area around text
      return (
        touch.clientX >= bounds.left   - SLACK &&
        touch.clientX <= bounds.right  + SLACK &&
        touch.clientY >= bounds.top    - SLACK &&
        touch.clientY <= bounds.bottom + SLACK
      );
    };

    const onTouchStart = (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        if (!isNearText(t)) return; // only engage when finger is on text
        g.mode       = 'drag';
        g.lastX      = t.clientX;
        g.lastY      = t.clientY;
        g.tapStartX  = t.clientX;
        g.tapStartY  = t.clientY;
        g.touchStartTime = Date.now();
      } else if (e.touches.length >= 2) {
        e.preventDefault();
        g.mode       = 'pinch';
        const [t0, t1] = [e.touches[0], e.touches[1]];
        g.startDist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        g.startAngle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX) * 180 / Math.PI;
        g.startScale  = g.scale;
        g.startRotate = g.rotate;
      }
    };

    const onTouchMove = (e) => {
      if (!g.mode) return;
      e.preventDefault();
      if (e.touches.length === 1 && g.mode === 'drag') {
        const t = e.touches[0];
        g.x    += t.clientX - g.lastX;
        g.y    += t.clientY - g.lastY;
        g.lastX = t.clientX;
        g.lastY = t.clientY;
        applyTransform();
      } else if (e.touches.length >= 2) {
        if (g.mode !== 'pinch') {
          // Escalate from drag to pinch mid-gesture
          const [t0, t1] = [e.touches[0], e.touches[1]];
          g.mode       = 'pinch';
          g.startDist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
          g.startAngle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX) * 180 / Math.PI;
          g.startScale  = g.scale;
          g.startRotate = g.rotate;
          return;
        }
        const [t0, t1] = [e.touches[0], e.touches[1]];
        const dist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const angle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX) * 180 / Math.PI;
        if (g.startDist > 0) {
          g.scale  = Math.max(0.2, Math.min(8, g.startScale * dist / g.startDist));
          g.rotate = g.startRotate + angle - g.startAngle;
        }
        applyTransform();
      }
    };

    const onTouchEnd = (e) => {
      if (e.touches.length === 0) {
        // Tap detection: short duration + tiny movement → re-open edit
        if (g.mode === 'drag') {
          const dx  = (e.changedTouches[0]?.clientX ?? g.tapStartX) - g.tapStartX;
          const dy  = (e.changedTouches[0]?.clientY ?? g.tapStartY) - g.tapStartY;
          const dt  = Date.now() - g.touchStartTime;
          if (Math.hypot(dx, dy) < 8 && dt < 300) {
            setEditingText(true);
          }
        }
        g.mode = null;
      } else if (e.touches.length === 1 && g.mode === 'pinch') {
        g.mode  = 'drag';
        g.lastX = e.touches[0].clientX;
        g.lastY = e.touches[0].clientY;
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove',  onTouchMove,  { passive: false });
    container.addEventListener('touchend',   onTouchEnd,   { passive: false });
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove',  onTouchMove);
      container.removeEventListener('touchend',   onTouchEnd);
    };
  }, [editingText, overlayText, applyTransform]);

  // ── Mouse drag for desktop preview / testing ──────────────────────────────
  useEffect(() => {
    const el = textRef.current;
    if (!el || editingText || !overlayText.trim()) return;
    const g = ts.current;
    let didMove = false;

    const onMouseDown = (e) => {
      g.mode       = 'drag';
      g.lastX      = e.clientX;
      g.lastY      = e.clientY;
      g.tapStartX  = e.clientX;
      g.tapStartY  = e.clientY;
      g.touchStartTime = Date.now();
      didMove      = false;
    };
    const onMouseMove = (e) => {
      if (g.mode !== 'drag') return;
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      if (Math.hypot(dx, dy) > 2) didMove = true;
      g.x    += dx;
      g.y    += dy;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      applyTransform();
    };
    const onMouseUp = () => {
      if (!didMove && g.mode === 'drag') {
        setEditingText(true); // click on text = re-edit
      }
      g.mode = null;
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, [editingText, overlayText, applyTransform]);

  // ── Eyedropper: draw image to hidden canvas once ──────────────────────────
  const activateEyedropper = useCallback(() => {
    const imgEl = mediaElRef.current;
    if (!imgEl || isVideo) return; // eyedropper for images only

    const canvas = canvasRef.current;
    const natW   = imgEl.naturalWidth  || imgEl.videoWidth  || 1;
    const natH   = imgEl.naturalHeight || imgEl.videoHeight || 1;
    imgNatRef.current = { w: natW, h: natH };
    canvas.width  = natW;
    canvas.height = natH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgEl, 0, 0, natW, natH);
    setEyedropperActive(true);
  }, [isVideo]);

  const samplePixel = useCallback((clientX, clientY) => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return null;
    const { w: natW, h: natH } = imgNatRef.current;
    const layout = getContainLayout(container, natW, natH);
    if (!layout) return null;
    const rect  = container.getBoundingClientRect();
    const sx    = clientX - rect.left;
    const sy    = clientY - rect.top;
    const cx    = Math.round((sx - layout.offsetX) / layout.scale);
    const cy    = Math.round((sy - layout.offsetY) / layout.scale);
    if (cx < 0 || cy < 0 || cx >= natW || cy >= natH) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const [r, g, b] = ctx.getImageData(cx, cy, 1, 1).data;
    return `rgb(${r},${g},${b})`;
  }, []);

  const onEyedropperPointerMove = useCallback((e) => {
    if (!eyedropperActive) return;
    const color = samplePixel(e.clientX, e.clientY);
    setLoupePos({ x: e.clientX, y: e.clientY, color: color ?? '#ffffff' });
  }, [eyedropperActive, samplePixel]);

  const onEyedropperPointerUp = useCallback((e) => {
    if (!eyedropperActive) return;
    const color = samplePixel(e.clientX, e.clientY);
    if (color) setTextColor(color);
    setEyedropperActive(false);
    setLoupePos(null);
  }, [eyedropperActive, samplePixel]);

  // ── Download handler — save edited frame to camera roll ──────────────────
  const [justSaved, setJustSaved] = useState(false);

  const handleDownload = useCallback(async () => {
    const container = containerRef.current;
    const mediaEl   = mediaElRef.current;
    if (!container || !mediaEl) return;

    if (isVideo) {
      // Video: download the source blob directly (filter not composited)
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `flexyn-story-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      return;
    }

    // Image: render to canvas with current filter + text overlay
    const { width: cW, height: cH } = container.getBoundingClientRect();
    const dpr   = Math.min(window.devicePixelRatio || 1, 2); // cap at 2× retina
    const natW  = mediaEl.naturalWidth  || cW;
    const natH  = mediaEl.naturalHeight || cH;

    // object-contain layout within the container
    const imgScale = Math.min(cW / natW, cH / natH);
    const drawW    = natW * imgScale;
    const drawH    = natH * imgScale;
    const ox       = (cW - drawW) / 2;
    const oy       = (cH - drawH) / 2;

    const offscreen = document.createElement('canvas');
    offscreen.width  = cW * dpr;
    offscreen.height = cH * dpr;
    const ctx = offscreen.getContext('2d');
    ctx.scale(dpr, dpr);

    // Draw image with CSS filter
    const filterCss = FILTERS[filterIdx].css;
    if (filterCss !== 'none') ctx.filter = filterCss;
    ctx.drawImage(mediaEl, ox, oy, drawW, drawH);
    ctx.filter = 'none';

    // Draw text overlay
    if (overlayText.trim()) {
      const { x, y, scale: tScale, rotate } = ts.current;
      const cx = cW / 2 + x;
      const cy = cH / 2 + y;
      const fontSize = Math.round(28 * tScale);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rotate * Math.PI) / 180);
      ctx.font       = `bold ${fontSize}px ${FONTS[fontIdx].family}`;
      ctx.fillStyle  = textColor;
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur   = 10;
      ctx.shadowOffsetY = 2;

      const lines  = overlayText.trim().split('\n');
      const lineH  = fontSize * 1.3;
      lines.forEach((line, i) => {
        ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * lineH);
      });
      ctx.restore();
    }

    offscreen.toBlob(blob => {
      if (!blob) { toast.error('Could not save image.'); return; }
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `flexyn-story-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/jpeg', 0.95);

    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }, [isVideo, dataUrl, filterIdx, overlayText, fontIdx, textColor]);

  // ── Confirm handler ───────────────────────────────────────────────────────
  const handleConfirm = () => {
    const g      = ts.current;
    const rect   = containerRef.current?.getBoundingClientRect();
    const filter = FILTERS[filterIdx].css !== 'none' ? FILTERS[filterIdx].css : null;
    const style  = overlayText.trim() ? {
      text:     overlayText.trim(),
      xFrac:    rect ? g.x / rect.width  : 0,
      yFrac:    rect ? g.y / rect.height : 0,
      scale:    g.scale,
      rotation: g.rotate,
      color:    textColor,
      font:     FONTS[fontIdx].label.toLowerCase(),
      filter,
    } : (filter ? { filter } : null);
    onConfirm(style);
  };

  const hasText = overlayText.trim().length > 0;

  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-[9999] bg-black flex flex-col"
    >
      {/* ── Top controls ─────────────────────────────────────────────── */}
      <div
        className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4"
        style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}
      >
        {/* Download — save edited frame to camera roll */}
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={handleDownload}
          className="w-10 h-10 rounded-full bg-black/55 flex items-center justify-center border border-white/15 backdrop-blur-sm"
          aria-label="Save to camera roll"
        >
          <AnimatePresence mode="wait" initial={false}>
            {justSaved ? (
              <motion.span key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                <Check className="w-4 h-4 text-green-400 stroke-[2.5]" />
              </motion.span>
            ) : (
              <motion.span key="dl" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                <Download className="w-4 h-4 text-white" />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        {/* Aa toggle */}
        <button
          onClick={() => setEditingText(v => !v)}
          className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border transition-colors ${
            editingText
              ? 'bg-white text-black border-white'
              : 'bg-black/55 text-white border-white/15 backdrop-blur-sm'
          }`}
          aria-label="Add text"
        >
          Aa
        </button>
      </div>

      {/* ── Preview area ─────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        onClick={() => setEditingText(v => !v)}
      >
        {isVideo ? (
          <video
            ref={mediaElRef}
            src={dataUrl}
            autoPlay loop muted playsInline
            className="absolute inset-0 w-full h-full object-contain"
            style={{ filter: FILTERS[filterIdx].css }}
          />
        ) : (
          <img
            ref={mediaElRef}
            src={dataUrl}
            alt="Story preview"
            className="absolute inset-0 w-full h-full object-contain"
            style={{ filter: FILTERS[filterIdx].css }}
            draggable={false}
          />
        )}

        {/* Filter name label — briefly shown when filter changes */}
        <AnimatePresence>
          {filterLabelVis && (
            <motion.div
              key={filterIdx}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute top-1/2 left-1/2 pointer-events-none"
              style={{ transform: 'translate(-50%, -50%)' }}
            >
              <div className="px-4 py-2 rounded-full bg-black/55 backdrop-blur-sm border border-white/20">
                <span className="text-white text-sm font-semibold">{FILTERS[filterIdx].label}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter dot indicators */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-none">
          {FILTERS.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all"
              style={{
                width:           i === filterIdx ? 16 : 5,
                height:          5,
                backgroundColor: i === filterIdx ? '#ffffff' : 'rgba(255,255,255,0.45)',
              }}
            />
          ))}
        </div>

        {/* Editing textarea — centered, transparent */}
        {editingText && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/15"
            onClick={e => e.stopPropagation()}
          >
            <textarea
              ref={inputRef}
              value={overlayText}
              onChange={e => setOverlayText(e.target.value)}
              onBlur={() => setEditingText(false)}
              placeholder="Type something…"
              rows={3}
              className="bg-transparent border-none outline-none text-center w-4/5 resize-none placeholder-white/40 leading-snug font-bold text-3xl"
              style={{
                color:      textColor,
                fontFamily: FONTS[fontIdx].family,
                textShadow: '0 2px 10px rgba(0,0,0,0.95)',
                caretColor: textColor,
              }}
            />
          </div>
        )}

        {/* Positioned text — drag (desktop) + container-level touch (mobile) */}
        {!editingText && hasText && (
          <div
            ref={textRef}
            onClick={e => e.stopPropagation()} // prevent container toggle; tap-to-re-edit handled by mouse/touch handlers
            className="absolute"
            style={{
              left:       '50%',
              top:        '50%',
              transform:  'translate(-50%, -50%)',
              touchAction:'none',
              userSelect: 'none',
              cursor:     'grab',
              willChange: 'transform',
              fontSize:   '28px',
              fontWeight: 'bold',
              fontFamily: FONTS[fontIdx].family,
              color:      textColor,
              textShadow: '0 2px 10px rgba(0,0,0,0.95)',
              whiteSpace: 'pre-wrap',
              textAlign:  'center',
              maxWidth:   '80vw',
              lineHeight: 1.3,
            }}
          >
            {overlayText}
          </div>
        )}

        {/* Eyedropper pointer-capture overlay */}
        {eyedropperActive && (
          <div
            className="absolute inset-0"
            style={{ cursor: 'crosshair', touchAction: 'none', zIndex: 20 }}
            onPointerMove={onEyedropperPointerMove}
            onPointerUp={onEyedropperPointerUp}
          />
        )}

        {/* Eyedropper loupe */}
        {eyedropperActive && loupePos && (
          <div
            className="pointer-events-none fixed z-30 w-14 h-14 rounded-full border-4 border-white shadow-xl"
            style={{
              left:            loupePos.x,
              top:             loupePos.y,
              transform:       'translate(-50%, calc(-100% - 20px))',
              backgroundColor: loupePos.color,
              boxShadow:       '0 0 0 2px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.6)',
            }}
          />
        )}
      </div>

      {/* Hidden canvas for eyedropper pixel sampling */}
      <canvas ref={canvasRef} className="hidden" />

      {/* ── Font selector + color picker — shown when text exists ────── */}
      {hasText && (
        <div className="px-5 pt-3 pb-2 bg-black/85 space-y-3">

          {/* Font selector: three labeled options in their own fonts */}
          <div className="flex justify-center items-center gap-5">
            {FONTS.map((f, i) => (
              <button
                key={f.label}
                onClick={() => setFontIdx(i)}
                className="transition-opacity"
                style={{
                  fontFamily: f.family,
                  fontWeight: 'bold',
                  fontSize:   '15px',
                  color:      '#ffffff',
                  opacity:    fontIdx === i ? 1 : 0.35,
                  background: 'none',
                  border:     'none',
                  padding:    '4px 0',
                  cursor:     'pointer',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Hue slider */}
          <div className="relative h-7 rounded-full" style={{
            background: 'linear-gradient(to right,hsl(0,100%,50%),hsl(30,100%,50%),hsl(60,100%,50%),hsl(90,100%,50%),hsl(120,100%,50%),hsl(150,100%,50%),hsl(180,100%,50%),hsl(210,100%,50%),hsl(240,100%,50%),hsl(270,100%,50%),hsl(300,100%,50%),hsl(330,100%,50%),hsl(360,100%,50%))',
          }}>
            <input
              type="range" min="0" max="360" value={hue}
              onChange={e => {
                const h = Number(e.target.value);
                setHue(h);
                setTextColor(`hsl(${h},100%,50%)`);
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Color hue"
            />
            <div
              className="absolute top-1/2 w-6 h-6 rounded-full border-2 border-white shadow-lg pointer-events-none"
              style={{
                left:            `${(hue / 360) * 100}%`,
                transform:       'translateX(-50%) translateY(-50%)',
                backgroundColor: `hsl(${hue},100%,50%)`,
              }}
            />
          </div>

          {/* Quick color dots + eyedropper */}
          <div className="flex justify-center items-center gap-3">
            {QUICK_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setTextColor(c)}
                className="w-7 h-7 rounded-full transition-transform active:scale-90"
                style={{
                  backgroundColor: c,
                  border: textColor === c
                    ? '2.5px solid white'
                    : '1.5px solid rgba(255,255,255,0.35)',
                  boxShadow: textColor === c ? '0 0 0 1.5px rgba(0,0,0,0.5)' : undefined,
                }}
                aria-label={`Color ${c}`}
              />
            ))}

            {/* Eyedropper — images only */}
            {!isVideo && (
              <button
                onClick={activateEyedropper}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                  eyedropperActive
                    ? 'bg-white text-black'
                    : 'bg-white/15 text-white border border-white/35'
                }`}
                aria-label="Pick color from image"
              >
                <Pipette className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Action row ───────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-6 py-5 bg-black"
        style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={onCancel}
          disabled={uploading}
          className="flex-1 py-3 rounded-2xl border border-white/25 text-white text-sm font-semibold disabled:opacity-40"
        >
          Cancel
        </button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleConfirm}
          disabled={uploading}
          className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {uploading
            ? <><Loader2 className="w-4 h-4 animate-spin" />Posting…</>
            : 'Post Story'
          }
        </motion.button>
      </div>
    </motion.div>,
    document.body,
  );
}
