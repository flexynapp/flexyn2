import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import WidgetLibrary from './WidgetLibrary';
import WidgetRenderer, { WIDGET_COMPONENTS } from './WidgetRenderer';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';

// Per-user namespaced key — previously the single 'dashboardWidgets' key
// meant two users on the same device (shared phone, family member
// signing in/out) inherited each other's widget layout. Follows the
// `flexyn.<feature>.<userId>` convention documented in CLAUDE.md.
const STORAGE_KEY = (userId) => `flexyn.dashboardWidgets.${userId || 'anon'}`;
const LEGACY_KEY = 'dashboardWidgets';

export default function DashboardWidgets({ logs, goals, isLoading }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const [activeWidgets, setActiveWidgets] = useState([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // hydratedFor pins the userId that the current activeWidgets state
  // was loaded for. Save effect only writes when the loaded userId
  // matches the current one. Without this, an account switch between
  // load and save could write User A's state under User B's storage
  // key — a real cross-account data leak risk that the prior
  // hydratedRef boolean was not strict enough to prevent.
  const hydratedFor = useRef(null);

  // Load saved widgets from localStorage when the user changes (or
  // appears for the first time). The outer try/catch covers Safari
  // private-mode + iOS quota-exceeded — both throw on the bare
  // `localStorage.getItem` call before any JSON parsing happens.
  useEffect(() => {
    const uid = user?.id;
    // Mark unhydrated until the load below settles for THIS uid. If
    // user.id changes mid-flight, the save effect skips persisting
    // while we re-load.
    hydratedFor.current = null;
    // Filter out widget IDs that aren't in the current WIDGET_COMPONENTS
    // catalog — a deprecated/renamed widget left in saved state would
    // otherwise render as a row of "Unknown widget" cards forever.
    const dropStale = (arr) => (Array.isArray(arr) ? arr.filter(id => id in WIDGET_COMPONENTS) : []);
    try {
      const saved = localStorage.getItem(STORAGE_KEY(uid));
      if (saved) {
        setActiveWidgets(dropStale(JSON.parse(saved)));
      } else {
        // One-shot migration from the legacy non-namespaced key — only
        // the first-loaded user inherits it; subsequent users get a
        // clean slate. Avoids the multi-user data leak retroactively.
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          setActiveWidgets(dropStale(JSON.parse(legacy)));
          try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
        } else {
          setActiveWidgets([]);
        }
      }
    } catch {
      setActiveWidgets([]);
    }
    hydratedFor.current = uid;
  }, [user?.id]);

  // Save widgets to localStorage whenever they change. Same Safari /
  // quota concerns as above — wrap so a write failure doesn't surface
  // as an uncaught error (would land in the parent ErrorBoundary and
  // crash the whole widget grid for a non-critical persistence issue).
  useEffect(() => {
    // Only persist when the loaded user matches the current user —
    // closes the account-switch window where save would otherwise
    // write the prior user's state to the new user's storage key.
    if (hydratedFor.current !== user?.id) return;
    try {
      localStorage.setItem(STORAGE_KEY(user?.id), JSON.stringify(activeWidgets));
    } catch { /* best-effort — quota / private mode */ }
  }, [activeWidgets, user?.id]);

  // Functional setState here — two fast taps in the WidgetLibrary
  // both read `activeWidgets` from this closure before the first
  // setState applies, producing two no-op renders. The functional
  // form sees the latest committed state on each invocation.
  const handleAddWidget = (widgetId) => {
    let alreadyAdded = false;
    setActiveWidgets(prev => {
      if (prev.includes(widgetId)) {
        alreadyAdded = true;
        return prev;
      }
      return [...prev, widgetId];
    });
    if (alreadyAdded) {
      // Surface an explicit signal — previously this branch was a
      // silent no-op and the user couldn't tell whether their tap
      // had registered.
      toast.info(tFallback('widgets.alreadyAdded', 'Widget already on your dashboard.'));
    }
    setLibraryOpen(false);
  };

  const handleRemoveWidget = (widgetId) => {
    setActiveWidgets(prev => prev.filter(id => id !== widgetId));
  };

  // Empty state
  if (activeWidgets.length === 0) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="py-2"
        >
          <Card className="p-3 text-center border-dashed">
            <div className="mb-1">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-1">
                <Plus className="w-6 h-6 text-primary" />
              </div>
            </div>
            <h3 className="font-heading font-bold text-base mb-1">{t('dashboard.customizeTitle')}</h3>
            <p className="text-muted-foreground text-xs mb-2">
              {t('dashboard.customizeDesc')}
            </p>
            <Button onClick={() => setLibraryOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" /> {t('dashboard.addFirstWidget')}
            </Button>
          </Card>
        </motion.div>

        <WidgetLibrary
          open={libraryOpen}
          onClose={() => setLibraryOpen(false)}
          onSelect={handleAddWidget}
          activeWidgets={activeWidgets}
        />
      </>
    );
  }

  // Render widgets
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-heading font-bold text-lg">{t('dashboard.yourWidgets')}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLibraryOpen(true)}
          className="gap-1"
        >
          <Plus className="w-3 h-3" /> {t('dashboard.addWidget')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <AnimatePresence>
          {activeWidgets.map((widgetId, idx) => (
            <motion.div
              key={widgetId}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="relative group"
            >
              <WidgetRenderer widgetId={widgetId} logs={logs} goals={goals} isLoading={isLoading} />
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleRemoveWidget(widgetId)}
                // opacity-60 on small screens (where there's no hover
                // event), opacity-0+group-hover on md+ where the user
                // has a mouse. The previous opacity-0 only state meant
                // mobile users — the majority — had no visible way to
                // remove a widget; the button was invisible until tap.
                className="absolute -top-2 -end-2 w-7 h-7 rounded-full bg-destructive text-white flex items-center justify-center opacity-60 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 hover:opacity-100 transition-opacity shadow-sm"
                title={t('dashboard.removeWidget') || 'Remove widget'}
                aria-label={t('dashboard.removeWidget') || 'Remove widget'}
              >
                <X className="w-3.5 h-3.5" />
              </motion.button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <WidgetLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onSelect={handleAddWidget}
        activeWidgets={activeWidgets}
      />
    </>
  );
}