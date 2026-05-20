// src/components/debrief/DebriefVault.jsx
//
// Full-screen overlay that shows all past weekly debriefs in a scrollable
// grid, with tap-to-expand and PNG share (html2canvas).
//
// Accessible from ProfileMenu.

import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { ChevronLeft, Share2, Loader2, Trophy, Zap } from 'lucide-react';
import { listDebriefs } from '@/lib/data/debriefs';
import WeeklyDebriefCard from './WeeklyDebriefCard';
import { toast } from 'sonner';

// ── Mini preview card for the grid ───────────────────────────────────────────

function DebriefPreview({ debrief, onClick }) {
  const d = debrief.data || {};
  const vol    = d.volume_lbs ?? 0;
  const change = d.volume_change_pct;
  const wks    = d.workouts_count ?? 0;
  const isPr   = !!d.top_lift_is_pr;
  const xp     = d.xp_earned ?? 0;

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className="w-full text-left rounded-xl overflow-hidden border border-white/10 flex flex-col"
      style={{ background: 'linear-gradient(160deg, #0f0f14, #141824)' }}
    >
      {/* Week header */}
      <div className="px-3 pt-3 pb-2 border-b border-white/10">
        <p className="text-xs font-bold text-white">{debrief.week_label}</p>
        {debrief.epoch_name && (
          <p className="text-[10px] text-primary/60">{debrief.epoch_name}</p>
        )}
      </div>
      {/* Headline stat */}
      <div className="px-3 py-2 flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-lg font-heading font-black text-white tabular-nums">
            {Number(vol).toLocaleString()}
          </span>
          <span className="text-[10px] text-white/40 mt-1">lbs</span>
        </div>
        {change !== null && change !== undefined && (
          <span className={`text-[10px] font-semibold ${Number(change) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {Number(change) >= 0 ? '+' : ''}{change}%
          </span>
        )}
      </div>
      {/* Footer badges */}
      <div className="flex items-center gap-2 px-3 pb-3">
        <span className="text-[10px] text-white/40">{wks}w</span>
        {isPr && <Trophy className="w-3 h-3 text-yellow-400" />}
        <span className="text-[10px] text-yellow-400/60 flex items-center gap-0.5 ml-auto">
          <Zap className="w-2.5 h-2.5" />+{Number(xp).toLocaleString()}
        </span>
      </div>
    </motion.button>
  );
}

// ── Share / export ────────────────────────────────────────────────────────────

async function exportToPng(ref) {
  try {
    // Lazy-load html2canvas so the main bundle isn't bloated
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(ref.current, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
      allowTaint: true,
    });
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('[DebriefVault] html2canvas failed:', e);
    throw e;
  }
}

// ── Expanded debrief view ─────────────────────────────────────────────────────

function ExpandedDebrief({ debrief, onClose }) {
  const cardRef = useRef(null);
  const [sharing, setSharing] = useState(false);

  const handleShare = useCallback(async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const dataUrl = await exportToPng(cardRef);
      const blob    = await (await fetch(dataUrl)).blob();
      const file    = new File([blob], `flexyn-debrief-${debrief.week_label?.replace(/[^a-z0-9]/gi, '-')}.png`, { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Flexyn ${debrief.week_label}` });
      } else {
        // Fallback: download
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = file.name;
        a.click();
        toast.success('Debrief saved to downloads!');
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        toast.error('Could not export debrief. Try again.');
        console.error(e);
      }
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
      className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm font-medium text-white/60 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <span className="font-heading font-bold text-white text-sm">{debrief.week_label}</span>
        <button
          onClick={handleShare}
          disabled={sharing}
          className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
        >
          {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
          {sharing ? 'Exporting…' : 'Share'}
        </button>
      </div>

      {/* Card — scrollable on small screens */}
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="max-w-sm mx-auto" ref={cardRef}>
          <WeeklyDebriefCard debrief={debrief} forExport />
        </div>
      </div>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DebriefVault({ onClose }) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(null); // debrief object | null
  const [epochFilter, setEpochFilter] = useState(null); // null = all

  const { data: debriefs = [], isLoading } = useQuery({
    queryKey: ['weeklyDebriefs', user?.id],
    queryFn: listDebriefs,
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  // Epoch options (future feature — only show if any row has epoch_name)
  const epochs = [...new Set(debriefs.map(d => d.epoch_name).filter(Boolean))];
  const filtered = epochFilter
    ? debriefs.filter(d => d.epoch_name === epochFilter)
    : debriefs;

  return (
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
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-1.5">
          <Trophy className="w-4 h-4 text-primary" />
          <span className="font-heading font-bold text-base">Debrief Vault</span>
        </div>
        <div className="w-16" />
      </div>

      {/* Epoch filter chips (hidden until epochs exist) */}
      {epochs.length > 0 && (
        <div className="flex gap-2 px-4 py-2 overflow-x-auto shrink-0 border-b border-border">
          <button
            onClick={() => setEpochFilter(null)}
            className={`text-xs px-3 py-1 rounded-full border font-medium whitespace-nowrap transition-colors ${
              epochFilter === null
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          {epochs.map(ep => (
            <button
              key={ep}
              onClick={() => setEpochFilter(ep)}
              className={`text-xs px-3 py-1 rounded-full border font-medium whitespace-nowrap transition-colors ${
                epochFilter === ep
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {ep}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Trophy className="w-10 h-10 text-muted-foreground/40" />
            <p className="font-heading font-bold text-foreground">No debriefs yet</p>
            <p className="text-sm text-muted-foreground max-w-[220px]">
              Your first Weekly Debrief will appear here after the next Sunday summary runs.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map(debrief => (
              <DebriefPreview
                key={debrief.id}
                debrief={debrief}
                onClick={() => setExpanded(debrief)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Expanded full-card overlay */}
      <AnimatePresence>
        {expanded && (
          <ExpandedDebrief
            debrief={expanded}
            onClose={() => setExpanded(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
