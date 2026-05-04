import { useState } from 'react';
import { useSettings } from '@/lib/SettingsContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Bell, Dumbbell, Languages, Ruler, Pause, Timer, Sparkles, Circle, Bug } from 'lucide-react';
import LanguagePicker from './LanguagePicker';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import BugReportDialog from './BugReportDialog';

export default function SettingsPanel() {
  const { t } = useLanguage();
  const { distanceUnit, setDistanceUnit } = useDistanceUnit();
  const [bugReportOpen, setBugReportOpen] = useState(false);
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