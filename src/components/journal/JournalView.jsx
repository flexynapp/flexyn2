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
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { format, subDays, addDays } from 'date-fns';
import {
  ChevronLeft, ChevronRight, List, Bold, Mic, MicOff,
  Paperclip, X, Loader2, History, FileText, Plus,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/LanguageContext';
import { startDictation, isVoiceInputSupported } from '@/lib/voiceInput';
import {
  getEntry, upsertEntry, uploadAttachment, migrateLocalEntries, listEntries, tagMood,
} from '@/lib/data/journal';
import { MOOD_EMOJIS, MOOD_LABELS, upsertMoodLog } from '@/lib/data/moodLogs';
import { getDayContext, contextChips } from '@/lib/data/dayContext';

// ── Lightweight markdown renderer (bold + bullets only) ───────────────────────
function renderInline(text) {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*\n]+\*\*$/.test(p)
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{p}</React.Fragment>
  );
}
// ── Mood chip ─────────────────────────────────────────────────────────────────
// mood_score has been on journal_entries since migration 165 and shown
// nowhere on this screen — written by a tap on the dashboard's MoodLogCard
// and read by nothing here. It sits on the day now, dashed when unset.
//
// Tapping expands the SAME five steps MoodLogCard uses; a second scale would
// be a second answer to the same question.
function MoodChip({ score, editable, busy, onPick, tFallback }) {
  const [open, setOpen] = useState(false);
  const emoji = score ? MOOD_EMOJIS[score - 1] : null;

  if (open && editable) {
    return (
      <div className="flex items-center gap-1" data-no-swipe>
        {MOOD_EMOJIS.map((e, i) => (
          <button
            key={e}
            onClick={() => { setOpen(false); onPick(i + 1); }}
            aria-label={tFallback(`mood.label.${i + 1}`, MOOD_LABELS[i])}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-lg transition-colors ${
              score === i + 1 ? 'bg-secondary' : 'hover:bg-secondary active:bg-secondary'
            }`}
          >
            {e}
          </button>
        ))}
      </div>
    );
  }

  const label = score
    ? `${tFallback('journal.feltLabel', 'You felt')} ${tFallback(`mood.label.${score}`, MOOD_LABELS[score - 1])}`
    : tFallback('journal.setMood', 'Log a mood');

  return (
    <button
      onClick={() => editable && setOpen(true)}
      disabled={!editable && !score}
      aria-label={label}
      title={label}
      data-no-swipe
      className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-xl transition-colors ${
        emoji ? 'bg-secondary' : 'border border-dashed border-border text-muted-foreground'
      } ${editable ? 'active:opacity-70' : ''}`}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (emoji || <Plus className="w-4 h-4" />)}
    </button>
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
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const todayStr = () => format(new Date(), 'yyyy-MM-dd');

export default function JournalView({ userId, userEmail, onClose }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock();
  const { tFallback } = useLanguage();
  const [activeDate, setActiveDate] = useState(() => new Date());
  const dateStr = format(activeDate, 'yyyy-MM-dd');
  const isToday = dateStr === todayStr();
  // Year only when it isn't this one. At text-xl "Wednesday, September 30
  // 2026" is ~380pt against a 375pt phone once the two day arrows and the
  // 44pt mood chip are counted, so it truncated — and the year is noise on
  // a screen whose whole subject is which day you are on.
  const displayDate = format(
    activeDate,
    activeDate.getFullYear() === new Date().getFullYear() ? 'EEEE, MMMM d' : 'EEEE, MMMM d yyyy',
  );

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [moodScore, setMoodScore] = useState(null);
  const [moodBusy, setMoodBusy] = useState(false);
  const [dayCtx, setDayCtx] = useState(null);
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
    // mood_score always comes from the SERVER row, never from the draft —
    // a draft only ever holds what this editor can write, and the mood is
    // set elsewhere (MoodLogCard) and could have moved since.
    setMoodScore(entry?.mood_score ?? null);
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
  }, [dateStr, flush, loadDay]);

  // Navigate backward, skipping empty past days (no blank pages)
  // Navigate to the nearest past entry; O(n log n) sort once, no loop burn.
  // When entryDates is still loading (empty Set) we fall back to -1 day so the
  // UI still responds, and the skip behaviour kicks in once the Set resolves.
  const goPrev = () => {
    if (entryDates.size > 0) {
      // Find the most-recent entry date strictly before today's dateStr.
      const earlier = [...entryDates].filter(s => s < dateStr).sort();
      if (earlier.length === 0) {
        // Already at or before the oldest entry — don't navigate into the void.
        toast.message('No earlier journal entries.');
        return;
      }
      goToDay(new Date(earlier[earlier.length - 1] + 'T00:00:00'));
    } else {
      goToDay(subDays(activeDate, 1));
    }
  };
  const goNext = () => {
    if (isToday) return;
    if (entryDates.size > 0) {
      const todayStr2 = format(new Date(), 'yyyy-MM-dd');
      // Find the earliest entry date strictly after dateStr and not in the future.
      const later = [...entryDates].filter(s => s > dateStr && s <= todayStr2).sort();
      if (later.length === 0) {
        // Nothing between here and today — jump to today.
        goToDay(new Date());
        return;
      }
      goToDay(new Date(later[0] + 'T00:00:00'));
    } else {
      goToDay(addDays(activeDate, 1));
    }
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
  const hasContent = !!(title.trim() || body.trim() || attachments.length);
  // "Held offline" is the honest read of the retry state: flush() stashed
  // the snapshot to localStorage and is backing off. It was reported by a
  // single toast, once, and then never again.
  const heldOffline = !saving && dirtyRef.current && retryCountRef.current > 0;

  // ── The day's own facts, for the empty state ──────────────────────────
  // Fetched per day and only when there is a blank page to fill. Failure is
  // silent by design: no chips is a fine empty state, an error is not.
  useEffect(() => {
    let cancelled = false;
    if (!userId || readOnly) { setDayCtx(null); return undefined; }
    getDayContext(userId, dateStr)
      .then(ctx => { if (!cancelled) setDayCtx(ctx); })
      .catch(() => { if (!cancelled) setDayCtx(null); });
    return () => { cancelled = true; };
  }, [userId, dateStr, readOnly]);

  const chips = React.useMemo(() => contextChips(
    dayCtx,
    moodScore ? { score: moodScore, emoji: MOOD_EMOJIS[moodScore - 1], label: tFallback(`mood.label.${moodScore}`, MOOD_LABELS[moodScore - 1]) } : null,
    (key, english) => tFallback(key, english),
  ), [dayCtx, moodScore, tFallback]);

  // Append a chip as a line of the entry, at the end, and mark dirty so the
  // normal autosave picks it up. No special save path — a tapped chip is
  // just typing the user didn't have to do.
  const appendLine = (line) => {
    setBody(prev => {
      const sep = !prev ? '' : prev.endsWith('\n') ? '' : '\n';
      return `${prev}${sep}${line}`;
    });
    dirtyRef.current = true;
  };

  // Setting a mood from here has to write BOTH tables. MoodLogCard writes
  // mood_logs (which Readiness and the dashboard read) and then tags
  // journal_entries.mood_score; writing only the journal row would show a
  // mood here that the dashboard denies. upsertMoodLog is today-only by
  // construction, which matches this control being disabled on past days.
  const setMood = async (score) => {
    if (!isToday || !userId) return;
    const previous = moodScore;
    setMoodScore(score);           // optimistic
    setMoodBusy(true);
    const res = await upsertMoodLog({ mood: score }).catch(() => ({ ok: false }));
    if (res?.ok) {
      await tagMood(userId, userEmail, score, dateStr).catch(() => {});
    } else {
      setMoodScore(previous);
      toast.error(tFallback('mood.saveFailed', 'Could not save mood — try again.'));
    }
    setMoodBusy(false);
  };

  // Portal to <body>. This is not cosmetic: ProfileMenu is rendered INSIDE
  // `Header.jsx`'s mobile bar, which carries `backdrop-blur-md`, and a
  // non-`none` backdrop-filter makes an element a containing block for
  // `position: fixed` descendants. So `fixed inset-0` resolved against the
  // 56px header instead of the viewport and the whole editor rendered as a
  // 56px translucent sliver on every phone — measured 56px vs 812px on a
  // 375×812 viewport, and full-height the moment the header's blur was
  // removed. Desktop was unaffected because that header is `lg:hidden`,
  // which is why it survived being looked at. DebriefVault and InjuryForm,
  // the sibling overlays in the same menu, both already portal.
  return createPortal(
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
      {/* ── The day. One block, and the only dominant thing on the screen.
          It replaces two strips: an app-title row that just repeated the
          menu row you tapped to get here, and a separate date bar. That
          was 106pt of chrome with no focal point between them — the
          exact "consistency without hierarchy" CLAUDE.md calls the
          generated-UI tell. The date now carries the page. */}
      <div className="px-4 pt-2 pb-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="flex items-center gap-1 -ms-1 py-1 text-sm font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" /> {tFallback('profile.journal.back', 'Back')}
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            className="flex items-center gap-1 py-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
            data-no-swipe
          >
            <History className="w-4 h-4" /> {tFallback('journal.log', 'Log')}
          </button>
        </div>

        <div className="flex items-end justify-between gap-2 mt-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <button onClick={goPrev} className="-ms-1.5 p-1.5 rounded-lg text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors" aria-label="Previous day" data-no-swipe>
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h2 className="font-heading font-bold text-xl text-foreground truncate">{displayDate}</h2>
              {/* opacity-30, not opacity-0: hiding it on today collapsed the
                  row's shape and the date jumped sideways when you navigated
                  off today and back. */}
              <button onClick={goNext} disabled={isToday} className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors disabled:opacity-30" aria-label="Next day" data-no-swipe>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            {/* Save state lives with the day now. It used to be the only
                honest half of a permanent three-clause footer sentence. */}
            <div className="flex items-center gap-2 ps-1">
              {isToday && <span className="text-micro text-primary font-semibold">{tFallback('profile.journal.today', 'Today')}</span>}
              {saving
                ? <span className="text-micro text-muted-foreground flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" /> {tFallback('journal.saving', 'Saving…')}</span>
                : heldOffline
                  ? <span className="text-micro text-destructive">{tFallback('journal.held', 'Held offline')}</span>
                  : hasContent && <span className="text-micro text-muted-foreground">{tFallback('journal.saved', 'Saved')}</span>}
            </div>
          </div>

          <MoodChip
            score={moodScore}
            editable={isToday}
            busy={moodBusy}
            onPick={setMood}
            tFallback={tFallback}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Title. A read-only day with no title renders NOTHING here —
              it used to show an "Untitled" placeholder, which is a label
              for an absence, sitting above the actual content and reading
              like a field the user failed to fill in. 0 of production's 12
              rows have a title, so that placeholder was the normal case. */}
          {(!readOnly || title) && (
            <div className="px-4 pt-3 shrink-0">
              <input
                type="text"
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                readOnly={readOnly}
                placeholder={tFallback('journal.titlePlaceholder', 'Title your day…')}
                className="w-full bg-transparent font-heading font-bold text-lg text-foreground focus:outline-none placeholder:text-muted-foreground/40"
                data-no-swipe
              />
            </div>
          )}

          {/* Formatting toolbar — today only. Grouped on a `secondary`
              surface rather than four icons floating on the page: it is
              interactive, so it earns one, and a naked row of glyphs
              belonged to nothing. */}
          {!readOnly && (
            <div className="flex items-center gap-1 mx-4 my-2 px-1.5 py-1.5 w-fit rounded-lg bg-secondary shrink-0" data-no-swipe>
              <button onClick={() => applyFormat('bullet')} title="Bullet list" className="w-8 h-8 rounded-md hover:bg-secondary active:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground">
                <List className="w-4 h-4" />
              </button>
              <button onClick={() => applyFormat('bold')} title="Bold" className="w-8 h-8 rounded-md hover:bg-secondary active:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground">
                <Bold className="w-4 h-4" />
              </button>
              {isVoiceInputSupported() && (
                <button
                  onClick={toggleDictation}
                  title="Dictate"
                  className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                    listening ? 'bg-red-500/15 text-red-500' : 'hover:bg-secondary active:bg-secondary text-muted-foreground hover:text-foreground active:text-foreground'
                  }`}
                >
                  {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              )}
              <button onClick={() => fileRef.current?.click()} title="Attach" className="w-8 h-8 rounded-md hover:bg-secondary active:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
              </button>
              {/* Only the types `ATTACHMENT_MIMES` in journal.js will actually
                  pin a contentType for, which is also what the `uploads`
                  bucket's allowed_mime_types permits. It read
                  `image/*,.pdf,.txt,.heic`, so the picker offered PDFs and
                  text files that the uploader then refused — the user saw a
                  file chooser accept their file and a "couldn't upload"
                  toast a second later. Widening this again means widening
                  BOTH gates in the same change (see CLAUDE.md, Storage). */}
              <input ref={fileRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.avif" className="hidden" onChange={onPickFiles} />
              {listening && <span className="text-micro text-red-500 font-semibold ms-1 animate-pulse">{tFallback('journal.listening', 'Listening…')}</span>}
            </div>
          )}

          {/* Body — rendered markdown in read-only, editable textarea today */}
          <div className="flex-1 px-4 overflow-y-auto">
            {readOnly ? (
              <div className="min-h-[40vh] py-1" data-no-swipe>
                {/* A mood IS an entry — the smallest one there is. This day
                    used to say "No entry for this day" while the row it was
                    reading held a mood_score, and that is not an edge case:
                    six of production's twelve journal rows are mood-only,
                    written by a tap on the dashboard. */}
                {!body.trim() && moodScore ? (
                  <div className="py-2">
                    <p className="text-3xl leading-none">{MOOD_EMOJIS[moodScore - 1]}</p>
                    <p className="font-heading font-bold text-lg text-foreground mt-3">
                      {tFallback('journal.feltLabel', 'You felt')} {tFallback(`mood.label.${moodScore}`, MOOD_LABELS[moodScore - 1])}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {tFallback('journal.moodOnly', 'Logged from the dashboard. Nothing written for this day.')}
                    </p>
                  </div>
                ) : (
                  <MarkdownBody text={body} placeholder={tFallback('profile.journal.placeholderPast', 'No entry for this day.')} />
                )}
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
                          <span className="text-micro text-muted-foreground truncate w-full">{att.name}</span>
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

          {/* ── FROM TODAY. The void, filled with what the app already
              knows. The journal sits directly on top of workout_logs and
              sleep_logs and read neither — it offered a blank page to
              someone whose session it had just recorded.

              Three rules this must keep:
              • Every chip is a fact from a row. Nothing is estimated and
                nothing is generated. Production carries NULL title and
                NULL duration_min on 100% of workout rows, so a chip set
                assuming those columns would have rendered "· min" at
                everybody — see the head of dayContext.js.
              • It renders only while the body is EMPTY. It is an
                empty-state affordance, not a permanent context rail; a
                rail would be one more thing competing with the writing.
              • The 32pt break above it is this screen's ONE gap-8
                (CLAUDE.md): the seam between writing and context.

              The permanent three-clause footer instruction it replaces
              ("Auto-saved · swipe left/right to change days · tap Log for
              history") was on screen before a word was written; the only
              part of it carrying information is the save state, which now
              sits under the date where the user is already looking. */}
          {!readOnly && !body.trim() && chips.length > 0 && (
            <div className="px-4 pb-3 pt-8 shrink-0" data-no-swipe>
              <p className="text-micro font-bold tracking-[0.06em] text-muted-foreground">
                {tFallback('journal.fromToday', 'FROM TODAY')}
              </p>
              <div className="border-t border-border mt-1.5 pt-2 flex flex-wrap gap-2">
                {chips.map(c => (
                  <button
                    key={c.key}
                    onClick={() => appendLine(c.line)}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-secondary active:bg-secondary transition-colors"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="text-micro text-muted-foreground mt-2">
                {tFallback('journal.fromTodayHint', 'Tap one to write it as a line.')}
              </p>
            </div>
          )}
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
    </motion.div>,
    document.body,
  );
}
