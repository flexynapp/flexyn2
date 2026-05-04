import { useState } from 'react';
import { useSettings } from '@/lib/SettingsContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Bell, Dumbbell, Languages, Ruler, Pause, Timer, Sparkles, Circle, Bug, Scale, User, Check, X } from 'lucide-react';
import LanguagePicker from './LanguagePicker';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import BugReportDialog from './BugReportDialog';
import { useAuth } from '@/lib/AuthContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toLbs, fromLbs, formatWeightNumber } from '@/lib/weightUnit';
import { differenceInYears, format } from 'date-fns';

export default function SettingsPanel() {
  const { t } = useLanguage();
  const { distanceUnit, setDistanceUnit } = useDistanceUnit();
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const { user } = useAuth();
  const { weightUnit } = useWeightUnit();
  const queryClient = useQueryClient();
  const [editingStat, setEditingStat] = useState(null); // 'weight_lbs' | 'height_inches' | 'birthday'
  const [statValue, setStatValue] = useState('');
  const [statSaving, setStatSaving] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => base44.auth.me(),
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  const saveStatEdit = async () => {
    if (!editingStat || !statValue) return;
    setStatSaving(true);
    try {
      if (editingStat === 'birthday') {
        await base44.auth.updateMe({ birthday: statValue });
      } else {
        let parsed = parseFloat(statValue);
        if (isNaN(parsed)) return;
        if (editingStat === 'weight_lbs') parsed = toLbs(parsed, weightUnit);
        await base44.auth.updateMe({ [editingStat]: parsed });
      }
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      setEditingStat(null);
      setStatValue('');
    } catch (err) {
      console.error('Stat update failed:', err);
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
    { icon: Bell, label: t('settings.notifications'), value: enableNotifications, onChange: setEnableNotifications },
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
                onClick={() => { setEditingStat(field); setStatValue(ev); }}
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