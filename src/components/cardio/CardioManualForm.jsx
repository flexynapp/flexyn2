import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Save, Calculator } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { base44 } from '@/api/base44Client';
import { toMeters, metersTo, formatPace, speedKmhFrom, paceSecPerKmFrom } from '@/lib/distanceUnit';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { estimateCalories, userWeightKg } from '@/lib/cardioCalories';
import { checkCardioSpeed, getMaxRealisticCalories } from '@/lib/cardioLimits';
import { detectNewPRs, PR_LABELS } from '@/lib/cardioPRs';
import { useProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';

function deriveType(mode, env) {
  return `${mode}_${env}`;
}

export default function CardioManualForm({ mode, env, initial, onCancel, onSaved, userProfile = {} }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const queryClient = useQueryClient();

  const [date, setDate] = useState(initial?.date || format(new Date(), 'yyyy-MM-dd'));
  const [hours, setHours] = useState(initial ? Math.floor(initial.duration_seconds / 3600) : '');
  const [minutes, setMinutes] = useState(initial ? Math.floor((initial.duration_seconds % 3600) / 60) : '');
  const [seconds, setSeconds] = useState(initial ? initial.duration_seconds % 60 : '');
  const [distance, setDistance] = useState(initial
    ? metersTo(distanceUnit, initial.distance_meters).toFixed(2) : '');
  const [incline, setIncline] = useState(initial?.incline_percent ?? '');
  const [elevation, setElevation] = useState(initial?.elevation_gain_m
    ? (distanceUnit === 'mi'
        ? (initial.elevation_gain_m / 0.3048).toFixed(0)
        : initial.elevation_gain_m.toFixed(0))
    : '');
  const [calories, setCalories] = useState(initial?.calories ?? '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const notesGuard = useProfanityGuard(setNotes);
  const [saving, setSaving] = useState(false);
  const [speedWarning, setSpeedWarning] = useState(null);

  const durationSeconds = useMemo(
    () => (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0),
    [hours, minutes, seconds]
  );
  const distanceMeters = useMemo(
    () => toMeters(distanceUnit, Number(distance) || 0),
    [distance, distanceUnit]
  );
  const paceSecPerKm = useMemo(
    () => paceSecPerKmFrom(distanceMeters, durationSeconds),
    [distanceMeters, durationSeconds]
  );
  const speedKmh = useMemo(
    () => speedKmhFrom(distanceMeters, durationSeconds),
    [distanceMeters, durationSeconds]
  );

  const showIncline = env === 'treadmill';
  const showElevation = env === 'outside' && mode !== 'biking';
  const elevationSuffix = distanceUnit === 'mi' ? 'ft' : 'm';

  const canSave = useMemo(() => {
    if (durationSeconds <= 0) return false;
    const type = deriveType(mode, env);
    if (type === 'walking_treadmill') {
      if (distanceMeters <= 0 && !(Number(calories) > 0)) return false;
    } else {
      if (distanceMeters <= 0) return false;
    }
    const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    if (date < sevenDaysAgo) return false;
    return true;
  }, [durationSeconds, distanceMeters, calories, date, mode, env]);

  const handleEstimate = () => {
    const est = estimateCalories({
      type: deriveType(mode, env),
      durationSeconds,
      distanceMeters,
      inclinePercent: Number(incline) || 0,
      weightKg: userWeightKg(user),
    });
    setCalories(est);
  };

  const handleSave = async () => {
    if (hasAnyProfanity(notes)) {
      toast.error('Please remove inappropriate language from notes before saving.');
      return;
    }
    setSaving(true);
    try {
      const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
      if (date < sevenDaysAgo) {
        toast.error(t('cardio.error.dateInPast'));
        setSaving(false);
        return;
      }

      // ── Speed plausibility check ──
      const cardioType = deriveType(mode, env);
      const speedCheck = checkCardioSpeed(cardioType, distanceMeters, durationSeconds);
      if (speedCheck.implausible) {
        setSpeedWarning(speedCheck);
        setSaving(false);
        return;
      }

      // ── Calorie plausibility check ──
      const maxCal = getMaxRealisticCalories(durationSeconds, userProfile);
      if (Number(calories) > maxCal) {
        toast.error(
          `That calorie count (${Math.round(Number(calories))} kcal) seems too high for a ${
            Math.round(durationSeconds / 60)
          }-minute session. Maximum realistic is ${maxCal} kcal.`
        );
        setSaving(false);
        return;
      }

      const cappedDuration = Math.min(durationSeconds, 12 * 3600);
      const cappedDistance = Math.min(distanceMeters, 160934);
      const cappedCalories = Math.min(Number(calories) || 0, getMaxRealisticCalories(cappedDuration, userProfile));

      const payload = {
        date,
        type: deriveType(mode, env),
        mode: 'manual',
        duration_seconds: cappedDuration,
        distance_meters: cappedDistance,
        pace_seconds_per_km: paceSecPerKmFrom(cappedDistance, cappedDuration),
        avg_speed_kmh: speedKmhFrom(cappedDistance, cappedDuration),
        calories: cappedCalories,
        incline_percent: env === 'treadmill' ? (Number(incline) || 0) : null,
        elevation_gain_m: (env === 'outside' && mode !== 'biking' && elevation)
          ? (distanceUnit === 'mi' ? Number(elevation) * 0.3048 : Number(elevation))
          : null,
        notes: notes || null,
        gps_track: null,
      };

      let prCount = 0;
      if (initial?.id) {
        await base44.entities.CardioLog.update(initial.id, payload);
      } else {
        const createdLog = await base44.entities.CardioLog.create(payload);
        // Denormalise total distance on the User record for the distance leaderboard.
        if (Number(payload.distance_meters) > 0) {
          try {
            const me = await base44.auth.me();
            const prev = Number(me?.total_distance_meters) || 0;
            await base44.auth.updateMe({ total_distance_meters: prev + Number(payload.distance_meters) });
          } catch { /* non-blocking */ }
        }
        // Fire achievement check (non-blocking)
        base44.functions.invoke('updateUserXpAndAchievements', {
          xp_gained: 0,
          action_type: 'cardio_completed',
          action_data: {
            duration_seconds: payload.duration_seconds,
            distance_meters: payload.distance_meters,
            calories: payload.calories,
          },
        }).catch(() => {});
        // Check for PRs
        const prior = await base44.entities.CardioLog.filter(
          { created_by: user.email }, '-date', 1000
        );
        const priorOnly = prior.filter(l => l.id !== createdLog.id);
        const prs = detectNewPRs(createdLog, priorOnly);
        prCount = prs.length;
        for (const pr of prs) {
          const label = PR_LABELS[pr.distance];
          toast.success(t('cardio.pr.title').replace('{label}', label), {
            duration: 6000,
          });
          try { navigator.vibrate?.([100, 60, 100]); } catch {}
        }
      }

      queryClient.invalidateQueries({ queryKey: ['cardioLogs', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      toast.success(t('cardio.saved'));

      // Quest progress — non-blocking
      const durSec = Number(payload.duration_seconds) || 0;
      Promise.all([
        quests.recordAction(user, ACTION_TYPES.CARDIO_COMPLETED, 1),
        durSec > 0 ? quests.recordAction(user, ACTION_TYPES.CARDIO_SECONDS, durSec) : null,
        prCount > 0 ? quests.recordAction(user, ACTION_TYPES.PR_ACHIEVED, prCount) : null,
      ].filter(Boolean))
        .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
        .catch(() => {});

      onSaved();
    } catch (err) {
      console.error(err);
      toast.error(t('cardio.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const blockSpecialKeys = (e) => {
    if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <Card className="p-5 space-y-5">
        {/* Title */}
        <h2 className="font-heading text-xl font-bold">
          {t(`cardio.type.${deriveType(mode, env)}`)}
        </h2>

        {/* Date */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.date')}</label>
          <Input
            type="date"
            value={date}
            max={format(new Date(), 'yyyy-MM-dd')}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        {/* Duration */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.duration')}</label>
          <div className="flex gap-2">
            {[
              { value: hours,   set: setHours,   label: t('cardio.field.hours'),   max: 23 },
              { value: minutes, set: setMinutes, label: t('cardio.field.minutes'), max: 59 },
              { value: seconds, set: setSeconds, label: t('cardio.field.seconds'), max: 59 },
            ].map(({ value, set, label, max }) => (
              <div key={label} className="flex-1 text-center">
                <Input
                  type="number"
                  min={0}
                  max={max}
                  inputMode="numeric"
                  value={value}
                  onChange={e => set(e.target.value === '' ? '' : Math.min(max, Math.max(0, parseInt(e.target.value) || 0)))}
                  onKeyDown={blockSpecialKeys}
                  className="text-center"
                  placeholder="0"
                />
                <span className="text-xs text-muted-foreground mt-1 block">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Distance */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.distance')}</label>
          <div className="relative">
            <Input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              value={distance}
              onChange={e => setDistance(e.target.value)}
              onKeyDown={blockSpecialKeys}
              className="pr-12"
              placeholder="0.00"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
              {distanceUnit}
            </span>
          </div>
        </div>

        {/* Incline (treadmill only) */}
        {showIncline && (
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.incline')}</label>
            <div className="relative">
              <Input
                type="number"
                step="0.5"
                min={0}
                max={15}
                inputMode="decimal"
                value={incline}
                onChange={e => setIncline(e.target.value)}
                onKeyDown={blockSpecialKeys}
                className="pr-8"
                placeholder="0"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </div>
        )}

        {/* Elevation (outside non-biking only) */}
        {showElevation && (
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.elevation')}</label>
            <div className="relative">
              <Input
                type="number"
                step={1}
                min={0}
                inputMode="numeric"
                value={elevation}
                onChange={e => setElevation(e.target.value)}
                onKeyDown={blockSpecialKeys}
                className="pr-10"
                placeholder="0"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {elevationSuffix}
              </span>
            </div>
          </div>
        )}

        {/* Calories */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.calories')}</label>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={calories}
                  onChange={e => setCalories(e.target.value)}
                  onKeyDown={blockSpecialKeys}
                  className="pr-14"
                  placeholder="0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">kcal</span>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleEstimate} className="shrink-0">
              <Calculator className="w-3.5 h-3.5 mr-1" /> {t('cardio.field.estimate')}
            </Button>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.notes')}</label>
          <Textarea
            value={notes}
            onChange={e => notesGuard.handleChange(e.target.value)}
            placeholder={t('cardio.field.notesPlaceholder')}
            className="h-20"
          />
        </div>

        {/* Computed pace / speed */}
        {durationSeconds > 0 && distanceMeters > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t('cardio.field.avgPace')}: {formatPace(paceSecPerKm, distanceUnit)}</span>
            <span>
              {t('cardio.field.avgSpeed')}: {(distanceUnit === 'mi' ? speedKmh / 1.609344 : speedKmh).toFixed(1)}{' '}
              {distanceUnit === 'mi' ? 'mph' : 'km/h'}
            </span>
          </div>
        )}

        {/* Save */}
        <motion.div whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.01 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
          <Button
            className="w-full h-12 font-heading font-bold text-base"
            onClick={handleSave}
            disabled={!canSave || saving}
          >
            <Save className="w-5 h-5 mr-2" />
            {saving ? t('cardio.saving') : t('cardio.save')}
          </Button>
        </motion.div>
      </Card>
      {speedWarning && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSpeedWarning(null)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center z-10">
            <div className="text-4xl mb-3">⚡</div>
            <h2 className="font-heading font-bold text-xl mb-2">That speed isn't realistic</h2>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              Your entry works out to <strong>{speedWarning.speedKmh} km/h</strong>, which exceeds the
              realistic maximum for this activity type ({speedWarning.maxKmh} km/h). Please check your
              distance and time.
            </p>
            <button
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold"
              onClick={() => setSpeedWarning(null)}
            >
              Go back and fix
            </button>
          </div>
        </div>
      )}
      <ProfanityWarningDialog open={notesGuard.open} onContinue={notesGuard.onContinue} />
    </motion.div>
  );
}