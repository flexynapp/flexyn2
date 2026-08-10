/**
 * PhotoCompareSlider — drag-divider side-by-side progress photo comparison.
 *
 * Let the user pick two photos from their library; a vertical divider
 * reveals/hides the "before" and "after" portions. Pointer + keyboard.
 *
 * Revised 2026-08-10 alongside the Photos tab revamp:
 *
 *   • Every string was hardcoded English — "Compare Photos", "Before",
 *     "Choose before", "N days apart", "Drag the divider to compare" — on
 *     a 15-language app. All go through `tFallback` now.
 *   • Dates went through date-fns `format()`, which binds no locale, so
 *     they stayed English under a translated screen. `useDateFormatter()`.
 *   • The picker's second line rendered the literal word "Workout" on
 *     every row: it read `photo.workoutName`, and progress photos have
 *     carried no workout label since they moved to Storage (mig 174 —
 *     object names encode capture time and nothing else). Removed rather
 *     than left showing a constant.
 *   • The "before" image was sized from `containerRef.current?.offsetWidth`
 *     READ DURING RENDER — null on the first pass, so it fell back to
 *     `100%` of the *clipped* wrapper and the before photo rendered
 *     horizontally squashed until something forced a re-render. It is
 *     clipped with `clip-path` now, which needs no pixel measurement.
 */
import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeftRight, Calendar, ChevronDown, X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useDateFormatter } from '@/lib/intl';
import { Card } from '@/components/ui/card';

// ── Photo picker dropdown ──────────────────────────────────────────────────────

