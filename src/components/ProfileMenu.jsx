import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '@/api/db';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { User, ChevronsUpDown } from 'lucide-react';
import { clearFirstLaunch } from '@/lib/firstLaunch';
import { handle } from '@/lib/userDisplay';
import * as capsules from '@/lib/data/capsules';
import { toast } from '@/lib/toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/lib/LanguageContext';
import AccountDeletedScreen from './AccountDeletedScreen';
import AccountMenu from './AccountMenu';
import ProfileAvatar from './ProfileAvatar';
import BottomSheet from '@/components/ui/BottomSheet';
import { OPEN_ACHIEVEMENTS_EVENT } from '@/lib/achievementsFlow';
import { OPEN_PROFILE_PANEL_EVENT } from '@/lib/profilePanels';
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
const StatsHubModal      = lazy(() => import('./StatsHubModal'));

// Same breakpoint as Tailwind's `lg`, where the sidebar replaces the header.
const DESKTOP_QUERY = '(min-width: 1024px)';

function useIsDesktop() {
  const read = () => {
    try { return !!window.matchMedia?.(DESKTOP_QUERY).matches; } catch { return false; }
  };
  const [isDesktop, setIsDesktop] = useState(read);
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia?.(DESKTOP_QUERY); } catch { return undefined; }
    if (!mq) return undefined;
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return isDesktop;
}
// My Journal — overhauled into a server-backed editor (title, markdown
// formatting + voice, attachments, swipe-between-days, scrollable
// history log). Lazy so its deps stay out of the entry bundle.

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

