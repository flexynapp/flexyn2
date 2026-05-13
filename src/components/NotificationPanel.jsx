// src/components/NotificationPanel.jsx
//
// The actual notification list. Slides in from the right on desktop, full
// sheet on mobile. Auto-marks all visible notifications as read on open.
//
// Polish landed alongside the i18n + a11y batch:
//   • Header now hosts both "Mark all read" and "Clear all" actions.
//     They were tucked at the bottom before — discoverability was poor.
//   • Rows are swipe-to-delete on touch (framer-motion drag) AND have an
//     always-visible delete button on focus/hover for keyboard + mouse.
//   • Unread rows now show a left primary accent bar in addition to the
//     subtle background tint and dot indicator.
//   • Query errors surface as a visible retry block instead of an empty
//     list (which previously masked failures as "no notifications yet").
//   • List region is aria-live="polite" so screen readers announce when
//     new rows arrive while the panel is open.

import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bell as BellIcon, CheckCheck, Trash2, AlertCircle, RotateCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as notifications from '@/lib/data/notifications';

// Notification types that a real human triggered. Used for the
// "Friends" tab filter. Mirrors the `social` bucket in migration
// 036's notification_type_category function.
const FRIEND_TYPES = new Set([
  'friend_post', 'friend_follow', 'comment_reply',
  'post_reaction', 'sticker_reaction', 'trade_offer',
]);

