// src/components/journal/JournalHistoryModal.jsx
//
// Scrollable history of every journaled day — so the user can jump
// straight to any entry instead of swiping back "100 times." Tapping a
// row jumps the JournalView to that day.
//
// Group 05 of the slots board. Design:
// docs/penpot-journal-log-board.js. Three things it resolves:
//
//   • MONTH HEADERS, sticky. A year of rows needs an answer to "roughly
//     when am I", and a header gives it continuously while you scroll.
//     This is deliberately instead of the scrubber the board floated —
//     one control rather than two for the same job, and not the one that
//     has to be designed for a thumb.
//   • A MOOD-ONLY ROW RENDERS ITS MOOD. Half of production's rows have
//     no title and no body, so the row drew a bare date and stopped. The
//     day screen was fixed for this; a column of bare dates is where it
//     reads worst.
//   • EMPTY AND FAILED ARE DIFFERENT SCREENS. See the note on
//     `listEntries` — "no entries" is a claim about the user and we may
//     only make it when the read succeeded.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { useDateFormatter } from '@/lib/intl';
import { X, Loader2, Paperclip, BookOpen, RefreshCw, Search, MoreVertical } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { listEntries, deleteEntry } from '@/lib/data/journal';
import { filterEntries, monthsPresent } from '@/lib/journalSearch';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { toast } from '@/lib/toast';
import { MOOD_EMOJIS, MOOD_LABELS } from '@/lib/data/moodLogs';
import { provenance } from '@/lib/journalProvenance';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// Year only when it isn't this one — the same rule the day header uses.
// Formatted through Intl rather than date-fns so the month name follows the
// app's language; `format()` carries no locale and would say "August" under
// a Spanish UI.
function monthLabel(d, fmtDate) {
  return fmtDate(d, {
    month: 'long',
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Rows are already newest-first from the query, so a single pass groups
 *  them without sorting again — and preserves that order inside each
 *  month, which a keyed object would not guarantee. */
function groupByMonth(rows, fmtDate) {
  const out = [];
  rows.forEach((e) => {
    let d;
    try { d = parseISO(e.entry_date); } catch { d = null; }
    const key = d && !Number.isNaN(d.getTime()) ? format(d, 'yyyy-MM') : 'unknown';
    if (!out.length || out[out.length - 1].key !== key) {
      out.push({ key, label: d ? monthLabel(d, fmtDate) : '', rows: [] });
    }
    out[out.length - 1].rows.push(e);
  });
  return out;
}

function EntryRow({ e, isActive, onPick, onAskDelete, tFallback, fmtDate }) {
  let label = e.entry_date;
  try { label = fmtDate(parseISO(e.entry_date), { weekday: 'short', month: 'short', day: 'numeric' }); } catch { /* keep raw */ }

  const hasWords = !!(e.title || e.snippet);
  const mood = e.mood_score ? MOOD_EMOJIS[e.mood_score - 1] : null;
  // A row with no words but a mood: the mood IS the entry, same rule the
  // day screen follows. This used to render as a date and nothing else.
  const moodOnly = !hasWords && !!mood;
  // An untitled row leads with its snippet rather than demoting the only
  // thing it has to the small muted line — 0 of 12 production rows carry
  // a title, so untitled is the normal shape, not the exception.
  const primary = e.title || (hasWords ? e.snippet : null);
  const secondary = e.title ? e.snippet : null;

  return (
    /* The row used to be one <button> wrapping everything. The delete control
       has to be a button too, and a button inside a button is invalid HTML —
       browsers recover by dropping the inner one, so the menu would render and
       never fire. Hence a flex row: the tappable body is still a button, the
       menu is its sibling. */
    <li className={`flex items-stretch ${isActive ? 'bg-primary/10' : 'hover:bg-secondary/40 active:bg-secondary/40'} transition-colors`}>
      <button
        onClick={() => onPick(e.entry_date)}
        className="flex-1 min-w-0 text-start ps-4 pe-2 py-3"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="kicker">{label}</span>
          {/* The rail is suppressed on a mood-only row: the mood is the
              content there, and repeating it two inches to the right says
              the same thing twice on one line. */}
          {hasWords && (
            <span className="flex items-center gap-1.5 shrink-0">
              {mood && <span className="text-xs leading-none" title={tFallback(`mood.label.${e.mood_score}`, MOOD_LABELS[e.mood_score - 1])}>{mood}</span>}
              {/* One word, not the full sentence the day screen shows: in a
                  scannable list the useful fact is THAT an entry is not a
                  same-day record; by how much is what opening it is for. */}
              {provenance(e).marked && (
                <span className="text-micro text-muted-foreground/70">{tFallback('journal.prov.tag', 'edited')}</span>
              )}
              {e.attachmentCount > 0 && (
                <span className="text-micro text-muted-foreground flex items-center gap-0.5">
                  <Paperclip className="w-3 h-3" /> {e.attachmentCount}
                </span>
              )}
            </span>
          )}
        </div>

        {moodOnly ? (
          <p className="text-sm font-semibold text-foreground mt-0.5">
            <span className="me-1.5">{mood}</span>
            {tFallback('journal.feltLabel', 'You felt')} {tFallback(`mood.label.${e.mood_score}`, MOOD_LABELS[e.mood_score - 1])}
          </p>
        ) : (
          <>
            {primary && <p className="text-sm font-semibold text-foreground mt-0.5 truncate">{primary}</p>}
            {secondary && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{secondary}</p>}
          </>
        )}
      </button>

      {/* Delete, per row. Deliberately NOT gated on the 7-day edit window:
          read-only protects a record you have moved on from against being
          quietly rewritten, but it is still your entry and removing it is a
          different act from editing it. The RLS policy agrees — `journal:
          owner delete` carries no age predicate. */}
      <button
        onClick={() => onAskDelete(e)}
        className="w-11 shrink-0 flex items-center justify-center text-muted-foreground/70 hover:text-destructive active:text-destructive transition-colors"
        aria-label={tFallback('journal.deleteEntryFor', 'Delete entry for {date}', { date: label })}
      >
        <MoreVertical className="w-4 h-4" />
      </button>
    </li>
  );
}

export default function JournalHistoryModal({ userId, activeDate, onClose, onPick }) {
  const { tFallback } = useLanguage();
  const [status, setStatus] = useState('loading');   // loading | ready | failed
  const [entries, setEntries] = useState([]);
  useBodyScrollLock(true);

  // One loader for both the mount and the retry button. The cancellation
  // check is a parameter rather than a second copy of the function — the
  // mount passes the effect's flag, the retry passes nothing.
  //
  // Type-checked rather than defaulted, because `onClick={load}` hands
  // React's synthetic event in as the first argument and a default only
  // applies to `undefined`. That is not hypothetical: it shipped for
  // about a minute here and threw "isCancelled is not a function" AFTER
  // setStatus('loading'), so the retry button left the sheet spinning
  // forever with no error on screen. The call site passes `() => load()`
  // now; this guard means the next caller who forgets cannot reproduce it.
  const load = useCallback(async (isCancelled) => {
    setStatus('loading');
    const { ok, rows } = await listEntries(userId, 365);
    if (typeof isCancelled === 'function' && isCancelled()) return;
    setEntries(rows);
    setStatus(ok ? 'ready' : 'failed');
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  const fmtDate = useDateFormatter();

  const [query, setQuery] = useState('');
  const [month, setMonth] = useState('');          // '' = every month
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Months are derived from the ENTRIES, not from a calendar: offering a month
  // with nothing in it is a control whose only possible result is an empty
  // list. Labels go through Intl so they follow the app language.
  const months = useMemo(() => monthsPresent(entries), [entries]);
  const visible = useMemo(() => filterEntries(entries, { query, month }), [entries, query, month]);
  const groups = useMemo(() => groupByMonth(visible, fmtDate), [visible, fmtDate]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const res = await deleteEntry(userId, pendingDelete.id);
    setDeleting(false);
    if (!res?.ok) {
      toast.error(tFallback('journal.deleteFailed', "Couldn't delete that entry."));
      return;
    }
    // Drop it locally rather than refetching: the read is 365 rows and the
    // answer is already known. A failed delete never reaches here, so the list
    // can't disagree with the database.
    setEntries(prev => prev.filter(r => r.id !== pendingDelete.id));
    setPendingDelete(null);
    toast.success(tFallback('journal.deleted', 'Entry deleted.'));
  };

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
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-secondary active:bg-secondary flex items-center justify-center" aria-label={tFallback("common.close", "Close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filters — only once there is something to filter. Rendering a
            search box over an empty or failed log offers a control that
            cannot do anything, and on the failed screen it would imply the
            entries are simply not matching. */}
        {status === 'ready' && entries.length > 0 && (
          <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tFallback('journal.searchPlaceholder', 'Search entries')}
                aria-label={tFallback('journal.searchPlaceholder', 'Search entries')}
                className="w-full h-9 ps-8 pe-2 rounded-lg bg-secondary/50 text-sm focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60"
              />
            </div>
            {/* A native select, so it gets the platform's own wheel on iOS
                rather than a custom menu that has to be rebuilt for touch. */}
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label={tFallback('journal.filterByMonth', 'Filter by month')}
              className="h-9 shrink-0 max-w-[42%] rounded-lg bg-secondary/50 text-sm px-2 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">{tFallback('journal.allDates', 'All dates')}</option>
              {months.map(m => (
                <option key={m.key} value={m.key}>
                  {monthLabel(parseISO(`${m.key}-01`), fmtDate)} ({m.count})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {status === 'loading' ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : status === 'failed' ? (
            /* A fact about US, not about the user. The old code rendered
               the empty state here, which told someone with a full journal
               that they had never written anything and invited them to
               start — over a log that may be entirely intact. */
            <div className="text-center py-12 px-6">
              <RefreshCw className="w-9 h-9 text-muted-foreground/40 mx-auto mb-2" />
              <p className="font-heading font-bold text-sm">{tFallback('journal.historyFailedTitle', "Couldn't load your log")}</p>
              <p className="text-xs text-muted-foreground mt-1">{tFallback('journal.historyFailedBody', 'Your entries are safe. This is us, not you.')}</p>
              <button
                onClick={() => load()}
                className="mt-4 px-4 py-2 rounded-lg bg-secondary text-sm font-semibold hover:opacity-80 active:opacity-80 transition-opacity"
              >
                {tFallback('journal.retry', 'Try again')}
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 px-6">
              <BookOpen className="w-9 h-9 text-muted-foreground/40 mx-auto mb-2" />
              <p className="font-heading font-bold text-sm">{tFallback('journal.historyEmptyTitle', 'No entries yet')}</p>
              <p className="text-xs text-muted-foreground mt-1">{tFallback('journal.historyEmptyBody', 'Write your first entry and it shows up here.')}</p>
            </div>
          ) : visible.length === 0 ? (
            /* Filtered to nothing — a fact about the QUERY, not about the
               user. The "no entries yet / write your first one" copy above
               would be a lie here, and an invitation to start a journal they
               already have. */
            <div className="text-center py-12 px-6">
              <Search className="w-9 h-9 text-muted-foreground/40 mx-auto mb-2" />
              <p className="font-heading font-bold text-sm">{tFallback('journal.noMatches', 'No entries match')}</p>
              <button
                onClick={() => { setQuery(''); setMonth(''); }}
                className="mt-3 px-4 py-2 rounded-lg bg-secondary text-sm font-semibold hover:opacity-80 active:opacity-80 transition-opacity"
              >
                {tFallback('journal.clearFilters', 'Clear filters')}
              </button>
            </div>
          ) : (
            groups.map(g => (
              <section key={g.key}>
                {/* Sticky, so "which month am I in" is answered continuously
                    rather than only at the moment you scroll past a divider. */}
                <h3 className="sticky top-0 z-10 bg-secondary px-4 py-1.5 text-micro font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  {g.label}
                </h3>
                <ul className="divide-y divide-border/60">
                  {g.rows.map(e => (
                    <EntryRow
                      key={e.id}
                      e={e}
                      isActive={e.entry_date === activeDate}
                      onPick={onPick}
                      onAskDelete={setPendingDelete}
                      tFallback={tFallback}
                      fmtDate={fmtDate}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        {/* Deleting an entry is not undoable and takes its photos with it, so
            it is one of the cases the ConfirmDialog header names as its
            reason to exist — not a candidate for the optimistic-plus-Undo
            pattern used elsewhere. */}
        <ConfirmDialog
          open={!!pendingDelete}
          onOpenChange={(o) => { if (!o && !deleting) setPendingDelete(null); }}
          title={tFallback('journal.deleteTitle', 'Delete this entry?')}
          description={tFallback(
            'journal.deleteBody',
            'Are you sure you want to delete this? This action cannot be undone.',
          )}
          confirmLabel={deleting
            ? tFallback('journal.deleting', 'Deleting…')
            : tFallback('common.delete', 'Delete')}
          cancelLabel={tFallback('common.cancel', 'Cancel')}
          onConfirm={handleDelete}
          destructive
        />
      </motion.div>
    </motion.div>,
    document.body,
  );
}
