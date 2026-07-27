import { useNavigate, useLocation } from 'react-router-dom';
import FlexynLogo from './FlexynLogo';
import { ChevronLeft, MessageCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { fireLogoTapEgg } from '@/lib/logoTapEgg';
import { Button } from '@/components/ui/button';
import ProfileMenu from './ProfileMenu';
// LevelBar was removed from the header in Wave 72 — it was clipping
// at the viewport's right edge on narrow screens. The Lv pill is still
// reachable from the ProfileMenu dropdown and from /profile.
import NotificationBell from './NotificationBell';
import NetworkStatusChip from './NetworkStatusChip';
import { useLanguage } from '@/lib/LanguageContext';
import { useUnreadDMCount } from '@/lib/hubMessaging';

// Routes that show a back arrow + page title (instead of the logo).
// Only the hoisted-from-Hub sub-destinations behave as child routes — the
// five primary bottom-nav tabs (dashboard, workout, hub, progress,
// nutrition) all show the logo, since they're top-level (nowhere to go
// "back" to) and each renders its own in-page title.
const CHILD_ROUTES = ['/messages', '/market', '/coach'];

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
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
    // bg-card/95, not /80: the profile's tier banner is a full-bleed
    // saturated gradient, and at 80% opacity enough of it bled through while
    // scrolling to tint the whole bar peach and drop the wordmark's contrast.
    // Nothing else in the app was colourful enough to expose it. Still
    // translucent + blurred, just no longer a colour cast.
    <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-b border-border select-none-ui"
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
            className="h-11 px-1 -ms-1 flex items-center rounded-xl shrink-0 hover:opacity-80 transition-opacity touch-manipulation"
          >
            <FlexynLogo className="h-11" />
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
          aria-label={isChildRoute ? undefined : 'Go to dashboard'}
          className="font-heading font-bold text-lg tracking-tight flex-1 min-w-0 truncate text-start hover:opacity-80 transition-opacity px-2 touch-manipulation"
        >
          {/* On the home route the lockup already shows the wordmark, so
              this collapses to a spacer; on child routes it holds the page
              title. */}
          {isChildRoute ? title : ''}
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
            className={`group relative h-11 w-11 inline-flex items-center justify-center transition-colors ${
              onMessages ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            {/* Highlight is an inner pill (not the full w-11 tap box) so it
                fits the tight icon spacing without overlapping the bell. */}
            <span className={`absolute inset-y-1.5 inset-x-2.5 rounded-lg transition-colors ${onMessages ? 'bg-primary/10' : 'group-hover:bg-secondary'}`} />
            <MessageCircle className="relative w-5 h-5" />
            {unreadDM > 0 && (
              <motion.span
                key={unreadDM}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="absolute top-1 end-1 min-w-[16px] h-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center"
              >
                {unreadDM > 9 ? '9+' : unreadDM}
              </motion.span>
            )}
          </button>
          {/* Negative inline-start margins pull the bell + profile toward
              the messages icon. The bell gets a larger pull (-ms-4) than the
              profile (-ms-2) because the profile's avatar glyph is 36px vs
              the 20px icons — matching the *center* spacing left the DMs↔bell
              whitespace visibly wider than bell↔profile. This equalises the
              actual gap the eye reads. Tap areas stay full size. */}
          <div className="-ms-4">
            <NotificationBell />
          </div>
          {/* Profile menu — the LevelBar pill that used to hang below
              this was removed in Wave 72. Even after the Wave 71 nudge
              (end-1 → end-2, -mt-1 → -mt-2) it still clipped at the
              viewport's right edge on narrow screens. Per user
              request, the Lv is now only visible from:
                • the ProfileMenu dropdown
                • the /profile page (LevelBar shown full size)
                • the Hub profile sub-view (existing card) */}
          <div className="relative -ms-2">
            <ProfileMenu compact />
          </div>
        </div>
      </div>

    </header>
  );
}