function PhotoPicker({ photos, selected, onSelect, label, fmtDate }) {
  const [open, setOpen] = useState(false);
  const photo = photos.find(p => p.id === selected);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-secondary/70 border border-border/50 text-sm font-medium hover:bg-secondary active:bg-secondary transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="truncate">
            {photo ? fmtDate(new Date(photo.takenAt), { dateStyle: 'medium' }) : label}
          </span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className="absolute z-30 top-full mt-1 start-0 end-0 bg-card border border-border rounded-xl shadow-md overflow-hidden max-h-52 overflow-y-auto"
          >
            {photos.map(p => (
              <button
                key={p.id}
                onClick={() => { onSelect(p.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-start hover:bg-secondary/60 active:bg-secondary/60 transition-colors ${p.id === selected ? 'bg-primary/10' : ''}`}
              >
                <img loading="lazy" src={p.dataUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                <p className="text-sm font-medium leading-tight truncate">
                  {fmtDate(new Date(p.takenAt), { dateStyle: 'medium' })}
                </p>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PhotoCompareSlider({ photos, onClose }) {
  const { t, tFallback } = useLanguage();
  const fmtDate = useDateFormatter();

  // Default: oldest photo as "before", newest as "after"
  const sorted = [...photos].sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
  const [beforeId, setBeforeId] = useState(sorted[0]?.id || null);
  const [afterId,  setAfterId]  = useState(sorted[sorted.length - 1]?.id || null);

  const [sliderPct, setSliderPct] = useState(50);
  const containerRef = useRef(null);

  const beforePhoto = photos.find(p => p.id === beforeId);
  const afterPhoto  = photos.find(p => p.id === afterId);

  // ── Drag logic ─────────────────────────────────────────────────────────────
  // Pointer events cover mouse, touch and pen in one path, and pointer
  // capture keeps the drag alive when the finger leaves the element —
  // which is what the old window-level mousemove/mouseup listeners were
  // for. They are no longer needed, so nothing is bound outside this node.

  const updateSlider = useCallback((clientX) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct  = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    setSliderPct(pct);
  }, []);

  const onPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    updateSlider(e.clientX);
  }, [updateSlider]);

  const onPointerMove = useCallback((e) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) updateSlider(e.clientX);
  }, [updateSlider]);

  const onPointerUp = useCallback((e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  // Keyboard: the divider is a real slider, so it answers to arrows. The
  // previous version was drag-only and unreachable without a pointer.
  const onKeyDown = useCallback((e) => {
    const stepBy = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft')       setSliderPct(p => Math.max(0, p - stepBy));
    else if (e.key === 'ArrowRight') setSliderPct(p => Math.min(100, p + stepBy));
    else if (e.key === 'Home')       setSliderPct(0);
    else if (e.key === 'End')        setSliderPct(100);
    else return;
    e.preventDefault();
  }, []);

  const daysDiff = beforePhoto && afterPhoto
    ? Math.round((new Date(afterPhoto.takenAt) - new Date(beforePhoto.takenAt)) / 86400000)
    : null;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ArrowLeftRight className="w-4 h-4 text-primary shrink-0" />
          <h2 className="font-heading font-bold text-sm truncate">
            {tFallback('photos.compareTitle', 'Compare photos')}
          </h2>
          {daysDiff !== null && daysDiff > 0 && (
            <span className="text-micro bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold shrink-0">
              {daysDiff === 1
                ? tFallback('photos.compareApartOne', '1 day apart')
                : tFallback('photos.compareApartMany', '{{count}} days apart')
                    .replace('{{count}}', daysDiff)}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="relative before:absolute before:content-[''] before:-inset-2.5 w-7 h-7 rounded-lg bg-secondary hover:bg-secondary/80 active:bg-secondary/80 flex items-center justify-center transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Pickers — a fixed count of two, so grid is right here. */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            {tFallback('photos.compareBefore', 'Before')}
          </p>
          <PhotoPicker
            photos={photos}
            selected={beforeId}
            onSelect={setBeforeId}
            label={tFallback('photos.compareChooseBefore', 'Choose before')}
            fmtDate={fmtDate}
          />
        </div>
        <div>
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            {tFallback('photos.compareAfter', 'After')}
          </p>
          <PhotoPicker
            photos={photos}
            selected={afterId}
            onSelect={setAfterId}
            label={tFallback('photos.compareChooseAfter', 'Choose after')}
            fmtDate={fmtDate}
          />
        </div>
      </div>

      {/* Slider canvas */}
      {beforePhoto && afterPhoto ? (
        <Card className="overflow-hidden border-none shadow-md">
          <div
            ref={containerRef}
            className="relative select-none touch-none overflow-hidden"
            style={{ cursor: 'col-resize' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* After photo (full width, background) — sets the box height. */}
            <img loading="lazy" src={afterPhoto.dataUrl}
              alt={tFallback('photos.compareAfter', 'After')}
              className="w-full object-cover block"
              style={{ maxHeight: 420 }}
              draggable={false}
            />

            {/* Before photo, clipped to the left portion. clip-path rather
                than a width-constrained wrapper: the inner image keeps the
                container's full width, so it is CLIPPED rather than
                squashed, with no pixel measurement to get wrong. */}
            <div
              className="absolute inset-0"
              style={{ clipPath: `inset(0 ${100 - sliderPct}% 0 0)` }}
            >
              <img loading="lazy" src={beforePhoto.dataUrl}
                alt={tFallback('photos.compareBefore', 'Before')}
                className="w-full h-full object-cover block"
                draggable={false}
              />
            </div>

            {/* Divider line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none"
              style={{ left: `${sliderPct}%` }}
            />

            {/* Drag handle — the focusable control, so a keyboard user has
                somewhere to land. */}
            <div
              role="slider"
              tabIndex={0}
              aria-label={tFallback('photos.compareTitle', 'Compare photos')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(sliderPct)}
              onKeyDown={onKeyDown}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-white shadow-md flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              style={{ left: `${sliderPct}%` }}
            >
              <ArrowLeftRight className="w-4 h-4 text-slate-700" />
            </div>

            {/* Labels. Physical left/right, not logical start/end: they name
                the two halves of the image, and those halves do not mirror
                in RTL the way text does. */}
            <div className="absolute top-2 left-2 pointer-events-none">
              <span className="text-micro font-bold px-2 py-0.5 rounded-md bg-black/60 text-white">
                {tFallback('photos.compareBefore', 'Before')} · {fmtDate(new Date(beforePhoto.takenAt), { dateStyle: 'medium' })}
              </span>
            </div>
            <div className="absolute top-2 right-2 pointer-events-none">
              <span className="text-micro font-bold px-2 py-0.5 rounded-md bg-black/60 text-white">
                {tFallback('photos.compareAfter', 'After')} · {fmtDate(new Date(afterPhoto.takenAt), { dateStyle: 'medium' })}
              </span>
            </div>
          </div>

          <p className="text-center text-micro text-muted-foreground py-2">
            {tFallback('photos.compareDragHint', 'Drag the divider to compare')}
          </p>
        </Card>
      ) : (
        <Card className="p-8 text-center border-dashed">
          <ArrowLeftRight className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {tFallback('photos.compareEmpty', 'Pick two photos above to compare them.')}
          </p>
        </Card>
      )}
    </div>
  );
}
