// src/components/NotificationBell.jsx
//
// Lives in the global Header. Shows the unread count as a small red badge
// and opens the NotificationPanel on tap. Polls every 30 s in the background.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Bell } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import * as notifications from '@/lib/data/notifications';
import NotificationPanel from './NotificationPanel';

export default function NotificationBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: count = 0 } = useQuery({
    queryKey: ['notificationsUnread', user?.id],
    queryFn: () => notifications.unreadCount(user),
    enabled: !!user?.id,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const handleOpen = () => {
    setOpen(true);
    // Optimistically clear the badge — the actual mark-all-read happens inside
    // the panel, but the user expects the badge to drop the moment they open.
    if (count > 0) {
      queryClient.setQueryData(['notificationsUnread', user?.id], 0);
    }
  };

  if (!user?.id) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Notifications"
        className="relative p-1.5 rounded-md hover:bg-secondary transition-colors"
      >
        <Bell className="w-5 h-5 text-foreground" />
        {count > 0 && (
          <motion.span
            key={count}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center"
          >
            {count > 9 ? '9+' : count}
          </motion.span>
        )}
      </button>
      <NotificationPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
