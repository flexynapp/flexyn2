// src/components/report/PlayerMenu.jsx
//
// The vertical ⋯ that sits beside another player's name in competition
// views (league bracket, leaderboards, duels, rivals, crew wars, gym board).
// It holds "Report", which opens ReportPlayerSheet.
//
// Renders nothing for your own row, a row with no user id, or a signed-out
// viewer, so callers can drop it into every row without a guard. The viewer
// is passed in rather than read from AuthContext because these rows render
// in places (and tests) without an AuthProvider above them. The rows it lives in are usually
// tappable themselves (they open the profile), so every pointer, click and
// key event is stopped here; tapping the dots must never also open the row.

import React, { Suspense, useState } from 'react';
import { MoreVertical, Flag } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/lib/LanguageContext';

// Most people never report anyone, so the sheet stays out of every chunk
// that renders a leaderboard.
const ReportPlayerSheet = React.lazy(() => import('./ReportPlayerSheet'));

const stop = (e) => e.stopPropagation();

export default function PlayerMenu({ userId, currentUserId, username, context, contextId = null, className = '' }) {
  const { tFallback } = useLanguage();
  const [reportOpen, setReportOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  if (!userId || !currentUserId || userId === currentUserId) return null;

  const name = username ? `@${username}` : '';
  const label = name
    ? tFallback('reportPlayer.menuFor', 'More options for {name}', { name })
    : tFallback('reportPlayer.menu', 'More options');

  return (
    // A wrapper that swallows events, because the Radix portal content is
    // outside this subtree but React still bubbles its synthetic events
    // through the tree, up to the row's onClick.
    <span className="contents" onClick={stop} onPointerDown={stop} onPointerUp={stop} onKeyDown={stop}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={label}
            className={`relative shrink-0 w-8 h-8 -me-1.5 rounded-md before:absolute before:-inset-1.5 before:content-[""] flex items-center justify-center text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors ${className}`}
          >
            <MoreVertical className="w-4 h-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} collisionPadding={12} className="z-[10000] min-w-[11rem]">
          <DropdownMenuItem
            onSelect={() => { setMounted(true); setReportOpen(true); }}
            className="text-destructive focus:text-destructive gap-2"
          >
            <Flag className="w-4 h-4" aria-hidden="true" />
            {name
              ? tFallback('reportPlayer.menuReportName', 'Report {name}', { name })
              : tFallback('reportPlayer.menuReport', 'Report player')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {mounted && (
        <Suspense fallback={null}>
          <ReportPlayerSheet
            open={reportOpen}
            onClose={() => setReportOpen(false)}
            userId={userId}
            username={username}
            context={context}
            contextId={contextId}
          />
        </Suspense>
      )}
    </span>
  );
}