export default function NotificationPanel({ open, onClose }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [deletingIds, setDeletingIds] = useState(() => new Set());
  const [tab, setTab] = useState('all'); // 'all' | 'friends'

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['notificationsList', user?.id],
    queryFn: () => notifications.listForUser(user),
    enabled: !!user?.id && open,
    staleTime: 5_000,
  });

  // Lock body scroll while the panel is open so the page behind doesn't
  // scroll when the user is mid-swipe inside the panel on mobile.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

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
     
  }, [open, rows, user?.id, queryClient]);

  // Escape closes the panel — standard dialog convention. The outside-click
  // is already handled by the backdrop's onClick.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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

  const handleDelete = async (id) => {
    if (!id || deletingIds.has(id)) return;
    setDeletingIds(prev => new Set(prev).add(id));
    // Optimistic remove — drop the row from the cache instantly so the
    // exit animation runs even if the network roundtrip is slow.
    queryClient.setQueryData(['notificationsList', user?.id], (prev) =>
      Array.isArray(prev) ? prev.filter(r => r.id !== id) : prev
    );
    const res = await notifications.deleteNotification(id);
    if (!res.ok) {
      // Revert: refetch the canonical list and surface the error.
      queryClient.invalidateQueries({ queryKey: ['notificationsList', user?.id] });
      toast.error(tFallback('notifications.deleteFailed', 'Could not delete — try again.'));
    }
    setDeletingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] });
  };

  const handleClearAll = async () => {
    if (!user?.id || rows.length === 0) return;
    // Same optimistic pattern as single-delete.
    const previous = rows;
    queryClient.setQueryData(['notificationsList', user.id], []);
    const res = await notifications.deleteAllForUser(user);
    if (!res.ok) {
      queryClient.setQueryData(['notificationsList', user.id], previous);
      toast.error(tFallback('notifications.clearAllFailed', 'Could not clear — try again.'));
    } else {
      queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user.id] });
    }
  };

  const handleMarkAllRead = async () => {
    if (!user?.id) return;
    await notifications.markAllRead(user);
    queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user.id] });
    queryClient.invalidateQueries({ queryKey: ['notificationsList', user.id] });
  };

  if (!open) return null;

  // "All" shows everything; "Friends" filters to types where a real
  // human triggered the row. Two tabs is the ceiling — anything more
  // would duplicate the per-category prefs in Settings.
  const filteredRows = tab === 'friends'
    ? rows.filter(r => FRIEND_TYPES.has(r.type))
    : rows;

  const hasUnread = rows.some(r => !r.is_read);
  const hasAny    = rows.length > 0;
  const friendsCount = rows.filter(r => FRIEND_TYPES.has(r.type)).length;

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
          role="dialog"
          aria-modal="true"
          aria-labelledby="notifications-panel-title"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-0 bottom-0 w-full sm:w-96 bg-card border-l border-border shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-2 min-w-0">
              <BellIcon className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
              <h2 id="notifications-panel-title" className="font-heading font-bold truncate">
                {tFallback('notifications.title', 'Notifications')}
              </h2>
            </div>
            <div className="flex items-center gap-1">
              {hasUnread && (
                <button
                  onClick={handleMarkAllRead}
                  aria-label={tFallback('notifications.markAllRead', 'Mark all as read')}
                  title={tFallback('notifications.markAllRead', 'Mark all as read')}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"
                >
                  <CheckCheck className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              {hasAny && (
                <button
                  onClick={handleClearAll}
                  aria-label={tFallback('notifications.clearAll', 'Clear all')}
                  title={tFallback('notifications.clearAll', 'Clear all')}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              <button
                onClick={onClose}
                aria-label={tFallback('common.close', 'Close')}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/*
            Tab filter. Only render when the user has at least one
            friend-typed row — otherwise the "Friends" tab would be a
            permanent empty state. aria-pressed announces the active
            state to screen readers (not role="tab" because we don't
            have a proper roving-focus tabpanel pattern; the filter
            mutates the same list rather than swapping panels).
          */}
          {friendsCount > 0 && (
            <div
              role="group"
              aria-label={tFallback('notifications.filter', 'Filter notifications')}
              className="flex border-b border-border bg-card"
            >
              <button
                onClick={() => setTab('all')}
                aria-pressed={tab === 'all'}
                className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors border-b-2 ${
                  tab === 'all'
                    ? 'text-primary border-primary'
                    : 'text-muted-foreground border-transparent hover:text-foreground'
                }`}
              >
                {tFallback('notifications.tab.all', 'All')}
                <span className="ml-1.5 text-[10px] text-muted-foreground/70">
                  {rows.length}
                </span>
              </button>
              <button
                onClick={() => setTab('friends')}
                aria-pressed={tab === 'friends'}
                className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors border-b-2 ${
                  tab === 'friends'
                    ? 'text-primary border-primary'
                    : 'text-muted-foreground border-transparent hover:text-foreground'
                }`}
              >
                {tFallback('notifications.tab.friends', 'Friends')}
                <span className="ml-1.5 text-[10px] text-muted-foreground/70">
                  {friendsCount}
                </span>
              </button>
            </div>
          )}

          {/* List */}
          <div
            className="flex-1 overflow-y-auto"
            role="region"
            aria-live="polite"
            aria-label={tFallback('notifications.title', 'Notifications')}
            aria-busy={isLoading}
          >
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
                  <AlertCircle className="w-6 h-6 text-destructive" aria-hidden="true" />
                </div>
                <p className="font-heading font-bold text-base mb-1">
                  {tFallback('notifications.error.title', "Couldn't load notifications")}
                </p>
                <p className="text-sm text-muted-foreground mb-3">
                  {tFallback('notifications.error.desc', 'Check your connection and try again.')}
                </p>
                <button
                  onClick={() => refetch()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                  {tFallback('common.retry', 'Retry')}
                </button>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center mb-3">
                  <BellIcon className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
                </div>
                {/* Different empty copy when the Friends tab has nothing
                    yet — "No notifications yet" would be misleading if
                    the All tab has rows but Friends doesn't. */}
                {tab === 'friends' && rows.length > 0 ? (
                  <>
                    <p className="font-heading font-bold text-base mb-1">
                      {tFallback('notifications.empty.friendsTitle', 'No friend activity yet')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {tFallback('notifications.empty.friendsDesc', "Follow friends and you'll see their posts and reactions here.")}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-heading font-bold text-base mb-1">
                      {tFallback('notifications.empty.title', 'No notifications yet')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {tFallback('notifications.empty.desc', "When you complete quests, hit streaks, or your friends post, you'll see it here.")}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <ul>
                <AnimatePresence initial={false}>
                  {filteredRows.map(n => (
                    <NotificationRow
                      key={n.id}
                      n={n}
                      onClick={() => handleRowClick(n)}
                      onDelete={() => handleDelete(n.id)}
                      deleting={deletingIds.has(n.id)}
                      deleteLabel={tFallback('notifications.delete', 'Delete')}
                    />
                  ))}
                </AnimatePresence>
                {rows.length >= 50 && tab === 'all' && (
                  <p className="text-[11px] text-center text-muted-foreground py-3">
                    {tFallback('notifications.showing50', 'Showing the 50 most recent')}
                  </p>
                )}
              </ul>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────
//
// Two interactions:
//   • Tap (whole row outside the trash icon) → navigate to link_url and
//     mark-read.
//   • Swipe-left (touch) OR click the trash icon → delete the row.
//
// We can't nest the trash button inside the row's outer <button> (HTML
// nests no <button> inside <button>). Layout the row as a relative
// container with a clickable inner div + an absolutely-positioned trash
// button. The inner div uses role="button" + onKeyDown for keyboard
// support so screen readers still get button semantics.

function NotificationRow({ n, onClick, onDelete, deleting, deleteLabel }) {
  const time = (() => {
    try { return formatDistanceToNow(new Date(n.created_at), { addSuffix: true }); }
    catch { return ''; }
  })();

  // Swipe-to-delete threshold. If user drags left past -90 px we treat
  // it as a delete gesture. Less than that snaps back. Mirrors the
  // iOS/Android system mail behavior so users have an intuition.
  const SWIPE_THRESHOLD = -90;

  return (
    <motion.li
      layout
      initial={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
      className="relative overflow-hidden border-b border-border/50"
    >
      <motion.div
        drag="x"
        dragConstraints={{ left: -120, right: 0 }}
        dragElastic={0.15}
        onDragEnd={(_, info) => {
          if (info.offset.x < SWIPE_THRESHOLD) onDelete();
        }}
        // Background red panel that shows behind the row while swiping.
        // Pure decoration — clicking it does nothing (the row is what
        // captures clicks). We render it BEHIND via absolute positioning.
        whileDrag={{ cursor: 'grabbing' }}
      >
        {/* Swipe-reveal panel (sits behind the row) */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 flex items-center justify-end pr-6 bg-destructive/90 text-destructive-foreground -z-10"
          style={{ width: '120px' }}
        >
          <Trash2 className="w-5 h-5" />
        </div>

        {/* Row content. The outer wrapper carries the `group` class so
            the trash button can react to hover via `group-hover`. */}
        <div
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
          className={`group relative flex items-start gap-3 p-3 text-left bg-card transition-colors hover:bg-secondary/40 cursor-pointer ${
            !n.is_read ? 'bg-primary/[0.04] border-l-2 border-l-primary pl-[10px]' : ''
          } ${deleting ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <div className="text-2xl shrink-0 mt-0.5" aria-hidden="true">{n.icon || '🔔'}</div>
          <div className="flex-1 min-w-0 pr-8">
            <p className="font-heading font-bold text-sm leading-tight">{n.title}</p>
            {n.body && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
            )}
            <p className="text-[10px] text-muted-foreground/70 mt-1">{time}</p>
          </div>
          {!n.is_read && (
            <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
          )}

          {/* Trash button — always rendered but subtle (40% on touch /
              idle desktop), full opacity on hover or keyboard focus.
              Stops propagation so clicking it doesn't ALSO fire the
              row's navigate handler. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            onKeyDown={(e) => { e.stopPropagation(); }}
            aria-label={deleteLabel}
            disabled={deleting}
            className="absolute bottom-2 right-2 p-1.5 rounded-md text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive focus-visible:opacity-100 group-hover:text-muted-foreground transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </motion.div>
    </motion.li>
  );
}
