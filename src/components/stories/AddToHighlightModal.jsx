// src/components/stories/AddToHighlightModal.jsx
//
// "Add to highlight" picker — shown from the StoryViewer's own-story
// bottom bar. Lists the user's existing highlight albums + an inline
// "create new" affordance. Tap an album → addStoryToHighlight upserts
// the (highlight_id, story_id) row.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus, Loader2, Check } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import {
  listHighlightsForUser,
  createHighlight,
  addStoryToHighlight,
} from '@/lib/data/storyHighlights';

export default function AddToHighlightModal({ open, onClose, storyId }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(null); // highlight id being added to OR 'new' when creating

  const { data: highlights = [] } = useQuery({
    queryKey: ['storyHighlights', user?.email],
    queryFn: () => listHighlightsForUser(user?.email),
    enabled: open && !!user?.email,
    staleTime: 60_000,
  });

  const handleAddTo = async (highlightId) => {
    if (busy || !storyId) return;
    setBusy(highlightId);
    const res = await addStoryToHighlight(highlightId, storyId);
    setBusy(null);
    if (res.ok) {
      toast.success(
        res.already
          ? tFallback('highlight.alreadyIn', 'Already in this album.')
          : tFallback('highlight.added', 'Added to highlight.'),
      );
      qc.invalidateQueries({ queryKey: ['storyHighlights', user?.email] });
      onClose?.();
    } else {
      toast.error(tFallback('highlight.addFailed', 'Could not add — try again.'));
    }
  };

  const handleCreateAndAdd = async () => {
    if (busy) return;
    const t = newTitle.trim();
    if (!t) {
      toast.error(tFallback('highlight.needTitle', 'Add a title.'));
      return;
    }
    setBusy('new');
    const created = await createHighlight({ title: t });
    if (!created.ok) {
      setBusy(null);
      toast.error(tFallback('highlight.failed', 'Could not create — try again.'));
      return;
    }
    const added = await addStoryToHighlight(created.id, storyId);
    setBusy(null);
    if (added.ok) {
      toast.success(tFallback('highlight.created', 'Album created — story added.'));
      qc.invalidateQueries({ queryKey: ['storyHighlights', user?.email] });
      setNewTitle('');
      onClose?.();
    } else {
      toast.error(tFallback('highlight.addFailed', 'Created the album but could not add the story.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="max-w-sm p-0 gap-0">
        <div className="p-5">
          <DialogHeader className="mb-3">
            <DialogTitle>{tFallback('highlight.pickTitle', 'Add to highlight')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-1 max-h-64 overflow-y-auto -mx-1 px-1">
            {highlights.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                {tFallback('highlight.noneYet', 'No albums yet — create one below.')}
              </p>
            )}
            {highlights.map((h) => (
              <button
                key={h.id}
                onClick={() => handleAddTo(h.id)}
                disabled={!!busy}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/40 transition-colors disabled:opacity-60"
              >
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-lg shrink-0">
                  <span aria-hidden="true">✨</span>
                </div>
                <span className="flex-1 text-start text-sm font-medium truncate">{h.title}</span>
                {busy === h.id ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                ) : (
                  <Check className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-border mt-3 pt-3">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              {tFallback('highlight.orCreate', 'Or create a new album')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="PRs · Meals · Trip"
                maxLength={40}
                className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <Button
                onClick={handleCreateAndAdd}
                disabled={busy === 'new' || !newTitle.trim()}
                size="sm"
                className="gap-1"
              >
                {busy === 'new' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {tFallback('highlight.createAdd', 'Add')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
