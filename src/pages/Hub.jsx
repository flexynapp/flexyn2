// src/pages/Hub.jsx
// Hub is now strictly the social feed: Pump + Squad + Crews, plus the Profile
// sub-view (own or someone else's). Marketplace, DMs, AI Coach, and the
// Bag/Capsule flow were hoisted out to /market, /messages, /coach, and
// the global ProfileMenu respectively.
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useUrlState } from '@/hooks/useUrlState';
import { routerStateWithoutPayload } from '@/lib/goBack';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { Flame, Users as UsersIcon, User as UserIcon, Plus, ArrowLeft, Search, Shield, Store, Activity, Trophy, MessageCircle } from 'lucide-react';
import { useUnreadDMCount } from '@/lib/hubMessaging';
import CompetePanel from '@/components/hub/CompetePanel';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import HubFeed from '@/components/hub/HubFeed';
import HubProfile from '@/components/hub/HubProfile';
import HubComposer from '@/components/hub/HubComposer';
import HubSearchOverlay from '@/components/hub/HubSearchOverlay';
import FollowerActivityBanner from '@/components/hub/FollowerActivityBanner';
import LiveActivityRail from '@/components/hub/LiveActivityRail';
import FollowSuggestionRail from '@/components/hub/FollowSuggestionRail';
import StoriesRow from '@/components/stories/StoriesRow';
import CrewsSection from '@/components/crews/CrewsSection';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useStartConversation } from '@/lib/hubMessaging';
import { markHubVisited } from '@/hooks/useHubUnreadDot';

// ─── Ember particle data for the marketplace button ───────────────────────────
const EMBERS = [
  { x: 15, size: 3, duration: 1.8, delay: 0,   travel: 30 },
  { x: 30, size: 2, duration: 2.2, delay: 0.4, travel: 25 },
  { x: 50, size: 4, duration: 1.6, delay: 0.8, travel: 35 },
  { x: 65, size: 2, duration: 2.0, delay: 0.2, travel: 28 },
  { x: 80, size: 3, duration: 1.9, delay: 1.0, travel: 32 },
  { x: 22, size: 2, duration: 2.4, delay: 1.4, travel: 22 },
  { x: 55, size: 3, duration: 1.7, delay: 0.6, travel: 38 },
  { x: 70, size: 2, duration: 2.1, delay: 1.8, travel: 26 },
];

// Visual left-to-right order of the feed tab strip, which is what both the
// tab bar and the swipe gesture follow. 'activity' is deliberately absent: it
// is reached from the header, not the strip, so including it would let a swipe
// land somewhere the strip gives no way back from. Module scope so the swipe
// callbacks don't close over a fresh array on every render.
export const SWIPE_TABS = ['pump', 'squad', 'crews', 'compete'];

/**
 * Which tab a drag should land on, or null for "not a swipe".
 *
 * Exported and pure so the direction rules can be tested without mounting
 * Hub — see src/pages/__tests__/hubTabSwipe.test.js for why each rule exists.
 *
 * @param {string} current  the active feed tab
 * @param {{offset:{x:number,y:number}, velocity:{x:number}}} info  framer-motion drag info
 * @param {boolean} rtl     document direction is right-to-left
 */
export function resolveSwipeTarget(current, info, rtl) {
  const { offset, velocity } = info;
  // Distance OR speed: a slow deliberate drag and a quick flick are both
  // swipes, and requiring distance alone makes flicking feel broken.
  if (Math.abs(offset.x) < 60 && Math.abs(velocity.x) < 320) return null;
  // The feed scrolls vertically; stealing a mostly-vertical drag would make
  // the page feel like it was fighting the thumb.
  if (Math.abs(offset.y) > Math.abs(offset.x)) return null;
  const i = SWIPE_TABS.indexOf(current);
  if (i === -1) return null;
  // Content follows the thumb: dragging left brings the tab on the right into
  // view. In RTL the strip is mirrored, so the mapping mirrors with it.
  const forward = rtl ? offset.x > 0 : offset.x < 0;
  const next = forward ? i + 1 : i - 1;
  if (next < 0 || next >= SWIPE_TABS.length) return null;
  return SWIPE_TABS[next];
}

