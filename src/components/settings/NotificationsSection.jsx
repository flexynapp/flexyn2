// src/components/settings/NotificationsSection.jsx
//
// Everything that can interrupt the user: in-app toasts, workout
// reminders, Web Push, the seven push categories, per-category snooze and
// quiet hours.
//
// This is the page that most needed its own route. The categories, snooze
// popovers and two hour selects all render inline whenever push is
// supported, which in the old dropdown put roughly nine extra rows
// underneath one toggle — the wall of switches in the bottom half of the
// screen. Here they have room, and the nesting reads as nesting.

import { useState, useEffect, useRef } from 'react';
import {
  Bell, BellRing, BellOff, Dumbbell, Flame, Target, Trophy,
  Swords, Users, Star, Heart, Moon,
} from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useSettings } from '@/lib/SettingsContext';
import { usePushSubscription } from '@/lib/usePushSubscription';
import { getMyQuietHours, setMyQuietHours, formatHour12 } from '@/lib/data/quietHours';
import { supabase } from '@/api/supabaseClient';
import { toast } from '@/lib/toast';
import { useSettingsProfile } from './useSettingsProfile';
import { Group, Row, ToggleRow, Switch, SubGroup } from './SettingsPrimitives';

const CATEGORIES = [
  { key: 'streak',       icon: Flame,  label: 'Streak reminders' },
  { key: 'quests',       icon: Target, label: 'Quest updates' },
  { key: 'league',       icon: Trophy, label: 'League results' },
  { key: 'competitive',  icon: Swords, label: 'Duels, bounties & crew wars' },
  { key: 'social',       icon: Users,  label: 'Friend activity' },
  { key: 'achievements', icon: Star,   label: 'Achievements' },
  { key: 'engagement',   icon: Heart,  label: 'Welcome back' },
];

