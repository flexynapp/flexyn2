import { Link, useLocation, useNavigate } from 'react-router-dom';
import { rememberTabLocation, tabHref, saveTabScroll, restoreTabScroll } from '@/lib/tabMemory';
import { NAV_PATHS, tabForPath } from '@/lib/navTabs';
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import FlexynLogo from './FlexynLogo';
import { LayoutDashboard, MessageCircle, Play, Plus, Sparkles, Users, UserCircle, ShoppingBag } from 'lucide-react';
import QuickLogSheet from './QuickLogSheet';
import Header from './Header';
import LanguagePicker from './LanguagePicker';
import AnimatedRoutes from './AnimatedRoutes';
import PullToRefresh from './PullToRefresh';
import ProfileMenu from './ProfileMenu';
import { useJournalOverlay } from '@/lib/journalOverlay';
// Lazy: the editor is a large chunk and most sessions never open it.
const JournalView = lazy(() => import('./journal/JournalView'));
import NotificationBell from './NotificationBell';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { useUnreadDMCount } from '@/lib/hubMessaging';
import { useHubUnreadDot } from '@/hooks/useHubUnreadDot';
import { useBagFlow } from '@/lib/inventoryFlow';
import UserBag from './hub/UserBag';
import CapsuleOpener from './hub/CapsuleOpener';
import BackToTopButton from './BackToTopButton';
import TabQuickActionMenu from './TabQuickActionMenu';
import { useLongPress } from '@/hooks/useLongPress';
import { triggerHaptic } from '@/lib/haptic';
import { NavVisibilityContext } from '@/lib/NavVisibilityContext';
import OneShotTooltip from './OneShotTooltip';
import { TOOLTIP } from '@/lib/tooltipRegistry';

// Per-tab subcomponent. Extracts the bottom-nav tile render so each
// tab can attach its own useLongPress instance — hooks can't go
// inside `.map(...)` callbacks. Owns:
//   • Tap behavior (consumed by parent via onTap)
//   • Long-press detection (consumed via onLongPress with the DOM ref
//     so the menu popover can anchor above this exact tab)
//   • Social's unread-message badge and new-post dot

