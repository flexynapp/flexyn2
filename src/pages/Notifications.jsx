// src/pages/Notifications.jsx
//
// Dedicated notifications page with tab filtering. Surfaces FULL
// notification history beyond what the bell-icon dropdown shows.
// Route: /notifications (lazy-loaded from App.jsx).
//
// Tabs:
//   All           — every notification
//   Social        — friend follow / post likes / comments / sticker reactions
//   Competitive   — duels / bounties / crew wars / nemesis
//   Achievements  — PRs / capsules / coin milestones / streak / quests
//   System        — engagement nudges + everything else

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Bell, ChevronLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import PageHeader from '@/components/PageHeader';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as notifications from '@/lib/data/notifications';

const TABS = [
  { id: 'all',          label: 'All' },
  { id: 'social',       label: 'Social' },
  { id: 'competitive',  label: 'Competitive' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'system',       label: 'System' },
];

const TYPE_TO_TAB = {
  // social
  friend_post:        'social',
  friend_follow:      'social',
  comment_reply:      'social',
  post_reaction:      'social',
  post_like:          'social',
  sticker_reaction:   'social',
  trade_offer:        'social',
  crew_everyone:      'social',
  // competitive
  duel_invite:        'competitive',
  duel_result:        'competitive',
  bounty_claim:       'competitive',
  bounty_beaten:      'competitive',
  crew_war_started:   'competitive',
  crew_war_resolved:  'competitive',
  nemesis_assigned:   'competitive',
  // achievements — includes quest claims and gauntlet completions so
  // they don't collapse into "system" silently. (Audit 16 F23.)
  pr_set:                 'achievements',
  capsule_earned:         'achievements',
  coin_milestone:         'achievements',
  streak_milestone:       'achievements',
  league_promoted:        'achievements',
  league_promotion:       'achievements',
  league_demoted:         'achievements',
  league_demotion:        'achievements',
  league_held:            'achievements',
  referral_success:       'achievements',
  quest_claimed:          'achievements',
  gauntlet_path_completed:'achievements',
  // competitive (additions per audit 16 F23)
  nemesis_overthrown:     'competitive',
  crew_challenge_started: 'competitive',
  crew_challenge_completed:'competitive',
  // system (engagement) + admin
  welcome_back:           'system',
  streak_break_warning:   'system',
  quest_expiry_warning:   'system',
  weekly_gauntlet_started:'system',
  memory_reengagement:    'system',
  report_resolved:        'system',
};

export default function Notifications() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');

  const { data: rows = [], refetch, isLoading } = useQuery({
    queryKey: ['notificationsListFull', user?.id],
    queryFn: () => notifications.listForUser(user, 200),
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  // Mark all read on mount (page-level mark-all, mirrors the bell-
  // dropdown behavior — opening this surface is consent to clear the
  // unread badge).
  useEffect(() => {
    if (!user?.id || rows.length === 0) return;
    const hasUnread = rows.some(r => !r.is_read);
    if (!hasUnread) return;
    notifications.markAllRead(user)
      .then(() => queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user.id] }))
      .catch(() => { /* non-critical */ });
  }, [user?.id, rows, queryClient]);

  const filtered = (() => {
    if (tab === 'all') return rows;
    return rows.filter(r => (TYPE_TO_TAB[r.type] || 'system') === tab);
  })();

  const handleRowClick = (n) => {
    if (!n.is_read) {
      notifications.markRead(n.id)
        .then(() => {
          // Refresh the bell-badge query so the count drops as soon as
          // the user taps a notification, not on next mount. Same fix
          // applied to ActivityFeed.
          queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] });
          queryClient.invalidateQueries({ queryKey: ['notificationsListFull', user?.id] });
        })
        .catch(() => {});
    }
    if (!n.link_url) return;
    // Distinguish absolute URLs (open in new tab) from in-app routes.
    // navigate('https://...') would treat the URL as a path and produce
    // a /https:// route.
    if (/^https?:\/\//i.test(n.link_url)) {
      window.open(n.link_url, '_blank', 'noopener,noreferrer');
    } else {
      navigate(n.link_url);
    }
  };

  const handleClearAll = async () => {
    if (rows.length === 0) return;
    const prev = rows;
    queryClient.setQueryData(['notificationsListFull', user?.id], []);
    const res = await notifications.deleteAllForUser(user);
    if (!res?.ok) {
      queryClient.setQueryData(['notificationsListFull', user?.id], prev);
      toast.error(tFallback('notifications.clearAllFailed', 'Could not clear — try again.'));
    } else {
      queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] });
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6">
      <PageHeader
        icon={Bell}
        title={tFallback('notifications.title', 'Notifications')}
        subtitle={tFallback('notifications.fullSubtitle', 'All your activity, sorted.')}
      />

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto mb-4 px-1 -mx-1 no-scrollbar">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={[
              'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
              tab === t.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground hover:bg-secondary/70',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
        {rows.length > 0 && (
          <button
            onClick={handleClearAll}
            className="ml-auto shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-secondary text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors inline-flex items-center gap-1.5"
            aria-label={tFallback('notifications.clearAll', 'Clear all')}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {tFallback('notifications.clearAll', 'Clear all')}
          </button>
        )}
      </div>

      {isLoading && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {tFallback('notifications.loading', 'Loading…')}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-12">
          <Bell className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-heading font-semibold">{tFallback('notifications.empty', 'Nothing here yet')}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {tFallback('notifications.emptyDesc', 'Activity from your crew, your nemesis, and the app will appear here.')}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((n, idx) => (
          <motion.button
            key={n.id}
            type="button"
            onClick={() => handleRowClick(n)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(idx, 8) * 0.025 }}
            className={[
              'w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors',
              n.is_read
                ? 'border-border bg-card hover:bg-secondary/40'
                : 'border-primary/30 bg-primary/5 hover:bg-primary/8',
            ].join(' ')}
          >
            <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-base shrink-0">
              <span aria-hidden="true">{n.icon || '🔔'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm leading-tight ${n.is_read ? '' : 'font-semibold'}`}>{n.title}</p>
              {n.body && (
                <p className="text-xs text-muted-foreground leading-snug mt-0.5 truncate">{n.body}</p>
              )}
              <p className="text-[10px] text-muted-foreground/70 mt-1 tabular-nums">
                {n.created_at ? formatDistanceToNow(new Date(n.created_at), { addSuffix: true }) : ''}
              </p>
            </div>
            {!n.is_read && (
              <span className="shrink-0 w-2 h-2 mt-2 rounded-full bg-primary" aria-label="Unread" />
            )}
          </motion.button>
        ))}
      </div>

      <div className="mt-6 text-center">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          {tFallback('common.back', 'Back')}
        </button>
      </div>
    </div>
  );
}
