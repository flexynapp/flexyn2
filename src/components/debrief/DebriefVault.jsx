// src/components/debrief/DebriefVault.jsx
//
// "Weekly Reviews" — the full-screen index of every week the app has a
// review for, and the reader for one of them.
//
// (The file keeps its old name so the lazy import in ProfileMenu and the
// manual-chunk entry in vite.config keep resolving. The FEATURE is called
// Weekly Reviews everywhere the user can see it — "Debrief Vault" was
// internal jargon that had leaked onto a menu row.)
//
// Drawn from the Penpot page "Weekly Reviews — dashboard": board B is this
// index, board A is the week body (WeeklyDebriefCard), board C is the state
// handling, board D is the element ledger.
//
// THREE THINGS THIS FIXES BEYOND THE RENAME
// -----------------------------------------
//  • The index was a 2-column grid of gradient tiles. A week is a ROW in a
//    sequence, not a tile in a collection — as a list it reads as a timeline,
//    each row carries a volume bar against the best week, and the number
//    earns its space (CLAUDE.md: "data must be earned"). The gradient is
//    gone too; it was on the published list of generated-UI tells.
//  • The epoch filter chips are removed. `epoch_id`/`epoch_name` are marked
//    "reserved for a future Epochs feature" in migration 051 and are NULL on
//    every row in production, so the chip row could never render and the
//    filter state behind it was dead weight.
//  • Auto-generation no longer manufactures empty weeks. It also no longer
//    reads `debriefs` from a stale closure — that effect runs once on user
//    id, when the list is still [], so its `hasLast` check was ALWAYS false
//    and it regenerated the previous week on every single open.

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { ChevronLeft, Share2, Loader2, RefreshCw, CalendarRange } from 'lucide-react';
import { listDebriefs, generateWeeklyReview, currentWeekStart, prevWeekStart } from '@/lib/data/debriefs';
import WeeklyDebriefCard from './WeeklyDebriefCard';
import { reportError } from '@/lib/reportError';
import { toast } from '@/lib/toast';
import { useNumberFormatter } from '@/lib/intl';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

// ── One week, as a row ────────────────────────────────────────────────────

