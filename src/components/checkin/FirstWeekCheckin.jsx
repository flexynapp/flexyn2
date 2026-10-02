// src/components/checkin/FirstWeekCheckin.jsx
//
// The first-week check-in sheet (Kegan, 2026-10-02). For a new account's
// first seven days it rises once a day, the first time the app is open after
// the user's local midnight: on launch, or live if the app is already open
// when midnight passes. One tap claims the day; the server pays it.
//
// It never interrupts training. While a workout or live cardio is running
// (src/lib/activeSession.js), or a workout was paused in the last few hours
// (a bottom-nav hop mid-session unmounts the logger, but the user is still
// training), it waits and rises at the next quiet moment.
//
// Closing it without claiming hides it for the rest of this app session
// only. The next launch that day offers it again, so a reflexive swipe does
// not cost a day of the week.
//
// Mounted once in App.jsx beside LoginStreakSync. Renders nothing for an
// account older than a week, and nothing at all before the migration lands.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import BottomSheet from '@/components/ui/BottomSheet';
import CheckinLook from './CheckinLooks';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { TIER } from '@/lib/motion';
import { triggerHaptic } from '@/lib/haptic';
import { isSessionActive, onSessionActiveChange } from '@/lib/activeSession';
import { reportError } from '@/lib/reportError';
import {
  claimFirstWeekCheckin,
  getFirstWeekCheckin,
  localDateString,
  mayBeInFirstWeek,
  msUntilLocalMidnight,
} from '@/lib/data/firstWeekCheckin';

const CHECKIN_LOOK = import.meta.env.VITE_CHECKIN_LOOK || 'base';

// A paused workout this recent is still a workout in progress.
const PAUSED_IS_ACTIVE_MS = 3 * 60 * 60 * 1000;
// How long the claimed state stays on screen before the sheet closes itself.
const CLOSE_AFTER_CLAIM_MS = 1600;

function hasRecentPausedWorkout(userId) {
  try {
    const list = JSON.parse(localStorage.getItem(`paused_workouts.${userId}`) || '[]');
    const now = Date.now();
    return Array.isArray(list) && list.some((w) => {
      const at = Date.parse(w?.pausedAt || '');
      return Number.isFinite(at) && now - at < PAUSED_IS_ACTIVE_MS;
    });
  } catch {
    return false;
  }
}

// Surfaces that are themselves a sequence the user is in the middle of.
function isQuietRoute(pathname) {
  return !/^\/(onboarding|checkin)(\/|$)/.test(pathname || '');
}

export default function FirstWeekCheckin() {
  const { user } = useAuth();
  const location = useLocation();
  const [today, setToday] = useState(() => localDateString());
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [sessionActive, setSessionActiveState] = useState(() => isSessionActive());
  const [tick, setTick] = useState(0);
  const dismissedFor = useRef(null);

  const userId = user?.id;
  const inWindow = !!userId && mayBeInFirstWeek(user?.created_at);

  useEffect(() => onSessionActiveChange(setSessionActiveState), []);

  // Rollover: a timer to the next local midnight, plus a re-check whenever
  // the app comes back to the foreground (a phone asleep through midnight
  // never fires the timer on time).
  useEffect(() => {
    if (!inWindow) return undefined;
    const refresh = () => setToday(localDateString());
    const id = setTimeout(refresh, msUntilLocalMidnight());
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, [inWindow, today]);

  useEffect(() => {
    if (!inWindow) { setState(null); return undefined; }
    let live = true;
    getFirstWeekCheckin(today).then((s) => { if (live) setState(s); });
    return () => { live = false; };
  }, [inWindow, userId, today]);

  const wantsToShow = !!state?.eligible && !!state?.claimable && dismissedFor.current !== today;

  // While it is waiting on a paused workout, look again every minute: saving
  // or discarding that draft writes no event this component can hear.
  useEffect(() => {
    if (!wantsToShow || open) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 60 * 1000);
    return () => clearInterval(id);
  }, [wantsToShow, open]);

  useEffect(() => {
    if (open || !wantsToShow) return;
    if (sessionActive || !isQuietRoute(location.pathname)) return;
    if (hasRecentPausedWorkout(userId)) return;
    setOpen(true);
  }, [open, wantsToShow, sessionActive, location.pathname, userId, tick]);

  const close = useCallback(() => {
    dismissedFor.current = today;
    setOpen(false);
  }, [today]);

  if (!inWindow || !state?.eligible) return null;

  return (
    <CheckinSheet
      open={open}
      state={state}
      today={today}
      user={user}
      onClaimed={(next) => setState(next)}
      onClose={close}
    />
  );
}

