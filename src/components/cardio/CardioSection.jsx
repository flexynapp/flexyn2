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
  Trees, Activity, Pencil, Radio, RotateCcw, Play,
  Waves, CalendarDays, BookmarkPlus,
} from 'lucide-react';
import CardioManualForm from './CardioManualForm';
import CardioSavedList from './CardioSavedList';
import CardioDetailModal from './CardioDetailModal';
import CardioLiveTrackerOutside from './CardioLiveTrackerOutside';
import CardioLiveTrackerIndoor from './CardioLiveTrackerIndoor';
import CardioTemplates from './CardioTemplates';
import CardioPlanned from './CardioPlanned';
import StartSessionSheet from './StartSessionSheet';
import { readSnapshot, clearSnapshot } from '@/lib/cardioSession';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { cardioLogsKey } from '@/lib/data/cardioKeys';
import * as cardioData from '@/lib/data/cardio';

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
//   icon:       w-10 h-10 rounded-xl border border-border
//
// The icon square is PLAIN, and that needs saying because the Workout
// grid's source used to claim otherwise. Its tiles said `bg-primary/18
// border border-primary/28`, and neither class emits any CSS — Tailwind v3
// resolves a slash modifier against `theme.opacity`, which has no 18 and no
// 28, so an off-scale value produces no rule rather than failing. What that
// grid RENDERED was a plain square; what it SAID was a faint orange one.
// Plain is the look kegan approved (2026-08-11), and Workout.jsx now writes
// it out literally, so these tiles match it. Copying the old source instead
// is how this tile spent its first night orange beside a grid that wasn't.
//
// Plain HERE was confirmed separately (kegan, 2026-08-11), so this is not
// inherited from that grid by inference — don't re-tint it on the reasoning
// that only the Workout page was ever reviewed.
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
          <div className="w-10 h-10 rounded-xl border border-border flex items-center justify-center shrink-0">
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

export default function CardioSection({ onBack, deepLink = null, onDeepLinkConsumed }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const [view, setView] = useState({ name: 'home' });

  // A scheduled-cardio reminder deep-links to /workout?scheduled=<id>, and
  // Workout.jsx hands the payload's { mode, env } down here. Jump straight
  // to the input-type screen for that activity: the user answered "what"
  // and "where" when they scheduled it, so asking again is asking twice.
  //
  // Not `inputType` for swimming — that screen offers Manual and Live, and
  // swim has no live tracker, so it would be a question with one answer.
  useEffect(() => {
    if (!deepLink?.mode || !deepLink?.env) return;
    setView(
      deepLink.mode === 'swimming'
        ? { name: 'manualEntry', mode: deepLink.mode, env: deepLink.env }
        : { name: 'inputType', mode: deepLink.mode, env: deepLink.env }
    );
    // Consume it so backing out to the home view and re-rendering does not
    // bounce the user forward into the tracker again.
    onDeepLinkConsumed?.();
  }, [deepLink, onDeepLinkConsumed]);

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
    };
    const utility = UTILITY_TITLES[view.name];
    if (utility) dispatchTitle(utility());
    else if (view.mode === 'running') dispatchTitle(t('cardio.modes.running'));
    else if (view.mode === 'walking') dispatchTitle(t('cardio.modes.walking'));
    else if (view.mode === 'biking') dispatchTitle(t('cardio.modes.biking'));
    // Was a hardcoded English 'Swimming' — the key exists now (`src/locales/*.json`)
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
  const [startOpen, setStartOpen] = useState(false);

  const { data: lastLogs = [] } = useQuery({
    queryKey: cardioLogsKey(user?.email, 'lastLog'),
    queryFn: () => cardioData.list(user.id, 1),
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

            {/* ── The hero ─────────────────────────────────────────
                One dominant element, per the composition rules, and the
                only full-bleed primary on the screen.

                It replaces a 2x2 grid of four activity tiles that each led
                to the SAME two follow-up screens — the grid was a menu of
                routes into one corridor. The subtext still names all four
                activities, so nothing is hidden; the choice just moved
                into the sheet, alongside the other two questions.
                (kegan, 2026-08-11.) */}
            <motion.div variants={itemVariants} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 22 }}>
              <button
                type="button"
                onClick={() => setStartOpen(true)}
                className="w-full text-start rounded-2xl bg-primary text-primary-foreground p-6 relative overflow-hidden"
              >
                <span className="absolute top-5 end-5 w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                  <Play className="w-7 h-7 ms-1" />
                </span>
                <span className="kicker block">
                  {tFallback('cardio.start.kickerShort', 'Start')}
                </span>
                <span className="block font-heading font-extrabold text-3xl mt-1 pe-20">
                  {tFallback('cardio.start.hero', 'Start Session')}
                </span>
                <span className="block text-sm mt-2 opacity-90 pe-20">
                  {tFallback('cardio.start.heroSub', 'Running, Walking, Biking, or Swimming')}
                </span>
              </button>
            </motion.div>

            {/* What is left. Saved Workouts, Cardio Goals and Devices &
                Apps came off this screen because each already has a home:
                Workout ▸ All Workouts has a Cardio tab, the Goals form
                writes cardio_distance / _duration / _sessions, and
                Settings ▸ Account has Connected apps. Templates and
                Planned Sessions stay — nothing else hosts them. */}
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
            {tFallback('cardioSection.templateHint', 'Tap a template to start a session with its defaults pre-filled.')}
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

      <StartSessionSheet
        open={startOpen}
        onClose={() => setStartOpen(false)}
        lastLog={lastLog}
        onStart={({ mode, env, how }) => {
          setStartOpen(false);
          setEditingLog(null);
          setTemplateDefaults(null);
          setView({ name: how === 'live' ? 'liveTracker' : 'manualEntry', mode, env });
        }}
      />

      <AnimatePresence mode="wait">
        {renderView()}
      </AnimatePresence>
    </div>
  );
}
