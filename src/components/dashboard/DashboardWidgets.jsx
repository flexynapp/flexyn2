import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, X, GripVertical, Pencil, Check } from 'lucide-react';
import WidgetLibrary from './WidgetLibrary';
import WidgetRenderer, { WIDGET_COMPONENTS } from './WidgetRenderer';
import { WIDGET_DEFINITIONS } from '@/lib/widgetDefinitions';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/api/db';

// Per-user namespaced key — previously the single 'dashboardWidgets' key
// meant two users on the same device (shared phone, family member
// signing in/out) inherited each other's widget layout. Follows the
// `flexyn.<feature>.<userId>` convention documented in CLAUDE.md.
// localStorage is now a CACHE — the source of truth is
// user_profiles.dashboard_widgets so the layout follows the user across
// devices. Local keeps first paint instant and works offline / before the
// migration lands (updateMe strips the column safely if it's missing).
const STORAGE_KEY = (userId) => `flexyn.dashboardWidgets.${userId || 'anon'}`;
const LEGACY_KEY = 'dashboardWidgets';

// Drop widget IDs not in the current catalog so a deprecated/renamed
// widget in saved state doesn't render as an "Unknown widget" card.
const dropStale = (arr) => (Array.isArray(arr) ? arr.filter((id) => id in WIDGET_COMPONENTS) : []);

// One reorderable widget row. Drag + remove controls only appear in Edit
// mode — no hover-reveal (there's no pointer on the mobile target, so a
// hover affordance would be invisible). In edit mode the controls are
// 44px tap targets and the widget's own content is made non-interactive so
// a rearrange tap can't accidentally trigger a widget action.
function ReorderableWidget({ widgetId, logs, goals, isLoading, editing, onRemove, removeLabel, dragHint }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={widgetId}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      className="relative"
    >
      {editing && (
        <>
          {/* Drag handle — touch-none so dragging doesn't scroll the page.
              Bare icon (no circle) so it doesn't overlap the card corner. */}
          <button
            type="button"
            onPointerDown={(e) => controls.start(e)}
            aria-label={dragHint}
            title={dragHint}
            className="absolute top-1.5 end-10 z-10 w-8 h-8 text-muted-foreground flex items-center justify-center cursor-grab active:cursor-grabbing touch-none [filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.35))]"
          >
            <GripVertical className="w-5 h-5" strokeWidth={2.5} />
          </button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => onRemove(widgetId)}
            className="absolute top-1.5 end-1.5 z-10 w-8 h-8 text-destructive flex items-center justify-center [filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.35))]"
            title={removeLabel}
            aria-label={removeLabel}
          >
            <X className="w-5 h-5" strokeWidth={2.75} />
          </motion.button>
        </>
      )}

      <div className={editing ? 'pointer-events-none select-none ring-2 ring-primary/30 rounded-2xl' : ''}>
        <WidgetRenderer widgetId={widgetId} logs={logs} goals={goals} isLoading={isLoading} />
      </div>
    </Reorder.Item>
  );
}

