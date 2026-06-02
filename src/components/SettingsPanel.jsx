import { useState, useEffect, useRef } from 'react';
import { useSettings } from '@/lib/SettingsContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Bell, BellRing, Dumbbell, Languages, Ruler, Pause, Timer, Sparkles, Circle, Bug, Scale, User, Check, X, Loader2, Flame, Target, Trophy, Users, Star, Heart, MessageCircle, Lock, Globe, ShieldOff, UserX, ChevronDown, ChevronUp, Swords, Vibrate, Volume2, Moon, BellOff } from 'lucide-react';
import { getMyQuietHours, setMyQuietHours, formatHour12 } from '@/lib/data/quietHours';
import { updateStoryDmsSettings } from '@/lib/data/stories';
import { getStoryBlocks, blockUser, unblockUser, updateDefaultStoryPrivacy } from '@/lib/data/storyPrivacy';
import { supabase } from '@/api/supabaseClient';
import LanguagePicker from './LanguagePicker';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import BugReportDialog from './BugReportDialog';
import { buildLabel, diagnosticString } from '@/lib/buildInfo';
import { isAppAdmin } from '@/lib/adminRoles';
import { Link } from 'react-router-dom';
import { ShieldAlert, FileText, VolumeX, Ban } from 'lucide-react';
import { listMyReports } from '@/lib/data/hubReports';
import * as userBlocksData from '@/lib/data/userBlocks';
import * as userMutesData  from '@/lib/data/userMutes';
import { getHapticsDisabled, setHapticsDisabled, triggerHaptic } from '@/lib/haptic';
import { useTheme } from '@/lib/ThemeContext';
import { Sun } from 'lucide-react';
import TwoFactorSection from './TwoFactorSection';
import ConnectedAppsSection from './ConnectedAppsSection';
import { getSoundsEnabled, setSoundsEnabled, playSound, SOUND } from '@/lib/playSound';
import { useAuth } from '@/lib/AuthContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { db } from '@/api/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toLbs, formatWeightNumber } from '@/lib/weightUnit';
import { differenceInYears } from 'date-fns';
import { usePushSubscription } from '@/lib/usePushSubscription';
import { toast } from 'sonner';

