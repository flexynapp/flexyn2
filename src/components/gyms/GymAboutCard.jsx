// src/components/gyms/GymAboutCard.jsx
//
// "About" surface for a Gym Hub. Renders weekly hours, amenities,
// and a small photo gallery below the header but above the tabs.
// Auto-hides when nothing has been set so an unconfigured gym
// doesn't show three empty sections.
//
// Single Photo => no carousel chrome; ≥2 photos => horizontal scroll
// rail with snap-to. Tap a photo to expand it in a lightbox modal.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Wifi, X } from 'lucide-react';
import { AMENITY_META } from '@/lib/gymAmenities';

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

function todayKey() {
  const d = new Date().getDay(); // 0 = Sunday in JS-land
  return ['sun','mon','tue','wed','thu','fri','sat'][d];
}

function formatTime(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(n => Number(n));
  if (!Number.isFinite(h)) return null;
  const ampm = h >= 12 ? 'pm' : 'am';
  const hh = ((h + 11) % 12) + 1;
  return m === 0 ? `${hh}${ampm}` : `${hh}:${String(m).padStart(2, '0')}${ampm}`;
}

function dayLine(hours, key) {
  const slot = hours?.[key];
  if (!slot || !slot.open || !slot.close) return 'Closed';
  return `${formatTime(slot.open)} – ${formatTime(slot.close)}`;
}

function hasAnyHours(hours) {
  if (!hours || typeof hours !== 'object') return false;
  return DAY_ORDER.some(k => hours[k]?.open && hours[k]?.close);
}

export default function GymAboutCard({ gym }) {
  const [expandedDay, setExpandedDay] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { url, idx }

  const hours      = gym?.hours || {};
  const amenities  = Array.isArray(gym?.amenities)  ? gym.amenities  : [];
  const photos     = Array.isArray(gym?.photo_urls) ? gym.photo_urls : [];
  const description = (gym?.description || '').trim();

  const showHours      = hasAnyHours(hours);
  const showAmenities  = amenities.length > 0;
  const showPhotos     = photos.length > 0;
  const showDescription = description.length > 0;

  // Nothing configured? Don't render the section at all — keeps the
  // hub clean for owners who haven't filled in details yet.
  if (!showHours && !showAmenities && !showPhotos && !showDescription) {
    return null;
  }

  const today = todayKey();
  const todayLine = hours?.[today]
    ? `Today: ${dayLine(hours, today)}`
    : null;

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-4 mb-4 space-y-4">
        {showDescription && (
          <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
            {description}
          </p>
        )}

        {/* Photo gallery — horizontal scroll rail with snap. */}
        {showPhotos && (
          <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-2 snap-x snap-mandatory">
              {photos.map((url, i) => (
                <button
                  key={url + i}
                  type="button"
                  onClick={() => setLightbox({ url, idx: i })}
                  className="snap-start shrink-0 w-44 h-32 rounded-xl overflow-hidden bg-secondary"
                  aria-label={`Open photo ${i + 1}`}
                >
                  <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Hours */}
        {showHours && (
          <div>
            <button
              type="button"
              onClick={() => setExpandedDay(v => !v)}
              className="w-full flex items-center justify-between gap-2 text-start"
              aria-expanded={expandedDay}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <Clock className="w-3 h-3" /> Hours
              </span>
              {todayLine && (
                <span className="text-xs font-semibold text-foreground">{todayLine}</span>
              )}
            </button>
            <AnimatePresence initial={false}>
              {expandedDay && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mt-2 space-y-0.5"
                >
                  {DAY_ORDER.map(k => (
                    <li key={k} className={`flex items-center justify-between text-xs ${k === today ? 'font-semibold' : 'text-muted-foreground'}`}>
                      <span className="w-12">{DAY_LABEL[k]}</span>
                      <span className="tabular-nums">{dayLine(hours, k)}</span>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Amenities */}
        {showAmenities && (
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              <Wifi className="w-3 h-3" /> Amenities
            </p>
            <div className="flex flex-wrap gap-1.5">
              {amenities.map(slug => {
                const meta = AMENITY_META[slug] || { label: slug, emoji: '✓' };
                return (
                  <span
                    key={slug}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-secondary/60 border border-border"
                  >
                    <span aria-hidden="true">{meta.emoji}</span>
                    {meta.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-4"
          >
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="absolute top-4 end-4 w-9 h-9 rounded-full bg-white/15 text-white flex items-center justify-center"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
            <img loading="lazy" src={lightbox.url}
              alt=""
              className="max-w-full max-h-full object-contain rounded-xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
