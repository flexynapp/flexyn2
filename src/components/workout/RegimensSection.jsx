import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Dumbbell, Eye, ChevronUp, LayoutTemplate, Globe, Lock, Send } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { motion, AnimatePresence } from 'framer-motion';
import RegimenForm from '@/components/regimens/RegimenForm';
import RegimenDetailView from '@/components/regimens/RegimenDetailView';
import TemplatesModal from '@/components/workout/TemplatesModal';
import RegimenTemplateStore from '@/components/regimens/RegimenTemplateStore';
import * as hubPosts from '@/lib/data/hubPosts';
import { reportError } from '@/lib/reportError';
import { fireFirstRegimenCelebration } from '@/lib/firstRegimenCelebration';

export default function RegimensSection({ onStartRegimen }) {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [sharingRegimen, setSharingRegimen] = useState(null); // regimen being shared to Hub
  const [shareCaption, setShareCaption] = useState('');
  const [sharePrivacy, setSharePrivacy] = useState('public');
  const [sharePosting, setSharePosting] = useState(false);

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: regimens = [], isLoading } = useQuery({
    queryKey: ['regimens', user?.email],
    queryFn: () => db.entities.Regimen.filter({ created_by: user.email }, '-created_date'),
    enabled: !!user?.email,
  });

  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const regimen = await db.entities.Regimen.create(data);
      // XP failure must NOT roll back the regimen — it was successfully created
      // server-side. Reverting the optimistic UI on XP failure causes the regimen
      // to "disappear" until the next refetch, which looks like a save bug.
      try {
        await db.functions.invoke('updateUserXpAndAchievements', {
          xp_gained: 100,
          action_type: 'regimen_created',
          action_data: {},
        });
      } catch (xpErr) {
        reportError(xpErr, { feature: 'regimens.xp-update', level: 'warning', userEmail: user?.email });
      }
      return regimen;
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['regimens', user?.email] });
      const previous = queryClient.getQueryData(['regimens', user?.email]);
      queryClient.setQueryData(['regimens', user?.email], (old = []) => [
        { id: '__optimistic__', ...data },
        ...old,
      ]);
      setShowForm(false);
      return { previous };
    },
    onError: (_err, _data, ctx) => {
      queryClient.setQueryData(['regimens', user?.email], ctx.previous);
      setShowForm(true);
    },
    onSuccess: (result, _data, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['achievements', user?.email] });

      // First-regimen milestone — detected via the ctx.previous
      // snapshot onMutate already captures. Filter out optimistic
      // placeholders so a previous attempt's in-flight optimistic
      // row can't suppress the celebration (same defense as the
      // first-workout detection in Workout.jsx).
      const realPrev = (ctx?.previous ?? []).filter(
        (row) => row?.id !== '__optimistic__'
      );
      const isFirstRegimen = realPrev.length === 0;
      if (isFirstRegimen) {
        fireFirstRegimenCelebration({
          regimenName: result?.name,
          xpGained: 100, // matches the XP grant above
          userEmail: user?.email,
        });
      } else {
        toast.success(t('regimens.toast.created'));
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['regimens', user?.email] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => db.entities.Regimen.update(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['regimens', user?.email] });
      const previous = queryClient.getQueryData(['regimens', user?.email]);
      queryClient.setQueryData(['regimens', user?.email], (old = []) =>
        old.map(r => r.id === id ? { ...r, ...data } : r)
      );
      setShowForm(false);
      setEditing(null);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(['regimens', user?.email], ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['regimens', user?.email] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => db.entities.Regimen.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['regimens', user?.email] });
      const previous = queryClient.getQueryData(['regimens', user?.email]);
      queryClient.setQueryData(['regimens', user?.email], (old = []) => old.filter(r => r.id !== id));
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      queryClient.setQueryData(['regimens', user?.email], ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['regimens', user?.email] }),
  });

  const handleSubmit = (data) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const openEdit = (regimen) => {
    setEditing(regimen);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const togglePublic = (r) => {
    const next = !r.is_public;
    updateMutation.mutate(
      { id: r.id, data: { is_public: next } },
      {
        onSuccess: () => toast.success(next ? t('regimens.toast.madePublic') : t('regimens.toast.madePrivate')),
      }
    );
  };

  const openShare = (r) => {
    setSharingRegimen(r);
    setShareCaption('');
    setSharePrivacy('public');
  };

  const handleShareToHub = async () => {
    if (!sharingRegimen || !user?.email) return;
    setSharePosting(true);
    try {
      const exerciseCount = sharingRegimen.exercises?.length || 0;
      const body = shareCaption.trim() ||
        `Check out my regimen — ${sharingRegimen.name} · ${exerciseCount} exercises`;
      await hubPosts.create({
        author_email: user.email,
        author_name: user.username || user.email.split('@')[0],
        author_avatar_url: user.avatar_url || null,
        post_type: 'regimen',
        body,
        privacy: sharePrivacy,
        like_count: 0,
        dislike_count: 0,
        comment_count: 0,
        linked_entity_type: 'regimen',
        linked_entity_id: sharingRegimen.id,
        linked_entity_snapshot: {
          name: sharingRegimen.name,
          description: sharingRegimen.description || '',
          exercises: (sharingRegimen.exercises || []).slice(0, 10).map(ex => ({
            exercise_name: ex.name || ex.exercise_name,
            target_sets: ex.target_sets,
            target_reps: ex.target_reps,
          })),
        },
      });
      toast.success(t('regimens.toast.shared'));
      setSharingRegimen(null);
    } catch (err) {
      console.error('Share failed:', err);
      toast.error(t('common.error'));
    } finally {
      setSharePosting(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex gap-2 flex-wrap">
        <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
          <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
            <LayoutTemplate className="w-4 h-4 mr-2" /> {t('workout.templates')}
          </Button>
        </motion.div>
        <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
          <Button variant="outline" onClick={() => setStoreOpen(true)}>
            <Globe className="w-4 h-4 mr-2" /> {t('regimens.browseTemplates')}
          </Button>
        </motion.div>
        <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> {t('regimens.create')}
          </Button>
        </motion.div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : regimens.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <Dumbbell className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="font-heading font-semibold">{t('regimens.empty')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('regimens.emptyDesc')}</p>
        </Card>
      ) : (
        <motion.div
          className="space-y-3"
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }}
        >
          {regimens.map((r, idx) => (
            <motion.div
              key={r.id}
              variants={{ hidden: { opacity: 0, y: 18, scale: 0.97 }, visible: { opacity: 1, y: 0, scale: 1 } }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              whileHover={{ y: -2, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
            >
            <Card className="p-4 border-none shadow-sm hover:shadow-md transition-shadow overflow-hidden">
              <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <h3 className="font-heading font-bold break-words leading-tight">{r.name}</h3>
                {r.original_author_username && (
                  <p className="text-xs text-muted-foreground mt-2 break-words">
                    {t('regimens.copiedFrom').replace('{author}', r.original_author_username.startsWith('@') ? r.original_author_username : `@${r.original_author_username}`)}
                  </p>
                )}
                {r.description && <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1 break-words">{r.description}</p>}
              </div>
                <div className="flex gap-1 ml-2">
                  <motion.div whileHover={{ scale: 1.07 }} whileTap={{ scale: 0.93 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}>
                    <Button size="sm" onClick={() => onStartRegimen(r)} className="text-xs">{t('regimens.start')}</Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.07 }} whileTap={{ scale: 0.93 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}>
                    <Button variant="ghost" size="icon" onClick={() => toggleExpand(r.id)} title="View exercises">
                      {expandedId === r.id ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.07 }} whileTap={{ scale: 0.93 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.07 }} whileTap={{ scale: 0.93 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={r.is_public ? t('regimens.makePrivate') : t('regimens.makePublic')}
                      onClick={() => togglePublic(r)}
                    >
                      {r.is_public
                        ? <Globe className="w-4 h-4 text-primary" />
                        : <Lock className="w-4 h-4 text-muted-foreground" />}
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.07 }} whileTap={{ scale: 0.93 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}>
                    <Button variant="ghost" size="icon" title={t('regimens.shareToHub')} onClick={() => openShare(r)}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </motion.div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <motion.div whileHover={{ scale: 1.07 }} whileTap={{ scale: 0.93 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}>
                        <Button variant="ghost" size="icon">
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </motion.div>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('regimens.deleteConfirm')}</AlertDialogTitle>
                        <AlertDialogDescription>"{r.name}" {t('regimens.deleteConfirmDesc')}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(r.id)}>{t('common.delete')}</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {r.exercises?.map((ex, i) => {
                  const label = ex.name || ex.exercise_name;
                  if (!label) return null; // skip ghost badges on malformed legacy records
                  return (
                    <Badge key={i} variant="secondary" className="text-xs font-normal">{label}</Badge>
                  );
                })}
                {(!r.exercises || r.exercises.length === 0) && (
                  <span className="text-xs text-muted-foreground">{t('regimens.noExercises')}</span>
                )}
              </div>
              <AnimatePresence>
                {expandedId === r.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, y: -8 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -8 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <RegimenDetailView regimen={r} />
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onLoadTemplate={(template) => onStartRegimen({
          id: `template-${template.id}`,
          name: template.name,
          exercises: template.exercises,
        })}
      />

      <RegimenTemplateStore open={storeOpen} onClose={() => setStoreOpen(false)} />

      {/* Share to Hub dialog */}
      <Dialog open={!!sharingRegimen} onOpenChange={() => setSharingRegimen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">{t('regimens.shareToHub')}</DialogTitle>
          </DialogHeader>
          {sharingRegimen && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-muted/50 border">
                <p className="font-semibold text-sm">{sharingRegimen.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sharingRegimen.exercises?.length || 0} {t('regimens.exercises')}
                </p>
              </div>
              <Textarea
                placeholder={t('regimens.shareToHubCaption')}
                value={shareCaption}
                onChange={e => setShareCaption(e.target.value)}
                rows={3}
                className="resize-none"
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button" size="sm"
                  variant={sharePrivacy === 'public' ? 'default' : 'outline'}
                  onClick={() => setSharePrivacy('public')} className="gap-1"
                >
                  <Globe className="w-3 h-3" /> {t('hub.privacy.public')}
                </Button>
                <Button
                  type="button" size="sm"
                  variant={sharePrivacy === 'followers-only' ? 'default' : 'outline'}
                  onClick={() => setSharePrivacy('followers-only')} className="gap-1"
                >
                  <Lock className="w-3 h-3" /> {t('hub.privacy.followersOnly')}
                </Button>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSharingRegimen(null)}>{t('common.cancel')}</Button>
                <Button size="sm" onClick={handleShareToHub} disabled={sharePosting} className="gap-1">
                  <Send className="w-3 h-3" />
                  {sharePosting ? t('common.posting') : t('hub.post')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showForm} onOpenChange={closeForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">
              {editing ? t('regimens.edit') : t('regimens.create')}
            </DialogTitle>
          </DialogHeader>
          <RegimenForm
            initial={editing}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            userProfile={userProfile}
            isSubmitting={createMutation.isPending || updateMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
