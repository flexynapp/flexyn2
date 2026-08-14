// src/components/stories/StatusNoteEditor.jsx
//
// Instagram-style status note editor.
//
// When opened: the "+ Note" pill smoothly expands from its position in
// the tray into a centered card. Keyboard auto-focuses. Post collapses it back.
//
// origin: { top, left, width, height } of the pill in screen coordinates.

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

const CARD_W  = Math.min(typeof window !== 'undefined' ? window.innerWidth * 0.9 : 340, 380);
const CARD_H  = 280;
const CARD_BR = 24;

function getTarget() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left:         (vw - CARD_W) / 2,
    top:          vh * 0.28,
    width:        CARD_W,
    height:       CARD_H,
    borderRadius: CARD_BR,
  };
}

export default function StatusNoteEditor({ existingNote, origin, onPost, onDelete, onClose }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock();
  const [text,     setText]     = useState(existingNote?.text ?? '');
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef(null);

  // Auto-focus after the expansion animation completes
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const handlePost = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    await onPost(text.trim());
    setSaving(false);
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  };

  const initial = origin
    ? { left: origin.left, top: origin.top, width: origin.width, height: origin.height, borderRadius: 12, opacity: 1 }
    : { opacity: 0, ...getTarget() };

  const target = getTarget();

  const spring = { type: 'spring', damping: 30, stiffness: 320 };

  return createPortal(
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/50 z-[9990]"
        onClick={onClose}
      />

      {/* Expanding card */}
      <motion.div
        initial={initial}
        animate={{ ...target, opacity: 1 }}
        exit={origin
          ? { left: origin.left, top: origin.top, width: origin.width, height: origin.height, borderRadius: 12, opacity: 0 }
          : { opacity: 0 }
        }
        transition={spring}
        className="fixed z-[9991] bg-card overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Content fades in once the card is large enough to show it */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, delay: origin ? 0.18 : 0 }}
          className="flex flex-col flex-1 px-5 pt-5 pb-4"
        >
          {/* Header */}
          <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {existingNote ? 'Your note' : 'Add a note'}
          </p>

          {/* Text area */}
          <div className="relative flex-1 mb-4">
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value.slice(0, 60))}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && text.trim()) { e.preventDefault(); handlePost(); } }}
              placeholder={tFallback("statusNoteEditor.whatSOnYourMind", "What's on your mind?")}
              rows={3}
              className="w-full h-full resize-none rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground/55 focus:outline-none focus:border-primary/50 leading-relaxed"
            />
            <span className={`absolute bottom-2.5 end-3 text-micro font-medium pointer-events-none ${
              text.length >= 55 ? 'text-destructive' : 'text-muted-foreground/60'
            }`}>
              {text.length}/60
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {existingNote && (
              <button
                onClick={handleDelete}
                disabled={deleting || saving}
                className="flex-1 py-2.5 rounded-xl border border-destructive/50 text-destructive text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            )}
            <button
              onClick={onClose}
              disabled={saving || deleting}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={handlePost}
              disabled={!text.trim() || saving || deleting}
              className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Posting…' : existingNote ? 'Update' : 'Post'}
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </>,
    document.body,
  );
}
