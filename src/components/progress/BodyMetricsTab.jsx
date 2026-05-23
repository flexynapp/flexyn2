import React, { useState, useMemo, useEffect } from 'react';
import { filterAfterReset } from '@/lib/accountReset';
import CycleTrackerCard from '@/components/wellness/CycleTrackerCard';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { format, differenceInYears, parseISO, isValid } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Scale, Pencil, X, Check, Ruler } from 'lucide-react';
import MuscleDiagram from '@/components/body-metrics/MuscleDiagram';
import MuscleDetailsModal from '@/components/body-metrics/MuscleDetailsModal';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { toast } from 'sonner';
import { reportError } from '@/lib/reportError';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import UnitPill from '@/components/UnitPill';
import { fromLbs, toLbs, formatWeight, formatWeightNumber } from '@/lib/weightUnit';


const CHART_STYLE = {
  contentStyle: {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
  },
};

const MEASUREMENTS = [
  { key: 'chest_in', labelKey: 'bodyMetrics.chest' },
  { key: 'waist_in', labelKey: 'bodyMetrics.waist' },
  { key: 'hips_in', labelKey: 'bodyMetrics.hips' },
  { key: 'left_arm_in', labelKey: 'bodyMetrics.leftArm' },
  { key: 'right_arm_in', labelKey: 'bodyMetrics.rightArm' },
  { key: 'left_thigh_in', labelKey: 'bodyMetrics.leftThigh' },
  { key: 'right_thigh_in', labelKey: 'bodyMetrics.rightThigh' },
];

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--accent))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  '#8b5cf6',
  '#f59e0b',
];

function empty() {
  return {
    date: format(new Date(), 'yyyy-MM-dd'),
    weight_lbs: '',
    body_fat_pct: '',
    chest_in: '',
    waist_in: '',
    hips_in: '',
    left_arm_in: '',
    right_arm_in: '',
    left_thigh_in: '',
    right_thigh_in: '',
    notes: '',
  };
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? undefined : n; }

function EntryForm({ initial, onSave, onCancel, t }) {
  const [form, setForm] = useState(initial || empty());
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    const payload = { date: form.date };
    if (form.weight_lbs !== '') payload.weight_lbs = num(form.weight_lbs);
    if (form.body_fat_pct !== '') payload.body_fat_pct = num(form.body_fat_pct);
    MEASUREMENTS.forEach(m => { if (form[m.key] !== '') payload[m.key] = num(form[m.key]); });
    if (form.notes) payload.notes = form.notes;
    onSave(payload);
  };

  return (
    <Card className="p-4 border-primary/30 border-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('bodyMetrics.dateRequired')}</label>
          <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('bodyMetrics.bodyFatPct')}</label>
          <Input type="number" inputMode="decimal" step="0.1" min="0" max="100" placeholder={t('bodyMetrics.bodyFatPlaceholder')} value={form.body_fat_pct} onChange={e => set('body_fat_pct', e.target.value)} />
        </div>
      </div>
      <p className="text-xs font-medium text-muted-foreground mb-2">{t('bodyMetrics.measurementsInches')}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {MEASUREMENTS.map(m => (
          <div key={m.key}>
            <label className="text-xs text-muted-foreground mb-0.5 block">{t(m.labelKey)}</label>
            <Input type="number" inputMode="decimal" step="0.1" min="0" placeholder="—" value={form[m.key]} onChange={e => set(m.key, e.target.value)} className="h-8 text-sm" />
          </div>
        ))}
      </div>
      <div className="mb-3">
        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('workout.notes')}</label>
        <Input placeholder={t('bodyMetrics.notesPlaceholder')} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}><X className="w-3.5 h-3.5 mr-1" /> {t('common.cancel')}</Button>
        <Button size="sm" onClick={handleSave} disabled={!form.date}><Check className="w-3.5 h-3.5 mr-1" /> {t('common.save')}</Button>
      </div>
    </Card>
  );
}

function formatHeight(inches) {
  if (!inches) return null;
  const ft = Math.floor(inches / 12);
  const ins = Math.round(inches % 12);
  return `${ft}'${ins}"`;
}

