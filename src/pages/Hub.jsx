// src/pages/Hub.jsx
// Hub is now strictly the social feed: Pump + Squad + Crews, plus the Profile
// sub-view (own or someone else's). Marketplace, DMs, AI Coach, and the
// Bag/Capsule flow were hoisted out to /market, /messages, /coach, and
// the global ProfileMenu respectively.
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Users as UsersIcon, User as UserIcon, Plus, ArrowLeft, Search, Shield, Store } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import HubFeed from '@/components/hub/HubFeed';
import HubProfile from '@/components/hub/HubProfile';
import HubComposer from '@/components/hub/HubComposer';
import HubSearchOverlay from '@/components/hub/HubSearchOverlay';
import StoriesRow from '@/components/stories/StoriesRow';
import CrewsSection from '@/components/crews/CrewsSection';
import { useStartConversation } from '@/lib/hubMessaging';

export default function Hub() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [section, setSection] = useState('feed');
  const [feedTab, setFeedTab] = useState('pump');
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null);
  const [pendingCrewId, setPendingCrewId] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  const startConversation = useStartConversation();

  // Deep-links Hub still owns:
  //   ?compose=1       — open the post composer (used by daily-quest links)
  //   ?search=open     — open the user-search overlay (empty-state CTAs)
  //   ?profile=<email> — open a profile (used by Dashboard stories tray
  //                      when tapping a no-story friend avatar)
  // ?bag=open is no longer handled here; callers use OPEN_BAG_EVENT
  // (see StatsHubModal "Bag & Capsules" tile).
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
      setProfileTarget({ email: decodeURIComponent(profileEmail) });
      setSection('profile');
      params.delete('profile');
      changed = true;
    }
    if (changed) {
      navigate({ pathname: '/hub', search: params.toString() ? '?' + params.toString() : '' }, { replace: true });
    }
  }, [location.search, navigate]);

  useEffect(() => {
    setSection('feed');
    setProfileTarget(null);
  }, []);

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
    <div className="px-4 md:px-6 pt-[120px] pb-6 max-w-3xl mx-auto">
      {/* Fixed Hub sub-header */}
      <div className="fixed left-0 right-0 z-20 bg-background/95 backdrop-blur-md border-b border-border top-[calc(56px+env(safe-area-inset-top))] lg:top-[env(safe-area-inset-top)] lg:left-64">
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
                aria-label={t('hub.search.label') || 'Search'}
                className="p-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
              >
                <Search className="w-5 h-5" />
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
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-md transition-colors ${
                  feedTab === 'pump'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Flame className="w-4 h-4" />
                {t('hub.feed.pump')}
              </button>
              <button
                type="button"
                onClick={() => setFeedTab('squad')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-md transition-colors ${
                  feedTab === 'squad'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <UsersIcon className="w-4 h-4" />
                {t('hub.feed.squad')}
              </button>
              <button
                type="button"
                onClick={() => setFeedTab('crews')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-md transition-colors ${
                  feedTab === 'crews'
                    ? 'text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                style={feedTab === 'crews' ? { background: 'hsl(var(--primary))' } : {}}
              >
                <Shield className="w-4 h-4" />
                Crews
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stories tray — hidden on Crews tab */}
      {section === 'feed' && feedTab !== 'crews' && (
        <StoriesRow
          onViewProfile={(u) => {
            setProfileTarget(u);
            setSection('profile');
          }}
        />
      )}

      {/* Marketplace + New Post row — shown on feed tabs, not crews */}
      {section === 'feed' && feedTab !== 'crews' && (
        <div className="flex gap-2.5 mb-4">
          {/* Marketplace — 3/4 width */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/market')}
            className="flex-[3] flex items-center gap-3 px-4 py-3 rounded-2xl text-white"
            style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(26,90%,40%))' }}
          >
            <Store className="w-5 h-5 shrink-0" />
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-bold leading-tight">Marketplace</p>
              <p className="text-[11px] opacity-80 leading-tight truncate">Trade gear &amp; regimens</p>
            </div>
          </motion.button>

          {/* New Post — 1/4 width, orange outline + gray fill */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setComposerOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 bg-secondary/60"
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
          {section === 'feed' && (feedTab === 'pump' || feedTab === 'squad') && (
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
      {section === 'feed' && feedTab !== 'crews' && (
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
  );
}
