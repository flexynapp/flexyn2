// src/components/journal/JournalView.jsx
//
// "My Journal" — server-backed daily journal (migration 145). Replaces
// the old localStorage textarea. Features:
//   • Title per entry
//   • Markdown body with a formatting toolbar (bold / bullets)
//   • Voice-to-text dictation that appends to the body
//   • Attachments (images + files) via the avatars Storage bucket
//   • Left/right swipe between days (+ arrow buttons)
//   • A "Log" button → scrollable history of every day written
//   • Debounced autosave; flush on day-change / close
//
// One-time migration of legacy localStorage entries runs on first open.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, subDays, addDays } from 'date-fns';
import {
  ChevronLeft, ChevronRight, Book, List, Bold, Mic, MicOff,
  Paperclip, X, Loader2, History, FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/lib/LanguageContext';
import { startDictation, isVoiceInputSupported } from '@/lib/voiceInput';
import {
  getEntry, upsertEntry, uploadAttachment, migrateLocalEntries, listEntries,
} from '@/lib/data/journal';

// ── Lightweight markdown renderer (bold + bullets only) ───────────────────────
function renderInline(text) {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*\n]+\*\*$/.test(p)
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{p}</React.Fragment>
  );
}
function MarkdownBody({ text, placeholder }) {
  if (!text || !text.trim()) return <p className="text-muted-foreground/50 text-sm">{placeholder}</p>;
  const lines = text.split('\n');
  const nodes = [];
  let listItems = [];
  const flushList = () => {
    if (listItems.length) { nodes.push(<ul key={`ul-${nodes.length}`} className="list-disc list-inside space-y-0.5 my-1">{listItems}</ul>); listItems = []; }
  };
  lines.forEach((line, i) => {
    if (/^[-*]\s/.test(line)) {
      listItems.push(<li key={i} className="text-sm leading-relaxed">{renderInline(line.slice(2))}</li>);
    } else {
      flushList();
      if (line.trim() === '') { nodes.push(<div key={i} className="h-3" />); }
      else { nodes.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>); }
    }
  });
  flushList();
  return <div className="space-y-0.5">{nodes}</div>;
}
import JournalHistoryModal from './JournalHistoryModal';

const todayStr = () => format(new Date(), 'yyyy-MM-dd');

