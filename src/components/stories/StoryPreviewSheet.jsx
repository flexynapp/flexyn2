// src/components/stories/StoryPreviewSheet.jsx
//
// Full-screen story editor shown before posting. (Rewritten editor.)
//
// Frame
//   Locked to a 9:16 phone frame so desktop + phone arrange/post identically.
//
// Overlays (text + emoji) — up to 3 text boxes
//   Tap "Aa" → adds a new text box (max 3), selected + ready to type.
//   Tap a box → selects it (dashed outline = its hit area). Tap again → edit.
//   Drag a box → move. The hit area IS the box, so it tracks size when scaled.
//   Selected box shows a ⤡ corner handle → drag to scale + rotate (one finger
//   or mouse; robust, no finicky pinch). Drag any box onto the trash to delete.
//
// Pencil
//   Tap the pencil → freehand draw with the current color. Strokes post as
//   normalized drawing overlays (rendered by StoryOverlayRenderer).
//
// Fonts: Normal | Serious | Casual | Pixel.  Color: hue slider + dots + eyedropper.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Pipette, Smile, X as XIcon, Pencil, Type, Trash2, Undo2, Move } from 'lucide-react';
import { toast } from '@/lib/toast';

const EMOJI_PALETTE = [
  '🔥','💪','🏋️','🏃','🥇','🎯','⚡','🚀',
  '❤️','😂','😍','🤩','😭','🙌','👏','👀',
  '💯','✨','⭐','🌟','🎉','🎊','🏆','👑',
  '😤','💀','😎','🤘','🙏','💥','🤯','⚽',
  '🏀','🥊','🥋','🤸','🧘','🤝','🤲','👊',
  '🍎','🥗','🥤','💧','☕','🍌','🥩','🥑',
  '☀️','🌙','🌈','❄️','🌊','🏔️','🌴','🏟️',
  '✅','❌','➕','➖','📈','📉','⏱️','⌛',
];

const FILTERS = [
  { label: 'Normal', css: 'none' },
  { label: 'B&W',    css: 'grayscale(1) contrast(1.1)' },
  { label: 'Vivid',  css: 'saturate(2.5) contrast(1.1)' },
  { label: 'Bright', css: 'brightness(1.3) contrast(1.05)' },
  { label: 'Warm',   css: 'sepia(0.2) saturate(1.4) hue-rotate(-10deg) brightness(1.04)' },
  { label: 'Cool',   css: 'saturate(1.15) hue-rotate(15deg) brightness(1.05) contrast(1.05)' },
  { label: 'Sepia',  css: 'sepia(0.7) contrast(1.05) brightness(1.02)' },
  { label: 'Fade',   css: 'contrast(0.85) saturate(0.7) brightness(1.05)' },
];

// `displayScale` shrinks tall-metric fonts in the picker so all the
// font-name pills line up visually. Press Start 2P's glyphs are noticeably
// taller than Inter/Georgia at the same px size — knocking the picker pill
// down to ~0.78 brings it back in line. The rendered overlay text uses its
// own per-font scale via `renderScale` so the in-canvas text isn't penalized.
const FONTS = [
  { label: 'Normal',  family: "'Figtree', system-ui, sans-serif",            displayScale: 1,    renderScale: 1   },
  { label: 'Serious', family: "Georgia, 'Times New Roman', serif",         displayScale: 1,    renderScale: 1   },
  { label: 'Casual',  family: "'Comic Sans MS', 'Chalkboard SE', cursive", displayScale: 1,    renderScale: 1   },
  { label: 'Pixel',   family: "'Press Start 2P', monospace",               displayScale: 0.7,  renderScale: 0.78 },
  { label: 'Script',  family: "'Caveat', 'Bradley Hand', cursive",         displayScale: 1.25, renderScale: 1.35 },
];

