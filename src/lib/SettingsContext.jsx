import { createContext, useContext, useState } from 'react';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [allowDeleteCompletedGoals, setAllowDeleteCompletedGoals] = useState(
    () => localStorage.getItem('fn-delete-completed-goals') === 'true'
  );
  const [enableNotifications, setEnableNotifications] = useState(
    () => localStorage.getItem('fn-enable-notifications') !== 'false'
  );
  const [enableWorkoutReminders, setEnableWorkoutReminders] = useState(
    () => localStorage.getItem('fn-enable-workout-reminders') !== 'false'
  );
  const [compactView, setCompactView] = useState(
    () => localStorage.getItem('fn-compact-view') === 'true'
  );
  const [cardioVoiceCues, setCardioVoiceCues] = useState(
    () => localStorage.getItem('fn-cardio-voice-cues') !== 'false'
  );
  const [cardioAutoPause, setCardioAutoPause] = useState(
    () => localStorage.getItem('fn-cardio-auto-pause') !== 'false'
  );
  const [restTimerEnabled, setRestTimerEnabledState] = useState(
    () => localStorage.getItem('fn-rest-timer-enabled') !== 'false'
  );
  const [levelAnimationsEnabled, setLevelAnimationsEnabledState] = useState(
    () => localStorage.getItem('fn-level-animations-enabled') !== 'false'
  );
  const [nutrientRingView, setNutrientRingViewState] = useState(
    () => localStorage.getItem('fn-nutrient-ring-view') === 'true'
  );
  // Calorie cycling (training-vs-rest-day targets) is an advanced feature —
  // off by default. When enabled, its entry point appears on the Nutrition page.
  const [calorieCyclingEnabled, setCalorieCyclingEnabledState] = useState(
    () => localStorage.getItem('fn-calorie-cycling-enabled') === 'true'
  );

  const toggleSetting = (key, value) => {
    localStorage.setItem(key, value);
  };

  return (
    <SettingsContext.Provider value={{ 
      allowDeleteCompletedGoals, 
      setAllowDeleteCompletedGoals: (val) => {
        setAllowDeleteCompletedGoals(val);
        toggleSetting('fn-delete-completed-goals', val);
      },
      enableNotifications,
      setEnableNotifications: (val) => {
        setEnableNotifications(val);
        toggleSetting('fn-enable-notifications', val);
      },
      enableWorkoutReminders,
      setEnableWorkoutReminders: (val) => {
        setEnableWorkoutReminders(val);
        toggleSetting('fn-enable-workout-reminders', val);
      },
      compactView,
      setCompactView: (val) => {
        setCompactView(val);
        toggleSetting('fn-compact-view', val);
      },
      cardioVoiceCues,
      setCardioVoiceCues: (val) => {
        setCardioVoiceCues(val);
        toggleSetting('fn-cardio-voice-cues', val);
      },
      cardioAutoPause,
      setCardioAutoPause: (val) => {
        setCardioAutoPause(val);
        toggleSetting('fn-cardio-auto-pause', val);
      },
      restTimerEnabled,
      setRestTimerEnabled: (val) => {
        setRestTimerEnabledState(val);
        toggleSetting('fn-rest-timer-enabled', val);
      },
      levelAnimationsEnabled,
      setLevelAnimationsEnabled: (val) => {
        setLevelAnimationsEnabledState(val);
        toggleSetting('fn-level-animations-enabled', val);
      },
      nutrientRingView,
      setNutrientRingView: (val) => {
        setNutrientRingViewState(val);
        toggleSetting('fn-nutrient-ring-view', val);
      },
      calorieCyclingEnabled,
      setCalorieCyclingEnabled: (val) => {
        setCalorieCyclingEnabledState(val);
        toggleSetting('fn-calorie-cycling-enabled', val);
      },
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}