function WeekRow({ debrief, onClick, isCurrentWeek, maxVolume, last }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const d   = debrief.data || {};
  const tr  = d.training || {};
  const vol = Number(tr.volume_lbs ?? d.volume_lbs ?? 0);
  const n   = Number(tr.sessions ?? d.workouts_count ?? 0);
  const xp  = Number((d.game || {}).xp_earned ?? d.xp_earned ?? 0);
  const pct = maxVolume > 0 ? Math.max(2, (vol / maxVolume) * 100) : 0;

  const range = d.week_start && d.week_end
    ? `${d.week_start.slice(5)} → ${d.week_end.slice(5)}`
    : null;

  return (
    <button
      onClick={onClick}
      className={`w-full text-start py-3 ${last ? '' : 'border-b border-border'} active:bg-secondary/40 transition-colors`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold text-foreground truncate">{debrief.week_label}</span>
          {isCurrentWeek && (
            <span className="shrink-0 text-micro font-bold uppercase tracking-wider text-primary border border-primary/50 rounded-full px-1.5 py-0.5">
              {tFallback("dashboard.stats.thisWeek", "This week")}
            </span>
          )}
        </span>
        <span className="font-heading font-bold text-[15px] tabular-nums text-foreground shrink-0">
          {fmt(Math.round(vol))}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-0.5">
        <span className="text-micro text-muted-foreground">{range}</span>
        <span className="text-micro text-muted-foreground">
          {n} session{n === 1 ? '' : 's'} · {fmt(xp)} XP
        </span>
      </div>
      <div className="h-1 rounded-full bg-secondary overflow-hidden mt-2">
        <div
          className={`h-full rounded-full ${isCurrentWeek ? 'bg-primary' : 'bg-muted-foreground/50'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}

// ── PNG export ────────────────────────────────────────────────────────────

async function exportToPng(ref) {
  const html2canvas = (await import('html2canvas')).default;
  const canvas = await html2canvas(ref.current, {
    backgroundColor: null,
    scale: 2,
    useCORS: true,
    allowTaint: true,
  });
  return canvas.toDataURL('image/png');
}

// ── One week, expanded ────────────────────────────────────────────────────

function ExpandedReview({ debrief, onClose, onRefresh, isRefreshing }) {
  const { tFallback } = useLanguage();
  const cardRef = useRef(null);
  const [sharing, setSharing] = useState(false);

  const handleShare = useCallback(async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const dataUrl = await exportToPng(cardRef);
      const blob    = await (await fetch(dataUrl)).blob();
      const name    = `flexyn-week-${debrief.week_label?.replace(/[^a-z0-9]/gi, '-')}.png`;
      const file    = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Flexyn ${debrief.week_label}` });
      } else {
        const a = document.createElement('a');
        a.href = dataUrl; a.download = name; a.click();
        toast.success(tFallback('debriefVault.savedToDownloads', 'Review saved to downloads.'));
      }
    } catch (e) {
      if (e?.name !== 'AbortError') toast.error(tFallback('debriefVault.exportFailed', 'Could not export. Try again.'));
    } finally {
      setSharing(false);
    }
  }, [debrief]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      className="fixed inset-0 z-[300] bg-background flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-border">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> {tFallback("achievements.vault.back", "Back")}
        </button>
        <span className="font-heading font-bold text-foreground text-sm">{debrief.week_label}</span>
        <div className="flex items-center gap-3">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="text-muted-foreground hover:text-foreground active:text-foreground transition-colors disabled:opacity-30"
              title={tFallback("debriefVault.recalculateThisWeek", "Recalculate this week")}
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            onClick={handleShare}
            disabled={sharing}
            className="flex items-center gap-1.5 text-sm font-medium text-primary active:opacity-70 transition-opacity disabled:opacity-50"
          >
            {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
            {sharing ? 'Exporting…' : 'Share'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-md mx-auto" ref={cardRef}>
          <WeeklyDebriefCard debrief={debrief} forExport />
        </div>
      </div>
    </motion.div>
  );
}

// ── Index ─────────────────────────────────────────────────────────────────