const QUICK_COLORS = ['#ffffff', '#000000', '#ef4444', '#3b82f6', '#fbbf24', '#22c55e'];
const MAX_TEXT = 3;
const uid = () => `o_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

// Returns '#000' / '#fff' — whichever contrasts better against `color`. Used
// for the "boxed" text style (Instagram-like): background = the chosen color,
// foreground = whatever stays readable on it. Handles #hex / rgb() / hsl()
// by letting the DOM resolve unknown forms to a computed rgb().
export function contrastOn(color) {
  if (!color) return '#fff';
  let r = 128, g = 128, b = 128;
  const hexMatch = String(color).match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    let rgb = String(color).match(/rgba?\(([^)]+)\)/i);
    if (rgb) {
      const parts = rgb[1].split(',').map(s => parseFloat(s.trim()));
      if (parts.length >= 3) { r = parts[0]; g = parts[1]; b = parts[2]; }
    } else if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      try {
        const probe = document.createElement('span');
        probe.style.color = color;
        probe.style.display = 'none';
        document.body.appendChild(probe);
        const computed = getComputedStyle(probe).color;
        document.body.removeChild(probe);
        const parts = (computed.match(/rgba?\(([^)]+)\)/i)?.[1] || '')
          .split(',').map(s => parseFloat(s.trim()));
        if (parts.length >= 3) { r = parts[0]; g = parts[1]; b = parts[2]; }
      } catch { /* keep neutral default */ }
    }
  }
  // Perceived luminance (Rec. 601).
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 160 ? '#000' : '#fff';
}

export default function StoryPreviewSheet({ dataUrl, isVideo, uploading, onConfirm, onCancel }) {
  // Unified movable overlays: text + emoji. Normalized x/y (0..1 of the frame).
  const [overlays, setOverlays] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId]   = useState(null);

  const [filterIdx,      setFilterIdx]      = useState(0);
  const [filterLabelVis, setFilterLabelVis] = useState(false);
  const filterLabelTimer = useRef(null);

  const [textColor, setTextColor] = useState('#ffffff');
  const [hue,       setHue]       = useState(0);

  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  // Drawing
  const [drawMode, setDrawMode] = useState(false);
  const [strokes,  setStrokes]  = useState([]); // [{ points:[[x,y]], color, width }]
  const [liveStroke, setLiveStroke] = useState(null);
  const drawingRef = useRef(false);

  // Eyedropper
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [loupePos, setLoupePos] = useState(null);
  const canvasRef = useRef(null);
  const imgNatRef = useRef({ w: 0, h: 0 });

  const frameRef    = useRef(null);   // the 9:16 frame (coordinate space)
  const mediaElRef  = useRef(null);
  const inputRef    = useRef(null);

  // Drag/handle gesture state (refs to avoid re-render churn mid-gesture)
  const drag = useRef(null);   // { id, moved } for move drags
  const handle = useRef(null); // { id, cx, cy, startDist, startAngle, startScale, startRotate }
  // Multi-touch pinch: track ALL active pointers per overlay so a second
  // finger on the same text/emoji enters pinch-to-zoom (scale changes with
  // the finger-distance ratio). When pointer count drops below 2 we end the
  // pinch and fall back to single-finger drag if a finger remains.
  const pointersRef = useRef(new Map()); // pointerId -> { x, y, overlayId }
  const pinchRef    = useRef(null);       // { overlayId, startDist, startScale }
  // Mirror overlays into a ref so the pointer handlers can read the current
  // scale at pinch-start without a stale closure (callbacks would otherwise
  // need `overlays` in deps and re-bind on every overlay edit).
  const overlaysRef = useRef(overlays);
  useEffect(() => { overlaysRef.current = overlays; }, [overlays]);
  const [overTrash, setOverTrash] = useState(false);
  const [dragging, setDragging]   = useState(false);
  // Ref-mirrored so the touch-end filter-swipe handler (which runs
  // off a native listener and doesn't see fresh React state) can bail
  // when a text overlay is actively being dragged. Without this, a
  // text drag that ends with a left/right motion silently flips the
  // photo filter on top of moving the text.
  const draggingRef = useRef(false);
  useEffect(() => { draggingRef.current = dragging; }, [dragging]);

  const selected = overlays.find(o => o.id === selectedId) || null;
  const textCount = overlays.filter(o => o.kind === 'text').length;

  // ── helpers ───────────────────────────────────────────────────────────────
  const normFromEvent = useCallback((clientX, clientY) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0.5, y: 0.5 };
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top)  / rect.height)),
    };
  }, []);

  const updateOverlay = useCallback((id, patch) => {
    setOverlays(curr => curr.map(o => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  const deleteOverlay = useCallback((id) => {
    setOverlays(curr => curr.filter(o => o.id !== id));
    setSelectedId(s => (s === id ? null : s));
    setEditingId(e => (e === id ? null : e));
  }, []);

  const addText = useCallback(() => {
    if (textCount >= MAX_TEXT) { toast.error(`Up to ${MAX_TEXT} text boxes.`); return; }
    const id = uid();
    setOverlays(curr => [...curr, {
      id, kind: 'text', text: '', color: textColor, fontIdx: 0, boxed: false,
      x: 0.5, y: 0.42, scale: 1, rotate: 0, width: 0.7,
    }]);
    setSelectedId(id);
    setEditingId(id);
  }, [textCount, textColor]);

  const addEmoji = useCallback((emoji) => {
    const id = uid();
    setOverlays(curr => [...curr, { id, kind: 'emoji', emoji, x: 0.5, y: 0.5, scale: 1, rotate: 0 }]);
    setSelectedId(id);
    setEmojiPickerOpen(false);
  }, []);

  // ── filter cycling (horizontal swipe on empty frame) ───────────────────────
  const cycleFilter = useCallback((direction) => {
    setFilterIdx(i => (i + direction + FILTERS.length) % FILTERS.length);
    setFilterLabelVis(true);
    clearTimeout(filterLabelTimer.current);
    filterLabelTimer.current = setTimeout(() => setFilterLabelVis(false), 1500);
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || drawMode) return undefined;
    let startX, startY, single;
    const onStart = (e) => {
      single = e.touches.length === 1;
      if (single) { startX = e.touches[0].clientX; startY = e.touches[0].clientY; }
    };
    const onEnd = (e) => {
      if (!single || startX == null || e.changedTouches.length !== 1) return;
      // Lock the filter while a text/emoji overlay is being dragged —
      // otherwise a left/right drag-to-move silently doubles as a
      // filter-swipe at touch-end. The drag handler clears this on
      // pointerup, so by the time the touchend fires for a NON-overlay
      // swipe the ref is back to false.
      if (draggingRef.current) { startX = null; return; }
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 80) cycleFilter(dx < 0 ? 1 : -1);
      startX = null;
    };
    frame.addEventListener('touchstart', onStart, { passive: true });
    frame.addEventListener('touchend', onEnd, { passive: true });
    return () => { frame.removeEventListener('touchstart', onStart); frame.removeEventListener('touchend', onEnd); };
  }, [cycleFilter, drawMode]);

  useEffect(() => { if (editingId) inputRef.current?.focus(); }, [editingId]);

  const isOverTrash = useCallback((clientX, clientY) => {
    // Trash sits bottom-center; treat the lower-center band as the drop zone.
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const relY = (clientY - rect.top) / rect.height;
    const relX = (clientX - rect.left) / rect.width;
    return relY > 0.86 && relX > 0.32 && relX < 0.68;
  }, []);

  // ── move drag + pinch-zoom (per overlay element; hit area = the element) ─
  const onOverlayPointerDown = useCallback((e, id) => {
    if (drawMode) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelectedId(id);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, overlayId: id });
    // Two fingers on the SAME overlay → enter pinch.
    const own = Array.from(pointersRef.current.values()).filter(p => p.overlayId === id);
    if (own.length === 2) {
      const [p1, p2] = own;
      const startDist = Math.max(8, Math.hypot(p1.x - p2.x, p1.y - p2.y));
      const ov = overlaysRef.current.find(o => o.id === id);
      pinchRef.current = { overlayId: id, startDist, startScale: ov?.scale || 1 };
      drag.current = null;
      setDragging(false);
      setOverTrash(false);
      return;
    }
    drag.current = { id, moved: false };
    setDragging(true);
  }, [drawMode]);

  const onOverlayPointerMove = useCallback((e, id) => {
    if (pointersRef.current.has(e.pointerId)) {
      const p = pointersRef.current.get(e.pointerId);
      pointersRef.current.set(e.pointerId, { ...p, x: e.clientX, y: e.clientY });
    }
    // Pinch in progress on this overlay?
    if (pinchRef.current && pinchRef.current.overlayId === id) {
      const own = Array.from(pointersRef.current.values()).filter(p => p.overlayId === id);
      if (own.length >= 2) {
        const [p1, p2] = own;
        const dist = Math.max(8, Math.hypot(p1.x - p2.x, p1.y - p2.y));
        const scale = Math.max(0.3, Math.min(6, pinchRef.current.startScale * dist / pinchRef.current.startDist));
        updateOverlay(id, { scale });
        return;
      }
    }
    // Single-finger drag.
    if (!drag.current || drag.current.id !== id) return;
    drag.current.moved = true;
    const { x, y } = normFromEvent(e.clientX, e.clientY);
    updateOverlay(id, { x, y });
    setOverTrash(isOverTrash(e.clientX, e.clientY));
  }, [normFromEvent, updateOverlay, isOverTrash]);

  const onOverlayPointerUp = useCallback((e, id, kind) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    // If we were pinching, exit pinch mode once <2 fingers remain on this
    // overlay. A leftover finger transitions back into a drag (but suppress
    // the tap-to-edit since the user clearly meant to manipulate, not tap).
    if (pinchRef.current && pinchRef.current.overlayId === id) {
      const own = Array.from(pointersRef.current.values()).filter(p => p.overlayId === id);
      if (own.length < 2) {
        pinchRef.current = null;
        if (own.length === 1) {
          drag.current = { id, moved: true };
          setDragging(true);
        }
      }
      return;
    }
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    const wasOverTrash = overTrash;
    setOverTrash(false);
    if (wasOverTrash) { deleteOverlay(id); return; }
    if (d && !d.moved && kind === 'text') setEditingId(id); // tap text → edit
  }, [overTrash, deleteOverlay]);

  // ── width handles (text only) — drag the left/right edge to control the
  //    text box's wrap width. Symmetric: a single side's drag pushes both
  //    edges so the centered text stays centered. Frame-relative fraction
  //    (0.2..1.0) so a long word like "omnivore" can stretch to one line, or
  //    a phrase can be squeezed into 2–3 lines. ──────────────────────────
  const widthHandle = useRef(null);
  const onWidthHandleDown = useCallback((e, ov, side) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    widthHandle.current = {
      id: ov.id, side,
      startX: e.clientX,
      startWidth: ov.width != null ? ov.width : 0.7,
      startScale: ov.scale || 1,
    };
  }, []);
  const onWidthHandleMove = useCallback((e) => {
    const w = widthHandle.current;
    if (!w) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const dx = e.clientX - w.startX;
    // Scale-aware: at scale=2, each px of finger drag is a smaller fraction
    // of the un-transformed wrapper. The ×2 makes the drag symmetric — drag
    // one edge by N px and the BOX grows 2N (so the opposite edge appears
    // to move too, since the box is center-anchored).
    const deltaFrac = (dx / rect.width) / (w.startScale || 1);
    const sign = w.side === 'right' ? 1 : -1;
    const next = Math.max(0.2, Math.min(1, w.startWidth + sign * deltaFrac * 2));
    updateOverlay(w.id, { width: next });
  }, [updateOverlay]);
  const onWidthHandleUp = useCallback((e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    widthHandle.current = null;
  }, []);

  // ── scale + rotate handle (single pointer) ──────────────────────────────────
  const onHandleDown = useCallback((e, ov) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + ov.x * rect.width;
    const cy = rect.top  + ov.y * rect.height;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    handle.current = {
      id: ov.id, cx, cy,
      startDist: Math.max(8, Math.hypot(dx, dy)),
      startAngle: Math.atan2(dy, dx),
      startScale: ov.scale || 1,
      startRotate: ov.rotate || 0,
    };
  }, []);

  const onHandleMove = useCallback((e) => {
    const h = handle.current;
    if (!h) return;
    const dx = e.clientX - h.cx, dy = e.clientY - h.cy;
    const dist = Math.max(8, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const scale = Math.max(0.3, Math.min(6, h.startScale * dist / h.startDist));
    const rotate = h.startRotate + (angle - h.startAngle) * 180 / Math.PI;
    updateOverlay(h.id, { scale, rotate });
  }, [updateOverlay]);

  const onHandleUp = useCallback((e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    handle.current = null;
  }, []);

  // ── drawing ─────────────────────────────────────────────────────────────────
  const onDrawDown = useCallback((e) => {
    if (!drawMode) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const { x, y } = normFromEvent(e.clientX, e.clientY);
    setLiveStroke({ points: [[x, y]], color: textColor, width: 5 });
  }, [drawMode, normFromEvent, textColor]);

  const onDrawMove = useCallback((e) => {
    if (!drawMode || !drawingRef.current) return;
    const { x, y } = normFromEvent(e.clientX, e.clientY);
    setLiveStroke(s => (s ? { ...s, points: [...s.points, [x, y]] } : s));
  }, [drawMode, normFromEvent]);

  const onDrawUp = useCallback((e) => {
    if (!drawMode) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    drawingRef.current = false;
    setLiveStroke(s => {
      if (s && s.points.length > 1) setStrokes(curr => [...curr, s]);
      return null;
    });
  }, [drawMode]);

  const undoStroke = useCallback(() => setStrokes(curr => curr.slice(0, -1)), []);

  // ── eyedropper ───────────────────────────────────────────────────────────────
  const activateEyedropper = useCallback(() => {
    const imgEl = mediaElRef.current;
    if (!imgEl || isVideo) return;
    const canvas = canvasRef.current;
    const natW = imgEl.naturalWidth || 1, natH = imgEl.naturalHeight || 1;
    imgNatRef.current = { w: natW, h: natH };
    canvas.width = natW; canvas.height = natH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Sample the FILTERED image, not the raw original — otherwise picking a
    // color while B&W / Sepia is active returns the original photo's color
    // and feels broken. Canvas2D's `ctx.filter` accepts the same syntax as
    // the CSS filter property, so we just mirror the active filter here.
    ctx.filter = FILTERS[filterIdx].css || 'none';
    ctx.drawImage(imgEl, 0, 0, natW, natH);
    ctx.filter = 'none';
    setEyedropperActive(true);
  }, [isVideo, filterIdx]);

  const samplePixel = useCallback((clientX, clientY) => {
    const frame = frameRef.current, canvas = canvasRef.current;
    if (!frame || !canvas) return null;
    const { w: natW, h: natH } = imgNatRef.current;
    const rect = frame.getBoundingClientRect();
    const scale = Math.min(rect.width / natW, rect.height / natH);
    const offX = (rect.width - natW * scale) / 2, offY = (rect.height - natH * scale) / 2;
    const cx = Math.round((clientX - rect.left - offX) / scale);
    const cy = Math.round((clientY - rect.top - offY) / scale);
    if (cx < 0 || cy < 0 || cx >= natW || cy >= natH) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const [r, g, b] = ctx.getImageData(cx, cy, 1, 1).data;
    return `rgb(${r},${g},${b})`;
  }, []);

  // ── confirm ──────────────────────────────────────────────────────────────────
  // Synchronous in-flight guard. `disabled={uploading}` on the button
  // gates re-entry, but state updates lag the click handler — a fast
  // double-tap fires onConfirm twice before React re-renders, producing
  // two storage uploads + two duplicate stories rows. Same defect class
  // as Waves 47–49 (Crew, RegisterGym, CreateBounty, Workout).
  const postingRef = useRef(false);
  // Reset the ref when uploading transitions back to false so a real
  // error path lets the user retry.
  useEffect(() => { if (!uploading) postingRef.current = false; }, [uploading]);
  const handleConfirm = () => {
    if (postingRef.current || uploading) return;
    postingRef.current = true;
    try {
      const out = [];
      overlays.forEach(o => {
        if (o.kind === 'text' && o.text.trim()) {
          out.push({ kind: 'text', text: o.text.trim(), x: o.x, y: o.y, scale: o.scale, rotation: o.rotate, color: o.color, font: FONTS[o.fontIdx || 0].label.toLowerCase(), boxed: !!o.boxed, width: o.width != null ? o.width : 0.7 });
        } else if (o.kind === 'emoji') {
          out.push({ kind: 'emoji', emoji: o.emoji, x: o.x, y: o.y, scale: o.scale, rotation: o.rotate });
        }
      });
      strokes.forEach(s => out.push({ kind: 'drawing', points: s.points, color: s.color, width: s.width, x: 0.5, y: 0.5, scale: 1, rotation: 0 }));
      const filter = FILTERS[filterIdx].css !== 'none' ? FILTERS[filterIdx].css : null;
      onConfirm(filter ? { filter } : null, out);
    } catch (err) {
      // Reset the in-flight guard if onConfirm throws synchronously —
      // otherwise the post button is stuck disabled until next mount.
      postingRef.current = false;
      throw err;
    }
  };

  // Color change applies to the selected text overlay + future text/strokes.
  const applyColor = (c) => {
    setTextColor(c);
    if (selected?.kind === 'text') updateOverlay(selected.id, { color: c });
  };
  // Tapping a font picks it. Tapping the SAME font that's already active
  // toggles the "boxed" style — soft colored background around the text,
  // Instagram-style. Lets the user cycle plain ↔ boxed without a separate
  // toggle button.
  const applyFont = (idx) => {
    if (selected?.kind !== 'text') return;
    if ((selected.fontIdx || 0) === idx) {
      updateOverlay(selected.id, { boxed: !selected.boxed });
    } else {
      updateOverlay(selected.id, { fontIdx: idx });
    }
  };

  const showColorBar = (selected?.kind === 'text') || drawMode;

  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-[9999] bg-black flex flex-col"
    >
      {/* Top controls */}
      <div className="absolute top-0 start-0 end-0 z-30 flex items-center justify-between px-4"
        style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
        <button onClick={onCancel} className="w-10 h-10 rounded-full bg-black/55 flex items-center justify-center border border-white/15 backdrop-blur-sm text-white" aria-label="Cancel">
          <XIcon className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => { setDrawMode(d => !d); setSelectedId(null); setEditingId(null); }}
            className={`w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${drawMode ? 'bg-white text-black border-white' : 'bg-black/55 text-white border-white/15 backdrop-blur-sm'}`}
            aria-label="Draw">
            <Pencil className="w-4 h-4" />
          </button>
          {drawMode && strokes.length > 0 && (
            <button onClick={undoStroke} className="w-10 h-10 rounded-full bg-black/55 text-white border border-white/15 backdrop-blur-sm flex items-center justify-center" aria-label="Undo stroke">
              <Undo2 className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => { setDrawMode(false); setEmojiPickerOpen(v => !v); }}
            className={`w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${emojiPickerOpen ? 'bg-white text-black border-white' : 'bg-black/55 text-white border-white/15 backdrop-blur-sm'}`}
            aria-label="Add emoji">
            <Smile className="w-4 h-4" />
          </button>
          <button onClick={() => { setDrawMode(false); addText(); }}
            className="w-10 h-10 rounded-full flex items-center justify-center border bg-black/55 text-white border-white/15 backdrop-blur-sm" aria-label="Add text">
            <Type className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 9:16 phone frame — consistent on desktop + phone. The flex-1
          container is `relative` so the font/color bar can float at the
          bottom as an absolute overlay — that keeps the frame size constant
          when text/draw toggles instead of reflowing the photo. */}
      <div className="flex-1 flex items-center justify-center overflow-hidden relative">
        <div
          ref={frameRef}
          className="relative overflow-hidden bg-black"
          style={{ aspectRatio: '9 / 16', height: '100%', maxWidth: '100%', maxHeight: '100%', touchAction: 'none' }}
        >
          {isVideo ? (
            <video ref={mediaElRef} src={dataUrl} autoPlay loop muted playsInline
              className="absolute inset-0 w-full h-full object-contain" style={{ filter: FILTERS[filterIdx].css }} />
          ) : (
            <img loading="lazy" ref={mediaElRef} src={dataUrl} alt="Story preview" draggable={false}
              className="absolute inset-0 w-full h-full object-contain" style={{ filter: FILTERS[filterIdx].css }} />
          )}

          {/* Committed + live drawings */}
          {(strokes.length > 0 || liveStroke) && (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
              {[...strokes, ...(liveStroke ? [liveStroke] : [])].map((s, i) => (
                <path key={i} d={s.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p[0] * 100} ${p[1] * 100}`).join(' ')}
                  fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          )}

          {/* Filter label + dots */}
          <AnimatePresence>
            {filterLabelVis && (
              <motion.div key={filterIdx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute top-1/2 start-1/2 pointer-events-none" style={{ transform: 'translate(-50%, -50%)' }}>
                <div className="px-4 py-2 rounded-full bg-black/55 backdrop-blur-sm border border-white/20">
                  <span className="text-white text-sm font-semibold">{FILTERS[filterIdx].label}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="absolute bottom-3 start-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-none">
            {FILTERS.map((_, i) => (
              <div key={i} className="rounded-full" style={{ width: i === filterIdx ? 16 : 5, height: 5, backgroundColor: i === filterIdx ? '#fff' : 'rgba(255,255,255,0.45)' }} />
            ))}
          </div>

          {/* Movable overlays (text + emoji) */}
          {overlays.map(o => {
            const isSel = o.id === selectedId;
            const isEditing = o.id === editingId;
            if (o.kind === 'text' && isEditing) {
              const f = FONTS[o.fontIdx || 0];
              const rs = f.renderScale ?? 1;
              const fg = o.boxed ? contrastOn(o.color || '#fff') : (o.color || '#fff');
              return (
                <div key={o.id} className="absolute" style={{
                  left: `${o.x * 100}%`, top: `${o.y * 100}%`,
                  transform: `translate(-50%,-50%) rotate(${o.rotate}deg)`,
                  width: `${(o.width != null ? o.width : 0.7) * 100}%`, zIndex: 15,
                  background: o.boxed ? (o.color || '#fff') : 'transparent',
                  padding: o.boxed ? '8px 14px' : 0,
                  borderRadius: 14,
                }}>
                  <textarea
                    ref={inputRef}
                    value={o.text}
                    onChange={e => updateOverlay(o.id, { text: e.target.value })}
                    onBlur={() => { setEditingId(null); if (!o.text.trim()) deleteOverlay(o.id); }}
                    placeholder="Type…"
                    rows={2}
                    className="bg-transparent border-none outline-none text-center w-full resize-none placeholder-white/40 leading-snug font-bold"
                    style={{
                      color: fg,
                      fontFamily: f.family,
                      fontSize: `${28 * (o.scale || 1) * rs}px`,
                      textShadow: o.boxed ? 'none' : '0 2px 10px rgba(0,0,0,0.95)',
                      caretColor: fg,
                    }}
                  />
                </div>
              );
            }
            return (
              <div
                key={o.id}
                onPointerDown={(e) => onOverlayPointerDown(e, o.id)}
                onPointerMove={(e) => onOverlayPointerMove(e, o.id)}
                onPointerUp={(e) => onOverlayPointerUp(e, o.id, o.kind)}
                className="absolute select-none"
                style={{
                  left: `${o.x * 100}%`, top: `${o.y * 100}%`,
                  transform: `translate(-50%,-50%) scale(${o.scale}) rotate(${o.rotate}deg)`,
                  transformOrigin: 'center center',
                  zIndex: isSel ? 15 : 10,
                  cursor: drawMode ? 'default' : 'grab', touchAction: 'none',
                  pointerEvents: drawMode ? 'none' : 'auto',
                  padding: 6,
                  border: isSel ? '1.5px dashed rgba(255,255,255,0.9)' : '1.5px dashed transparent',
                  borderRadius: 8,
                  // Text overlays get an explicit width (frame-relative) so the
                  // wrap is user-controlled — drag the side handles to stretch a
                  // long word onto one line or squeeze a phrase into 2–3 lines.
                  // Emoji stays content-sized.
                  width: o.kind === 'text' ? `${(o.width != null ? o.width : 0.7) * 100}%` : undefined,
                }}
              >
                {o.kind === 'emoji' ? (
                  <span style={{ fontSize: 56, lineHeight: 1, textShadow: '0 2px 8px rgba(0,0,0,0.45)' }}>{o.emoji}</span>
                ) : (() => {
                  const f = FONTS[o.fontIdx || 0];
                  const rs = f.renderScale ?? 1;
                  const fg = o.boxed ? contrastOn(o.color || '#fff') : (o.color || '#fff');
                  return (
                    <span style={{
                      display: 'block',           // fill the wrapper so the user-controlled width drives wrap
                      background: o.boxed ? (o.color || '#fff') : 'transparent',
                      padding: o.boxed ? '6px 12px' : 0,
                      borderRadius: 12,
                      color: fg,
                      fontSize: 28 * rs,
                      fontWeight: 'bold',
                      fontFamily: f.family,
                      textShadow: o.boxed ? 'none' : '0 2px 10px rgba(0,0,0,0.95)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      textAlign: 'center',
                      width: '100%',
                    }}>
                      {o.text || ' '}
                    </span>
                  );
                })()}
                {/* Width handles (text only) — drag left/right edge to
                    control the wrap width so a long word fits on one line
                    or a phrase compacts to 2–3. */}
                {isSel && !drawMode && o.kind === 'text' && (
                  <>
                    <div
                      onPointerDown={(e) => onWidthHandleDown(e, o, 'left')}
                      onPointerMove={onWidthHandleMove}
                      onPointerUp={onWidthHandleUp}
                      className="absolute top-1/2 -start-2 -translate-y-1/2 w-2.5 h-10 rounded-full bg-white/85 shadow-md"
                      style={{ cursor: 'ew-resize', touchAction: 'none' }}
                      aria-label="Adjust text width (left)"
                    />
                    <div
                      onPointerDown={(e) => onWidthHandleDown(e, o, 'right')}
                      onPointerMove={onWidthHandleMove}
                      onPointerUp={onWidthHandleUp}
                      className="absolute top-1/2 -end-2 -translate-y-1/2 w-2.5 h-10 rounded-full bg-white/85 shadow-md"
                      style={{ cursor: 'ew-resize', touchAction: 'none' }}
                      aria-label="Adjust text width (right)"
                    />
                  </>
                )}
                {/* scale + rotate handle (selected only) */}
                {isSel && !drawMode && (
                  <div
                    onPointerDown={(e) => onHandleDown(e, o)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    className="absolute -bottom-3 -end-3 w-6 h-6 rounded-full bg-white text-black flex items-center justify-center shadow-md"
                    style={{ cursor: 'nwse-resize', touchAction: 'none' }}
                    aria-label="Resize and rotate"
                  >
                    <Move className="w-3 h-3" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Draw capture layer (only while drawing) */}
          {drawMode && (
            <div className="absolute inset-0 z-20" style={{ touchAction: 'none', cursor: 'crosshair' }}
              onPointerDown={onDrawDown} onPointerMove={onDrawMove} onPointerUp={onDrawUp} onPointerCancel={onDrawUp} />
          )}

          {/* Deselect on empty tap (when not drawing) */}
          {!drawMode && (
            <div className="absolute inset-0 z-0" onClick={() => { setSelectedId(null); setEditingId(null); }} />
          )}

          {/* Trash drop zone — appears while dragging an overlay */}
          <AnimatePresence>
            {dragging && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-6 start-1/2 -translate-x-1/2 z-30 pointer-events-none flex flex-col items-center gap-1">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 transition-colors ${overTrash ? 'bg-red-500 border-red-300 scale-110' : 'bg-black/60 border-white/30'}`}>
                  <Trash2 className={`w-6 h-6 ${overTrash ? 'text-white' : 'text-white/80'}`} />
                </div>
                <span className="text-[10px] text-white/70 font-semibold">drag here to delete</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Eyedropper */}
          {eyedropperActive && (
            <div className="absolute inset-0 z-40" style={{ cursor: 'crosshair', touchAction: 'none' }}
              onPointerMove={(e) => { const c = samplePixel(e.clientX, e.clientY); setLoupePos({ x: e.clientX, y: e.clientY, color: c ?? '#fff' }); }}
              onPointerUp={(e) => { const c = samplePixel(e.clientX, e.clientY); if (c) applyColor(c); setEyedropperActive(false); setLoupePos(null); }} />
          )}
          {eyedropperActive && loupePos && (
            <div className="pointer-events-none fixed z-50 w-14 h-14 rounded-full border-4 border-white shadow-xl"
              style={{ left: loupePos.x, top: loupePos.y, transform: 'translate(-50%, calc(-100% - 20px))', backgroundColor: loupePos.color }} />
          )}
        </div>

        {/* Font + color bar — absolute overlay over the frame's bottom so
            the photo never reflows / "zooms out" when text or draw mode
            toggles. Backdrop-blur keeps it legible over any image. */}
        {showColorBar && (
          <div className="absolute bottom-0 start-0 end-0 z-30 px-5 pt-3 pb-2 bg-black/85 backdrop-blur-sm space-y-3">
            {selected?.kind === 'text' && (
              <div className="flex justify-center items-center gap-5 flex-wrap">
                {FONTS.map((f, i) => {
                  const active = (selected.fontIdx || 0) === i;
                  const showBoxed = active && selected.boxed;
                  return (
                    <button key={f.label} onClick={() => applyFont(i)}
                      title={active ? 'Tap again to toggle the colored box' : f.label}
                      style={{
                        fontFamily: f.family, fontWeight: 'bold',
                        fontSize: `${15 * (f.displayScale ?? 1)}px`,
                        color: showBoxed ? contrastOn(selected.color || '#fff') : '#fff',
                        opacity: active ? 1 : 0.45,
                        background: showBoxed ? (selected.color || '#fff') : 'transparent',
                        border: 'none',
                        borderRadius: showBoxed ? 6 : 0,
                        padding: showBoxed ? '3px 8px' : '4px 0',
                        cursor: 'pointer', lineHeight: 1.1,
                      }}>
                      {f.label}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="relative h-7 rounded-full" style={{ background: 'linear-gradient(to right,hsl(0,100%,50%),hsl(60,100%,50%),hsl(120,100%,50%),hsl(180,100%,50%),hsl(240,100%,50%),hsl(300,100%,50%),hsl(360,100%,50%))' }}>
              <input type="range" min="0" max="360" value={hue}
                onChange={e => { const h = Number(e.target.value); setHue(h); applyColor(`hsl(${h},100%,50%)`); }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" aria-label="Color hue" />
              <div className="absolute top-1/2 w-6 h-6 rounded-full border-2 border-white shadow-lg pointer-events-none"
                style={{ left: `${(hue / 360) * 100}%`, transform: 'translateX(-50%) translateY(-50%)', backgroundColor: `hsl(${hue},100%,50%)` }} />
            </div>
            <div className="flex justify-center items-center gap-3">
              {QUICK_COLORS.map(c => (
                <button key={c} onClick={() => applyColor(c)} className="w-7 h-7 rounded-full transition-transform active:scale-90"
                  style={{ backgroundColor: c, border: textColor === c ? '2.5px solid white' : '1.5px solid rgba(255,255,255,0.35)' }} aria-label={`Color ${c}`} />
              ))}
              {!isVideo && (
                <button onClick={activateEyedropper}
                  className={`w-7 h-7 rounded-full flex items-center justify-center ${eyedropperActive ? 'bg-white text-black' : 'bg-white/15 text-white border border-white/35'}`} aria-label="Pick color from image">
                  <Pipette className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Action row */}
      <div className="flex items-center gap-3 px-6 py-5 bg-black" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
        <button
          onClick={() => {
            // Grace check — if the user has done any editing
            // (drawings or overlay text/emoji), ask before discarding.
            // Previously Cancel was a one-tap drop with no undo, so a
            // mistap on the editor's edge erased minutes of work.
            const hasUnsaved = overlays.length > 0 || strokes.length > 0;
            if (hasUnsaved && typeof window !== 'undefined' && typeof window.confirm === 'function') {
              const ok = window.confirm('Discard your edits?');
              if (!ok) return;
            }
            onCancel?.();
          }}
          disabled={uploading}
          className="flex-1 py-3 rounded-2xl border border-white/25 text-white text-sm font-semibold disabled:opacity-40"
        >Cancel</button>
        <motion.button whileTap={{ scale: 0.96 }} onClick={handleConfirm} disabled={uploading}
          className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2">
          {uploading ? <><Loader2 className="w-4 h-4 animate-spin" />Posting…</> : 'Post Story'}
        </motion.button>
      </div>

      {/* Emoji picker drawer */}
      <AnimatePresence>
        {emojiPickerOpen && (
          <motion.div key="emoji-picker" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="absolute start-0 end-0 bottom-0 z-40 bg-black/90 backdrop-blur-md border-t border-white/15 rounded-t-2xl"
            style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-white/80 text-xs font-bold uppercase tracking-wide">Emoji</span>
              <button onClick={() => setEmojiPickerOpen(false)} className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white" aria-label="Close">
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-8 gap-1.5 px-4 pb-3 max-h-56 overflow-y-auto">
              {EMOJI_PALETTE.map(em => (
                <button key={em} onClick={() => addEmoji(em)} className="aspect-square rounded-lg hover:bg-white/10 active:bg-white/20 text-2xl flex items-center justify-center" aria-label={`Add ${em}`}>{em}</button>
              ))}
            </div>
            <p className="text-white/45 text-[10px] text-center pb-1">Tap to add · drag to position · drag onto 🗑 to delete</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>,
    document.body,
  );
}
