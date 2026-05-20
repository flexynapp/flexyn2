import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '@/api/db';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { LogOut, User, Trash2, Settings, ChevronRight, ArrowLeft, X, ShoppingBag, UserCircle, Book, ChevronLeft, Trophy, ShieldAlert } from 'lucide-react';
import { format, subDays, addDays } from 'date-fns';
import { clearFirstLaunch } from '@/lib/firstLaunch';
import { requestOpenBag } from '@/lib/inventoryFlow';
import * as capsules from '@/lib/data/capsules';
import LevelBar from './LevelBar';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import ThemePicker from './ThemePicker';
import LanguagePicker from './LanguagePicker';
import { useLanguage } from '@/lib/LanguageContext';
import SettingsPanel from './SettingsPanel';
import AccountDeletedScreen from './AccountDeletedScreen';
// DebriefVault + InjuryForm are modals that ONLY mount when the user
// explicitly opens them from this menu — they have no reason to be in
// the entry bundle. ProfileMenu is rendered on every authenticated
// page, so any static dependency here is paid on first paint across
// the whole app. Lazy-import both so the chunk only loads on demand.
const DebriefVault       = lazy(() => import('./debrief/DebriefVault'));
const InjuryForm         = lazy(() => import('./workout/InjuryForm'));
const AchievementsVault  = lazy(() => import('./achievements/AchievementsVault'));
import { OPEN_ACHIEVEMENTS_EVENT } from '@/lib/achievementsFlow';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

// ─── My Journal ───────────────────────────────────────────────────────────────
const JOURNAL_KEY = (email, dateStr) => `journal_${email}_${dateStr}`;

function JournalView({ userEmail, onClose }) {
  const [activeDate, setActiveDate] = useState(new Date());
  const dateStr = format(activeDate, 'yyyy-MM-dd');
  const displayDate = format(activeDate, 'EEEE, MMMM d yyyy');
  const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');

  const [text, setText] = useState(() => {
    try { return localStorage.getItem(JOURNAL_KEY(userEmail, format(new Date(), 'yyyy-MM-dd'))) || ''; } catch { return ''; }
  });

  useEffect(() => {
    try {
      setText(localStorage.getItem(JOURNAL_KEY(userEmail, dateStr)) || '');
    } catch { setText(''); }
  }, [dateStr, userEmail]);

  const handleChange = (e) => {
    if (!isToday) return;
    const val = e.target.value;
    setText(val);
    try { localStorage.setItem(JOURNAL_KEY(userEmail, dateStr), val); } catch {}
  };

  const goBack = () => setActiveDate(d => subDays(d, 1));
  const goForward = () => {
    const next = addDays(activeDate, 1);
    if (next <= new Date()) setActiveDate(next);
  };
  const canGoForward = !isToday;

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 32 }}
      transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      className="fixed inset-0 z-[200] bg-background flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <button onClick={onClose} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-1.5">
          <Book className="w-4 h-4 text-primary" />
          <span className="font-heading font-bold text-base">My Journal</span>
        </div>
        <div className="w-16" />
      </div>

      {/* Date navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 bg-secondary/20">
        <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-foreground">{displayDate}</p>
          {isToday && <p className="text-[11px] text-primary font-semibold">Today</p>}
        </div>
        <button onClick={goForward} disabled={!canGoForward} className="p-1.5 rounded-lg hover:bg-secondary transition-colors disabled:opacity-30">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Journal text area */}
      <div className="flex-1 flex flex-col px-4 py-4 overflow-hidden">
        <textarea
          value={text}
          onChange={handleChange}
          readOnly={!isToday}
          placeholder={isToday ? "How was your session today? Log your lifts, notes, or how you felt…" : "No entry for this day."}
          className="flex-1 w-full bg-transparent text-foreground text-sm leading-relaxed resize-none focus:outline-none placeholder:text-muted-foreground/50"
          style={{ fontFamily: 'inherit' }}
        />
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-border shrink-0">
        <p className="text-[11px] text-muted-foreground text-center">
          {isToday ? 'Auto-saved · Use ← to browse past entries' : 'Read-only · Navigate to today to write'}
        </p>
      </div>
    </motion.div>
  );
}

function wipeLocalClientState() {
  clearFirstLaunch();
  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}
  try {
    if (indexedDB.databases) {
      indexedDB.databases().then(dbs => {
        dbs.forEach(db => { try { indexedDB.deleteDatabase(db.name); } catch {} });
      }).catch(() => {});
    }
  } catch {}
  try {
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
  } catch {}
}

