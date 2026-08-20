// src/components/routines/MyRoutineSheet.jsx
//
// "My Routine" editor — build/manage weekly training calendars. Two views:
//   • list — all your routines (up to 50), templates, create / activate / delete
//   • edit — a 7-day week; name each day ("Leg Day"), mark rest, add the lifts
//            you actually like via the exercise autocomplete, then save.
// The active routine drives "today's plan" on the Workout screen.

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X as XIcon, Plus, ArrowLeft, Trash2, Star, Dumbbell, Moon,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import ExerciseAutocomplete from '@/components/regimens/ExerciseAutocomplete';
import {
  listMyRoutines, createRoutine, updateRoutine, deleteRoutine, setActiveRoutine,
  TEMPLATES, FOCUS_OPTIONS, DAY_NAMES_FULL, emptyWeek, todayIndex, MAX_ROUTINES,
} from '@/lib/data/routines';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { ReorderableRow, DragHandle } from '@/components/dashboard/ReorderableRow';
import { useLanguage } from '@/lib/LanguageContext';
import TransText from '@/components/TransText';

/**
 * React keys for a list whose items carry no id.
 *
 * A routine day's exercises are `{ name, muscles }` — nothing unique and
 * nothing persisted that could serve as a key, and the old `key={index}`
 * cannot survive a reorder (React would reuse the DOM node for a different
 * exercise and framer would animate the wrong row). Keying by name plus
 * WHICH occurrence it is gives a key that is stable across a reorder for the
 * ordinary case of distinct names, and merely swaps between two rows that
 * render identically when a day genuinely lists the same lift twice.
 *
 * Exported for its test. Not a general utility — an id on the row would be
 * better, but that means changing what gets persisted into routine JSON.
 */
export function exerciseRowKeys(list) {
  const seen = new Map();
  return list.map((ex) => {
    const nth = (seen.get(ex.name) || 0) + 1;
    seen.set(ex.name, nth);
    return `${ex.name}#${nth}`;
  });
}

