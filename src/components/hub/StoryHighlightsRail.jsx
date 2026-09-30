// src/components/hub/StoryHighlightsRail.jsx
//
// Horizontal rail of pinned story-highlight albums on a Hub profile.
// Each album is a circular cover with a title underneath. Tapping
// opens the album viewer (modal). Own-profile shows an "+ New" tile
// to start a new album.
//
// Backed by migration 099's story_highlights + story_highlight_items.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/LanguageContext';
import { listHighlightsForUser, createHighlight, deleteHighlight } from '@/lib/data/storyHighlights';
import { useLongPress } from '@/hooks/useLongPress';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

function NewHighlightModal({ open, onClose, onCreated }) {
  const { tFallback } = useLanguage();
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error(tFallback('highlight.needTitle', 'Add a title.'));
      return;
    }
    setSubmitting(true);
    const res = await createHighlight({ title: trimmed });
    setSubmitting(false);
    if (res.ok) {
      onCreated?.(res.id);
      setTitle('');
      onClose?.();
    } else {
      toast.error(tFallback('highlight.failed', 'Could not create. Try again.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="max-w-sm p-0 gap-0">
        <div className="p-5">
          <DialogHeader className="mb-3">
            <DialogTitle>{tFallback('highlight.newTitle', 'New highlight album')}</DialogTitle>
          </DialogHeader>
          <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            {tFallback('highlight.title', 'Album title')}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tFallback("storyHighlightsRail.prsMealsTrip", "PRs · Meals · Trip")}
            maxLength={40}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            autoFocus
          />
          <div className="flex gap-2 mt-5">
            <Button variant="outline" onClick={onClose} className="flex-1">
              {tFallback('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1 gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {tFallback('highlight.create', 'Create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// One album. The owner deletes it with a long press (or a right click on a
// desktop). It used to be right click only, which an iPhone cannot do, so
// on the phones this app ships to an album could never be removed.
function HighlightTile({ highlight: h, isOwn, onOpen, onAskDelete }) {
  const { tFallback } = useLanguage();
  const longPress = useLongPress(() => onAskDelete(h), { ms: 500 });
  return (
    <button
      type="button"
      {...(isOwn ? longPress.bind : {})}
      onClick={(e) => { if (!isOwn || longPress.consumeClick(e)) onOpen?.(h); }}
      onContextMenu={isOwn ? (e) => { e.preventDefault(); onAskDelete(h); } : undefined}
      className="shrink-0 flex flex-col items-center gap-1.5 group max-w-[80px] select-none [-webkit-touch-callout:none]"
      aria-label={isOwn
        ? tFallback('highlight.openOrHold', '{title}. Hold to delete.', { title: h.title })
        : h.title}
    >
      <div className="w-16 h-16 rounded-full ring-2 ring-border group-hover:ring-primary transition-all overflow-hidden bg-secondary flex items-center justify-center">
        {h.cover_url ? (
          <img src={h.cover_url} alt="" className="w-full h-full object-cover pointer-events-none" loading="lazy" draggable={false} />
        ) : (
          <span className="font-heading font-bold text-lg text-muted-foreground" aria-hidden="true">
            {(h.title || '?').trim().charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      {/* leading-normal, not text-micro's own 1.25. `truncate` sets
          overflow:hidden, and at 11px a 1.25 line-height leaves the
          glyph box taller than its container — so the tops of capitals
          were being shaved off ("PRs" lost the tip of the P). The
          ellipsis behaviour is unchanged; only the vertical room is. */}
      <span className="text-micro leading-normal font-medium truncate w-full text-center">{h.title}</span>
    </button>
  );
}

export default function StoryHighlightsRail({ userId, isOwn, onOpenAlbum }) {
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const { data: highlights = [] } = useQuery({
    queryKey: ['storyHighlights', userId],
    queryFn: () => listHighlightsForUser(userId),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });

  // Don't render at all if a non-own profile has zero highlights —
  // empty rail is wasted real estate. Own profile still shows the
  // "+ New" tile even when empty so the user can create their first.
  // Nothing until there is an album, for the owner too. The empty dashed
  // "New" circle sat on the public page as a to-do. The first album is
  // made from a story (Add to highlight in the viewer); after that the
  // rail offers "New" here.
  if (highlights.length === 0) return null;

  const handleDelete = async () => {
    const id = pendingDelete?.id;
    setPendingDelete(null);
    if (!id) return;
    const res = await deleteHighlight(id);
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['storyHighlights', userId] });
    } else {
      toast.error(tFallback('notifications.deleteFailed', 'Could not delete. Try again.'));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-6"
    >
      <div className="flex gap-3 overflow-x-auto pb-1 px-1 -mx-1 scrollbar-hide">
        {isOwn && (
          <button
            onClick={() => setComposeOpen(true)}
            className="shrink-0 flex flex-col items-center gap-1.5 group"
            aria-label={tFallback('highlight.newAria', 'Create a new highlight album')}
          >
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-border flex items-center justify-center text-muted-foreground group-hover:border-primary group-hover:text-primary transition-colors">
              <Plus className="w-5 h-5" aria-hidden="true" />
            </div>
            <span className="text-micro text-muted-foreground">
              {tFallback('highlight.new', 'New')}
            </span>
          </button>
        )}
        {highlights.map((h) => (
          <HighlightTile
            key={h.id}
            highlight={h}
            isOwn={isOwn}
            onOpen={onOpenAlbum}
            onAskDelete={setPendingDelete}
          />
        ))}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={tFallback('storyHighlightsRail.deleteThisHighlightAlbum', 'Delete this highlight album?')}
        description={pendingDelete?.title}
        confirmLabel={tFallback('common.delete', 'Delete')}
        cancelLabel={tFallback('common.cancel', 'Cancel')}
        onConfirm={handleDelete}
        destructive
      />

      {composeOpen && (
        <NewHighlightModal
          open={composeOpen}
          onClose={() => setComposeOpen(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['storyHighlights', userId] });
            toast.success(tFallback('highlight.created', 'Album created, story added.'));
          }}
        />
      )}
    </motion.div>
  );
}
