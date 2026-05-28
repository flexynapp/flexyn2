// src/components/debrief/DebriefVault.jsx
//
// Full-screen overlay listing all past weekly debriefs.
// On mount it auto-generates the current week's summary via the
// generate_my_weekly_debrief RPC (idempotent — upserts, never duplicates).
// Users can force a refresh of any week with the ↻ button.
//
// Accessible from ProfileMenu.
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { ChevronLeft, Share2, Loader2, Trophy, Zap, RefreshCw } from 'lucide-react';
import { listDebriefs, generateWeeklyDebrief, currentWeekStart, prevWeekStart } from '@/lib/data/debriefs';
import WeeklyDebriefCard from './WeeklyDebriefCard';
import { reportError } from '@/lib/reportError';
import { toast } from 'sonner';
import { useNumberFormatter } from '@/lib/intl';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// ── Mini preview card ─────────────────────────────────────────────────────────

function DebriefPreview({ debrief, onClick, isCurrentWeek }) {
  const fmt    = useNumberFormatter();
  const d      = debrief.data || {};
  const vol    = d.volume_lbs    ?? 0;
  const change = d.volume_change_pct;
  const wks    = d.workouts_count ?? 0;
  const isPr   = !!d.top_lift_is_pr;
  const xp     = d.xp_earned     ?? 0;

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className="w-full text-start rounded-xl overflow-hidden border flex flex-col"
      style={{
        background: 'linear-gradient(160deg, #0f0f14, #141824)',
        borderColor: isCurrentWeek ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.08)',
      }}
    >
      {/* Week header */}
      <div className="px-3 pt-3 pb-2 border-b border-white/10 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-white">{debrief.week_label}</p>
          {debrief.epoch_name && (
            <p className="text-[10px] text-purple-400/70">{debrief.epoch_name}</p>
          )}
        </div>
        {isCurrentWeek && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-purple-400 bg-purple-500/15 px-1.5 py-0.5 rounded-full">
            This Week
          </span>
        )}
      </div>

      {/* Volume */}
      <div className="px-3 py-2 flex-1">
        <div className="flex items-end gap-1.5 mb-1">
          <span className="text-xl font-heading font-black text-white tabular-nums">
            {fmt(Number(vol))}
          </span>
          <span className="text-[10px] text-white/40 mb-0.5">lbs</span>
        </div>
        {change != null && (
          <span className={`text-[10px] font-semibold ${Number(change) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {Number(change) >= 0 ? '+' : ''}{change}% vs prev
          </span>
        )}
      </div>

      {/* Badges */}
      <div className="flex items-center gap-2 px-3 pb-3">
        <span className="text-[10px] text-white/40">{wks} sessions</span>
        {isPr && <Trophy className="w-3 h-3 text-yellow-400" />}
        <span className="ml-auto text-[10px] text-yellow-400/60 flex items-center gap-0.5">
          <Zap className="w-2.5 h-2.5" />+{fmt(Number(xp))}
        </span>
      </div>
    </motion.button>
  );
}

// ── PNG export ────────────────────────────────────────────────────────────────

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

// ── Expanded debrief view ─────────────────────────────────────────────────────

function ExpandedDebrief({ debrief, onClose, onRefresh, isRefreshing }) {
  const cardRef = useRef(null);
  const [sharing, setSharing] = useState(false);

  const handleShare = useCallback(async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const dataUrl = await exportToPng(cardRef);
      const blob    = await (await fetch(dataUrl)).blob();
      const name    = `flexyn-debrief-${debrief.week_label?.replace(/[^a-z0-9]/gi, '-')}.png`;
      const file    = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Flexyn ${debrief.week_label}` });
      } else {
        const a = document.createElement('a');
        a.href = dataUrl; a.download = name; a.click();
        toast.success('Debrief saved to downloads!');
      }
    } catch (e) {
      if (e?.name !== 'AbortError') toast.error('Could not export. Try again.');
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
      className="fixed inset-0 z-[300] bg-black/85 backdrop-blur-sm flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm font-medium text-white/60 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <span className="font-heading font-bold text-white text-sm">{debrief.week_label}</span>
        <div className="flex items-center gap-3">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="text-white/40 hover:text-white transition-colors disabled:opacity-30"
              title="Refresh this week's data"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            onClick={handleShare}
            disabled={sharing}
            className="flex items-center gap-1.5 text-sm font-medium text-purple-400 hover:text-purple-300 transition-colors disabled:opacity-50"
          >
            {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
            {sharing ? 'Exporting…' : 'Share'}
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="max-w-sm mx-auto" ref={cardRef}>
          <WeeklyDebriefCard debrief={debrief} forExport />
        </div>
      </div>
    </motion.div>
  );
}

// ── Main vault ────────────────────────────────────────────────────────────────

