// src/components/dashboard/JournalWidget.jsx
//
// Dashboard widget — today's journal entry preview with inline quick-write.
// Shows mood emoji (if tagged via MoodLogCard), entry title/snippet, and
// a textarea that expands on tap. Saves on blur or ⌘/Ctrl+Enter.
//
// Reads: journal_entries via getEntry / upsertEntry (journal.js).
// React-query key: ['journalEntry', userId, todayDateKey]

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { getEntry, upsertEntry } from '@/lib/data/journal';
import { MOOD_EMOJIS } from '@/lib/data/moodLogs';

// Derive today's date string in local time (same logic as MoodLogCard).
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function JournalWidget({ userId, userEmail }) {
  const { user } = useAuth();
  const uid   = userId  || user?.id;
  const email = userEmail || user?.email;
  const { tFallback } = useLanguage();
  const qc = useQueryClient();

  const todayStr = getTodayStr();

  const { data: entry, isLoading } = useQuery({
    queryKey: ['journalEntry', uid, todayStr],
    queryFn:  () => getEntry(uid, todayStr),
    enabled:  !!uid,
    staleTime: 60_000,
  });

  const [expanded, setExpanded] = useState(false);
  const [draft,    setDraft]    = useState('');
  const [saving,   setSaving]   = useState(false);
  // Use a ref-stored draft for the unmount-flush path. The unmount
  // cleanup needs the LATEST draft, not the value closed over at
  // mount time (which was always '').
  const saveTimerRef = useRef(null);
  const mountedRef   = useRef(true);
  const draftRef     = useRef('');
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => () => {
    mountedRef.current = false;
    // If there's a pending autosave when the component unmounts,
    // flush it synchronously instead of dropping the user's last
    // few seconds of typing on the floor. handleSave is async but
    // the network call queues regardless of whether we awaited
    // (we can't await in cleanup anyway). The IIFE shape keeps the
    // call site type-stable.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const pending = draftRef.current;
      if (pending != null) {
        (async () => {
          try {
            // Best-effort — fire the upsert without expecting a
            // re-render. The autosave path will pick it up on next
            // mount via the normal query refresh.
            const { upsertEntry } = await import('@/lib/data/journal');
            const todayStr = (() => {
              const d = new Date();
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            })();
            await upsertEntry(uid, email, {
              entryDate: todayStr,
              body: pending,
              attachments: [],
            });
          } catch { /* unmount flush is best-effort */ }
        })();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync draft when entry loads / changes from the server (e.g. a
  // background mood-tap invalidate). The effect runs whenever the
  // collapsed→expanded transition fires too, but the conditional
  // gating on `!expanded` means we only clobber the local draft
  // when the textarea is hidden. While expanded, the user owns the
  // text and we never overwrite their in-progress typing — even if
  // the server value changes mid-edit.
  useEffect(() => {
    if (expanded) return;
    setDraft(entry?.body || '');
  }, [entry?.body, expanded]);

  const handleSave = useCallback(async (body) => {
    if (!uid) return;
    setSaving(true);
    try {
      await upsertEntry(uid, email, {
        entryDate:   todayStr,
        title:       entry?.title || null,
        body,
        attachments: entry?.attachments || [],
      });
      qc.invalidateQueries({ queryKey: ['journalEntry', uid] });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [uid, email, todayStr, entry, qc]);

  // Auto-save 1 s after last keystroke.
  const handleChange = (e) => {
    const val = e.target.value;
    setDraft(val);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => handleSave(val), 1000);
  };

  const handleBlur = () => {
    clearTimeout(saveTimerRef.current);
    handleSave(draft);
  };

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(saveTimerRef.current);
      handleSave(draft);
      setExpanded(false);
    }
  };

  if (!uid) return null;

  const moodScore   = entry?.mood_score ?? null;
  const moodEmoji   = moodScore ? (MOOD_EMOJIS[moodScore - 1] ?? null) : null;
  const hasContent  = !!(entry?.title || entry?.body?.trim());
  const snippet     = entry?.body
    ? entry.body.replace(/[#*_>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100)
    : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="px-3 py-2.5 flex flex-col gap-1.5">
        {/* Header row */}
        <button
          type="button"
          onClick={() => {
            if (!expanded) setDraft(entry?.body || '');
            setExpanded(e => !e);
          }}
          className="flex items-center justify-between gap-2 w-full group"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {tFallback('journal.widgetLabel', "Today's Journal")}
            </span>
            {moodEmoji && (
              <span className="text-sm leading-none" title={tFallback('journal.mood', 'Mood')}>
                {moodEmoji}
              </span>
            )}
          </div>
          <div className="shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
            {expanded
              ? <ChevronUp  className="w-3.5 h-3.5" />
              : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </button>

        {/* Collapsed preview */}
        {!expanded && !isLoading && (
          <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
            {hasContent
              ? (entry?.title ? <><strong>{entry.title}</strong>{snippet ? ` · ${snippet}` : ''}</> : snippet)
              : <span className="italic opacity-60">{tFallback('journal.empty', 'Nothing yet — tap to write…')}</span>
            }
          </p>
        )}

        {/* Expanded write area */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="textarea"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
            >
              <textarea
                autoFocus
                value={draft}
                onChange={handleChange}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                placeholder={tFallback('journal.placeholder', 'How was your day? (⌘↩ to save & close)')}
                rows={5}
                className="w-full text-sm bg-background border border-border rounded-md px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40 mt-1"
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-muted-foreground/50">
                  {saving
                    ? tFallback('journal.saving', 'Saving…')
                    : tFallback('journal.autosave', 'Auto-saves as you type')}
                </span>
                <button
                  type="button"
                  onClick={() => { clearTimeout(saveTimerRef.current); handleSave(draft); setExpanded(false); }}
                  className="text-[10px] font-semibold text-primary hover:opacity-80 transition-opacity"
                >
                  {tFallback('journal.done', 'Done')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}
