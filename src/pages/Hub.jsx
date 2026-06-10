// src/pages/Hub.jsx
// Hub is now strictly the social feed: Pump + Squad + Crews, plus the Profile
// sub-view (own or someone else's). Marketplace, DMs, AI Coach, and the
// Bag/Capsule flow were hoisted out to /market, /messages, /coach, and
// the global ProfileMenu respectively.
import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Users as UsersIcon, User as UserIcon, Plus, ArrowLeft, Search, Shield, Store, Activity } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import HubFeed from '@/components/hub/HubFeed';
import HubProfile from '@/components/hub/HubProfile';
import HubComposer from '@/components/hub/HubComposer';
import HubSearchOverlay from '@/components/hub/HubSearchOverlay';
import FollowerActivityBanner from '@/components/hub/FollowerActivityBanner';
import LiveActivityRail from '@/components/hub/LiveActivityRail';
import FollowSuggestionRail from '@/components/hub/FollowSuggestionRail';
import FriendLeaderboardPanel from '@/components/hub/FriendLeaderboardPanel';
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
  const isProfilePath = location.pathname === '/profile';

  const [section, setSection] = useState(
    (initialProfileEmail || isProfilePath) ? 'profile' : 'feed'
  );
  const [feedTab, setFeedTab] = useState('pump');
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(
    initialProfileEmail ? { email: decodeURIComponent(initialProfileEmail) } : null
  );
  const [pendingCrewId, setPendingCrewId] = useState(null);

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
  const consumedInitialProfileRef = useRef(false);
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
    const profileEmail = params.get('profile');
    if (profileEmail) {
      // The first effect pass after mount lines up with the
      // synchronous useState init — don't double-apply. The param
      // still needs to be stripped from the URL, so we set
      // `changed` and let the navigate() below clean it.
      if (!consumedInitialProfileRef.current) {
        consumedInitialProfileRef.current = true;
      } else {
        setProfileTarget({ email: decodeURIComponent(profileEmail) });
        setSection('profile');
      }
      params.delete('profile');
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

  return (
    <ErrorBoundary label="Hub">
    <div className="px-4 md:px-6 pt-[120px] lg:pb-6 max-w-3xl mx-auto">
      {/* Fixed Hub sub-header */}
      <div className="fixed start-0 end-0 z-20 bg-background/95 backdrop-blur-md border-b border-border top-[calc(56px+env(safe-area-inset-top))] lg:top-[env(safe-area-inset-top)] lg:start-64">
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
                  className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {t('hub.backToHub')}
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 lg:col-start-3 lg:justify-self-end">

              {/* Search */}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label={tFallback('hub.search.label', 'Search')}
                className="p-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
              >
                <Search className="w-5 h-5" />
              </button>

              {/* Activity — lives in the corner (not a sub-tab) so the feed
                  row stays a clean Pump | Squad | Crews. */}
              <button
                type="button"
                onClick={() => { setSection('feed'); setProfileTarget(null); setFeedTab('activity'); }}
                aria-label={tFallback('hub.feed.activity', 'Activity')}
                className={`p-2 rounded-lg transition-colors ${
                  section === 'feed' && feedTab === 'activity'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary'
                }`}
              >
                <Activity className="w-5 h-5" />
              </button>

              {/* Profile (self/other) */}
              <button
                type="button"
                onClick={() => {
                  if (section === 'profile' && (!profileTarget || profileTarget?.email === user?.email)) {
                    setSection('feed');
                  } else {
                    setProfileTarget(null);
                    setSection('profile');
                  }
                }}
                aria-label={t('hub.myProfile')}
                className={`p-2 rounded-lg transition-colors ${
                  section === 'profile' && (!profileTarget || profileTarget?.email === user?.email)
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary'
                }`}
              >
                <UserIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Feed sub-tabs — Pump | Squad | Crews */}
          {section === 'feed' && (
            <div className="flex gap-1 p-1 bg-secondary rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setFeedTab('pump')}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-md transition-colors ${
                  feedTab === 'pump'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-secondary-foreground/70 hover:text-secondary-foreground'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                {t('hub.feed.pump')}
              </button>
              <button
                type="button"
                onClick={() => setFeedTab('squad')}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-md transition-colors ${
                  feedTab === 'squad'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-secondary-foreground/70 hover:text-secondary-foreground'
                }`}
              >
                <UsersIcon className="w-3.5 h-3.5" />
                {t('hub.feed.squad')}
              </button>
              <button
                type="button"
                onClick={() => setFeedTab('crews')}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-md transition-colors ${
                  feedTab === 'crews'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-secondary-foreground/70 hover:text-secondary-foreground'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                {tFallback('hub.feed.crews', 'Crews')}
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
      {section === 'feed' && feedTab !== 'crews' && feedTab !== 'activity' && <LiveActivityRail />}

      {/* Follow suggestions rail (migration 091). Visible when the user
          has <3 followees (empty-feed trap) or hasn't dismissed in 30d.
          Each card is one-tap follow. The biggest single-feature lift
          to first-week retention because an empty feed = bounce. */}
      {section === 'feed' && feedTab !== 'crews' && feedTab !== 'activity' && <FollowSuggestionRail />}

      {/* Stories tray — hidden on Crews tab. Moved above the leaderboard
          per user feedback (the rule is "stories stay on top"). */}
      {section === 'feed' && feedTab !== 'crews' && feedTab !== 'activity' && (
        <StoriesRow
          onViewProfile={(u) => {
            setProfileTarget(u);
            setSection('profile');
          }}
        />
      )}

      {/* Friends-only weekly leaderboard (migration 093). XP / Volume /
          Sessions toggle. Now sits below stories — was above, swapped per
          user feedback. */}
      {section === 'feed' && feedTab !== 'crews' && feedTab !== 'activity' && <FriendLeaderboardPanel />}

      {/* Marketplace + New Post row — shown on feed tabs, not crews.
          Both buttons match in height via min-h-[68px] so the row stays
          visually balanced regardless of internal content (Marketplace
          has 2 lines of text, New Post had a stacked icon+label). Same
          pill shape, same vertical rhythm. (Screenshot feedback —
          "make the new post and marketplace button lineup on the same
          horizontal button".) */}
      {section === 'feed' && feedTab !== 'crews' && feedTab !== 'activity' && (
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
                <p className="text-sm font-bold leading-tight">Marketplace</p>
                <p className="text-[11px] opacity-80 leading-tight truncate">Trade gear &amp; regimens</p>
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
            <span className="text-xs font-bold leading-tight" style={{ color: 'hsl(var(--primary))' }}>New Post</span>
          </motion.button>
        </div>
      )}

      {/* Sections */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={section + feedTab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
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
            />
          )}

          {section === 'profile' && (
            <HubProfile
              targetUser={profileTarget}
              onSelectUser={(u) => setProfileTarget(u)}
              onStartConversation={startConversation}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Mobile FAB — only on the feed, not on Crews tab */}
      {section === 'feed' && feedTab !== 'crews' && feedTab !== 'activity' && (
        <div
          className="lg:hidden fixed inset-x-0 z-40 pointer-events-none"
          style={{ bottom: 'calc(6.5rem + env(safe-area-inset-bottom))' }}
        >
          <div className="max-w-3xl mx-auto px-4 md:px-6 flex justify-end">
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1.05 }}
              onClick={() => setComposerOpen(true)}
              aria-label={t('hub.composer.fab')}
              className="pointer-events-auto w-14 h-14 rounded-full flex items-center justify-center bg-gradient-to-br from-primary to-primary/60 text-primary-foreground focus:outline-none focus:ring-4 focus:ring-primary/30"
              style={{ boxShadow: '0 10px 24px -6px hsl(var(--primary) / 0.55), 0 4px 8px -2px hsl(var(--primary) / 0.30)' }}
            >
              <Plus className="w-7 h-7 stroke-[2.5]" strokeLinecap="round" />
            </motion.button>
          </div>
        </div>
      )}

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
          // Navigate to the post author's profile so user can see the post in context
          if (post?.author_email) {
            setProfileTarget({ email: post.author_email, username: post.author_name?.replace('@', '') });
            setSection('profile');
          }
        }}
      />
    </div>
    </ErrorBoundary>
  );
}
