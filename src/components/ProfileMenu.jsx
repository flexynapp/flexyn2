import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '@/api/db';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { LogOut, User, Trash2, Settings, ChevronRight, X, ShoppingBag, UserCircle, Book, Trophy, ShieldAlert, Building2, Dumbbell } from 'lucide-react';
import { clearFirstLaunch } from '@/lib/firstLaunch';
import { handle } from '@/lib/userDisplay';
import { requestOpenBag } from '@/lib/inventoryFlow';
import * as capsules from '@/lib/data/capsules';
import LevelBar from './LevelBar';
import { toast } from '@/lib/toast';
import { motion, AnimatePresence } from 'framer-motion';
import LanguagePicker from './LanguagePicker';
import { useLanguage } from '@/lib/LanguageContext';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import AccountDeletedScreen from './AccountDeletedScreen';
import { OPEN_ACHIEVEMENTS_EVENT } from '@/lib/achievementsFlow';
import { isVerified } from '@/lib/verifiedUsers';
import { initialsFor } from '@/lib/initials';
import { isEnabled } from '@/lib/featureFlags';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

// DebriefVault + InjuryForm + AchievementsVault are modals that ONLY
// mount when the user explicitly opens them from this menu — no reason
// to be in the entry bundle. ProfileMenu is rendered on every
// authenticated page, so static deps here are paid on every first
// paint. Lazy-import to keep the chunk on-demand. Declared AFTER all
// imports so Vite's bundle init doesn't hit a TDZ on `const`s that
// would otherwise sit between import statements.
const DebriefVault       = lazy(() => import('./debrief/DebriefVault'));
const InjuryForm         = lazy(() => import('./workout/InjuryForm'));
const AchievementsVault  = lazy(() => import('./achievements/AchievementsVault'));
// My Journal — overhauled into a server-backed editor (title, markdown
// formatting + voice, attachments, swipe-between-days, scrollable
// history log). Lazy so its deps stay out of the entry bundle.
const JournalView        = lazy(() => import('./journal/JournalView'));

// preserveKeys: when true (Sign Out), a small set of per-device
// preferences survive so the same user logging back in doesn't reset
// them (audit B-3). When false (Delete Account), wipe everything.
//
// Journal entries are NOT in the preserve set — they're user PII
// scoped to the previous account, and leaving them in localStorage
// across a sign-out lets the next user inspect them via DevTools on a
// shared device. The journal data layer migrates legacy entries to
// the DB on first sign-in anyway (see src/lib/data/journal.js
// migrateLocalJournals), so the durable copy lives server-side and
// re-hydrates on next login.
function wipeLocalClientState({ preserveKeys = false } = {}) {
  clearFirstLaunch();
  try {
    if (preserveKeys) {
      // Snapshot keys we want to keep, then restore after clear.
      const snapshot = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        // Per-device preferences that should survive sign-out so the
        // next sign-in on the same device doesn't reset them. The
        // server-mirrored prefs (theme, language) hydrate from the
        // user_profile on next mount anyway; the device-local ones
        // (haptics, sounds, weight unit, distance unit) live only
        // here and would be lost forever otherwise. (Audit 14 #14.)
        if (
          k === 'fn-theme' ||
          k === 'fn-dark-mode' ||
          k === 'fn-loot-theme' ||
          k === 'fn-language' ||
          k === 'fn-distance-unit' ||
          k === 'flexyn_weight_unit' ||
          k === 'flexyn.hapticsDisabled' ||
          k === 'flexyn.soundsEnabled'
        ) {
          snapshot[k] = localStorage.getItem(k);
        }
      }
      localStorage.clear();
      for (const [k, v] of Object.entries(snapshot)) {
        try { localStorage.setItem(k, v); } catch {}
      }
    } else {
      localStorage.clear();
    }
  } catch {}
  try { sessionStorage.clear(); } catch {}
  try {
    if (indexedDB.databases) {
      indexedDB.databases().then(dbs => {
        dbs.forEach(db => { try { indexedDB.deleteDatabase(db.name); } catch {} });
      }).catch(() => {});
    }
  } catch {}
  // Cookie clear — sweep across the most common path/domain combos
  // so subdomain-scoped or subpath-scoped cookies (audit B-22) are
  // not missed. We can't enumerate every path the server set, but
  // covering `/`, `/api`, the current path, and a leading-dot domain
  // catches the realistic cases.
  try {
    const paths = ['/', '/api', window.location.pathname];
    const host = window.location.hostname;
    const domains = [host, `.${host}`, host.split('.').slice(-2).join('.')];
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      if (!name) return;
      const expired = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      for (const p of paths) {
        document.cookie = `${expired}; path=${p}`;
        for (const d of domains) {
          document.cookie = `${expired}; path=${p}; domain=${d}`;
        }
      }
    });
  } catch {}
}

