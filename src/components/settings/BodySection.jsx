// src/components/settings/BodySection.jsx
//
// The four body stats plus the three nutrition display/behaviour flags.
//
// These belong together because they share a consumer: weight, height, age
// and sex all feed BMR, water intake, VO2max, strength ceilings and
// nutrition targets, and calorie cycling is what those targets get spent
// on. Splitting them across two pages would separate a number from the
// thing it changes.

import { useState } from 'react';
import { Scale, Ruler, User, Check, X, Circle, Repeat, Heart } from 'lucide-react';
import { differenceInYears } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';
import { useSettings } from '@/lib/SettingsContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { toLbs, formatWeightNumber } from '@/lib/weightUnit';
import { db } from '@/api/db';
import { toast } from '@/lib/toast';
import { useSettingsProfile } from './useSettingsProfile';
import { Group, Row, ToggleRow, SegmentedControl } from './SettingsPrimitives';

export default function BodySection() {
  const { tFallback } = useLanguage();
  const { profile, invalidateProfile } = useSettingsProfile();
  const { weightUnit } = useWeightUnit();
  const {
    nutrientRingView, setNutrientRingView,
    calorieCyclingEnabled, setCalorieCyclingEnabled,
  } = useSettings();

  const [editingStat, setEditingStat] = useState(null); // 'weight_lbs' | 'height_inches' | 'birthday'
  const [statValue, setStatValue] = useState('');
  const [initialStatValue, setInitialStatValue] = useState('');
  const [statSaving,   setStatSaving]   = useState(false);
  const [genderSaving, setGenderSaving] = useState(false);

  const formatHeight = (inches) => {
    if (!inches) return '—';
    const ft = Math.floor(inches / 12);
    const ins = Math.round(inches % 12);
    return `${ft}'${ins}"`;
  };

  const closeEdit = () => {
    setEditingStat(null);
    setStatValue('');
    setInitialStatValue('');
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
      closeEdit();
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
        // Catch dates like '2023-02-29' that JavaScript silently rolls
        // forward (to March 1, 2023) instead of rejecting. Round trip the
        // date through ISO and require an exact match.
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
        // Also sync the derived `age` column: every fitness calc (BMR,
        // water intake, VO2max, nutrition targets) reads `age`, which was
        // otherwise only written once at onboarding — so a birthday edit
        // must refresh it or those calcs stay frozen at the signup value.
        await db.auth.updateMe({ birthday: statValue, age: Math.floor(yearsAgo) });
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
      invalidateProfile();
      closeEdit();
    } catch (err) {
      // Surface the real cause instead of swallowing silently — the audit
      // caught that the previous `console.error` left users with no signal
      // the save failed.
      console.error('Stat update failed:', err);
      toast.error(tFallback('settings.validation.saveFailed', 'Could not save. Try again.'));
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
      invalidateProfile();
    } catch (err) {
      console.error('Gender update failed:', err);
      toast.error(tFallback('settings.validation.saveFailed', 'Could not save. Try again.'));
    } finally {
      setGenderSaving(false);
    }
  };

  // Cycle tracking master switch — persisted on user_profiles
  // (cycle_tracking_enabled). Off hides the tracker from the Progress ›
  // Body page entirely; on brings it back. The Body page's own "Remove"
  // button flips this off too, so this toggle re-enables it.
  const handleCycleTracking = async (next) => {
    try {
      await db.auth.updateMe({ cycle_tracking_enabled: next });
      invalidateProfile();
      toast.success(next ? 'Cycle tracking enabled.' : 'Cycle tracking removed.');
    } catch {
      toast.error(tFallback('cycleTracker.updateFailed', 'Could not update. Try again.'));
    }
  };

  const STATS = [
    {
      icon: Scale, label: tFallback('settings.stat.weight', 'Weight'), field: 'weight_lbs',
      display: profile?.weight_lbs ? `${formatWeightNumber(profile.weight_lbs, weightUnit)} ${weightUnit}` : '—',
      editValue: profile?.weight_lbs ? String(formatWeightNumber(profile.weight_lbs, weightUnit)) : '',
    },
    {
      icon: Ruler, label: tFallback('settings.stat.height', 'Height'), field: 'height_inches',
      display: profile?.height_inches ? formatHeight(profile.height_inches) : '—',
      editValue: profile?.height_inches ? String(Math.round(profile.height_inches)) : '',
    },
    {
      icon: User, label: tFallback('settings.stat.age', 'Age'), field: 'birthday',
      display: profile?.birthday ? `${differenceInYears(new Date(), new Date(profile.birthday))} yrs` : '—',
      editValue: profile?.birthday ? profile.birthday.slice(0, 10) : '',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Group
        title={tFallback('settings.group.bodyStats', 'Body stats')}
        description={tFallback(
          'settings.group.bodyStats.desc',
          'Calibrates calorie targets, starting weights and strength ceilings.'
        )}
      >
        {editingStat ? (
          <div className="py-2 space-y-2">
            <label htmlFor="settings-stat-input" className="text-caption text-muted-foreground block">
              {editingStat === 'weight_lbs'
                ? `${tFallback('settings.stat.weight', 'Weight')} (${weightUnit})`
                : editingStat === 'height_inches'
                  ? tFallback('settings.stat.heightHint', 'Height (inches, e.g. 70 = 5\'10")')
                  : tFallback('settings.stat.dob', 'Date of birth')}
            </label>
            <div className="flex gap-2">
              <input
                id="settings-stat-input"
                type={editingStat === 'birthday' ? 'date' : 'number'}
                value={statValue}
                onChange={e => setStatValue(e.target.value)}
                className="flex-1 min-h-11 rounded-lg border border-border bg-secondary/50 px-2 text-body text-foreground focus:outline-none focus:border-primary/50"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') saveStatEdit();
                  if (editingStat !== 'birthday' && ['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
                }}
              />
              <button
                type="button"
                onClick={saveStatEdit}
                disabled={statSaving || !statValue}
                className="h-11 w-11 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50 shrink-0"
                aria-label={tFallback('common.save', 'Save')}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={closeEdit}
                className="h-11 w-11 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary active:bg-secondary shrink-0"
                aria-label={tFallback('common.cancel', 'Cancel')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <>
            {STATS.map(({ icon: Icon, label, field, display, editValue: ev }) => (
              <button
                key={field}
                type="button"
                onClick={() => { setEditingStat(field); setStatValue(ev); setInitialStatValue(ev); }}
                className="w-full min-h-11 py-2 flex items-center gap-2 text-start rounded-lg transition-colors hover:bg-secondary/50 active:bg-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary group"
              >
                <Icon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <span className="flex-1 text-body text-foreground">{label}</span>
                <span className="text-body font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                  {display}
                </span>
              </button>
            ))}

            {/* Sex — segmented, saves on tap. Calibrates strength, volume
                and calorie targets. */}
            <div className="py-2">
              <Row icon={User} label={tFallback('onboarding.demographics.gender', 'Gender / Sex')} />
              <SegmentedControl
                value={(profile?.gender || '').toLowerCase()}
                onChange={saveGender}
                disabled={genderSaving}
                ariaLabel={tFallback('onboarding.demographics.gender', 'Gender / Sex')}
                options={[
                  { value: 'male',   label: tFallback('settings.sex.male',   'Male') },
                  { value: 'female', label: tFallback('settings.sex.female', 'Female') },
                ]}
              />
            </div>
          </>
        )}
      </Group>

      <Group title={tFallback('settings.group.nutrition', 'Nutrition')}>
        <ToggleRow
          icon={Circle}
          label={tFallback('settings.nutrientRingView', 'Nutrient ring view')}
          // Sean flipped all three of these on and said "I don't actually know
          // where that shows up." None of them is dead — every one has a real
          // consumer — but only cycle tracking said so. A toggle whose effect
          // you cannot find reads as a broken toggle, so the other two now
          // name their destination the same way.
          hint={tFallback('settings.nutrientRingView.hint', 'Rings instead of bars on Dashboard and meal plans')}
          checked={nutrientRingView}
          onChange={setNutrientRingView}
        />
        <ToggleRow
          icon={Repeat}
          label={tFallback('settings.calorieCycling', 'Calorie cycling')}
          hint={tFallback('settings.calorieCycling.hint', 'Adds a Cycling link under your calorie target on Nutrition')}
          checked={calorieCyclingEnabled}
          onChange={setCalorieCyclingEnabled}
        />
        <ToggleRow
          icon={Heart}
          label={tFallback('settings.cycleTracking', 'Cycle tracking')}
          hint={tFallback('settings.cycleTracking.hint', 'Shows the tracker on Progress › Body')}
          checked={!!profile?.cycle_tracking_enabled}
          onChange={handleCycleTracking}
        />
      </Group>
    </div>
  );
}
