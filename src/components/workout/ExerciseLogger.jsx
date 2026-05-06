import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import SetRow from './SetRow';

export default function ExerciseLogger({ exercise, onChange }) {
  const sets = exercise.sets || [];

  const addSet = () => {
    const lastSet = sets[sets.length - 1] || { weight: 0, reps: 0 };
    onChange({ ...exercise, sets: [...sets, { weight: lastSet.weight, reps: lastSet.reps }] });
  };

  const updateSet = (index, updated) => {
    const newSets = [...sets];
    newSets[index] = updated;
    onChange({ ...exercise, sets: newSets });
  };

  const removeSet = (index) => {
    onChange({ ...exercise, sets: sets.filter((_, i) => i !== index) });
  };

  const totalVolume = sets.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);

  return (
    <Card className="p-4 border-none shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-medium text-sm">{exercise.name}</h4>
          {exercise.muscle_group && (
            <Badge variant="secondary" className="text-xs mt-1">{exercise.muscle_group}</Badge>
          )}
        </div>
        {totalVolume > 0 && (
          <span className="text-xs text-muted-foreground font-medium">{totalVolume.toLocaleString()} lbs vol</span>
        )}
      </div>

      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <span className="w-6 text-center">Set</span>
          <span className="flex-1 text-center">Weight (lbs)</span>
          <span className="w-4"></span>
          <span className="flex-1 text-center">Reps</span>
          <span className="w-8"></span>
        </div>
        {sets.map((set, i) => (
          <SetRow key={i} set={set} index={i} onChange={(s) => updateSet(i, s)} onRemove={() => removeSet(i)} />
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" className="w-full" onClick={addSet}>
        <Plus className="w-3.5 h-3.5 mr-1" /> Add Set
      </Button>
    </Card>
  );
}