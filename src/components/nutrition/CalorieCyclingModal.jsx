// src/components/nutrition/CalorieCyclingModal.jsx
//
// Configure per-day-type calorie + macro targets ("calorie cycling"):
// more on training days, less on rest days. Persists to
// user_profiles.calorie_cycling via saveMine; calculateDailyValues
// (src/lib/nutritionDefaults.js) then resolves the right branch for
// "today" based on whether a workout was logged, so the calorie top bar
// and macro boxes reflect it automatically.
//
// A "training day" = a workout was logged today. Rest day = otherwise.

import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Dumbbell, Moon, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { getMine, saveMine } from '@/lib/data/calorieCycling';

// The four target fields, in display order. Keys match the shape
// calculateDailyValues reads (calories, protein_g, carbs_g, fat_g).
// `key` is the storage column and carries the _g suffix; `nutrient` is the
// catalog key, which does not. Stated rather than derived because the render
// site used to build `nutrition.macro.${key}` and NOT ONE of those four keys
// existed — a template key with nothing behind it renders English in every
// language while the code reads as internationalised.
const FIELDS = [
  { key: 'calories', nutrient: 'nutrient.calories', label: 'Calories', suffix: 'cal', step: 10 },
  { key: 'protein_g', nutrient: 'nutrient.protein', label: 'Protein', suffix: 'g', step: 5 },
  { key: 'carbs_g', nutrient: 'nutrient.carbs', label: 'Carbs', suffix: 'g', step: 5 },
  { key: 'fat_g', nutrient: 'nutrient.fat', label: 'Fat', suffix: 'g', step: 1 },
];

const EMPTY_BRANCH = { calories: '', protein_g: '', carbs_g: '', fat_g: '' };

// Normalize a stored branch ({calories, …} | null) into a form-friendly
// object of strings so inputs stay controlled.
function toForm(branch) {
  if (!branch) return { ...EMPTY_BRANCH };
  const out = { ...EMPTY_BRANCH };
  for (const { key } of FIELDS) {
    if (branch[key] != null) out[key] = String(branch[key]);
  }
  return out;
}

// Convert a form branch back to numbers, dropping blank/invalid fields.
// Returns null when the whole branch is empty so an untouched day type
// stays unset (calculateDailyValues then falls through to the base goal).
function toStored(form) {
  const out = {};
  for (const { key } of FIELDS) {
    const n = Number(form[key]);
    if (form[key] !== '' && Number.isFinite(n) && n >= 0) out[key] = Math.round(n);
  }
  return Object.keys(out).length ? out : null;
}

function DayColumn({ icon: Icon, title, subtitle, form, setForm, accent }) {
  const { tFallback } = useLanguage();
  return (
    <div className="flex-1 rounded-xl border border-border p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${accent}`} />
        <div>
          <p className="text-sm font-bold leading-tight">{title}</p>
          <p className="text-micro text-muted-foreground leading-tight">{subtitle}</p>
        </div>
      </div>
      {FIELDS.map(({ key, nutrient, label, suffix, step }) => (
        <label key={key} className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{tFallback(nutrient, label)}</span>
          <span className="relative">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={step}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="h-8 w-24 pe-8 text-end tabular-nums"
              placeholder="—"
              aria-label={`${title} ${label}`}
            />
            <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-micro text-muted-foreground">
              {suffix}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

export default function CalorieCyclingModal({ open, onClose }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [training, setTraining] = useState({ ...EMPTY_BRANCH });
  const [rest, setRest] = useState({ ...EMPTY_BRANCH });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load the existing config each time the modal opens.
  useEffect(() => {
    if (!open || !user?.id) return;
    let alive = true;
    setLoading(true);
    getMine(user.id)
      .then((cfg) => {
        if (!alive) return;
        setTraining(toForm(cfg?.training));
        setRest(toForm(cfg?.rest));
      })
      .catch(() => { /* getMine already degrades to EMPTY */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, user?.id]);

  const handleSave = async () => {
    if (saving || !user?.id) return;
    setSaving(true);
    try {
      const config = { training: toStored(training), rest: toStored(rest) };
      // Both branches empty → store null so the feature is fully off.
      await saveMine(user.id, (config.training || config.rest) ? config : null);
      // calculateDailyValues reads userProfile.calorie_cycling — refetch so
      // the calorie top bar + macro boxes pick up the new targets.
      qc.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      toast.success(tFallback('nutrition.cycling.saved', 'Calorie cycling saved'));
      onClose?.();
    } catch {
      toast.error(tFallback('nutrition.cycling.saveFailed', 'Could not save. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setTraining({ ...EMPTY_BRANCH });
    setRest({ ...EMPTY_BRANCH });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tFallback('nutrition.cycling.title', 'Calorie cycling')}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {tFallback('nutrition.cycling.subtitle', 'Set different targets for training vs rest days. On a day you log a workout, your training-day target is used.')}
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <DayColumn
                icon={Dumbbell}
                title={tFallback('nutrition.cycling.training', 'Training day')}
                subtitle={tFallback('nutrition.cycling.trainingHint', 'workout logged')}
                form={training}
                setForm={setTraining}
                accent="text-primary"
              />
              <DayColumn
                icon={Moon}
                title={tFallback('nutrition.cycling.rest', 'Rest day')}
                subtitle={tFallback('nutrition.cycling.restHint', 'no workout')}
                form={rest}
                setForm={setRest}
                accent="text-muted-foreground"
              />
            </div>

            <p className="text-micro text-muted-foreground">
              {tFallback('nutrition.cycling.blankHint', 'Leave a field blank to keep your usual goal for that macro.')}
            </p>

            <div className="flex gap-2 pt-1">
              <Button variant="ghost" onClick={handleClear} disabled={saving} className="text-muted-foreground">
                {tFallback('nutrition.cycling.clear', 'Clear')}
              </Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1 gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {tFallback('common.save', 'Save')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
