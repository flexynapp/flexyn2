import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { format, subDays, isAfter } from 'date-fns';
import { Dumbbell, TrendingUp, Calendar, Play, ArrowRight, Flame } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function Dashboard() {
  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['workoutLogs'],
    queryFn: () => base44.entities.WorkoutLog.list('-date', 50),
  });

  const { data: regimens = [], isLoading: regimensLoading } = useQuery({
    queryKey: ['regimens'],
    queryFn: () => base44.entities.Regimen.list(),
  });

  const isLoading = logsLoading || regimensLoading;

  const thisWeekLogs = logs.filter(l => l.date && isAfter(new Date(l.date), subDays(new Date(), 7)));
  const totalExercises = logs.reduce((sum, l) => sum + (l.exercises?.length || 0), 0);

  const recentLogs = logs.slice(0, 5);

  const stats = [
    { label: 'Workouts This Week', value: thisWeekLogs.length, icon: Flame, color: 'text-chart-5' },
    { label: 'Total Workouts', value: logs.length, icon: Dumbbell, color: 'text-primary' },
    { label: 'Total Exercises', value: totalExercises, icon: TrendingUp, color: 'text-accent' },
    { label: 'Regimens', value: regimens.length, icon: Calendar, color: 'text-chart-4' },
  ];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Track your gains, crush your goals.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
        {stats.map((stat, i) => (
          <Card key={i} className="p-4 md:p-5 flex flex-col gap-3 border-none shadow-sm hover:shadow-md transition-shadow">
            <div className={`w-10 h-10 rounded-xl bg-secondary flex items-center justify-center`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <div>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="font-heading text-2xl md:text-3xl font-bold">{stat.value}</p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <Link to="/workout">
          <Card className="p-6 bg-primary text-primary-foreground border-none hover:opacity-90 transition-opacity cursor-pointer group">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-heading text-lg font-bold">Start Workout</p>
                <p className="text-sm opacity-80 mt-1">Pick a regimen and start logging</p>
              </div>
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Play className="w-6 h-6" />
              </div>
            </div>
          </Card>
        </Link>
        <Link to="/regimens">
          <Card className="p-6 border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer group">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-heading text-lg font-bold">Create Regimen</p>
                <p className="text-sm text-muted-foreground mt-1">Build a new workout plan</p>
              </div>
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center group-hover:scale-110 transition-transform">
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </div>
          </Card>
        </Link>
      </div>

      {/* Recent Workouts */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-xl font-bold">Recent Workouts</h2>
          <Link to="/progress" className="text-sm text-primary font-medium hover:underline">View all</Link>
        </div>
        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : recentLogs.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <Dumbbell className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No workouts yet. Start your first one!</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {recentLogs.map(log => (
              <Card key={log.id} className="p-4 border-none shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                  <Dumbbell className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{log.regimen_name || 'Freestyle Workout'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {log.date ? format(new Date(log.date), 'MMM d, yyyy') : '—'} · {log.exercises?.length || 0} exercises
                    {log.duration_minutes ? ` · ${log.duration_minutes} min` : ''}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}