export default function ProfileMenu({ placement = 'header' } = {}) {
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
  // The journal overlay is owned by Layout now — see journalOverlay.js.
  // ProfileMenu is rendered TWICE (sidebar + header), so holding the open
  // state here split it across two copies and could mount two editors, each
  // autosaving the same row. Same reasoning that moved the Bag out.
  const [debriefVaultOpen, setDebriefVaultOpen] = useState(false);
  const [injuryFormOpen, setInjuryFormOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [statsOpen, setStatsOpen] = useState(false);
  const ref = useRef(null);
  const triggerRef = useRef(null);

  // Two copies of this component are mounted, the sidebar's and the phone
  // header's (the header is only CSS-hidden on desktop). Both used to listen
  // for the open-overlay events, so on desktop Weekly Reviews, Injuries,
  // Achievements and the account dialogs each opened TWICE, stacked: closing
  // one left its twin on screen and Back had two history entries to pop.
  // Exactly one copy owns the overlays: the one whose trigger is visible.
  const isDesktop = useIsDesktop();
  const ownsOverlays = placement === 'sidebar' ? isDesktop : !isDesktop;

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // No scroll lock here any more. The desktop menu is a small popover at the
  // sidebar foot, where the page behind it scrolling is expected; the phone
  // sheet locks the page itself (BottomSheet).

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
      // The feedback pill (e.g. an Undo from a sibling action) sits
      // outside the menu too; tapping it shouldn't close the menu.
      // (Audit 14 #29.)
      if (t?.closest?.('[data-feedback-pill]')) return;
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
    if (!ownsOverlays) return undefined;
    const handler = () => setAchievementsOpen(true);
    window.addEventListener(OPEN_ACHIEVEMENTS_EVENT, handler);
    return () => window.removeEventListener(OPEN_ACHIEVEMENTS_EVENT, handler);
  }, [ownsOverlays]);

  // The You tab opens the rest of this menu's overlays the same way.
  // See src/lib/profilePanels.js.
  useEffect(() => {
    if (!ownsOverlays) return undefined;
    const handler = (e) => {
      const panel = e.detail?.panel;
      if (panel === 'reviews') setDebriefVaultOpen(true);
      else if (panel === 'injuries') setInjuryFormOpen(true);
      else if (panel === 'signOut') setSignOutOpen(true);
      else if (panel === 'deleteAccount') { setDeleteConfirmText(''); setDeleteOpen(true); }
    };
    window.addEventListener(OPEN_PROFILE_PANEL_EVENT, handler);
    return () => window.removeEventListener(OPEN_PROFILE_PANEL_EVENT, handler);
  }, [ownsOverlays]);

  if (accountDeleted) return <AccountDeletedScreen />;

  const go = (path) => { setOpen(false); navigate(path); };
  const openStats = () => { setOpen(false); setStatsOpen(true); };
  const askSignOut = () => { setOpen(false); setSignOutOpen(true); };
  const close = () => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); };

  const capsuleLabel = capsuleCount > 0
    ? `${tFallback('profileMenu.account', 'Account')}, ${capsuleCount} unopened ${capsuleCount === 1 ? 'capsule' : 'capsules'}`
    : tFallback('profileMenu.account', 'Account');

  const badge = capsuleCount > 0 && (
    <motion.span
      key={capsuleCount}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      aria-hidden="true"
      className="absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-micro font-bold flex items-center justify-center border-2 border-card"
    >
      {capsuleCount > 9 ? '9+' : capsuleCount}
    </motion.span>
  );

  const menu = user ? (
    <AccountMenu
      user={user}
      capsuleCount={capsuleCount}
      open={open}
      onNavigate={go}
      onOpenStats={openStats}
      onSignOut={askSignOut}
      onClose={close}
    />
  ) : (
    <div className="p-1" data-portal-ignore-outside-click>
      <button
        type="button"
        onClick={() => db.auth.redirectToLogin()}
        className="w-full min-h-11 flex items-center gap-2 px-3 rounded-lg text-body font-medium hover:bg-secondary active:bg-secondary transition-colors"
      >
        <User className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
        {t('profile.signIn')}
      </button>
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      {placement === 'sidebar' ? (
        <>
          {/* Desktop: the account row sits at the FOOT of the sidebar, where
              Slack, Linear and GitHub put it, and the menu opens upward from
              it. At the top it opened over Today, Train, Hub and You, so
              opening your account hid the app's own navigation. */}
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                style={{ transformOrigin: 'bottom center' }}
                className="absolute bottom-full mb-2 start-0 end-0 z-[100] bg-card border border-border rounded-xl shadow-md overflow-hidden"
              >
                {menu}
              </motion.div>
            )}
          </AnimatePresence>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={capsuleLabel}
            className={`w-full min-h-12 flex items-center gap-2 px-2 py-1.5 rounded-lg text-start transition-colors hover:bg-secondary active:bg-secondary select-none-ui ${open ? 'bg-secondary' : ''}`}
          >
            <span className="relative">
              <ProfileAvatar user={user} size={36} crown />
              {badge}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-body font-medium truncate">
                {user?.full_name?.split(' ')[0] || handle(user) || t('profile.signIn')}
              </span>
              {user && (
                <span className="block text-label text-muted-foreground truncate">{handle(user)}</span>
              )}
            </span>
            <ChevronsUpDown className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          {/* Phone: the header avatar opens the same menu as a sheet. This
              trigger was meant to be hidden once the You tab arrived, but the
              `hidden` attribute lost to the button's own `flex` class, so it
              stayed on screen and opened the old nine-row copy of You. It is
              deliberate now, and small. */}
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={capsuleLabel}
            className="relative flex items-center justify-center h-11 w-11 rounded-lg hover:bg-secondary active:bg-secondary transition-colors select-none-ui"
          >
            <ProfileAvatar user={user} size={36} crown />
            {badge}
          </button>
          <BottomSheet open={open} onClose={() => setOpen(false)}>
            <div className="-mx-3">{menu}</div>
          </BottomSheet>
        </>
      )}

      {statsOpen && (
        <Suspense fallback={null}>
          <StatsHubModal open={statsOpen} onClose={() => setStatsOpen(false)} />
        </Suspense>
      )}

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