function NavTab({ item, to, isActive, badge = 0, showDot = false, hasQuickActions, onLongPress, onTap, showLongPressHint }) {
  const { tFallback } = useLanguage();
  const ref = useRef(null);
  const longPress = useLongPress(() => onLongPress(ref.current), { ms: 400 });

  return (
    <motion.div
      whileTap={{ scale: 0.88 }}
      transition={{ type: 'spring', stiffness: 500, damping: 22 }}
    >
      {showLongPressHint && hasQuickActions && (
        <OneShotTooltip id={TOOLTIP.LONG_PRESS_TABS} anchorRef={ref} placement="top">
          {tFallback('layout.holdTabHint', 'Hold any tab for shortcuts.')}
        </OneShotTooltip>
      )}
      <Link
        ref={ref}
        to={to}
        aria-current={isActive ? 'page' : undefined}
        onClick={(e) => {
          // If a long-press just fired, the consumed click suppresses
          // the navigation (the menu is now open instead).
          if (!longPress.consumeClick(e)) {
            e.preventDefault();
            return;
          }
          onTap();
        }}
        {...longPress.bind}
        className={`flex flex-col items-center text-center gap-0.5 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors
          ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
      >
        <motion.div
          animate={isActive ? { scale: 1.2, y: -2 } : { scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          // Every tab uses an equal-height (h-9) centred icon slot so the
          // labels sit on one baseline beside the taller + button.
          className="relative flex items-center justify-center w-9 h-9"
        >
          <item.icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
          {/* Unread direct messages. Messages moved into Social, so the
              count moved with it: a badge on a header icon for a page the
              header no longer links to would point nowhere. Primary, not
              destructive, for the reason given in Header.jsx: a message
              is not an error. */}
          {badge > 0 ? (
            <span
              className="absolute top-0 -end-1 min-w-[16px] h-4 px-0.5 rounded-full bg-primary text-primary-foreground text-micro font-bold flex items-center justify-center pointer-events-none"
              aria-label={tFallback('layout.unreadMessages', 'Unread messages')}
            >
              {badge > 9 ? '9+' : badge}
            </span>
          ) : showDot && !isActive && (
            // New posts from people you follow. A dot, not a count: counts
            // on a feed read as demanding. Being on Social clears it.
            <span
              className="absolute top-0.5 end-0.5 w-2.5 h-2.5 rounded-full bg-primary border-2 border-card pointer-events-none"
              aria-label={tFallback("layout.newPostsInHub", "New posts in Hub")}
            />
          )}
        </motion.div>
        <motion.span animate={isActive ? { fontWeight: 700 } : { fontWeight: 500 }}>
          {item.label}
        </motion.span>
      </Link>
    </motion.div>
  );
}

// The + in the centre of the tab bar. It is not a tab: it opens the quick
// log sheet over whatever page you are on and never changes the route.
// It takes the filled circle the Hub tab used to wear, because the centre
// slot is where the eye goes and logging is the action the app exists for.
function QuickLogButton({ onOpen }) {
  const { tFallback } = useLanguage();
  const label = tFallback('nav.log', 'Log');
  return (
    <motion.div whileTap={{ scale: 0.88 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}>
      <button
        type="button"
        onClick={() => { triggerHaptic('light'); onOpen(); }}
        aria-label={tFallback('quickLog.title', 'Log something')}
        aria-haspopup="dialog"
        className="flex flex-col items-center text-center gap-0.5 px-2 py-0.5 rounded-lg text-xs font-medium text-muted-foreground"
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-foreground">
          <Plus className="w-5 h-5 stroke-[2.5]" aria-hidden="true" />
        </span>
        <span>{label}</span>
      </button>
    </motion.div>
  );
}

// Helper: check if today's daily chest has NOT been claimed yet (ready to claim)
function useDailyChestReady(userId) {
  if (!userId) return false;
  try {
    const val = localStorage.getItem(`daily_chest_claimed_${userId}`);
    if (!val) return true; // never claimed
    const claimedDate = new Date(val).toDateString();
    return claimedDate !== new Date().toDateString(); // new day → ready
  } catch {
    return false;
  }
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  // Bumped when a nav tab is tapped while already on that section. It's
  // folded into the routed page's key (see AnimatedRoutes) so the page
  // remounts fresh — closing any open sub-view (Cardio, tabs, modals)
  // and returning to the root/top. Tapping a *different* tab already
  // remounts via the pathname change, so this only matters for re-taps.
  const [tabResetNonce, setTabResetNonce] = useState(0);
  const resetActiveTab = () => setTabResetNonce((n) => n + 1);
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const chestReady = useDailyChestReady(user?.id);

  // Ping `last_active_at` once per session so a user who never visits
  // their own profile but uses the app daily doesn't appear "last
  // active 6 months ago" to others. (Audit 10 #98.) Layout is the
  // single always-mounted shell for the authenticated app, so this
  // is the right place — fires on mount + once a day if the session
  // stays alive across midnight. Wrapped in a sessionStorage gate so
  // SPA navigation doesn't spam the DB.
  useEffect(() => {
    if (!user?.email) return;
    const todayKey = `flexyn.lastActivePinged.${user.email}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      const prev = sessionStorage.getItem(todayKey);
      if (prev === today) return;
    } catch { /* sessionStorage unavailable — fall through and ping */ }
    import('@/api/supabaseClient').then(({ supabase }) => {
      supabase
        .from('user_profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('email', user.email)
        .then(() => {
          try { sessionStorage.setItem(todayKey, today); } catch {}
        }, () => {});
    }).catch(() => {});
  }, [user?.email]);

  // Single source of truth for the DM badge — also read by Header.jsx.
  // No longer attached to the Hub nav item; lives on dedicated Messages
  // surfaces (header icon on mobile, sidebar icon on desktop).
  const hubUnreadCount = useUnreadDMCount();

  // Quiet "new content from people you follow" dot on the Hub tab.
  // No counts on purpose — counts feel TikTok-y and demanding. A single
  // dot is the universal "something new here" social-app convention.
  // Clears when the user lands on /hub.
  const hubHasNewFollowingPost = useHubUnreadDot(user?.email);

  // Bag flow lives at the layout level so only one instance exists
  // (ProfileMenu is rendered twice — sidebar + header — so hosting bag
  // state inside it would split open/closed state across copies).
  // ProfileMenu's "My Bag" entry triggers this via OPEN_BAG_EVENT.
  const bag = useBagFlow();

  // My Journal, for the same reason and by the same mechanism: a single
  // mount here rather than one per ProfileMenu copy. Opened by
  // OPEN_JOURNAL_EVENT from the profile menu and the dashboard widget.
  const journal = useJournalOverlay();

  // Closing the editor refreshes the dashboard widget. They read the same
  // row through different paths — the widget via react-query with a 60s
  // staleTime — so writing in the editor and closing it left the card
  // showing the old text for up to a minute, on the same screen.
  const journalQc = useQueryClient();
  const closeJournal = useCallback(() => {
    journal.close();
    journalQc.invalidateQueries({ queryKey: ['journalEntry'] });
  }, [journal, journalQc]);

  // Close it whenever the route changes. My Journal is an overlay while
  // My Gym is a route, so opening one and then the other used to leave
  // BOTH on screen — the journal floating over the gym page, which reads
  // as the app breaking rather than as two surfaces coexisting. Same shape
  // as the nav-visibility reset below and the ErrorBoundary's auto-reset:
  // an overlay that outlives the page it was opened from has to be told
  // when that page goes away. (Moved here with the overlay itself.)
  useEffect(() => {
    journal.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // ── Auto-hide bottom nav on scroll-down, reveal on scroll-up ─────────────
  // Classic Instagram/TikTok pattern: nav slides down out of view as the
  // user reads deeper into a feed, then snaps back on any upward scroll.
  // Threshold of 6 px prevents single-pixel jitter from toggling the state.
  const [navHidden, setNavHidden] = useState(false);
  const lastScrollY = useRef(0);
  const scrollTicking = useRef(false);
  const handleWindowScroll = useCallback(() => {
    if (scrollTicking.current) return;
    scrollTicking.current = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const delta = y - lastScrollY.current;
      if (Math.abs(delta) > 6) {
        // Always show nav when near the top of the page
        setNavHidden(y > 80 && delta > 0);
        lastScrollY.current = y;
      }
      scrollTicking.current = false;
    });
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleWindowScroll);
  }, [handleWindowScroll]);

  // Reset nav visibility on route change (arriving at a new page → show nav)
  //
  // The baseline has to be the page's ACTUAL scroll position, not 0. Only the
  // nav tabs scroll to top on navigation (see the window.scrollTo calls
  // below); every other route change — tapping a card, a deep link, the back
  // button — leaves the window wherever it was. Seeding 0 there meant the
  // next scroll event computed a delta against a position the user was never
  // at: arrive at y=600, scroll UP to y=590, and the handler reads
  // delta = +590, decides that's a downward scroll, and hides the nav. The
  // gesture was inverted on exactly the surfaces deep enough to scroll.
  useEffect(() => {
    setNavHidden(false);
    lastScrollY.current = typeof window === 'undefined' ? 0 : window.scrollY;
  }, [location.pathname]);

  // Remember each tab's current view so the tab bar can reopen it there.
  // See src/lib/tabMemory.js.
  useEffect(() => {
    if (NAV_PATHS.includes(location.pathname)) rememberTabLocation(location.pathname, location.search);
  }, [location.pathname, location.search]);

  const navItems = [
    { path: '/dashboard', label: tFallback('nav.today', 'Today'),   icon: LayoutDashboard },
    { path: '/workout',   label: tFallback('nav.train', 'Train'),   icon: Play },
    { path: '/hub',       label: tFallback('nav.social', 'Social'), icon: Users, isSocial: true },
    { path: '/you',       label: tFallback('nav.you', 'You'),       icon: UserCircle },
  ];
  const activeTab = tabForPath(location.pathname);
  const [quickLogOpen, setQuickLogOpen] = useState(false);

  // Long-press quick-action menus per tab. Each entry is a list of
  // 1-3 actions surfaced when the user holds the tab for 400ms.
  // Actions dispatch to existing deep-link routes / page state via
  // custom events the destination page already listens for (e.g.,
  // ?openCardio=1 query param flows). Empty list = no menu (Dashboard
  // is the home; nothing to add via shortcut).
  const TAB_ACTIONS = {
    '/dashboard': [],
    '/workout': [
      // ?freestyle=1 opens the session itself. Plain /workout landed on the
      // page's picker with a Start button still to press, which is the one
      // step "Quick log" exists to skip.
      { id: 'quicklog', label: 'Quick log', icon: Plus, onClick: () => navigate('/workout?freestyle=1') },
      { id: 'cardio',   label: 'Open cardio', icon: Play, onClick: () => navigate('/workout?openCardio=1') },
      { id: 'goals',    label: 'Open goals', icon: Sparkles, onClick: () => navigate('/workout?openGoals=1') },
    ],
    '/hub': [
      { id: 'newpost', label: 'New post',  icon: Plus, onClick: () => navigate('/hub?compose=1') },
      { id: 'search',  label: 'Search users', icon: Users, onClick: () => navigate('/hub?search=open') },
    ],
  };

  // Open menu state: which tab path is active + the anchor rect to
  // position the popover above.
  const [menuOpen, setMenuOpen] = useState(null); // { path, rect } | null

  const closeQuickMenu = () => setMenuOpen(null);
  const openQuickMenu = (path, target) => {
    const actions = TAB_ACTIONS[path] || [];
    if (actions.length === 0) return;
    triggerHaptic('primary');
    const rect = target?.getBoundingClientRect();
    if (rect) setMenuOpen({ path, rect });
  };

  return (
    <NavVisibilityContext.Provider value={navHidden}>
    <div
      data-app-shell
      className="min-h-[100dvh] bg-background font-body overscroll-y-none"
    >
      {/* Desktop sidebar */}
      {/* `start-0` would pin this to the monitor's edge. On an ultrawide that
          leaves the nav ~600px from the content it belongs to, so the two stop
          reading as one app. --shell-inset is 0 until the viewport passes
          --shell-max, so every narrower screen is byte-for-byte unchanged. */}
      <aside
        style={{ insetInlineStart: 'var(--shell-inset)' }}
        className="hidden lg:flex fixed top-0 bottom-0 w-64 flex-col bg-card border-e border-border z-30"
      >
        <div className="p-6 flex flex-col items-center gap-2">
          <Link to="/dashboard" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label={tFallback("layout.flexynGoToDashboard", "Flexyn. Go to dashboard")} className="flex items-center justify-center hover:opacity-80 transition-opacity">
            <FlexynLogo className="h-14" />
          </Link>
          {/* Row 1: Profile menu (full width) */}
          <div className="w-full mt-1">
            <ProfileMenu />
          </div>
          {/* Row 2: Action buttons centered */}
          <div className="w-full flex items-center justify-center gap-1 mt-0.5">
            <button
              type="button"
              onClick={() => navigate('/coach')}
              aria-label={tFallback('hub.coach.title', 'AI Coach')}
              className={`p-2 rounded-lg transition-colors ${
                location.pathname === '/coach'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
              }`}
            >
              <Sparkles className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => navigate('/messages')}
              aria-label={tFallback('hub.messages.title', 'Direct messages')}
              className={`relative p-2 rounded-lg transition-colors ${
                location.pathname === '/messages'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
              }`}
            >
              <MessageCircle className="w-5 h-5" />
              {hubUnreadCount > 0 && (
                <motion.span
                  key={hubUnreadCount}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="absolute top-0.5 end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-micro font-bold flex items-center justify-center"
                >
                  {hubUnreadCount > 9 ? '9+' : hubUnreadCount}
                </motion.span>
              )}
            </button>
            <NotificationBell />
            {/* Marketplace shortcut + daily chest badge */}
            <button
              type="button"
              onClick={() => navigate('/market')}
              aria-label={tFallback("layout.marketplace", "Marketplace")}
              className={`relative p-2 rounded-lg transition-colors ${
                location.pathname === '/market'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
              }`}
            >
              <ShoppingBag className="w-5 h-5" />
              {chestReady && (
                <span className="absolute top-0.5 end-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-card" />
              )}
            </button>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item, i) => {
            const isActive = activeTab === item.path;
            return (
              <motion.div
                key={item.path}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3, ease: 'easeOut' }}
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.97 }}
              >
                <Link
                  to={isActive ? item.path : tabHref(item.path)}
                  onClick={() => {
                    if (location.pathname === item.path) {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                      resetActiveTab();
                    } else {
                      if (NAV_PATHS.includes(location.pathname)) saveTabScroll(location.pathname, window.scrollY);
                      restoreTabScroll(item.path);
                    }
                  }}
                  className={`flex items-center justify-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors duration-200 select-none-ui
                    ${isActive
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : 'text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground'
                    }`}
                >
                  <motion.div animate={isActive ? { scale: 1.15 } : { scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
                    <item.icon className="w-5 h-5" />
                  </motion.div>
                  {item.label}
                </Link>
              </motion.div>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border">
          <LanguagePicker variant="inline" />
        </div>
      </aside>

      {/* Main content.
          No min-height here: the outer wrapper already paints a full-
          viewport bg-background, so forcing main to 100dvh only created a
          scrollable empty void below short pages (Marketplace, Workout,
          etc.). Letting main size to its content removes that dead space;
          short pages simply end and the fixed bottom nav stays put. */}
      {/* pt has to carry the safe-area inset, not just the 56px bar.
          Header.jsx is `fixed top-0` with `paddingTop: env(safe-area-inset-top)`
          around an h-14 row, so its real height is 56 + inset — 115px on a
          Dynamic Island iPhone, 56px on a desktop where the inset is 0. This
          padded a flat 56px, so on every notched phone the top ~59px of EVERY
          page sat underneath the header.

          It hid for so long because most pages open with a heading or a card
          whose top 59px is empty anyway. The Dashboard's stories rail is
          where it shows: the rail is `items-end`, so a note bubble or a
          "+ Add" pill extends UPWARD from the avatars — straight into the
          band under the header. Scrolling to the top left the pills invisible
          and the avatar circles clipped, and only an overscroll bounce
          revealed them.

          Everything else that positions against the header already had this
          right — ProfileMenu, FollowerActivityBanner, the Hub and Gauntlet
          sub-headers all add the inset. This was the one that didn't. */}
      {/* ps-64, not ms-64: the padding sits INSIDE the capped shell, so the
          content column centres against the space beside the sidebar rather
          than against the whole monitor. */}
      <main className="lg:ps-64 max-w-[var(--shell-max)] mx-auto flex flex-col pt-[calc(56px+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0 overscroll-y-none">
        <Header />
        <PullToRefresh>
          {/* AnimatedRoutes owns the <Outlet /> — it keys the routed page
              for its enter transition and has to control that subtree's
              identity. See the long note in AnimatedRoutes.jsx for why
              the page must never be mounted more than once. */}
          <AnimatedRoutes resetNonce={tabResetNonce} />
        </PullToRefresh>
      </main>

      {/* Mobile + Tablet bottom nav — slides out of view on scroll-down,
          snaps back on scroll-up. CSS transform is GPU-composited so no
          layout thrash. Transition is deliberately fast (220 ms) to feel
          native, not sluggish. */}
      <nav
        // Wave 73: nav bar shrunk to a tighter pill. pt-2 → pt-1 and
        // paddingBottom 0.5rem → 0.25rem (safe-area inset still
        // respected so it clears the iOS home indicator).
        className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-30 px-4 pt-1 select-none-ui transition-transform duration-[220ms] ease-in-out"
        style={{
          paddingBottom: 'calc(0.25rem + env(safe-area-inset-bottom))',
          transform: navHidden ? 'translateY(100%)' : 'translateY(0)',
          willChange: 'transform',
        }}
      >
        <div className="flex justify-evenly items-start">
          {navItems.flatMap((item, idx) => {
            // "Lit" follows the section, so Progress lights You. A tap only
            // counts as a re-tap on the tab's own root: from Progress, You
            // goes back to You rather than scrolling Progress to the top.
            const isActive = activeTab === item.path;
            const onRoot = location.pathname === item.path;
            const hasQuickActions = (TAB_ACTIONS[item.path] || []).length > 0;

            const tab = (
              <NavTab
                key={item.path}
                item={item}
                to={onRoot ? item.path : tabHref(item.path)}
                isActive={isActive}
                badge={item.isSocial ? hubUnreadCount : 0}
                showDot={item.isSocial && hubHasNewFollowingPost}
                hasQuickActions={hasQuickActions}
                showLongPressHint={idx === 0}
                onLongPress={(el) => openQuickMenu(item.path, el)}
                onTap={() => {
                  // Light haptic on every tab tap — matches iOS tab bars.
                  // 'light' is a 10ms pulse that's felt but not obtrusive.
                  triggerHaptic('light');
                  // A different tab reopens where you left it; the tab you
                  // are on goes back to its top.
                  if (onRoot) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  } else {
                    if (NAV_PATHS.includes(location.pathname)) saveTabScroll(location.pathname, window.scrollY);
                    restoreTabScroll(item.path);
                  }
                  // Re-tapping the tab you're already on returns the section
                  // to its root: the <Link to={item.path}> strips any
                  // sub-view query params, and resetActiveTab() remounts the
                  // page so open panels (Cardio, tabs, modals) close and it
                  // lands at the top. (A different tab already mounts fresh.)
                  if (onRoot) {
                    resetActiveTab();
                    // Feeds (e.g. Hub) can also treat a re-tap as a refresh.
                    try {
                      window.dispatchEvent(new CustomEvent('flexyn:active-tab-retap', {
                        detail: { path: item.path },
                      }));
                    } catch { /* ignore */ }
                  }
                }}
              />
            );
            // The + sits between Train and Social.
            return idx === 2
              ? [<QuickLogButton key="quick-log" onOpen={() => setQuickLogOpen(true)} />, tab]
              : [tab];
          })}
        </div>
      </nav>

      {/* Long-press tab quick-action menu. Mounts globally; the tab
          that fired the gesture sets menuOpen.path + anchorRect. */}
      <QuickLogSheet open={quickLogOpen} onClose={() => setQuickLogOpen(false)} />

      <TabQuickActionMenu
        open={!!menuOpen}
        anchorRect={menuOpen?.rect}
        actions={menuOpen ? (TAB_ACTIONS[menuOpen.path] || []) : []}
        onClose={closeQuickMenu}
      />

      {/* Floating back-to-top — visible after scrolling past 2 screen-heights
          on any route. Pairs with the Link onClick scrollTo above (which
          triggers on every tab tap); the floating button is the thumb-reach
          escape hatch when the user is mid-feed and doesn't want to break
          context by tapping a tab. */}
      <BackToTopButton />

      {/* Bag + Capsule Opener — single global mount, opened by ProfileMenu
          or by the OPEN_BAG_EVENT (e.g. StatsHub modal "Bag & Capsules"). */}
      <UserBag
        open={bag.bagOpen}
        onClose={bag.closeBag}
        onOpenCapsule={bag.openCapsule}
        onOpenCapsuleBatch={bag.openCapsuleBatch}
      />
      {/* My Journal — ONE global mount. It lived inside ProfileMenu, which
          renders twice, so the open state was split across two copies and
          two editors could autosave the same row at once. */}
      <AnimatePresence>
        {journal.open && user && (
          <Suspense fallback={null}>
            <JournalView
              userId={user?.id}
              userEmail={user?.email}
              initialDate={journal.initialDate}
              onClose={closeJournal}
            />
          </Suspense>
        )}
      </AnimatePresence>

      {(bag.openingCapsule || bag.openingBatch) && (
        <CapsuleOpener
          capsule={bag.openingCapsule}
          batch={bag.openingBatch}
          onClaim={bag.claimCapsule}
          onClaimBatch={bag.claimCapsuleBatch}
          onClose={bag.closeOpener}
        />
      )}
    </div>
    </NavVisibilityContext.Provider>
  );
}