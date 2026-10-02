// src/components/cardio/StartSessionSheet.jsx
//
// "Start Session" — the whole cardio picker on one surface.
//
// It replaces a corridor: the 2×2 activity grid, then "How are you
// running?" on its own screen, then "How do you want to log it?" on
// another, then a tracker idle screen with a Start button. Four screens
// asking four questions, each with two options, before a clock moved.
//
// Three rows of pills and a button. Same four questions, and three of them
// are answered before you look because the sheet opens pre-filled from
// your last session — so the common case is hero → Start.
//
// Built on SheetShell, the chrome behind Daily Quests, Readiness, Advanced
// Analytics and Personal Bests. That file's header asks for a fifth sheet
// to use it rather than copy it; this is the fifth. Grab handle,
// swipe-dismiss, Escape, scroll lock and safe-area insets all come with it.
//
// ── Where the labels come from ─────────────────────────────────────────
// kegan chose per-activity words (2026-08-11) over one universal
// Outside/Inside pair. The two POSITIONS never move — outdoor on the left,
// indoor on the right — so the row keeps its shape; only the words change,
// and they change to the ones people actually use. "Stationary" is what a
// bike is, and a swimmer says open water and pool, not outside and inside.
//
// The label is display only. What gets STORED is the env half of
// `cardio_logs.type`, which is a fixed vocabulary the trackers route on:
// outside / treadmill / stationary / pool / openwater.

import React, { useState, useEffect, useMemo } from 'react';
import { Footprints, PersonStanding, Bike, Waves } from 'lucide-react';
import SheetShell from '@/components/sheets/SheetShell';
import { useLanguage } from '@/lib/LanguageContext';

// Each activity: what it stores, what it is called, and its two environments.
// `env` is the persisted value; `label` is what the pill says.
export const ACTIVITIES = [
  { mode: 'running', labelKey: 'cardio.modes.running', label: 'Running', Icon: Footprints,
    where: [{ env: 'outside', labelKey: 'cardio.env.outside', label: 'Outside' },
            { env: 'treadmill', labelKey: 'cardio.env.treadmill', label: 'Treadmill' }] },
  { mode: 'walking', labelKey: 'cardio.modes.walking', label: 'Walking', Icon: PersonStanding,
    where: [{ env: 'outside', labelKey: 'cardio.env.outside', label: 'Outside' },
            { env: 'treadmill', labelKey: 'cardio.env.treadmill', label: 'Treadmill' }] },
  { mode: 'biking', labelKey: 'cardio.modes.biking', label: 'Biking', Icon: Bike,
    where: [{ env: 'outside', labelKey: 'cardio.env.outside', label: 'Outside' },
            { env: 'stationary', labelKey: 'cardio.env.stationary', label: 'Stationary' }] },
  // Swim's keys are the English-only block in `src/locales/*.json` — the whole
  // swimming set is untranslated together, deliberately.
  { mode: 'swimming', labelKey: 'cardio.modes.swimming', label: 'Swimming', Icon: Waves,
    where: [{ env: 'openwater', labelKey: 'cardio.swim.openWater', label: 'Open Water' },
            { env: 'pool', labelKey: 'cardio.swim.pool', label: 'Pool' }] },
];

export const activityFor = (mode) => ACTIVITIES.find(a => a.mode === mode) || ACTIVITIES[0];

/** Live tracking needs GPS or a treadmill readout. A pool has neither. */
export const supportsLive = (mode) => mode !== 'swimming';