export default function DebriefVault({ onClose }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(null);
  const thisWeek = currentWeekStart();
  const lastWeek = prevWeekStart();
  useBodyScrollLock(true);

  // ── Fetch archive ──────────────────────────────────────────────────────────
  const { data: debriefs = [], isLoading } = useQuery({
    queryKey: ['weeklyDebriefs', user?.id],
    queryFn:  listDebriefs,
    enabled:  !!user?.id,
    staleTime: 60_000,
  });

  // ── Auto-generate current + previous week on open ─────────────────────────
  const genMut = useMutation({
    mutationFn: (ws) => generateWeeklyDebrief(ws),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weeklyDebriefs', user?.id] }),
    onError: () => {}, // silent — vault still usable with cached data
  });

  const autoGenRanRef = useRef(false);
  useEffect(() => {
    if (!user?.id || autoGenRanRef.current) return;
    autoGenRanRef.current = true;
    // Generate this week silently (audit B-29 — was firing on every mount)
    genMut.mutate(thisWeek);
    // Also generate last week if it doesn't exist yet (Sunday-close edge case)
    const hasLast = debriefs.some(d => d.week_label?.includes(lastWeek.slice(0, 7)));
    if (!hasLast) genMut.mutate(lastWeek);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Refresh a specific week ────────────────────────────────────────────────
  const refreshMut = useMutation({
    mutationFn: (ws) => generateWeeklyDebrief(ws),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weeklyDebriefs', user?.id] });
      // Re-fetch the expanded card data and compare against the
      // pre-refresh snapshot. When nothing changed (no new workouts
      // logged since the last generation) we reassure the user that
      // the summary is current rather than implying a failure or
      // saying "nothing to refresh" (the wording the team rejected).
      const before = expanded ? JSON.stringify(expanded.data || {}) : null;
      if (expanded) {
        qc.fetchQuery({ queryKey: ['weeklyDebriefs', user?.id], queryFn: listDebriefs })
          .then(data => {
            const refreshed = data.find(d =>
              d.week_number === expanded.week_number && d.year === expanded.year
            );
            if (refreshed) setExpanded(refreshed);
            const after = refreshed ? JSON.stringify(refreshed.data || {}) : null;
            if (before !== null && after !== null && before === after) {
              toast.success("You're all caught up — this summary already reflects your latest data.");
            } else {
              toast.success('Summary refreshed.');
            }
          })
          .catch(err => {
            reportError(err, { feature: 'debrief.refresh-fetch', level: 'warning', userEmail: user?.email });
            toast.success('Summary refreshed.');
          });
      } else {
        toast.success('Summary refreshed.');
      }
    },
    onError: (err) => {
      // Duplicate `onError` key was silently shadowing the reportError
      // call (audit B-6) — one handler, both jobs.
      toast.error('Could not refresh — try again.');
      reportError(err, { feature: 'debrief.refresh', userEmail: user?.email });
    },
  });

  const epochs   = [...new Set(debriefs.map(d => d.epoch_name).filter(Boolean))];
  const [filter, setFilter] = useState(null);
  const [sortOrder, setSortOrder] = useState('recent'); // 'recent' | 'oldest'
  const filtered = filter ? debriefs.filter(d => d.epoch_name === filter) : debriefs;
  // Sort by (year, week_number) so the toggle is deterministic
  // regardless of fetch order. 'recent' = newest first.
  const visible = [...filtered].sort((a, b) => {
    const av = (a.year || 0) * 100 + (a.week_number || 0);
    const bv = (b.year || 0) * 100 + (b.week_number || 0);
    return sortOrder === 'recent' ? bv - av : av - bv;
  });

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
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-1.5">
          <Trophy className="w-4 h-4 text-purple-400" />
          <span className="font-heading font-bold text-base">Weekly Summary</span>
        </div>
        <button
          onClick={() => genMut.mutate(thisWeek)}
          disabled={genMut.isPending}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          title="Refresh this week"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${genMut.isPending ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Epoch filter chips */}
      {epochs.length > 0 && (
        <div className="flex gap-2 px-4 py-2 overflow-x-auto shrink-0 border-b border-border">
          {[null, ...epochs].map(ep => (
            <button
              key={ep ?? '__all'}
              onClick={() => setFilter(ep)}
              className={`text-xs px-3 py-1 rounded-full border font-medium whitespace-nowrap transition-colors ${
                filter === ep
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {ep ?? 'All'}
            </button>
          ))}
        </div>
      )}

      {/* Sort toggle — Recent ⇄ Oldest */}
      {debriefs.length > 1 && (
        <div className="flex items-center justify-end gap-1 px-4 py-2 shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground me-1">Sort</span>
          {[
            { id: 'recent', label: 'Recent' },
            { id: 'oldest', label: 'Oldest' },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setSortOrder(opt.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                sortOrder === opt.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {(isLoading || isGenerating) && debriefs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Generating your summary…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Trophy className="w-10 h-10 text-muted-foreground/30" />
            <p className="font-heading font-bold text-foreground">No summaries yet</p>
            <p className="text-sm text-muted-foreground max-w-[240px]">
              Log a workout this week and your first Weekly Summary will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {visible.map(debrief => {
              const ws = debrief.data?.week_start;
              const isThis = ws === thisWeek;
              return (
                <DebriefPreview
                  key={debrief.id}
                  debrief={debrief}
                  isCurrentWeek={isThis}
                  onClick={() => setExpanded(debrief)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Expanded full-card overlay */}
      <AnimatePresence>
        {expanded && (
          <ExpandedDebrief
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
