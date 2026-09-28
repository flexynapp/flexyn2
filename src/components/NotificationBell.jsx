// src/components/NotificationBell.jsx
//
// Lives in the global Header. Shows the unread count as a small red badge
// and opens the NotificationPanel on tap. Polls every 30 s in the background.

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as notifications from '@/lib/data/notifications';
import * as hubMessages from '@/lib/data/hubMessages';
import NotificationPanel from './NotificationPanel';

// Layout mounts TWO bells: one in the desktop sidebar (`hidden lg:flex`) and
// one in the phone header (`lg:hidden`). CSS hides one, but both are mounted,
// and each owns a panel that renders through a portal, so a hidden bell's
// panel is still visible. Anything a bell does on its own initiative (the
// `?notifications=1` deep link) must therefore run in exactly one of them:
// the one whose surface the current viewport actually shows.
const DESKTOP_QUERY = '(min-width: 1024px)';
function isDesktopViewport() {
  try { return !!window.matchMedia?.(DESKTOP_QUERY).matches; } catch { return false; }
}

export default function NotificationBell({ surface = 'header' }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // What the badge said when the sheet opened. The badge is cleared
  // optimistically on open, so by the time the panel could look it is 0;
  // the panel needs the real number to know there is something to mark
  // read even if the user closes before the list has loaded.
  const [unreadAtOpen, setUnreadAtOpen] = useState(0);

  const { data: count = 0 } = useQuery({
    queryKey: ['notificationsUnread', user?.id],
    queryFn: () => notifications.unreadCount(user),
    enabled: !!user?.id,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // DM unread count for combined app-badge total
  const { data: dmUnread = 0 } = useQuery({
    queryKey: ['hubUnreadCount', user?.email],
    queryFn: () => hubMessages.unreadCountFor(user?.email),
    enabled: !!user?.email,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // App icon badge (PWA Badging API). Combines notification + DM unread
  // counts so the home-screen icon reflects the full "attention needed"
  // total. Clears to 0 when both counts drop to zero. Gracefully no-ops
  // on browsers that don't support the API (iOS Safari < 16.4, desktop).
  //
  // This sum is only correct because `unreadCount` excludes PUSH_ONLY_TYPES.
  // Migration 181 inserts a `dm_received` notification for every DM, so
  // before that filter existed one message incremented BOTH terms and the
  // home-screen badge read 2. If you ever add a type here that another
  // surface also counts, add it to PUSH_ONLY_TYPES or this double-counts
  // again — and the home screen is where it is least visible.
  const totalBadge = count + dmUnread;
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    if (totalBadge > 0) {
      navigator.setAppBadge(totalBadge).catch(() => {});
    } else {
      navigator.clearAppBadge?.().catch(() => {});
    }
  }, [totalBadge]);

  const handleOpen = () => {
    setUnreadAtOpen(count);
    setOpen(true);
    // Optimistically clear the badge — the actual mark-all-read happens inside
    // the panel (on EXIT, see the comment there), but the user expects the
    // badge to drop the moment they open.
    if (count > 0) {
      queryClient.setQueryData(['notificationsUnread', user?.id], 0);
    }
  };

  // `/notifications` was its own page until 2026-08-10; it now redirects to
  // `/dashboard?notifications=1` and this is what turns that param into an
  // open sheet. The param is stripped straight away so a back-navigation or
  // a refresh doesn't re-open a sheet the user has already dismissed.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('notifications')) return;
    // Only the visible bell answers the deep link, or both sheets open
    // stacked and closing one reveals the other (see DESKTOP_QUERY).
    if ((surface === 'sidebar') !== isDesktopViewport()) return;
    params.delete('notifications');
    const rest = params.toString();
    navigate({ pathname: location.pathname, search: rest ? `?${rest}` : '' }, { replace: true });
    setUnreadAtOpen(count);
    setOpen(true);
    if (count > 0) queryClient.setQueryData(['notificationsUnread', user?.id], 0);
    // `count` is read for the optimistic badge clear only — re-running this
    // when it changes would re-open the sheet on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, location.pathname, navigate]);

  if (!user?.id) return null;

  // While the sheet is open the badge stays down. The 30 s poll and the
  // per-row mark-read both refetch the count, and the badge used to climb
  // back behind the scrim with whatever had not been read yet, reading as
  // "opening it did nothing". The real mark-all happens on exit.
  const shown = open ? 0 : count;

  // Build a descriptive label so screen readers announce "12 unread
  // notifications" instead of a context-free "Notifications" button.
  // tFallback handles {count} interpolation in the localized template.
  const baseLabel = tFallback('notifications.title', 'Notifications');
  const countLabel = shown > 0
    ? tFallback(
        shown === 1 ? 'notifications.unreadBadge' : 'notifications.unreadBadgePlural',
        shown === 1 ? '{count} unread notification' : '{count} unread notifications',
        { count: shown }
      )
    : null;
  const ariaLabel = countLabel ? `${baseLabel}, ${countLabel}` : baseLabel;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label={ariaLabel}
        className="group relative h-11 w-11 inline-flex items-center justify-center transition-colors"
      >
        {/* Inner pill highlight so the tightly-spaced header icons don't
            overlap on hover; tap target stays the full h-11 w-11. */}
        <span className="absolute inset-y-1.5 inset-x-2.5 rounded-lg group-hover:bg-secondary transition-colors" />
        <Bell className="relative w-5 h-5 text-foreground" aria-hidden="true" />
        {/*
          aria-live="polite" on the badge so the count change is
          announced WITHOUT interrupting the user's current screen
          reader narration. The badge mounts/unmounts via AnimatePresence
          when count crosses 0 — without aria-live the count change
          would be silent until the user re-focused the button.
        */}
        <span aria-live="polite" aria-atomic="true" className="contents">
          <AnimatePresence>
          {shown > 0 && (
            <motion.span
              key={shown}
              initial={{ scale: 0, opacity: 0 }}
              animate={{
                scale: [0, 1.4, 0.85, 1.15, 0.95, 1],
                opacity: 1,
              }}
              exit={{ scale: 0, opacity: 0, transition: { duration: 0.15 } }}
              transition={{
                duration: 0.5,
                times: [0, 0.3, 0.5, 0.7, 0.85, 1],
                ease: 'easeOut',
              }}
              aria-hidden="true"
              className="absolute top-1 end-1 min-w-[16px] h-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-micro font-bold flex items-center justify-center"
            >
              {shown > 9 ? '9+' : shown}
            </motion.span>
          )}
          </AnimatePresence>
        </span>
      </button>
      <NotificationPanel open={open} unreadAtOpen={unreadAtOpen} onClose={() => setOpen(false)} />
    </>
  );
}