export default function MyRoutineSheet({ open, onClose }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState('list');     // 'list' | 'edit'
  const [draft, setDraft] = useState(null);      // { id, name, days }
  const [expandedDay, setExpandedDay] = useState(null);
  const [pendingEx, setPendingEx] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: routines = [], isLoading } = useQuery({
    queryKey: ['routines', user?.id],
    queryFn: listMyRoutines,
    enabled: !!user?.id && !!open,
    staleTime: 30_000,
  });

  // Reset to list whenever the sheet re-opens.
  useEffect(() => { if (open) { setView('list'); setDraft(null); setExpandedDay(null); } }, [open]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['routines', user?.id] });

  const openEditor = (routine) => {
    setDraft({
      id: routine.id,
      name: routine.name,
      days: Array.isArray(routine.days) && routine.days.length === 7 ? routine.days : emptyWeek(),
    });
    setExpandedDay(null);
    setView('edit');
  };

  const createNew = async (name, days) => {
    if (routines.length >= MAX_ROUTINES) {
      toast.error(tFallback('myRoutineSheet.limitReached', 'You have hit the routine limit. Delete one to add another.'));
      return;
    }
    setSaving(true);
    const res = await createRoutine({ name, days, activate: routines.length === 0 });
    setSaving(false);
    if (res.ok) { invalidate(); openEditor(res.routine); }
    else toast.error(tFallback('myRoutineSheet.createFailed', 'Could not create routine. Try again.'));
  };

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    const res = await updateRoutine(draft.id, { name: draft.name, days: draft.days });
    setSaving(false);
    if (res.ok) { invalidate(); toast.success(tFallback("myRoutineSheet.routineSaved", "Routine saved")); setView('list'); }
    else toast.error(tFallback('myRoutineSheet.saveFailed', 'Could not save. Try again.'));
  };

  const activate = useMutation({
    mutationFn: (id) => setActiveRoutine(id),
    onSuccess: () => {
      invalidate();
      toast.success(tFallback('myRoutineSheet.activated', 'Active routine set. It now drives your week.'));
    },
    onError: () => toast.error(tFallback('myRoutineSheet.activateFailed', 'Could not activate. Try again.')),
  });

  const remove = useMutation({
    mutationFn: (id) => deleteRoutine(id),
    onSuccess: () => { invalidate(); toast.success(tFallback("myRoutineSheet.routineDeleted", "Routine deleted")); },
  });

  // ── day editing helpers (operate on draft.days) ───────────────────────────
  const patchDay = (idx, patch) => {
    setDraft(d => ({ ...d, days: d.days.map((day, i) => (i === idx ? { ...day, ...patch } : day)) }));
  };
  const addExercise = (idx, ex) => {
    setDraft(d => ({
      ...d,
      days: d.days.map((day, i) => {
        if (i !== idx) return day;
        if (day.exercises.length >= 30) return day;
        return { ...day, exercises: [...day.exercises, { name: ex.name, muscles: ex.muscles || [] }] };
      }),
    }));
  };
  const removeExercise = (idx, exIdx) => {
    setDraft(d => ({
      ...d,
      days: d.days.map((day, i) => (i === idx ? { ...day, exercises: day.exercises.filter((_, j) => j !== exIdx) } : day)),
    }));
  };
  // The grip beside each exercise was decorative — drawn since this sheet
  // shipped, wired to nothing. Order matters in a training day (you squat
  // before the accessory work), so it is worth connecting rather than
  // deleting. framer hands back the reordered array directly because the
  // Reorder values ARE the exercise objects.
  const reorderExercises = (idx, next) => {
    setDraft(d => ({ ...d, days: d.days.map((day, i) => (i === idx ? { ...day, exercises: next } : day)) }));
  };

  if (!open) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9998] bg-background flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 border-b border-border shrink-0"
        style={{ paddingTop: 'max(14px, env(safe-area-inset-top))', paddingBottom: 12 }}>
        {view === 'edit' ? (
          <button onClick={() => setView('list')} className="p-1.5 -ms-1.5 rounded-lg hover:bg-secondary active:bg-secondary" aria-label={tFallback("achievements.vault.back", "Back")}>
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : (
          <button onClick={onClose} className="p-1.5 -ms-1.5 rounded-lg hover:bg-secondary active:bg-secondary" aria-label={tFallback("common.close", "Close")}>
            <XIcon className="w-5 h-5" />
          </button>
        )}
        <h2 className="font-heading text-lg font-bold flex-1 truncate">
          {view === 'edit' ? (draft?.name || 'Routine') : 'My Routines'}
        </h2>
        {view === 'edit' && (
          <button onClick={saveDraft} disabled={saving}
            className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50">
            {tFallback("common.save", "Save")}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
        <AnimatePresence mode="wait">
          {view === 'list' ? (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5 max-w-2xl mx-auto">
              {/* Your routines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Your routines {routines.length > 0 && `(${routines.length}/${MAX_ROUTINES})`}
                  </p>
                  <button
                    onClick={() => createNew('My Routine', emptyWeek())}
                    disabled={saving || routines.length >= MAX_ROUTINES}
                    className="flex items-center gap-1 text-xs font-bold text-primary disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" /> {tFallback("coach.onboarding.levelLabel.newbie", "New")}
                  </button>
                </div>
                {isLoading ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">{tFallback('common.loading', 'Loading…')}</p>
                ) : routines.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    <TransText
                      k="myRoutineSheet.emptyHint"
                      en="No routines yet. Start from a template below, or tap {new}."
                      values={{ new: <b>{tFallback('coach.onboarding.levelLabel.newbie', 'New')}</b> }}
                    />
                  </p>
                ) : (
                  <div className="space-y-2">
                    {routines.map(r => {
                      const dayCount = (r.days || []).filter(d => !d.isRest && (d.label || d.exercises?.length)).length;
                      return (
                        <div key={r.id} className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3">
                          <button onClick={() => openEditor(r)} className="flex-1 min-w-0 text-start">
                            <div className="flex items-center gap-2">
                              <span className="font-heading font-bold text-sm truncate">{r.name}</span>
                              {r.is_active && (
                                <span className="px-1.5 py-0.5 rounded-full text-micro font-bold uppercase tracking-wide bg-primary/15 text-primary">{tFallback("duels.status.active", "Active")}</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{dayCount} training day{dayCount === 1 ? '' : 's'}</p>
                          </button>
                          {!r.is_active && (
                            <button onClick={() => activate.mutate(r.id)} aria-label={tFallback("myRoutineSheet.setActive", "Set active")}
                              className="p-2 rounded-lg text-muted-foreground hover:text-primary active:text-primary hover:bg-secondary active:bg-secondary" title={tFallback("myRoutineSheet.setActive", "Set active")}>
                              <Star className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => { if (window.confirm(`Delete "${r.name}"?`)) remove.mutate(r.id); }} aria-label={tFallback("common.delete", "Delete")}
                            className="p-2 rounded-lg text-muted-foreground hover:text-destructive active:text-destructive hover:bg-secondary active:bg-secondary">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Templates */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{tFallback("myRoutineSheet.startFromATemplate", "Start from a template")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATES.map(t => (
                    <button key={t.name} onClick={() => createNew(t.name, t.days)} disabled={saving || routines.length >= MAX_ROUTINES}
                      className="rounded-2xl border border-border bg-card p-3 text-start hover:border-primary/50 transition-colors disabled:opacity-40">
                      <p className="font-heading font-bold text-sm">{t.name}</p>
                      <p className="text-micro text-muted-foreground mt-0.5">
                        {t.days.filter(d => !d.isRest).length} day{t.days.filter(d => !d.isRest).length === 1 ? '' : 's'} · add your lifts
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3 max-w-2xl mx-auto">
              {/* Name */}
              <input
                value={draft?.name || ''}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder={tFallback("myRoutineSheet.routineName", "Routine name")}
                maxLength={60}
                className="w-full h-11 rounded-xl border border-border bg-secondary/50 px-3 font-heading font-bold text-foreground focus:outline-none focus:border-primary/50"
              />
              <p className="text-micro text-muted-foreground px-1">{tFallback('myRoutineSheet.tapADay', 'Tap a day to name it and add your lifts.')}</p>

              {/* Week */}
              {(draft?.days || []).map((day, idx) => {
                const isToday = idx === todayIndex();
                const isOpen = expandedDay === idx;
                return (
                  <div key={idx} className={`rounded-2xl border bg-card ${isOpen ? '' : 'overflow-hidden'} ${isToday ? 'border-primary/60' : 'border-border'}`}>
                    <button onClick={() => setExpandedDay(isOpen ? null : idx)} className="w-full flex items-center gap-3 p-3 text-start">
                      <div className="w-12 shrink-0">
                        <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">{DAY_NAMES_FULL[idx].slice(0, 3)}</p>
                        {isToday && <p className="text-micro font-bold text-primary">TODAY</p>}
                      </div>
                      <div className="flex-1 min-w-0">
                        {day.isRest ? (
                          <span className="text-sm text-muted-foreground flex items-center gap-1.5"><Moon className="w-3.5 h-3.5" /> {tFallback("progress.analytics.restDay", "Rest day")}</span>
                        ) : day.label || day.exercises.length ? (
                          <>
                            <p className="font-heading font-bold text-sm truncate">{day.label || 'Untitled day'}</p>
                            <p className="text-micro text-muted-foreground">{day.exercises.length} exercise{day.exercises.length === 1 ? '' : 's'}</p>
                          </>
                        ) : (
                          <span className="text-sm text-primary font-semibold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> {tFallback("myRoutineSheet.addAWorkout", "Add a workout")}</span>
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
                        {/* Rest toggle */}
                        <label className="flex items-center justify-between">
                          <span className="text-sm font-medium flex items-center gap-1.5"><Moon className="w-4 h-4 text-muted-foreground" /> {tFallback("progress.analytics.restDay", "Rest day")}</span>
                          <button onClick={() => patchDay(idx, { isRest: !day.isRest })} role="switch" aria-checked={day.isRest}
                            className={`w-11 h-6 rounded-full transition-colors relative ${day.isRest ? 'bg-primary' : 'bg-secondary border border-border'}`}>
                            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${day.isRest ? 'start-[22px]' : 'start-0.5'}`} />
                          </button>
                        </label>

                        {!day.isRest && (
                          <>
                            {/* Label */}
                            <input
                              value={day.label}
                              onChange={e => patchDay(idx, { label: e.target.value })}
                              placeholder={tFallback('myRoutineSheet.dayNamePlaceholder', 'Name this day, e.g. "Leg Day"')}
                              maxLength={40}
                              className="w-full h-10 rounded-xl border border-border bg-secondary/50 px-3 text-sm font-semibold focus:outline-none focus:border-primary/50"
                            />
                            {/* Focus chips */}
                            <div className="flex flex-wrap gap-1.5">
                              {FOCUS_OPTIONS.map(f => (
                                <button key={f.id} onClick={() => patchDay(idx, { focus: day.focus === f.id ? null : f.id })}
                                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${day.focus === f.id ? 'bg-primary/15 border-primary text-primary' : 'border-border text-muted-foreground'}`}>
                                  {tFallback(`routines.focus.${f.id}`, f.label)}
                                </button>
                              ))}
                            </div>
                            {/* Exercises */}
                            {day.exercises.length > 0 && (
                              <Reorder.Group
                                axis="y"
                                as="div"
                                values={day.exercises}
                                onReorder={(next) => reorderExercises(idx, next)}
                                className="space-y-1.5"
                              >
                                {/* Values are the exercise OBJECTS, so framer
                                    matches by reference and two sets of the
                                    same lift cannot be confused. React still
                                    needs a string key, and these rows carry
                                    no id — `name#nth` is stable for the
                                    normal case of distinct names. */}
                                {exerciseRowKeys(day.exercises).map((rowKey, exIdx) => {
                                  const ex = day.exercises[exIdx];
                                  return (
                                    <ReorderableRow
                                      key={rowKey}
                                      value={ex}
                                      layout="position"
                                      className="flex items-center gap-2 rounded-xl bg-secondary/40 px-3 py-2"
                                    >
                                      {(dragControls) => (<>
                                        <DragHandle
                                          dragControls={dragControls}
                                          label={`Drag to reorder ${ex.name}`}
                                          className="text-muted-foreground/60"
                                        />
                                        <Dumbbell className="w-3.5 h-3.5 text-primary shrink-0" />
                                        <span className="flex-1 text-sm truncate">{ex.name}</span>
                                        <button onClick={() => removeExercise(idx, exIdx)} aria-label={tFallback("gymEquip.remove", "Remove")} className="p-1 text-muted-foreground hover:text-destructive active:text-destructive">
                                          <XIcon className="w-3.5 h-3.5" />
                                        </button>
                                      </>)}
                                    </ReorderableRow>
                                  );
                                })}
                              </Reorder.Group>
                            )}
                            {/* Add-exercise autocomplete */}
                            <ExerciseAutocomplete
                              value={expandedDay === idx ? pendingEx : ''}
                              onChange={setPendingEx}
                              onSelect={(ex) => { addExercise(idx, ex); setPendingEx(''); }}
                              placeholder={tFallback("myRoutineSheet.addAnExercise", "Add an exercise…")}
                              userEmail={user?.email}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>,
    document.body,
  );
}
