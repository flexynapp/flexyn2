import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, X, Volume2, VolumeX, Settings2, Check, Mic, MicOff } from 'lucide-react';
import { useRestTimer } from '@/lib/RestTimerContext';
import { useLanguage } from '@/lib/LanguageContext';
import { triggerHaptic } from '@/lib/haptic';

/**
 * RestTimerOverlay — a fixed-position floating pill that appears when the
 * rest timer is active. Positioned above the mobile bottom-nav and
 * theme-aware via CSS vars. Tap to expand for settings.
 */
export default function RestTimerOverlay() {
  const { t, tFallback } = useLanguage();
  const {
    active, secondsLeft, totalSeconds,
    defaultDuration, setDefaultDuration,
    soundEnabled, setSoundEnabled,
    voiceCuesEnabled, setVoiceCuesEnabled,
    stop, addTime,
  } = useRestTimer();
  const [expanded, setExpanded] = useState(false);

  if (!active) return null;

  const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : 0;
  const isFinishing = secondsLeft <= 5 && secondsLeft > 0;
  const isDone = secondsLeft <= 0;

  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  // Skipping with lots of time left = high energy. Reward it with a tiny
  // high-frequency buzz that acknowledges "you're ready to go again."
  const handleSkip = () => {
    if (secondsLeft > 30) triggerHaptic('buzz');
    stop();
  };

  return (
    <div
      // Both edges track the capped shell rather than the monitor, so the
      // timer stays centred over the content column instead of over the whole
      // display. `mx-auto max-w-md` below centres inside whatever this spans —
      // which is exactly why the span has to be right. See index.css.
      className="fixed start-0 end-0 z-40 pointer-events-none px-3 lg:start-[var(--shell-content-start)] lg:end-[var(--shell-inset)]"
      style={{
        bottom: 'calc(4rem + env(safe-area-inset-bottom) + 0.5rem)',
      }}
    >
      <AnimatePresence>
        <motion.div
          key="rest-timer"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          className="pointer-events-auto mx-auto max-w-md"
        >
          {expanded ? (
            <ExpandedPanel
              onCollapse={() => setExpanded(false)}
              defaultDuration={defaultDuration}
              setDefaultDuration={setDefaultDuration}
              soundEnabled={soundEnabled}
              setSoundEnabled={setSoundEnabled}
              voiceCuesEnabled={voiceCuesEnabled}
              setVoiceCuesEnabled={setVoiceCuesEnabled}
              t={t}
              tFallback={tFallback}
            />
          ) : (
            <CollapsedPill
              secondsLeft={secondsLeft}
              progress={progress}
              isFinishing={isFinishing}
              isDone={isDone}
              fmtTime={fmtTime}
              onExpand={() => setExpanded(true)}
              onSkip={handleSkip}
              onAdd={() => addTime(15)}
              onSubtract={() => addTime(-15)}
              t={t}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function CollapsedPill({ secondsLeft, progress, isFinishing, isDone, fmtTime, onExpand, onSkip, onAdd, onSubtract, t }) {
  return (
    <motion.div
      animate={isFinishing ? { scale: [1, 1.04, 1] } : { scale: 1 }}
      transition={{ duration: 0.6, repeat: isFinishing ? Infinity : 0 }}
      className={`relative overflow-hidden rounded-2xl shadow-2xl shadow-black/30 select-none-ui
        ${isDone
          ? 'bg-emerald-600 text-white'
          : 'bg-[hsl(210_18%_11%)] dark:bg-[hsl(210_22%_8%)] text-white'
        }`}
    >
      {/* Background progress fill */}
      {!isDone && (
        <div
          className="absolute inset-y-0 start-0 bg-primary/85 transition-[width] duration-200 ease-linear"
          style={{ width: `${(1 - progress) * 100}%` }}
          aria-hidden="true"
        />
      )}

      <div className="relative flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={onSubtract}
          aria-label={t('restTimer.subtract15')}
          disabled={isDone}
          className="w-11 h-11 rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 backdrop-blur-sm flex items-center justify-center transition-colors disabled:opacity-30"
        >
          <Minus className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onExpand}
          className="flex-1 text-center px-2 py-1 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors"
        >
          <div className="text-micro font-semibold tracking-[0.2em] uppercase opacity-80 leading-none mb-0.5">
            {isDone ? t('restTimer.done') : t('restTimer.rest')}
          </div>
          <div className="font-heading font-bold text-2xl tabular-nums leading-none">
            {fmtTime(Math.max(0, secondsLeft))}
          </div>
        </button>

        <button
          type="button"
          onClick={onAdd}
          aria-label={t('restTimer.add15')}
          disabled={isDone}
          className="w-11 h-11 rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 backdrop-blur-sm flex items-center justify-center transition-colors disabled:opacity-30"
        >
          <Plus className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onSkip}
          aria-label={t('restTimer.skip')}
          className="w-11 h-11 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/25 backdrop-blur-sm flex items-center justify-center transition-colors"
        >
          {isDone ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
        </button>
      </div>
    </motion.div>
  );
}

function ExpandedPanel({ onCollapse, defaultDuration, setDefaultDuration, soundEnabled, setSoundEnabled, voiceCuesEnabled, setVoiceCuesEnabled, t, tFallback }) {
  const PRESETS = [30, 60, 90, 120, 180, 300];
  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      className="bg-card border border-border/70 shadow-2xl shadow-black/15 rounded-2xl p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-muted-foreground" />
          <span className="font-heading font-semibold text-sm">{t('restTimer.settings')}</span>
        </div>
        <button
          onClick={onCollapse}
          aria-label={t('common.close')}
          className="w-7 h-7 rounded-lg hover:bg-secondary active:bg-secondary flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div className="mb-4">
        <span className="block text-micro font-semibold tracking-[0.18em] uppercase text-muted-foreground mb-2">
          {t('restTimer.defaultRest')}
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          {PRESETS.map(p => {
            const isActive = p === defaultDuration;
            return (
              <button
                key={p}
                onClick={() => setDefaultDuration(p)}
                className={`py-2 rounded-lg text-sm font-semibold tabular-nums transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-foreground hover:bg-secondary/70 active:bg-secondary/70'
                }`}
              >
                {p < 60 ? `${p}s` : p % 60 === 0 ? `${p / 60}m` : `${Math.floor(p / 60)}m ${p % 60}s`}
              </button>
            );
          })}
        </div>
      </div>

      {/* HIIT / Interval presets — set the timer to standard interval
          work/rest durations. Tabata is the most-requested one;
          30/30 and 40/20 cover broad HIIT territory; EMOM = "every
          minute on the minute" = 60s rest interval. */}
      <div className="mb-4">
        <span className="block text-micro font-semibold tracking-[0.18em] uppercase text-muted-foreground mb-2">
          {tFallback("restTimerOverlay.hiitPresets", "HIIT presets")}
        </span>
        {/* NOT keyed, deliberately. Tabata and EMOM are protocol names lifters
            use untranslated in every language, and the rest is arithmetic.
            Six keys here would be six copies of the same numerals. */}
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: 'Tabata 20s', dur: 20 },
            { label: 'Tabata 10s', dur: 10 },
            { label: '30 / 30',    dur: 30 },
            { label: '40 / 20',    dur: 20 },
            { label: 'EMOM 1:00',  dur: 60 },
            { label: '20 / 40',    dur: 40 },
          ].map(({ label, dur }) => (
            <button
              key={label}
              onClick={() => setDefaultDuration(dur)}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                dur === defaultDuration
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-foreground hover:bg-secondary/70 active:bg-secondary/70'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => setSoundEnabled(!soundEnabled)}
        className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-secondary active:bg-secondary transition-colors"
      >
        <span className="flex items-center gap-2 text-sm">
          {soundEnabled
            ? <Volume2 className="w-4 h-4 text-primary" />
            : <VolumeX className="w-4 h-4 text-muted-foreground" />}
          <span className="font-medium">{t('restTimer.soundOnFinish')}</span>
        </span>
        <span className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
          soundEnabled ? 'bg-primary' : 'bg-muted'
        }`}>
          <span className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform mt-0.5"
            style={{ transform: `translateX(${soundEnabled ? '1.125rem' : '0.125rem'})` }} />
        </span>
      </button>

      <button
        onClick={() => setVoiceCuesEnabled(!voiceCuesEnabled)}
        className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-secondary active:bg-secondary transition-colors"
      >
        <span className="flex items-center gap-2 text-sm">
          {voiceCuesEnabled
            ? <Mic className="w-4 h-4 text-primary" />
            : <MicOff className="w-4 h-4 text-muted-foreground" />}
          <span className="font-medium">
            {tFallback('restTimer.voiceCues', 'Voice cues')}
          </span>
        </span>
        <span className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
          voiceCuesEnabled ? 'bg-primary' : 'bg-muted'
        }`}>
          <span className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform mt-0.5"
            style={{ transform: `translateX(${voiceCuesEnabled ? '1.125rem' : '0.125rem'})` }} />
        </span>
      </button>

      {voiceCuesEnabled && (
        <p className="text-micro text-muted-foreground mt-2 px-1 leading-relaxed">
          {tFallback('restTimer.voiceHint', `Hands-free coaching: rest start, 3-2-1 countdown, "time's up". Plug in your headphones.`)}
        </p>
      )}
    </motion.div>
  );
}