export default function JournalView({ userId, userEmail, onClose }) {
  const { tFallback } = useLanguage();
  const [activeDate, setActiveDate] = useState(() => new Date());
  const dateStr = format(activeDate, 'yyyy-MM-dd');
  const isToday = dateStr === todayStr();
  const displayDate = format(activeDate, 'EEEE, MMMM d yyyy');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Retry-after-failure tick. When `flush()` fails it schedules a 5s
  // retry by bumping this counter, which re-fires the autosave debounce
  // effect (retryNonce is in its deps). Without this, `dirtyRef = true`
  // from the fail branch never triggered a re-run on its own — the
  // effect only watched title / body / attachments / flush, so unless
  // the user typed again the retry promise was a lie. Code review
  // (Wave 53) caught this. Cap at 5 retries to avoid infinite loops
  // when the failure is structural (RLS / quota / banned content).
  const [retryNonce, setRetryNonce] = useState(0);
  const retryTimerRef = useRef(null);
  const retryCountRef = useRef(0);

  // Dates that have entries (for skip-empty navigation)
  const [entryDates, setEntryDates] = useState(new Set());
  useEffect(() => {
    if (!userId) return;
    listEntries(userId, 365).then(rows => {
      setEntryDates(new Set(rows.map(r => r.entry_date)));
    }).catch(() => {});
  }, [userId]);

  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const dictationRef = useRef(null);
  const dirtyRef = useRef(false);
  // Synchronous guard against overlapping saves. The autosave debounce,
  // goToDay's pre-flush, and the unmount-flush can all fire concurrently
  // if the user types-then-swipes-then-closes within a single
  // 800ms-ish window. They all upsert the same (user_id, entry_date)
  // row so the data ends up correct, but the `saving` spinner flickers
  // (an early flush completing turns it off while a later one is still
  // in flight) AND a stale snapshot can race a fresh one. The ref lets
  // a later caller see "already saving" and re-arm the dirty flag so
  // the next debounce picks the fresh content up.
  const savingRef = useRef(false);
  // True while loadDay() is mid-flight. Blocks flush() from saving an
  // in-between snapshot (NEW dateStr + OLD title/body) when a rapid
  // day-switch races a dictation onResult or paste event that fires
  // between setActiveDate and loadDay's setState calls.
  const loadingRef = useRef(false);
  // Toast-once flag so a long offline window doesn't spam toasts on
  // every autosave debounce.
  const failToastShownRef = useRef(false);
  // Holds the values + date currently in the editor so flush() can save
  // the OUTGOING day's content before we load a different day.
  const snapshotRef = useRef({ dateStr, title: '', body: '', attachments: [] });
  snapshotRef.current = { dateStr, title, body, attachments };

  // localStorage draft key namespaced per CLAUDE.md `flexyn.<feature>.<userId>`
  // pattern. Falls back to 'anon' when userId is missing — won't collide
  // with a real save because the upsert is also gated on userId.
  const draftKey = (d) => `flexyn.journalDraft.${userId || 'anon'}.${d}`;

  // Read a localStorage draft for the given date (if any). Used by
  // loadDay so a previously-unsynced edit isn't silently lost on
  // refresh — the draft is shown if it's newer than the server entry.
  const readDraft = (d) => {
    try {
      const raw = localStorage.getItem(draftKey(d));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  };

  // ── Save / flush ────────────────────────────────────────────────────
  // Three resilience moves vs the original:
  //   1. In-flight guard (savingRef) so overlapping flushes are no-ops.
  //   2. Skip while a day is loading (loadingRef) — saving the
  //      in-between {NEW dateStr, OLD body} snapshot would overwrite
  //      the new day's existing entry with stale content.
  //   3. On save FAILURE: stash the snapshot to localStorage under
  //      flexyn.journalDraft.<userId>.<dateStr>, re-arm the dirty flag
  //      so the next debounce retries, and surface a one-time toast so
  //      the user knows nothing was lost. The previous code threw the
  //      return value away (data loss on any network blip).
  const flush = useCallback(async () => {
    if (!dirtyRef.current || !userId) return;
    if (savingRef.current) return;
    if (loadingRef.current) return;
    const snap = snapshotRef.current;
    savingRef.current = true;
    dirtyRef.current = false;
    setSaving(true);
    let res = { ok: false };
    try {
      res = await upsertEntry(userId, userEmail, {
        entryDate: snap.dateStr,
        title: snap.title,
        body: snap.body,
        attachments: snap.attachments,
      });
    } catch (err) {
      res = { ok: false, error: err?.message || 'network' };
    }
    if (res.ok) {
      // Save succeeded — clear any stashed draft + reset retry counter.
      try { localStorage.removeItem(draftKey(snap.dateStr)); } catch { /* ignore */ }
      failToastShownRef.current = false;
      retryCountRef.current = 0;
    } else {
      // Stash + re-arm so the next debounce retries. Persisting under a
      // dated key lets a separate session also pick the draft up if the
      // user reopens the same date.
      try {
        localStorage.setItem(draftKey(snap.dateStr), JSON.stringify({
          title: snap.title,
          body: snap.body,
          attachments: snap.attachments,
          savedAt: Date.now(),
        }));
      } catch { /* private mode / quota */ }
      dirtyRef.current = true;
      if (!failToastShownRef.current) {
        failToastShownRef.current = true;
        toast.error(tFallback('journal.saveFailed', "Couldn't save — we'll keep retrying. Your writing is held locally."));
      }
      // Schedule an automatic retry. The autosave debounce effect only
      // re-runs when its deps change; dirtyRef alone doesn't trigger it.
      // Bumping retryNonce after a delay forces a fresh debounce cycle
      // that calls flush() again with the current snapshot. Cap to 5
      // retries (with exponential backoff up to 60s) so a structural
      // failure — quota, RLS, banned content — doesn't loop forever.
      if (retryCountRef.current < 5) {
        retryCountRef.current += 1;
        const delay = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 60000);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          setRetryNonce(n => n + 1);
        }, delay);
      }
    }
    setSaving(false);
    savingRef.current = false;
  }, [userId, userEmail, tFallback]);

  // Clear any pending retry timer on unmount so we don't bump state on
  // an unmounted component (silent in React 18 but still a leak).
  useEffect(() => () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // Debounced autosave whenever content changes (and it's dirty).
  // retryNonce is in the deps so a scheduled retry (set inside flush's
  // fail branch) re-fires this effect and gets a fresh debounce cycle.
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(() => { flush(); }, 800);
    return () => clearTimeout(t);
  }, [title, body, attachments, flush, retryNonce]);

  // ── Load a day's entry ────────────────────────────────────────────────
  // If a localStorage draft for this date exists AND is newer than the
  // server entry (or there's no server entry), prefer the draft and
  // mark dirty so the next debounce re-attempts the save. Otherwise
  // load the server copy and clear the dirty flag.
  const loadDay = useCallback(async (d) => {
    if (!userId) return;
    loadingRef.current = true;
    setLoading(true);
    const ds = format(d, 'yyyy-MM-dd');
    const entry = await getEntry(userId, ds);
    const draft = readDraft(ds);
    // Pick the source: draft if it's newer or server has nothing.
    const serverTime = entry?.updated_at ? new Date(entry.updated_at).getTime() : 0;
    const draftTime  = draft?.savedAt || 0;
    const useDraft   = draft && (!entry || draftTime > serverTime);
    if (useDraft) {
      setTitle(draft.title || '');
      setBody(draft.body || '');
      setAttachments(Array.isArray(draft.attachments) ? draft.attachments : []);
      // Re-arm so the autosave retries the unsynced draft.
      dirtyRef.current = true;
    } else {
      setTitle(entry?.title || '');
      setBody(entry?.body || '');
      setAttachments(Array.isArray(entry?.attachments) ? entry.attachments : []);
      dirtyRef.current = false;
    }
    setLoading(false);
    loadingRef.current = false;
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // One-time localStorage migration, then load today.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (userId && userEmail) {
        const n = await migrateLocalEntries(userId, userEmail).catch(() => 0);
        if (!cancelled && n > 0) {
          toast.success(tFallback('journal.migrated', `Imported ${n} past ${n === 1 ? 'entry' : 'entries'}.`));
        }
      }
      if (!cancelled) loadDay(new Date());
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, userEmail]);

  // Flush pending save on unmount + stop any dictation.
  useEffect(() => () => {
    flush();
    try { dictationRef.current?.stop(); } catch { /* ignore */ }
  }, [flush]);

  // ── Navigation between days ───────────────────────────────────────────
  const goToDay = useCallback(async (d) => {
    if (format(d, 'yyyy-MM-dd') === dateStr) return;
    await flush();              // save outgoing day first
    stopDictation();
    setActiveDate(d);
    loadDay(d);
  }, [dateStr, flush, loadDay]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate backward, skipping empty past days (no blank pages)
  const goPrev = () => {
    let d = subDays(activeDate, 1);
    // Skip up to 365 empty days backward to find one with an entry
    if (entryDates.size > 0) {
      for (let i = 0; i < 365; i++) {
        const s = format(d, 'yyyy-MM-dd');
        if (entryDates.has(s)) break;
        d = subDays(d, 1);
      }
    }
    goToDay(d);
  };
  const goNext = () => {
    if (isToday) return;
    let d = addDays(activeDate, 1);
    // Skip forward through empty days up to today
    if (entryDates.size > 0) {
      const todayD = new Date();
      for (let i = 0; i < 365; i++) {
        const s = format(d, 'yyyy-MM-dd');
        if (entryDates.has(s) || s >= format(todayD, 'yyyy-MM-dd')) break;
        d = addDays(d, 1);
      }
    }
    goToDay(d);
  };

  // Swipe between days. Attached to the card but ignores swipes that
  // start inside the textarea / inputs so text selection still works.
  const touchStart = useRef(null);
  const onTouchStart = (e) => {
    if (e.target.closest('textarea, input, button, a, [data-no-swipe]')) { touchStart.current = null; return; }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) goPrev();        // swipe right → previous day
      else goNext();               // swipe left → next day
    }
  };

  // ── Editing helpers ───────────────────────────────────────────────────
  const onBodyChange = (v) => { setBody(v); dirtyRef.current = true; };
  const onTitleChange = (v) => { setTitle(v.slice(0, 120)); dirtyRef.current = true; };

  // Insert/transform markdown at the textarea selection.
  const applyFormat = (kind) => {
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const sel = body.slice(start, end);
    const after = body.slice(end);
    let next = body;
    let caret = end;
    if (kind === 'bold') {
      next = `${before}**${sel || 'bold text'}**${after}`;
      caret = start + 2 + (sel || 'bold text').length + 2;
    } else if (kind === 'bullet') {
      // Prefix each selected line (or the current line) with "- ".
      const lineStart = before.lastIndexOf('\n') + 1;
      const block = body.slice(lineStart, end) || '';
      const bulleted = block
        .split('\n')
        .map(l => (l.startsWith('- ') ? l : `- ${l}`))
        .join('\n');
      next = body.slice(0, lineStart) + bulleted + after;
      caret = lineStart + bulleted.length;
    }
    onBodyChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      try { ta.setSelectionRange(caret, caret); } catch { /* ignore */ }
    });
  };

  // ── Voice dictation ───────────────────────────────────────────────────
  const stopDictation = () => {
    try { dictationRef.current?.stop(); } catch { /* ignore */ }
    dictationRef.current = null;
    setListening(false);
  };
  const toggleDictation = () => {
    if (listening) { stopDictation(); return; }
    if (!isToday) { toast.message(tFallback('journal.readOnlyPast', 'Switch to today to write.')); return; }
    setListening(true);
    let finalChunk = '';
    dictationRef.current = startDictation({
      onResult: ({ transcript, isFinal }) => {
        if (isFinal) {
          finalChunk = transcript.trim();
          if (finalChunk) {
            setBody(prev => {
              const sep = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
              return prev + sep + finalChunk;
            });
            dirtyRef.current = true;
          }
        }
      },
      onError: (reason) => {
        stopDictation();
        if (reason === 'permission') toast.error(tFallback('journal.micDenied', 'Microphone permission denied.'));
        else if (reason === 'unsupported') toast.error(tFallback('journal.micUnsupported', 'Voice input not supported on this browser.'));
      },
      onEnd: () => setListening(false),
    });
  };

  // ── Attachments ───────────────────────────────────────────────────────
  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    if (!isToday) { toast.message(tFallback('journal.readOnlyPast', 'Switch to today to write.')); return; }
    setUploading(true);
    for (const file of files.slice(0, 12 - attachments.length)) {
      if (file.size > 10 * 1024 * 1024) { toast.error(tFallback('journal.fileTooBig', `${file.name} is over 10 MB.`)); continue; }
      const att = await uploadAttachment(userId, file);
      if (att) { setAttachments(prev => [...prev, att]); dirtyRef.current = true; }
      else toast.error(tFallback('journal.uploadFailed', `Couldn't upload ${file.name}.`));
    }
    setUploading(false);
  };
  const removeAttachment = (url) => {
    setAttachments(prev => prev.filter(a => a.url !== url));
    dirtyRef.current = true;
  };

  const readOnly = !isToday;

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 32 }}
      transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      className="fixed inset-0 z-[200] bg-background flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <button onClick={onClose} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" /> {tFallback('profile.journal.back', 'Back')}
        </button>
        <div className="flex items-center gap-1.5">
          <Book className="w-4 h-4 text-primary" />
          <span className="font-heading font-bold text-base">{tFallback('profile.journal.title', 'My Journal')}</span>
        </div>
        <button
          onClick={() => setHistoryOpen(true)}
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          data-no-swipe
        >
          <History className="w-4 h-4" /> {tFallback('journal.log', 'Log')}
        </button>
      </div>

      {/* Date navigation */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0 bg-secondary/20">
        <button onClick={goPrev} className="p-1.5 rounded-lg hover:bg-secondary transition-colors" aria-label="Previous day" data-no-swipe>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-foreground">{displayDate}</p>
          <div className="flex items-center justify-center gap-2 mt-0.5">
            {isToday && <span className="text-[11px] text-primary font-semibold">{tFallback('profile.journal.today', 'Today')}</span>}
            {saving && <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" /> {tFallback('journal.saving', 'Saving…')}</span>}
          </div>
        </div>
        <button onClick={goNext} disabled={isToday} className="p-1.5 rounded-lg hover:bg-secondary transition-colors disabled:opacity-30" aria-label="Next day" data-no-swipe>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Title */}
          <div className="px-4 pt-3 shrink-0">
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              readOnly={readOnly}
              placeholder={readOnly ? (title ? '' : tFallback('journal.noTitle', 'Untitled')) : tFallback('journal.titlePlaceholder', 'Title your day…')}
              className="w-full bg-transparent font-heading font-bold text-lg text-foreground focus:outline-none placeholder:text-muted-foreground/40"
              data-no-swipe
            />
          </div>

          {/* Formatting toolbar — today only */}
          {!readOnly && (
            <div className="flex items-center gap-1 px-4 py-2 shrink-0" data-no-swipe>
              <button onClick={() => applyFormat('bullet')} title="Bullet list" className="w-8 h-8 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground">
                <List className="w-4 h-4" />
              </button>
              <button onClick={() => applyFormat('bold')} title="Bold" className="w-8 h-8 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground">
                <Bold className="w-4 h-4" />
              </button>
              {isVoiceInputSupported() && (
                <button
                  onClick={toggleDictation}
                  title="Dictate"
                  className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                    listening ? 'bg-red-500/15 text-red-500' : 'hover:bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              )}
              <button onClick={() => fileRef.current?.click()} title="Attach" className="w-8 h-8 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
              </button>
              <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.txt,.heic" className="hidden" onChange={onPickFiles} />
              {listening && <span className="text-[11px] text-red-500 font-semibold ms-1 animate-pulse">{tFallback('journal.listening', 'Listening…')}</span>}
            </div>
          )}

          {/* Body — rendered markdown in read-only, editable textarea today */}
          <div className="flex-1 px-4 overflow-y-auto">
            {readOnly ? (
              <div className="min-h-[40vh] py-1" data-no-swipe>
                <MarkdownBody text={body} placeholder={tFallback('profile.journal.placeholderPast', 'No entry for this day.')} />
              </div>
            ) : (
              <textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => onBodyChange(e.target.value)}
                placeholder={tFallback('profile.journal.placeholderToday', 'How was your session today? Use the toolbar for bullets, bold, voice, or attachments…')}
                className="w-full min-h-[40vh] bg-transparent text-foreground text-sm leading-relaxed resize-none focus:outline-none placeholder:text-muted-foreground/50"
                style={{ fontFamily: 'inherit' }}
                data-no-swipe
              />
            )}

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 py-3" data-no-swipe>
                {attachments.map(att => {
                  const isImg = (att.type || '').startsWith('image/');
                  return (
                    <div key={att.url} className="relative group">
                      {isImg ? (
                        <a href={att.url} target="_blank" rel="noreferrer">
                          <img src={att.url} alt={att.name} className="w-20 h-20 rounded-lg object-cover border border-border" loading="lazy" />
                        </a>
                      ) : (
                        <a href={att.url} target="_blank" rel="noreferrer" className="w-20 h-20 rounded-lg border border-border bg-secondary/40 flex flex-col items-center justify-center gap-1 p-1 text-center">
                          <FileText className="w-5 h-5 text-muted-foreground" />
                          <span className="text-[9px] text-muted-foreground truncate w-full">{att.name}</span>
                        </a>
                      )}
                      {!readOnly && (
                        <button
                          onClick={() => removeAttachment(att.url)}
                          className="absolute -top-1.5 -end-1.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                          aria-label="Remove attachment"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-border shrink-0">
            <p className="text-[11px] text-muted-foreground text-center">
              {readOnly
                ? tFallback('journal.footerPast', 'Read-only · swipe or use ← → to browse · tap Log for history')
                : tFallback('journal.footerToday', 'Auto-saved · swipe left/right to change days · tap Log for history')}
            </p>
          </div>
        </div>
      )}

      <AnimatePresence>
        {historyOpen && (
          <JournalHistoryModal
            userId={userId}
            activeDate={dateStr}
            onClose={() => setHistoryOpen(false)}
            onPick={(d) => { setHistoryOpen(false); goToDay(new Date(d + 'T00:00:00')); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
