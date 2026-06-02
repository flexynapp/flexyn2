// src/components/journal/JournalHistoryModal.jsx
//
// Scrollable history of every journaled day — so the user can jump
// straight to any entry instead of swiping back "100 times." Tapping a
// row jumps the JournalView to that day.

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { X, Loader2, Paperclip, BookOpen } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { listEntries } from '@/lib/data/journal';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

export default function JournalHistoryModal({ userId, activeDate, onClose, onPick }) {
  const { tFallback } = useLanguage();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  useBodyScrollLock(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await listEntries(userId, 365);
      if (!cancelled) { setEntries(rows); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[210] bg-black/50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl max-h-[80vh] flex flex-col"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="font-heading font-bold text-base flex items-center gap-1.5">
            <BookOpen className="w-4 h-4 text-primary" /> {tFallback('journal.historyTitle', 'Journal log')}
          </span>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-secondary flex items-center justify-center" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 px-6">
              <BookOpen className="w-9 h-9 text-muted-foreground/40 mx-auto mb-2" />
              <p className="font-heading font-bold text-sm">{tFallback('journal.historyEmptyTitle', 'No entries yet')}</p>
              <p className="text-xs text-muted-foreground mt-1">{tFallback('journal.historyEmptyBody', 'Write your first entry and it shows up here.')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {entries.map(e => {
                const isActive = e.entry_date === activeDate;
                let label = e.entry_date;
                try { label = format(parseISO(e.entry_date), 'EEE, MMM d yyyy'); } catch { /* keep raw */ }
                return (
                  <li key={e.id}>
                    <button
                      onClick={() => onPick(e.entry_date)}
                      className={`w-full text-start px-4 py-3 transition-colors ${isActive ? 'bg-primary/10' : 'hover:bg-secondary/40'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
                        {e.attachmentCount > 0 && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Paperclip className="w-3 h-3" /> {e.attachmentCount}
                          </span>
                        )}
                      </div>
                      {e.title && <p className="text-sm font-semibold text-foreground mt-0.5 truncate">{e.title}</p>}
                      {e.snippet && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{e.snippet}</p>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
