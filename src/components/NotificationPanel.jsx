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
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, Bell as BellIcon, CheckCheck, Trash2, AlertCircle, RotateCw, Inbox } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { reportError } from '@/lib/reportError';
import * as notifications from '@/lib/data/notifications';

// Notification types that a real human triggered. Used for the
// "Friends" tab filter. Mirrors the `social` bucket in migration
// 036's notification_type_category function.
const FRIEND_TYPES = new Set([
  'friend_post', 'friend_follow', 'comment_reply',
  'post_reaction', 'sticker_reaction', 'trade_offer',
  // Trigger-generated social notifications (migration 063)
  'post_like', 'crew_everyone',
  // Duel notifications (migration 065)
  'duel_invite', 'duel_result',
  // Competitive notifications (migration 069)
  'bounty_claim', 'bounty_beaten',
  'crew_war_started', 'crew_war_resolved',
  // Newer competitive types (mig 081, 102, 103) — every audit 16 F23
  // type that's "triggered by another human" belongs in the Friends
  // filter. Without these the rival overthrow + crew challenge
  // notifications only show under "All".
  'nemesis_assigned', 'nemesis_overthrown',
  'crew_challenge_started', 'crew_challenge_completed',
]);

export default function NotificationPanel({ open, onClose }) {
  const { user } = useAuth();
  const { tFallback, language } = useLanguage();
  // The panel is pinned to the inline-end edge (end-0). In RTL that edge
  // is on the LEFT, so the slide-in must come from -100% (off the left)
  // rather than the LTR default of +100% (off the right).
  const offEdge = language === 'ar' ? '-100%' : '100%';
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
    }).catch((err) => {
      reportError(err, { feature: 'notifications.markAllRead', level: 'warning', userEmail: user?.email });
    });
     
  }, [open, rows, user?.id, queryClient]);

  // Escape closes the panel — standard dialog convention. The outside-click
  // is already handled by the backdrop's onClick. Stop propagation so a
  // single Escape doesn't ALSO close a Radix Dialog rendered behind this
  // panel (e.g. when the notification bell is opened from inside another
  // dialog). Holding Escape can still queue up multiple fires before the
  // component unmounts; ignore once we've initiated close.
  useEffect(() => {
    if (!open) return;
    let closed = false;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (closed) return;
      closed = true;
      e.stopPropagation();
      onClose();
    };
    // capture phase so we win over the parent Dialog's bubble listener
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const handleRowClick = (n) => {
    // Fire markRead BEFORE navigating so the cache invalidation
    // queues even if the navigation causes this component to unmount.
    // The promise itself still runs to completion either way, but the
    // .then() callback can be skipped by React when the originating
    // component is gone.
    if (!n.is_read) {
      notifications.markRead(n.id)
        .then(() => queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] }))
        .catch(err => reportError(err, {
          feature: 'notifications.markRead',
          level: 'warning',
          userEmail: user?.email,
          notificationId: n.id,
        }));
    }
    if (n.link_url) {
      onClose();
      navigate(n.link_url);
    }
  };

  const handleDelete = async (id) => {
    if (!id || deletingIds.has(id)) return;
    // Pin user.id at the start of the handler. If auth context refreshes
    // mid-request (token refresh, sign-out, account switch), the closing
    // setQueryData / invalidateQueries would otherwise target a different
    // cache key than the optimistic remove above. The deleted-row state
    // would never reconcile against the canonical list on the new key.
    const uid = user?.id;
    setDeletingIds(prev => new Set(prev).add(id));
    // Optimistic remove — drop the row from the cache instantly so the
    // exit animation runs even if the network roundtrip is slow.
    queryClient.setQueryData(['notificationsList', uid], (prev) =>
      Array.isArray(prev) ? prev.filter(r => r.id !== id) : prev
    );
    const res = await notifications.deleteNotification(id);
    if (!res.ok) {
      // Revert: refetch the canonical list and surface the error.
      queryClient.invalidateQueries({ queryKey: ['notificationsList', uid] });
      toast.error(tFallback('notifications.deleteFailed', 'Could not delete — try again.'));
    }
    setDeletingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    queryClient.invalidateQueries({ queryKey: ['notificationsUnread', uid] });
  };

  const handleClearAll = async () => {
    if (!user?.id || rows.length === 0) return;
    // Pin uid + the cache snapshot at handler-entry so a sign-out /
    // account switch mid-request doesn't write the revert back into
    // the NEW user's cache key. Previously `previous = rows` plus the
    // cache writes used a live `user.id` which could shift under us.
    const uid = user.id;
    const previous = queryClient.getQueryData(['notificationsList', uid]) || rows;
    queryClient.setQueryData(['notificationsList', uid], []);
    const res = await notifications.deleteAllForUser(user);
    if (!res.ok) {
      queryClient.setQueryData(['notificationsList', uid], previous);
      toast.error(tFallback('notifications.clearAllFailed', 'Could not clear — try again.'));
    } else {
      queryClient.invalidateQueries({ queryKey: ['notificationsUnread', uid] });
    }
  };

  const handleMarkAllRead = async () => {
    if (!user?.id) return;
    await notifications.markAllRead(user);
    queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user.id] });
    queryClient.invalidateQueries({ queryKey: ['notificationsList', user.id] });
  };

  // "All" shows everything; "Friends" filters to types where a real
  // human triggered the row. Two tabs is the ceiling — anything more
  // would duplicate the per-category prefs in Settings.
  // Rows with an unknown type (a future server-side notification
  // category that hasn't been added to FRIEND_TYPES yet) still appear
  // under "All" so users never miss messages, and the row icon falls
  // back to the 🔔 default — but we tag the unknown type via a Sentry
  // breadcrumb so observability flags the catalog drift before users
  // start asking why their alert has no icon.
  const filteredRows = tab === 'friends'
    ? rows.filter(r => FRIEND_TYPES.has(r.type))
    : rows;
  useEffect(() => {
    if (!open || rows.length === 0) return;
    const ALL_KNOWN_TYPES = new Set([
      ...FRIEND_TYPES,
      // Self-targeted / system categories — kept inline so the audit
      // surface is just THIS file. Adding a new server-side type means
      // also adding it here (or to FRIEND_TYPES if it's social).
      'quest_claimed', 'streak_milestone', 'league_promoted', 'league_demoted',
      'league_held', 'pr_set', 'capsule_earned', 'streak_break_warning',
      'welcome_back', 'quest_expiry_warning', 'gauntlet_completed',
      'streak_rescue_available', 'weekly_gauntlet_started',
    ]);
    const unknown = new Set();
    for (const r of rows) {
      if (r?.type && !ALL_KNOWN_TYPES.has(r.type)) unknown.add(r.type);
    }
    if (unknown.size > 0) {
      import('@/lib/reportError').then(({ reportError }) => {
        reportError(new Error(`Unmapped notification types: ${[...unknown].join(', ')}`), {
          feature: 'notifications.unmappedType',
          level: 'info',
        });
      }).catch(() => {});
    }
  }, [open, rows]);

  const hasUnread = rows.some(r => !r.is_read);
  const hasAny    = rows.length > 0;
  const friendsCount = rows.filter(r => FRIEND_TYPES.has(r.type)).length;

  // Render into a portal so the panel sits outside the Header's stacking
  // context (the Header uses backdrop-blur which creates a new stacking
  // context, trapping any fixed children inside its z-index layer).
  return createPortal(
    <AnimatePresence>
      {open && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9999]"
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="notifications-panel-title"
          initial={{ x: offEdge }}
          animate={{ x: 0 }}
          exit={{ x: offEdge }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          onClick={(e) => e.stopPropagation()}
          className="absolute end-0 top-0 bottom-0 w-full sm:w-96 bg-card border-s border-border shadow-2xl flex flex-col"
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
              {/* "Open full page" — navigates to /notifications for the
                  full history + tab filtering UX. Closes the dropdown
                  on the way so the back gesture from the route returns
                  the user to wherever they were. */}
              <button
                onClick={() => { onClose(); navigate('/notifications'); }}
                aria-label={tFallback('notifications.openFull', 'Open full notifications page')}
                title={tFallback('notifications.openFull', 'Open full notifications page')}
                className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"
              >
                <Inbox className="w-4 h-4" aria-hidden="true" />
              </button>
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

          {/* Tab filter — aria-pressed announces active tab to screen readers. */}
          <div
            role="group"
            aria-label={tFallback('notifications.filter', 'Filter notifications')}
            className="flex border-b border-border bg-card"
          >
            <button
              onClick={() => setTab('all')}
              aria-pressed={tab === 'all'}
              className={`flex-1 px-4 py-3.5 text-sm font-semibold transition-colors border-b-2 ${
                tab === 'all'
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              {tFallback('notifications.tab.all', 'All')}
              <span className="ms-2 text-xs text-muted-foreground/70">
                {rows.length}
              </span>
            </button>
            <button
              onClick={() => setTab('friends')}
              aria-pressed={tab === 'friends'}
              className={`flex-1 px-4 py-3.5 text-sm font-semibold transition-colors border-b-2 ${
                tab === 'friends'
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              {tFallback('notifications.tab.friends', 'Friends')}
              <span className="ms-2 text-xs text-muted-foreground/70">
                {friendsCount}
              </span>
            </button>
          </div>

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
                  <p className="text-micro text-center text-muted-foreground py-3">
                    {tFallback('notifications.showing50', 'Showing the 50 most recent')}
                  </p>
                )}
              </ul>
            )}
          </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>,
    document.body
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
  // it as a delete gesture. Less than that snaps back.
  const SWIPE_THRESHOLD = -90;
  // Restrict the swipe-start to the RIGHT THIRD of the row, per user
  // feedback. Centre swipes were firing delete by accident while just
  // scrolling — and the centre is reserved for a future tab-toggle
  // gesture (All ↔ Friends). Using `dragControls` instead of the default
  // pointerdown listener gives us per-tap control with no state-race.
  const dragControls = useDragControls();
  const startIfRightThird = (e) => {
    const target = e.currentTarget;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const xClient = e.clientX ?? e.touches?.[0]?.clientX;
    if (xClient == null) return;
    if (xClient - rect.left > rect.width * (2 / 3)) {
      dragControls.start(e);
    }
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
      className="relative overflow-hidden border-b border-border/50"
    >
      <motion.div
        drag="x"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ left: -120, right: 0 }}
        dragElastic={0.15}
        onPointerDown={startIfRightThird}
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
          className="absolute inset-y-0 end-0 flex items-center justify-end pe-6 bg-destructive/90 text-destructive-foreground -z-10"
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
          className={`group relative flex items-start gap-3 p-3 text-start bg-card transition-colors hover:bg-secondary/40 cursor-pointer ${
            !n.is_read ? 'bg-primary/[0.04] border-s-2 border-s-primary ps-[10px]' : ''
          } ${deleting ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <div className="text-2xl shrink-0 mt-0.5" aria-hidden="true">{n.icon || '🔔'}</div>
          <div className="flex-1 min-w-0 pe-8">
            <p className="font-heading font-bold text-sm leading-tight">{n.title}</p>
            {n.body && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
            )}
            <p className="text-micro text-muted-foreground/70 mt-1">{time}</p>
          </div>
          {!n.is_read && (
            <span className="absolute top-3 end-3 w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
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
            className="absolute bottom-2 end-2 p-1.5 rounded-md text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive focus-visible:opacity-100 group-hover:text-muted-foreground transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </motion.div>
    </motion.li>
  );
}
