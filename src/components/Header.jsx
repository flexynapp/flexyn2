import { useNavigate, useLocation } from 'react-router-dom';
import { LOGO_URL } from '@/lib/constants';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, MessageCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { db } from '@/api/db';
import { fireLogoTapEgg } from '@/lib/logoTapEgg';
import { Button } from '@/components/ui/button';
import ProfileMenu from './ProfileMenu';
import LevelBar from './LevelBar';
import NotificationBell from './NotificationBell';
import NetworkStatusChip from './NetworkStatusChip';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useUnreadDMCount } from '@/lib/hubMessaging';

// Routes that show a back arrow + page title (instead of the logo).
// The four hoisted-from-Hub destinations all behave as child routes.
const CHILD_ROUTES = ['/workout', '/progress', '/nutrition', '/messages', '/market', '/coach'];

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { t, tFallback } = useLanguage();
  const [titleOverride, setTitleOverride] = useState(null);

  // Listen for cardio-mode title overrides dispatched by CardioSection
  useEffect(() => {
    const handler = (e) => setTitleOverride(e.detail?.title || null);
    window.addEventListener('flexyn-title', handler);
    return () => window.removeEventListener('flexyn-title', handler);
  }, []);

  // Reset override when the route changes
  useEffect(() => {
    setTitleOverride(null);
  }, [location.pathname]);

  const ROUTE_TITLES = {
    '/workout': t('nav.workout'),
    '/progress': t('nav.progress'),
    '/nutrition': t('nav.nutrition'),
    // tFallback (not `t(k) || fallback`) — when a key is missing, t()
    // returns the KEY ITSELF, which is truthy, so `|| 'Marketplace'`
    // never fired. Users saw "hub.market.title" literally in the
    // header on non-English locales. tFallback correctly detects the
    // key-as-result case and returns the English fallback.
    '/messages': tFallback('hub.messages.title', 'Messages'),
    '/market':   tFallback('hub.market.title',   'Marketplace'),
    '/coach':    tFallback('hub.coach.title',    'AI Coach'),
  };

  const unreadDM = useUnreadDMCount();
  const onMessages = location.pathname === '/messages';

  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });



  const isChildRoute = CHILD_ROUTES.includes(location.pathname);
  const title = titleOverride || ROUTE_TITLES[location.pathname] || t('app.name');

  // Hidden easter egg: 7 logo taps within 2.5s → absurd confetti barrage.
  // Each tap still navigates to /dashboard (no-op when already there), so
  // normal use is unaffected; the streak just rides along.
  const logoTapsRef = useRef([]);
  const handleLogoTap = () => {
    const now = Date.now();
    logoTapsRef.current = [...logoTapsRef.current.filter((ts) => now - ts < 2500), now];
    if (logoTapsRef.current.length >= 7) {
      logoTapsRef.current = [];
      fireLogoTapEgg();
    }
    navigate('/dashboard');
  };

  return (
    <header className="lg:hidden fixed top-0 start-0 end-0 z-40 bg-card/80 backdrop-blur-md border-b border-border select-none-ui"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center h-14 px-3">
        {isChildRoute ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            className="shrink-0"
            onClick={() => {
              // Give the current page a chance to intercept back navigation
              // (e.g. an active workout should reset state instead of routing
              // away). If nothing calls preventDefault, fall through to /dashboard.
              const event = new CustomEvent('flexyn-back', { cancelable: true });
              window.dispatchEvent(event);
              if (!event.defaultPrevented) navigate('/dashboard');
            }}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
        ) : (
          <button
            onClick={handleLogoTap}
            aria-label="Go to dashboard"
            className="w-9 h-9 rounded-xl overflow-hidden shrink-0 hover:opacity-80 transition-opacity touch-manipulation"
          >
            <img loading="lazy" src={LOGO_URL} alt="Flexyn" className="w-full h-full object-contain" />
          </button>
        )}
        {/* Title — `min-w-0` is critical: without it, `flex-1` won't
            actually shrink past the content's intrinsic width when
            paired with `truncate`, so a long page title (e.g. a
            translated route name, or a cardio-mode override like
            "Running 4.2 mi") pushes the AI Coach / DM / bell /
            level / profile cluster off the right edge. With min-w-0
            + truncate, the title ellipsizes and the right-side
            icons stay fully visible. */}
        <button
          onClick={handleLogoTap}
          className="font-heading font-bold text-lg tracking-tight flex-1 min-w-0 truncate text-start hover:opacity-80 transition-opacity px-2 touch-manipulation"
        >
          {isChildRoute ? title : t('app.name')}
        </button>
        {/* Network status — only renders when offline OR briefly after
            reconnect, so usually invisible. When something feels broken,
            users learn to glance up here. */}
        <NetworkStatusChip />
        <div className="flex items-center gap-0.5 shrink-0">
          {/* AI Coach button removed from the mobile top nav per
              user feedback — it was crowding the bar and the logo
              was truncating. Still reachable from the Workout page's
              Coach surface. */}
          <button
            type="button"
            onClick={() => navigate('/messages')}
            aria-label={tFallback('hub.messages.title', 'Messages')}
            className={`relative p-2 rounded-lg transition-colors ${
              onMessages
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            <MessageCircle className="w-5 h-5" />
            {unreadDM > 0 && (
              <motion.span
                key={unreadDM}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center"
              >
                {unreadDM > 9 ? '9+' : unreadDM}
              </motion.span>
            )}
          </button>
          <NotificationBell />
          {/* Profile + Level cluster — LevelBar hangs BELOW the
              ProfileMenu (top-full + small overlap up), aligned to
              the right edge. Stays a separate tappable button so
              both the profile and the Lv pill are individually
              clickable + readable. Previous `-bottom-2.5 end-2`
              placement made the badge overlap the "Sean" name. */}
          <div className="relative -ms-2">
            <ProfileMenu />
            <div className="absolute top-full -mt-1 end-1 z-10 origin-top-right scale-75 pointer-events-auto">
              <LevelBar totalXp={userProfile?.total_xp || 0} compact={true} />
            </div>
          </div>
        </div>
      </div>

    </header>
  );
}