export default function SettingsPanel() {
  const { t, tFallback } = useLanguage();
  const { distanceUnit, setDistanceUnit } = useDistanceUnit();
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const { user } = useAuth();
  const { weightUnit, setWeightUnit } = useWeightUnit();
  const queryClient = useQueryClient();
  const [editingStat, setEditingStat] = useState(null); // 'weight_lbs' | 'height_inches' | 'birthday'
  const [statValue, setStatValue] = useState('');
  const [initialStatValue, setInitialStatValue] = useState('');
  const [statSaving,    setStatSaving]    = useState(false);
  const [genderSaving,  setGenderSaving]  = useState(false);
  const [storyDmsDisabled,    setStoryDmsDisabled]    = useState(false);
  const [defaultPrivacy,      setDefaultPrivacy]      = useState('friends');
  const [storyBlocksOpen,     setStoryBlocksOpen]     = useState(false);
  const [storyBlocks,         setStoryBlocks]         = useState([]);
  const [blockEmail,          setBlockEmail]          = useState('');
  const [blockSaving,         setBlockSaving]         = useState(false);

  // Theme system (light/dark). Lives in ThemeContext + syncs to the
  // server's user_profiles.dark_mode column so the choice follows the
  // user across devices. The picker also lives in ProfileMenu — this
  // section is here so Settings has a discoverable home for it.
  const { darkMode, setDarkMode } = useTheme();

  // Local mirrors of the per-device tactile preferences. Both are
  // backed by localStorage (not server) — a user who silenced one
  // phone shouldn't silence another. Initialized from the helper so
  // the toggles reflect persisted state on every mount.
  const [hapticsEnabled, setHapticsEnabledLocal] = useState(() => !getHapticsDisabled());
  const [soundsEnabled,  setSoundsEnabledLocal]  = useState(() => getSoundsEnabled());

  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  // Reporter-facing report history. Powers the "My reports" panel
  // below — closes the loop that started in ReportDialog.jsx.
  const { data: myReports = [] } = useQuery({
    queryKey: ['myReports', user?.id],
    queryFn: () => listMyReports({ limit: 10 }),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  // Full-block + mute lists.
  const { data: myBlocks = [] } = useQuery({
    queryKey: ['userBlocks', user?.id],
    queryFn: () => userBlocksData.listBlocks(user.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });
  const { data: myMutes = [] } = useQuery({
    queryKey: ['userMutes', user?.id],
    queryFn: () => userMutesData.listMutes(user.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const handleUnblockFull = async (email) => {
    try {
      await userBlocksData.unblockUserFull(email);
      queryClient.invalidateQueries({ queryKey: ['userBlocks', user.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      toast.success(`Unblocked ${email}.`);
    } catch (err) {
      toast.error(`Could not unblock: ${err.message || 'try again'}`);
    }
  };

  const handleUnmute = async (email) => {
    try {
      await userMutesData.unmuteUser(user.id, email);
      queryClient.invalidateQueries({ queryKey: ['userMutes', user.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      toast.success(`Unmuted ${email}.`);
    } catch (err) {
      toast.error(`Could not unmute: ${err.message || 'try again'}`);
    }
  };

  const saveStatEdit = async () => {
    if (!editingStat || !statValue) return;
    // If the user didn't actually change the value, close without saving.
    // This prevents the weight round-trip drift caught by the audit: the
    // displayed value is `formatWeightNumber(stored_lbs, weightUnit)` which
    // is rounded; saving it back would re-convert and lose precision on
    // every edit cycle. Comparing to the initial value short-circuits the
    // no-op save entirely.
    if (statValue === initialStatValue) {
      setEditingStat(null);
      setStatValue('');
      setInitialStatValue('');
      return;
    }
    setStatSaving(true);
    try {
      if (editingStat === 'birthday') {
        // Reject future dates AND impossible ages.
        const d = new Date(statValue);
        if (isNaN(d.getTime())) {
          toast.error(tFallback('settings.validation.invalidDate', 'Invalid date.'));
          return;
        }
        // Catch dates like '2023-02-29' that JavaScript silently
        // rolls forward (to March 1, 2023) instead of rejecting. Round
        // trip the date through ISO and require an exact match.
        const isoRoundTrip = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (typeof statValue === 'string' && statValue.length >= 10 && isoRoundTrip !== statValue.slice(0, 10)) {
          toast.error(tFallback('settings.validation.invalidDate', 'Invalid date.'));
          return;
        }
        if (d > new Date()) {
          toast.error(tFallback('settings.validation.birthdayFuture', "Birthday can't be in the future."));
          return;
        }
        const yearsAgo = (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (yearsAgo > 120) {
          toast.error(tFallback('settings.validation.birthdayUnrealistic', 'Please enter a realistic birthday.'));
          return;
        }
        if (yearsAgo < 13) {
          toast.error(tFallback('settings.validation.under13', 'You must be 13 or older to use Flexyn.'));
          return;
        }
        await db.auth.updateMe({ birthday: statValue });
      } else {
        const parsed = parseFloat(statValue);
        if (isNaN(parsed) || parsed <= 0) {
          toast.error(tFallback('settings.validation.positiveNumber', 'Please enter a number greater than zero.'));
          return;
        }
        // Range validation per stat so a fat-finger entry doesn't corrupt
        // the profile. Anti-cheat already validates set-level weights/reps,
        // but profile-level values were unguarded.
        if (editingStat === 'weight_lbs') {
          const lbs = toLbs(parsed, weightUnit);
          // Range tightened to 70-700 lb (32-318 kg) — the prior 50 lb
          // lower bound let a fat-finger entry corrupt the profile to a
          // small-child-sized weight that makes no sense for an adult
          // fitness app. (Audit 14 #11.)
          if (lbs < 70 || lbs > 700) {
            toast.error(tFallback('settings.validation.weightRange', 'Weight must be between 70 and 700 lb (32–318 kg).'));
            return;
          }
          await db.auth.updateMe({ weight_lbs: lbs });
        } else if (editingStat === 'height_inches') {
          // Tightened from 24-96 to 48-90 in (122-229 cm) for the same
          // reason — 24 inches is a toddler. (Audit 14 #11.)
          if (parsed < 48 || parsed > 90) {
            toast.error(tFallback('settings.validation.heightRange', 'Height must be between 48 and 90 inches (122–229 cm).'));
            return;
          }
          await db.auth.updateMe({ height_inches: parsed });
        } else {
          await db.auth.updateMe({ [editingStat]: parsed });
        }
      }
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      setEditingStat(null);
      setStatValue('');
      setInitialStatValue('');
    } catch (err) {
      // Surface the real cause instead of swallowing silently — the audit
      // caught that the previous `console.error` left users with no signal
      // the save failed.
      console.error('Stat update failed:', err);
      toast.error(tFallback('settings.validation.saveFailed', 'Could not save — try again.'));
    } finally {
      setStatSaving(false);
    }
  };

  // Sex — one-tap save (no edit input). Feeds strength ceilings, volume
  // caps, and BMR/calorie math. Stored as 'male' | 'female'.
  // Uses its own saving flag so stat-edit saves don't disable the buttons.
  const saveGender = async (g) => {
    if (genderSaving || (profile?.gender || '').toLowerCase() === g) return;
    setGenderSaving(true);
    try {
      await db.auth.updateMe({ gender: g });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
    } catch (err) {
      console.error('Gender update failed:', err);
      toast.error(tFallback('settings.validation.saveFailed', 'Could not save — try again.'));
    } finally {
      setGenderSaving(false);
    }
  };

  const formatHeight = (inches) => {
    if (!inches) return '—';
    const ft = Math.floor(inches / 12);
    const ins = Math.round(inches % 12);
    return `${ft}'${ins}"`;
  };
  const {
    enableNotifications, setEnableNotifications,
    enableWorkoutReminders, setEnableWorkoutReminders,
    cardioAutoPause, setCardioAutoPause,
    restTimerEnabled, setRestTimerEnabled,
    levelAnimationsEnabled, setLevelAnimationsEnabled,
    nutrientRingView, setNutrientRingView,
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
  // Quiet hours — null means "always on". When the user enables
  // quiet hours we default the window to 22 → 7 (overnight).
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
  useEffect(() => {
    if (profile?.story_dms_disabled !== undefined) {
      setStoryDmsDisabled(!!profile.story_dms_disabled);
    }
    if (profile?.default_story_privacy) {
      setDefaultPrivacy(profile.default_story_privacy);
    }
  }, [profile?.story_dms_disabled, profile?.default_story_privacy]);

  // ── Privacy mode (mig 117) ──────────────────────────────────────────
  // is_private hides the profile content from non-followers.
  // hide_from_search removes the account from user-search + PYMK.
  const [isPrivate, setIsPrivate] = useState(false);
  const [hideFromSearch, setHideFromSearch] = useState(false);
  useEffect(() => {
    if (profile?.is_private !== undefined) setIsPrivate(!!profile.is_private);
    if (profile?.hide_from_search !== undefined) setHideFromSearch(!!profile.hide_from_search);
  }, [profile?.is_private, profile?.hide_from_search]);

  const togglePrivacy = async (column, next) => {
    const setLocal = column === 'is_private' ? setIsPrivate : setHideFromSearch;
    const prev = column === 'is_private' ? isPrivate : hideFromSearch;
    setLocal(next); // optimistic
    try {
      const { error } = await supabase.from('user_profiles').update({ [column]: next }).eq('id', user.id);
      if (error) throw error;
      // Invalidate every query whose visibility is gated on this
      // profile flag — without this, other-profile views and the
      // hub feed stay stale until their staleTime expires (up to 5m).
      // (Audit 14 #10.)
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      queryClient.invalidateQueries({ queryKey: ['hubProfilePosts'] });
      queryClient.invalidateQueries({ queryKey: ['profileStories'] });
      queryClient.invalidateQueries({ queryKey: ['hubProfile'] });
      queryClient.invalidateQueries({ queryKey: ['hubSearch'] });
    } catch {
      setLocal(prev);
      toast.error('Could not update privacy. Try again.');
    }
  };

  // ── Data export ──────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const handleDataExport = async () => {
    if (exporting || !user?.id) return;
    setExporting(true);
    try {
      const mod = await import('@/lib/data/dataExport');
      const data = await mod.buildExport(user);
      await mod.downloadExport(data);
      toast.success('Data export downloaded.');
    } catch (err) {
      toast.error(`Export failed: ${err?.message || 'try again'}`);
    } finally {
      setExporting(false);
    }
  };

  const loadStoryBlocks = async () => {
    if (!user?.id) return;
    const blocks = await getStoryBlocks(user.id);
    setStoryBlocks(blocks);
  };

  const handleBlockAdd = async () => {
    const email = blockEmail.trim().toLowerCase();
    if (!email || !user) return;
    // Reject malformed emails up-front so users don't see a fake
    // "Blocked asdf@asdf" toast for an entry that won't actually
    // protect them. Also reject self-blocking — blocking yourself
    // breaks story visibility queries in confusing ways. (Audit 14 #4.)
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_RE.test(email)) {
      toast.error(tFallback('settings.block.invalidEmail', 'Enter a valid email address.'));
      return;
    }
    if (email === (user?.email || '').toLowerCase()) {
      toast.error(tFallback('settings.block.selfBlock', "You can't block your own email."));
      return;
    }
    setBlockSaving(true);
    const ok = await blockUser(user, email);
    setBlockSaving(false);
    if (ok) {
      setBlockEmail('');
      await loadStoryBlocks();
      queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
      toast.success(tFallback('settings.block.added', 'Blocked {email}', { email }));
    } else {
      toast.error(tFallback('settings.block.addFailed', 'Could not add block — try again.'));
    }
  };

  const handleUnblock = async (email) => {
    if (!user?.id) return;
    const ok = await unblockUser(user.id, email);
    if (ok) {
      setStoryBlocks(prev => prev.filter(b => b.blocked_email !== email));
      queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
      toast.success(tFallback('settings.block.removed', 'Unblocked {email}', { email }));
    } else {
      toast.error(tFallback('settings.block.removeFailed', 'Could not remove block.'));
    }
  };

  useEffect(() => {
    if (profile?.notification_prefs && typeof profile.notification_prefs === 'object') {
      setPrefs(profile.notification_prefs);
    } else if (profile && prefs === null) {
      // Profile loaded but column not yet populated (pre-migration 036
      // back-fill, or freshly-created row before the DEFAULT kicked in).
      // Show all-on so the toggles aren't stuck in an unknown state.
      setPrefs({ streak: true, quests: true, league: true, social: true, achievements: true, engagement: true, competitive: true });
    }
   
  }, [profile?.notification_prefs]);

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
        const t = Date.parse(v);
        if (Number.isFinite(t) && t > now) live[k] = v;
      }
      setSnoozes(live);
    } else {
      setSnoozes({});
    }
  }, [profile?.notification_snoozes]);

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
    // snoozeCategory now returns { ok, expiry, reason } so we can tell
    // "cleared successfully" from "RPC missing / errored." Previously
    // both returned `null` and the `if (minutes && !expiry)` guard
    // only reverted SET paths — a failed CLEAR silently left the
    // optimistic state in place while the server still had the snooze
    // row. Wave 54 (Notifications + Settings audits) caught this.
    const res = await snoozeCategory(category, minutes);
    if (!res.ok) {
      setSnoozes(prev);
      if (res.reason === 'pipeline_missing') {
        toast.error(tFallback('settings.snooze.notConfigured', 'Snooze is not enabled in this environment yet.'));
      } else {
        toast.error(tFallback('settings.snooze.failed', 'Could not snooze — try again.'));
      }
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
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
    // Per-category in-flight guard. A double-tap on the same toggle
    // would otherwise fire two RPCs whose responses can land out of
    // order, leaving the toggle in the wrong state. (Audit 14 #13.)
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
      // Revert.
      setPrefs(prev);
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
        toast.error(tFallback('settings.prefs.saveFailed', 'Could not save preference — try again.'));
      }
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
  };

  // Handler for the push toggle. Translates browser-level outcomes
  // into user-friendly toasts so the toggle never silently fails.
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
      toast.error(tFallback('settings.push.denied', 'Permission denied — enable notifications in your browser settings.'));
    } else if (res.reason === 'unsupported') {
      toast.error(tFallback('settings.push.unsupported', 'Push notifications not supported on this device.'));
    } else if (res.reason === 'server_error') {
      toast.error(tFallback('settings.push.subscriptionFailed', 'Could not save your subscription. Try again.'));
    }
    // 'default' (user dismissed without choosing) → no toast, they'll try again.
  };

  // ToggleSwitch — must be passed `labelledBy` (an id of the visible
  // text label) OR `ariaLabel`. Without an accessible name the switch
  // is announced as "switch, on" / "switch, off" with no context.
  const ToggleSwitch = ({ checked, onChange, labelledBy, ariaLabel }) => (
    <button
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={!labelledBy ? ariaLabel : undefined}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );

  const settings = [
    // Distinguish from the push-notification toggle below — this one only
    // controls in-app sonner toasts. Audit caught users confusing the two
    // when both were labeled "Notifications". Uses tFallback so English
    // users (and any locale missing the key) see "In-app alerts" without
    // needing to regenerate all 15 language aggregates.
    { icon: Bell, label: tFallback('settings.inAppAlerts', 'In-app alerts'), value: enableNotifications, onChange: setEnableNotifications },
    { icon: Dumbbell, label: t('settings.workoutReminders'), value: enableWorkoutReminders, onChange: setEnableWorkoutReminders },
    { icon: Pause, label: t('cardio.settings.autoPause'), value: cardioAutoPause, onChange: setCardioAutoPause },
    { icon: Timer, label: t('settings.restTimer'), value: restTimerEnabled, onChange: setRestTimerEnabled },
    { icon: Sparkles, label: t('settings.levelAnimations'), value: levelAnimationsEnabled, onChange: setLevelAnimationsEnabled },
    { icon: Circle, label: t('settings.nutrientRingView'), value: nutrientRingView, onChange: setNutrientRingView },
  ];

  return (
    <div className="px-4 py-3 border-t border-border space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('settings.title')}</p>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Languages className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-foreground leading-tight">{t('settings.language')}</p>
        </div>
        <LanguagePicker variant="compact" />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Ruler className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-foreground leading-tight">{t('settings.distanceUnit')}</p>
        </div>
        <div role="group" aria-label={t('settings.distanceUnit')} className="flex gap-1.5">
          {[
            { value: 'mi', label: t('settings.distanceUnit.mi') },
            { value: 'km', label: t('settings.distanceUnit.km') },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setDistanceUnit(opt.value)}
              aria-pressed={distanceUnit === opt.value}
              className={`flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors ${
                distanceUnit === opt.value
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border text-muted-foreground hover:bg-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {/* Weight unit toggle — previously the only way to change this
          after onboarding was via the inline UnitPill on log-weight
          modals, which most users never opened. The asymmetry with
          the distance unit toggle right above this read as broken.
          (Audit 14 #1.) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Scale className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-foreground leading-tight">
            {tFallback('settings.weightUnit', 'Weight unit')}
          </p>
        </div>
        <div role="group" aria-label={tFallback('settings.weightUnit', 'Weight unit')} className="flex gap-1.5">
          {[
            { value: 'lbs',   label: tFallback('settings.weightUnit.lbs',   'lbs') },
            { value: 'kg',    label: tFallback('settings.weightUnit.kg',    'kg') },
            { value: 'stone', label: tFallback('settings.weightUnit.stone', 'st') },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setWeightUnit(opt.value)}
              aria-pressed={weightUnit === opt.value}
              className={`flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors ${
                weightUnit === opt.value
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border text-muted-foreground hover:bg-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {settings.map((setting, i) => {
        const Icon = setting.icon;
        const labelId = `settings-toggle-label-${i}`;
        return (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
              <p id={labelId} className="text-xs text-foreground leading-tight">{setting.label}</p>
            </div>
            <ToggleSwitch
              checked={setting.value}
              onChange={setting.onChange}
              labelledBy={labelId}
            />
          </div>
        );
      })}

      {/* Push notifications — separate from in-app `enableNotifications`.
          Only shown when the browser supports Web Push AND a VAPID key is
          configured at build time. Disabled state shows when permission
          was denied (user has to go into browser settings to re-enable). */}
      {push.isSupported && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <BellRing className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p id="settings-push-label" className="text-xs text-foreground leading-tight">
                {tFallback('settings.pushNotifications', 'Push notifications')}
              </p>
              {push.permission === 'denied' && (
                <p className="text-[10px] text-destructive leading-tight mt-0.5">
                  {tFallback('settings.pushBlocked', 'Blocked — change in browser settings')}
                </p>
              )}
            </div>
          </div>
          {push.isLoading ? (
            <Loader2
              className="w-4 h-4 animate-spin text-muted-foreground"
              role="status"
              aria-label={tFallback('common.loading', 'Loading')}
            />
          ) : (
            <ToggleSwitch
              checked={push.isSubscribed}
              onChange={handlePushToggle}
              labelledBy="settings-push-label"
            />
          )}
        </div>
      )}

      {/* Appearance — light vs dark mode. Mirrors the same picker
          surfaced in ProfileMenu; Settings is the discoverable home so
          users searching for it find it here too. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {darkMode
            ? <Moon className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
            : <Sun  className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />}
          <p className="text-xs text-foreground leading-tight">
            {tFallback('settings.appearance', 'Appearance')}
          </p>
        </div>
        <div className="flex rounded-md border border-border overflow-hidden shrink-0" role="group" aria-label="Light or dark mode">
          <button
            type="button"
            onClick={() => setDarkMode(false)}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold transition-colors ${
              !darkMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
            }`}
            aria-pressed={!darkMode}
          >
            <Sun className="w-3 h-3" /> Light
          </button>
          <button
            type="button"
            onClick={() => setDarkMode(true)}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold transition-colors ${
              darkMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
            }`}
            aria-pressed={darkMode}
          >
            <Moon className="w-3 h-3" /> Dark
          </button>
        </div>
      </div>

      {/* Haptic feedback — per-device. When on, primary actions fire a
          short tick. The toggle itself fires a sample haptic when
          enabled so the user immediately feels what it's controlling.
          We detect whether the browser exposes navigator.vibrate at
          all — on desktops and iOS-without-permission the API is
          missing and flipping the toggle does nothing, so we surface
          a hint instead of leaving the user wondering. (Audit 14 #15.) */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Vibrate className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
            <p id="settings-haptics-label" className="text-xs text-foreground leading-tight">
              {tFallback('settings.haptics', 'Haptic feedback')}
            </p>
          </div>
          <ToggleSwitch
            checked={hapticsEnabled}
            onChange={(next) => {
              setHapticsEnabledLocal(next);
              setHapticsDisabled(!next);
              if (next) triggerHaptic('primary'); // sample feel
            }}
            labelledBy="settings-haptics-label"
          />
        </div>
        {typeof navigator !== 'undefined' && !('vibrate' in navigator) && (
          <p className="pl-5 text-[10px] text-muted-foreground/80 leading-tight mt-0.5">
            {tFallback(
              'settings.haptics.unsupported',
              'Vibration is not supported on this device.'
            )}
          </p>
        )}
      </div>

      {/* Sound effects — opt-in, default off. When on, primary actions
          play very short chimes (save, PR, capsule open). Most users
          leave this off, but a small audience loves it. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Volume2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
          <p id="settings-sounds-label" className="text-xs text-foreground leading-tight">
            {tFallback('settings.sounds', 'Sound effects')}
          </p>
        </div>
        <ToggleSwitch
          checked={soundsEnabled}
          onChange={(next) => {
            setSoundsEnabledLocal(next);
            setSoundsEnabled(next);
            if (next) playSound(SOUND.click); // sample on enable
          }}
          labelledBy="settings-sounds-label"
        />
      </div>

      {/* Per-category push preferences. Render only when push is supported —
          if push isn't an option the toggles are meaningless. The user can
          still set prefs before subscribing so the prefs they want are
          already honored the first time a push fires after they enable. */}
      {push.isSupported && prefs && (
        <div
          role="group"
          aria-label={tFallback('settings.pushCategories', 'Push notification categories')}
          className="pl-5 -mt-1 space-y-1.5 border-l border-border/60 ml-1.5"
        >
          {[
            { key: 'streak',       icon: Flame,  label: tFallback('settings.push.streak',       'Streak reminders') },
            { key: 'quests',       icon: Target, label: tFallback('settings.push.quests',       'Quest updates') },
            { key: 'league',       icon: Trophy, label: tFallback('settings.push.league',       'League results') },
            { key: 'competitive',  icon: Swords, label: tFallback('settings.push.competitive',  'Duels, bounties & crew wars') },
            { key: 'social',       icon: Users,  label: tFallback('settings.push.social',       'Friend activity') },
            { key: 'achievements', icon: Star,   label: tFallback('settings.push.achievements', 'Achievements') },
            { key: 'engagement',   icon: Heart,  label: tFallback('settings.push.engagement',   'Welcome back') },
          ].map(({ key, icon: Icon, label }) => {
            const labelId = `settings-push-pref-label-${key}`;
            const snoozeExpiry = snoozes[key];
            const snoozeLeft = snoozeExpiry ? formatSnoozeLeft(snoozeExpiry) : null;
            const isOn = prefs[key] !== false;
            const snoozeOpen = snoozeOpenFor === key;
            return (
              <div key={key} className="relative flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Icon className="w-3 h-3 text-muted-foreground/70 shrink-0" aria-hidden="true" />
                  <p id={labelId} className="text-[11px] text-muted-foreground leading-tight">{label}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {isOn && (
                    <button
                      type="button"
                      onClick={() => setSnoozeOpenFor(snoozeOpen ? null : key)}
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-colors ${
                        snoozeLeft
                          ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                          : 'text-muted-foreground/70 hover:bg-secondary/50 hover:text-foreground'
                      }`}
                      aria-label={tFallback('settings.snooze.label', 'Snooze')}
                    >
                      <BellOff className="w-2.5 h-2.5" />
                      {snoozeLeft || ''}
                    </button>
                  )}
                  <ToggleSwitch
                    checked={isOn}
                    onChange={() => handlePrefToggle(key)}
                    labelledBy={labelId}
                  />
                </div>
                {snoozeOpen && (
                  <div className="absolute right-12 top-6 z-30 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-card border border-border shadow-xl">
                    {[
                      { mins: 60,    label: '1h' },
                      { mins: 240,   label: '4h' },
                      { mins: 1440,  label: '24h' },
                    ].map(opt => (
                      <button
                        key={opt.mins}
                        type="button"
                        onClick={() => handleSnoozeCategory(key, opt.mins)}
                        className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-secondary/60 hover:bg-secondary text-foreground"
                      >
                        {opt.label}
                      </button>
                    ))}
                    {snoozeLeft && (
                      <button
                        type="button"
                        onClick={() => handleSnoozeCategory(key, 0)}
                        className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide text-destructive hover:bg-destructive/10"
                      >
                        {tFallback('settings.snooze.clear', 'Clear')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Quiet hours — do-not-disturb window. NULL = always-on. When
          set, the push trigger (mig 098) short-circuits push delivery
          inside the window; in-app rows still insert. Window wraps
          midnight (e.g. 22 → 7). */}
      {push.isSupported && (
        <div className="pl-5 -mt-1 space-y-2 border-l border-border/60 ml-1.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Moon className="w-3 h-3 text-muted-foreground/70 shrink-0" aria-hidden="true" />
              <p id="settings-quiet-label" className="text-[11px] text-muted-foreground leading-tight">
                {tFallback('settings.quiet.title', 'Quiet hours')}
              </p>
            </div>
            <ToggleSwitch
              checked={quietEnabled}
              onChange={(next) =>
                updateQuietHours(next ? { start: 22, end: 7 } : { start: null, end: null })
              }
              labelledBy="settings-quiet-label"
            />
          </div>
          {quietEnabled && (
            <>
              <div className="flex items-center gap-2 pl-5">
                <select
                  value={quietHours.start ?? 22}
                  onChange={(e) => updateQuietHours({ ...quietHours, start: Number(e.target.value) })}
                  className="px-2 py-1 rounded-md bg-secondary text-xs font-medium border border-border focus:outline-none focus:ring-2 focus:ring-primary/40"
                  aria-label="Quiet hours start (24-hour clock)"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{formatHour12(h)}</option>
                  ))}
                </select>
                <span className="text-[11px] text-muted-foreground" aria-hidden="true">→</span>
                <select
                  value={quietHours.end ?? 7}
                  onChange={(e) => updateQuietHours({ ...quietHours, end: Number(e.target.value) })}
                  className="px-2 py-1 rounded-md bg-secondary text-xs font-medium border border-border focus:outline-none focus:ring-2 focus:ring-primary/40"
                  aria-label="Quiet hours end (24-hour clock)"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{formatHour12(h)}</option>
                  ))}
                </select>
              </div>
              {quietHours.start != null && quietHours.end != null && quietHours.start === quietHours.end && (
                // The push trigger (mig 098) treats start == end as
                // "no quiet hours" — surface the degenerate state to
                // the user so they don't think DND is active when it
                // silently isn't. (Audit 14 #18.)
                <p className="pl-5 text-[10px] text-amber-500/90 leading-tight">
                  {tFallback(
                    'settings.quiet.equalWarn',
                    'Start and end are the same — quiet hours are effectively off. Pick different times.'
                  )}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Workout volume math — audit C-3. Default off so historical
          leaderboard totals don't suddenly inflate ~20% for users who
          never opted in. When on, barbell exercises include the bar
          weight in volume calculation (45-lb Olympic, or whatever
          the user's active bar is set to in barInventory). */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Dumbbell className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p id="settings-bar-volume-label" className="text-xs text-foreground leading-tight">
              {tFallback('settings.includeBarVolume', 'Include bar weight in volume')}
            </p>
            <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
              {tFallback('settings.includeBarVolumeHint', 'Adds the bar (e.g. 45 lb) on barbell lifts')}
            </p>
          </div>
        </div>
        <ToggleSwitch
          checked={!!profile?.include_bar_in_volume}
          onChange={async (next) => {
            const prev = !!profile?.include_bar_in_volume;
            queryClient.setQueryData(['userProfile', user?.email], (old) => old ? { ...old, include_bar_in_volume: next } : old);
            try {
              await db.auth.updateMe({ include_bar_in_volume: next });
              queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
            } catch {
              queryClient.setQueryData(['userProfile', user?.email], (old) => old ? { ...old, include_bar_in_volume: prev } : old);
              toast.error(tFallback('settings.includeBarVolume.saveFailed', 'Could not save — try again.'));
            }
          }}
          labelledBy="settings-bar-volume-label"
        />
      </div>

      {/* Body Stats */}
      <div className="border-t border-border pt-3 mt-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Body Stats</p>
        {editingStat ? (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground block">
              {editingStat === 'weight_lbs' ? `Weight (${weightUnit})` : editingStat === 'height_inches' ? 'Height (inches, e.g. 70 = 5\'10")' : 'Date of birth'}
            </label>
            <div className="flex gap-1.5">
              <input
                type={editingStat === 'birthday' ? 'date' : 'number'}
                value={statValue}
                onChange={e => setStatValue(e.target.value)}
                className="flex-1 h-8 rounded-md border border-border bg-secondary/50 px-2 text-xs text-foreground focus:outline-none focus:border-primary/50"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') saveStatEdit();
                  if (editingStat !== 'birthday' && ['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
                }}
              />
              <button
                onClick={saveStatEdit}
                disabled={statSaving || !statValue}
                className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setEditingStat(null); setStatValue(''); }}
                className="h-8 w-8 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {[
              {
                icon: Scale, label: 'Weight', field: 'weight_lbs',
                display: profile?.weight_lbs ? `${formatWeightNumber(profile.weight_lbs, weightUnit)} ${weightUnit}` : '—',
                editValue: profile?.weight_lbs ? String(formatWeightNumber(profile.weight_lbs, weightUnit)) : '',
              },
              {
                icon: Ruler, label: 'Height', field: 'height_inches',
                display: profile?.height_inches ? formatHeight(profile.height_inches) : '—',
                editValue: profile?.height_inches ? String(Math.round(profile.height_inches)) : '',
              },
              {
                icon: User, label: 'Age', field: 'birthday',
                display: profile?.birthday ? `${differenceInYears(new Date(), new Date(profile.birthday))} yrs` : '—',
                editValue: profile?.birthday ? profile.birthday.slice(0, 10) : '',
              },
            ].map(({ icon: Icon, label, field, display, editValue: ev }) => (
              <button
                key={field}
                onClick={() => { setEditingStat(field); setStatValue(ev); setInitialStatValue(ev); }}
                className="w-full flex items-center justify-between py-1 px-1 rounded-md hover:bg-secondary/60 transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-foreground">{label}</span>
                </div>
                <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">{display}</span>
              </button>
            ))}

            {/* Sex — segmented toggle (saves on tap). Calibrates strength,
                volume, and calorie targets. */}
            <div className="w-full flex items-center justify-between py-1 px-1">
              <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-foreground">{tFallback('onboarding.demographics.gender', 'Sex')}</span>
              </div>
              <div className="flex gap-1">
                {[{ id: 'male', label: 'Male' }, { id: 'female', label: 'Female' }].map(({ id, label }) => {
                  const active = (profile?.gender || '').toLowerCase() === id;
                  return (
                    <button
                      key={id}
                      onClick={() => saveGender(id)}
                      disabled={genderSaving}
                      className={`px-2.5 h-7 rounded-md text-xs font-semibold border transition-colors disabled:opacity-50 ${
                        active
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'border-border text-muted-foreground hover:bg-secondary'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Story settings */}
      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Story Settings</p>

        {/* Allow DM replies */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <MessageCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
            <p className="text-xs text-foreground leading-tight">
              {tFallback('settings.story.dmRepliesLabel', 'Allow DM replies to my stories')}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={!storyDmsDisabled}
            aria-label={tFallback('settings.story.dmRepliesLabel', 'Allow DM replies to my stories')}
            onClick={async () => {
              const next = !storyDmsDisabled;
              setStoryDmsDisabled(next);
              await updateStoryDmsSettings(user?.id, next);
              queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${!storyDmsDisabled ? 'bg-primary' : 'bg-muted'}`}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${!storyDmsDisabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Default visibility */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {defaultPrivacy === 'friends'
              ? <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
              : <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
            }
            <div className="min-w-0">
              <p className="text-xs text-foreground leading-tight">Default story visibility</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {defaultPrivacy === 'friends' ? 'Friends Only (private)' : 'Public'}
              </p>
            </div>
          </div>
          <div className="flex gap-1" role="group" aria-label="Default story visibility">
            {[
              { value: 'friends', label: 'Friends', Icon: Lock },
              { value: 'public',  label: 'Public',  Icon: Globe },
            ].map(({ value, label, Icon }) => (
              <button
                key={value}
                onClick={async () => {
                  setDefaultPrivacy(value);
                  await updateDefaultStoryPrivacy(user?.id, value);
                  queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
                }}
                aria-pressed={defaultPrivacy === value}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border transition-colors ${
                  defaultPrivacy === value
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-border text-muted-foreground hover:bg-secondary'
                }`}
              >
                <Icon className="w-2.5 h-2.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Block list */}
        <div>
          <button
            onClick={() => {
              setStoryBlocksOpen(v => !v);
              if (!storyBlocksOpen) loadStoryBlocks();
            }}
            className="flex items-center justify-between w-full py-1 px-1 rounded-md hover:bg-secondary/60 transition-colors group"
          >
            <div className="flex items-center gap-2">
              <ShieldOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-foreground">Blocked accounts</span>
            </div>
            {storyBlocksOpen
              ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            }
          </button>

          {storyBlocksOpen && (
            <div className="mt-2 space-y-2 pl-5">
              {/* Add new block */}
              <div className="flex gap-1.5">
                <input
                  type="email"
                  value={blockEmail}
                  onChange={e => setBlockEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleBlockAdd()}
                  placeholder="Email to block…"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 h-7 rounded-md border border-border bg-secondary/50 px-2 text-[11px] text-foreground placeholder-muted-foreground/60 focus:outline-none focus:border-primary/50"
                />
                <button
                  onClick={handleBlockAdd}
                  disabled={!blockEmail.trim() || blockSaving}
                  className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold disabled:opacity-50 flex items-center gap-1"
                >
                  {blockSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Block'}
                </button>
              </div>

              {/* Existing blocks */}
              {storyBlocks.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No accounts blocked.</p>
              ) : (
                <div className="space-y-1">
                  {storyBlocks.map(b => (
                    <div key={b.blocked_email} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <UserX className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-[11px] text-foreground truncate">{b.blocked_email}</span>
                      </div>
                      <button
                        onClick={() => handleUnblock(b.blocked_email)}
                        className="text-[10px] text-primary font-medium shrink-0"
                      >
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Two-factor auth status + enrollment flow. Lives just above
          Privacy because account security is a related concern. */}
      <TwoFactorSection />

      {/* Connected apps — placeholder for Strava / Apple Health /
          Google Fit integrations (coming soon). */}
      <ConnectedAppsSection />

      {/* Privacy mode toggles (mig 117). Optimistic + reverting on
          failure; both flags persist to user_profiles so the choice
          follows the user across devices. */}
      <div className="border-t border-border pt-3 mt-1 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Privacy</h3>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p id="settings-private-label" className="text-xs text-foreground">Private profile</p>
            <p className="text-[10px] text-muted-foreground">Only followers see your level, workouts, and progress photos.</p>
          </div>
          <ToggleSwitch
            checked={isPrivate}
            onChange={(next) => togglePrivacy('is_private', next)}
            labelledBy="settings-private-label"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p id="settings-hidesearch-label" className="text-xs text-foreground">Hide from search</p>
            <p className="text-[10px] text-muted-foreground">Your account won't appear in search results or "People you may know."</p>
          </div>
          <ToggleSwitch
            checked={hideFromSearch}
            onChange={(next) => togglePrivacy('hide_from_search', next)}
            labelledBy="settings-hidesearch-label"
          />
        </div>
      </div>

      {/* Download my data — one-tap export of all user-owned rows
          across the known tables. Triggers a JSON file download. */}
      <button
        onClick={handleDataExport}
        disabled={exporting}
        className="flex items-center gap-2 w-full py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {exporting
          ? <><Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> Preparing export…</>
          : <><FileText className="w-3.5 h-3.5 shrink-0" /> Download my data</>}
      </button>

      {/* Bug report */}
      <button
        onClick={() => setBugReportOpen(true)}
        className="flex items-center gap-2 w-full py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border-t border-border pt-3 mt-1"
      >
        <Bug className="w-3.5 h-3.5 shrink-0" />
        {t('bugReport.button')}
      </button>

      {/* Moderator-only: link to the report queue. Gated by isAppAdmin() —
          renders nothing for non-admin users so it isn't even discoverable. */}
      {isAppAdmin(user) && (
        <Link
          to="/admin/reports"
          className="flex items-center gap-2 w-full py-1.5 text-xs text-amber-500 hover:text-amber-400 transition-colors"
        >
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          Open report queue
        </Link>
      )}

      {/* Build hash — diagnostic signal so users (and we) can confirm which
          commit their device is actually running. Tap to copy a full
          diagnostic blob to clipboard, useful for support tickets. We hit
          a hard-to-diagnose stale-deploy bug recently; this is the
          forever-fix so nobody has to play archaeologist again. */}
      <button
        type="button"
        onClick={async () => {
          // Explicitly detect missing clipboard API rather than letting
          // `navigator.clipboard?.writeText(...)` silently no-op into a
          // resolved Promise<undefined> — that path used to surface a
          // false "Copied!" toast on insecure-context HTTP and on
          // browsers without the API. (Audit 14 #30.)
          if (!navigator?.clipboard?.writeText) {
            toast.error('Clipboard not available — copy from the diagnostic dialog below.');
            return;
          }
          try {
            await navigator.clipboard.writeText(diagnosticString());
            toast.success('Copied build info to clipboard.');
          } catch {
            toast.error('Could not copy — your browser blocked clipboard access.');
          }
        }}
        className="block w-full text-left py-2 text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        aria-label="Copy build diagnostic info to clipboard"
      >
        {buildLabel()}
      </button>

      {/* Blocked users — full-scope blocks from mig 106. Shows the
          unblock control. story_blocks live in a separate Settings
          section already (handled elsewhere in this file). */}
      {myBlocks.length > 0 && (
        <div className="mt-6 pt-4 border-t border-border">
          <div className="flex items-center gap-2 mb-2">
            <Ban className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Blocked users
            </h3>
          </div>
          <ul className="space-y-1.5">
            {myBlocks.map(b => (
              <li key={b.blocked_email} className="flex items-center justify-between gap-2 text-xs p-2 rounded-lg bg-secondary/40">
                <span className="text-foreground truncate">{b.blocked_email}</span>
                <button
                  onClick={() => handleUnblockFull(b.blocked_email)}
                  className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border border-border hover:bg-secondary"
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Muted users — soft hides from mig 107. */}
      {myMutes.length > 0 && (
        <div className="mt-6 pt-4 border-t border-border">
          <div className="flex items-center gap-2 mb-2">
            <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Muted users
            </h3>
          </div>
          <ul className="space-y-1.5">
            {myMutes.map(m => (
              <li key={m.muted_email} className="flex items-center justify-between gap-2 text-xs p-2 rounded-lg bg-secondary/40">
                <span className="text-foreground truncate">{m.muted_email}</span>
                <button
                  onClick={() => handleUnmute(m.muted_email)}
                  className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border border-border hover:bg-secondary"
                >
                  Unmute
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* My reports — shows the user the status of every report they
          filed. Status updates fire a notification via mig 104, but
          this is the persistent surface they can come back to. */}
      {myReports.length > 0 && (
        <div className="mt-6 pt-4 border-t border-border">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              My reports
            </h3>
          </div>
          <ul className="space-y-2">
            {myReports.map(r => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 text-xs p-2 rounded-lg bg-secondary/40"
              >
                <span className="text-foreground capitalize">
                  {r.reported_type} · {r.reason.replace('_', ' ')}
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  r.status === 'pending'   ? 'bg-amber-500/15 text-amber-500'
                  : r.status === 'actioned' ? 'bg-emerald-500/15 text-emerald-500'
                  : r.status === 'reviewed' ? 'bg-blue-500/15 text-blue-500'
                  : 'bg-secondary text-muted-foreground'
                }`}>
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <BugReportDialog open={bugReportOpen} onClose={() => setBugReportOpen(false)} />
    </div>
  );
}