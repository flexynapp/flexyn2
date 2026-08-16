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
import { BookOpen, ChevronDown, ChevronUp, Paperclip, Maximize2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { getEntry, saveBody } from '@/lib/data/journal';
import { MOOD_LABELS } from '@/lib/data/moodLogs';
import { requestOpenJournal } from '@/lib/journalOverlay';
import { logMoodAction } from '@/lib/data/logMoodAction';
import MoodChip from '@/components/journal/MoodChip';

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
  useEffect(() => {
    mountedRef.current = true;
    return () => {
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
            // Best-effort — fire the write without expecting a
            // re-render. The autosave path will pick it up on next
            // mount via the normal query refresh.
            //
            // saveBody, not upsertEntry: this call site has no title and
            // no attachments to send, and the old upsert sent its absence
            // as NULL / [] — silently wiping both off any day the user had
            // titled or attached to in the full editor.
            const { saveBody } = await import('@/lib/data/journal');
            const todayStr = (() => {
              const d = new Date();
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            })();
            await saveBody(uid, email, todayStr, pending);
          } catch { /* unmount flush is best-effort */ }
        })();
      }
    }
    };
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

  // Body only. Echoing `entry?.title` / `entry?.attachments` back looked
  // like preservation but was the opposite: `entry` is a react-query
  // snapshot with a 60s staleTime, so a title written in JournalView and a
  // widget save a moment later raced, and the stale `null` won.
  const handleSave = useCallback(async (body) => {
    if (!uid) return;
    setSaving(true);
    try {
      await saveBody(uid, email, todayStr, body);
      qc.invalidateQueries({ queryKey: ['journalEntry', uid] });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [uid, email, todayStr, qc]);

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

  // Optimistic, with a revert — the same shape MoodLogCard uses, because a
  // mood tap that appears to do nothing for a second reads as a dead card.
  const [moodOptimistic, setMoodOptimistic] = useState(null);
  const [moodBusy, setMoodBusy] = useState(false);
  const handleMood = async (score) => {
    const previous = moodOptimistic;
    setMoodOptimistic(score);
    setMoodBusy(true);
    const res = await logMoodAction({ user: { id: uid, email }, mood: score, date: todayStr, qc, t: tFallback });
    if (!res.ok) setMoodOptimistic(previous);
    setMoodBusy(false);
  };

  if (!uid) return null;

  const moodScore   = moodOptimistic ?? entry?.mood_score ?? null;
  const hasContent  = !!(entry?.title || entry?.body?.trim());
  const snippet     = entry?.body
    ? entry.body.replace(/[#*_>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100)
    : '';
  // The same rule the day screen and the Log now follow: a mood with no
  // words IS the entry. This card said "Nothing yet. Tap to write…" over a
  // mood it was already displaying two inches to the left, which is the
  // bare-date defect in a third place.
  const moodOnly = !hasContent && !!moodScore;
  const attachmentCount = Array.isArray(entry?.attachments) ? entry.attachments.length : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="px-3 py-2.5 flex flex-col gap-1.5">
        {/* Header row. The chip is a SIBLING of the expand button, not a
            child: it is interactive, and nesting a button inside a button
            is invalid and swallows the inner tap. */}
        <div className="flex items-center gap-2">
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
            <span className="text-micro font-bold tracking-[0.04em] text-muted-foreground">
              {tFallback('journal.widgetLabel', "Today's Journal")}
            </span>
          </div>
          <div className="shrink-0 flex items-center gap-1 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
            {attachmentCount > 0 && (
              <span className="text-micro flex items-center gap-0.5"><Paperclip className="w-3 h-3" />{attachmentCount}</span>
            )}
            {expanded
              ? <ChevronUp  className="w-3.5 h-3.5" />
              : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </button>
        {/* The mood was DISPLAY-ONLY here, and its only setter lives inside
            the Readiness sheet — two taps away behind a ring. Same chip and
            same action as the journal day screen, so the control, the scale
            and the five writes are identical wherever you tap it. */}
        <MoodChip
          score={moodScore}
          editable
          busy={moodBusy}
          onPick={handleMood}
          tFallback={tFallback}
        />
        </div>

        {/* Collapsed preview */}
        {!expanded && !isLoading && (
          <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
            {hasContent
              ? (entry?.title ? <><strong>{entry.title}</strong>{snippet ? ` · ${snippet}` : ''}</> : snippet)
              : moodOnly
                ? <span className="text-foreground">{tFallback('journal.feltLabel', 'You felt')} {tFallback(`mood.label.${moodScore}`, MOOD_LABELS[moodScore - 1])}</span>
                : <span className="italic opacity-60">{tFallback('journal.empty', 'Nothing yet. Tap to write…')}</span>
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
                placeholder={tFallback('journal.placeholder', 'How was your day?')}
                rows={5}
                className="w-full text-sm bg-background border border-border rounded-sm px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40 mt-1"
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-micro text-muted-foreground/50">
                  {saving
                    ? tFallback('journal.saving', 'Saving…')
                    : tFallback('journal.autosave', 'Auto-saves as you type')}
                </span>
                <span className="flex items-center gap-3">
                  {/* The way OUT. This card could only ever edit a body: no
                      title, no attachments, no mood, no other day — and it
                      offered no route to the surface that can. Flushing
                      first means the full editor loads what you just typed
                      rather than the copy the server had a second ago. */}
                  <button
                    type="button"
                    onClick={() => {
                      clearTimeout(saveTimerRef.current);
                      handleSave(draft).finally(() => requestOpenJournal(todayStr));
                      setExpanded(false);
                    }}
                    className="text-micro font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <Maximize2 className="w-3 h-3" /> {tFallback('journal.openFull', 'Open journal')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { clearTimeout(saveTimerRef.current); handleSave(draft); setExpanded(false); }}
                    className="text-micro font-semibold text-primary hover:opacity-80 transition-opacity"
                  >
                    {tFallback('journal.done', 'Done')}
                  </button>
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}
