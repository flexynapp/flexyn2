// src/components/stories/StoryPreviewSheet.jsx
//
// Full-screen story editor shown before posting.
//
// Text overlay
//   Tap "Aa" → centered textarea opens for typing
//   Blur / tap background → textarea closes, styled text element appears
//   One-finger drag   → move text anywhere on screen
//   Two-finger pinch  → scale + rotate text
//
// Font presets (cycle button, top-left)
//   Normal  → Inter / system sans-serif
//   Serious → Georgia serif
//   Casual  → Comic Sans / cursive
//
// Color picker (shown once text exists)
//   Hue slider: continuous spectrum, slide to any color
//   Quick dots: white, black, red, blue, yellow, green

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

const FONTS = [
  { label: 'Normal',  family: "'Inter', system-ui, sans-serif" },
  { label: 'Serious', family: "Georgia, 'Times New Roman', serif" },
  { label: 'Casual',  family: "'Comic Sans MS', 'Chalkboard SE', cursive" },
];

const QUICK_COLORS = ['#ffffff', '#000000', '#ef4444', '#3b82f6', '#fbbf24', '#22c55e'];

export default function StoryPreviewSheet({ dataUrl, isVideo, uploading, onConfirm, onCancel }) {
  const [overlayText,  setOverlayText]  = useState('');
  const [editingText,  setEditingText]  = useState(false);
  const [fontIdx,      setFontIdx]      = useState(0);
  const [textColor,    setTextColor]    = useState('#ffffff');
  const [hue,          setHue]          = useState(0);

  const inputRef    = useRef(null);
  const textRef     = useRef(null);
  const containerRef = useRef(null);

  // Gesture state — updated via DOM refs to avoid React re-render lag
  const ts = useRef({
    x: 0, y: 0, scale: 1, rotate: 0,
    mode: null,
    lastX: 0, lastY: 0,
    startDist: 0, startAngle: 0, startScale: 1, startRotate: 0,
  });

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editingText) inputRef.current?.focus();
  }, [editingText]);

  // Apply stored transform to the DOM element directly (no React state = no lag)
  const applyTransform = () => {
    if (!textRef.current) return;
    const { x, y, scale, rotate } = ts.current;
    textRef.current.style.transform =
      `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale}) rotate(${rotate}deg)`;
  };

  // Attach non-passive touch listeners to the text element
  // (passive: false is required so we can call preventDefault on touchmove)
  useEffect(() => {
    const el = textRef.current;
    if (!el || editingText || !overlayText.trim()) return;

    const g = ts.current;

    const onTouchStart = (e) => {
      if (e.touches.length === 1) {
        g.mode  = 'drag';
        g.lastX = e.touches[0].clientX;
        g.lastY = e.touches[0].clientY;
      } else if (e.touches.length >= 2) {
        e.preventDefault();
        g.mode       = 'pinch';
        g.startDist  = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY,
        );
        g.startAngle  = Math.atan2(
          e.touches[1].clientY - e.touches[0].clientY,
          e.touches[1].clientX - e.touches[0].clientX,
        ) * 180 / Math.PI;
        g.startScale  = g.scale;
        g.startRotate = g.rotate;
      }
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && g.mode === 'drag') {
        g.x    += e.touches[0].clientX - g.lastX;
        g.y    += e.touches[0].clientY - g.lastY;
        g.lastX = e.touches[0].clientX;
        g.lastY = e.touches[0].clientY;
        applyTransform();
      } else if (e.touches.length >= 2) {
        g.mode = 'pinch';
        const dist  = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY,
        );
        const angle = Math.atan2(
          e.touches[1].clientY - e.touches[0].clientY,
          e.touches[1].clientX - e.touches[0].clientX,
        ) * 180 / Math.PI;
        if (g.startDist > 0) {
          g.scale  = Math.max(0.2, Math.min(8, g.startScale * dist / g.startDist));
          g.rotate = g.startRotate + angle - g.startAngle;
        }
        applyTransform();
      }
    };

    const onTouchEnd = (e) => {
      if (e.touches.length === 0) {
        g.mode = null;
      } else if (e.touches.length === 1 && g.mode === 'pinch') {
        g.mode  = 'drag';
        g.lastX = e.touches[0].clientX;
        g.lastY = e.touches[0].clientY;
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove',  onTouchMove,  { passive: false });
    el.addEventListener('touchend',   onTouchEnd,   { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
    };
  }, [editingText, overlayText]);

  // Mouse drag for desktop preview / testing
  useEffect(() => {
    const el = textRef.current;
    if (!el || editingText || !overlayText.trim()) return;
    const g = ts.current;

    const onMouseDown = (e) => {
      g.mode  = 'drag';
      g.lastX = e.clientX;
      g.lastY = e.clientY;
    };
    const onMouseMove = (e) => {
      if (g.mode !== 'drag') return;
      g.x    += e.clientX - g.lastX;
      g.y    += e.clientY - g.lastY;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      applyTransform();
    };
    const onMouseUp = () => { g.mode = null; };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, [editingText, overlayText]);

  const handleConfirm = () => {
    const g    = ts.current;
    const rect = containerRef.current?.getBoundingClientRect();
    const style = overlayText.trim() ? {
      text:     overlayText.trim(),
      xFrac:    rect ? g.x / rect.width  : 0,
      yFrac:    rect ? g.y / rect.height : 0,
      scale:    g.scale,
      rotation: g.rotate,
      color:    textColor,
      font:     FONTS[fontIdx].label.toLowerCase(),
    } : null;
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
        {/* Font cycle */}
        <button
          onClick={() => setFontIdx(i => (i + 1) % FONTS.length)}
          className="h-9 px-3.5 rounded-full bg-black/55 text-white text-sm font-bold backdrop-blur-sm border border-white/15"
          style={{ fontFamily: FONTS[fontIdx].family }}
        >
          {FONTS[fontIdx].label}
        </button>

        {/* Aa toggle */}
        <button
          onClick={() => { setEditingText(v => !v); }}
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
        onClick={() => { if (editingText) setEditingText(false); }}
      >
        {isVideo ? (
          <video
            src={dataUrl}
            autoPlay loop muted playsInline
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          <img
            src={dataUrl}
            alt="Story preview"
            className="absolute inset-0 w-full h-full object-contain"
            draggable={false}
          />
        )}

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
                color:       textColor,
                fontFamily:  FONTS[fontIdx].family,
                textShadow:  '0 2px 10px rgba(0,0,0,0.95)',
                caretColor:  textColor,
              }}
            />
          </div>
        )}

        {/* Positioned text — drag + pinch-to-zoom */}
        {!editingText && hasText && (
          <div
            ref={textRef}
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
      </div>

      {/* ── Color picker — shown when text exists ────────────────────── */}
      {hasText && (
        <div className="px-5 pt-3 pb-2 bg-black/85 space-y-2.5">
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
            {/* Custom thumb */}
            <div
              className="absolute top-1/2 w-6 h-6 rounded-full border-2 border-white shadow-lg pointer-events-none"
              style={{
                left:            `${(hue / 360) * 100}%`,
                transform:       'translateX(-50%) translateY(-50%)',
                backgroundColor: `hsl(${hue},100%,50%)`,
              }}
            />
          </div>

          {/* Quick color dots */}
          <div className="flex justify-center gap-3">
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
