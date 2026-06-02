import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { useFormDraft } from '@/hooks/useFormDraft';
import { titleCase } from '@/lib/textCase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, GripVertical, Zap, RotateCcw, X, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ExerciseAutocomplete from './ExerciseAutocomplete';
import MuscleGroupSelector from './MuscleGroupSelector';
import { getMaxSetsPerExercise } from '@/lib/workoutFatigue';
import { getMaxRealisticReps } from '@/lib/realisticLimits';
import { useMultiProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import { toast } from 'sonner';

const ALL_MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core', 'Full Body', 'Cardio'];

const TYPE_COLOR  = { superset: 'border-violet-500/40 bg-violet-500/5', circuit: 'border-emerald-500/40 bg-emerald-500/5' };
const TYPE_BADGE  = { superset: 'text-violet-500 bg-violet-500/10 border-violet-500/25', circuit: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/25' };

export default function RegimenForm({ initial, onSubmit, onCancel, userProfile = {}, isSubmitting = false }) {
  const { t } = useLanguage();
  const maxSetsPerExercise = getMaxSetsPerExercise(userProfile);

  // Auto-focus the name field on open so users can start typing right
  // away. New regimen → focus + caret at start; edit existing → focus
  // + caret at end so they can append/correct without re-selecting.
  const nameInputRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const el = nameInputRef.current;
      if (!el) return;
      el.focus();
      if (initial?.name) {
        try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* ignore */ }
      }
    }, 80);
    return () => clearTimeout(t);
  }, [initial?.name]);

  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [isPublic, setIsPublic] = useState(initial?.is_public || false);
  const guard = useMultiProfanityGuard();
  const [exercises, setExercises] = useState(
    (initial?.exercises || []).map(ex => ({
      ...ex,
      muscle_groups: ex.muscle_groups || (ex.muscle_group ? [ex.muscle_group] : []),
    }))
  );

  // Auto-save draft of the regimen-in-progress. Only enabled for the
  // CREATE flow (no `initial`) — editing existing regimens uses the
  // server's source-of-truth and shouldn't have a stale localStorage
  // draft layered on top. Restores on remount with "Draft restored"
  // toast + Discard action.
  const { user } = useAuth();
  const draftEnabled = !initial && !!user?.email;
  const draftValue = { name, description, exercises, isPublic };
  const draft = useFormDraft({
    key: draftEnabled ? `flexyn.draft.regimenCreate.${user.email}` : null,
    value: draftValue,
    enabled: draftEnabled,
    onRestore: (saved) => {
      if (!saved) return;
      if (typeof saved.name === 'string') setName(saved.name);
      if (typeof saved.description === 'string') setDescription(saved.description);
      if (Array.isArray(saved.exercises) && saved.exercises.length > 0) setExercises(saved.exercises);
      if (typeof saved.isPublic === 'boolean') setIsPublic(saved.isPublic);
    },
  });

  // ── Group selection mode ────────────────────────────────────────────────────
  const [selecting, setSelecting] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState(new Set());

  const toggleSelect = (i) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const createGroup = (type) => {
    if (selectedIndices.size < 2) {
      toast.error('Select at least 2 exercises to group.');
      return;
    }
    const groupId = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const groupMeta = { type, intra_rest_seconds: 15, inter_rest_seconds: 90, round_count: 3 };

    // Re-order: move selected exercises together at the position of the first selected index,
    // preserving relative order within the selection and within the non-selected remainder.
    const sortedSelected = [...selectedIndices].sort((a, b) => a - b);
    const firstPos = sortedSelected[0];
    const selectedExercises = sortedSelected.map(i => ({ ...exercises[i], group_id: groupId, group_meta: groupMeta }));
    const remaining = exercises.filter((_, i) => !selectedIndices.has(i));
    const reordered = [...remaining.slice(0, firstPos), ...selectedExercises, ...remaining.slice(firstPos)];

    setExercises(reordered);
    setSelectedIndices(new Set());
    setSelecting(false);
    toast.success(`${type === 'superset' ? 'Superset' : 'Circuit'} created.`);
  };

  const ungroupExercises = (groupId) => {
    setExercises(exercises.map(ex =>
      ex.group_id === groupId ? { ...ex, group_id: undefined, group_meta: undefined } : ex
    ));
  };

  const updateGroupMeta = (groupId, field, value) => {
    setExercises(exercises.map(ex =>
      ex.group_id === groupId
        ? { ...ex, group_meta: { ...ex.group_meta, [field]: value } }
        : ex
    ));
  };

  const toggleGroupType = (groupId) => {
    const ex = exercises.find(e => e.group_id === groupId);
    if (!ex?.group_meta) return;
    const next = ex.group_meta.type === 'superset' ? 'circuit' : 'superset';
    updateGroupMeta(groupId, 'type', next);
  };

  // ── Exercise field helpers ──────────────────────────────────────────────────
  const addExercise = () => {
    setExercises([{ name: '', target_sets: null, target_reps: null, muscle_groups: [], notes: '' }, ...exercises]);
  };

  const updateExercise = (index, field, value) => {
    const updated = [...exercises];
    updated[index] = { ...updated[index], [field]: value };
    setExercises(updated);
  };

  const handleExerciseSelect = (index, exercise) => {
    const updated = [...exercises];
    updated[index] = {
      ...updated[index],
      name: exercise.name,
      displayName: exercise.displayName || exercise.name,
      muscle_groups: exercise.muscles,
    };
    setExercises(updated);
  };

  const removeMuscleGroup = (exerciseIndex, muscle) => {
    const updated = [...exercises];
    updated[exerciseIndex] = {
      ...updated[exerciseIndex],
      muscle_groups: updated[exerciseIndex].muscle_groups.filter(m => m !== muscle),
    };
    setExercises(updated);
  };

  const addMuscleGroup = (exerciseIndex, muscle) => {
    const updated = [...exercises];
    const current = updated[exerciseIndex].muscle_groups || [];
    if (!current.includes(muscle)) {
      updated[exerciseIndex] = { ...updated[exerciseIndex], muscle_groups: [...current, muscle] };
      setExercises(updated);
    }
  };

  const removeExercise = (index) => {
    setExercises(exercises.filter((_, i) => i !== index));
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = (e) => {
    e.preventDefault();

    const exerciseStrings = (exercises || []).flatMap(ex => [ex.name, ex.displayName, ex.notes]);
    if (hasAnyProfanity(name, description, exerciseStrings)) {
      toast.error('Please remove inappropriate language before saving.');
      return;
    }

    if (!name?.trim()) {
      toast.error('Please give the regimen a name before saving.');
      return;
    }

    if (!exercises || exercises.length === 0) {
      toast.error('Add at least one exercise before saving.');
      return;
    }

    const issues = [];
    exercises.forEach((ex, i) => {
      const exLabel = (ex.displayName || ex.name || '').trim() || `Exercise ${i + 1}`;
      if (!(ex.displayName || ex.name || '').trim()) {
        issues.push(`${exLabel}: missing exercise name`);
      }
      if (ex.target_sets == null || ex.target_sets === '' || Number(ex.target_sets) < 1) {
        issues.push(`${exLabel}: missing or invalid sets`);
      }
      if (ex.target_reps == null || ex.target_reps === '' || Number(ex.target_reps) < 1) {
        issues.push(`${exLabel}: missing or invalid reps`);
      }
    });

    if (issues.length > 0) {
      const preview = issues.slice(0, 3).join(' • ');
      const more = issues.length > 3 ? ` (+${issues.length - 3} more)` : '';
      toast.error('Please complete every exercise', { description: `${preview}${more}` });
      return;
    }

    const normalised = exercises.map(ex => ({
      ...ex,
      muscle_groups: ex.muscle_groups || [],
      muscle_group: (ex.muscle_groups || [])[0] || '',
      target_sets: Math.min(maxSetsPerExercise, Math.max(1, Number(ex.target_sets))),
      target_reps: Math.min(getMaxRealisticReps(ex.name, 0, userProfile), Math.max(1, Number(ex.target_reps))),
    }));
    // Successful submit → clear the auto-save draft so it doesn't
    // re-fire "Draft restored" the next time the create-regimen form
    // opens. No-op in edit mode (the draft hook was disabled there).
    draft.clear();
    // Set BOTH flags when publishing. is_public is legacy (mig 005);
    // is_public_free is the new SELECT-policy gate added in mig 143.
    // Without is_public_free=true, the gated marketplace read policy
    // blocks every non-owner from seeing the regimen — which is why
    // user-published regimens stopped appearing in the public list
    // ("I published a bunch on my main account, but there are none
    // here huge issue" — screenshot feedback, 2026-06).
    onSubmit({
      name,
      description,
      exercises: normalised,
      is_public: isPublic,
      is_public_free: isPublic,
    });
  };

  // ── Build grouped render list ───────────────────────────────────────────────
  // Produces an ordered list of { type:'group', ... } and { type:'single', ... }
  // items that preserves the flat array order while clustering grouped exercises.
  const renderItems = (() => {
    const items = [];
    const seen = new Set();
    exercises.forEach((ex, globalIdx) => {
      if (ex.group_id) {
        if (!seen.has(ex.group_id)) {
          seen.add(ex.group_id);
          const groupItems = exercises
            .map((e, ii) => ({ exercise: e, globalIdx: ii }))
            .filter(({ exercise }) => exercise.group_id === ex.group_id);
          items.push({ type: 'group', groupId: ex.group_id, groupMeta: ex.group_meta || {}, items: groupItems });
        }
      } else {
        items.push({ type: 'single', exercise: ex, globalIdx });
      }
    });
    return items;
  })();

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">{t('regimens.name')}</label>
          <Input
            ref={nameInputRef}
            value={name}
            onChange={e => guard.handleChange(e.target.value, setName)}
            onBlur={() => {
              const cleaned = titleCase(name);
              if (cleaned !== name) setName(cleaned);
            }}
            placeholder={t('regimens.namePlaceholder')}
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">{t('regimens.description')}</label>
          <Textarea
            value={description}
            onChange={e => guard.handleChange(e.target.value, setDescription)}
            placeholder={t('regimens.descriptionPlaceholder')}
            className="h-20"
          />
        </div>
      </div>

      <div>
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-foreground">{t('workout.exercises')}</label>
          <div className="flex items-center gap-2">
            {!selecting ? (
              <>
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => { setSelecting(true); setSelectedIndices(new Set()); }}
                  className="gap-1.5 text-xs"
                >
                  <Zap className="w-3.5 h-3.5" /> Group
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={addExercise}>
                  <Plus className="w-4 h-4 me-1" /> {t('regimens.addExercise')}
                </Button>
              </>
            ) : (
              <Button
                type="button" variant="ghost" size="sm"
                onClick={() => { setSelecting(false); setSelectedIndices(new Set()); }}
                className="text-muted-foreground gap-1"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </Button>
            )}
          </div>
        </div>

        {/* Selection mode hint */}
        <AnimatePresence>
          {selecting && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mb-3 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20 text-xs text-primary font-medium"
            >
              Tap exercises to select them, then choose Superset or Circuit below.
            </motion.div>
          )}
        </AnimatePresence>

        {exercises.length === 0 && (
          <Card className="p-6 text-center border-dashed">
            <p className="text-sm text-muted-foreground">No exercises added yet.</p>
          </Card>
        )}

        <AnimatePresence initial={false}>
          <div className="space-y-3">
            {renderItems.map((item, renderIdx) => {

              // ── Group container ──────────────────────────────────────────
              if (item.type === 'group') {
                const { groupId, groupMeta, items: groupItems } = item;
                const type = groupMeta.type || 'superset';
                return (
                  <motion.div
                    key={`group-${groupId}`}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                    className={`rounded-xl border-s-4 border overflow-hidden ${TYPE_COLOR[type] || TYPE_COLOR.superset}`}
                  >
                    {/* Group header */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-background/60">
                      <div className="flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                        <button
                          type="button"
                          onClick={() => toggleGroupType(groupId)}
                          className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ${TYPE_BADGE[type] || TYPE_BADGE.superset}`}
                          title="Click to toggle type"
                        >
                          {type === 'superset' ? 'Superset' : 'Circuit'}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => ungroupExercises(groupId)}
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
                      >
                        <X className="w-3 h-3" /> Ungroup
                      </button>
                    </div>

                    {/* Rest / round settings */}
                    <div className="flex items-center gap-4 px-3 py-2 border-b border-border/40 bg-background/40">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">Intra rest</span>
                        <input
                          type="number" inputMode="decimal" min="0" max="300"
                          value={groupMeta.intra_rest_seconds ?? 15}
                          onChange={e => updateGroupMeta(groupId, 'intra_rest_seconds', Number(e.target.value) || 0)}
                          className="w-14 text-xs text-center rounded border border-border bg-background px-1 py-0.5 tabular-nums"
                        />
                        <span className="text-[10px] text-muted-foreground">s</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">Inter rest</span>
                        <input
                          type="number" inputMode="decimal" min="0" max="600"
                          value={groupMeta.inter_rest_seconds ?? 90}
                          onChange={e => updateGroupMeta(groupId, 'inter_rest_seconds', Number(e.target.value) || 0)}
                          className="w-14 text-xs text-center rounded border border-border bg-background px-1 py-0.5 tabular-nums"
                        />
                        <span className="text-[10px] text-muted-foreground">s</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <RotateCcw className="w-3 h-3 text-muted-foreground" />
                        <input
                          type="number" inputMode="decimal" min="1" max="10"
                          value={groupMeta.round_count ?? 3}
                          onChange={e => updateGroupMeta(groupId, 'round_count', Math.max(1, Number(e.target.value) || 1))}
                          className="w-10 text-xs text-center rounded border border-border bg-background px-1 py-0.5 tabular-nums"
                        />
                        <span className="text-[10px] text-muted-foreground">rounds</span>
                      </div>
                    </div>

                    {/* Grouped exercises */}
                    <div className="divide-y divide-border/40 px-2 py-1">
                      {groupItems.map(({ exercise: ex, globalIdx: i }) => (
                        <div key={i} className="py-2">
                          <ExerciseCard
                            ex={ex} i={i}
                            selecting={selecting} selectedIndices={selectedIndices}
                            toggleSelect={toggleSelect}
                            guard={guard}
                            updateExercise={updateExercise}
                            handleExerciseSelect={handleExerciseSelect}
                            addMuscleGroup={addMuscleGroup}
                            removeMuscleGroup={removeMuscleGroup}
                            removeExercise={removeExercise}
                            maxSetsPerExercise={maxSetsPerExercise}
                            userProfile={userProfile}
                            t={t}
                          />
                        </div>
                      ))}
                    </div>
                  </motion.div>
                );
              }

              // ── Solo exercise ────────────────────────────────────────────
              const { exercise: ex, globalIdx: i } = item;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: -12, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                >
                  <Card
                    className={`p-4 border-none shadow-sm transition-colors ${
                      selecting && selectedIndices.has(i) ? 'ring-2 ring-primary bg-primary/5' : ''
                    } ${selecting ? 'cursor-pointer' : ''}`}
                    onClick={selecting ? () => toggleSelect(i) : undefined}
                  >
                    <ExerciseCard
                      ex={ex} i={i}
                      selecting={selecting} selectedIndices={selectedIndices}
                      toggleSelect={toggleSelect}
                      guard={guard}
                      updateExercise={updateExercise}
                      handleExerciseSelect={handleExerciseSelect}
                      addMuscleGroup={addMuscleGroup}
                      removeMuscleGroup={removeMuscleGroup}
                      removeExercise={removeExercise}
                      maxSetsPerExercise={maxSetsPerExercise}
                      userProfile={userProfile}
                      t={t}
                    />
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </AnimatePresence>
      </div>

      {/* Sticky group action bar */}
      <AnimatePresence>
        {selecting && selectedIndices.size >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="sticky bottom-4 z-10 flex items-center justify-center gap-3 px-4 py-3 rounded-2xl border border-primary/30 bg-background/95 backdrop-blur shadow-xl shadow-black/10 mx-auto max-w-sm"
          >
            <span className="text-xs font-medium text-muted-foreground me-1">{selectedIndices.size} selected</span>
            <Button
              type="button" size="sm"
              className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs"
              onClick={() => createGroup('superset')}
            >
              <Zap className="w-3.5 h-3.5" /> Superset
            </Button>
            <Button
              type="button" size="sm"
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
              onClick={() => createGroup('circuit')}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Circuit
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Public template toggle */}
      <button
        type="button"
        onClick={() => setIsPublic(p => !p)}
        className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors ${
          isPublic ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/30'
        }`}
      >
        <div className="text-start">
          <p className="font-semibold text-sm">{t('regimens.isPublic')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t('regimens.isPublicDesc')}</p>
        </div>
        <div className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${isPublic ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${isPublic ? 'start-5' : 'start-1'}`} />
        </div>
      </button>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('common.cancel')}
        </Button>
        {/* Disable when: form is in-flight, OR required fields are
            empty. The handleSubmit toasts already explain why, but
            pre-disabling teaches the user the validity rules without
            them having to tap and fail. */}
        <Button
          type="submit"
          disabled={isSubmitting || !name?.trim() || !exercises || exercises.length === 0}
        >
          {initial ? t('common.save') : t('regimens.create')}
        </Button>
      </div>

      <ProfanityWarningDialog open={guard.open} onContinue={guard.onContinue} />
    </form>
  );
}

// ── ExerciseCard sub-component ────────────────────────────────────────────────
// Extracted so it renders identically inside group containers and solo cards.

function ExerciseCard({
  ex, i, selecting, selectedIndices, toggleSelect,
  guard, updateExercise, handleExerciseSelect,
  addMuscleGroup, removeMuscleGroup, removeExercise,
  maxSetsPerExercise, userProfile, t,
}) {
  return (
    <div className="flex items-start gap-3">
      {selecting ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleSelect(i); }}
          className="mt-3 shrink-0"
        >
          <CheckCircle2
            className={`w-5 h-5 transition-colors ${
              selectedIndices.has(i) ? 'text-primary fill-primary/20' : 'text-muted-foreground/40'
            }`}
          />
        </button>
      ) : (
        <GripVertical className="w-4 h-4 text-muted-foreground mt-3 shrink-0" />
      )}
      <div className="flex-1 space-y-3">
        {/* Exercise name autocomplete */}
        <ExerciseAutocomplete
          value={ex.displayName || ex.name}
          onChange={(val) => guard.handleChange(val, (v) => updateExercise(i, 'displayName', v))}
          onSelect={(exercise) => handleExerciseSelect(i, exercise)}
          placeholder="Search exercise (e.g. Deadlift)..."
        />

        {/* Muscle group selector */}
        <MuscleGroupSelector
          selected={ex.muscle_groups || []}
          availableGroups={ALL_MUSCLE_GROUPS}
          onAdd={(muscle) => addMuscleGroup(i, muscle)}
          onRemove={(muscle) => removeMuscleGroup(i, muscle)}
        />

        {/* Sets / Reps */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t('common.sets')}</label>
            <Input
              type="number" inputMode="decimal" min="1" max={maxSetsPerExercise}
              value={ex.target_sets ?? ''}
              onChange={e => {
                const raw = e.target.value;
                if (raw === '') {
                  updateExercise(i, 'target_sets', null);
                } else {
                  const val = parseInt(raw);
                  updateExercise(i, 'target_sets', isNaN(val) ? null : Math.min(maxSetsPerExercise, Math.max(1, val)));
                }
              }}
              onKeyDown={e => { if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault(); }}
              placeholder="—"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t('common.reps')}</label>
            <Input
              type="number" inputMode="decimal" min="1" max={getMaxRealisticReps(ex.name, 0, userProfile)}
              value={ex.target_reps ?? ''}
              onChange={e => {
                const raw = e.target.value;
                if (raw === '') {
                  updateExercise(i, 'target_reps', null);
                } else {
                  const val = parseInt(raw);
                  const maxRepsForEx = getMaxRealisticReps(ex.name, 0, userProfile);
                  updateExercise(i, 'target_reps', isNaN(val) ? null : Math.min(maxRepsForEx, Math.max(1, val)));
                }
              }}
              onKeyDown={e => { if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault(); }}
              placeholder="—"
            />
          </div>
        </div>
      </div>
      {!selecting && (
        <Button type="button" variant="ghost" size="icon" onClick={() => removeExercise(i)} className="shrink-0 mt-1">
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      )}
    </div>
  );
}