export default function BodyMetricsTab() {
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [activeMetrics, setActiveMetrics] = useState(['weight_lbs', 'body_fat_pct']);
  const [initialForm, setInitialForm] = useState(null);
  const [editingProfile, setEditingProfile] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [muscleModal, setMuscleModal] = useState({ open: false, muscleId: null, category: null });

  // Fetch user profile for height + pre-filled weight
  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });

  // Pre-fill weight from profile when opening the form for the first time
  useEffect(() => {
    if (showForm && !initialForm && profile?.weight_lbs) {
      setInitialForm({ weight_lbs: profile.weight_lbs.toString() });
    } else if (!showForm) {
      setInitialForm(null);
    }
  }, [showForm, profile]);  

  const { data: rawEntries = [], isLoading } = useQuery({
    queryKey: ['bodyMetrics', user?.email],
    queryFn: () => db.entities.BodyMetric.filter({ created_by: user.email }, 'date', 200),
    enabled: !!user?.email,
  });

  const { data: rawLogs = [] } = useQuery({
    queryKey: ['workoutLogs', user?.email],
    queryFn: () => db.entities.WorkoutLog.filter({ created_by: user.email }, '-date', 200),
    enabled: !!user?.email,
  });

  const entries = useMemo(() => filterAfterReset(rawEntries, profile), [rawEntries, profile]);
  const logs = useMemo(() => filterAfterReset(rawLogs, profile), [rawLogs, profile]);

  const handleMuscleClick = (muscleId, muscleData) => {
    setMuscleModal({ open: true, muscleId, category: muscleData.category });
  };

  const createMutation = useMutation({
    mutationFn: d => db.entities.BodyMetric.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bodyMetrics', user?.email] }); setShowForm(false); toast.success(t('bodyMetrics.saved')); },
    onError: (err) => {
      reportError(err, { feature: 'bodyMetrics.create', level: 'warning', userEmail: user?.email });
      toast.error('Could not save measurement. Try again.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => db.entities.BodyMetric.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bodyMetrics', user?.email] }); setEditingId(null); toast.success(t('bodyMetrics.updated')); },
    onError: (err) => {
      reportError(err, { feature: 'bodyMetrics.update', level: 'warning', userEmail: user?.email });
      toast.error('Could not update measurement. Try again.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: id => db.entities.BodyMetric.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bodyMetrics', user?.email] }); toast.success(t('bodyMetrics.deleted')); },
    onError: (err) => {
      reportError(err, { feature: 'bodyMetrics.delete', level: 'warning', userEmail: user?.email });
      toast.error('Could not delete measurement. Try again.');
    },
  });

  const sorted = useMemo(() => {
    // Filter out entries with bad/missing dates BEFORE chart rendering — date-fns
    // format() throws on Invalid Date which used to crash the whole tab.
    const valid = (entries || []).filter(e => {
      if (!e?.date) return false;
      const d = new Date(e.date);
      return !isNaN(d.getTime());
    });
    return valid.sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [entries]);

  const chartData = useMemo(() => sorted.map(e => {
    let dateLabel = '—';
    try {
      dateLabel = format(new Date(e.date), 'MMM d', { locale: dateLocale });
    } catch { /* keep fallback */ }
    return {
      date: dateLabel,
      weight_lbs: e.weight_lbs ?? null,
      weightDisplay: e.weight_lbs != null ? fromLbs(e.weight_lbs, weightUnit) : null,
      body_fat_pct: e.body_fat_pct ?? null,
      ...Object.fromEntries(MEASUREMENTS.map(m => [m.key, e[m.key] ?? null])),
    };
  }), [sorted, dateLocale, weightUnit]);

  const ALL_METRICS = [
    { key: 'weight_lbs', label: t('workout.weightWithUnit').replace('lbs', weightUnit) },
    { key: 'body_fat_pct', label: 'Body Fat (%)' },
    ...MEASUREMENTS.map(m => ({ key: m.key, label: `${t(m.labelKey)} (in)` })),
  ];

  const toggleMetric = (key) => {
    setActiveMetrics(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const latest = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];

  const delta = (key) => {
    // Defensive: Supabase numeric columns can come back as strings, in which
    // case `latest[key] - prev[key]` may produce NaN-or-string under strict
    // type checks. Coerce both sides to Number explicitly.
    const a = Number(latest?.[key]);
    const b = Number(prev?.[key]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return (a - b).toFixed(1);
  };

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-secondary rounded-xl animate-pulse" />)}</div>;

  const calculateAge = (birthday) => {
    if (!birthday) return null;
    // parseISO handles 'YYYY-MM-DD'; fall back to Date() for other formats
    const d = parseISO(String(birthday));
    if (!isValid(d)) return null;
    return differenceInYears(new Date(), d);
  };

  // Safe wrapper: returns a formatted string or null — never throws
  const safeDateFormat = (birthday, fmt) => {
    if (!birthday) return null;
    const d = parseISO(String(birthday));
    if (!isValid(d)) return null;
    try { return format(d, fmt, { locale: dateLocale }); } catch { return null; }
  };

  const handleProfileUpdate = async (field, value) => {
    // Birthday is stored as a date string, not a number
    if (field === 'birthday') {
      if (!value) return;
      try {
        await db.auth.updateMe({ birthday: value });
        queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        setEditingProfile(null);
        setEditValue('');
      } catch (err) {
        console.error('Profile update failed:', err);
        toast.error(t('bodyMetrics.saveError'));
      }
      return;
    }

    let parsed = parseFloat(value);
    if (isNaN(parsed)) return;

    // Convert weight input from user's unit to lbs before saving
    if (field === 'weight_lbs') parsed = toLbs(parsed, weightUnit);

    if (field === 'weight_lbs' && (parsed < 50 || parsed > 700)) {
      toast.error(t('bodyMetrics.invalidWeight'), {
        action: { label: t('common.fixIt'), onClick: () => setEditValue('') },
        duration: 6000,
      });
      return;
    }
    if (field === 'height_inches' && (parsed < 36 || parsed > 108)) {
      toast.error(t('bodyMetrics.invalidHeight'), {
        action: { label: t('common.fixIt'), onClick: () => setEditValue('') },
        duration: 6000,
      });
      return;
    }

    try {
      const updatePayload = field === 'birthday' ? { birthday: value } : { [field]: parsed };
      await db.auth.updateMe(updatePayload);
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      setEditingProfile(null);
      setEditValue('');
    } catch (err) {
      console.error('Profile update failed:', err);
      toast.error(t('bodyMetrics.saveError'));
    }
  };

  return (
    <div className="space-y-6">
      {/* Cycle tracker — opt-in, owner-only. Sits at the top of the
          body-metrics surface where the user is already looking at
          private health data. Mig 128 ships the cycle_logs table +
          cycle_tracking_enabled flag (off by default). */}
      <CycleTrackerCard profile={profile} />

      {/* Profile stats: height, weight, age */}
       {editingProfile === null ? (
         <div className="w-full grid grid-cols-3 gap-3 md:gap-4">
          {profile?.height_inches && (
            <Card className="p-4 border-none shadow-sm flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                <Ruler className="w-6 h-6 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground mb-1">{t('progress.bodyMetrics.height')}</p>
              <p className="font-heading font-bold text-2xl">{formatHeight(profile.height_inches)}</p>
              <p className="text-xs text-muted-foreground mt-1">{Math.round(profile.height_inches * 2.54)} cm</p>
              <Button size="sm" variant="ghost" className="h-6 text-xs mt-3" onClick={() => { setEditingProfile('height_inches'); setEditValue(profile?.height_inches?.toString() || ''); }}>
                <Pencil className="w-3 h-3 mr-1" /> Edit
              </Button>
            </Card>
          )}
          {profile?.weight_lbs && (
            <Card className="p-4 border-none shadow-sm flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-2">
                <Scale className="w-6 h-6 text-accent" />
              </div>
              <p className="text-xs text-muted-foreground mb-1">{t('progress.bodyMetrics.weight')}</p>
              <p className="font-heading font-bold text-2xl">{formatWeight(profile.weight_lbs, weightUnit)}</p>
              <Button size="sm" variant="ghost" className="h-6 text-xs mt-3" onClick={() => { setEditingProfile('weight_lbs'); setEditValue(formatWeightNumber(profile?.weight_lbs, weightUnit)); }}>
                <Pencil className="w-3 h-3 mr-1" /> Edit
              </Button>
            </Card>
          )}
          {profile?.birthday && calculateAge(profile.birthday) !== null && (
            <Card className="p-4 border-none shadow-sm flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-lg bg-chart-3/10 flex items-center justify-center mb-2">
                <span className="text-lg font-bold text-chart-3">🎂</span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">{t('progress.bodyMetrics.age')}</p>
              <p className="font-heading font-bold text-2xl">{calculateAge(profile.birthday)} years</p>
              {safeDateFormat(profile.birthday, 'MMM d') && (
                <p className="text-xs text-muted-foreground mt-0.5">{safeDateFormat(profile.birthday, 'MMM d')}</p>
              )}
              <Button size="sm" variant="ghost" className="h-6 text-xs mt-3" onClick={() => { setEditingProfile('birthday'); setEditValue(profile.birthday?.slice(0, 10) || ''); }}>
                <Pencil className="w-3 h-3 mr-1" /> Edit
              </Button>
            </Card>
          )}
           </div>
           ) : (
        <Card className="p-4 border-primary/30 border-2">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-muted-foreground">
              {editingProfile === 'height_inches'
                ? t('bodyMetrics.editHeightLabel')
                : editingProfile === 'birthday'
                ? 'Date of birth'
                : t('bodyMetrics.editWeightLabel').replace('{unit}', '').trim()}
            </label>
            {/* Inline unit-swap pill for the weight edit field — same
                component used in LogWeightModal + GoalForm. One tap to
                flip lb ↔ kg without leaving the form. */}
            {editingProfile === 'weight_lbs' && <UnitPill />}
          </div>
          <div className="flex gap-2">
            <Input
              type={editingProfile === 'birthday' ? 'date' : 'number'}
              step={editingProfile === 'birthday' ? undefined : '0.1'}
              placeholder={editingProfile === 'height_inches' ? 'e.g. 70' : editingProfile === 'birthday' ? '' : 'e.g. 175'}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              className="h-10"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleProfileUpdate(editingProfile, editValue);
                if (editingProfile !== 'birthday' && ['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
              }}
              autoFocus
            />
            <Button
              size="sm"
              onClick={() => handleProfileUpdate(editingProfile, editValue)}
            >
              <Check className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setEditingProfile(null); setEditValue(''); }}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* Logged metrics section */}
      <div className="space-y-6">
        {/* Summary strip */}
        {latest && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { key: 'weight_lbs', labelKey: 'bodyMetrics.weight', unit: weightUnit, color: 'text-primary', isWeight: true },
            { key: 'body_fat_pct', labelKey: 'bodyMetrics.bodyFat', unit: '%', color: 'text-chart-3' },
            { key: 'waist_in', labelKey: 'bodyMetrics.waist', unit: 'in', color: 'text-chart-4' },
            { key: 'chest_in', labelKey: 'bodyMetrics.chest', unit: 'in', color: 'text-accent' },
          ].map(({ key, labelKey, unit, color, isWeight }) => latest[key] != null && (
            <Card key={key} className="p-4 border-none shadow-sm text-center">
              <p className={`font-heading text-2xl font-bold ${color}`}>
                {isWeight ? formatWeight(latest[key], weightUnit) : `${latest[key]}${unit === '%' ? '%' : ''}`}
              </p>
              {unit !== '%' && !isWeight && <p className="text-xs text-muted-foreground">{unit}</p>}
              <p className="text-xs text-muted-foreground mt-0.5">{t(labelKey)}</p>
              {delta(key) !== null && (
                <p className={`text-xs font-medium mt-0.5 ${parseFloat(delta(key)) === 0 ? 'text-muted-foreground' : parseFloat(delta(key)) < 0 ? 'text-accent' : 'text-destructive'}`}>
                  {parseFloat(delta(key)) > 0 ? '+' : ''}{delta(key)}
                </p>
              )}
            </Card>
          ))}
          </div>
        )}

        {/* Add Entry Button / Form */}
        {showForm ? (
        <EntryForm initial={initialForm ? { ...empty(), ...initialForm } : undefined} onSave={d => createMutation.mutate(d)} onCancel={() => setShowForm(false)} t={t} />
        ) : (
          <Button variant="outline" className="w-full" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> {t('progress.bodyMetrics.addEntry')}
          </Button>
        )}

        {/* Weight Over Time Chart */}
      {chartData.length >= 2 && sorted.some(e => e.weight_lbs) && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <Card className="p-5 border-none shadow-sm aspect-square flex flex-col">
            <h2 className="font-heading font-bold mb-1">{t('progress.bodyMetrics.weightProgress')}</h2>
            <p className="text-xs text-muted-foreground mb-3">{t('progress.bodyMetrics.weightTrend')}</p>
            <ResponsiveContainer width="100%" height={250} key={weightUnit}>
              <LineChart data={chartData.filter(d => d.weightDisplay !== null)}>
                <CartesianGrid strokeDasharray="0" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip {...CHART_STYLE} />
                <Line
                  type="natural"
                  dataKey="weightDisplay"
                  name={t('workout.weightWithUnit').replace('lbs', weightUnit)}
                  stroke="hsl(var(--primary))"
                  strokeWidth={3}
                  dot={{ fill: 'hsl(var(--primary))', stroke: 'hsl(var(--card))', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, strokeWidth: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
        )}

        {/* Metrics Chart */}
      {chartData.length >= 2 && (
        <Card className="p-5 border-none shadow-sm">
          <h2 className="font-heading font-bold mb-1">{t('progress.bodyMetrics.progressOverTime')}</h2>
          <p className="text-xs text-muted-foreground mb-3">{t('progress.bodyMetrics.toggleMetrics')}</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {ALL_METRICS.map((m, i) => (
              <button
                key={m.key}
                onClick={() => toggleMetric(m.key)}
                className={`text-xs px-3 py-1 rounded-full border transition-all ${activeMetrics.includes(m.key) ? 'border-transparent text-white' : 'border-border text-muted-foreground hover:text-foreground'}`}
                style={activeMetrics.includes(m.key) ? { background: CHART_COLORS[i % CHART_COLORS.length] } : {}}
              >
                {m.label}
              </button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip {...CHART_STYLE} />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              {ALL_METRICS.filter(m => activeMetrics.includes(m.key)).map((m, i) => (
                <Line
                  key={m.key}
                  type="monotone"
                  dataKey={m.key}
                  name={m.label}
                  stroke={CHART_COLORS[ALL_METRICS.findIndex(x => x.key === m.key) % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={{ strokeWidth: 0, r: 3 }}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
        )}

          {/* Training Heatmap */}
        <div className="w-full overflow-x-auto">
          <div style={{ minWidth: 320 }}>
            <MuscleDiagram
              workoutHistory={logs}
              gender={profile?.gender}
              timeRange="30d"
              onMuscleClick={handleMuscleClick}
            />
          </div>
        </div>

        {/* Muscle Details Modal */}
        <MuscleDetailsModal
          open={muscleModal.open}
          onClose={() => setMuscleModal({ open: false, muscleId: null, category: null })}
          muscleId={muscleModal.muscleId}
          category={muscleModal.category}
          workoutHistory={logs}
        />

        {/* History Table */}
      {sorted.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Scale className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-heading font-semibold">{t('progress.bodyMetrics.noEntries')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('progress.bodyMetrics.noEntriesDesc')}</p>
        </Card>
      ) : (
        <Card className="border-none shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-heading font-bold">{t('progress.bodyMetrics.history')}</h2>
          </div>
          <div className="divide-y divide-border">
            {[...sorted].reverse().map(entry => (
              editingId === entry.id ? (
                <div key={entry.id} className="p-4">
                  <EntryForm
                   initial={{
                     date: entry.date,
                     weight_lbs: entry.weight_lbs ?? '',
                     body_fat_pct: entry.body_fat_pct ?? '',
                     ...Object.fromEntries(MEASUREMENTS.map(m => [m.key, entry[m.key] ?? ''])),
                     notes: entry.notes ?? '',
                   }}
                   onSave={d => updateMutation.mutate({ id: entry.id, data: d })}
                   onCancel={() => setEditingId(null)}
                   t={t}
                  />
                </div>
              ) : (
                <div key={entry.id} className="p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Scale className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{format(new Date(entry.date), 'MMM d, yyyy', { locale: dateLocale })}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      {entry.weight_lbs != null && <span className="text-xs text-muted-foreground">{formatWeight(entry.weight_lbs, weightUnit)}</span>}
                      {entry.body_fat_pct != null && <span className="text-xs text-muted-foreground">{entry.body_fat_pct}% BF</span>}
                      {MEASUREMENTS.filter(m => entry[m.key] != null).map(m => (
                        <span key={m.key} className="text-xs text-muted-foreground">{m.label}: {entry[m.key]}"</span>
                      ))}
                    </div>
                    {entry.notes && <p className="text-xs text-muted-foreground italic mt-1">{entry.notes}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(entry.id)}>
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteMutation.mutate(entry.id)}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              )
            ))}
          </div>
        </Card>
      )}
      </div>
    </div>
  );
}