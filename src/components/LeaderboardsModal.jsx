// src/components/LeaderboardsModal.jsx
//
// Thin wrapper around LeaderboardsContent that renders it inside a Dialog.
// Most of the leaderboard rendering lives in LeaderboardsContent so the same
// component can also appear inline (e.g. as a Hub tab).

import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import LeaderboardsContent from './LeaderboardsContent';

export default function LeaderboardsModal({ open, onClose }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[88vh] overflow-y-auto p-0 gap-0"
        onInteractOutside={(e) => {
          // Only close when the user clicks the dark backdrop overlay,
          // not when clicking inside the dialog (e.g. metric pill buttons).
          const target = e.target;
          const isOverlay = target?.hasAttribute('data-radix-dialog-overlay') ||
            target?.closest('[data-radix-dialog-overlay]') !== null ||
            target?.classList?.contains('bg-black\\/80');
          if (!isOverlay) {
            e.preventDefault();
          }
        }}
        onEscapeKeyDown={onClose}
      >
        <LeaderboardsContent active={open} />
      </DialogContent>
    </Dialog>
  );
}