export default function NotificationsSection() {
  const { t, tFallback } = useLanguage();
  const { profile, invalidateProfile } = useSettingsProfile();
  const {
    enableNotifications, setEnableNotifications,
    enableWorkoutReminders, setEnableWorkoutReminders,
  } = useSettings();

  // Web Push subscription state for THIS device. Distinct from the
  // in-app `enableNotifications` toggle above — that controls whether
  // sonner toasts fire while the app is open; push notifications are
  // for delivery when the app ISN'T open.
  const push = usePushSubscription();

  // ── Per-category notification preferences ───────────────────────────
  // Mirrored from profile.notification_prefs (migration 036) for instant
  // UI feedback; the RPC update_notification_pref is fire-and-forget on
  // toggle. We revert + toast on failure rather than blocking the UI.
  const [prefs, setPrefs] = useState(null);
  // Per-category in-flight ref so a double-tap on the same notification
  // toggle doesn't fire two RPCs whose responses race. (Audit 14 #13.)
  const prefSavingRef = useRef({});

  useEffect(() => {
    if (profile?.notification_prefs && typeof profile.notification_prefs === 'object') {
      setPrefs(profile.notification_prefs);
    } else if (profile) {
      // Profile loaded but column not yet populated (pre-migration 036
      // back-fill, or freshly-created row before the DEFAULT kicked in).
      // Show all-on so the toggles aren't stuck in an unknown state.
      setPrefs(prev => prev ?? {
        streak: true, quests: true, league: true, social: true,
        achievements: true, engagement: true, competitive: true,
      });
    }
  }, [profile, profile?.notification_prefs]);

  // ── Per-category temporary snooze (mig 127) ─────────────────────────
  // Local mirror of profile.notification_snoozes. Optimistic on change;
  // re-fetches on profile invalidation. Auto-prunes expired entries on
  // load so a stale snooze never shows as still-active.
  const [snoozes, setSnoozes] = useState({});
  const [snoozeOpenFor, setSnoozeOpenFor] = useState(null);
  useEffect(() => {
    const raw = profile?.notification_snoozes;
    if (raw && typeof raw === 'object') {
      const live = {};
      const now = Date.now();
      for (const [k, v] of Object.entries(raw)) {
        const ts = Date.parse(v);
        if (Number.isFinite(ts) && ts > now) live[k] = v;
      }
      setSnoozes(live);
    } else {
      setSnoozes({});
    }
  }, [profile?.notification_snoozes]);

  // ── Quiet hours ─────────────────────────────────────────────────────
  // null means "always on". When the user enables quiet hours we default
  // the window to 22 → 7 (overnight).
  const [quietHours, setQuietHours] = useState({ start: null, end: null });
  useEffect(() => {
    let cancelled = false;
    getMyQuietHours().then((qh) => {
      if (!cancelled) setQuietHours(qh);
    }).catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, []);
  const quietEnabled = quietHours.start != null && quietHours.end != null;
  const updateQuietHours = async (next) => {
    const prev = quietHours;
    setQuietHours(next); // optimistic
    const res = await setMyQuietHours(next);
    if (!res?.ok) {
      setQuietHours(prev); // revert
      toast.error(tFallback('settings.quiet.saveFailed', 'Could not save quiet hours.'));
    }
  };

  const handleSnoozeCategory = async (category, minutes) => {
    const { snoozeCategory } = await import('@/lib/data/notificationSnooze');
    const prev = snoozes;
    const optimistic = { ...snoozes };
    if (!minutes) {
      delete optimistic[category];
    } else {
      optimistic[category] = new Date(Date.now() + minutes * 60_000).toISOString();
    }
    setSnoozes(optimistic);
    setSnoozeOpenFor(null);
    // snoozeCategory returns { ok, expiry, reason } so we can tell
    // "cleared successfully" from "RPC missing / errored." Previously both
    // returned `null` and the `if (minutes && !expiry)` guard only
    // reverted SET paths — a failed CLEAR silently left the optimistic
    // state in place while the server still had the snooze row. Wave 54
    // (Notifications + Settings audits) caught this.
    const res = await snoozeCategory(category, minutes);
    if (!res.ok) {
      setSnoozes(prev);
      if (res.reason === 'pipeline_missing') {
        toast.error(tFallback('settings.snooze.notConfigured', 'Snooze is not enabled in this environment yet.'));
      } else {
        toast.error(tFallback('settings.snooze.failed', 'Could not snooze. Try again.'));
      }
      return;
    }
    invalidateProfile();
  };

  const formatSnoozeLeft = (iso) => {
    const ms = Date.parse(iso) - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const mins = Math.ceil(ms / 60_000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.ceil(mins / 60);
    return `${hrs}h`;
  };

  const handlePrefToggle = async (category) => {
    if (!prefs) return;
    // Per-category in-flight guard. A double-tap on the same toggle would
    // otherwise fire two RPCs whose responses can land out of order,
    // leaving the toggle in the wrong state. (Audit 14 #13.)
    if (prefSavingRef.current[category]) return;
    prefSavingRef.current[category] = true;
    const next = !prefs[category];
    const prev = prefs;
    // Optimistic update so the switch flips instantly.
    setPrefs({ ...prefs, [category]: next });
    const { error } = await supabase.rpc('update_notification_pref', {
      p_category: category,
      p_enabled:  next,
    });
    prefSavingRef.current[category] = false;
    if (error) {
      setPrefs(prev); // revert
      // Detect "RPC missing" (pre-mig-036 environments) and surface a
      // useful toast rather than the generic "try again" loop a user
      // would otherwise see forever. (Audit 14 #9.)
      const isMissingFn =
        error?.code === '42883' ||
        /update_notification_pref/i.test(String(error?.message || '')) &&
          /does not exist|not found/i.test(String(error?.message || ''));
      if (isMissingFn) {
        toast.error(tFallback(
          'settings.prefs.unavailable',
          'Notification preferences are not configured on this deployment.'
        ));
      } else {
        toast.error(tFallback('settings.prefs.saveFailed', 'Could not save preference. Try again.'));
      }
      return;
    }
    invalidateProfile();
  };

  // Translates browser-level outcomes into user-friendly toasts so the
  // push toggle never silently fails.
  const handlePushToggle = async () => {
    if (push.isSubscribed) {
      const res = await push.unsubscribe();
      if (res.ok) {
        toast.success(tFallback('settings.push.disabled', 'Push notifications disabled.'));
      } else {
        toast.error(tFallback('settings.push.disableFailed', 'Could not disable push notifications.'));
      }
      return;
    }
    const res = await push.subscribe();
    if (res.ok) {
      toast.success(tFallback('settings.push.enabled', 'Push notifications enabled!'));
    } else if (res.reason === 'denied') {
      toast.error(tFallback('settings.push.denied', 'Permission denied. Enable notifications in your browser settings.'));
    } else if (res.reason === 'unsupported') {
      toast.error(tFallback('settings.push.unsupported', 'Push notifications not supported on this device.'));
    } else if (res.reason === 'server_error') {
      toast.error(tFallback('settings.push.subscriptionFailed', 'Could not save your subscription. Try again.'));
    }
    // 'default' (user dismissed without choosing) → no toast, they'll try again.
  };

  return (
    <div className="flex flex-col gap-6">
      <Group title={tFallback('settings.group.inApp', 'In the app')}>
        {/* Distinct from the push toggle below — this one only controls
            in-app sonner toasts. The audit caught users confusing the two
            when both were labeled "Notifications". */}
        <ToggleRow
          icon={Bell}
          label={tFallback('settings.inAppAlerts', 'In-app alerts')}
          hint={tFallback('settings.inAppAlerts.hint', 'Toasts while the app is open')}
          checked={enableNotifications}
          onChange={setEnableNotifications}
        />
        <ToggleRow
          icon={Dumbbell}
          label={t('settings.workoutReminders')}
          checked={enableWorkoutReminders}
          onChange={setEnableWorkoutReminders}
        />
      </Group>

      {/* Push — only shown when the browser supports Web Push AND a VAPID
          key is configured at build time. The denied state shows when
          permission was refused (the user has to go into browser settings
          to re-enable, which we can't do for them). */}
      {push.isSupported && (
        <Group
          title={tFallback('settings.group.push', 'Push notifications')}
          description={tFallback(
            'settings.group.push.desc',
            'Delivered when the app is closed. Per-device.'
          )}
        >
          <ToggleRow
            icon={BellRing}
            label={tFallback('settings.pushNotifications', 'Push notifications')}
            hint={push.permission === 'denied'
              ? tFallback('settings.pushBlocked', 'Blocked. Change in browser settings')
              : undefined}
            checked={push.isSubscribed}
            onChange={handlePushToggle}
            busy={push.isLoading}
          />

          {/* Per-category preferences. The user can set these before
              subscribing so the prefs they want are already honored the
              first time a push fires after they enable. */}
          {prefs && (
            <div className="py-2">
              <SubGroup ariaLabel={tFallback('settings.pushCategories', 'Push notification categories')}>
                {CATEGORIES.map(({ key, icon: Icon, label }) => {
                  const labelId = `settings-push-pref-label-${key}`;
                  const snoozeExpiry = snoozes[key];
                  const snoozeLeft = snoozeExpiry ? formatSnoozeLeft(snoozeExpiry) : null;
                  const isOn = prefs[key] !== false;
                  const snoozeOpen = snoozeOpenFor === key;
                  return (
                    <Row
                      key={key}
                      icon={Icon}
                      labelId={labelId}
                      label={tFallback(`settings.push.${key}`, label)}
                      className="relative"
                    >
                      <div className="flex items-center gap-2">
                        {isOn && (
                          <button
                            type="button"
                            onClick={() => setSnoozeOpenFor(snoozeOpen ? null : key)}
                            className={`h-11 inline-flex items-center gap-1 px-2 rounded-lg text-micro font-bold uppercase tracking-wide transition-colors ${
                              snoozeLeft
                                ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                                : 'text-muted-foreground hover:bg-secondary/50 active:bg-secondary/50 hover:text-foreground active:text-foreground'
                            }`}
                            aria-label={tFallback('settings.snooze.label', 'Snooze')}
                          >
                            <BellOff className="w-3.5 h-3.5" aria-hidden="true" />
                            {snoozeLeft || ''}
                          </button>
                        )}
                        <Switch
                          checked={isOn}
                          onChange={() => handlePrefToggle(key)}
                          labelledBy={labelId}
                        />
                      </div>
                      {snoozeOpen && (
                        <div className="absolute end-12 top-10 z-30 flex items-center gap-2 px-2 py-2 rounded-lg bg-card border border-border shadow-md">
                          {[
                            { mins: 60,   label: '1h' },
                            { mins: 240,  label: '4h' },
                            { mins: 1440, label: '24h' },
                          ].map(opt => (
                            <button
                              key={opt.mins}
                              type="button"
                              onClick={() => handleSnoozeCategory(key, opt.mins)}
                              className="min-h-11 px-3 rounded-lg text-micro font-bold uppercase tracking-wide bg-secondary/60 hover:bg-secondary active:bg-secondary text-foreground"
                            >
                              {opt.label}
                            </button>
                          ))}
                          {snoozeLeft && (
                            <button
                              type="button"
                              onClick={() => handleSnoozeCategory(key, 0)}
                              className="min-h-11 px-3 rounded-lg text-micro font-bold uppercase tracking-wide text-destructive hover:bg-destructive/10 active:bg-destructive/10"
                            >
                              {tFallback('settings.snooze.clear', 'Clear')}
                            </button>
                          )}
                        </div>
                      )}
                    </Row>
                  );
                })}
              </SubGroup>
            </div>
          )}

          {/* Quiet hours — do-not-disturb window. NULL = always-on. When
              set, the push trigger (mig 098) short-circuits push delivery
              inside the window; in-app rows still insert. The window wraps
              midnight (e.g. 22 → 7). */}
          <div className="py-2">
            <SubGroup>
              <Row
                icon={Moon}
                labelId="settings-quiet-label"
                label={tFallback('settings.quiet.title', 'Quiet hours')}
              >
                <Switch
                  checked={quietEnabled}
                  onChange={(next) =>
                    updateQuietHours(next ? { start: 22, end: 7 } : { start: null, end: null })
                  }
                  labelledBy="settings-quiet-label"
                />
              </Row>
              {quietEnabled && (
                <div className="py-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={quietHours.start ?? 22}
                      onChange={(e) => updateQuietHours({ ...quietHours, start: Number(e.target.value) })}
                      className="flex-1 min-h-11 px-2 rounded-lg bg-secondary text-body font-medium border border-border focus:outline-none focus:ring-2 focus:ring-primary/40"
                      aria-label={tFallback('settings.quiet.startLabel', 'Quiet hours start (24-hour clock)')}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{formatHour12(h)}</option>
                      ))}
                    </select>
                    <span className="text-caption text-muted-foreground" aria-hidden="true">→</span>
                    <select
                      value={quietHours.end ?? 7}
                      onChange={(e) => updateQuietHours({ ...quietHours, end: Number(e.target.value) })}
                      className="flex-1 min-h-11 px-2 rounded-lg bg-secondary text-body font-medium border border-border focus:outline-none focus:ring-2 focus:ring-primary/40"
                      aria-label={tFallback('settings.quiet.endLabel', 'Quiet hours end (24-hour clock)')}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{formatHour12(h)}</option>
                      ))}
                    </select>
                  </div>
                  {quietHours.start != null && quietHours.end != null && quietHours.start === quietHours.end && (
                    // The push trigger (mig 098) treats start == end as "no
                    // quiet hours" — surface the degenerate state so the
                    // user doesn't think DND is active when it silently
                    // isn't. (Audit 14 #18.)
                    <p className="text-caption text-amber-500 leading-snug">
                      {tFallback(
                        'settings.quiet.equalWarn',
                        'Start and end are the same. Quiet hours are effectively off. Pick different times.'
                      )}
                    </p>
                  )}
                </div>
              )}
            </SubGroup>
          </div>
        </Group>
      )}
    </div>
  );
}
