import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, GripVertical } from 'lucide-react';

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core', 'Full Body', 'Cardio'];

export default function RegimenForm({ initial, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [exercises, setExercises] = useState(initial?.exercises || []);

  const addExercise = () => {
    setExercises([...exercises, { name: '', target_sets: 3, target_reps: 10, muscle_group: '', notes: '' }]);
  };

  const updateExercise = (index, field, value) => {
    const updated = [...exercises];
    updated[index] = { ...updated[index], [field]: value };
    setExercises(updated);
  };

  const removeExercise = (index) => {
    setExercises(exercises.filter((_, i) => i !== index));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ name, description, exercises });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">Regimen Name</label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Push Day, Upper Body A"
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">Description</label>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description of this regimen..."
            className="h-20"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-foreground">Exercises</label>
          <Button type="button" variant="outline" size="sm" onClick={addExercise}>
            <Plus className="w-4 h-4 mr-1" /> Add Exercise
          </Button>
        </div>

        {exercises.length === 0 && (
          <Card className="p-6 text-center border-dashed">
            <p className="text-sm text-muted-foreground">No exercises added yet.</p>
          </Card>
        )}

        <div className="space-y-3">
          {exercises.map((ex, i) => (
            <Card key={i} className="p-4 border-none shadow-sm">
              <div className="flex items-start gap-3">
                <GripVertical className="w-4 h-4 text-muted-foreground mt-3 shrink-0" />
                <div className="flex-1 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      value={ex.name}
                      onChange={e => updateExercise(i, 'name', e.target.value)}
                      placeholder="Exercise name"
                      required
                    />
                    <Select value={ex.muscle_group} onValueChange={v => updateExercise(i, 'muscle_group', v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Muscle group" />
                      </SelectTrigger>
                      <SelectContent>
                        {MUSCLE_GROUPS.map(g => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Target Sets</label>
                      <Input
                        type="number" min="1"
                        value={ex.target_sets}
                        onChange={e => updateExercise(i, 'target_sets', parseInt(e.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Target Reps</label>
                      <Input
                        type="number" min="1"
                        value={ex.target_reps}
                        onChange={e => updateExercise(i, 'target_reps', parseInt(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => removeExercise(i)} className="shrink-0 mt-1">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit">{initial ? 'Save Changes' : 'Create Regimen'}</Button>
      </div>
    </form>
  );
}