// Parse the ?profile= URL param into an id-or-email target. A UUID token is
// treated as a user id; anything else stays an email — backward-compatible with
// the legacy /hub?profile=<email> links. This lets the profile route move to
// ids (so email can eventually leave the public_profiles view) without breaking
// any existing email link. HubProfile accepts either shape.
const PROFILE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function paramToProfileTarget(raw) {
  if (!raw) return null;
  let v;
  try { v = decodeURIComponent(raw); } catch { v = raw; }
  return PROFILE_UUID_RE.test(v) ? { id: v } : { email: v };
}

export default function Hub() {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Resolve any deep-link target up front (lazy state init) so a
  // `?profile=<email>` link OR the /profile route lands directly on the
  // profile view. Previously a mount effect reset section→'feed' AFTER
  // the deep-link effect set it to 'profile', so the first tap landed on
  // the feed and you had to navigate again — the "double-click to open
  // profile" bug. Reading the URL here removes that race entirely.
  const initialProfileEmail = new URLSearchParams(location.search).get('profile');
  const initialHighlightPost = new URLSearchParams(location.search).get('post');
  const isProfilePath = location.pathname === '/profile';

  const [section, setSection] = useState(
    (initialProfileEmail || isProfilePath) ? 'profile' : 'feed'
  );
  // In the URL (?feed=) so a refresh, or coming back to Hub from the tab bar,
  // keeps the feed you were on. See useUrlState.
  const [feedTab, setFeedTab] = useUrlState('feed', 'pump', ['pump', 'squad', 'crews', 'compete', 'activity']);
  const unreadDM = useUnreadDMCount();

  // ── Swipe + directional transition between the feed tabs ─────────────────
  const [tabDirection, setTabDirection] = useState(0);
  const swipeEnabled = section === 'feed' && SWIPE_TABS.includes(feedTab);

  // The swipe is started by hand rather than by framer's own listener, and
  // that is load-bearing rather than a style choice.
  //
  // With `drag="x"`, framer writes `touch-action: pan-y` onto the element
  // (render/html/use-props.mjs — it is set AFTER the caller's `style` prop is
  // merged, so it cannot be overridden from here). touch-action is resolved by
  // intersecting the value down the whole ancestor chain, so `pan-y` on this
  // panel disallowed horizontal panning for everything inside it — and the
  // Hub feed is full of horizontally-scrolling rails: People You May Know,
  // Live Activity, Follow Suggestions, Recently Viewed, Story Highlights and
  // the badge showcase. None of them could be scrolled by touch. On a
  // mobile-only app that is the entire interaction those rails have.
  //
  // `dragListener={false}` skips that whole block (framer guards it on
  // `props.dragListener !== false`), and framer never calls preventDefault
  // anywhere in its gesture code — touch-action is its ONLY mechanism for
  // suppressing native scroll. So starting the drag ourselves gives the
  // browser its scrolling back and keeps the swipe: pan a rail and the
  // browser scrolls it, which cancels the pointer stream and aborts the
  // drag; pan anywhere with nothing to scroll and the drag runs as before.
  const dragControls = useDragControls();

  const goToTab = useCallback((next) => {
    setFeedTab((prev) => {
      if (next === prev) return prev;
      const from = SWIPE_TABS.indexOf(prev);
      const to = SWIPE_TABS.indexOf(next);
      // Both on the strip → animate the way the eye expects. Anything else
      // (arriving from the header, a deep link) gets a plain fade, because
      // there is no left or right to honour.
      setTabDirection(from === -1 || to === -1 ? 0 : (to > from ? 1 : -1));
      return next;
    });
  }, []);

  const handleFeedSwipe = useCallback((_e, info) => {
    if (!swipeEnabled) return;
    const rtl = typeof document !== 'undefined' && document.dir === 'rtl';
    const next = resolveSwipeTarget(feedTab, info, rtl);
    if (!next) return;
    try { navigator.vibrate?.(8); } catch { /* ignore */ }
    goToTab(next);
  }, [feedTab, swipeEnabled, goToTab]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(
    paramToProfileTarget(initialProfileEmail)
  );
  const [pendingCrewId, setPendingCrewId] = useState(null);
  // A shared post link carries ?post=<id> beside ?profile=<author>. Held
  // here and handed to HubProfile, which opens the Posts tab, scrolls to the
  // row and outlines it. Cleared once consumed so a back-nav or a later
  // profile visit doesn't re-highlight a post nobody asked about.
  const [highlightPostId, setHighlightPostId] = useState(initialHighlightPost || null);

  const startConversation = useStartConversation();

  // Mark this visit so the bottom-nav Hub-tab dot clears. The custom
  // event lets useHubUnreadDot re-read localStorage in real time
  // without needing a query invalidation round-trip.
  useEffect(() => {
    if (!user?.email) return;
    markHubVisited(user.email);
    try { window.dispatchEvent(new CustomEvent('flexyn:hub-visited')); } catch { /* ignore */ }
  }, [user?.email]);

  // Deep-links Hub still owns:
  //   ?compose=1       — open the post composer (used by daily-quest links)
  //   ?search=open     — open the user-search overlay (empty-state CTAs)
  //   ?profile=<email> — open a profile (used by Dashboard stories tray
  //                      when tapping a no-story friend avatar)
  //
  // `?profile=` is handled at two layers: the synchronous useState
  // initializer above (which makes the FIRST render land on the right
  // section / target so we avoid a one-frame feed → profile flash),
  // and the effect below (which strips the param so a back-nav doesn't
  // re-fire). Track the initial-load value so the effect knows it has
  // already been consumed at mount and only re-applies on a SECOND
  // ?profile= deep-link that lands while Hub is already open.
  // ?bag=open is no longer handled here; callers use OPEN_BAG_EVENT
  // (see StatsHubModal "Bag & Capsules" tile).
  // Seeded from whether a ?profile= was present AT MOUNT, not `false`.
  //
  // The ref means "the initial deep link has been accounted for". When Hub
  // mounts on a bare /hub there is no initial deep link, so it is already
  // accounted for and the next ?profile= to arrive is a genuine navigation
  // that must be applied. Starting at `false` made the effect treat that
  // first arrival as the mount-time one the useState initializer had
  // supposedly handled — but the initializer ran before the param existed, so
  // nobody applied it. The param was stripped, the URL flickered and snapped
  // back, and the profile never opened. Only the SECOND tap worked.
  //
  // Reached from LiveActivityRail, HubFeed's author links and
  // HubCommentsInline; the route element is keyed on pathname alone
  // (AnimatedRoutes), so Hub never remounts to reset this.
  const consumedInitialProfileRef = useRef(!initialProfileEmail);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    let changed = false;
    if (params.get('compose') === '1') {
      setComposerOpen(true);
      params.delete('compose');
      changed = true;
    }
    if (params.get('search') === 'open') {
      setSearchOpen(true);
      params.delete('search');
      changed = true;
    }
    // ?tab=<feedTab> — the deep link the crew daily quest routes to. It only
    // accepts the three real sub-tabs: an unknown value used to be
    // impossible here, and letting one through would blank the feed by
    // selecting a tab that renders nothing.
    const tab = params.get('tab');
    if (tab && ['pump', 'squad', 'crews'].includes(tab)) {
      setSection('feed');
      setFeedTab(tab);
      params.delete('tab');
      changed = true;
    }
    const profileEmail = params.get('profile');
    if (profileEmail) {
      // The first effect pass after mount lines up with the
      // synchronous useState init — don't double-apply. The param
      // still needs to be stripped from the URL, so we set
      // `changed` and let the navigate() below clean it.
      if (!consumedInitialProfileRef.current) {
        consumedInitialProfileRef.current = true;
      } else {
        setProfileTarget(paramToProfileTarget(profileEmail));
        setSection('profile');
      }
      params.delete('profile');
      changed = true;
    }
    const postParam = params.get('post');
    if (postParam) {
      setHighlightPostId(postParam);
      params.delete('post');
      changed = true;
    }
    if (changed) {
      navigate({ pathname: '/hub', search: params.toString() ? '?' + params.toString() : '' }, { replace: true });
    }
  }, [location.search, navigate]);

  // flexyn:open-crew — fired by CrewDMInviteCard when user accepts a DM invite
  useEffect(() => {
    const handler = (e) => {
      const { crewId } = e.detail || {};
      if (!crewId) return;
      setPendingCrewId(crewId);
      setFeedTab('crews');
      setSection('feed');
    };
    window.addEventListener('flexyn:open-crew', handler);
    return () => window.removeEventListener('flexyn:open-crew', handler);
  }, []);

  // Router-state twin of the event above, for callers on ANOTHER page.
  // The event only works for a dispatcher that is already inside Hub
  // (HubProfile) or that fires while Hub is mounted — Workout's Crew Wars
  // menu is neither, so an event dispatched next to its navigate() would
  // land before this listener exists and be lost. That is the same class of
  // failure as the `openCrewWars` state this replaced, which Hub never read
  // at all. Router state survives the transition, so it is what a
  // cross-page hand-off uses.
  useEffect(() => {
    const crewId = location.state?.openCrewId;
    if (!crewId) return;
    setPendingCrewId(crewId);
    setFeedTab('crews');
    setSection('feed');
    // Clear it, or a back-navigation into Hub re-opens the crew page the
    // user just backed out of.
    window.history.replaceState(routerStateWithoutPayload(), document.title);
  }, [location.state]);

  // The sub-header below is `fixed`, so it's out of flow and the page
  // content has to reserve its height by hand. That used to be a hardcoded
  // `pt-[120px]`, which was ~7px short of the header's real 127px on the
  // feed section — enough to slice the top off the first row of content
  // ("BUILD YOUR FEED" was bisected by the header's bottom border). And the
  // header isn't even a fixed height: the sub-tabs only render on the feed
  // section, and the title row swaps a 2xl heading for a small back button
  // on profile, so no single constant can be right everywhere.
  //
  // Measure it instead. The header is `fixed`, so its bottom is already in
  // viewport coordinates and constant; the wrapper's rect is viewport-
  // relative too, so we add scrollY to pin it to the document and keep the
  // result scroll-invariant. The wrapper's own top edge doesn't move when
  // its padding-top changes, so this settles in one pass.
  const contentRef   = useRef(null);
  const subHeaderRef = useRef(null);
  const [contentPadTop, setContentPadTop] = useState(120);
  useLayoutEffect(() => {
    const measure = () => {
      const header = subHeaderRef.current;
      const content = contentRef.current;
      if (!header || !content) return;
      const GAP = 12; // breathing room so text never kisses the border
      const contentTopInDoc = content.getBoundingClientRect().top + window.scrollY;
      const next = Math.round(
        header.getBoundingClientRect().bottom - contentTopInDoc + GAP
      );
      // Guard against a transient 0-height measurement during mount.
      if (next > 0) setContentPadTop((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (subHeaderRef.current) ro.observe(subHeaderRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [section, feedTab]);

  return (
    <ErrorBoundary label="Hub">
    <div
      ref={contentRef}
      style={{ paddingTop: contentPadTop }}
      className="px-4 md:px-6 lg:pb-6 max-w-3xl mx-auto"
    >
      {/* Fixed Hub sub-header */}
      {/* `lg:start-64` pinned this 256px from the MONITOR's edge, not from the
          shell's — so past --shell-max the bar started ~270px left of the
          sidebar and ran to the far right bezel, a full-width band under a
          centred app. Both edges now track the shell. Unchanged below the cap,
          where the vars are 0 and --shell-content-start IS 16rem. */}
      <div ref={subHeaderRef} className="fixed start-0 end-0 z-20 bg-background/95 backdrop-blur-md border-b border-border top-[calc(56px+env(safe-area-inset-top))] lg:top-[env(safe-area-inset-top)] lg:start-[var(--shell-content-start)] lg:end-[var(--shell-inset)]">
        <div className="max-w-3xl mx-auto px-4 md:px-6 pt-3 pb-3">

          {/* Title row */}
          <div className="mb-3 flex items-center justify-between gap-2 lg:grid lg:grid-cols-[1fr_auto_1fr]">
            <div className="lg:col-start-2 lg:justify-self-center">
              {section === 'feed' ? (
                <button
                  type="button"
                  onClick={() => { setSection('feed'); setProfileTarget(null); }}
                  className="font-heading text-2xl md:text-3xl font-bold tracking-tight hover:opacity-70 transition-opacity"
                >
                  {t('hub.title')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setSection('feed'); setProfileTarget(null); }}
                  className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {t('hub.backToHub')}
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 lg:col-start-3 lg:justify-self-end">

              {/* Messages. They moved here from the app header in the
                  navigation redesign: talking to people is social, and the
                  unread count now also rides on the Social tab. */}
              <button
                type="button"
                onClick={() => navigate('/messages')}
                aria-label={tFallback('hub.messages.title', 'Direct messages')}
                className="relative h-11 w-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors"
              >
                <MessageCircle className="w-5 h-5" />
                {unreadDM > 0 && (
                  <span className="absolute top-1 end-1 min-w-[16px] h-4 px-0.5 rounded-full bg-primary text-primary-foreground text-micro font-bold flex items-center justify-center pointer-events-none">
                    {unreadDM > 9 ? '9+' : unreadDM}
                  </span>
                )}
              </button>

              {/* Search */}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label={tFallback('hub.search.label', 'Search')}
                className="h-11 w-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors"
              >
                <Search className="w-5 h-5" />
              </button>

              {/* Activity — lives in the corner (not a sub-tab) so the feed
                  row stays a clean Pump | Squad | Crews. */}
              <button
                type="button"
                onClick={() => { setSection('feed'); setProfileTarget(null); setFeedTab('activity'); }}
                aria-label={tFallback('hub.feed.activity', 'Activity')}
                className={`h-11 w-11 inline-flex items-center justify-center rounded-lg transition-colors ${
                  section === 'feed' && feedTab === 'activity'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
                }`}
              >
                <Activity className="w-5 h-5" />
              </button>

              {/* Profile (self/other) */}
              <button
                type="button"
                onClick={() => {
                  if (section === 'profile' && (!profileTarget || profileTarget?.id === user?.id || profileTarget?.email === user?.email)) {
                    setSection('feed');
                  } else {
                    setProfileTarget(null);
                    setSection('profile');
                  }
                }}
                aria-label={t('hub.myProfile')}
                className={`h-11 w-11 inline-flex items-center justify-center rounded-lg transition-colors ${
                  section === 'profile' && (!profileTarget || profileTarget?.id === user?.id || profileTarget?.email === user?.email)
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
                }`}
              >
                <UserIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Feed sub-tabs — Pump | Squad | Crews | Compete */}
          {section === 'feed' && (
            <div className="flex gap-1 p-1 bg-secondary rounded-lg border border-border">
              <button
                type="button"
                onClick={() => goToTab('pump')}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-md transition-colors ${
                  feedTab === 'pump'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-secondary-foreground/70 hover:text-secondary-foreground active:text-secondary-foreground'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                {t('hub.feed.pump')}
              </button>
              <button
                type="button"
                onClick={() => goToTab('squad')}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-md transition-colors ${
                  feedTab === 'squad'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-secondary-foreground/70 hover:text-secondary-foreground active:text-secondary-foreground'
                }`}
              >
                <UsersIcon className="w-3.5 h-3.5" />
                {t('hub.feed.squad')}
              </button>
              <button
                type="button"
                onClick={() => goToTab('crews')}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-md transition-colors ${
                  feedTab === 'crews'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-secondary-foreground/70 hover:text-secondary-foreground active:text-secondary-foreground'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                {tFallback('hub.feed.crews', 'Crews')}
              </button>
              <button
                type="button"
                onClick={() => goToTab('compete')}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-md transition-colors ${
                  feedTab === 'compete'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-secondary-foreground/70 hover:text-secondary-foreground active:text-secondary-foreground'
                }`}
              >
                <Trophy className="w-3.5 h-3.5" />
                {tFallback('hub.feed.compete', 'Compete')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Live activity banner — ephemeral "X just posted" tickers
          for new posts from followed users. Self-mounted via fixed
          positioning so it overlays the feed without affecting scroll.
          Only renders on the feed surface (not profile / search). */}
      {section === 'feed' && <FollowerActivityBanner />}

      {/* Live-now rail (migration 088). Horizontal scroll of friends
          who are actively working out RIGHT NOW. Self-hides when
          nobody's training. Drives FOMO + copy-cat workouts — a strong
          social mechanic that compounds with the crew wars / nemesis
          stack. */}
      {section === 'feed' && feedTab !== 'crews' && feedTab !== 'compete' && feedTab !== 'activity' && <LiveActivityRail />}

      {/* Stories tray — hidden on Crews tab. "Stories stay on top": people
          you already follow come BEFORE strangers to add. The follow
          suggestion rail used to render above this, so the first thing on
          Hub was a list of people you don't know while your friends' stories
          sat below the fold — and it pushed the "add a note" affordance off
          the top of your own avatar. Kegan flagged both on 2026-08-05.
          The rule was already written here; the order just didn't match it. */}
      {section === 'feed' && feedTab !== 'crews' && feedTab !== 'compete' && feedTab !== 'activity' && (
        <StoriesRow
          onViewProfile={(u) => {
            setProfileTarget(u);
            setSection('profile');
          }}
        />
      )}
      {/* Follow suggestions rail (migration 091). Visible when the user
          has <3 followees (empty-feed trap) or hasn't dismissed in 30d.
          Each card is one-tap follow. The biggest single-feature lift
          to first-week retention because an empty feed = bounce.
          Sits BELOW stories — see the note above. */}
      {section === 'feed' && feedTab !== 'crews' && feedTab !== 'compete' && feedTab !== 'activity' && <FollowSuggestionRail />}

      {/* Friends-only weekly leaderboard (migration 093) moved to the
          Dashboard ("Friends this week" section) so it's a quick stats
          check on the home screen. */}

      {/* Marketplace + New Post row — shown on feed tabs, not crews.
          Both buttons match in height via min-h-[68px] so the row stays
          visually balanced regardless of internal content (Marketplace
          has 2 lines of text, New Post had a stacked icon+label). Same
          pill shape, same vertical rhythm. (Screenshot feedback —
          "make the new post and marketplace button lineup on the same
          horizontal button".) */}
      {section === 'feed' && feedTab !== 'crews' && feedTab !== 'compete' && feedTab !== 'activity' && (
        <div className="flex gap-2.5 mb-4 items-stretch">
          {/* Marketplace — 3/4 width, ember animation */}
          <div className="flex-[3] relative overflow-hidden rounded-2xl min-h-[68px]">
            {/* Floating ember particles */}
            {EMBERS.map((e, i) => (
              <motion.div
                key={i}
                className="absolute pointer-events-none rounded-full"
                style={{
                  width: e.size,
                  height: e.size,
                  left: `${e.x}%`,
                  bottom: 2,
                  background: i % 2 === 0 ? '#FED7AA' : '#FCA5A5',
                  filter: 'blur(0.5px)',
                }}
                animate={{ y: [0, -e.travel], opacity: [0, 0.65, 0] }}
                transition={{ duration: e.duration, delay: e.delay, repeat: Infinity, ease: 'easeOut' }}
              />
            ))}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate('/market')}
              className="w-full h-full flex items-center gap-3 px-4 py-3 rounded-2xl text-white"
              animate={{ filter: ['hue-rotate(0deg)', 'hue-rotate(-25deg)', 'hue-rotate(0deg)'] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              style={{ background: 'linear-gradient(135deg, #FB923C, #EA580C)' }}
            >
              <Store className="w-5 h-5 shrink-0" />
              <div className="flex-1 text-start min-w-0">
                <p className="text-sm font-bold leading-tight">{tFallback("layout.marketplace", "Marketplace")}</p>
                <p className="text-micro opacity-80 leading-tight truncate">{t('layout.marketplaceSub')}</p>
              </div>
            </motion.button>
          </div>

          {/* New Post — 1/4 width, orange outline + gray fill. Matches
              Marketplace's height via min-h-[68px] and centers the
              icon+label so both buttons read as the same shape. */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setComposerOpen(true)}
            className="flex-1 min-h-[68px] flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 bg-secondary/60"
            style={{ borderColor: 'hsl(var(--primary))' }}
          >
            <Plus className="w-4 h-4 stroke-[2.5]" style={{ color: 'hsl(var(--primary))' }} />
            <span className="text-xs font-bold leading-tight" style={{ color: 'hsl(var(--primary))' }}>{tFallback("hub.newPost", "New Post")}</span>
          </motion.button>
        </div>
      )}

      {/* Sections */}
      <AnimatePresence mode="wait" initial={false} custom={tabDirection}>
        <motion.div
          key={section + feedTab}
          custom={tabDirection}
          // Slide in from the side the new tab lives on, so the motion agrees
          // with the tab bar's left-to-right order and with a swipe. A plain
          // cross-fade reads as "something reloaded"; a direction reads as
          // "you moved". 24px, not a full screen width — this is a tab
          // change, not a page transition, and a long travel makes a fast
          // tab-tap feel slower than the tap.
          initial={(dir) => ({ opacity: 0, x: dir === 0 ? 0 : dir * 24 })}
          animate={{ opacity: 1, x: 0 }}
          exit={(dir) => ({ opacity: 0, x: dir === 0 ? 0 : dir * -24, pointerEvents: 'none' })}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          // Swipe between the three feed tabs. The gesture is started from
          // onPointerDown rather than by framer's own listener — see
          // `dragControls` above for why that is required and not cosmetic.
          // Elastic 0.06 with a tiny constraint means the panel barely moves:
          // this is a gesture detector, not a carousel; a rubber-banding feed
          // fights the vertical scroll it lives inside.
          drag={swipeEnabled ? 'x' : false}
          dragListener={false}
          dragControls={dragControls}
          onPointerDown={(e) => { if (swipeEnabled) dragControls.start(e); }}
          dragDirectionLock
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.06}
          onDragEnd={handleFeedSwipe}
        >
          {section === 'feed' && (feedTab === 'pump' || feedTab === 'squad' || feedTab === 'activity') && (
            <HubFeed
              feedTab={feedTab}
              onAuthorClick={(authorObj) => {
                setProfileTarget(authorObj);
                setSection('profile');
              }}
            />
          )}

          {section === 'feed' && feedTab === 'crews' && (
            <CrewsSection
              initialCrewId={pendingCrewId}
              key={pendingCrewId}
              onViewProfile={(u) => {
                setProfileTarget(u);
                setSection('profile');
              }}
            />
          )}

          {section === 'feed' && feedTab === 'compete' && (
            <CompetePanel onOpenCrews={() => goToTab('crews')} />
          )}

          {section === 'profile' && (
            <HubProfile
              targetUser={profileTarget}
              highlightPostId={highlightPostId}
              onHighlightConsumed={() => setHighlightPostId(null)}
              onSelectUser={(u) => setProfileTarget(u)}
              onStartConversation={startConversation}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* The orange "+" FAB that used to float here is gone.
          It called setComposerOpen(true) — the exact same action as the
          "New Post" button ~230px above it, so Hub shipped two create
          affordances in different styles for one action. It also floated
          over the first post card, covering its top-right corner and one of
          that post's own controls, and it was one of eleven orange elements
          competing for attention in a single Hub viewport.
          Removing it settles all three at once. "New Post" keeps the job:
          it is already balanced against Marketplace in the row above, it is
          labelled rather than relying on a "+" glyph, and it never covers
          content. */}

      {/* Composer */}
      {composerOpen && <HubComposer onClose={() => setComposerOpen(false)} />}

      {/* Search */}
      <HubSearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectUser={(u) => {
          setProfileTarget(u);
          setSection('profile');
        }}
        onSelectPost={(post) => {
          // Navigate to the post author's profile so user can see the post in context.
          //
          // Keyed on `user_id`, not `author_email`. HubProfile is id-first: an
          // `{email}` target leaves `targetId` null, which disables the profile
          // lookup AND both follow queries, so a real athlete rendered as
          // Bronze / Lv 1 / 0 followers / no bio with no duel-gift menu. The
          // email is still on the row, so nothing threw and the page looked
          // like a user with an empty profile rather than a broken read.
          if (post?.user_id) {
            setProfileTarget({
              id: post.user_id,
              username: post.author_name?.replace('@', ''),
              avatar_url: post.author_avatar_url || null,
            });
            setSection('profile');
          }
        }}
      />
    </div>
    </ErrorBoundary>
  );
}
