import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/LanguageContext';
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

function NavTile({ icon: Icon, iconBg = 'bg-primary/10', iconColor = 'text-primary', title, description, onClick }) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ scale: 1.03, y: -3 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 20 }}
    >
      <Card
        className="p-5 border-dashed cursor-pointer hover:border-primary/50 hover:bg-primary/5 active:bg-primary/5 transition-colors"
        onClick={onClick}
      >
        <div className="flex items-center gap-3">
          <motion.div
            className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}
            whileHover={{ rotate: -8, scale: 1.15 }}
            transition={{ type: 'spring', stiffness: 400 }}
          >
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </motion.div>
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
  const { t } = useLanguage();
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const [view, setView] = useState({ name: 'home' });

  useEffect(() => {
    if (view.mode === 'running') dispatchTitle(t('cardio.modes.running'));
    else if (view.mode === 'walking') dispatchTitle(t('cardio.modes.walking'));
    else if (view.mode === 'biking') dispatchTitle(t('cardio.modes.biking'));
    else if (view.mode === 'swimming') dispatchTitle('Swimming');
    else dispatchTitle(null);
  }, [view.mode, t]);

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
    const snap = readSnapshot();
    if (snap && Date.now() - snap.savedAt < 12 * 60 * 60 * 1000) {
      setRecoverable(snap);
    } else if (snap) {
      clearSnapshot();
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
                        {t(`cardio.type.${lastLog.type}`)} · {formatDistance(lastLog.distance_meters, distanceUnit, 2)}
                      </p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}

            {/* Activity types — 2×2 grid */}
            <div className="grid grid-cols-2 gap-3">
              <NavTile
                icon={Footprints}
                iconBg="bg-primary/10"
                iconColor="text-primary"
                title={t('cardio.modes.running')}
                description={t('cardio.subtitle')}
                onClick={() => setView({ name: 'mode', mode: 'running' })}
              />
              <NavTile
                icon={PersonStanding}
                iconBg="bg-emerald-500/10"
                iconColor="text-emerald-500"
                title={t('cardio.modes.walking')}
                description={t('cardio.subtitle')}
                onClick={() => setView({ name: 'mode', mode: 'walking' })}
              />
              <NavTile
                icon={Bike}
                iconBg="bg-amber-500/10"
                iconColor="text-amber-500"
                title={t('cardio.modes.biking')}
                description={t('cardio.subtitle')}
                onClick={() => setView({ name: 'mode', mode: 'biking' })}
              />
              <NavTile
                icon={Waves}
                iconBg="bg-cyan-500/10"
                iconColor="text-cyan-500"
                title="Swimming"
                description="Pool or open water"
                onClick={() => setView({ name: 'mode', mode: 'swimming' })}
              />
            </div>

            {/* Utilities */}
            <NavTile
              icon={BookOpen}
              iconBg="bg-accent/10"
              iconColor="text-accent"
              title={t('cardio.savedWorkouts')}
              description={t('cardio.savedWorkoutsDesc')}
              onClick={() => setView({ name: 'savedList' })}
            />
            <NavTile
              icon={BookmarkPlus}
              iconBg="bg-violet-500/10"
              iconColor="text-violet-500"
              title="Templates"
              description="Quick-start saved configurations"
              onClick={() => setView({ name: 'templates' })}
            />
            <NavTile
              icon={CalendarDays}
              iconBg="bg-emerald-500/10"
              iconColor="text-emerald-500"
              title="Planned Sessions"
              description="Schedule upcoming workouts"
              onClick={() => setView({ name: 'planned' })}
            />
            <NavTile
              icon={Target}
              iconBg="bg-rose-500/10"
              iconColor="text-rose-500"
              title="Cardio Goals"
              description="Weekly & monthly distance targets"
              onClick={() => setView({ name: 'goals' })}
            />
            <NavTile
              icon={Watch}
              iconBg="bg-zinc-500/10"
              iconColor="text-zinc-500"
              title="Devices & Apps"
              description="Apple Watch, Garmin, Fitbit…"
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
            {isSwimming ? 'Where are you swimming?' : t(questionKey)}
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
                  iconBg="bg-cyan-500/10"
                  iconColor="text-cyan-500"
                  title="Pool"
                  description="Lap pool, 25 m or 50 m"
                  onClick={() => setView({ name: 'inputType', mode: 'swimming', env: 'pool' })}
                />
                <NavTile
                  icon={Trees}
                  iconBg="bg-blue-500/10"
                  iconColor="text-blue-500"
                  title="Open Water"
                  description="Lake, ocean, river"
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
          <h2 className="font-heading text-xl font-bold mb-4">My Templates</h2>
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
          <h2 className="font-heading text-xl font-bold mb-4">Planned Sessions</h2>
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
          <h2 className="font-heading text-xl font-bold mb-4">Cardio Goals</h2>
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
          <h2 className="font-heading text-xl font-bold mb-4">Devices & Apps</h2>
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
            <AlertDialogCancel onClick={() => { clearSnapshot(); setRecoverable(null); }}>
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
