// src/components/workout/TemplatesModal.jsx
// Unified template modal: create (with public toggle), load personal,
// browse community templates, share to Hub.

import React, { useState, useMemo } from 'react';
import { handle } from '@/lib/userDisplay';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from '@/lib/toast';
import {
  Plus, Trash2, Dumbbell, Save, FolderOpen, PenLine,
  Globe, Lock, Send, Copy, Search, Users,
} from 'lucide-react';
import ExerciseAutocomplete from '@/components/regimens/ExerciseAutocomplete';
import { useProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import * as templates from '@/lib/data/templates';
import * as hubPosts from '@/lib/data/hubPosts';

// ── Create form ───────────────────────────────────────────────────────────────

function NewTemplateForm({ onSave, onCancel }) {
  const { t, tFallback } = useLanguage();
  const [name, setName] = useState('');
  const nameGuard = useProfanityGuard(setName);
  const [exercises, setExercises] = useState([]);
  const [exName, setExName] = useState('');
  const [exCanonical, setExCanonical] = useState('');
  const [exGroup, setExGroup] = useState('');
  const [exSets, setExSets] = useState('3');
  const [exReps, setExReps] = useState('10');
  const [isPublic, setIsPublic] = useState(false);

  const addExercise = () => {
    if (!exName.trim()) return;
    const displayName = exName.trim();
    const canonicalName = exCanonical || displayName;
    setExercises(prev => [...prev, {
      name: canonicalName,
      displayName,
      muscle_group: exGroup,
      target_sets: parseInt(exSets) || 3,
      target_reps: parseInt(exReps) || 10,
    }]);
    setExName('');
    setExCanonical('');
    setExGroup('');
    setExSets('3');
    setExReps('10');
  };

  const handleSave = () => {
    if (hasAnyProfanity(name)) {
      toast.error(tFallback('common.profanity.beforeSaving', 'Please remove inappropriate language before saving.'));
      return;
    }
    if (!name.trim()) {
      toast.error(tFallback('templatesModal.needName', 'Give your template a name first.'));
      return;
    }
    if (exercises.length === 0) {
      toast.error(tFallback('templatesModal.needExercise', 'Add at least one exercise.'));
      return;
    }
    onSave({ name: name.trim(), exercises, is_public: isPublic, copy_count: 0 });
  };

  return (
    <div className="space-y-4">
      <Input
        placeholder={t('workout.templates.namePlaceholder')}
        value={name}
        onChange={e => nameGuard.handleChange(e.target.value)}
      />

      {/* Added exercises */}
      <div className="space-y-2">
        {exercises.map((ex, i) => (
          <div key={i} className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-2">
            <Dumbbell className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm flex-1 font-medium">{ex.displayName || ex.name}</span>
            <span className="text-xs text-muted-foreground">{ex.target_sets}×{ex.target_reps}</span>
            <button
              onClick={() => setExercises(prev => prev.filter((_, idx) => idx !== i))}
              className="text-muted-foreground hover:text-destructive active:text-destructive transition-colors ms-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add exercise row */}
      <div className="border border-dashed rounded-lg p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{t('workout.templates.addExercise')}</p>
        <ExerciseAutocomplete
          value={exName}
          onChange={setExName}
          onSelect={(ex) => {
            setExName(ex.displayName || ex.name);
            setExCanonical(ex.name);
            setExGroup(ex.muscles[0] || '');
          }}
          placeholder={tFallback('workout.searchExercise', 'Search exercise...')}
        />
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">{t('workout.templates.sets')}</label>
            <Input type="number" inputMode="decimal" min="1" value={exSets} onChange={e => setExSets(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">{t('workout.templates.reps')}</label>
            <Input type="number" inputMode="decimal" min="1" value={exReps} onChange={e => setExReps(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="flex items-end">
            <Button size="sm" className="h-8" onClick={addExercise} disabled={!exName.trim()}>
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Public / private toggle */}
      <button
        type="button"
        onClick={() => setIsPublic(p => !p)}
        className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors ${
          isPublic ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/30'
        }`}
      >
        <div className="flex items-center gap-2 text-start">
          {isPublic
            ? <Globe className="w-4 h-4 text-primary shrink-0" />
            : <Lock className="w-4 h-4 text-muted-foreground shrink-0" />}
          <div>
            <p className="font-semibold text-sm">
              {isPublic ? t('workout.templates.public') : t('workout.templates.private')}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isPublic ? t('workout.templates.publicDesc') : t('workout.templates.privateDesc')}
            </p>
          </div>
        </div>
        <div className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${isPublic ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${isPublic ? 'start-5' : 'start-1'}`} />
        </div>
      </button>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" className="flex-1" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button
          className="flex-1"
          disabled={!name.trim() || exercises.length === 0}
          onClick={handleSave}
        >
          <Save className="w-4 h-4 me-1.5" />
          {t('workout.templates.saveBtn')}
        </Button>
      </div>

      <ProfanityWarningDialog open={nameGuard.open} onContinue={nameGuard.onContinue} />
    </div>
  );
}

// ── Share to Hub mini-form ────────────────────────────────────────────────────

function ShareToHubForm({ template, user, onClose }) {
  const { t, tFallback } = useLanguage();
  const [caption, setCaption] = useState('');
  const [privacy, setPrivacy] = useState('public');
  const [posting, setPosting] = useState(false);

  const handlePost = async () => {
    if (!user?.email) return;
    setPosting(true);
    try {
      const exerciseCount = template.exercises?.length || 0;
      const body = caption.trim() ||
        `Check out my workout template: ${template.name} · ${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`;

      await hubPosts.create({
        author_email: user.email,
        author_name: user.username || 'Athlete',
        author_avatar_url: user.avatar_url || null,
        post_type: 'regimen',
        body,
        privacy,
        like_count: 0,
        dislike_count: 0,
        comment_count: 0,
        linked_entity_type: 'workout_template',
        linked_entity_id: template.id,
        linked_entity_snapshot: {
          name: template.name,
          exercises: (template.exercises || []).slice(0, 10).map(ex => ({
            exercise_name: ex.displayName || ex.name,
            target_sets: ex.target_sets,
            target_reps: ex.target_reps,
          })),
        },
      });
      toast.success(t('regimens.toast.shared'));
      onClose();
    } catch (err) {
      console.error('Share to Hub failed:', err);
      toast.error(t('common.error'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-3 pt-2 border-t mt-3">
      <Textarea
        placeholder={tFallback("hub.composer.captionPlaceholder", "Add a caption (optional)…")}
        value={caption}
        onChange={e => setCaption(e.target.value)}
        rows={2}
        className="resize-none text-sm"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button" size="sm"
          variant={privacy === 'public' ? 'default' : 'outline'}
          onClick={() => setPrivacy('public')}
          className="gap-1 text-xs"
        >
          <Globe className="w-3 h-3" /> {tFallback("hub.privacy.public", "Public")}
        </Button>
        <Button
          type="button" size="sm"
          variant={privacy === 'followers-only' ? 'default' : 'outline'}
          onClick={() => setPrivacy('followers-only')}
          className="gap-1 text-xs"
        >
          <Lock className="w-3 h-3" /> {tFallback("hub.privacy.followersOnly", "Followers only")}
        </Button>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
        <Button size="sm" onClick={handlePost} disabled={posting} className="gap-1">
          <Send className="w-3 h-3" />
          {posting ? t('common.posting') : t('hub.post')}
        </Button>
      </div>
    </div>
  );
}

// ── Personal template card ────────────────────────────────────────────────────

function MyTemplateCard({ template, user, onUse, onDelete, onTogglePublic }) {
  const { t, tFallback } = useLanguage();
  const [sharingOpen, setSharingOpen] = useState(false);

  return (
    <Card className="p-4 border-none shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-heading font-bold">{template.name}</p>
            {template.is_public
              ? <Badge variant="secondary" className="text-xs gap-1"><Globe className="w-3 h-3" /> {tFallback("hub.privacy.public", "Public")}</Badge>
              : <Badge variant="outline" className="text-xs gap-1"><Lock className="w-3 h-3" /> {tFallback("hub.messages.privateNote.short", "Private")}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('workout.templates.exerciseCount', { n: template.exercises?.length || 0 })}
            {template.exercises?.length > 0 && (
              <> · <span className="truncate">
                {template.exercises.slice(0, 3).map(e => e.displayName || e.name).join(', ')}
                {template.exercises.length > 3 ? '…' : ''}
              </span></>
            )}
          </p>
          {template.copy_count > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <Copy className="w-3 h-3" /> {template.copy_count} copies
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          <Button size="sm" onClick={onUse}>{t('workout.templates.useThis')}</Button>

          {/* Make public/private toggle */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-xs"
            onClick={onTogglePublic}
          >
            {template.is_public
              ? <><Lock className="w-3 h-3" /> {tFallback("templatesModal.makePrivate", "Make private")}</>
              : <><Globe className="w-3 h-3" /> {tFallback("templatesModal.makePublic", "Make public")}</>}
          </Button>

          {/* Share to Hub */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-xs"
            onClick={() => setSharingOpen(s => !s)}
          >
            <Send className="w-3 h-3" /> {tFallback("templatesModal.shareToHub", "Share to Hub")}
          </Button>

          {/* Delete */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 text-xs text-destructive hover:text-destructive active:text-destructive">
                <Trash2 className="w-3 h-3" /> {tFallback("common.delete", "Delete")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('workout.templates.deleteTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('workout.templates.deleteDesc', { name: template.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>{t('common.delete')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {sharingOpen && (
        <ShareToHubForm
          template={template}
          user={user}
          onClose={() => setSharingOpen(false)}
        />
      )}
    </Card>
  );
}

// ── Community template card ───────────────────────────────────────────────────

function CommunityTemplateCard({ template, user, queryClient, onCopied }) {
  const { t } = useLanguage();
  const isMine = template.created_by === user?.email;
  const authorHandle = handle(template);

  const copyMutation = useMutation({
    mutationFn: () => templates.copyTemplate(template, user),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['publicTemplates'] });
      toast.success(t('regimens.toast.copied'));
      onCopied?.();
    },
    onError: () => toast.error(t('common.error')),
  });

  return (
    <Card className="p-4 border-none shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-heading font-bold">{template.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{authorHandle}
            {isMine && <span className="ms-1 text-primary">(yours)</span>}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {template.exercises?.length || 0} exercises
          </p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {(template.exercises || []).slice(0, 4).map((ex, i) => (
              <Badge key={i} variant="secondary" className="text-xs font-normal">
                {ex.displayName || ex.name}
              </Badge>
            ))}
            {(template.exercises || []).length > 4 && (
              <Badge variant="outline" className="text-xs font-normal">
                +{template.exercises.length - 4}
              </Badge>
            )}
          </div>
          {(template.copy_count || 0) > 0 && (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <Copy className="w-3 h-3" /> {template.copy_count} copies
            </p>
          )}
        </div>

        {!isMine && (
          <Button
            size="sm"
            className="gap-1 text-xs shrink-0"
            onClick={() => copyMutation.mutate()}
            disabled={copyMutation.isPending}
          >
            <Copy className="w-3 h-3" />
            {copyMutation.isPending ? '…' : 'Copy'}
          </Button>
        )}
      </div>
    </Card>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
// view: 'choice' | 'create' | 'load'
// loadTab: 'mine' | 'community'

export default function TemplatesModal({ open, onClose, onLoadTemplate }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [view, setView] = useState('choice');
  const [loadTab, setLoadTab] = useState('mine');
  const [search, setSearch] = useState('');

  // Personal templates
  const { data: myTemplates = [], isLoading: myLoading } = useQuery({
    queryKey: ['workoutTemplates', user?.email],
    queryFn: () => templates.list(user.id),
    enabled: !!user?.email && view === 'load',
  });

  // Community templates
  const { data: communityTemplates = [], isLoading: communityLoading } = useQuery({
    queryKey: ['publicWorkoutTemplates'],
    queryFn: () => templates.listPublic(100),
    enabled: !!user?.email && view === 'load' && loadTab === 'community',
    staleTime: 30_000,
  });

  const filteredCommunity = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return communityTemplates;
    return communityTemplates.filter(t =>
      t.name?.toLowerCase().includes(q) ||
      (t.exercises || []).some(ex => (ex.displayName || ex.name || '').toLowerCase().includes(q))
    );
  }, [communityTemplates, search]);

  const createMutation = useMutation({
    mutationFn: (data) => templates.create({ ...data, created_by: user.email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates', user?.email] });
      if (/* was public */ true) queryClient.invalidateQueries({ queryKey: ['publicWorkoutTemplates'] });
      setView('choice');
      toast.success(t('workout.templates.saved'));
    },
    onError: () => toast.error(t('common.error')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => templates.remove(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['workoutTemplates', user?.email] });
      const previous = queryClient.getQueryData(['workoutTemplates', user?.email]);
      queryClient.setQueryData(['workoutTemplates', user?.email], (old = []) => old.filter(t => t.id !== id));
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      queryClient.setQueryData(['workoutTemplates', user?.email], ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['workoutTemplates', user?.email] }),
  });

  const togglePublicMutation = useMutation({
    mutationFn: ({ id, is_public }) => templates.update(id, { is_public }),
    onSuccess: (_, { is_public }) => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['publicWorkoutTemplates'] });
      toast.success(is_public ? t('regimens.toast.madePublic') : t('regimens.toast.madePrivate'));
    },
    onError: () => toast.error(t('common.error')),
  });

  const handleClose = () => {
    setView('choice');
    setLoadTab('mine');
    setSearch('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle className="font-heading">
            {view === 'choice' && t('workout.templates.title')}
            {view === 'create' && t('workout.templates.create')}
            {view === 'load' && t('workout.templates.load')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {/* ── Choice screen ── */}
          {view === 'choice' && (
            <div className="grid grid-cols-2 gap-4 py-4">
              <button
                onClick={() => setView('load')}
                className="flex flex-col items-center gap-3 p-6 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 active:bg-primary/5 transition-all text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <FolderOpen className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="font-heading font-bold text-sm">{t('workout.templates.loadBtn')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('workout.templates.loadDesc')}</p>
                </div>
              </button>
              <button
                onClick={() => setView('create')}
                className="flex flex-col items-center gap-3 p-6 rounded-xl border border-border hover:border-accent/50 hover:bg-accent/5 active:bg-accent/5 transition-all text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                  <PenLine className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <p className="font-heading font-bold text-sm">{t('workout.templates.createBtn')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('workout.templates.createDesc')}</p>
                </div>
              </button>
            </div>
          )}

          {/* ── Create screen ── */}
          {view === 'create' && (
            <div className="py-2">
              <NewTemplateForm
                onSave={(data) => createMutation.mutate(data)}
                onCancel={() => setView('choice')}
              />
            </div>
          )}

          {/* ── Load screen ── */}
          {view === 'load' && (
            <div className="py-2 space-y-4">
              {/* Tab bar */}
              <div className="flex gap-1 p-1 bg-muted/40 rounded-xl">
                <button
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    loadTab === 'mine' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground active:text-foreground'
                  }`}
                  onClick={() => setLoadTab('mine')}
                >
                  <FolderOpen className="w-3.5 h-3.5" /> {tFallback("templatesModal.myTemplates", "My Templates")}
                </button>
                <button
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    loadTab === 'community' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground active:text-foreground'
                  }`}
                  onClick={() => setLoadTab('community')}
                >
                  <Users className="w-3.5 h-3.5" /> {tFallback("templatesModal.community", "Community")}
                </button>
              </div>

              {/* ── My Templates tab ── */}
              {loadTab === 'mine' && (
                <div className="space-y-3">
                  {myLoading ? (
                    [1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)
                  ) : myTemplates.length === 0 ? (
                    <div className="text-center py-8">
                      <FolderOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
                      <p className="font-heading font-semibold text-sm">{t('workout.templates.noTemplates')}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t('workout.templates.noTemplatesDesc')}</p>
                      <Button variant="outline" size="sm" className="mt-4" onClick={() => setView('create')}>
                        {t('workout.templates.createFirst')}
                      </Button>
                    </div>
                  ) : (
                    myTemplates.map(template => (
                      <MyTemplateCard
                        key={template.id}
                        template={template}
                        user={user}
                        onUse={() => { onLoadTemplate(template); handleClose(); }}
                        onDelete={() => deleteMutation.mutate(template.id)}
                        onTogglePublic={() =>
                          togglePublicMutation.mutate({ id: template.id, is_public: !template.is_public })
                        }
                      />
                    ))
                  )}
                </div>
              )}

              {/* ── Community tab ── */}
              {loadTab === 'community' && (
                <div className="space-y-3">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      className="ps-9"
                      placeholder={tFallback("templatesModal.searchTemplatesOrExercises", "Search templates or exercises…")}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>

                  {communityLoading ? (
                    [1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)
                  ) : filteredCommunity.length === 0 ? (
                    <div className="text-center py-8">
                      <Globe className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
                      <p className="font-heading font-semibold text-sm">{t('regimens.noPublicTemplates')}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {tFallback("templatesModal.createATemplateAndMake", "Create a template and make it public to share with the community!")}
                      </p>
                    </div>
                  ) : (
                    filteredCommunity.map(template => (
                      <CommunityTemplateCard
                        key={template.id}
                        template={template}
                        user={user}
                        queryClient={queryClient}
                        onCopied={() => setLoadTab('mine')}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

