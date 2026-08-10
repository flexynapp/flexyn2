// src/components/NotificationPanel.jsx
//
// THE notifications surface. Singular — there used to be two.
//
// The bell opened a 50-row panel with 2 tabs; `/notifications` rendered a
// 200-row page with 5 tabs and a different type→tab map. Same table, two
// classifications, drifting apart: `coin_gift` was in neither, so six live
// rows reported "Unmapped notification types" to Sentry every time the panel
// opened and landed under "System" on the page. `/notifications` now
// redirects here (see App.jsx), the way `/my-gyms` redirects to `/my-gym`,
// and both classifications collapsed into `@/lib/notificationCatalog`.
//
// Four behaviours here are deliberate and each replaces something that was
// wrong. Read the comment at each before changing it:
//
//   • Read is committed on EXIT, not on open.
//   • The sheet carries its own safe-area insets — it renders through a
//     portal, outside Layout, and Layout is what owns them.
//   • The row swipe derives its direction from the writing direction.
//   • Destructive confirm is in-app, not `window.confirm`.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import {
  X, Bell as BellIcon, CheckCheck, Trash2, AlertCircle, RotateCw,
  MoreHorizontal, Settings as SettingsIcon,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { reportError } from '@/lib/reportError';
import * as notifications from '@/lib/data/notifications';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import {
  FILTERS, hueFor, isKnownType, matchesFilter,
} from '@/lib/notificationCatalog';
import { formatNotificationTime, groupByDay, BUCKET } from '@/lib/notificationTime';

const PAGE_SIZE = 50;

// Tile tint per category hue. Written out rather than interpolated because
// Tailwind's scanner reads source text — a class built from a variable emits
// no CSS and the tile silently loses its fill (same trap as tileRows.js).
const HUE_TILE = {
  info:    'bg-info/[0.14]',
  primary: 'bg-primary/[0.14]',
  success: 'bg-success/[0.14]',
  muted:   'bg-secondary',
};

const BUCKET_LABEL = {
  [BUCKET.TODAY]:     ['notifications.group.today',     'Today'],
  [BUCKET.YESTERDAY]: ['notifications.group.yesterday', 'Yesterday'],
  [BUCKET.EARLIER]:   ['notifications.group.earlier',   'Earlier'],
};

