// src/components/settings/TrainingSection.jsx
//
// Settings that change how a session behaves or how its numbers are
// counted. Small page on purpose — these three were scattered between the
// notification toggles and the body stats, so none of them read as being
// about training.

import { Pause, Timer, Dumbbell } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useSettings } from '@/lib/SettingsContext';
import { db } from '@/api/db';
import { toast } from '@/lib/toast';
import { useSettingsProfile } from './useSettingsProfile';
import { Group, ToggleRow } from './SettingsPrimitives';

export default function TrainingSection() {
  const { t, tFallback } = useLanguage();
  const { user, profile, queryClient, invalidateProfile } = useSettingsProfile();
  const {
    cardioAutoPause, setCardioAutoPause,
    restTimerEnabled, setRestTimerEnabled,
  } = useSettings();

  return (
    <div className="flex flex-col gap-6">
      <Group title={tFallback('settings.group.session', 'During a session')}>
        <ToggleRow
          icon={Pause}
          label={t('cardio.settings.autoPause')}
          checked={cardioAutoPause}
          onChange={setCardioAutoPause}
        />
        <ToggleRow
          icon={Timer}
          label={t('settings.restTimer')}
          checked={restTimerEnabled}
          onChange={setRestTimerEnabled}
        />
      </Group>

      <Group title={tFallback('settings.group.volumeMath', 'Volume math')}>
        {/* Audit C-3. Default off so historical leaderboard totals don't
            suddenly inflate ~20% for users who never opted in. When on,
            barbell exercises include the bar weight in the volume
            calculation (45-lb Olympic, or whatever the user's active bar
            is set to in barInventory). */}
        <ToggleRow
          icon={Dumbbell}
          label={tFallback('settings.includeBarVolume', 'Include bar weight in volume')}
          hint={tFallback('settings.includeBarVolumeHint', 'Adds the bar (e.g. 45 lb) on barbell lifts')}
          checked={!!profile?.include_bar_in_volume}
          onChange={async (next) => {
            const prev = !!profile?.include_bar_in_volume;
            queryClient.setQueryData(['userProfile', user?.email], (old) => old ? { ...old, include_bar_in_volume: next } : old);
            try {
              await db.auth.updateMe({ include_bar_in_volume: next });
              invalidateProfile();
            } catch {
              queryClient.setQueryData(['userProfile', user?.email], (old) => old ? { ...old, include_bar_in_volume: prev } : old);
              toast.error(tFallback('settings.includeBarVolume.saveFailed', 'Could not save — try again.'));
            }
          }}
        />
      </Group>
    </div>
  );
}
