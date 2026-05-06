import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Play, Save, Plus, Dumbbell } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import ExerciseLogger from '@/components/workout/ExerciseLogger';

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core', 'Full Body', 'Cardio'];

export default function Workout() {
  const [started, setStarted] = useState(false);
  const [selectedRegimen, setSelectedRegimen] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [newExName, setNewExName] = useState('');
  const [newExGroup, setNewExGroup] = useState('');

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: regimens = [], isLoading } = useQuery({
    queryKey: ['regimens'],
    queryFn: () => base44.entities.Regimen.list(),
  });

  const saveMutation = useMutation({
    mutationFn: (data) => base44.entities.WorkoutLog.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workoutLogs'] });
      toast({ title: 'Workout saved!', description: 'Your workout has been logged.' });
      resetWorkout();
    },
  });

  const startFromRegimen = (regimen) => {
    setSelectedRegimen(regimen);
    setExercises(
      (regimen.exercises || []).map(ex => ({
        name: ex.name,
        muscle_group: ex.muscle_group || '',
        sets: Array.from({ length: ex.target_sets || 3 }, () => ({ weight: 0, reps: ex.target_reps || 10 })),
      }))
    );
    setStarted(true);
  };

  const startFreestyle = () => {
    setSelectedRegimen(null);
    setExercises([]);
    setStarted(true);
  };

  const addExercise = () => {
    if (!newExName.trim()) return;
    setExercises([...exercises, { name: newExName.trim(), muscle_group: newExGroup, sets: [{ weight: 0, reps: 10 }] }]);
    setNewExName('');
    setNewExGroup('');
  };

  const updateExercise = (index, updated) => {
    const newExercises = [...exercises];
    newExercises[index] = updated;
    setExercises(newExercises);
  };

  const saveWorkout = () => {
    saveMutation.mutate({
      regimen_id: selectedRegimen?.id || '',
      regimen_name: selectedRegimen?.name || 'Freestyle Workout',
      date,
      duration_minutes: duration ? parseInt(duration) : null,
      exercises,
      notes,
    });
  };

  const resetWorkout = () => {
    setStarted(false);
    setSelectedRegimen(null);
    setExercises([]);
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setDuration('');
    setNotes('');
  };

  if (!started) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight">Start Workout</h1>
          <p className="text-muted-foreground mt-1">Choose a regimen or go freestyle</p>
        </div>

        <Card
          className="p-6 mb-6 border-dashed cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all"
          onClick={startFreestyle}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center">
              <Plus className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-heading font-bold">Freestyle Workout</p>
              <p className="text-sm text-muted-foreground">Add exercises on the fly</p>
            </div>
          </div>
        </Card>

        {isLoading ? (
          <div className="space-y-3">
            {[1,2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : regimens.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">Your Regimens</h2>
            {regimens.map(r => (
              <Card
                key={r.id}
                className="p-5 border-none shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => startFromRegimen(r)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Play className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-bold">{r.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{r.exercises?.length || 0} exercises</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold tracking-tight">
            {selectedRegimen?.name || 'Freestyle Workout'}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Log your sets and reps</p>
        </div>
        <Button variant="outline" size="sm" onClick={resetWorkout}>Cancel</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Date</label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Duration (min)</label>
          <Input type="number" min="0" value={duration} onChange={e => setDuration(e.target.value)} placeholder="Optional" />
        </div>
      </div>

      <div className="space-y-4 mb-6">
        {exercises.map((ex, i) => (
          <ExerciseLogger key={i} exercise={ex} onChange={(updated) => updateExercise(i, updated)} />
        ))}
      </div>

      {/* Add exercise */}
      <Card className="p-4 border-dashed mb-6">
        <p className="text-sm font-medium mb-3">Add Exercise</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newExName}
            onChange={e => setNewExName(e.target.value)}
            placeholder="Exercise name"
            className="flex-1"
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addExercise())}
          />
          <Select value={newExGroup} onValueChange={setNewExGroup}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Muscle group" />
            </SelectTrigger>
            <SelectContent>
              {MUSCLE_GROUPS.map(g => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={addExercise} disabled={!newExName.trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </Card>

      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="How did the workout feel?" className="h-20" />
      </div>

      <Button
        className="w-full h-12 font-heading font-bold text-base"
        onClick={saveWorkout}
        disabled={exercises.length === 0 || saveMutation.isPending}
      >
        <Save className="w-5 h-5 mr-2" />
        {saveMutation.isPending ? 'Saving...' : 'Save Workout'}
      </Button>
    </div>
  );
}