// src/components/stories/StatusNoteEditor.jsx
// Bottom-sheet for creating, editing, or deleting a status note.

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';

export default function StatusNoteEditor({ existingNote, onPost, onDelete, onClose }) {
  const [text,     setText]     = useState(existingNote?.text ?? '');
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 200);
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

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9998] bg-black/60 flex items-end"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        className="w-full bg-card rounded-t-3xl px-5 pt-5"
        style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-base leading-tight">Status note</h3>
            <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
              Visible to your followers for 24 hours
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Text input */}
        <div className="relative mb-4">
          <textarea
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value.slice(0, 60))}
            placeholder="What's on your mind?"
            rows={3}
            className="w-full resize-none rounded-2xl border border-border bg-secondary/50 px-4 py-3 text-sm text-foreground placeholder-muted-foreground/60 focus:outline-none focus:border-primary/50 leading-relaxed"
          />
          <span className={`absolute bottom-3 right-3 text-[10px] font-medium ${text.length >= 55 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {text.length}/60
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {existingNote && (
            <button
              onClick={handleDelete}
              disabled={deleting || saving}
              className="flex-1 py-3 rounded-2xl border border-destructive/50 text-destructive text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {deleting ? 'Deleting…' : 'Delete Note'}
            </button>
          )}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handlePost}
            disabled={!text.trim() || saving || deleting}
            className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? 'Posting…' : existingNote ? 'Update Note' : 'Post Note'}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