export default function ProfileMenu({ compact = false } = {}) {
  const { t, tFallback } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);
  // Synchronous double-tap guard on the most destructive action in the
  // app. `isDeleting` state is async — a fast second tap (≤16ms before
  // the next render) can fire both invocations. The second runs after
  // wipeLocalClientState() and db.auth.logout(), so its
  // supabase.auth.getUser() returns no user and _invokeDeleteAccount
  // silently early-returns `undefined` — which the caller's
  // `result.success === false` check treats as truthy success. UX flips
  // to AccountDeletedScreen with nothing actually re-deleted.
  // Wave 54 (Settings audit) caught this.
  const deletingRef = useRef(false);
  const [journalOpen, setJournalOpen] = useState(false);

  // Close the journal overlay whenever the route changes.
  //
  // My Journal is a global overlay; My Gyms is a route. Without this, opening
  // one and then the other left BOTH on screen at once — the journal floating
  // over the My Gyms page — which reads as the app breaking rather than as two
  // surfaces coexisting. Nothing else in the menu has this problem because
  // every other entry navigates.
  //
  // Same shape as the nav-visibility reset in Layout.jsx and the
  // ErrorBoundary's auto-reset: an overlay that outlives the page it was
  // opened from has to be told when the page goes away.
  useEffect(() => {
    setJournalOpen(false);
  }, [location.pathname]);
  const [debriefVaultOpen, setDebriefVaultOpen] = useState(false);
  const [injuryFormOpen, setInjuryFormOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const ref = useRef(null);
  // The panel itself is the scroll container (max-h + overflow-y-auto), and
  // it stays mounted between opens, so it keeps whatever scrollTop it was
  // left at. Reset on every open so the menu always starts at its header.
  const panelRef = useRef(null);
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // The panel is a scroll container floating over a live page — it has no
  // backdrop, so the Dashboard/Hub behind it is both visible and, until
  // this, still scrollable. A drag that the panel couldn't consume (its
  // content fits, or it's already at an end) fell straight through and
  // moved the page instead, which is what "the menu stays put and the
  // background scrolls" looks like. Pin the page for as long as it's open.
  useBodyScrollLock(open);

  // Esc-to-close on the open drawer (audit C-14).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const handleDeleteAccount = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setIsDeleting(true);
    let succeeded = false;
    try {
      // Run server-side deletion FIRST so we can detect partial failures
      // BEFORE wiping local state (audit B-5, C-27). Then revoke auth
      // session BEFORE clearing localStorage so Supabase can read the
      // refresh token to invalidate it server-side (audit B-26, C-11).
      // The shim returns the function's value directly (not wrapped).
      // Throw is now the canonical failure signal — _invokeDeleteAccount
      // throws an Error with .partial=true on partial deletion (audit
      // B-5 / C-27).
      const result = await db.functions.invoke('deleteAccountData', {});
      if (result && result.success === false) {
        throw new Error(result.error || 'Delete failed');
      }
      try { await db.auth.logout(); } catch {}
      wipeLocalClientState({ preserveKeys: false });
      succeeded = true;
      setAccountDeleted(true);
    } catch (err) {
      setIsDeleting(false);
      // Reset the ref on failure so the user CAN retry. On success the
      // component unmounts (AccountDeletedScreen takes over) so the
      // ref is moot.
      deletingRef.current = false;
      if (err?.partial) {
        const tableList = (err.failures || []).slice(0, 3).map(f => f.table).join(', ');
        toast.error(`Deletion incomplete. Some data could not be removed (${tableList}…). Contact support.`);
      } else {
        toast.error(t('profile.deleteError'));
      }
    }
    if (!succeeded) setDeleteOpen(false);
  };

  const handleSignOut = async () => {
    // Sign-out preserves journal entries + per-device theme preferences
    // so the same user signing back in doesn't lose work (audit B-3).
    // Order: signOut (Supabase) → wipe localStorage → navigate. The
    // previous `await db.auth.logout('/')` triggered `window.location.href = '/'`
    // INSIDE the logout finally-block, racing the wipe to completion.
    // On a fast network the redirect won the race and per-device-scoped
    // keys (flexyn.pushOptInDismissed.<uid>, flexyn.iosInstallDismissed.<uid>,
    // flexyn.celebratedCrewWars.<uid>) stayed on the device so a second
    // user inherited the first user's UX-state flags. Now we call
    // logout WITHOUT a redirectUrl param (it still defaults to '/'),
    // but we wipe before navigating ourselves to guarantee ordering.
    // (Audit 14 #3.)
    // `null` suppresses the redirect inside db.auth.logout so we can
    // wipe BEFORE navigating ourselves — guaranteeing ordering.
    try { await db.auth.logout(null); } catch {}
    try { wipeLocalClientState({ preserveKeys: true }); } catch {}
    try { window.location.href = '/'; } catch {}
  };

  const { user: authUser } = useAuth();
  const { data: user } = useQuery({
    queryKey: ['userProfile', authUser?.email],
    queryFn: () => db.auth.me(),
  });

  // Unopened-capsule count for the "My Bag" badge. Shares the same
  // query key the Layout-level useBagFlow uses, so React Query dedupes
  // and a single fetch updates both spots.
  const { data: capsuleCount = 0 } = useQuery({
    queryKey: ['userCapsulesCount', authUser?.email],
    queryFn: async () => {
      const list = await capsules.listUnopenedCapsules(authUser.email);
      return list.length;
    },
    enabled: !!authUser?.email,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    const handler = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;

      // Don't close the menu when the click lands on a portaled UI
      // surface that logically belongs to the menu — the LevelBar
      // tooltip and any Radix Dialog (Leaderboards modal, Settings
      // dialogs, etc.) are rendered via portals to document.body, so
      // they fall outside `ref.current` even though dismissing the
      // menu when they're clicked would tear down the modal mid-render.
      const t = e.target;
      if (t?.closest?.('[data-portal-ignore-outside-click]')) return;
      if (t?.closest?.('[role="dialog"]')) return;
      // Sonner toasts (e.g. an Undo toast from a sibling action) are
      // also portaled; clicking them shouldn't close the menu.
      // (Audit 14 #29.)
      if (t?.closest?.('[data-sonner-toast]')) return;
      if (t?.closest?.('[data-sonner-toaster]')) return;
      if (t?.closest?.('[data-radix-dialog-overlay]')) return;
      if (t?.closest?.('[data-radix-popper-content-wrapper]')) return;

      setOpen(false);
    };
    // iOS Safari doesn't reliably synthesize `mousedown` on background
    // taps; listen to `touchstart` in parallel (audit B-14).
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  // Listen for the global "open achievements" event so external
  // surfaces (e.g. StatsHubModal's Achievements tile) can open the
  // vault without holding a ref to ProfileMenu. Mirrors the
  // OPEN_BAG_EVENT pattern in inventoryFlow.js.
  useEffect(() => {
    const handler = () => setAchievementsOpen(true);
    window.addEventListener(OPEN_ACHIEVEMENTS_EVENT, handler);
    return () => window.removeEventListener(OPEN_ACHIEVEMENTS_EVENT, handler);
  }, []);

  // Username-first, via the shared helper — this used to read full_name only,
  // which meant the header avatar and the profile avatar 850px below it
  // disagreed about the same user (AR here, RE there) and rendered the empty
  // person icon for anyone without a full_name. See src/lib/initials.js.
  const initials = initialsFor(user);
  const isVerifiedUser = isVerified(user?.username);

  if (accountDeleted) return <AccountDeletedScreen />;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={compact
          // Header: a plain h-11 w-11 icon button so it lines up with the
          // messages + bell buttons (no extra padding/margin/name).
          ? 'relative flex items-center justify-center h-11 w-11 hover:bg-secondary active:bg-secondary rounded-lg transition-colors select-none-ui'
          // Sidebar: full-width row with avatar + first name.
          : 'relative flex items-center justify-center gap-2 w-full h-11 hover:bg-secondary active:bg-secondary rounded-lg px-3 transition-colors select-none-ui ms-2'}
        aria-label={
          capsuleCount > 0
            ? `Profile — ${capsuleCount} unopened ${capsuleCount === 1 ? 'capsule' : 'capsules'}`
            : 'Profile'
        }
      >
        <div className="relative w-9 h-9 shrink-0">
          <div className="w-9 h-9 rounded-full bg-primary/10 border border-border flex items-center justify-center text-sm font-bold text-primary overflow-hidden">
            {user?.avatar_url ? (
              <img loading="lazy" src={user.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : user?.full_name ? (
              initials
            ) : (
              <User className="w-4 h-4" />
            )}
          </div>
          {/* Admin crown — only for verified users */}
          {isVerifiedUser && (
            <svg
              width="14" height="11"
              viewBox="0 0 14 11"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ position: 'absolute', top: -7, left: '50%', transform: 'translateX(-50%) rotate(-10deg)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}
            >
              <path d="M1 9.5L2.5 4L5.5 7L7 1.5L8.5 7L11.5 4L13 9.5H1Z" fill="#F59E0B" stroke="#D97706" strokeWidth="0.75" strokeLinejoin="round" />
              <rect x="1" y="9.5" width="12" height="1.5" rx="0.75" fill="#D97706" />
            </svg>
          )}
        </div>
        {/* Unopened-capsule badge — the visible-from-every-page
            anchor for the loot economy. Without this the welcome
            capsule sits unnoticed in the bag forever and the user
            never experiences the loot loop. The number is rendered
            on a purple dot that visually echoes the in-bag capsule
            tint, so the language "purple = your loot" stays
            consistent across surfaces. */}
        {capsuleCount > 0 && (
          <motion.span
            key={capsuleCount}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            aria-hidden="true"
            // Was bg-purple-500 / text-white — the only purple left in the
            // app's header chrome, on an orange-brand app, and the same
            // badge two branches below already renders as
            // bg-primary/text-primary-foreground. Matched to that.
            className="absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-micro font-bold flex items-center justify-center border-2 border-card shadow-sm"
          >
            {capsuleCount > 9 ? '9+' : capsuleCount}
          </motion.span>
        )}
        {!compact && user?.full_name && (
          <span className="text-sm font-medium">{user.full_name.split(' ')[0]}</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.92, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -10 }}
            transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            className="fixed start-4 end-4 top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] max-h-[calc(100vh-4rem-env(safe-area-inset-top))] lg:fixed lg:start-0 lg:right-auto lg:top-[calc(11.5rem+env(safe-area-inset-top))] lg:mt-0 lg:max-h-[calc(100vh-12rem-env(safe-area-inset-top))] lg:w-64 bg-card border border-border rounded-xl shadow-xl z-[100] overflow-hidden overflow-y-auto"
          >
            {user ? (
              // This menu has ONE view. It used to have two — main and an
              // inline Settings panel — and if a second is ever added here,
              // do not reach for <AnimatePresence mode="wait">: it keeps the
              // outgoing view mounted until its exit finishes and only then
              // mounts the incoming one, so the card sat completely empty
              // for the whole exit spring. On a slow phone users read that
              // as "the settings menu is blank." A keyed enter-only
              // animation puts the new view on screen the same frame the
              // old one leaves.
              //
              // Settings itself now lives at /settings — see pages/Settings.jsx
              // for why it outgrew this 361px-wide dropdown.
                  <motion.div
                    key="main"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  >
                    <div className="px-4 py-3 border-b border-border">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{user.full_name || 'User'}</p>
                          {/* The handle, not the address. This is the user's
                              own email so it leaks nothing — but it is on
                              screen whenever the menu is open, which is a
                              shoulder, a screenshot or a screen share away
                              from being someone else's. The username
                              identifies the account just as well. */}
                          <p className="text-xs text-muted-foreground truncate">{handle(user)}</p>
                        </div>
                        <button
                          onClick={() => setOpen(false)}
                          className="p-1 rounded-md hover:bg-secondary active:bg-secondary transition-colors shrink-0 text-muted-foreground"
                          aria-label="Close menu"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <LevelBar totalXp={user?.total_xp || 0} compact={true} />
                        <LanguagePicker variant="compact" iconOnly />
                      </div>
                    </div>
                    {/* Account — routes to own profile via the clean /profile URL */}
                    <button
                      onClick={() => {
                        setOpen(false);
                        navigate('/profile');
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary active:bg-secondary transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-primary/10 border border-border flex items-center justify-center overflow-hidden shrink-0">
                          {user?.avatar_url
                            ? <img loading="lazy" src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                            : <UserCircle className="w-3.5 h-3.5 text-primary" />}
                        </div>
                        {tFallback('profile.account', 'Profile')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => { setOpen(false); navigate('/settings'); }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <Settings className="w-4 h-4" />
                        {t('profile.settings')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    {/* Achievements — relocated from Progress page.
                        The trophy chip didn't belong with the data /
                        chart tabs (Trends, Analytics, Body, Photos),
                        so it now lives next to Debrief Vault as part
                        of the user's accumulated-milestones surface. */}
                    <button
                      onClick={() => {
                        setOpen(false);
                        setAchievementsOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-yellow-500" />
                        {tFallback('profile.achievements', 'Achievements')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => {
                        setOpen(false);
                        requestOpenBag();
                        navigate('/market');
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <ShoppingBag className="w-4 h-4" />
                        {tFallback('profile.myBag', 'My Bag')}
                      </div>
                      <div className="flex items-center gap-2">
                        {capsuleCount > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-micro font-bold flex items-center justify-center">
                            {capsuleCount > 9 ? '9+' : capsuleCount}
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </button>
                    {/* My Gym (singular) — the ONE gym the user trains
                        at, picked in onboarding. Sits above My Gyms
                        because it's the daily-use surface: their floor's
                        leaderboard and community progress. My Gyms
                        (plural) below is the management list of every
                        gym they've ever joined. */}
                    <button
                      onClick={() => {
                        setOpen(false);
                        navigate('/my-gym');
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <Dumbbell className="w-4 h-4 text-orange-500" />
                        {tFallback('profile.myGym', 'My Gym')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    {/* My Gyms — entry point into the gym business
                        ecosystem. Lands the user on their joined-gyms
                        dashboard with a code-entry box + a "Browse map"
                        link in the header. Owner-specific surfaces
                        (Register your gym, Manage business) live one
                        screen deeper. */}
                    <button
                      onClick={() => {
                        setOpen(false);
                        navigate('/my-gyms');
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-primary" />
                        {tFallback('profile.myGyms', 'My Gyms')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    {/* Corporate Wellness is flagged off (featureFlags.js) —
                        the surface is half-built and `organizations` has no
                        rows. Hiding the entry point matters as much as gating
                        the route: a menu item that lands on "Coming soon"
                        reads as a broken link rather than a deliberate hold. */}
                    {isEnabled('corporatePortal') && (
                    <button
                      onClick={() => {
                        setOpen(false);
                        navigate('/corporate');
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-emerald-500" />
                        {tFallback('profile.corporate', 'Corporate Wellness')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    )}
                    <button
                      onClick={() => {
                        setOpen(false);
                        setJournalOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <Book className="w-4 h-4" />
                        {tFallback('profile.myJournal', 'My Journal')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => {
                        setOpen(false);
                        setDebriefVaultOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4" />
                        {tFallback('profile.debriefVault', 'Weekly Summary')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => {
                        setOpen(false);
                        setInjuryFormOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-orange-500" />
                        {tFallback('profile.myInjuries', 'My Injuries')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    {/* Appearance used to sit here as <ThemePicker />, a second
                        home for the same light/dark switch that Settings ›
                        Preferences owns. Two controls for one setting on
                        adjacent screens is a maintenance trap, not a
                        shortcut — both wrote `setDarkMode`, so they could not
                        disagree, but any future change had to be made twice.
                        Settings is the discoverable home; this menu
                        navigates there. */}
                    <button
                      onClick={() => { setOpen(false); setSignOutOpen(true); }}
                      className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
                    >
                      <LogOut className="w-4 h-4" />
                      {t('profile.signOut')}
                    </button>
                    <div className="border-t border-border">
                      <button
                        onClick={() => { setOpen(false); setDeleteConfirmText(''); setDeleteOpen(true); }}
                        className="w-full flex items-center gap-2 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 active:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        {t('profile.deleteAccount')}
                      </button>
                    </div>
                  </motion.div>
            ) : (
              <button
                onClick={() => db.auth.redirectToLogin()}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-secondary active:bg-secondary transition-colors"
              >
                <User className="w-4 h-4" />
                {t('profile.signIn')}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* My Journal — global overlay, accessible from any page */}
      <AnimatePresence>
        {journalOpen && user && (
          <Suspense fallback={null}>
            <JournalView
              userId={user?.id}
              userEmail={user?.email}
              onClose={() => setJournalOpen(false)}
            />
          </Suspense>
        )}
      </AnimatePresence>

      {/* Debrief Vault — global overlay, accessible from any page.
          Lazy-loaded (see import above); Suspense fallback is null so
          there's no flash before the chunk arrives — the AnimatePresence
          enter animation papers over the brief load. */}
      <AnimatePresence>
        {debriefVaultOpen && (
          <Suspense fallback={null}>
            <DebriefVault onClose={() => setDebriefVaultOpen(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      {/* Injury Form — global overlay, accessible from any page.
          Lazy-loaded (see import above); Suspense fallback is null so
          the modal animation papers over the brief chunk load. */}
      <AnimatePresence>
        {injuryFormOpen && (
          <Suspense fallback={null}>
            <InjuryForm onClose={() => setInjuryFormOpen(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      {/* Achievements — global overlay, accessible from any page.
          Lazy-loaded; same pattern as DebriefVault above. */}
      <AnimatePresence>
        {achievementsOpen && (
          <Suspense fallback={null}>
            <AchievementsVault onClose={() => setAchievementsOpen(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      {/* Sign-Out confirmation (audit C-24). Sign-out is destructive
          on shared devices because it clears app caches; a one-tap
          path was inconsistent with the Delete Account safeguard. */}
      <AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tFallback('profile.signOutTitle', 'Sign out?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tFallback('profile.signOutDesc', "You'll be returned to the sign-in screen. Your journal entries and theme preferences stay on this device.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); setSignOutOpen(false); handleSignOut(); }}
            >
              {tFallback('profile.signOut', 'Sign out')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Account — requires typed confirmation (audit B-1). */}
      <AlertDialog open={deleteOpen} onOpenChange={(o) => { if (!isDeleting) setDeleteOpen(o); }}>
        <AlertDialogContent
          onEscapeKeyDown={(e) => { if (isDeleting) e.preventDefault(); }}
          onPointerDownOutside={(e) => { if (isDeleting) e.preventDefault(); }}
          onInteractOutside={(e) => { if (isDeleting) e.preventDefault(); }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('profile.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('profile.deleteDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 pt-1">
            <label className="text-xs text-muted-foreground block">
              {tFallback('profile.deleteTypePrompt', 'Type')} <span className="font-mono font-bold text-destructive">DELETE</span> {tFallback('profile.deleteTypePromptCont', 'to confirm:')}
            </label>
            <input
              type="text"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={isDeleting}
              placeholder="DELETE"
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-destructive/40"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteAccount(); }}
              disabled={isDeleting || deleteConfirmText.trim() !== 'DELETE'}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/90 disabled:opacity-40"
            >
              {isDeleting ? t('profile.deletingLabel') : t('profile.confirmDeletion')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}