export default function DebriefVault({ onClose }) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(null);
  const [sortOrder, setSortOrder] = useState('recent'); // 'recent' | 'oldest'
  const thisWeek = currentWeekStart();
  useBodyScrollLock(true);

  const { data: debriefs = [], isLoading } = useQuery({
    queryKey: ['weeklyDebriefs', user?.id],
    queryFn:  listDebriefs,
    enabled:  !!user?.id,
    staleTime: 60_000,
  });

  // ── Auto-generate on open ─────────────────────────────────────────────
  // Current week + the one before it. Generating the previous week is safe
  // now that migration 328 refuses to create a row for a week with no
  // activity of any kind — before that guard this manufactured an empty
  // card every time someone opened the screen early in a week.
  const genMut = useMutation({
    mutationFn: (ws) => generateWeeklyReview(ws),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weeklyDebriefs', user?.id] }),
    onError: () => {}, // silent — the archive is still readable from cache
  });

  const autoGenRanRef = useRef(false);
  useEffect(() => {
    if (!user?.id || autoGenRanRef.current) return;
    autoGenRanRef.current = true;
    genMut.mutate(currentWeekStart());
    genMut.mutate(prevWeekStart());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Refresh one week ──────────────────────────────────────────────────
  const refreshMut = useMutation({
    mutationFn: (ws) => generateWeeklyReview(ws),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weeklyDebriefs', user?.id] });
      const before = expanded ? JSON.stringify(expanded.data || {}) : null;
      if (!expanded) { toast.success(tFallback('debriefVault.refreshed', 'Review refreshed.')); return; }
      qc.fetchQuery({ queryKey: ['weeklyDebriefs', user?.id], queryFn: listDebriefs })
        .then(data => {
          const fresh = data.find(x =>
            x.week_number === expanded.week_number && x.year === expanded.year);
          if (fresh) setExpanded(fresh);
          const after = fresh ? JSON.stringify(fresh.data || {}) : null;
          toast.success(before !== null && after !== null && before === after
            ? tFallback(
              'debriefVault.alreadyCurrent',
              'You are all caught up. This review already reflects your latest data.',
            )
            : tFallback('debriefVault.refreshed', 'Review refreshed.'));
        })
        .catch(err => {
          reportError(err, { feature: 'review.refresh-fetch', level: 'warning', userEmail: user?.email });
          toast.success(tFallback('debriefVault.refreshed', 'Review refreshed.'));
        });
    },
    onError: (err) => {
      toast.error(tFallback('debriefVault.refreshFailed', 'Could not refresh. Try again.'));
      reportError(err, { feature: 'review.refresh', userEmail: user?.email });
    },
  });

  // Sort by (year, week) so the toggle is deterministic regardless of the
  // order PostgREST returned.
  const visible = useMemo(() => {
    const key = (x) => (x.year || 0) * 100 + (x.week_number || 0);
    return [...debriefs].sort((a, b) =>
      sortOrder === 'recent' ? key(b) - key(a) : key(a) - key(b));
  }, [debriefs, sortOrder]);

  const maxVolume = useMemo(() => debriefs.reduce((m, x) => {
    const v = Number((x.data?.training || {}).volume_lbs ?? x.data?.volume_lbs ?? 0);
    return v > m ? v : m;
  }, 0), [debriefs]);

  const isGenerating = genMut.isPending;

  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 32 }}
      transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      className="fixed inset-0 z-[200] bg-background flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> {tFallback("achievements.vault.back", "Back")}
        </button>
        <span className="font-heading font-bold text-base text-foreground">{tFallback("profile.debriefVault", "Weekly Reviews")}</span>
        <button
          onClick={() => genMut.mutate(thisWeek)}
          disabled={genMut.isPending}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground active:text-foreground transition-colors disabled:opacity-40"
          title={tFallback("debriefVault.recalculateThisWeek", "Recalculate this week")}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${genMut.isPending ? 'animate-spin' : ''}`} />
          {tFallback("adminReports.refresh", "Refresh")}
        </button>
      </div>

      {/* Sort — only earns its place once there is something to reorder */}
      {debriefs.length > 1 && (
        <div className="flex items-center justify-end gap-1 px-4 py-2 shrink-0">
          <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground me-1">{tFallback("debriefVault.sort", "Sort")}</span>
          {[{ id: 'recent', label: 'Recent' }, { id: 'oldest', label: 'Oldest' }].map(opt => (
            <button
              key={opt.id}
              onClick={() => setSortOrder(opt.id)}
              className={`px-2.5 py-1 rounded-full text-micro font-bold border transition-colors ${
                sortOrder === opt.id
                  ? 'text-primary border-primary/50'
                  : 'text-muted-foreground border-border active:text-foreground'
              }`}
            >
              {tFallback(`debriefVault.sort.${opt.id}`, opt.label)}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {(isLoading || isGenerating) && debriefs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Building your review…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <CalendarRange className="w-10 h-10 text-muted-foreground/30" />
            <p className="font-heading font-bold text-foreground">{tFallback("debriefVault.yourFirstReviewLandsSunday", "Your first review lands Sunday")}</p>
            <p className="text-sm text-muted-foreground max-w-[260px]">
              Log a workout, a meal or a night of sleep and this page starts keeping score for you.
            </p>
          </div>
        ) : (
          <div>
            {visible.map((debrief, i) => (
              <WeekRow
                key={debrief.id}
                debrief={debrief}
                isCurrentWeek={debrief.data?.week_start === thisWeek}
                maxVolume={maxVolume}
                last={i === visible.length - 1}
                onClick={() => setExpanded(debrief)}
              />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <ExpandedReview
            debrief={expanded}
            onClose={() => setExpanded(null)}
            onRefresh={expanded.data?.week_start ? () => refreshMut.mutate(expanded.data.week_start) : null}
            isRefreshing={refreshMut.isPending}
          />
        )}
      </AnimatePresence>
    </motion.div>,
    document.body,
  );
}
