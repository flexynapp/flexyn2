import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { LOGO_URL } from '@/lib/constants';
import { Apple, LayoutDashboard, MessageCircle, Play, Sparkles, TrendingUp, Users, ShoppingBag } from 'lucide-react';
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

  const navItems = [
    { path: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { path: '/workout',   label: t('nav.workout'),   icon: Play },
    { path: '/hub',       label: t('nav.hub'),       icon: Users, isHub: true },
    { path: '/progress',  label: t('nav.progress'),  icon: TrendingUp },
    { path: '/nutrition', label: t('nav.nutrition'), icon: Apple },
  ];

  return (
    <div className="min-h-[100dvh] bg-background font-body overscroll-y-none">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-64 flex-col bg-card border-r border-border z-30">
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
                  className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center"
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
                <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-card" />
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
      <main className="lg:ml-64 min-h-[100dvh] flex flex-col pt-[56px] pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0 overscroll-y-none">
        <Header />
        <PullToRefresh>
          <AnimatedRoutes>
            <Outlet />
          </AnimatedRoutes>
        </PullToRefresh>
      </main>

      {/* Mobile + Tablet bottom nav */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 bg-card/90 backdrop-blur-md border-t border-border z-30 px-4 pt-2 select-none-ui"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="flex justify-evenly items-end">
          {navItems.map(item => {
            const isActive = location.pathname === item.path;
            const isHubItem = item.isHub;

            return (
              <motion.div
                key={item.path}
                whileTap={{ scale: 0.88 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              >
                <Link
                  to={item.path}
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  className={`flex flex-col items-center text-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                >
                  {/* Icon container — Hub gets a theme-colored ring/circle to draw attention */}
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
                    <item.icon
                      className={`${isHubItem ? 'w-5 h-5' : 'w-5 h-5'} ${isActive ? 'stroke-[2.5]' : ''}`}
                    />
                    {/* Unread dot for the Hub tab — appears when a
                        followed user has posted something new since the
                        viewer last visited Hub. Hidden when they're on
                        the Hub route (the act of being there clears it). */}
                    {isHubItem && hubHasNewFollowingPost && !isActive && (
                      <span
                        className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary border-2 border-card pointer-events-none"
                        aria-label="New posts in Hub"
                      />
                    )}
                  </motion.div>
                  <motion.span animate={isActive ? { fontWeight: 700 } : { fontWeight: 500 }}>
                    {item.label}
                  </motion.span>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </nav>

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