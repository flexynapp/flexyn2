import { useNavigate, useLocation } from 'react-router-dom';
import FlexynLogo from './FlexynLogo';
import { ChevronLeft, Sparkles } from 'lucide-react';
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
import { goBack } from '@/lib/goBack';

// Routes that show a back arrow + page title (instead of the logo).
// The four tabs (dashboard, workout, hub, you) show the logo: they are
// top level, with nowhere to go back to. Progress and Nutrition stopped
// being tabs in the navigation redesign and now open from You, so they
// are children like Messages, Market and Coach.
// My Gym and Profile joined them when they moved under You: they had no
// Back at all, on a phone or on desktop.
export const CHILD_ROUTES = ['/messages', '/market', '/coach', '/progress', '/nutrition', '/my-gym', '/profile'];

// The same Back the phone header shows. Any page can intercept it (an
// active workout persists its draft) by calling preventDefault on
// `flexyn-back`; otherwise it goes back to where the user came from.
export function headerBack(navigate) {
  const event = new CustomEvent('flexyn-back', { cancelable: true });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) goBack(navigate);
}

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
    '/messages': tFallback('hub.messages.title', 'Direct messages'),
    '/market':   tFallback('hub.market.title',   'Marketplace'),
    '/coach':    tFallback('hub.coach.title',    'AI Coach'),
    '/you':      tFallback('you.title',          'You'),
    '/my-gym':   tFallback('profile.myGym',      'My Gym'),
    '/profile':  tFallback('profile.account',    'Profile'),
  };

  const onCoach = location.pathname === '/coach';



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
    // Solid bg-card, no blur (2026-09-24). It was bg-card/95 + backdrop-blur,
    // and before that /80, which let the profile's tier banner tint the whole
    // bar peach while scrolling. A translucent bar over moving content is
    // the glassmorphism CLAUDE.md bans; the hairline border already separates
    // it from the page, so the blur bought nothing but that tell.
    <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-card border-b border-border select-none-ui"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center h-14 px-3">
        {isChildRoute ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={tFallback("achievements.vault.back", "Back")}
            // size="icon" is 36px, under the 44px touch minimum. A ghost
            // button paints nothing at rest, so growing the box changes the
            // tap target and not the look; -ms-1 keeps the chevron where it was.
            className="shrink-0 h-11 w-11 -ms-1"
            onClick={() => headerBack(navigate)}
          >
            <ChevronLeft className="w-5 h-5 rtl:scale-x-[-1]" />
          </Button>
        ) : (
          <button
            onClick={handleLogoTap}
            aria-label={tFallback("header.goToDashboard", "Go to dashboard")}
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
        {/* The right-hand cluster — Coach · Messages · Bell · Profile.
            EVEN OPTICAL GAPS, which is not the same as even margins, and
            getting the two confused is what made this row look wrong.

            The four glyphs are 20 / 20 / 20 / 36px wide inside identical
            44px tap boxes, so matching the boxes' spacing leaves the
            avatar visibly tighter than the icons. What the eye reads is
            the whitespace BETWEEN glyphs, and every pair is now 16px:

              centre-to-centre = (glyphA + glyphB) / 2 + 16
              margin           = centre-to-centre − 44 − 2 (the gap-0.5)

            → Coach→Messages 36 (-me-2.5) · Messages→Bell 36 (-ms-2.5)
              Bell→Profile 44 (-ms-0.5)

            Before this the row ran 42 / 30 / 38 — Coach adrift, the middle
            pair crammed. The 44px pitch that would stop the tap boxes
            overlapping entirely does not fit: the lockup is 141px wide at
            h-11, and four non-overlapping boxes need 184px, which is 6px
            more than a 375pt iPhone SE has left. So the boxes still
            overlap — by 8px now rather than 14 — and the overlap no longer
            crosses any glyph. Coach's glyph ends 12px inside its box and
            Messages' box begins 36px along, so nothing of Coach falls in
            Messages' half; same for the bell. Measured at 375pt, where the
            whole header now runs 345px of the 375 available.

            `z-10` on Messages is still load-bearing for the badge — see
            the note there. */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* AI Coach. This was removed once for crowding the bar and
              truncating the logo, and is back by request — mirroring the
              desktop sidebar's action row, where Coach sits first, ahead of
              Messages.

              The crowding is handled rather than re-inflicted. The icon
              cluster is `shrink-0` and the TITLE holds `flex-1 min-w-0
              truncate`, so the flex line gives way at the title, not at the
              logo — the logo is `shrink-0` too. On the home route the title
              collapses to an empty spacer, which is where this 44px comes
              from. Measured at 375pt after adding it: logo renders at its
              full intrinsic width, cluster fully visible, nothing clipped.

              This carried `-me-1`, which is where the misalignment came
              from. See the spacing note above the cluster: -1 leaves 42px
              between this icon's centre and Messages' where the rest of the
              row sits at 30, so the eye reads Coach as a stray beside a
              group of three rather than as the first of four. It is now
              `-me-2.5`, the same pull every other control in the row gets. */}
          <button
            type="button"
            onClick={() => navigate('/coach')}
            aria-label={tFallback('hub.coach.title', 'AI Coach')}
            className={`group relative h-11 w-11 -me-2.5 inline-flex items-center justify-center transition-colors ${
              onCoach ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <span className={`absolute inset-y-1.5 inset-x-2.5 rounded-lg transition-colors ${onCoach ? 'bg-primary/10' : 'group-hover:bg-secondary'}`} />
            <Sparkles className="relative w-5 h-5" />
          </button>
          {/* Messages moved into Social (navigation redesign, phase 2), so
              the bell now sits next to Coach. Coach's -me-2.5 alone gives
              the 36px centre-to-centre the formula above asks for between
              two 20px glyphs, which is why the bell carries no pull. */}
          <div>
            <NotificationBell />
          </div>
          {/* The profile menu's trigger is hidden: the You tab replaced it
              (navigation redesign, phase 2). It stays mounted because it
              still owns the Weekly Reviews, Injuries, Achievements and
              account dialogs, which You opens through profilePanels.js. */}
          <ProfileMenu compact hideTrigger />
        </div>
      </div>

    </header>
  );
}