function Pill({ selected, disabled, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={[
        'flex-1 rounded-xl border font-heading font-bold transition-colors',
        // 48px floor — the Apple HIG minimum, and these are the primary
        // targets on the sheet.
        'min-h-[48px] px-2 py-2 text-sm',
        selected
          ? 'bg-primary/20 border-primary text-primary'
          : disabled
            ? 'bg-card border-border/40 text-muted-foreground/40'
            : 'bg-card border-border/60 text-foreground hover:border-primary/40 active:border-primary/40',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Row({ label, dim, children }) {
  return (
    <div className={dim ? 'opacity-40 pointer-events-none' : ''}>
      <p className="eyebrow mb-1.5">
        {label}
      </p>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

/**
 * @param {object}  props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {object}  [props.lastLog]  the most recent cardio_logs row, used to
 *   pre-fill. `type` is `<mode>_<env>`.
 * @param {Function} props.onStart   ({ mode, env, how }) => void, where
 *   `how` is 'live' | 'manual'.
 */
export default function StartSessionSheet({ open, onClose, lastLog, onStart }) {
  const { t, tFallback } = useLanguage();

  // Pre-fill from the last session. This is what turns the common case into
  // two taps — and it costs nothing for someone who wants something else,
  // because every pill is still one tap away.
  const preset = useMemo(() => {
    const [m, e] = String(lastLog?.type || '').split('_');
    const activity = ACTIVITIES.find(a => a.mode === m);
    const env = activity?.where.find(w => w.env === e)?.env;
    return { mode: activity?.mode || null, env: env || null };
  }, [lastLog?.type]);

  const [mode, setMode] = useState(preset.mode);
  const [env, setEnv] = useState(preset.env);
  const [how, setHow] = useState(preset.mode ? (supportsLive(preset.mode) ? 'live' : 'manual') : null);

  // Re-seed when the sheet reopens: the last session may have changed since
  // it was last open, and a stale pre-fill is worse than none.
  useEffect(() => {
    if (!open) return;
    setMode(preset.mode);
    setEnv(preset.env);
    setHow(preset.mode ? (supportsLive(preset.mode) ? 'live' : 'manual') : null);
  }, [open, preset.mode, preset.env]);

  const activity = mode ? activityFor(mode) : null;
  const liveOk = mode ? supportsLive(mode) : true;

  const pickMode = (next) => {
    setMode(next);
    // The env vocabulary is per-activity, so a carried-over value can be
    // nonsense — 'treadmill' means nothing to a swim. Default to the
    // OUTDOOR option, which is the first and the common answer.
    setEnv(activityFor(next).where[0].env);
    // Swim has no live tracker, so a selection of 'live' cannot survive
    // switching to it.
    setHow(supportsLive(next) ? (how || 'live') : 'manual');
  };

  const ready = !!mode && !!env && !!how;
  const ctaLabel = ready
    ? (how === 'live'
        ? tFallback('cardio.start.cta.live', 'Start') + ' ' + tFallback(activity.labelKey, activity.label).toLowerCase()
        : tFallback('cardio.start.cta.manual', 'Log') + ' ' + tFallback(activity.labelKey, activity.label).toLowerCase())
    : tFallback('cardio.start.cta.empty', 'Start');

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      kicker={tFallback('cardio.start.kicker', 'Start a session')}
      labelledBy="cardio-start-title"
    >
      <div className="mt-3 space-y-4">
        <Row label={tFallback('cardio.start.activity', 'Activity')}>
          {ACTIVITIES.map(a => (
            <Pill key={a.mode} selected={mode === a.mode} onClick={() => pickMode(a.mode)}
                  className="flex flex-col items-center justify-center gap-1">
              <a.Icon className="w-5 h-5" />
              <span className="text-micro">{tFallback(a.labelKey, a.label)}</span>
            </Pill>
          ))}
        </Row>

        {/* Dim, not hidden. A row that appears mid-interaction shifts
            everything under it, and the sheet would grow twice while a
            thumb is already moving — so the height stays constant and the
            whole shape is visible on open. */}
        <Row label={tFallback('cardio.start.where', 'Where')} dim={!mode}>
          {(activity || ACTIVITIES[0]).where.map(w => (
            <Pill key={w.env} selected={env === w.env} disabled={!mode} onClick={() => setEnv(w.env)}>
              {tFallback(w.labelKey, w.label)}
            </Pill>
          ))}
        </Row>

        <Row label={tFallback('cardio.start.how', 'How')} dim={!env}>
          <Pill selected={how === 'live'} disabled={!env || !liveOk} onClick={() => setHow('live')}>
            {t('cardio.input.live')}
          </Pill>
          <Pill selected={how === 'manual'} disabled={!env} onClick={() => setHow('manual')}>
            {t('cardio.input.manual')}
          </Pill>
        </Row>

        {/* Said out loud rather than left as a dead control. */}
        {mode === 'swimming' && (
          <p className="text-micro text-muted-foreground">
            {tFallback('cardio.start.noLiveSwim',
              'Live tracking needs GPS or a treadmill readout, so swims are logged by hand.')}
          </p>
        )}

        <button
          type="button"
          disabled={!ready}
          onClick={() => onStart({ mode, env, how })}
          className={[
            'w-full h-14 rounded-2xl font-heading font-bold text-base transition-colors',
            ready
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-muted-foreground/60',
          ].join(' ')}
        >
          {ctaLabel}
        </button>
      </div>
    </SheetShell>
  );
}
