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
import { useDateFormatter } from '@/lib/intl';
import { dayHeaderFormat } from '@/lib/journalDateFormat';
import {
  ChevronLeft, ChevronRight, List, Bold, Mic, MicOff,
  Paperclip, X, Loader2, History, FileText, Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/LanguageContext';
import { startDictation, isVoiceInputSupported } from '@/lib/voiceInput';
import {
  getEntry, upsertEntry, uploadAttachment, deleteAttachment, migrateLocalEntries, listEntries, deleteEntry,
} from '@/lib/data/journal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { MOOD_EMOJIS, MOOD_LABELS } from '@/lib/data/moodLogs';
import { logMoodAction } from '@/lib/data/logMoodAction';
import { getDayContext, contextChips } from '@/lib/data/dayContext';
import { editability, EDIT_WINDOW_DAYS } from '@/lib/journalEditWindow';
import { provenanceLabel } from '@/lib/journalProvenance';
import { tileRow } from '@/lib/tileRows';
import { insertDictation } from '@/lib/journalDictation';
import { continueList } from '@/lib/journalListContinuation';

// ── A mood IS an entry, on ANY day ────────────────────────────────────────────
// This block used to live inside the read-only branch, which was fine while
// `readOnly = !isToday` meant every past day was read-only. The 7-day edit
// window then made days 1–7 editable and they silently fell out of it — so a
// mood-only day, which is half of production's rows, went back to rendering a
// blank placeholder for exactly the week a user is most likely to open. It is
// keyed on the CONTENT (no words, a mood) rather than on editability now,
// which is what it was always describing.
//
// `explain` only on a read-only day: the sub-line tells you why the page is
// otherwise empty, and where a textarea sits underneath, its placeholder is
// already saying it better.
function MoodEntry({ score, tFallback, explain }) {
  return (
    <div className="py-2">
      <p className="text-3xl leading-none">{MOOD_EMOJIS[score - 1]}</p>
      <p className="font-heading font-bold text-lg text-foreground mt-3">
        {tFallback('journal.feltLabel', 'You felt')} {tFallback(`mood.label.${score}`, MOOD_LABELS[score - 1])}
      </p>
      {explain && (
        <p className="text-sm text-muted-foreground mt-1">
          {tFallback('journal.moodOnly', 'Logged from the dashboard. Nothing written for this day.')}
        </p>
      )}
    </div>
  );
}

import MoodChip from './MoodChip';
import MarkdownBody from './MarkdownBody';
import JournalHistoryModal from './JournalHistoryModal';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const todayStr = () => format(new Date(), 'yyyy-MM-dd');

// Matches the server-side cap in upsertEntry, which slices to 12 before
// writing. Two places, one number — if they drift, the UI accepts files
// the save then throws away without saying so.
const MAX_ATTACHMENTS = 12;

// Failed saves back off 5s -> 10s -> 20s -> 40s -> 60s and then STOP, so a
// structural failure (RLS, quota, banned content) cannot loop forever.
// Reaching this cap is what 'stalled' means.
const MAX_SAVE_RETRIES = 5;


export default function JournalView({ userId, userEmail, onClose, initialDate }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  // `initialDate` lets a caller open straight to a day (YYYY-MM-DD). Parsed
  // as a LOCAL midnight, never `new Date('2026-08-09')`, which the spec
  // reads as UTC and lands on the previous day west of Greenwich.
  const [activeDate, setActiveDate] = useState(() => {
    if (typeof initialDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
      const d = new Date(`${initialDate}T00:00:00`);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  });
  const dateStr = format(activeDate, 'yyyy-MM-dd');
  const isToday = dateStr === todayStr();
  // Year only when it isn't this one. At text-xl "Wednesday, September 30
  // 2026" is ~380pt against a 375pt phone once the two day arrows and the
  // 44pt mood chip are counted, so it truncated — and the year is noise on
  // a screen whose whole subject is which day you are on.
  // Intl, not date-fns. `format()` has no locale bound, so this header read
  // "Sunday, August 9" on a screen where everything around it was Spanish —
  // and wiring date-fns locales would mean importing 15 locale bundles into
  // the startup path. Intl is in the platform and already knows all 15.
  //
  // The FORMAT lives in journalDateFormat.js with the measurements that
  // chose it: the full "weekday, month day" runs to 294pt against a 233pt
  // box, so it clipped in 7 of 15 languages — English among them.
  const fmtDate = useDateFormatter();
  const displayDate = fmtDate(activeDate, dayHeaderFormat(activeDate, new Date()));

  // Declared here, at the top, and NOT next to the other derived values
  // further down: goPrev, toggleDictation and onPickFiles all read them, and
  // a `const` read above its declaration line is the TDZ trap CLAUDE.md
  // documents — dev mode hides it, minified production re-orders and throws.
  const { daysAgo, readOnly } = editability(dateStr, todayStr());
  const relativeLabel = daysAgo === 0
    ? tFallback('profile.journal.today', 'Today')
    : daysAgo === 1
      ? tFallback('journal.yesterday', 'Yesterday')
      : tFallback('journal.daysAgo', `${daysAgo} days ago`, { n: daysAgo });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [moodScore, setMoodScore] = useState(null);
  const [moodBusy, setMoodBusy] = useState(false);
  // The stored row's id, so the day screen can delete the entry it is showing.
  // Null when the day has never been written — there is then nothing to
  // delete, and the control is not rendered rather than rendered inert.
  const [entryId, setEntryId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingEntry, setDeletingEntry] = useState(false);
  const [dayCtx, setDayCtx] = useState(null);
  // created_at / updated_at of the loaded row, for the edit marker.
  const [stamps, setStamps] = useState(null);
  // ONE explicit save state rather than booleans that can disagree:
  //
  //   idle     nothing to report
  //   saving   a write is in flight
  //   saved    the server has it
  //   held     the write failed and a retry IS scheduled
  //   stalled  the write failed and we have STOPPED retrying
  //
  // `held` and `stalled` were the same screen, which was the last silent
  // state left on this surface: after five failures the backoff gives up
  // and nothing schedules another attempt, yet the UI went on saying
  // "Held offline" — describing a retry that was never coming.
  //
  // State and not a derived read of dirtyRef / retryCountRef, because refs
  // do not trigger a render: an earlier version of this only appeared if
  // some other state change happened to repaint at the right instant, and
  // could not clear itself once a retry landed.
  const [saveState, setSaveState] = useState('idle');
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Names of files mid-upload, rendered as placeholder chips.
  const [pending, setPending] = useState([]);
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
    listEntries(userId, 365).then(({ rows }) => {
      setEntryDates(new Set(rows.map(r => r.entry_date)));
    }).catch(() => {});
  }, [userId]);

  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const dictationRef = useRef(null);
  // Where dictated text goes, captured when the mic is tapped.
  const dictationCaretRef = useRef(null);
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
    setSaveState('saving');
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
      setSaveState('saved');
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
      if (retryCountRef.current < MAX_SAVE_RETRIES) {
        retryCountRef.current += 1;
        const delay = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 60000);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          setRetryNonce(n => n + 1);
        }, delay);
        setSaveState('held');
      } else {
        // Out of retries. Nothing further happens on its own, so the
        // screen must stop implying otherwise and hand the user a way
        // back in. The draft is on disk either way.
        setSaveState('stalled');
      }
    }
    savingRef.current = false;
  }, [userId, userEmail, tFallback]);

  // Manual retry from the stalled state. Resets the budget rather than
  // making one more doomed attempt on an exhausted counter — the user
  // tapping this is new information (they think the network is back), so
  // the backoff deserves to start over rather than fail once and stop.
  const retrySave = useCallback(() => {
    retryCountRef.current = 0;
    failToastShownRef.current = false;
    dirtyRef.current = true;
    setRetryNonce(n => n + 1);
  }, []);

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
    setEntryId(entry?.id ?? null);
    // Provenance is a fact about the SERVER row. An unsynced draft has not
    // been written yet, so it cannot have amended anything — carrying the
    // stamps from the entry either way keeps the marker describing what is
    // actually stored.
    setStamps(entry ? { entry_date: ds, created_at: entry.created_at, updated_at: entry.updated_at } : null);
    if (useDraft) {
      setTitle(draft.title || '');
      setBody(draft.body || '');
      setAttachments(Array.isArray(draft.attachments) ? draft.attachments : []);
      // Re-arm so the autosave retries the unsynced draft.
      dirtyRef.current = true;
      // A draft only exists because a save failed, so this day is unsynced.
      // Retries reset with the day — a fresh open deserves a fresh budget.
      retryCountRef.current = 0;
      setSaveState('held');
    } else {
      setTitle(entry?.title || '');
      setBody(entry?.body || '');
      setAttachments(Array.isArray(entry?.attachments) ? entry.attachments : []);
      dirtyRef.current = false;
      retryCountRef.current = 0;
      setSaveState('idle');
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
      if (!cancelled) loadDay(activeDate);
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
    // Inside the edit window, step one day at a time. Skipping exists so you
    // never land on a page you can only stare at — but a blank day you can
    // WRITE ON is the whole point of the window, and skipping past yesterday
    // because you haven't written it yet is exactly backwards.
    if (daysAgo < EDIT_WINDOW_DAYS) { goToDay(subDays(activeDate, 1)); return; }
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
    // Symmetric with goPrev: inside the window, step one day. Without this
    // the arrows disagree — back goes day-by-day into the window and forward
    // vaults straight to today, so stepping back three days and forward one
    // skipped the two writable days in between.
    if (daysAgo <= EDIT_WINDOW_DAYS) { goToDay(addDays(activeDate, 1)); return; }
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
      // With a selection: wrap it, and UNWRAP if it is already bold — a
      // toggle, so pressing the button twice returns you to where you were
      // instead of producing ****four asterisks****.
      //
      // With no selection: open empty markers and put the caret BETWEEN them,
      // so the next keystroke is bold. It used to insert the literal words
      // "bold text", which is what Sean saw on screen — the toolbar typing
      // placeholder prose into his journal and leaving him to delete it.
      if (sel) {
        const alreadyBold = /^\*\*[\s\S]+\*\*$/.test(sel);
        const inner = alreadyBold ? sel.slice(2, -2) : sel;
        const wrapped = alreadyBold ? inner : `**${inner}**`;
        next = before + wrapped + after;
        caret = start + wrapped.length;
      } else {
        next = `${before}****${after}`;
        caret = start + 2;
      }
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

  // Enter continues a list. Shift+Enter is left alone as the plain-newline
  // escape hatch, and a non-collapsed selection falls through too — there
  // Enter means "replace this", not "add an item".
  const handleBodyKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    const ta = bodyRef.current;
    if (!ta || ta.selectionStart !== ta.selectionEnd) return;
    const result = continueList(body, ta.selectionStart);
    if (!result) return;
    e.preventDefault();
    onBodyChange(result.body);
    requestAnimationFrame(() => {
      ta.focus();
      try { ta.setSelectionRange(result.caret, result.caret); } catch { /* ignore */ }
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
    if (readOnly) { toast.message(tFallback('journal.locked', 'Entries older than 7 days are read-only.')); return; }
    setListening(true);
    const ta = bodyRef.current;
    dictationCaretRef.current = ta && document.activeElement === ta ? ta.selectionStart : null;
    let finalChunk = '';
    dictationRef.current = startDictation({
      onResult: ({ transcript, isFinal }) => {
        if (isFinal) {
          finalChunk = transcript.trim();
          if (finalChunk) {
            setBody(prev => {
              const next = insertDictation(prev, dictationCaretRef.current, finalChunk);
              // Walk the caret forward so the NEXT chunk continues after
              // this one rather than re-inserting at the original point,
              // which would reverse the sentence.
              dictationCaretRef.current = next.caret;
              return next.text;
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
    if (readOnly) { toast.message(tFallback('journal.locked', 'Entries older than 7 days are read-only.')); return; }

    // Hitting the cap used to do NOTHING: the chooser opened, you picked a
    // photo, and the app silently discarded it — `slice(0, 12 - 12)` is an
    // empty list. Worse, a day somehow holding more than 12 gave a NEGATIVE
    // end index, and `slice(0, -1)` drops the LAST item rather than taking
    // none, so it would have uploaded all but one of them.
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      toast.message(tFallback('journal.attachCap', `You can attach up to ${MAX_ATTACHMENTS} files a day.`, { n: MAX_ATTACHMENTS }));
      return;
    }
    const accepted = files.slice(0, room);
    const dropped = files.length - accepted.length;
    if (dropped > 0) {
      toast.message(tFallback('journal.attachDropped', `${dropped} not attached — that would pass the ${MAX_ATTACHMENTS}-file limit.`, { n: dropped, max: MAX_ATTACHMENTS }));
    }

    // Where the photo goes. Read BEFORE the uploads because the caret is a
    // property of the textarea, and by the time an upload resolves the user
    // may have tapped elsewhere. `selectionStart` survives the blur that
    // opening the file chooser causes, so this is the position they were at
    // when they reached for the paperclip.
    const caretAt = bodyRef.current?.selectionStart ?? body.length;

    // Placeholder chips while the uploads run. They used to happen behind a
    // single spinner on the attach button, so picking four photos looked
    // like nothing was happening until they appeared one at a time.
    setPending(accepted.map(f => f.name));
    setUploading(true);
    const inserted = [];
    for (const file of accepted) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(tFallback('journal.fileTooBig', `${file.name} is over 10 MB.`, { name: file.name }));
        setPending(prev => prev.filter(n => n !== file.name));
        continue;
      }
      const att = await uploadAttachment(userId, file);
      if (att) {
        setAttachments(prev => [...prev, att]);
        dirtyRef.current = true;
        // Images are written INTO the body at the caret; files are not,
        // because there is nothing to render inline for a PDF. Both stay in
        // `attachments` regardless — that array is what deleteEntry reads to
        // clean up blobs, so dropping an inlined image from it would leak the
        // file the moment the entry is deleted. The grid below filters out
        // anything already referenced in the body so it never renders twice.
        if ((att.type || '').startsWith('image/')) {
          inserted.push(`![${(att.name || 'photo').replace(/[[\]]/g, '')}](${att.url})`);
        }
      } else {
        toast.error(tFallback('journal.uploadFailed', `Couldn't upload ${file.name}.`, { name: file.name }));
      }
      setPending(prev => prev.filter(n => n !== file.name));
    }

    if (inserted.length) {
      // Built in one splice rather than one per file: `body` in this closure
      // is the value from the render that started the upload, so calling an
      // insert helper per image would apply each one to the same stale string
      // and only the last would survive.
      const beforeText = body.slice(0, caretAt);
      const afterText = body.slice(caretAt);
      const lead = beforeText && !beforeText.endsWith('\n') ? '\n' : '';
      const tail = afterText && !afterText.startsWith('\n') ? '\n' : '';
      const block = `${lead}${inserted.join('\n')}\n${tail}`;
      onBodyChange(beforeText + block + afterText);
      const caret = caretAt + block.length;
      requestAnimationFrame(() => {
        const ta = bodyRef.current;
        if (!ta) return;
        ta.focus();
        try { ta.setSelectionRange(caret, caret); } catch { /* ignore */ }
      });
    }

    setPending([]);
    setUploading(false);
  };
  // Drop the reference AND the blob. Removing only the array entry left the
  // file in the uploads bucket forever, unreferenced and invisible.
  //
  // Order matters: the UI drops it first, so the removal never appears to
  // hang on a network call the user did not ask for. The blob delete is
  // best-effort and deliberately not awaited into the render path — if it
  // fails we are exactly where we were before this existed (an orphan), and
  // deleteAttachment logs the reason rather than failing silently.
  const removeAttachment = (url) => {
    setAttachments(prev => prev.filter(a => a.url !== url));
    dirtyRef.current = true;
    deleteAttachment(url).catch(() => { /* best-effort; already logged */ });
  };

  // Delete the whole day. The local draft goes too — leaving it behind means
  // the autosave writes the entry straight back, so the row would reappear
  // seconds after being deleted and look like the delete had failed.
  const handleDeleteEntry = async () => {
    if (!entryId) return;
    setDeletingEntry(true);
    const res = await deleteEntry(userId, entryId);
    setDeletingEntry(false);
    if (!res?.ok) {
      toast.error(tFallback('journal.deleteFailed', "Couldn't delete that entry."));
      return;
    }
    dirtyRef.current = false;
    try { localStorage.removeItem(draftKey(dateStr)); } catch { /* ignore */ }
    setEntryId(null);
    setTitle('');
    setBody('');
    setAttachments([]);
    setMoodScore(null);
    setStamps(null);
    setEntryDates(prev => {
      const next = new Set(prev);
      next.delete(dateStr);
      return next;
    });
    setConfirmDelete(false);
    toast.success(tFallback('journal.deleted', 'Entry deleted.'));
  };

  const hasContent = !!(title.trim() || body.trim() || attachments.length);
  // Keyed on CONTENT, not on editability — that conflation is what the edit
  // window broke. No words + a mood = the mood is the entry, on any day.
  const showMoodEntry = !body.trim() && !!moodScore;
  const attachRow = tileRow({ gap: 2, cols: 3 });
  // Anything written into the body renders where the user put it, so showing
  // it again in the grid below would be the same photo twice. Legacy entries
  // (everything attached before images went inline) reference nothing in the
  // body, so they all still land here — which is the point: this filter must
  // never hide an attachment that has no other way to be seen.
  const gridAttachments = attachments.filter(a => !a?.url || !body.includes(a.url));
  // Null unless the entry was written or amended after the day it describes.
  const provLabel = provenanceLabel(stamps, tFallback);
  // "Held offline" is the honest read of the retry state: flush() stashed
  // the snapshot to localStorage and is backing off. It was reported by a
  // single toast, once, and then never again.

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

  // The mood is withheld from the starter chips exactly when it is already
  // rendering as content above — otherwise the screen says "You felt Good"
  // as a heading and offers "Felt 😄 Good" as a chip two inches below it,
  // which reads as a bug rather than as two affordances.
  const chips = React.useMemo(() => contextChips(
    dayCtx,
    moodScore && !showMoodEntry
      ? { score: moodScore, emoji: MOOD_EMOJIS[moodScore - 1], label: tFallback(`mood.label.${moodScore}`, MOOD_LABELS[moodScore - 1]) }
      : null,
    // Pass VARS through. This dropped the third argument, which was
    // invisible in English — the fallback is a template literal that has
    // already interpolated — and rendered a literal "{n}" the moment a
    // translation existed: "Dormiste {n} h". Caught by looking at the
    // screen in Spanish, not by any test.
    (key, english, vars) => tFallback(key, english, vars),
  ), [dayCtx, moodScore, showMoodEntry, tFallback]);

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
    if (readOnly || !userId) return;
    const previous = moodScore;
    setMoodScore(score);           // optimistic
    setMoodBusy(true);
    // logMoodAction, not a bare upsert. This wrote mood_logs and tagged the
    // journal row and stopped there — two of the five things a logged mood
    // owes — so a mood set from here did not move the Readiness score, left
    // the dashboard widget stale, and never credited the MOOD_LOGGED quest.
    // The same tap paid out from MoodLogCard and not from here.
    const res = await logMoodAction({
      user: { id: userId, email: userEmail }, mood: score, date: dateStr, qc, t: tFallback,
    });
    if (!res.ok) setMoodScore(previous);
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
              <button onClick={goPrev} className="-ms-1.5 p-1.5 rounded-lg text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors" aria-label={tFallback('nutrition.prevDay', 'Previous day')} data-no-swipe>
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h2 className="font-heading font-bold text-xl text-foreground truncate">{displayDate}</h2>
              {/* opacity-30, not opacity-0: hiding it on today collapsed the
                  row's shape and the date jumped sideways when you navigated
                  off today and back. */}
              <button onClick={goNext} disabled={isToday} className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors disabled:opacity-30" aria-label={tFallback('nutrition.nextDay', 'Next day')} data-no-swipe>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            {/* Save state lives with the day now. It used to be the only
                honest half of a permanent three-clause footer sentence. */}
            <div className="flex items-center gap-2 ps-1">
              <span className={`text-micro ${isToday ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>{relativeLabel}</span>
              {saveState === 'saving' && (
                <span className="text-micro text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> {tFallback('journal.saving', 'Saving…')}
                </span>
              )}
              {saveState === 'held' && (
                <span className="text-micro text-destructive">{tFallback('journal.held', 'Held offline')}</span>
              )}
              {/* Stalled is the only save state that needs the USER. It gets
                  a control rather than a label, because after the backoff
                  gives up nothing else will ever move this day forward —
                  and it says the writing is safe, because it is: the draft
                  is on disk under flexyn.journalDraft.<uid>.<date>. */}
              {saveState === 'stalled' && (
                <button
                  onClick={retrySave}
                  data-no-swipe
                  className="text-micro text-destructive font-semibold underline underline-offset-2 decoration-destructive/40"
                >
                  {tFallback('journal.notSaved', 'Not saved — tap to retry')}
                </button>
              )}
              {saveState === 'saved' && hasContent && (
                <span className="text-micro text-muted-foreground">{tFallback('journal.saved', 'Saved')}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <MoodChip
              score={moodScore}
              editable={!readOnly}
              busy={moodBusy}
              onPick={setMood}
              tFallback={tFallback}
            />
            {/* Delete, to the right of the mood control, so an entry can be
                removed while you are reading it rather than only from the log.
                Shown on read-only days too: the 7-day window stops an entry
                being silently REWRITTEN, which is a different thing from
                being allowed to remove your own record. The RLS delete policy
                carries no age predicate either. */}
            {entryId && (
              <button
                onClick={() => setConfirmDelete(true)}
                data-no-swipe
                className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 active:text-destructive transition-colors"
                aria-label={tFallback('journal.deleteEntry', 'Delete entry')}
                title={tFallback('journal.deleteEntry', 'Delete entry')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
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
                {showMoodEntry ? (
                  <MoodEntry score={moodScore} tFallback={tFallback} explain />
                ) : (
                  <MarkdownBody text={body} placeholder={tFallback('profile.journal.placeholderPast', 'No entry for this day.')} />
                )}

                {/* The rule, stated. Removing the controls and saying nothing
                    was the old behaviour on every past day, and an absence of
                    affordances reads as the app being broken rather than as a
                    boundary — the standard the League seasons board set for
                    locked and dead-end states. */}
                <div className="border-t border-border mt-8 pt-3">
                  <p className="text-micro font-bold tracking-[0.06em] text-muted-foreground">
                    {tFallback('journal.lockedLabel', 'LOCKED')}
                  </p>
                  <p className="text-sm text-foreground mt-1">
                    {tFallback('journal.locked', 'Entries older than 7 days are read-only.')}
                  </p>
                </div>
              </div>
            ) : (
              <>
              {showMoodEntry && <MoodEntry score={moodScore} tFallback={tFallback} />}
              <textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => onBodyChange(e.target.value)}
                onKeyDown={handleBodyKeyDown}
                placeholder={tFallback('profile.journal.placeholderToday', 'How was your session today? Use the toolbar for bullets, bold, voice, or attachments…')}
                className="w-full min-h-[40vh] bg-transparent text-foreground text-sm leading-relaxed resize-none focus:outline-none placeholder:text-muted-foreground/50"
                style={{ fontFamily: 'inherit' }}
                data-no-swipe
              />
              </>
            )}

            {/* ── The edit marker. Provenance belongs with the record, at
                the foot of it — not in the header, where it would compete
                with the date on every screen while being true on almost
                none of them. It only exists at all because the 7-day
                window does: before that every entry was necessarily
                same-day, so there was nothing to mark. */}
            {provLabel && (
              <p className="text-micro text-muted-foreground/70 pt-3" data-no-swipe>
                {provLabel}
              </p>
            )}

            {/* Attachments. tileRow(), not a fixed 80px flex-wrap: the COUNT
                comes from data, which is exactly the test CLAUDE.md sets for
                this. Three-up tiles fill the column instead of leaving a
                ragged 80px strip with dead space to the right, and the tiles
                get bigger on a phone into the bargain.

                Widths are literals in tileRows.js and cannot be built at
                runtime — Tailwind only emits classes it can read in source. */}
            {(gridAttachments.length > 0 || pending.length > 0) && (
              <div className={`${attachRow.row} py-3`} data-no-swipe>
                {gridAttachments.map(att => {
                  const isImg = (att.type || '').startsWith('image/');
                  return (
                    <div key={att.url} className={`${attachRow.item} relative group`}>
                      {isImg ? (
                        <a href={att.url} target="_blank" rel="noreferrer">
                          <img src={att.url} alt={att.name} className="w-full aspect-square rounded-lg object-cover border border-border" loading="lazy" />
                        </a>
                      ) : (
                        <a href={att.url} target="_blank" rel="noreferrer" className="w-full aspect-square rounded-lg border border-border bg-secondary/40 flex flex-col items-center justify-center gap-1 p-1 text-center">
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
                {/* One placeholder per file still uploading, in the grid
                    itself. A spinner on the attach button could not say HOW
                    MANY were coming, so picking four photos read as nothing
                    happening until they appeared one at a time. */}
                {pending.map(name => (
                  <div key={`pending-${name}`} className={`${attachRow.item}`}>
                    <div className="w-full aspect-square rounded-lg border border-dashed border-border bg-secondary/20 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                ))}
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
                {/* The query is already keyed to the active day — only the
                    label has to follow it, or a chip from last Tuesday's
                    session is announced as today's. */}
                {isToday ? tFallback('journal.fromToday', 'FROM TODAY') : tFallback('journal.fromThatDay', 'FROM THAT DAY')}
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

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(o) => { if (!o && !deletingEntry) setConfirmDelete(false); }}
        title={tFallback('journal.deleteTitle', 'Delete this entry?')}
        description={tFallback(
          'journal.deleteBody',
          'Are you sure you want to delete this? This action cannot be undone.',
        )}
        confirmLabel={deletingEntry
          ? tFallback('journal.deleting', 'Deleting…')
          : tFallback('common.delete', 'Delete')}
        cancelLabel={tFallback('common.cancel', 'Cancel')}
        onConfirm={handleDeleteEntry}
        destructive
      />
    </motion.div>,
    document.body,
  );
}
