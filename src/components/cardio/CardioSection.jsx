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
  Trees, Activity, Pencil, Radio, RotateCcw
} from 'lucide-react';
import CardioManualForm from './CardioManualForm';
import CardioSavedList from './CardioSavedList';
import CardioDetailModal from './CardioDetailModal';
import CardioLiveTrackerOutside from './CardioLiveTrackerOutside';
import CardioLiveTrackerIndoor from './CardioLiveTrackerIndoor';
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
        className="p-5 border-dashed cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
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

  // Keep the header title in sync with the current cardio mode
  useEffect(() => {
    if (view.mode === 'running') dispatchTitle(t('cardio.modes.running'));
    else if (view.mode === 'walking') dispatchTitle(t('cardio.modes.walking'));
    else if (view.mode === 'biking') dispatchTitle(t('cardio.modes.biking'));
    else dispatchTitle(null);
  }, [view.mode, t]);

  // Reset header title when cardio section unmounts
  useEffect(() => () => dispatchTitle(null), []);

  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });
  const [detailLog, setDetailLog] = useState(null);
  const [editingLog, setEditingLog] = useState(null);
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
      default:            return setView({ name: 'home' });
    }
  };

  const viewKey = view.name + (view.mode || '') + (view.env || '');

  const renderView = () => {
    // HOME
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
            <NavTile
              icon={Footprints}
              title={t('cardio.modes.running')}
              description={t('cardio.subtitle')}
              onClick={() => setView({ name: 'mode', mode: 'running' })}
            />
            <NavTile
              icon={PersonStanding}
              title={t('cardio.modes.walking')}
              description={t('cardio.subtitle')}
              onClick={() => setView({ name: 'mode', mode: 'walking' })}
            />
            <NavTile
              icon={Bike}
              title={t('cardio.modes.biking')}
              description={t('cardio.subtitle')}
              onClick={() => setView({ name: 'mode', mode: 'biking' })}
            />
            <NavTile
              icon={BookOpen}
              iconBg="bg-accent/10"
              iconColor="text-accent"
              title={t('cardio.savedWorkouts')}
              description={t('cardio.savedWorkoutsDesc')}
              onClick={() => setView({ name: 'savedList' })}
            />
          </motion.div>
        </ViewWrapper>
      );
    }

    // MODE (environment picker)
    if (view.name === 'mode') {
      const questionKey =
        view.mode === 'running' ? 'cardio.howAreYouRunning' :
        view.mode === 'walking' ? 'cardio.howAreYouWalking' :
        'cardio.howAreYouBiking';

      const isBiking = view.mode === 'biking';

      return (
        <ViewWrapper viewKey={viewKey}>
          <Button variant="outline" size="sm" onClick={goBack} className="mb-4">
            {t('cardio.back')}
          </Button>
          <h2 className="font-heading text-xl font-bold mb-4">{t(questionKey)}</h2>
          <motion.div
            className="space-y-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <NavTile
              icon={isBiking ? Bike : Trees}
              title={t('cardio.env.outside')}
              description={t('cardio.env.outsideDesc')}
              onClick={() => setView({ name: 'inputType', mode: view.mode, env: 'outside' })}
            />
            {isBiking ? (
              <NavTile
                icon={Activity}
                title={t('cardio.env.stationary')}
                description={t('cardio.env.stationaryDesc')}
                onClick={() => setView({ name: 'inputType', mode: view.mode, env: 'stationary' })}
              />
            ) : (
              <NavTile
                icon={Activity}
                title={t('cardio.env.treadmill')}
                description={t('cardio.env.treadmillDesc')}
                onClick={() => setView({ name: 'inputType', mode: view.mode, env: 'treadmill' })}
              />
            )}
          </motion.div>
        </ViewWrapper>
      );
    }

    // INPUT TYPE
    if (view.name === 'inputType') {
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
            <NavTile
              icon={Radio}
              title={t('cardio.input.live')}
              description={t('cardio.input.liveDesc')}
              onClick={() => setView({ name: 'liveTracker', mode: view.mode, env: view.env })}
            />
          </motion.div>
        </ViewWrapper>
      );
    }

    // MANUAL ENTRY
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
            onCancel={() => { setEditingLog(null); goBack(); }}
            onSaved={() => { setEditingLog(null); setView({ name: 'savedList' }); }}
            userProfile={userProfile}
          />
        </ViewWrapper>
      );
    }

    // LIVE TRACKER
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
      // Indoor (treadmill / stationary)
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

    // SAVED LIST
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
              const [mode, env] = log.type.split('_');
              setView({ name: 'manualEntry', mode, env });
            }}
          />
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