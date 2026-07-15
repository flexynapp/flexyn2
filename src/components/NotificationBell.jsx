// src/components/NotificationBell.jsx
//
// Lives in the global Header. Shows the unread count as a small red badge
// and opens the NotificationPanel on tap. Polls every 30 s in the background.

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Bell } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as notifications from '@/lib/data/notifications';
import * as hubMessages from '@/lib/data/hubMessages';
import NotificationPanel from './NotificationPanel';

export default function NotificationBell() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

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
    setOpen(true);
    // Optimistically clear the badge — the actual mark-all-read happens inside
    // the panel, but the user expects the badge to drop the moment they open.
    if (count > 0) {
      queryClient.setQueryData(['notificationsUnread', user?.id], 0);
    }
  };

  if (!user?.id) return null;

  // Build a descriptive label so screen readers announce "12 unread
  // notifications" instead of a context-free "Notifications" button.
  // tFallback handles {count} interpolation in the localized template.
  const baseLabel = tFallback('notifications.title', 'Notifications');
  const countLabel = count > 0
    ? tFallback(
        count === 1 ? 'notifications.unreadBadge' : 'notifications.unreadBadgePlural',
        count === 1 ? '{count} unread notification' : '{count} unread notifications',
        { count }
      )
    : null;
  const ariaLabel = countLabel ? `${baseLabel}, ${countLabel}` : baseLabel;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label={ariaLabel}
        className="relative h-11 w-11 inline-flex items-center justify-center rounded-md hover:bg-secondary transition-colors"
      >
        <Bell className="w-5 h-5 text-foreground" aria-hidden="true" />
        {/*
          aria-live="polite" on the badge so the count change is
          announced WITHOUT interrupting the user's current screen
          reader narration. The badge mounts/unmounts via AnimatePresence
          when count crosses 0 — without aria-live the count change
          would be silent until the user re-focused the button.
        */}
        <span aria-live="polite" aria-atomic="true" className="contents">
          {count > 0 && (
            <motion.span
              key={count}
              initial={{ scale: 0, opacity: 0 }}
              animate={{
                scale: [0, 1.4, 0.85, 1.15, 0.95, 1],
                opacity: 1,
              }}
              transition={{
                duration: 0.5,
                times: [0, 0.3, 0.5, 0.7, 0.85, 1],
                ease: 'easeOut',
              }}
              aria-hidden="true"
              className="absolute top-1 end-1 min-w-[16px] h-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center"
            >
              {count > 9 ? '9+' : count}
            </motion.span>
          )}
        </span>
      </button>
      <NotificationPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
