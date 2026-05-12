import { useState } from 'react';
import { useSettings } from '@/lib/SettingsContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Bell, BellRing, Dumbbell, Languages, Ruler, Pause, Timer, Sparkles, Circle, Bug, Scale, User, Check, X, Loader2 } from 'lucide-react';
import LanguagePicker from './LanguagePicker';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import BugReportDialog from './BugReportDialog';
import { useAuth } from '@/lib/AuthContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { db } from '@/api/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toLbs, fromLbs, formatWeightNumber } from '@/lib/weightUnit';
import { differenceInYears, format } from 'date-fns';
import { usePushSubscription } from '@/lib/usePushSubscription';
import { toast } from 'sonner';

export default function SettingsPanel() {
  const { t, tFallback } = useLanguage();
  const { distanceUnit, setDistanceUnit } = useDistanceUnit();
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const { user } = useAuth();
  const { weightUnit } = useWeightUnit();
  const queryClient = useQueryClient();
  const [editingStat, setEditingStat] = useState(null); // 'weight_lbs' | 'height_inches' | 'birthday'
  const [statValue, setStatValue] = useState('');
  const [initialStatValue, setInitialStatValue] = useState('');
  const [statSaving, setStatSaving] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
    staleTime: 60_000,
  });

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
          toast.error('Invalid date.');
          return;
        }
        if (d > new Date()) {
          toast.error("Birthday can't be in the future.");
          return;
        }
        const yearsAgo = (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (yearsAgo > 120) {
          toast.error('Please enter a realistic birthday.');
          return;
        }
        if (yearsAgo < 13) {
          toast.error('You must be 13 or older to use Flexyn.');
          return;
        }
        await db.auth.updateMe({ birthday: statValue });
      } else {
        const parsed = parseFloat(statValue);
        if (isNaN(parsed) || parsed <= 0) {
          toast.error('Please enter a number greater than zero.');
          return;
        }
        // Range validation per stat so a fat-finger entry doesn't corrupt
        // the profile. Anti-cheat already validates set-level weights/reps,
        // but profile-level values were unguarded.
        if (editingStat === 'weight_lbs') {
          const lbs = toLbs(parsed, weightUnit);
          if (lbs < 50 || lbs > 800) {
            toast.error('Weight must be between 50 and 800 lb (23–363 kg).');
            return;
          }
          await db.auth.updateMe({ weight_lbs: lbs });
        } else if (editingStat === 'height_inches') {
          if (parsed < 24 || parsed > 96) {
            toast.error('Height must be between 24 and 96 inches (61–244 cm).');
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
      toast.error('Could not save — try again.');
    } finally {
      setStatSaving(false);
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

  // Handler for the push toggle. Translates browser-level outcomes
  // into user-friendly toasts so the toggle never silently fails.
  const handlePushToggle = async () => {
    if (push.isSubscribed) {
      const res = await push.unsubscribe();
      if (res.ok) {
        toast.success(t('settings.push.disabled') === 'settings.push.disabled'
          ? 'Push notifications disabled.' : t('settings.push.disabled'));
      } else {
        toast.error('Could not disable push notifications.');
      }
      return;
    }
    const res = await push.subscribe();
    if (res.ok) {
      toast.success(t('settings.push.enabled') === 'settings.push.enabled'
        ? 'Push notifications enabled!' : t('settings.push.enabled'));
    } else if (res.reason === 'denied') {
      toast.error('Permission denied — enable notifications in your browser settings.');
    } else if (res.reason === 'unsupported') {
      toast.error('Push notifications not supported on this device.');
    } else if (res.reason === 'server_error') {
      toast.error('Could not save your subscription. Try again.');
    }
    // 'default' (user dismissed without choosing) → no toast, they'll try again.
  };

  const ToggleSwitch = ({ checked, onChange }) => (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
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
        <div className="flex gap-1.5">
          {[
            { value: 'mi', label: t('settings.distanceUnit.mi') },
            { value: 'km', label: t('settings.distanceUnit.km') },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setDistanceUnit(opt.value)}
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
      {settings.map((setting, i) => {
        const Icon = setting.icon;
        return (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <p className="text-xs text-foreground leading-tight">{setting.label}</p>
            </div>
            <ToggleSwitch checked={setting.value} onChange={setting.onChange} />
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
            <BellRing className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-foreground leading-tight">
                {t('settings.pushNotifications') === 'settings.pushNotifications'
                  ? 'Push notifications'
                  : t('settings.pushNotifications')}
              </p>
              {push.permission === 'denied' && (
                <p className="text-[10px] text-destructive leading-tight mt-0.5">
                  Blocked — change in browser settings
                </p>
              )}
            </div>
          </div>
          {push.isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <ToggleSwitch
              checked={push.isSubscribed}
              onChange={handlePushToggle}
            />
          )}
        </div>
      )}

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
          </div>
        )}
      </div>

      {/* Bug report */}
      <button
        onClick={() => setBugReportOpen(true)}
        className="flex items-center gap-2 w-full py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border-t border-border pt-3 mt-1"
      >
        <Bug className="w-3.5 h-3.5 shrink-0" />
        {t('bugReport.button')}
      </button>

      <BugReportDialog open={bugReportOpen} onClose={() => setBugReportOpen(false)} />
    </div>
  );
}