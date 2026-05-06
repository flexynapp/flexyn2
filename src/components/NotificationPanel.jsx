// src/components/NotificationPanel.jsx
//
// The actual notification list. Slides in from the right on desktop, bottom
// sheet on mobile. Auto-marks all visible notifications as read on open.

import React, { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bell as BellIcon, CheckCheck } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as notifications from '@/lib/data/notifications';

export default function NotificationPanel({ open, onClose }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['notificationsList', user?.id],
    queryFn: () => notifications.listForUser(user),
    enabled: !!user?.id && open,
    staleTime: 5_000,
  });

  // Mark all read once they've been displayed. Depend on user?.id (a primitive)
  // rather than the user object reference, so an unrelated auth refresh that
  // returns a new object reference doesn't re-fire the markAllRead call.
  useEffect(() => {
    if (!open || !user?.id || rows.length === 0) return;
    const hasUnread = rows.some(r => !r.is_read);
    if (!hasUnread) return;
    notifications.markAllRead(user).then(() => {
      queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user.id] });
      queryClient.invalidateQueries({ queryKey: ['notificationsList', user.id] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows, user?.id, queryClient]);

  const handleRowClick = (n) => {
    if (n.link_url) {
      onClose();
      navigate(n.link_url);
    }
    if (!n.is_read) {
      notifications.markRead(n.id).then(() => {
        queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] });
      });
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-0 bottom-0 w-full sm:w-96 bg-card border-l border-border shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <BellIcon className="w-4 h-4 text-primary" />
              <h2 className="font-heading font-bold">
                {tFallback('notifications.title', 'Notifications')}
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-md hover:bg-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center mb-3">
                  <BellIcon className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="font-heading font-bold text-base mb-1">
                  {tFallback('notifications.empty.title', 'No notifications yet')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tFallback('notifications.empty.desc', "When you complete quests, hit streaks, or your friends post, you'll see it here.")}
                </p>
              </div>
            ) : (
              <div>
                {rows.map(n => (
                  <NotificationRow key={n.id} n={n} onClick={() => handleRowClick(n)} />
                ))}
                {rows.length >= 50 && (
                  <p className="text-[11px] text-center text-muted-foreground py-3">
                    {tFallback('notifications.showing50', 'Showing the 50 most recent')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer — mark all read explicit action (in addition to auto-on-open) */}
          {rows.some(r => !r.is_read) && (
            <button
              onClick={async () => {
                await notifications.markAllRead(user);
                queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] });
                queryClient.invalidateQueries({ queryKey: ['notificationsList', user?.id] });
              }}
              className="flex items-center justify-center gap-1.5 py-3 border-t border-border text-xs font-medium text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              {tFallback('notifications.markAllRead', 'Mark all as read')}
            </button>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function NotificationRow({ n, onClick }) {
  const time = (() => {
    try { return formatDistanceToNow(new Date(n.created_at), { addSuffix: true }); }
    catch { return ''; }
  })();
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 p-3 border-b border-border/50 text-left transition-colors hover:bg-secondary/40 ${
        !n.is_read ? 'bg-primary/[0.04]' : ''
      }`}
    >
      <div className="text-2xl shrink-0 mt-0.5" aria-hidden="true">{n.icon || '🔔'}</div>
      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-sm leading-tight">{n.title}</p>
        {n.body && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
        )}
        <p className="text-[10px] text-muted-foreground/70 mt-1">{time}</p>
      </div>
      {!n.is_read && (
        <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" aria-hidden="true" />
      )}
    </button>
  );
}
