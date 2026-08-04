/**
 * PhotoCompareSlider — drag-divider side-by-side progress photo comparison.
 *
 * Let the user pick two photos from their library; a vertical slider
 * reveals/hides the "before" and "after" portions.  Works on touch + mouse.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeftRight, Calendar, ChevronDown, X } from 'lucide-react';
import { format } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { Card } from '@/components/ui/card';

// ── Photo picker dropdown ──────────────────────────────────────────────────────

function PhotoPicker({ photos, selected, onSelect, label, language }) {
  const [open, setOpen] = useState(false);
  const dateLocale = getDateLocale(language);
  const photo = photos.find(p => p.id === selected);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-secondary/70 border border-border/50 text-sm font-medium hover:bg-secondary active:bg-secondary transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="truncate">
            {photo
              ? format(new Date(photo.takenAt), 'MMM d, yyyy', { locale: dateLocale })
              : label}
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
            className="absolute z-30 top-full mt-1 start-0 end-0 bg-card border border-border rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto"
          >
            {photos.map(p => (
              <button
                key={p.id}
                onClick={() => { onSelect(p.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-start hover:bg-secondary/60 active:bg-secondary/60 transition-colors ${p.id === selected ? 'bg-primary/10' : ''}`}
              >
                <img loading="lazy" src={p.dataUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">
                    {format(new Date(p.takenAt), 'MMM d, yyyy', { locale: dateLocale })}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{p.workoutName || 'Workout'}</p>
                </div>
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
  const { language } = useLanguage();
  const dateLocale = getDateLocale(language);

  // Default: oldest photo as "before", newest as "after"
  const sorted = [...photos].sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
  const [beforeId, setBeforeId] = useState(sorted[0]?.id || null);
  const [afterId,  setAfterId]  = useState(sorted[sorted.length - 1]?.id || null);

  const [sliderPct, setSliderPct] = useState(50);
  const containerRef = useRef(null);
  const dragging = useRef(false);

  const beforePhoto = photos.find(p => p.id === beforeId);
  const afterPhoto  = photos.find(p => p.id === afterId);

  // ── Drag logic ─────────────────────────────────────────────────────────────

  const updateSlider = useCallback((clientX) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct  = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    setSliderPct(pct);
  }, []);

  const onMouseMove = useCallback((e) => { if (dragging.current) updateSlider(e.clientX); }, [updateSlider]);
  const onMouseUp   = useCallback(() => { dragging.current = false; document.body.style.userSelect = ''; }, []);
  const onMouseDown = useCallback(() => { dragging.current = true; document.body.style.userSelect = 'none'; }, []);

  const onTouchMove  = useCallback((e) => { updateSlider(e.touches[0].clientX); }, [updateSlider]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const daysDiff = beforePhoto && afterPhoto
    ? Math.round((new Date(afterPhoto.takenAt) - new Date(beforePhoto.takenAt)) / 86400000)
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-primary" />
          <h2 className="font-heading font-bold text-sm">Compare Photos</h2>
          {daysDiff !== null && daysDiff > 0 && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
              {daysDiff} day{daysDiff === 1 ? '' : 's'} apart
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg bg-secondary hover:bg-secondary/80 active:bg-secondary/80 flex items-center justify-center transition-colors"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Pickers */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Before</p>
          <PhotoPicker photos={photos} selected={beforeId} onSelect={setBeforeId} label="Choose before" language={language} />
        </div>
        <div>
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1.5">After</p>
          <PhotoPicker photos={photos} selected={afterId} onSelect={setAfterId} label="Choose after" language={language} />
        </div>
      </div>

      {/* Slider canvas */}
      {beforePhoto && afterPhoto ? (
        <Card className="overflow-hidden border-none shadow-md">
          <div
            ref={containerRef}
            className="relative select-none touch-none overflow-hidden"
            style={{ cursor: 'col-resize' }}
            onMouseDown={onMouseDown}
            onTouchMove={onTouchMove}
            onTouchStart={onTouchMove}
          >
            {/* After photo (full width, background) */}
            <img loading="lazy" src={afterPhoto.dataUrl}
              alt="After"
              className="w-full object-cover block"
              style={{ maxHeight: 420 }}
              draggable={false}
            />

            {/* Before photo clipped to left portion */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${sliderPct}%` }}
            >
              <img loading="lazy" src={beforePhoto.dataUrl}
                alt="Before"
                className="object-cover block"
                style={{ width: containerRef.current?.offsetWidth || '100%', maxHeight: 420 }}
                draggable={false}
              />
            </div>

            {/* Divider line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
              style={{ left: `${sliderPct}%` }}
            />

            {/* Drag handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-white shadow-xl flex items-center justify-center"
              style={{ left: `${sliderPct}%` }}
            >
              <ArrowLeftRight className="w-4 h-4 text-slate-700" />
            </div>

            {/* Labels */}
            <div className="absolute top-2 start-2 pointer-events-none">
              <span className="text-micro font-bold px-2 py-0.5 rounded-md bg-black/60 text-white">
                BEFORE · {format(new Date(beforePhoto.takenAt), 'MMM d, yyyy', { locale: dateLocale })}
              </span>
            </div>
            <div className="absolute top-2 end-2 pointer-events-none">
              <span className="text-micro font-bold px-2 py-0.5 rounded-md bg-black/60 text-white">
                AFTER · {format(new Date(afterPhoto.takenAt), 'MMM d, yyyy', { locale: dateLocale })}
              </span>
            </div>
          </div>

          <p className="text-center text-micro text-muted-foreground py-2">
            Drag the divider to compare
          </p>
        </Card>
      ) : (
        <Card className="p-8 text-center border-dashed">
          <ArrowLeftRight className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Select two photos above to compare them.</p>
        </Card>
      )}
    </div>
  );
}