export function CheckinSheet({ open, state, today, user, onClaimed, onClose, claim = claimFirstWeekCheckin }) {
  const { tFallback } = useLanguage();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [justClaimed, setJustClaimed] = useState(false);

  useEffect(() => {
    if (open) { setFailed(false); setJustClaimed(false); }
  }, [open]);

  const days = state?.days || [];
  const todayEntry = days.find((d) => d.day === state?.day) || null;
  const claimed = justClaimed || todayEntry?.status === 'claimed';

  const onClaim = async () => {
    if (busy || claimed) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await claim(today);
      if (res?.claimed) {
        triggerHaptic(TIER.reward.haptic);
        setJustClaimed(true);
        onClaimed?.({
          ...state,
          claimable: false,
          days: days.map((d) => (d.day === res.day
            ? { ...d, status: 'claimed', xp: res.xp_awarded ?? d.xp, coins: res.coins_awarded ?? d.coins }
            : d)),
        });
        // Refresh the profile only once the sheet is down: a claim that
        // crosses a level makes LevelUpManager rise from that refetch, and
        // it should follow the check-in rather than land on top of it.
        setTimeout(() => {
          onClose();
          if (user?.email) queryClient.invalidateQueries({ queryKey: ['userProfile', user.email] });
        }, CLOSE_AFTER_CLAIM_MS);
      } else {
        // Already claimed on another device, or the day moved on.
        onClaimed?.({ ...state, claimable: false });
        onClose();
      }
    } catch (err) {
      setFailed(true);
      reportError(err, { feature: 'checkin.first-week' });
    } finally {
      setBusy(false);
    }
  };

  const title = tFallback('firstWeekCheckin.title', 'Day {n} of 7', { n: state?.day });

  // Design proposals (2026-10-02), compiled in only when a preview build sets
  // VITE_CHECKIN_LOOK. Vite inlines the constant, so a normal build drops
  // this branch and the module entirely. Removed once Kegan picks one.
  if (CHECKIN_LOOK !== 'base') {
    return (
      <CheckinLook
        look={CHECKIN_LOOK}
        open={open}
        title={title}
        days={days}
        today={state?.day}
        todayEntry={todayEntry}
        claimed={claimed}
        justClaimed={justClaimed}
        busy={busy}
        failed={failed}
        onClaim={onClaim}
        onClose={onClose}
        totalXp={user?.total_xp}
      />
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-6 pt-2">
        <DayTrack days={days} today={state?.day} justClaimed={justClaimed} tFallback={tFallback} />

        {todayEntry && (
          <div className="flex items-center justify-center gap-6" aria-live="polite">
            <span className="flex items-baseline gap-1">
              <span className={`font-heading text-display font-semibold tabular-nums ${claimed ? 'text-success' : ''}`}>
                +{todayEntry.xp}
              </span>
              <span className="text-caption text-muted-foreground">XP</span>
            </span>
            <span className="flex items-center gap-1.5">
              <FlexCoinIcon size={22} />
              <span className="font-heading text-title font-semibold tabular-nums">{todayEntry.coins}</span>
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <motion.button
            type="button"
            onClick={onClaim}
            disabled={busy || claimed}
            whileTap={claimed ? undefined : { scale: 0.97 }}
            transition={TIER.answer.spring}
            className={`h-12 w-full rounded-lg font-semibold transition-colors ${
              claimed
                ? 'bg-secondary text-muted-foreground'
                : 'bg-primary text-primary-foreground active:bg-primary/90'
            }`}
          >
            {claimed ? (
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4" aria-hidden="true" />
                {tFallback('firstWeekCheckin.done', 'Checked in')}
              </span>
            ) : tFallback('firstWeekCheckin.cta', 'Check in')}
          </motion.button>
          {failed && (
            <p className="text-center text-caption text-destructive">
              {tFallback('firstWeekCheckin.failed', 'Could not check in. Try again.')}
            </p>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

function DayTrack({ days, today, justClaimed, tFallback }) {
  return (
    <ol className="relative flex items-start justify-between" aria-label={tFallback('firstWeekCheckin.track', 'First week')}>
      {/* The rail the days sit on, through the centre of the nodes. */}
      <span aria-hidden="true" className="absolute inset-x-4 top-[1.125rem] h-px bg-border" />
      {days.map((d) => {
        const isToday = d.day === today;
        const claimedNow = isToday && justClaimed;
        const status = claimedNow ? 'claimed' : d.status;
        return (
          <li key={d.day} className="relative flex w-10 flex-col items-center gap-1">
            <DayNode day={d.day} status={status} animate={claimedNow} tFallback={tFallback} />
            <span
              className={`text-micro tabular-nums ${
                isToday ? 'font-semibold text-foreground' : 'text-muted-foreground'
              } ${status === 'missed' ? 'line-through opacity-50' : ''}`}
            >
              {d.xp}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function DayNode({ day, status, animate, tFallback }) {
  const label = tFallback('firstWeekCheckin.dayLabel', 'Day {n}', { n: day });
  const base = 'relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-caption tabular-nums';

  if (status === 'claimed') {
    return (
      <motion.span
        className={`${base} bg-success text-success-foreground`}
        initial={animate ? { scale: 0.6 } : false}
        animate={{ scale: 1 }}
        transition={TIER.reward.spring}
        aria-label={`${label}, ${tFallback('firstWeekCheckin.done', 'Checked in')}`}
      >
        <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
      </motion.span>
    );
  }
  if (status === 'today') {
    return (
      <span className={`${base} bg-background font-semibold text-primary ring-2 ring-primary`} aria-current="date" aria-label={label}>
        {day}
      </span>
    );
  }
  if (status === 'missed') {
    return (
      <span className={`${base} border border-dashed border-border bg-background text-muted-foreground/50`} aria-label={label}>
        {day}
      </span>
    );
  }
  return (
    <span className={`${base} border border-border bg-background text-muted-foreground`} aria-label={label}>
      {day}
    </span>
  );
}
