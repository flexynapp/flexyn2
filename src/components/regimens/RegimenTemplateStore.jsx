// src/components/regimens/RegimenTemplateStore.jsx
// Browse, preview, and copy public regimen templates from the community.
// Users can also share their own regimens to the Hub from here.

import React, { useState, useMemo } from 'react';
import { handle } from '@/lib/userDisplay';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/lib/toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search, Copy, Globe, Lock, Send, Dumbbell, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as regimens from '@/lib/data/regimens';
import * as hubPosts from '@/lib/data/hubPosts';

// ── Small helpers ────────────────────────────────────────────────────────────

function CopyCount({ n }) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Copy className="w-3 h-3" />
      {n || 0}
    </span>
  );
}

function ExerciseBadges({ exercises = [], max = 5 }) {
  const visible = exercises.slice(0, max);
  const extra = exercises.length - max;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {visible.map((ex, i) => (
        <Badge key={i} variant="secondary" className="text-xs font-normal">
          {ex.name || ex.exercise_name || '?'}
        </Badge>
      ))}
      {extra > 0 && (
        <Badge variant="outline" className="text-xs font-normal">+{extra}</Badge>
      )}
    </div>
  );
}

// ── Share-to-Hub mini dialog ─────────────────────────────────────────────────

function ShareToHubDialog({ regimen, user, onClose }) {
  const { t } = useLanguage();
  const [caption, setCaption] = useState('');
  const [privacy, setPrivacy] = useState('public');
  const [posting, setPosting] = useState(false);

  const handlePost = async () => {
    if (!user?.email) return;
    setPosting(true);
    try {
      const exerciseCount = regimen.exercises?.length || 0;
      const body = caption.trim() ||
        `${t('regimens.shareDefaultCaption')} ${regimen.name} · ${exerciseCount} ${t('regimens.exercises')}`;

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
        linked_entity_type: 'regimen',
        linked_entity_id: regimen.id,
        linked_entity_snapshot: {
          name: regimen.name,
          description: regimen.description || '',
          exercises: (regimen.exercises || []).slice(0, 10).map(ex => ({
            exercise_name: ex.name || ex.exercise_name,
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
    <div className="space-y-4 pt-2">
      <div className="p-3 rounded-xl bg-muted/50 border">
        <p className="font-semibold text-sm">{regimen.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {regimen.exercises?.length || 0} {t('regimens.exercises')}
        </p>
      </div>
      <Textarea
        placeholder={t('regimens.shareToHubCaption')}
        value={caption}
        onChange={e => setCaption(e.target.value)}
        rows={3}
        className="resize-none"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={privacy === 'public' ? 'default' : 'outline'}
          onClick={() => setPrivacy('public')}
          className="gap-1"
        >
          <Globe className="w-3 h-3" /> {t('hub.privacy.public')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={privacy === 'followers-only' ? 'default' : 'outline'}
          onClick={() => setPrivacy('followers-only')}
          className="gap-1"
        >
          <Lock className="w-3 h-3" /> {t('hub.privacy.followersOnly')}
        </Button>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
        <Button size="sm" onClick={handlePost} disabled={posting} className="gap-1">
          <Send className="w-3 h-3" />
          {posting ? t('common.posting') : t('hub.post')}
        </Button>
      </div>
    </div>
  );
}

// ── Template card ────────────────────────────────────────────────────────────

function TemplateCard({ template, isMine, user, onCopied }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);

  const authorHandle = handle(template);

  const copyMutation = useMutation({
    mutationFn: () => regimens.copyTemplate(template, user),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regimens', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['publicTemplates'] });
      toast.success(t('regimens.toast.copied'));
      onCopied?.();
    },
    onError: () => toast.error(t('common.error')),
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border bg-card shadow-sm overflow-hidden"
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-heading font-bold text-base leading-tight truncate">
                {template.name}
              </h3>
              {isMine && (
                <Badge variant="outline" className="text-xs shrink-0">
                  {t('regimens.yourTemplate')}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{authorHandle}</p>
            {template.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{template.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <CopyCount n={template.copy_count} />
              <span className="text-xs text-muted-foreground">
                {template.exercises?.length || 0} {t('regimens.exercises')}
              </span>
            </div>
            <ExerciseBadges exercises={template.exercises || []} />
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1 shrink-0">
            {!isMine && (
              <Button
                size="sm"
                className="gap-1 text-xs"
                onClick={() => copyMutation.mutate()}
                disabled={copyMutation.isPending}
              >
                <Copy className="w-3 h-3" />
                {copyMutation.isPending ? '…' : t('regimens.copyTemplate')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs"
              onClick={() => setSharingOpen(s => !s)}
            >
              <Send className="w-3 h-3" />
              {t('regimens.shareToHub')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-xs"
              onClick={() => setExpanded(e => !e)}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? t('common.less') : t('common.more')}
            </Button>
          </div>
        </div>

        {/* Expanded exercise list */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mt-3 space-y-1"
            >
              {(template.exercises || []).map((ex, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                  <span>{ex.name || ex.exercise_name}</span>
                  <span className="text-muted-foreground text-xs">
                    {ex.target_sets} × {ex.target_reps}
                  </span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Share-to-Hub inline panel */}
        <AnimatePresence>
          {sharingOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mt-3 border-t pt-3"
            >
              <ShareToHubDialog
                regimen={template}
                user={user}
                onClose={() => setSharingOpen(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Main modal ───────────────────────────────────────────────────────────────

export default function RegimenTemplateStore({ open, onClose }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('All');

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['publicTemplates'],
    queryFn: regimens.listPublic,
    enabled: open,
    staleTime: 30_000,
  });

  const muscleGroups = useMemo(() => {
    const seen = new Set();
    templates.forEach(t => {
      (t.exercises || []).forEach(ex => {
        (ex.muscle_groups || (ex.muscle_group ? [ex.muscle_group] : [])).forEach(m => seen.add(m));
      });
    });
    return ['All', ...Array.from(seen).sort()];
  }, [templates]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return templates.filter(tmpl => {
      const matchesSearch = !q ||
        tmpl.name?.toLowerCase().includes(q) ||
        tmpl.description?.toLowerCase().includes(q) ||
        (tmpl.exercises || []).some(ex => (ex.name || ex.exercise_name || '').toLowerCase().includes(q));
      const matchesMuscle = muscleFilter === 'All' || (tmpl.exercises || []).some(ex =>
        (ex.muscle_groups || (ex.muscle_group ? [ex.muscle_group] : [])).includes(muscleFilter)
      );
      return matchesSearch && matchesMuscle;
    });
  }, [templates, search, muscleFilter]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="font-heading text-xl flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              {t('regimens.templateStore')}
            </DialogTitle>
          </div>
          <p className="text-sm text-muted-foreground">{t('regimens.templateStoreDesc')}</p>
        </DialogHeader>

        {/* Search + filter bar */}
        <div className="px-5 pb-3 space-y-2 shrink-0">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="ps-9"
              placeholder={t('regimens.searchTemplates')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {muscleGroups.map(m => (
              <Button
                key={m}
                size="sm"
                variant={muscleFilter === m ? 'default' : 'outline'}
                className="text-xs shrink-0"
                onClick={() => setMuscleFilter(m)}
              >
                {m}
              </Button>
            ))}
          </div>
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Dumbbell className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-semibold">{t('regimens.noPublicTemplates')}</p>
              <p className="text-sm text-muted-foreground mt-1">{t('regimens.noPublicTemplatesDesc')}</p>
            </div>
          ) : (
            filtered.map(tmpl => (
              <TemplateCard
                key={tmpl.id}
                template={tmpl}
                isMine={!!user?.id && tmpl.user_id === user.id}
                user={user}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

