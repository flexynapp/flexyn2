// src/components/settings/PreferencesSection.jsx
//
// How the app presents itself: language, the two measurement units,
// light/dark, and the three feedback channels (animation, vibration,
// sound).
//
// Grouped this way because these are the settings a user changes once,
// right after installing, and then never touches — as opposed to
// Notifications, which they come back to. Keeping them off the
// Notifications page is the point: "Level-up animations" reads as a
// notification setting and isn't one, it's a display preference, and it
// used to sit two rows above the actual in-app alert toggle.

import { useState } from 'react';
import { Languages, Ruler, Scale, Sun, Moon, Sparkles, Vibrate, Volume2 } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { useTheme } from '@/lib/ThemeContext';
import { useSettings } from '@/lib/SettingsContext';
import { getHapticsDisabled, setHapticsDisabled, triggerHaptic } from '@/lib/haptic';
import { getSoundsEnabled, setSoundsEnabled, playSound, SOUND } from '@/lib/playSound';
import LanguagePicker from '../LanguagePicker';
import { Group, Row, ToggleRow, SegmentedControl } from './SettingsPrimitives';

export default function PreferencesSection() {
  const { t, tFallback } = useLanguage();
  const { distanceUnit, setDistanceUnit } = useDistanceUnit();
  const { weightUnit, setWeightUnit } = useWeightUnit();
  const { darkMode, setDarkMode } = useTheme();
  const { levelAnimationsEnabled, setLevelAnimationsEnabled } = useSettings();

  // Local mirrors of the per-device tactile preferences. Both are
  // backed by localStorage (not server) — a user who silenced one
  // phone shouldn't silence another. Initialized from the helper so
  // the toggles reflect persisted state on every mount.
  const [hapticsEnabled, setHapticsEnabledLocal] = useState(() => !getHapticsDisabled());
  const [soundsEnabled,  setSoundsEnabledLocal]  = useState(() => getSoundsEnabled());

  // Desktops and iOS-without-permission don't expose navigator.vibrate at
  // all, so flipping the haptics toggle there does nothing. Surface that
  // rather than leaving the user wondering. (Audit 14 #15.)
  const vibrationSupported = typeof navigator === 'undefined' || 'vibrate' in navigator;

  return (
    <div className="flex flex-col gap-6">
      <Group title={t('settings.language')}>
        <div className="py-2">
          <div className="flex items-center gap-2 min-h-11">
            <Languages className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <p className="text-body text-foreground flex-1">{t('settings.language')}</p>
          </div>
          <LanguagePicker variant="compact" />
        </div>
      </Group>

      <Group title={tFallback('settings.group.units', 'Units')}>
        <div className="py-2">
          <Row icon={Ruler} label={t('settings.distanceUnit')} />
          <SegmentedControl
            value={distanceUnit}
            onChange={setDistanceUnit}
            ariaLabel={t('settings.distanceUnit')}
            options={[
              { value: 'mi', label: t('settings.distanceUnit.mi') },
              { value: 'km', label: t('settings.distanceUnit.km') },
            ]}
          />
        </div>
        {/* Weight unit — previously the only way to change this after
            onboarding was via the inline UnitPill on log-weight modals,
            which most users never opened. The asymmetry with the distance
            unit toggle right above this read as broken. (Audit 14 #1.) */}
        <div className="py-2">
          <Row icon={Scale} label={tFallback('settings.weightUnit', 'Weight unit')} />
          <SegmentedControl
            value={weightUnit}
            onChange={setWeightUnit}
            ariaLabel={tFallback('settings.weightUnit', 'Weight unit')}
            options={[
              { value: 'lbs',   label: tFallback('settings.weightUnit.lbs',   'lbs') },
              { value: 'kg',    label: tFallback('settings.weightUnit.kg',    'kg') },
              { value: 'stone', label: tFallback('settings.weightUnit.stone', 'st') },
            ]}
          />
        </div>
      </Group>

      <Group title={tFallback('settings.group.display', 'Display')}>
        {/* Appearance — light vs dark. Mirrors the quick picker in
            ProfileMenu; Settings is the discoverable home so users
            searching for it find it here too. */}
        <div className="py-2">
          <Row
            icon={darkMode ? Moon : Sun}
            label={tFallback('settings.appearance', 'Appearance')}
          />
          <SegmentedControl
            value={darkMode ? 'dark' : 'light'}
            onChange={(v) => setDarkMode(v === 'dark')}
            ariaLabel={tFallback('settings.appearance', 'Appearance')}
            options={[
              { value: 'light', label: tFallback('settings.appearance.light', 'Light'), icon: Sun },
              { value: 'dark',  label: tFallback('settings.appearance.dark',  'Dark'),  icon: Moon },
            ]}
          />
        </div>
        <ToggleRow
          icon={Sparkles}
          label={t('settings.levelAnimations')}
          checked={levelAnimationsEnabled}
          onChange={setLevelAnimationsEnabled}
        />
      </Group>

      <Group title={tFallback('settings.group.feedback', 'Feedback')}>
        {/* The haptics toggle fires a sample tick on enable so the user
            immediately feels what it's controlling. */}
        <ToggleRow
          icon={Vibrate}
          label={tFallback('settings.haptics', 'Haptic feedback')}
          hint={!vibrationSupported
            ? tFallback('settings.haptics.unsupported', 'Vibration is not supported on this device.')
            : undefined}
          checked={hapticsEnabled}
          onChange={(next) => {
            setHapticsEnabledLocal(next);
            setHapticsDisabled(!next);
            if (next) triggerHaptic('primary'); // sample feel
          }}
        />
        {/* Sound effects — opt-in, default off. When on, primary actions
            play very short chimes (save, PR, capsule open). Most users
            leave this off, but a small audience loves it. */}
        <ToggleRow
          icon={Volume2}
          label={tFallback('settings.sounds', 'Sound effects')}
          checked={soundsEnabled}
          onChange={(next) => {
            setSoundsEnabledLocal(next);
            setSoundsEnabled(next);
            if (next) playSound(SOUND.click); // sample on enable
          }}
        />
      </Group>
    </div>
  );
}
