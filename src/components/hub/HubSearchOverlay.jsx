// src/components/hub/HubSearchOverlay.jsx
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Users, SearchX, Trash2, UserPlus, Loader2, MessageSquare, Hash } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/api/db';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { getTier } from '@/lib/xpTier';
import { Skeleton } from '@/components/ui/skeleton';
import * as hubFollows from '@/lib/data/hubFollows';
import * as hubPosts from '@/lib/data/hubPosts';

// Per-user key (recent searches store other users' email/username/avatar —
// a global key bled that PII to the next account on a shared device).
const LEGACY_RECENT_SEARCHES_KEY = 'hubRecentSearches';
const recentSearchesKey = (userId) => `flexyn.hubRecentSearches.${userId || 'anon'}`;
const MAX_RECENT_SEARCHES = 5;

function getRecentSearches(userId) {
  try {
    // One-time eviction of the legacy un-scoped key so old PII doesn't linger.
    localStorage.removeItem(LEGACY_RECENT_SEARCHES_KEY);
    const stored = localStorage.getItem(recentSearchesKey(userId));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(userId, user) {
  try {
    let recent = getRecentSearches(userId);
    recent = recent.filter(u => u.id !== user.id);
    recent.unshift(user);
    recent = recent.slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(recentSearchesKey(userId), JSON.stringify(recent));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

function removeRecentSearch(userId, id) {
  try {
    let recent = getRecentSearches(userId);
    recent = recent.filter(u => u.id !== id);
    localStorage.setItem(recentSearchesKey(userId), JSON.stringify(recent));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

export default function HubSearchOverlay({ open, onClose, onSelectUser, onSelectPost = null }) {
  const { t } = useLanguage();
  const { user: currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState([]);
  const [followedIds, setFollowedIds] = useState(new Set());
  const [localAdded, setLocalAdded] = useState(new Set());
  // Feature 17: tab toggle
  const [activeTab, setActiveTab] = useState('people'); // 'people' | 'posts'
  const [postResults, setPostResults] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);

  // Load recent searches + following list on open
  useEffect(() => {
    if (open) {
      setRecentSearches(getRecentSearches(currentUser?.id));
      setLocalAdded(new Set());
      if (currentUser?.id) {
        hubFollows.listFollowingIds(currentUser.id)
          .then(ids => setFollowedIds(new Set(ids)))
          .catch(() => {});
      }
    }
  }, [open, currentUser?.id]);

  // Search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const allUsers = await db.entities.User.list();
        const q = searchQuery.toLowerCase();
        const filtered = allUsers
          .filter(u => {
            if (!u.id) return false;
            if (u.id === currentUser?.id) return false; // never return self
            // Hide deleted / reset accounts — their username starts with "deleted_"
            if (u.username?.startsWith('deleted_')) return false;
            // Match against username OR full_name. Display stays username-only —
            // see UserResultRow below — so full_name is used as a search key only,
            // not surfaced in the UI.
            const usernameMatch = u.username?.toLowerCase().includes(q);
            const fullNameMatch = u.full_name?.toLowerCase().includes(q);
            return Boolean(usernameMatch || fullNameMatch);
          })
          .slice(0, 10);
        setSearchResults(filtered);
      } catch {
        setSearchResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Feature 17: Post search effect — searches body, author, post_type, and hashtags
  useEffect(() => {
    if (!searchQuery.trim() || activeTab !== 'posts') {
      setPostResults([]);
      return;
    }
    setPostsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const q = searchQuery.toLowerCase().trim();
        // Fetch public feed (large limit to maximize matches)
        const feed = await hubPosts.listPublicFeed(200).catch(() => []);
        const filtered = feed.filter(p => {
          const body = (p.body || p.content || '').toLowerCase();
          const author = (p.author_name || p.author_email || '').toLowerCase();
          const postType = (p.post_type || '').toLowerCase();
          // Hashtag search: if query starts with '#' match exact tag, else partial body match
          if (q.startsWith('#')) {
            const tags = body.match(/#\w+/g) || [];
            return tags.some(tag => tag.toLowerCase().includes(q));
          }
          return body.includes(q) || author.includes(q) || postType.includes(q);
        }).slice(0, 25);
        setPostResults(filtered);
      } catch {
        setPostResults([]);
      } finally {
        setPostsLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, activeTab]);

  const handleSelectUser = (user) => {
    saveRecentSearch(currentUser?.id, user);
    onSelectUser(user);
    setSearchQuery('');
    onClose();
  };

  const handleRemoveRecent = (e, id) => {
    e.stopPropagation();
    removeRecentSearch(currentUser?.id, id);
    setRecentSearches(getRecentSearches(currentUser?.id));
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-background overflow-y-auto"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
          }}
        >
          {/* Decorative gradient blob */}
          <div
            className="pointer-events-none absolute top-0 start-1/2 -translate-x-1/2 w-full h-96"
            style={{
              background: `radial-gradient(ellipse 800px 400px at 50% 0%, hsl(var(--primary) / 0.08), transparent)`,
            }}
          />

          {/* Content */}
          <div className="relative max-w-3xl mx-auto px-4 md:px-6 pt-6 pb-8">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-6"
            >
              <h1 className="font-heading font-bold text-2xl mb-4">{t('hub.search.title')}</h1>

              {/* Search bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <div className="absolute start-4 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <Search className="w-6 h-6" />
                  </div>
                  <input
                    autoFocus
                    type="text"
                    placeholder={activeTab === 'posts' ? 'Search posts or #hashtag…' : t('hub.search.placeholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-14 ps-12 pe-12 rounded-2xl border-2 border-border bg-card focus:border-primary/30 focus:outline-none transition-colors text-sm"
                  />
                  {searchQuery && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={() => setSearchQuery('')}
                      className="absolute end-3 top-1/3 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </motion.button>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground shrink-0"
                  aria-label="Close search"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </motion.div>

            {/* Feature 17: Tab toggle */}
            <div className="flex items-center gap-1 mb-4 bg-secondary/30 rounded-xl p-1">
              <button
                onClick={() => setActiveTab('people')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === 'people' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Users className="w-4 h-4" /> People
              </button>
              <button
                onClick={() => setActiveTab('posts')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === 'posts' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <MessageSquare className="w-4 h-4" /> Posts
              </button>
            </div>

            {/* Results container */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              {/* ── Posts tab ── */}
              {activeTab === 'posts' && (
                <>
                  {!searchQuery && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-16 h-16 rounded-full bg-primary/5 flex items-center justify-center mb-4">
                        <MessageSquare className="w-8 h-8 text-primary/40" />
                      </div>
                      <p className="text-muted-foreground text-sm">Search for posts by keyword or author</p>
                    </div>
                  )}
                  {searchQuery && postsLoading && (
                    <div className="flex justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {searchQuery && !postsLoading && postResults.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <SearchX className="w-10 h-10 text-muted-foreground/40 mb-3" />
                      <p className="font-semibold text-sm">No posts found for "{searchQuery}"</p>
                    </div>
                  )}
                  {postResults.length > 0 && (
                    <div className="space-y-2">
                      {postResults.map((post, i) => (
                        <motion.button
                          key={post.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                          onClick={() => {
                            onSelectPost?.(post);
                            onClose();
                          }}
                          className="w-full text-start p-3 rounded-xl border border-border/40 hover:border-border hover:bg-secondary/40 transition-colors"
                        >
                          <p className="text-xs text-muted-foreground font-medium mb-1">
                            {post.author_name || 'Athlete'}
                          </p>
                          <p className="text-sm text-foreground line-clamp-2 break-words">
                            {(post.body || post.content || '').startsWith('[POLL_V1]')
                              ? '📊 Poll'
                              : (post.body || post.content || '').slice(0, 140)}
                          </p>
                          {/* Show matched hashtags as chips */}
                          {(() => {
                            const body = (post.body || post.content || '').toLowerCase();
                            const tags = (body.match(/#\w+/g) || []).slice(0, 4);
                            if (!tags.length) return null;
                            return (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {tags.map(tag => (
                                  <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-micro bg-primary/10 text-primary font-medium">
                                    <Hash className="w-2 h-2" />{tag.replace('#','')}
                                  </span>
                                ))}
                              </div>
                            );
                          })()}
                        </motion.button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ── People tab ── */}
              {activeTab === 'people' && (
              <>
              {/* Empty state with recent searches */}
              {!searchQuery && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  {recentSearches.length > 0 && (
                    <div className="w-full mb-8">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 text-start">Recent Searches</h3>
                      <div className="space-y-1.5">
                        {recentSearches.map((user, idx) => (
                          <RecentSearchCard
                            key={user.id || idx}
                            user={user}
                            onClick={() => handleSelectUser(user)}
                            onRemove={(e) => handleRemoveRecent(e, user.id)}
                          />
                        ))}
                      </div>
                      <div className="h-px bg-border my-6" />
                    </div>
                  )}
                  <div className="w-24 h-24 rounded-full bg-primary/5 flex items-center justify-center mb-4">
                    <Users className="w-12 h-12 text-primary/40" />
                  </div>
                  <h2 className="font-heading font-bold text-xl mb-2">{t('hub.search.discoverTitle')}</h2>
                  <p className="text-sm text-muted-foreground max-w-sm">{t('hub.search.discoverSubtitle')}</p>
                </div>
              )}

              {/* Loading state */}
              {searchQuery && isLoading && (
                <div className="space-y-2">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl">
                      <Skeleton className="w-12 h-12 rounded-full shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-5 w-12" />
                        <Skeleton className="h-3 w-10" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Empty results */}
              {searchQuery && !isLoading && searchResults.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="w-16 h-16 rounded-full bg-destructive/5 flex items-center justify-center mb-4">
                    <SearchX className="w-8 h-8 text-destructive/40" />
                  </div>
                  <h2 className="font-heading font-bold text-lg mb-1">{t('hub.search.noResultsTitle')}</h2>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    {t('hub.search.noResultsSubtitle').replace('{query}', searchQuery)}
                  </p>
                </div>
              )}

              {/* Results */}
              {searchQuery && !isLoading && searchResults.length > 0 && (
                <div className="space-y-1.5">
                  {searchResults.map((user, idx) => {
                    const isFollowed = followedIds.has(user.id) || localAdded.has(user.id);
                    return (
                      <UserResultRow
                        key={user.id}
                        user={user}
                        onClick={() => handleSelectUser(user)}
                        delay={idx * 0.04}
                        isFollowed={isFollowed}
                        onAdd={async (e) => {
                          e.stopPropagation();
                          setLocalAdded(prev => new Set([...prev, user.id]));
                          try {
                            await hubFollows.follow(currentUser.id, user.id, { t });
                          } catch (err) {
                            // Revert the optimistic check AND surface
                            // an error toast so the user understands
                            // why the button reverted. Previous code
                            // silently reverted with zero feedback —
                            // looked like the button was buggy.
                            // (Audit 10 #11.)
                            setLocalAdded(prev => {
                              const next = new Set(prev);
                              next.delete(user.id);
                              return next;
                            });
                            toast.error(`Couldn't follow @${user.username || 'user'}. Try again.`);
                          }
                        }}
                      />
                    );
                  })}
                </div>
              )}
              </>
              )}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RecentSearchCard({ user, onClick, onRemove }) {
  const { t } = useLanguage();
  const userXp = Number(user?.total_xp) || 0;
  const levelData = calculateLevelFromXp(userXp);
  const tier = getTier(levelData.level, t);
  const username = user.username || 'athlete';
  const initials = (username || 'A').slice(0, 2).toUpperCase();

  // Maps a tier's text class to its matching ring class. This was ten
  // entries, one per tier hue; once the tiers moved onto the colour
  // budget the keys collapsed to six DUPLICATES in an object literal,
  // where the last write silently wins. Behaviour was unaffected — every
  // duplicate mapped to the same value — but an object that claims ten
  // entries and holds six is a trap for the next reader. Deduped.
  const tierToRing = {
    'text-primary': 'ring-primary',
    'text-info': 'ring-info',
    'text-success': 'ring-success',
    'text-destructive': 'ring-destructive',
    'text-slate-300': 'ring-slate-300',
    'text-slate-400': 'ring-slate-400',
  };

  const ringClass = tierToRing[tier.text] || 'ring-primary';

  return (
    <motion.button
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl border border-border/40 hover:border-border/80 hover:bg-secondary/40 transition-colors text-start group"
    >
      {/* Avatar */}
      <div
        className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center overflow-hidden ring-2 ${ringClass} ${
          user.avatar_url ? '' : 'bg-primary/10'
        }`}
      >
        {user.avatar_url ? (
          <img loading="lazy" src={user.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="font-heading font-bold text-xs text-primary">{initials}</span>
        )}
      </div>

      {/* Center: handle + tier */}
      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-sm truncate">@{username}</p>
        <p className={`text-xs truncate ${tier.text}`}>{tier.name}</p>
      </div>

      {/* Right: remove button */}
      <button
        onClick={onRemove}
        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
        aria-label="Remove from recent"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </motion.button>
  );
}

function UserResultRow({ user, onClick, delay, isFollowed, onAdd }) {
  const { t } = useLanguage();
  const [adding, setAdding] = useState(false);
  const userXp = Number(user?.total_xp) || 0;
  const levelData = calculateLevelFromXp(userXp);
  const tier = getTier(levelData.level, t);
  const username = user.username || 'athlete';
  const initials = (username || 'A').slice(0, 2).toUpperCase();

  // Maps a tier's text class to its matching ring class. This was ten
  // entries, one per tier hue; once the tiers moved onto the colour
  // budget the keys collapsed to six DUPLICATES in an object literal,
  // where the last write silently wins. Behaviour was unaffected — every
  // duplicate mapped to the same value — but an object that claims ten
  // entries and holds six is a trap for the next reader. Deduped.
  const tierToRing = {
    'text-primary': 'ring-primary',
    'text-info': 'ring-info',
    'text-success': 'ring-success',
    'text-destructive': 'ring-destructive',
    'text-slate-300': 'ring-slate-300',
    'text-slate-400': 'ring-slate-400',
  };

  const ringClass = tierToRing[tier.text] || 'ring-primary';

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl border border-border/40 hover:border-border/80 hover:bg-secondary/60 transition-colors text-start group"
    >
      {/* Avatar */}
      <div
        className={`w-12 h-12 rounded-full shrink-0 flex items-center justify-center overflow-hidden ring-2 ${ringClass} ${
          user.avatar_url ? '' : 'bg-primary/10'
        }`}
      >
        {user.avatar_url ? (
          <img loading="lazy" src={user.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="font-heading font-bold text-sm text-primary">{initials}</span>
        )}
      </div>

      {/* Center: handle + tier */}
      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-base truncate">@{username}</p>
        <span className={`text-micro font-bold uppercase tracking-widest ${tier.text}`}>{tier.name}</span>
      </div>

      {/* Right: Add button (if not following) OR level badge */}
      {!isFollowed ? (
        <motion.button
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          onClick={async (e) => {
            if (adding) return;
            setAdding(true);
            await onAdd(e);
            setAdding(false);
          }}
          disabled={adding}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-primary-foreground shrink-0 disabled:opacity-60"
          style={{ background: 'hsl(var(--primary))' }}
          aria-label={`Follow @${username}`}
        >
          {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
          {!adding && 'Add'}
        </motion.button>
      ) : (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className={`px-2 py-0.5 rounded-md bg-gradient-to-r ${tier.badge} shadow-sm`}>
            <span className="text-xs font-bold text-white drop-shadow">Lv {levelData.level}</span>
          </div>
        </div>
      )}
    </motion.button>
  );
}