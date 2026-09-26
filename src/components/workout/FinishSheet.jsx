// The last step of a session. Finish used to save straight away, with the
// name, tags, notes and progress photo left in a form under the exercise
// list that most people never scrolled to. The sheet puts them where the
// decision is made: what you did, a photo if you want one, what to call
// it, then Save. Tags arrive already picked from the muscles you trained.

import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TagSelector, getTag } from './WorkoutTags';
import { sessionProgress } from './SessionBar';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { totalVolume } from '@/lib/workoutVolume';
import { elapsedSeconds } from '@/lib/elapsedClock';
import { formatNumber } from '@/lib/intl';

export default function FinishSheet({
  open, onClose, onSave, saving,
  exercises, startedAt, includeBarWeight, unchecked = 0,
  name, onNameChange, namePlaceholder,
  tags, onTagsChange,
  notes, onNotesChange,
  photoSlot,
}) {
  const { t, tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const [editingTags, setEditingTags] = useState(false);

  const minutes = startedAt ? Math.max(1, Math.round(elapsedSeconds(startedAt) / 60)) : 0;
  const volume = totalVolume(exercises, { includeBarWeight });
  const { done, total } = sessionProgress(exercises);
  const stats = [
    minutes > 0 && { key: 'time', value: tFallback('finish.minutes', '{n} min', { n: formatNumber(minutes, language) }), label: tFallback('finish.time', 'Time') },
    volume > 0 && { key: 'volume', value: `${formatNumber(Math.round(fromLbs(volume, weightUnit)), language)} ${weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lb'}`, label: tFallback('finish.volume', 'Volume') },
    total > 0 && { key: 'sets', value: `${formatNumber(done, language)}/${formatNumber(total, language)}`, label: tFallback('finish.sets', 'Sets') },
  ].filter(Boolean);

  return (
    <BottomSheet open={open} onClose={onClose} title={tFallback('workout.finishTitle', 'Finish workout')}>
      <div className="flex flex-col gap-6 pb-2">
        <div className="flex flex-col gap-2">
          {stats.length > 0 && (
            <div className="flex gap-2">
              {stats.map((s) => (
                <div key={s.key} className="flex-1 min-w-0 flex flex-col items-center gap-0.5 rounded-lg bg-secondary px-2 py-3 text-center">
                  <span className="max-w-full font-heading text-xl font-extrabold leading-none tabular-nums truncate">{s.value}</span>
                  <span className="text-micro font-medium uppercase tracking-wider text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>
          )}
          {unchecked > 0 && (
            <p className="text-xs text-muted-foreground">
              {unchecked === 1
                ? tFallback('workout.uncheckedOne', '1 set is not checked off. It still saves.')
                : tFallback('workout.uncheckedMany', '{n} sets are not checked off. They still save.', { n: unchecked })}
            </p>
          )}
        </div>

        {photoSlot}

        <div className="flex flex-col gap-2">
          <label htmlFor="finish-name" className="text-xs font-medium text-muted-foreground">
            {tFallback('workout.nameLabel', 'Workout name')}
          </label>
          <Input
            id="finish-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value.slice(0, 60))}
            placeholder={namePlaceholder}
            maxLength={60}
          />
          {editingTags ? (
            <TagSelector value={tags} onChange={onTagsChange} />
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((id) => (
                <span key={id} className="inline-flex items-center h-7 px-2.5 rounded-full bg-secondary text-xs font-semibold">
                  {tFallback(`workoutTag.${id}`, getTag(id)?.label || id)}
                </span>
              ))}
              <button
                type="button"
                onClick={() => setEditingTags(true)}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-border text-xs font-semibold text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
              >
                <Pencil className="w-3 h-3" aria-hidden="true" />
                {tags.length ? tFallback('workout.editTags', 'Edit tags') : tFallback('workout.addTags', 'Add tags')}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="finish-notes" className="text-xs font-medium text-muted-foreground">
            {tFallback('workout.howDidItFeel', 'How did it feel? (optional)')}
          </label>
          <Textarea
            id="finish-notes"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder={t('workout.notesPlaceholder')}
            className="h-20"
            maxLength={1000}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Button className="h-12 font-heading font-bold text-base" onClick={onSave} disabled={saving}>
            {saving ? t('workout.saving') : t('workout.saveWorkout')}
          </Button>
          <Button variant="ghost" className="text-muted-foreground" onClick={onClose}>
            {tFallback('workout.keepTraining', 'Keep training')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