export default function ProfileMenu() {
  const { t, tFallback } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('main'); // 'main' | 'settings'
  const [isDeleting, setIsDeleting] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [debriefVaultOpen, setDebriefVaultOpen] = useState(false);
  const [injuryFormOpen, setInjuryFormOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    setOpen(false);
    setView('main');
  }, [location.pathname]);

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      const result = await db.functions.invoke('deleteAccountData', {});
      if (result?.data?.success === false || result?.data?.error) {
        throw new Error(result?.data?.error || 'Delete failed');
      }
      wipeLocalClientState();
      try { db.auth.logout(); } catch {}
      setAccountDeleted(true);
    } catch (err) {
      setIsDeleting(false);
      toast.error(t('profile.deleteError'));
    }
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
      if (t?.closest?.('[data-radix-dialog-overlay]')) return;
      if (t?.closest?.('[data-radix-popper-content-wrapper]')) return;

      setOpen(false);
      setView('main');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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

  const initials = user?.full_name
    ? user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  if (accountDeleted) return <AccountDeletedScreen />;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(v => !v); setView('main'); }}
        className="flex items-center justify-center gap-2 w-full h-10 hover:bg-secondary rounded-lg px-3 transition-colors select-none-ui ml-2"
        aria-label="Profile"
      >
        <div className="w-9 h-9 rounded-full bg-primary/10 border border-border flex items-center justify-center text-sm font-bold text-primary shrink-0 overflow-hidden">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : user?.full_name ? (
            initials
          ) : (
            <User className="w-4 h-4" />
          )}
        </div>
        {user?.full_name && (
          <span className="text-sm font-medium">{user.full_name.split(' ')[0]}</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -10 }}
            transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            className="fixed left-4 right-4 top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] max-h-[calc(100vh-4rem-env(safe-area-inset-top))] lg:fixed lg:left-0 lg:right-auto lg:top-[calc(11.5rem+env(safe-area-inset-top))] lg:mt-0 lg:max-h-[calc(100vh-12rem-env(safe-area-inset-top))] lg:w-64 bg-card border border-border rounded-xl shadow-xl z-[100] overflow-hidden overflow-y-auto"
          >
            {user ? (
              <AnimatePresence mode="wait">
                {view === 'main' && (
                  <motion.div
                    key="main"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  >
                    <div className="px-4 py-3 border-b border-border">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{user.full_name || 'User'}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                        <button
                          onClick={() => { setOpen(false); setView('main'); }}
                          className="p-1 rounded-md hover:bg-secondary transition-colors shrink-0 text-muted-foreground"
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
                    {/* Account — routes to own public profile */}
                    <button
                      onClick={() => {
                        setOpen(false);
                        navigate(`/hub?profile=${encodeURIComponent(user?.email || '')}`);
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-primary/10 border border-border flex items-center justify-center overflow-hidden shrink-0">
                          {user?.avatar_url
                            ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                            : <UserCircle className="w-3.5 h-3.5 text-primary" />}
                        </div>
                        {tFallback('profile.account', 'Profile')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => setView('settings')}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary transition-colors border-t border-border"
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
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary transition-colors border-t border-border"
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
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <ShoppingBag className="w-4 h-4" />
                        {tFallback('profile.myBag', 'My Bag')}
                      </div>
                      <div className="flex items-center gap-2">
                        {capsuleCount > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                            {capsuleCount > 9 ? '9+' : capsuleCount}
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setOpen(false);
                        setJournalOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary transition-colors border-t border-border"
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
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4" />
                        {tFallback('profile.debriefVault', 'Debrief Vault')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => {
                        setOpen(false);
                        setInjuryFormOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary transition-colors border-t border-border"
                    >
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-orange-500" />
                        {tFallback('profile.myInjuries', 'My Injuries')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <ThemePicker />
                    <button
                      onClick={() => {
                        // Sign-out MUST clear local state too — without this,
                        // the next user on the same device inherits the
                        // previous user's localStorage settings, IndexedDB
                        // caches, react-query cache, and onboarding drafts.
                        // The audit caught this as a privacy issue.
                        wipeLocalClientState();
                        db.auth.logout('/');
                      }}
                      className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-secondary transition-colors border-t border-border"
                    >
                      <LogOut className="w-4 h-4" />
                      {t('profile.signOut')}
                    </button>
                    <div className="border-t border-border">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button className="w-full flex items-center gap-2 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 transition-colors">
                            <Trash2 className="w-4 h-4" />
                            {t('profile.deleteAccount')}
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent
                          onEscapeKeyDown={(e) => { if (isDeleting) e.preventDefault(); }}
                          onPointerDownOutside={(e) => { if (isDeleting) e.preventDefault(); }}
                          onInteractOutside={(e) => { if (isDeleting) e.preventDefault(); }}
                        >
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('profile.deleteTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>{t('profile.deleteDesc')}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={isDeleting}>{t('common.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={(e) => {
                                e.preventDefault();
                                handleDeleteAccount();
                              }}
                              disabled={isDeleting}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              {isDeleting ? t('profile.deletingLabel') : t('profile.confirmDeletion')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </motion.div>
                )}

                {view === 'settings' && (
                  <motion.div
                    key="settings"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  >
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                      <button
                        onClick={() => setView('main')}
                        className="p-1 rounded-md hover:bg-secondary transition-colors"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <p className="font-medium text-sm">{t('profile.settings')}</p>
                    </div>
                    <SettingsPanel />
                  </motion.div>
                )}
              </AnimatePresence>
            ) : (
              <button
                onClick={() => db.auth.redirectToLogin()}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-secondary transition-colors"
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
          <JournalView
            userEmail={user?.email}
            onClose={() => setJournalOpen(false)}
          />
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
    </div>
  );
}