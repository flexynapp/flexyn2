import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format, subDays, isAfter } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, Dumbbell, Calendar, Weight } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Progress() {
  const [selectedExercise, setSelectedExercise] = useState('all');
  const [timeRange, setTimeRange] = useState('30');

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['workoutLogs'],
    queryFn: () => base44.entities.WorkoutLog.list('-date', 200),
  });

  const filteredLogs = useMemo(() => {
    const cutoff = subDays(new Date(), parseInt(timeRange));
    return logs.filter(l => l.date && isAfter(new Date(l.date), cutoff));
  }, [logs, timeRange]);

  // Get all unique exercise names
  const exerciseNames = useMemo(() => {
    const names = new Set();
    logs.forEach(log => {
      log.exercises?.forEach(ex => {
        if (ex.name) names.add(ex.name);
      });
    });
    return Array.from(names).sort();
  }, [logs]);

  // Chart data: max weight over time for selected exercise
  const chartData = useMemo(() => {
    if (selectedExercise === 'all') {
      // Show total volume per workout
      return filteredLogs
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map(log => {
          const volume = log.exercises?.reduce((total, ex) => {
            return total + (ex.sets?.reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0) || 0);
          }, 0) || 0;
          return {
            date: format(new Date(log.date), 'MMM d'),
            value: volume,
            label: 'Volume (lbs)',
          };
        });
    }

    // Show max weight for specific exercise
    return filteredLogs
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(log => {
        const exercise = log.exercises?.find(ex => ex.name === selectedExercise);
        if (!exercise) return null;
        const maxWeight = exercise.sets?.reduce((max, s) => Math.max(max, s.weight || 0), 0) || 0;
        return {
          date: format(new Date(log.date), 'MMM d'),
          value: maxWeight,
          label: 'Max Weight (lbs)',
        };
      })
      .filter(Boolean);
  }, [filteredLogs, selectedExercise]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const totalVolume = filteredLogs.reduce((total, log) => {
      return total + (log.exercises?.reduce((t, ex) => {
        return t + (ex.sets?.reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0) || 0);
      }, 0) || 0);
    }, 0);

    const totalSets = filteredLogs.reduce((total, log) => {
      return total + (log.exercises?.reduce((t, ex) => t + (ex.sets?.length || 0), 0) || 0);
    }, 0);

    return {
      workouts: filteredLogs.length,
      totalVolume,
      totalSets,
    };
  }, [filteredLogs]);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight">Progress</h1>
        <p className="text-muted-foreground mt-1">Track your strength gains over time</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Select value={selectedExercise} onValueChange={setSelectedExercise}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All exercises" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Exercises (Volume)</SelectItem>
            {exerciseNames.map(name => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: 'Workouts', value: summaryStats.workouts, icon: Calendar },
          { label: 'Total Volume', value: `${(summaryStats.totalVolume / 1000).toFixed(1)}k lbs`, icon: Weight },
          { label: 'Total Sets', value: summaryStats.totalSets, icon: Dumbbell },
        ].map((stat, i) => (
          <Card key={i} className="p-4 border-none shadow-sm">
            <stat.icon className="w-4 h-4 text-muted-foreground mb-2" />
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <p className="font-heading text-xl md:text-2xl font-bold">{stat.value}</p>
            )}
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </Card>
        ))}
      </div>

      {/* Chart */}
      <Card className="p-5 border-none shadow-sm mb-8">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h3 className="font-heading font-bold">
            {selectedExercise === 'all' ? 'Total Volume Over Time' : `${selectedExercise} — Max Weight`}
          </h3>
        </div>
        {isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            No data for this time range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 4 }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Workout History */}
      <div>
        <h3 className="font-heading font-bold text-lg mb-4">Workout History</h3>
        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : filteredLogs.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <p className="text-muted-foreground">No workouts in this time range</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredLogs.map(log => (
              <Card key={log.id} className="p-4 border-none shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">{log.regimen_name || 'Freestyle Workout'}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.date ? format(new Date(log.date), 'EEEE, MMM d, yyyy') : '—'}
                      {log.duration_minutes ? ` · ${log.duration_minutes} min` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {log.exercises?.map((ex, i) => {
                    const maxWeight = ex.sets?.reduce((max, s) => Math.max(max, s.weight || 0), 0) || 0;
                    const totalSets = ex.sets?.length || 0;
                    return (
                      <Badge key={i} variant="secondary" className="text-xs font-normal">
                        {ex.name} · {totalSets}×{maxWeight > 0 ? `${maxWeight}lbs` : '—'}
                      </Badge>
                    );
                  })}
                </div>
                {log.notes && <p className="text-xs text-muted-foreground mt-2 italic">{log.notes}</p>}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}