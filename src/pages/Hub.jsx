// src/pages/Hub.jsx
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Users as UsersIcon, MessageCircle, User as UserIcon, Plus, ArrowLeft, Search, ShoppingBag, Package, Store } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import HubFeed from '@/components/hub/HubFeed';
import HubMessages from '@/components/hub/HubMessages';
import HubProfile from '@/components/hub/HubProfile';
import HubComposer from '@/components/hub/HubComposer';
import HubSearchOverlay from '@/components/hub/HubSearchOverlay';
import UserBag from '@/components/hub/UserBag';
import CapsuleOpener from '@/components/hub/CapsuleOpener';
import MarketplaceFeed from '@/components/hub/MarketplaceFeed';
import * as hubMessages from '@/lib/data/hubMessages';
import * as inventory from '@/lib/data/inventory';
import * as capsules from '@/lib/data/capsules';
import { toast } from 'sonner';

export default function Hub() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [section, setSection] = useState('feed');
  const [feedTab, setFeedTab] = useState('pump');
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null);
  const [pendingChatTarget, setPendingChatTarget] = useState(null);
  const [bagOpen, setBagOpen] = useState(false);
  const [openingCapsule, setOpeningCapsule] = useState(null); // capsule row being opened

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['hubUnreadCount', user?.email],
    queryFn: () => hubMessages.unreadCountFor(user.email),
    enabled: !!user?.email,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Count unopened capsules for the bag badge
  const { data: capsuleCount = 0 } = useQuery({
    queryKey: ['userCapsules', user?.email],
    queryFn: async () => {
      const list = await capsules.listUnopenedCapsules(user.email);
      return list.length;
    },
    enabled: !!user?.email,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const handleStartConversation = async (targetUserObj) => {
    if (!user?.email) {
      toast.error(t('hub.messages.authNotReady') || 'Still signing you in — try again in a moment.');
      return;
    }
    if (!targetUserObj?.email) {
      console.error('[Hub] handleStartConversation called without target email');
      return;
    }
    try {
      const conv = await hubMessages.findOrCreateConversation(user.email, targetUserObj.email);
      if (conv) {
        setPendingChatTarget({ conversation: conv, otherUser: targetUserObj });
        setSection('messages');
      } else {
        toast.error(t('hub.messages.startError') || 'Could not start conversation. Try again.');
        throw new Error('no-conversation');
      }
    } catch (e) {
      console.error('[Hub] startConversation failed:', e);
      if (e?.message !== 'no-conversation') {
        toast.error(t('hub.messages.startError') || 'Could not start conversation. Try again.');
      }
      throw e;
    }
  };

  // Handle capsule open from the bag
  const handleOpenCapsule = (capsuleRow) => {
    setBagOpen(false);
    setOpeningCapsule(capsuleRow);
  };

  // After capsule animation: save item to inventory, invalidate caches
  const handleCapsuleClaim = async (wonItem) => {
    setOpeningCapsule(null);
    if (!wonItem || !user?.email) return;
    try {
      await inventory.addItem(userProfile?.id || user?.id, user.email, wonItem, 'capsule');
      queryClient.invalidateQueries({ queryKey: ['userInventory', user.email] });
      queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
      toast.success(`${wonItem.emoji} ${wonItem.name} added to your bag!`);
    } catch (err) {
      console.error('[Hub] capsule claim failed:', err);
      toast.error('Could not save item. Try again.');
    }
  };

  // Pull userProfile for inventory operations
  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: async () => {
      const { supabase } = await import('@/api/supabaseClient');
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return null;
      const { data } = await supabase.from('user_profiles').select('id, flex_coins').eq('id', authUser.id).maybeSingle();
      return data;
    },
    enabled: !!user?.email,
  });

  useEffect(() => {
    setSection('feed');
    setProfileTarget(null);
  }, []);

  return (
    <div className="px-4 md:px-6 pt-[120px] pb-6 max-w-3xl mx-auto">
      {/* ── Fixed combined Hub nav ─────────────────────────────────────────── */}
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
              {/* Desktop: New Post */}
              {section === 'feed' && (
                <button
                  type="button"
                  onClick={() => setComposerOpen(true)}
                  aria-label={t('hub.composer.fab')}
                  className="hidden lg:inline-flex items-center gap-1.5 h-9 px-3 mr-1 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm font-bold"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  {t('hub.composer.fab')}
                </button>
              )}

              {/* Bag button */}
              <button
                type="button"
                onClick={() => setBagOpen(true)}
                aria-label="My Bag"
                className="relative p-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
              >
                <ShoppingBag className="w-5 h-5" />
                {capsuleCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center"
                  >
                    {capsuleCount > 9 ? '9+' : capsuleCount}
                  </motion.span>
                )}
              </button>

              {/* Search */}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label={t('hub.search.label') || 'Search'}
                className="p-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
              >
                <Search className="w-5 h-5" />
              </button>

              {/* Messages */}
              <button
                type="button"
                onClick={() => setSection(section === 'messages' ? 'feed' : 'messages')}
                aria-label={t('hub.messages')}
                className={`relative p-2 rounded-lg transition-colors ${
                  section === 'messages'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary'
                }`}
              >
                <MessageCircle className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Profile */}
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

          {/* Feed sub-tabs — Global | Following | Marketplace */}
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
                onClick={() => setFeedTab('marketplace')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-md transition-colors ${
                  feedTab === 'marketplace'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Store className="w-4 h-4" />
                Market
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Sections ─────────────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={section + feedTab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {section === 'feed' && feedTab !== 'marketplace' && (
            <HubFeed
              feedTab={feedTab}
              onAuthorClick={(authorObj) => {
                setProfileTarget(authorObj);
                setSection('profile');
              }}
            />
          )}

          {section === 'feed' && feedTab === 'marketplace' && (
            <MarketplaceFeed
              onStartConversation={handleStartConversation}
            />
          )}

          {section === 'messages' && (
            <HubMessages
              pendingChatTarget={pendingChatTarget}
              onPendingConsumed={() => setPendingChatTarget(null)}
            />
          )}

          {section === 'profile' && (
            <HubProfile
              targetUser={profileTarget}
              onSelectUser={(u) => setProfileTarget(u)}
              onStartConversation={handleStartConversation}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Mobile FAB */}
      {section === 'feed' && feedTab !== 'marketplace' && (
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
      />

      {/* Bag */}
      <UserBag
        open={bagOpen}
        onClose={() => setBagOpen(false)}
        onOpenCapsule={handleOpenCapsule}
      />

      {/* Capsule opener */}
      {openingCapsule && (
        <CapsuleOpener
          capsule={openingCapsule}
          onClaim={handleCapsuleClaim}
          onClose={() => setOpeningCapsule(null)}
        />
      )}
    </div>
  );
}