export default function DashboardWidgets({ logs, goals, isLoading, userProfile }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const [activeWidgets, setActiveWidgets] = useState([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // Pins the userId the authoritative load settled for. Guards the save
  // effect (never write User A's state under User B's key on an account
  // switch) and the load effect (don't clobber in-session edits once the
  // DB value has been applied).
  const hydratedFor = useRef(null);
  const dbSaveTimer = useRef(null);

  const readLocal = (uid) => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY(uid));
      if (saved) return dropStale(JSON.parse(saved));
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const v = dropStale(JSON.parse(legacy));
        try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
        return v;
      }
    } catch { /* Safari private mode / quota / bad JSON */ }
    return [];
  };

  // Debounced write-through to the DB. updateMe carries the strip-and-
  // retry safety net, so if the dashboard_widgets column isn't deployed
  // yet the write degrades to a no-op and localStorage still holds the
  // layout. Debounced so a drag-reorder (many intermediate orders) or a
  // rapid add/remove burst collapses into one round-trip.
  const queueDbSave = (uid, widgets) => {
    if (!uid) return;
    if (dbSaveTimer.current) clearTimeout(dbSaveTimer.current);
    dbSaveTimer.current = setTimeout(() => {
      db.auth.updateMe({ dashboard_widgets: widgets }).catch(() => { /* best-effort */ });
    }, 800);
  };
  useEffect(() => () => { if (dbSaveTimer.current) clearTimeout(dbSaveTimer.current); }, []);

  // Load: fast local first paint, then authoritative reconcile once the
  // profile is available. DB wins on load (cross-device); after that,
  // in-session edits win (guarded by hydratedFor).
  useEffect(() => {
    const uid = user?.id;
    if (!uid) { hydratedFor.current = null; setActiveWidgets([]); return; }

    if (hydratedFor.current !== uid) {
      // Instant paint from cache while user_profiles loads.
      setActiveWidgets(readLocal(uid));
    }

    if (userProfile != null && hydratedFor.current !== uid) {
      const dbVal = Array.isArray(userProfile.dashboard_widgets)
        ? dropStale(userProfile.dashboard_widgets)
        : null;
      if (dbVal && dbVal.length > 0) {
        setActiveWidgets(dbVal);
        try { localStorage.setItem(STORAGE_KEY(uid), JSON.stringify(dbVal)); } catch { /* ignore */ }
      } else {
        // No server layout yet — adopt local and migrate it up so this
        // device's layout starts syncing to the others.
        const local = readLocal(uid);
        setActiveWidgets(local);
        if (local.length > 0) queueDbSave(uid, local);
      }
      hydratedFor.current = uid;
    }
  }, [user?.id, userProfile]);

  // Persist every change to both the cache and (debounced) the DB.
  useEffect(() => {
    if (hydratedFor.current !== user?.id) return;
    try { localStorage.setItem(STORAGE_KEY(user?.id), JSON.stringify(activeWidgets)); } catch { /* best-effort */ }
    queueDbSave(user?.id, activeWidgets);
  }, [activeWidgets, user?.id]);

  // Add does NOT close the library — the user can add (and remove) several
  // widgets in one pass; the library card flips to its "on" state in place.
  const handleAddWidget = (widgetId) => {
    setActiveWidgets((prev) => (prev.includes(widgetId) ? prev : [...prev, widgetId]));
  };

  const handleRemoveWidget = (widgetId) => {
    setActiveWidgets((prev) => prev.filter((id) => id !== widgetId));
  };

  const isEmpty = activeWidgets.length === 0;
  const removeLabel = tFallback('dashboard.removeWidget', 'Remove widget');
  const dragHint = tFallback('dashboard.dragWidget', 'Drag to reorder');

  // WidgetLibrary is mounted ONCE below (not per-branch) so adding the
  // first widget — which flips this from the empty to the populated view —
  // doesn't unmount/remount the open dialog mid-interaction.
  return (
    <>
      {isEmpty ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-2">
          <Card className="p-3 text-center border-dashed">
            <div className="mb-1">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-1">
                <Plus className="w-6 h-6 text-primary" />
              </div>
            </div>
            <h3 className="font-heading font-bold text-base mb-1">{t('dashboard.customizeTitle')}</h3>
            <p className="text-muted-foreground text-xs mb-2">{t('dashboard.customizeDesc')}</p>
            {/* max-w-full + wrapping label: this button's intrinsic width is
                ~195px, so in a half-width dashboard slot (~168px) it hung 40px
                past the card edge. */}
            <Button
              onClick={() => setLibraryOpen(true)}
              className="gap-2 max-w-full h-auto min-h-10 py-2 whitespace-normal"
            >
              <Plus className="w-4 h-4 shrink-0" /> {t('dashboard.addFirstWidget')}
            </Button>
          </Card>
        </motion.div>
      ) : (
        <>
          {/* The heading moved out to the Dashboard's own SectionLabel, so
              this section announces itself the way every other one does
              (dot + heading + note) instead of with its own <h2>. The row
              stays for the edit toggle; justify-end keeps it right-aligned
              now that nothing sits opposite it. */}
          <div className="mb-2 flex items-center justify-end gap-2">
            {/* Edit toggle — reveals drag handles + remove controls. Keeps
                the default view clean (no always-on control clutter) and
                makes reordering discoverable without relying on hover. */}
            <Button
              variant={editing ? 'default' : 'outline'}
              size="sm"
              onClick={() => setEditing((v) => !v)}
              className="gap-1"
            >
              {editing
                ? (<><Check className="w-3.5 h-3.5" /> {tFallback('dashboard.doneEditing', 'Done editing')}</>)
                : (<><Pencil className="w-3.5 h-3.5" /> {tFallback('dashboard.editLayout', 'Edit')}</>)}
            </Button>
          </div>

          <Reorder.Group axis="y" values={activeWidgets} onReorder={setActiveWidgets} className="space-y-3">
            <AnimatePresence>
              {activeWidgets.map((widgetId) => (
                <ReorderableWidget
                  key={widgetId}
                  widgetId={widgetId}
                  logs={logs}
                  goals={goals}
                  isLoading={isLoading}
                  editing={editing}
                  onRemove={handleRemoveWidget}
                  removeLabel={removeLabel}
                  dragHint={dragHint}
                />
              ))}
            </AnimatePresence>
          </Reorder.Group>

          {/* Persistent add affordance at the END of the list, so the user
              can add another widget without scrolling back to the header. */}
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="mt-3 w-full min-h-[52px] rounded-2xl border-2 border-dashed border-border text-muted-foreground hover:text-foreground active:text-foreground active:border-primary/60 transition-colors flex items-center justify-center gap-2 text-sm font-semibold"
          >
            <Plus className="w-4 h-4" /> {t('dashboard.addWidget')}
          </button>

          {/* Foot line from board 01. The count is read from
              WIDGET_DEFINITIONS rather than written down: the board draws
              "12 widgets available" and CLAUDE.md says 16, while the array
              actually holds 10 — a number that drifts the moment anyone adds
              a widget, so it has to be derived or it will be wrong again. */}
          <p className="mt-2 text-micro text-muted-foreground/60 tracking-wide">
            {tFallback('dashboard.widgetsAvailable', '{n} widgets available')
              .replace('{n}', String(WIDGET_DEFINITIONS.length))}
            {' · '}
            {tFallback('dashboard.dragToReorder', 'drag any section to reorder')}
          </p>
        </>
      )}

      <WidgetLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onSelect={handleAddWidget}
        onRemove={handleRemoveWidget}
        activeWidgets={activeWidgets}
      />
    </>
  );
}
