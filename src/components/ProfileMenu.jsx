import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { db } from '@/api/db';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { LogOut, User, Trash2, Settings, ChevronRight, ArrowLeft, X } from 'lucide-react';
import AvatarUploader from '@/components/AvatarUploader';
import { clearFirstLaunch } from '@/lib/firstLaunch';
import LevelBar from './LevelBar';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import ThemePicker from './ThemePicker';
import LanguagePicker from './LanguagePicker';
import { useLanguage } from '@/lib/LanguageContext';
import SettingsPanel from './SettingsPanel';
import AccountDeletedScreen from './AccountDeletedScreen';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

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
  const { t } = useLanguage();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('main'); // 'main' | 'settings'
  const [isDeleting, setIsDeleting] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);
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
                    <button
                      onClick={() => setView('settings')}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Settings className="w-4 h-4" />
                        {t('profile.settings')}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <ThemePicker />
                    <button
                      onClick={() => db.auth.logout('/')}
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
    </div>
  );
}