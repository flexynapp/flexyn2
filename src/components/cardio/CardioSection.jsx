import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/LanguageContext';
import { cardioTypeLabel } from '@/lib/cardioTypeLabel';
import { useAuth } from '@/lib/AuthContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance } from '@/lib/distanceUnit';
import { db } from '@/api/db';
import {
  Footprints, PersonStanding, Bike, BookOpen,
  Trees, Activity, Pencil, Radio, RotateCcw,
  Waves, CalendarDays, BookmarkPlus, Watch, Target,
} from 'lucide-react';
import CardioManualForm from './CardioManualForm';
import CardioSavedList from './CardioSavedList';
import CardioDetailModal from './CardioDetailModal';
import CardioLiveTrackerOutside from './CardioLiveTrackerOutside';
import CardioLiveTrackerIndoor from './CardioLiveTrackerIndoor';
import CardioTemplates from './CardioTemplates';
import CardioPlanned from './CardioPlanned';
import CardioWearableStub from './CardioWearableStub';
import CardioGoals from './CardioGoals';
import { readSnapshot, clearSnapshot } from '@/lib/cardioSession';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

// A cardio nav tile, wearing the same clothes as the Workout grid card it
// sits one screen below. That grid is `getCardPalette` in Workout.jsx:
//
//   background: hsl(var(--card))
//   border:     border-border/60 hover:border-primary/40
//   icon:       w-10 h-10 rounded-xl bg-primary/18 border border-primary/28
//
// …with one correction. Copy those icon classes literally and they render
// NOTHING: Tailwind's opacity scale has no 18 and no 28, and an off-scale
// slash value emits no CSS at all rather than failing. Verified against
// the built stylesheet — `.bg-primary\/18` and `.border-primary\/28` are
// absent while /20 and /30 are present. So the tile below uses /20 and
// /30, which are on the scale and within a hair of the intended values.
// Workout.jsx has the same dead pair on its own icon tiles, along with 52
// other off-scale opacity classes app-wide; that sweep is its own task.
//
// These tiles used to be `border-dashed` on no surface at all, with a
// different hue per tile — orange, emerald, amber, cyan, violet, rose,
// zinc across nine tiles. Both are things the Workout page deliberately
// does NOT do, and its palette comment says why: a per-tile hue "reads as
// generated" and encodes nothing, because the grid is reorderable. Cardio
// is not reorderable, but the argument that survives is the other one —
// CLAUDE.md allows four hues app-wide and this screen was spending seven
// on navigation. The accent now lives on the icon and the surface is the
// app's card surface, which is the rule everywhere else.
//
// The `iconBg` / `iconColor` props are gone rather than ignored: a prop
// that silently does nothing is how the next person reintroduces the
// seven hues without noticing they stopped rendering.
function NavTile({ icon: Icon, title, description, onClick }) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
    >
      {/* h-full, matching Workout.jsx's cardBase and for the same reason.
          The motion.div is the grid item and stretches to the row height
          on its own, but the Card inside it sized to its content — so in
          the 2x2 activity grid, Swimming ("Pool or open water", two
          lines) rendered visibly shorter than the three tiles beside it
          whose description wraps to four. Nothing here sets a height;
          h-full just lets the Card fill the box the grid already gave it. */}
      <Card
        className="h-full p-5 cursor-pointer border-border/60 hover:border-primary/40 hover:bg-primary/5 active:bg-primary/5 transition-colors"
        onClick={onClick}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-heading font-bold text-sm">{title}</p>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function ViewWrapper({ viewKey, children }) {
  return (
    <motion.div
      key={viewKey}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

function dispatchTitle(title) {
  window.dispatchEvent(new CustomEvent('flexyn-title', { detail: { title } }));
}

export default function CardioSection({ onBack }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const [view, setView] = useState({ name: 'home' });

  // Every view names itself in the header. Keying on `view.mode` alone left
  // the five mode-less utility views — Saved, Templates, Planned, Goals,
  // Devices — dispatching null, so they inherited the cardio HOME header and
  // sat under "Cardio / Track running, walking, and cycling" while showing a
  // list of saved sessions. `null` is reserved for the home view itself,
  // where Workout.jsx supplies that pair deliberately.
  useEffect(() => {
    const UTILITY_TITLES = {
      savedList: () => t('cardio.savedWorkouts'),
      templates: () => tFallback('cardio.nav.templates', 'Templates'),
      planned:   () => tFallback('cardio.nav.planned', 'Planned Sessions'),
      goals:     () => tFallback('cardio.nav.goals', 'Cardio Goals'),
      wearables: () => tFallback('cardio.nav.devices', 'Devices & Apps'),
    };
    const utility = UTILITY_TITLES[view.name];
    if (utility) dispatchTitle(utility());
    else if (view.mode === 'running') dispatchTitle(t('cardio.modes.running'));
    else if (view.mode === 'walking') dispatchTitle(t('cardio.modes.walking'));
    else if (view.mode === 'biking') dispatchTitle(t('cardio.modes.biking'));
    // Was a hardcoded English 'Swimming' — the key exists now (i18n-cardio.js)
    // and the other three modes beside it in the same 2x2 grid are translated.
    else if (view.mode === 'swimming') dispatchTitle(tFallback('cardio.modes.swimming', 'Swimming'));
    else dispatchTitle(null);
  }, [view.name, view.mode, t, tFallback]);

  useEffect(() => () => dispatchTitle(null), []);

  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });
  const [detailLog, setDetailLog] = useState(null);
  const [editingLog, setEditingLog] = useState(null);
  const [templateDefaults, setTemplateDefaults] = useState(null);
  const [recoverable, setRecoverable] = useState(null);

  const { data: lastLogs = [] } = useQuery({
    queryKey: ['cardioLogs', user?.email],
    queryFn: () => db.entities.CardioLog.filter(
      { created_by: user.email }, '-date', 1
    ),
    enabled: !!user?.email,
  });
  const lastLog = lastLogs[0] || null;

  useEffect(() => {
    const snap = readSnapshot(user?.id);
    if (snap && Date.now() - snap.savedAt < 12 * 60 * 60 * 1000) {
      setRecoverable(snap);
    } else if (snap) {
      clearSnapshot(user?.id);
    }
  }, []);

  const goBack = () => {
    switch (view.name) {
      case 'home':        return onBack();
      case 'mode':        return setView({ name: 'home' });
      case 'inputType':   return setView({ name: 'mode', mode: view.mode });
      case 'manualEntry': return setView({ name: 'inputType', mode: view.mode, env: view.env });
      case 'liveTracker': return setView({ name: 'inputType', mode: view.mode, env: view.env });
      case 'savedList':   return setView({ name: 'home' });
      case 'templates':   return setView({ name: 'home' });
      case 'planned':     return setView({ name: 'home' });
      case 'wearables':   return setView({ name: 'home' });
      case 'goals':       return setView({ name: 'home' });
      default:            return setView({ name: 'home' });
    }
  };

  // Apply a template: parse mode/env from type, route to manual form
  const handleApplyTemplate = (tpl) => {
    const [mode, env] = tpl.type.split('_');
    setTemplateDefaults(tpl);
    setEditingLog(null);
    setView({ name: 'manualEntry', mode, env });
  };

  const viewKey = view.name + (view.mode || '') + (view.env || '');

  const renderView = () => {
    // ── HOME ──────────────────────────────────────────────────────────────
    if (view.name === 'home') {
      return (
        <ViewWrapper viewKey={viewKey}>
          <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
            {t('cardio.back')}
          </Button>
          <motion.div
            className="space-y-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Repeat last */}
            {lastLog && (
              <motion.div variants={itemVariants} whileHover={{ scale: 1.03, y: -3 }}
                          whileTap={{ scale: 0.96 }}
                          transition={{ type: 'spring', stiffness: 380, damping: 20 }}>
                <Card className="p-5 cursor-pointer bg-primary/5 border-primary/30"
                      onClick={() => {
                        const [mode, env] = lastLog.type.split('_');
                        setView({ name: 'liveTracker', mode, env });
                      }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                      <RotateCcw className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold text-sm">{t('cardio.repeatLast.title')}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {cardioTypeLabel(lastLog.type, tFallback)} · {formatDistance(lastLog.distance_meters, distanceUnit, 2)}
                      </p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}

            {/* Activity types — 2×2 grid.
                Each description names what THAT activity logs. All three
                of these used to pass t('cardio.subtitle'), so Running,
                Walking and Biking carried one identical line — the same
                line as the page subtitle a few hundred points above. See
                the note beside these keys in i18n-cardio.js for why they
                are English-only. */}
            <div className="grid grid-cols-2 gap-3">
              <NavTile
                icon={Footprints}
                title={t('cardio.modes.running')}
                description={tFallback('cardio.modes.running.desc', 'Pace, splits, and elevation')}
                onClick={() => setView({ name: 'mode', mode: 'running' })}
              />
              <NavTile
                icon={PersonStanding}
                title={t('cardio.modes.walking')}
                description={tFallback('cardio.modes.walking.desc', 'Distance, pace, and elevation')}
                onClick={() => setView({ name: 'mode', mode: 'walking' })}
              />
              <NavTile
                icon={Bike}
                title={t('cardio.modes.biking')}
                description={tFallback('cardio.modes.biking.desc', 'Speed, power, and distance')}
                onClick={() => setView({ name: 'mode', mode: 'biking' })}
              />
              <NavTile
                icon={Waves}
                title={tFallback('cardio.modes.swimming', 'Swimming')}
                description={tFallback('cardio.modes.swimming.desc', 'Pool or open water')}
                onClick={() => setView({ name: 'mode', mode: 'swimming' })}
              />
            </div>

            {/* Utilities */}
            <NavTile
              icon={BookOpen}
              title={t('cardio.savedWorkouts')}
              description={t('cardio.savedWorkoutsDesc')}
              onClick={() => setView({ name: 'savedList' })}
            />
            <NavTile
              icon={BookmarkPlus}
              title={tFallback('cardio.nav.templates', 'Templates')}
              description={tFallback('cardio.nav.templates.desc', 'Quick-start saved configurations')}
              onClick={() => setView({ name: 'templates' })}
            />
            <NavTile
              icon={CalendarDays}
              title={tFallback('cardio.nav.planned', 'Planned Sessions')}
              description={tFallback('cardio.nav.planned.desc', 'Schedule upcoming workouts')}
              onClick={() => setView({ name: 'planned' })}
            />
            <NavTile
              icon={Target}
              title={tFallback('cardio.nav.goals', 'Cardio Goals')}
              description={tFallback('cardio.nav.goals.desc', 'Weekly & monthly distance targets')}
              onClick={() => setView({ name: 'goals' })}
            />
            <NavTile
              icon={Watch}
              title={tFallback('cardio.nav.devices', 'Devices & Apps')}
              description={tFallback('cardio.nav.devices.desc', 'Apple Watch, Garmin, Fitbit…')}
              onClick={() => setView({ name: 'wearables' })}
            />
          </motion.div>
        </ViewWrapper>
      );
    }

    // ── MODE (environment picker) ─────────────────────────────────────────
    if (view.name === 'mode') {
      const isSwimming = view.mode === 'swimming';
      const isBiking = view.mode === 'biking';

      const questionKey =
        view.mode === 'running'   ? 'cardio.howAreYouRunning' :
        view.mode === 'walking'   ? 'cardio.howAreYouWalking' :
        view.mode === 'swimming'  ? 'cardio.howAreYouRunning' :  // reuse — "Where are you swimming?"
        'cardio.howAreYouBiking';

      return (
        <ViewWrapper viewKey={viewKey}>
          <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
            {t('cardio.back')}
          </Button>
          <h2 className="font-heading text-xl font-bold mb-4">
            {isSwimming ? tFallback('cardio.swim.whereQuestion', 'Where are you swimming?') : t(questionKey)}
          </h2>
          <motion.div
            className="space-y-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {isSwimming ? (
              <>
                <NavTile
                  icon={Waves}
                  title={tFallback('cardio.swim.pool', 'Pool')}
                  description={tFallback('cardio.swim.pool.desc', 'Lap pool, 25 m or 50 m')}
                  onClick={() => setView({ name: 'inputType', mode: 'swimming', env: 'pool' })}
                />
                <NavTile
                  icon={Trees}
                  title={tFallback('cardio.swim.openWater', 'Open Water')}
                  description={tFallback('cardio.swim.openWater.desc', 'Lake, ocean, river')}
                  onClick={() => setView({ name: 'inputType', mode: 'swimming', env: 'openwater' })}
                />
              </>
            ) : isBiking ? (
              <>
                <NavTile
                  icon={Trees}
                  title={t('cardio.env.outside')}
                  description={t('cardio.env.outsideDesc')}
                  onClick={() => setView({ name: 'inputType', mode: view.mode, env: 'outside' })}
                />
                <NavTile
                  icon={Activity}
                  title={t('cardio.env.stationary')}
                  description={t('cardio.env.stationaryDesc')}
                  onClick={() => setView({ name: 'inputType', mode: view.mode, env: 'stationary' })}
                />
              </>
            ) : (
              <>
                <NavTile
                  icon={Trees}
                  title={t('cardio.env.outside')}
                  description={t('cardio.env.outsideDesc')}
                  onClick={() => setView({ name: 'inputType', mode: view.mode, env: 'outside' })}
                />
                <NavTile
                  icon={Activity}
                  title={t('cardio.env.treadmill')}
                  description={t('cardio.env.treadmillDesc')}
                  onClick={() => setView({ name: 'inputType', mode: view.mode, env: 'treadmill' })}
                />
              </>
            )}
          </motion.div>
        </ViewWrapper>
      );
    }

    // ── INPUT TYPE ────────────────────────────────────────────────────────
    if (view.name === 'inputType') {
      const isSwimming = view.mode === 'swimming';
      return (
        <ViewWrapper viewKey={viewKey}>
          <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
            {t('cardio.back')}
          </Button>
          <h2 className="font-heading text-xl font-bold mb-4">{t('cardio.input.title')}</h2>
          <motion.div
            className="space-y-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <NavTile
              icon={Pencil}
              title={t('cardio.input.manual')}
              description={t('cardio.input.manualDesc')}
              onClick={() => setView({ name: 'manualEntry', mode: view.mode, env: view.env })}
            />
            {/* Live tracking not available for swim */}
            {!isSwimming && (
              <NavTile
                icon={Radio}
                title={t('cardio.input.live')}
                description={t('cardio.input.liveDesc')}
                onClick={() => setView({ name: 'liveTracker', mode: view.mode, env: view.env })}
              />
            )}
          </motion.div>
        </ViewWrapper>
      );
    }

    // ── MANUAL ENTRY ─────────────────────────────────────────────────────
    if (view.name === 'manualEntry') {
      return (
        <ViewWrapper viewKey={viewKey}>
          <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
            {t('cardio.back')}
          </Button>
          <CardioManualForm
            mode={view.mode}
            env={view.env}
            initial={editingLog}
            templateDefaults={templateDefaults}
            onCancel={() => { setEditingLog(null); setTemplateDefaults(null); goBack(); }}
            onSaved={() => { setEditingLog(null); setTemplateDefaults(null); setView({ name: 'savedList' }); }}
            userProfile={userProfile}
          />
        </ViewWrapper>
      );
    }

    // ── LIVE TRACKER ──────────────────────────────────────────────────────
    if (view.name === 'liveTracker') {
      if (view.env === 'outside') {
        return (
          <ViewWrapper viewKey={viewKey}>
            <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
              {t('cardio.back')}
            </Button>
            <CardioLiveTrackerOutside
              mode={view.mode}
              onCancel={() => setView({ name: 'home' })}
              onSaved={() => setView({ name: 'savedList' })}
              userProfile={userProfile}
            />
          </ViewWrapper>
        );
      }
      return (
        <ViewWrapper viewKey={viewKey}>
          <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
            {t('cardio.back')}
          </Button>
          <CardioLiveTrackerIndoor
            mode={view.mode}
            env={view.env}
            onCancel={() => setView({ name: 'home' })}
            onSaved={() => setView({ name: 'savedList' })}
            userProfile={userProfile}
          />
        </ViewWrapper>
      );
    }

    // ── SAVED LIST ────────────────────────────────────────────────────────
    if (view.name === 'savedList') {
      return (
        <ViewWrapper viewKey={viewKey}>
          <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
            {t('cardio.back')}
          </Button>
          <CardioSavedList onSelectLog={(log) => setDetailLog(log)} />
          <CardioDetailModal
            log={detailLog}
            open={!!detailLog}
            onOpenChange={(o) => { if (!o) setDetailLog(null); }}
            onEdit={(log) => {
              setDetailLog(null);
              setEditingLog(log);
              setTemplateDefaults(null);
              const [mode, env] = log.type.split('_');
              setView({ name: 'manualEntry', mode, env });
            }}
          />
        </ViewWrapper>
      );
    }

    // ── TEMPLATES ─────────────────────────────────────────────────────────
    if (view.name === 'templates') {
      return (
        <ViewWrapper viewKey={viewKey}>
          <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
            {t('cardio.back')}
          </Button>
          <p className="text-sm text-muted-foreground mb-4">
            Tap a template to start a session with its defaults pre-filled.
          </p>
          <CardioTemplates onApply={handleApplyTemplate} />
        </ViewWrapper>
      );
    }

    // ── PLANNED ───────────────────────────────────────────────────────────
    if (view.name === 'planned') {
      return (
        <ViewWrapper viewKey={viewKey}>
          <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
            {t('cardio.back')}
          </Button>
          <CardioPlanned />
        </ViewWrapper>
      );
    }

    // ── GOALS ─────────────────────────────────────────────────────────────
    if (view.name === 'goals') {
      return (
        <ViewWrapper viewKey={viewKey}>
          <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
            {t('cardio.back')}
          </Button>
          <CardioGoals />
        </ViewWrapper>
      );
    }

    // ── WEARABLES ─────────────────────────────────────────────────────────
    if (view.name === 'wearables') {
      return (
        <ViewWrapper viewKey={viewKey}>
          <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
            {t('cardio.back')}
          </Button>
          <p className="text-sm text-muted-foreground mb-4">
            Connect your wearables to auto-sync workouts and health data.
          </p>
          <CardioWearableStub />
        </ViewWrapper>
      );
    }

    return null;
  };

  return (
    <div>
      <AlertDialog open={!!recoverable} onOpenChange={(o) => { if (!o) setRecoverable(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cardio.recover.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cardio.recover.desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { clearSnapshot(user?.id); setRecoverable(null); }}>
              {t('cardio.recover.discard')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const snap = recoverable;
              setRecoverable(null);
              setView({
                name: 'liveTracker',
                mode: snap.mode,
                env: snap.kind === 'outside' ? 'outside' : (snap.env || 'treadmill'),
              });
            }}>
              {t('cardio.recover.recover')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AnimatePresence mode="wait">
        {renderView()}
      </AnimatePresence>
    </div>
  );
}
