// src/components/NotificationBell.jsx
//
// Lives in the global Header. Opens the NotificationPanel on tap and polls
// every 30 s in the background.
//
// The badge (option C, Kegan 2026-09-28): a NUMBER only for notifications
// another person caused, a plain DOT when everything unread is the app
// itself (reminders, achievements). The bell swings once when the unread
// total goes up, and at no other time: not on load, not on a refresh that
// finds the same thing.

import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Bell } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as notifications from '@/lib/data/notifications';
import * as hubMessages from '@/lib/data/hubMessages';
import NotificationPanel from './NotificationPanel';
import CountBadge from '@/components/ui/CountBadge';

const CLEARED = Object.freeze({ total: 0, people: 0 });

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

  const { data: summary = CLEARED, isFetched } = useQuery({
    queryKey: ['notificationsUnread', user?.id],
    queryFn: () => notifications.unreadSummary(user),
    enabled: !!user?.id,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const count = summary.total;

  // DM unread count for combined app-badge total
  const { data: dmUnread = 0 } = useQuery({
    queryKey: ['hubUnreadCount', user?.email],
    queryFn: () => hubMessages.unreadCountFor(user?.id),
    enabled: !!user?.email && !!user?.id,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // App icon badge (PWA Badging API). Same rule as the bell: the number is
  // what people did (notifications from people plus unread DMs); when only
  // the app itself has something, `setAppBadge()` with no argument shows
  // the platform's plain mark instead of a count. Gracefully no-ops on
  // browsers that don't support the API (iOS Safari < 16.4, desktop).
  //
  // This sum is only correct because `unreadCount` excludes PUSH_ONLY_TYPES.
  // Migration 181 inserts a `dm_received` notification for every DM, so
  // before that filter existed one message incremented BOTH terms and the
  // home-screen badge read 2. If you ever add a type here that another
  // surface also counts, add it to PUSH_ONLY_TYPES or this double-counts
  // again — and the home screen is where it is least visible.
  const peopleBadge = summary.people + dmUnread;
  const flagOnly = peopleBadge === 0 && count > 0;
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    if (peopleBadge > 0) {
      navigator.setAppBadge(peopleBadge).catch(() => {});
    } else if (flagOnly) {
      navigator.setAppBadge().catch(() => {});
    } else {
      navigator.clearAppBadge?.().catch(() => {});
    }
  }, [peopleBadge, flagOnly]);

  // Swing on a rise in the unread total. Nothing is tracked until the first
  // fetch lands, or the placeholder 0 → first real count would read as a
  // rise and every app launch would ring the bell. `swing` is a counter
  // used as a key, so each rise replays the motion from rest.
  const reduceMotion = useReducedMotion();
  const prevTotal = useRef(null);
  const [swing, setSwing] = useState(0);
  useEffect(() => {
    if (!isFetched) return;
    const prev = prevTotal.current;
    prevTotal.current = count;
    if (prev !== null && count > prev && !open) setSwing(n => n + 1);
  }, [count, open, isFetched]);

  const handleOpen = () => {
    setUnreadAtOpen(count);
    setOpen(true);
    // Optimistically clear the badge — the actual mark-all-read happens inside
    // the panel (on EXIT, see the comment there), but the user expects the
    // badge to drop the moment they open.
    if (count > 0) {
      queryClient.setQueryData(['notificationsUnread', user?.id], CLEARED);
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
    if (count > 0) queryClient.setQueryData(['notificationsUnread', user?.id], CLEARED);
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
  const shownPeople = open ? 0 : summary.people;

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
        <motion.span
          key={swing}
          data-swing={swing}
          className="relative inline-flex"
          style={{ transformOrigin: '50% 2px' }}
          animate={swing && !reduceMotion ? { rotate: [0, 14, -10, 5, 0] } : { rotate: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <Bell className="w-5 h-5 text-foreground" aria-hidden="true" />
        </motion.span>
        {/*
          aria-live="polite" so a change in the label's count is announced
          without interrupting the screen reader. The badge itself is
          aria-hidden; the button's label carries the full unread total,
          dot or number.
        */}
        <span aria-live="polite" aria-atomic="true" className="contents">
          {/* Sits on the bell's shoulder, not the button's corner: the
              glyph spans 12 to 32px of the 44px button. */}
          <CountBadge
            count={shownPeople}
            dot={shown > 0}
            tone="alert"
            className={shownPeople > 0 ? 'top-1.5 start-[23px]' : 'top-2.5 start-[25px]'}
          />
        </span>
      </button>
      <NotificationPanel open={open} unreadAtOpen={unreadAtOpen} onClose={() => setOpen(false)} />
    </>
  );
}