export default function NotificationPanel({ open, onClose }) {
  const { user } = useAuth();
  const { tFallback, language } = useLanguage();
  // The sheet is pinned to the inline-end edge. In RTL that edge is on the
  // LEFT, so it must slide in from -100% rather than the LTR +100%.
  const rtl = language === 'ar';
  const offEdge = rtl ? '-100%' : '100%';
  const closesTowardEnd = !rtl;

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [deletingIds, setDeletingIds] = useState(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const closeBtnRef = useRef(null);
  const restoreFocusRef = useRef(null);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['notificationsList', user?.id, limit],
    queryFn: () => notifications.listForUser(user, limit),
    enabled: !!user?.id && open,
    staleTime: 5_000,
  });

  useBodyScrollLock(open);

  // ── Read is committed on EXIT ─────────────────────────────────────────
  //
  // This used to run on OPEN, and it also invalidated the list — so the
  // accent bar, the tint and the dot were replaced by their read state
  // within one network round trip, while the user was still looking at
  // them. The unread treatment existed and was never seen. Worse, the
  // header's "Mark all read" button is gated on the same `hasUnread`, so
  // that control could not be pressed either: the effect always won.
  //
  // Now nothing is marked while the sheet is open. `hasUnreadRef` snapshots
  // whether there was anything to mark, and the flush happens on the way
  // out — from `handleClose`, and from unmount for the cases that skip it
  // (the tab being closed, a hard navigation).
  const hasUnreadRef = useRef(false);
  useEffect(() => {
    if (open) hasUnreadRef.current = rows.some(r => !r.is_read);
  }, [open, rows]);

  const flushRead = useCallback(() => {
    const uid = user?.id;
    if (!uid || !hasUnreadRef.current) return;
    hasUnreadRef.current = false;
    notifications.markAllRead(user)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['notificationsUnread', uid] });
        queryClient.invalidateQueries({ queryKey: ['notificationsList', uid] });
      })
      .catch(err => reportError(err, {
        feature: 'notifications.markAllRead', level: 'warning', userEmail: user?.email,
      }));
  }, [user, queryClient]);

  // Unmount without a close (tab closed, hard navigation). The promise runs
  // to completion either way; only the .then() is at risk, and losing a
  // cache invalidation on a component that no longer exists costs nothing.
  useEffect(() => () => flushRead(), [flushRead]);

  const handleClose = useCallback(() => {
    flushRead();
    setMenuOpen(false);
    setConfirmClear(false);
    onClose();
  }, [flushRead, onClose]);

  // ── Focus ─────────────────────────────────────────────────────────────
  // `role="dialog" aria-modal="true"` was set with no focus move at all, so
  // a screen-reader user was told a dialog opened and left standing outside
  // it. Move focus in on open, hand it back to the trigger on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement;
    const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      const el = restoreFocusRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [open]);

  // Escape closes. Capture phase so a single press doesn't ALSO close a
  // Radix Dialog rendered behind this sheet; `closed` guards a held key
  // queueing several fires before unmount.
  useEffect(() => {
    if (!open) return;
    let closed = false;
    const onKey = (e) => {
      if (e.key !== 'Escape' || closed) return;
      e.stopPropagation();
      if (confirmClear) { setConfirmClear(false); return; }
      if (menuOpen) { setMenuOpen(false); return; }
      closed = true;
      handleClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, handleClose, menuOpen, confirmClear]);

  // Report catalog drift once per open — a type the server sends that
  // `notificationCatalog` has never heard of. The row still renders and
  // still counts under All; this is an error for us, not for the user.
  useEffect(() => {
    if (!open || rows.length === 0) return;
    const unknown = [...new Set(rows.map(r => r?.type).filter(t => t && !isKnownType(t)))];
    if (unknown.length === 0) return;
    reportError(new Error(`Unmapped notification types: ${unknown.join(', ')}`), {
      feature: 'notifications.unmappedType', level: 'info',
    });
  }, [open, rows]);

  const counts = useMemo(() => {
    const out = { all: rows.length };
    for (const f of FILTERS) {
      if (f.id === 'all') continue;
      out[f.id] = rows.filter(r => matchesFilter(r.type, f.id)).length;
    }
    return out;
  }, [rows]);

  const filteredRows = useMemo(
    () => (filter === 'all' ? rows : rows.filter(r => matchesFilter(r.type, filter))),
    [rows, filter],
  );
  const groups = useMemo(() => groupByDay(filteredRows), [filteredRows]);
  const unreadCount = rows.filter(r => !r.is_read).length;
  const hasAny = rows.length > 0;
  const canLoadMore = rows.length >= limit;

  // Empty copy has three cases, not two. `empty.friendsTitle/Desc` are
  // translated in all 15 languages, so the social filter uses them rather
  // than falling through to the generic pair, which is English-only.
  const emptyCopy = (() => {
    if (filter === 'all' || !hasAny) {
      return {
        title: tFallback('notifications.empty.title', 'No notifications yet'),
        desc:  tFallback('notifications.empty.desc', "When you complete quests, hit streaks, or your friends post, you'll see it here."),
      };
    }
    if (filter === 'social') {
      return {
        title: tFallback('notifications.empty.friendsTitle', 'No friend activity yet'),
        desc:  tFallback('notifications.empty.friendsDesc', "Follow friends and you'll see their posts and reactions here."),
      };
    }
    return {
      title: tFallback('notifications.empty.filteredTitle', 'Nothing in this filter'),
      desc:  tFallback('notifications.empty.filteredDesc', 'Other notifications are waiting under All.'),
    };
  })();

  const handleRowClick = (n) => {
    if (!n.is_read) {
      notifications.markRead(n.id)
        .then(() => queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] }))
        .catch(err => reportError(err, {
          feature: 'notifications.markRead', level: 'warning',
          userEmail: user?.email, notificationId: n.id,
        }));
    }
    if (!n.link_url) return;
    handleClose();
    // An absolute URL is not a route — navigate() would produce /https://.
    if (/^https?:\/\//i.test(n.link_url)) {
      window.open(n.link_url, '_blank', 'noopener,noreferrer');
    } else {
      navigate(n.link_url);
    }
  };

  const handleDelete = async (id) => {
    if (!id || deletingIds.has(id)) return;
    // Pin user.id at handler entry: if auth refreshes mid-request the
    // closing writes would otherwise target a different cache key than the
    // optimistic remove, and the deleted row would never reconcile.
    const uid = user?.id;
    setDeletingIds(prev => new Set(prev).add(id));
    queryClient.setQueryData(['notificationsList', uid, limit], (prev) =>
      Array.isArray(prev) ? prev.filter(r => r.id !== id) : prev);
    const res = await notifications.deleteNotification(id);
    if (!res.ok) {
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
    setConfirmClear(false);
    if (!user?.id || rows.length === 0) return;
    const uid = user.id;
    const previous = queryClient.getQueryData(['notificationsList', uid, limit]) || rows;
    queryClient.setQueryData(['notificationsList', uid, limit], []);
    const res = await notifications.deleteAllForUser(user);
    if (!res.ok) {
      queryClient.setQueryData(['notificationsList', uid, limit], previous);
      toast.error(tFallback('notifications.clearAllFailed', 'Could not clear — try again.'));
    } else {
      hasUnreadRef.current = false;
      queryClient.invalidateQueries({ queryKey: ['notificationsUnread', uid] });
    }
  };

  const handleMarkAllRead = () => {
    setMenuOpen(false);
    hasUnreadRef.current = true;
    flushRead();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          className="fixed inset-0 bg-black/50 z-[9999]"
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
            // Push the sheet back off the edge it came from. Direction is
            // derived from `offEdge` so it stays right in Arabic, where the
            // sheet enters from the left and has to leave to the left.
            // dragDirectionLock keeps a vertical scroll through the list
            // from reading as a dismiss.
            drag="x"
            dragDirectionLock
            dragElastic={{ [closesTowardEnd ? 'left' : 'right']: 0, [closesTowardEnd ? 'right' : 'left']: 0.25 }}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_e, info) => {
              const travelled = closesTowardEnd ? info.offset.x : -info.offset.x;
              const flung = closesTowardEnd ? info.velocity.x : -info.velocity.x;
              if (travelled > 120 || flung > 500) handleClose();
            }}
            // ── Safe area ───────────────────────────────────────────────
            // This renders through a portal, outside Layout — and Layout is
            // what owns the insets. Without this the header sat under the
            // notch on every notched iPhone, which is the whole install
            // base. The list pads its own bottom for the home indicator.
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
            className="absolute end-0 top-0 bottom-0 w-full bg-card border-s border-border flex flex-col touch-pan-y"
          >
            {/* ── Header ── every control is a 44px target; they were 28. */}
            <div className="flex items-center justify-between h-14 ps-4 pe-1 border-b border-border shrink-0">
              <h2 id="notifications-panel-title" className="font-heading font-bold text-title truncate">
                {tFallback('notifications.title', 'Notifications')}
              </h2>
              {/* Only the count is a live region. It used to wrap the whole
                  scroll container, so a 50-row load was announced wholesale. */}
              <span className="sr-only" aria-live="polite" aria-atomic="true">
                {unreadCount > 0
                  ? tFallback(
                      unreadCount === 1 ? 'notifications.unreadBadge' : 'notifications.unreadBadgePlural',
                      unreadCount === 1 ? '{count} unread notification' : '{count} unread notifications',
                      { count: unreadCount },
                    )
                  : ''}
              </span>
              <div className="flex items-center shrink-0">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    aria-label={tFallback('notifications.markAllRead', 'Mark all as read')}
                    title={tFallback('notifications.markAllRead', 'Mark all as read')}
                    className="h-11 w-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary active:text-primary hover:bg-secondary active:bg-secondary transition-colors"
                  >
                    <CheckCheck className="w-5 h-5" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMenuOpen(v => !v)}
                  aria-label={tFallback('notifications.more', 'More options')}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  className={`h-11 w-11 inline-flex items-center justify-center rounded-lg transition-colors ${
                    menuOpen ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
                  }`}
                >
                  <MoreHorizontal className="w-5 h-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  ref={closeBtnRef}
                  onClick={handleClose}
                  aria-label={tFallback('common.close', 'Close')}
                  className="h-11 w-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* ── Filters ── one set, from one catalog. The panel had 2 tabs
                and the page had 5, mapped differently. */}
            <div
              role="group"
              aria-label={tFallback('notifications.filter', 'Filter notifications')}
              className="flex gap-2 px-4 py-2.5 overflow-x-auto scrollbar-hide border-b border-border shrink-0"
            >
              {FILTERS.map(f => {
                const on = filter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    aria-pressed={on}
                    className={`shrink-0 h-8 px-3 rounded-full text-label font-semibold transition-colors ${
                      on ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-secondary/70 active:bg-secondary/70'
                    }`}
                  >
                    {tFallback(f.labelKey, f.label)}
                    <span className={`ms-2 ${on ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                      {counts[f.id] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ── List ── */}
            <div
              className="flex-1 overflow-y-auto"
              aria-busy={isLoading}
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
                </div>
              ) : isError ? (
                <EmptyBlock
                  tone="destructive"
                  Icon={AlertCircle}
                  title={tFallback('notifications.error.title', "Couldn't load notifications")}
                  desc={tFallback('notifications.error.desc', 'Check your connection and try again.')}
                  action={
                    <button
                      type="button"
                      onClick={() => refetch()}
                      className="inline-flex items-center gap-2 h-11 px-4 rounded-lg text-label font-semibold bg-primary text-primary-foreground"
                    >
                      <RotateCw className="w-4 h-4" aria-hidden="true" />
                      {tFallback('common.retry', 'Retry')}
                    </button>
                  }
                />
              ) : filteredRows.length === 0 ? (
                <EmptyBlock
                  Icon={BellIcon}
                  title={emptyCopy.title}
                  desc={emptyCopy.desc}
                  action={
                    <button
                      type="button"
                      onClick={() => { handleClose(); navigate('/settings/notifications'); }}
                      className="h-11 px-4 rounded-lg text-label font-semibold bg-secondary text-foreground"
                    >
                      {tFallback('notifications.chooseAlerts', 'Choose what alerts')}
                    </button>
                  }
                />
              ) : (
                <>
                  {groups.map(g => (
                    <section key={g.bucket} aria-label={tFallback(...BUCKET_LABEL[g.bucket])}>
                      <h3 className="flex items-center justify-between px-4 h-7 text-micro font-bold uppercase tracking-wide text-muted-foreground">
                        {tFallback(...BUCKET_LABEL[g.bucket])}
                        {g.bucket === BUCKET.TODAY && unreadCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-primary text-primary-foreground normal-case tracking-normal">
                            {tFallback('notifications.newCount', '{count} new', { count: unreadCount })}
                          </span>
                        )}
                      </h3>
                      <ul>
                        <AnimatePresence initial={false}>
                          {g.rows.map(n => (
                            <NotificationRow
                              key={n.id}
                              n={n}
                              rtl={rtl}
                              language={language}
                              onClick={() => handleRowClick(n)}
                              onDelete={() => handleDelete(n.id)}
                              deleting={deletingIds.has(n.id)}
                              deleteLabel={tFallback('notifications.delete', 'Delete')}
                            />
                          ))}
                        </AnimatePresence>
                      </ul>
                    </section>
                  ))}
                  {canLoadMore && (
                    <div className="p-4">
                      <button
                        type="button"
                        onClick={() => setLimit(l => l + PAGE_SIZE)}
                        className="w-full h-11 rounded-lg text-label font-semibold bg-secondary text-foreground hover:bg-secondary/70 active:bg-secondary/70 transition-colors"
                      >
                        {tFallback('notifications.loadOlder', 'Load older')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Overflow menu ── */}
            {menuOpen && (
              <>
                {/* Dismiss scrim. Out of the a11y tree on purpose: it
                    duplicates the Close button that is already there, and a
                    second element announcing "Close" is noise, not an
                    affordance. Escape and the menu's own items are the
                    keyboard paths. */}
                <button
                  type="button"
                  aria-hidden="true"
                  tabIndex={-1}
                  onClick={() => setMenuOpen(false)}
                  className="absolute inset-0 bg-black/45 z-10 cursor-default"
                />
                <div
                  role="menu"
                  className="absolute end-3 z-20 w-52 rounded-lg bg-card border border-border shadow-md overflow-hidden"
                  style={{ top: 'calc(env(safe-area-inset-top) + 3.5rem)' }}
                >
                  <MenuItem Icon={CheckCheck} onClick={handleMarkAllRead} disabled={unreadCount === 0}>
                    {tFallback('notifications.markAllRead', 'Mark all as read')}
                  </MenuItem>
                  <MenuItem
                    Icon={SettingsIcon}
                    onClick={() => { setMenuOpen(false); handleClose(); navigate('/settings/notifications'); }}
                  >
                    {tFallback('notifications.settings', 'Notification settings')}
                  </MenuItem>
                  <div className="h-px bg-border" />
                  <MenuItem
                    Icon={Trash2}
                    destructive
                    disabled={!hasAny}
                    onClick={() => { setMenuOpen(false); setConfirmClear(true); }}
                  >
                    {tFallback('notifications.clearAll', 'Clear all')}
                  </MenuItem>
                </div>
              </>
            )}

            {/* ── Clear-all confirm ──
                This was `window.confirm` — a native OS dialog inside an
                installed PWA, and the one place the app handed the user off
                to the browser. It also stated a count for `rows`, not for
                what the filter was hiding. */}
            {confirmClear && (
              <ConfirmClear
                total={rows.length}
                hidden={rows.length - filteredRows.length}
                onCancel={() => setConfirmClear(false)}
                onConfirm={handleClearAll}
                tFallback={tFallback}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function MenuItem({ Icon, children, onClick, destructive, disabled }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`w-full h-11 px-3 flex items-center gap-3 text-label font-medium text-start transition-colors disabled:opacity-40 ${
        destructive
          ? 'text-destructive hover:bg-destructive/10 active:bg-destructive/10'
          : 'text-foreground hover:bg-secondary active:bg-secondary'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      {children}
    </button>
  );
}

function ConfirmClear({ total, hidden, onCancel, onConfirm, tFallback }) {
  return (
    <>
      {/* See the note on the menu scrim — the dialog's own Cancel button
          is the announced way out. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 bg-black/55 z-30 cursor-default"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="notifications-clear-title"
        className="absolute inset-x-0 bottom-0 z-40 rounded-t-2xl bg-card border-t border-border p-4"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-destructive/[0.14] flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5 text-destructive" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p id="notifications-clear-title" className="font-heading font-bold">
              {tFallback('notifications.clearAllConfirmTitle', 'Clear all {count} notifications?', { count: total })}
            </p>
            <p className="text-label text-muted-foreground mt-0.5">
              {hidden > 0
                ? tFallback(
                    'notifications.clearAllConfirmHidden',
                    'This removes every notification, including the {count} hidden by the current filter.',
                    { count: hidden },
                  )
                : tFallback('notifications.clearAllConfirmDesc', "This can't be undone.")}
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-12 rounded-lg text-label font-semibold bg-secondary text-foreground"
          >
            {tFallback('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 h-12 rounded-lg text-label font-semibold bg-destructive text-destructive-foreground"
          >
            {tFallback('notifications.clearAll', 'Clear all')}
          </button>
        </div>
      </div>
    </>
  );
}

function EmptyBlock({ Icon, title, desc, action, tone }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
        tone === 'destructive' ? 'bg-destructive/[0.14]' : 'bg-secondary'
      }`}>
        <Icon className={`w-7 h-7 ${tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground'}`} aria-hidden="true" />
      </div>
      <p className="font-heading font-bold text-title mb-1">{title}</p>
      <p className="text-label text-muted-foreground max-w-[18rem]">{desc}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────
//
// Tap the row → follow `link_url` and mark read. Swipe toward the inline
// start, or use the menu, → delete.
//
// Two things changed here and both were bugs rather than taste:
//
//   • The swipe only STARTED in the physical right third of the row. That
//     is undiscoverable and undocumented, and it was the wrong third in
//     Arabic. It now starts anywhere.
//   • The drag was hardcoded `{left:-120,right:0}` while the reveal panel
//     was positioned at `end-0`. In RTL the reveal sits on the LEFT and the
//     row travelled away from it, so the gesture could never expose the
//     thing it was uncovering. Direction now comes from `rtl`.
//
// The row's own delete button is gone. It was a 26px target pinned
// bottom-end, inside the region a thumb uses to tap the row itself.
function NotificationRow({ n, rtl, language, onClick, onDelete, deleting, deleteLabel }) {
  const time = formatNotificationTime(n.created_at, language);
  const dragControls = useDragControls();

  // Toward the inline start: negative x in LTR, positive in RTL.
  const REVEAL = 120;
  const constraints = rtl ? { left: 0, right: REVEAL } : { left: -REVEAL, right: 0 };
  const threshold = 90;

  return (
    <motion.li
      layout
      initial={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
      className="relative overflow-hidden"
    >
      {/* Reveal, behind the row at the inline end. */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 end-0 w-[120px] flex items-center justify-center bg-destructive text-destructive-foreground"
      >
        <Trash2 className="w-5 h-5" />
      </div>

      <motion.div
        drag="x"
        dragControls={dragControls}
        dragConstraints={constraints}
        dragElastic={0.15}
        onDragEnd={(_, info) => {
          const travelled = rtl ? info.offset.x : -info.offset.x;
          if (travelled > threshold) onDelete();
        }}
        whileDrag={{ cursor: 'grabbing' }}
        className="group relative bg-card"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
          className={`relative flex items-start gap-2 px-4 py-4 text-start transition-colors hover:bg-secondary/40 active:bg-secondary/40 cursor-pointer ${
            deleting ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          {/* Unread: ONE signal. It used to be three — an inline-start bar,
              a background tint AND a dot, for a state that lasted one
              network round trip. */}
          {!n.is_read && (
            <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[3px] bg-primary" />
          )}
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0 ${HUE_TILE[hueFor(n.type)]}`}>
            <span aria-hidden="true">{n.icon || '🔔'}</span>
          </div>
          <div className="flex-1 min-w-0 ms-2">
            <p className={`text-body leading-tight ${n.is_read ? '' : 'font-semibold'}`}>{n.title}</p>
            {n.body && (
              <p className="text-label text-muted-foreground leading-snug mt-1 line-clamp-2">{n.body}</p>
            )}
          </div>
          <time
            dateTime={n.created_at || undefined}
            className="text-micro text-muted-foreground shrink-0 tabular-nums pt-0.5"
          >
            {time}
          </time>
        </div>

        {/* Delete, for everything that cannot swipe. A sibling of the row —
            HTML nests no button inside a button, and the row content above
            carries button semantics. Hidden until hover or keyboard focus
            so it doesn't compete with the timestamp; a full 44px target
            when it is there, against the 26px one it replaces. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label={deleteLabel}
          disabled={deleting}
          className="absolute top-1/2 -translate-y-1/2 end-1 h-11 w-11 inline-flex items-center justify-center rounded-lg bg-card text-muted-foreground opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto hover:text-destructive active:text-destructive"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </motion.div>
      <div className="h-px bg-border/60 ms-[68px]" />
    </motion.li>
  );
}
