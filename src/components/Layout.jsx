import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { LOGO_URL } from '@/lib/constants';
import { Apple, LayoutDashboard, MessageCircle, Play, Plus, Sparkles, ScanLine, Droplet, TrendingUp, Users, Camera, Scale, ShoppingBag } from 'lucide-react';
import Header from './Header';
import LanguagePicker from './LanguagePicker';
import AnimatedRoutes from './AnimatedRoutes';
import PullToRefresh from './PullToRefresh';
import ProfileMenu from './ProfileMenu';
import NotificationBell from './NotificationBell';
import { motion } from 'framer-motion';
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
import OneShotTooltip from './OneShotTooltip';
import { TOOLTIP } from '@/lib/tooltipRegistry';

// Per-tab subcomponent. Extracts the bottom-nav tile render so each
// tab can attach its own useLongPress instance — hooks can't go
// inside `.map(...)` callbacks. Owns:
//   • Tap behavior (consumed by parent via onTap)
//   • Long-press detection (consumed via onLongPress with the DOM ref
//     so the menu popover can anchor above this exact tab)
//   • Hub-tab special-case styling + the unread dot
function NavTab({ item, isActive, isHubItem, hubHasNewFollowingPost, hasQuickActions, onLongPress, onTap, showLongPressHint }) {
  const ref = useRef(null);
  const longPress = useLongPress(() => onLongPress(ref.current), { ms: 400 });

  return (
    <motion.div
      whileTap={{ scale: 0.88 }}
      transition={{ type: 'spring', stiffness: 500, damping: 22 }}
    >
      {showLongPressHint && hasQuickActions && (
        <OneShotTooltip id={TOOLTIP.LONG_PRESS_TABS} anchorRef={ref} placement="top">
          Hold any tab for shortcuts.
        </OneShotTooltip>
      )}
      <Link
        ref={ref}
        to={item.path}
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
        className={`flex flex-col items-center text-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors
          ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
      >
        <motion.div
          animate={isActive ? { scale: 1.2, y: -2 } : { scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          className={[
            'relative',
            isHubItem
              ? `flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/40'
                    : 'border-2 border-primary text-primary bg-primary/5'
                }`
              : '',
          ].join(' ')}
        >
          <item.icon className={`${isHubItem ? 'w-5 h-5' : 'w-5 h-5'} ${isActive ? 'stroke-[2.5]' : ''}`} />
          {/* Unread dot for the Hub tab — appears when a followed user
              has posted something new since the viewer last visited Hub.
              Hidden when they're on the Hub route (being there clears it). */}
          {isHubItem && hubHasNewFollowingPost && !isActive && (
            <span
              className="absolute -top-0.5 -end-0.5 w-2.5 h-2.5 rounded-full bg-primary border-2 border-card pointer-events-none"
              aria-label="New posts in Hub"
            />
          )}
        </motion.div>
        <motion.span animate={isActive ? { fontWeight: 700 } : { fontWeight: 500 }}>
          {item.label}
        </motion.span>
        {hasQuickActions && (
          // Subtle dots under the label so users know the long-press
          // affordance exists. iOS uses this convention on Dock
          // shortcuts. Invisible to anyone who'd find them noisy.
          <span aria-hidden="true" className="text-[6px] tracking-[0.3em] -mt-0.5 opacity-50">···</span>
        )}
      </Link>
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
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const chestReady = useDailyChestReady(user?.id);

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
  useEffect(() => {
    setNavHidden(false);
    lastScrollY.current = 0;
  }, [location.pathname]);

  const navItems = [
    { path: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { path: '/workout',   label: t('nav.workout'),   icon: Play },
    { path: '/hub',       label: t('nav.hub'),       icon: Users, isHub: true },
    { path: '/progress',  label: t('nav.progress'),  icon: TrendingUp },
    { path: '/nutrition', label: t('nav.nutrition'), icon: Apple },
  ];

  // Long-press quick-action menus per tab. Each entry is a list of
  // 1-3 actions surfaced when the user holds the tab for 400ms.
  // Actions dispatch to existing deep-link routes / page state via
  // custom events the destination page already listens for (e.g.,
  // ?openCardio=1 query param flows). Empty list = no menu (Dashboard
  // is the home; nothing to add via shortcut).
  const TAB_ACTIONS = {
    '/dashboard': [],
    '/workout': [
      { id: 'quicklog', label: 'Quick log', icon: Plus, onClick: () => navigate('/workout') },
      { id: 'cardio',   label: 'Open cardio', icon: Play, onClick: () => navigate('/workout?openCardio=1') },
      { id: 'goals',    label: 'Open goals', icon: Sparkles, onClick: () => navigate('/workout?openGoals=1') },
    ],
    '/hub': [
      { id: 'newpost', label: 'New post',  icon: Plus, onClick: () => navigate('/hub?compose=1') },
      { id: 'search',  label: 'Search users', icon: Users, onClick: () => navigate('/hub?search=open') },
    ],
    '/progress': [
      { id: 'logweight', label: 'Log weight', icon: Scale, onClick: () => navigate('/dashboard?logWeight=1') },
      { id: 'addphoto',  label: 'Add photo',  icon: Camera, onClick: () => navigate('/dashboard?addPhoto=1') },
    ],
    '/nutrition': [
      { id: 'logmeal', label: 'Log meal',     icon: Plus, onClick: () => navigate('/nutrition?openLogMeal=1') },
      { id: 'barcode', label: 'Scan barcode', icon: ScanLine, onClick: () => navigate('/nutrition?openLogMeal=1') },
      { id: 'water',   label: 'Add water',    icon: Droplet, onClick: () => navigate('/nutrition') },
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
    <div className="min-h-[100dvh] bg-background font-body overscroll-y-none">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed start-0 top-0 bottom-0 w-64 flex-col bg-card border-e border-border z-30">
        <div className="p-6 flex flex-col items-center gap-2">
          <Link to="/dashboard" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex flex-col items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-12 h-12 rounded-xl overflow-hidden">
              <img src={LOGO_URL} alt="Flexyn" className="w-full h-full object-contain" />
            </div>
            <span className="font-heading font-bold text-xl text-foreground tracking-tight">Flexyn</span>
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
                  : 'text-muted-foreground hover:bg-secondary'
              }`}
            >
              <Sparkles className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => navigate('/messages')}
              aria-label={tFallback('hub.messages.title', 'Messages')}
              className={`relative p-2 rounded-lg transition-colors ${
                location.pathname === '/messages'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-secondary'
              }`}
            >
              <MessageCircle className="w-5 h-5" />
              {hubUnreadCount > 0 && (
                <motion.span
                  key={hubUnreadCount}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="absolute top-0.5 end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center"
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
              aria-label="Marketplace"
              className={`relative p-2 rounded-lg transition-colors ${
                location.pathname === '/market'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-secondary'
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
            const isActive = location.pathname === item.path;
            const isHubItem = item.isHub;
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
                  to={item.path}
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  className={`flex items-center justify-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors duration-200 select-none-ui
                    ${isActive
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : isHubItem
                        ? 'text-primary border-2 border-primary/40 hover:bg-primary/5 hover:border-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
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

      {/* Main content */}
      <main className="lg:ms-64 min-h-[100dvh] flex flex-col pt-[56px] pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0 overscroll-y-none">
        <Header />
        <PullToRefresh>
          <AnimatedRoutes>
            <Outlet />
          </AnimatedRoutes>
        </PullToRefresh>
      </main>

      {/* Mobile + Tablet bottom nav — slides out of view on scroll-down,
          snaps back on scroll-up. CSS transform is GPU-composited so no
          layout thrash. Transition is deliberately fast (220 ms) to feel
          native, not sluggish. */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 bg-card/90 backdrop-blur-md border-t border-border z-30 px-4 pt-2 select-none-ui transition-transform duration-[220ms] ease-in-out"
        style={{
          paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))',
          transform: navHidden ? 'translateY(100%)' : 'translateY(0)',
          willChange: 'transform',
        }}
      >
        <div className="flex justify-evenly items-start">
          {navItems.map((item, idx) => {
            const isActive = location.pathname === item.path;
            const isHubItem = item.isHub;
            const hasQuickActions = (TAB_ACTIONS[item.path] || []).length > 0;

            return (
              <NavTab
                key={item.path}
                item={item}
                isActive={isActive}
                isHubItem={isHubItem}
                hubHasNewFollowingPost={hubHasNewFollowingPost}
                hasQuickActions={hasQuickActions}
                showLongPressHint={idx === 0}
                onLongPress={(el) => openQuickMenu(item.path, el)}
                onTap={() => {
                  // Three behaviors stacked on one tap:
                  //   1. Navigating to a different tab → just scroll to top.
                  //   2. Tapping the active tab when scrolled down → scroll
                  //      to top (the universal Twitter/IG pattern).
                  //   3. Tapping the active tab when already AT top → broadcast
                  //      a refresh event the active page can opt into. Apps
                  //      with feeds (Hub, Dashboard) treat this as a manual
                  //      refresh; pages without one ignore it.
                  if (isActive && window.scrollY < 50) {
                    try {
                      window.dispatchEvent(new CustomEvent('flexyn:active-tab-retap', {
                        detail: { path: item.path },
                      }));
                    } catch { /* ignore */ }
                  } else {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
              />
            );
          })}
        </div>
      </nav>

      {/* Long-press tab quick-action menu. Mounts globally; the tab
          that fired the gesture sets menuOpen.path + anchorRect. */}
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
      />
      {bag.openingCapsule && (
        <CapsuleOpener
          capsule={bag.openingCapsule}
          onClaim={bag.claimCapsule}
          onClose={bag.closeOpener}
        />
      )}
    </div>
  );
}