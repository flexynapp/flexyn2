// src/components/hub/ActivityFeed.jsx
//
// Social activity timeline — "@johndoe liked your post", "@janedoe followed you".
// Reads from the notifications table (social-category rows only).
// Separate from the notification bell (which shows ALL categories) — this
// surfaces a focused view of who is interacting with your content.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Heart, MessageCircle, UserPlus, Repeat2, ThumbsUp, Activity } from 'lucide-react';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';

// Maps notification type → icon + color.
// Checked against live DB: types are post_like, post_reaction, friend_follow, friend_post.
const TYPE_CONFIG = [
  { match: 'post_like',     Icon: ThumbsUp,      color: 'text-primary',     bg: 'bg-primary/10' },
  { match: 'hub_like',      Icon: ThumbsUp,      color: 'text-primary',     bg: 'bg-primary/10' },
  { match: 'post_reaction', Icon: Heart,         color: 'text-rose-500',    bg: 'bg-rose-500/10' },
  { match: 'hub_reaction',  Icon: Heart,         color: 'text-rose-500',    bg: 'bg-rose-500/10' },
  { match: 'post_comment',  Icon: MessageCircle, color: 'text-blue-500',    bg: 'bg-blue-500/10' },
  { match: 'hub_comment',   Icon: MessageCircle, color: 'text-blue-500',    bg: 'bg-blue-500/10' },
  { match: 'follow',        Icon: UserPlus,      color: 'text-green-500',   bg: 'bg-green-500/10' },
  { match: 'hub_repost',    Icon: Repeat2,       color: 'text-primary',     bg: 'bg-primary/10' },
  { match: 'friend_post',   Icon: Heart,         color: 'text-rose-500',    bg: 'bg-rose-500/10' },
];

function getConfig(type) {
  if (!type) return null;
  const lc = type.toLowerCase();
  const found = TYPE_CONFIG.find(c => lc.includes(c.match));
  if (found) return found;
  return { Icon: Activity, color: 'text-muted-foreground', bg: 'bg-secondary' };
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  try {
    return formatDistanceToNowStrict(parseISO(dateStr), { addSuffix: true });
  } catch {
    return '';
  }
}

function ActivityRow({ item, index, onTap }) {
  const cfg = getConfig(item.type);
  if (!cfg) return null;
  const { Icon, color, bg } = cfg;
  const hasTarget = !!item.link_url;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-start gap-3 py-2.5"
    >
      <div className={`w-8 h-8 rounded-full ${bg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <button
        type="button"
        onClick={() => onTap?.(item)}
        disabled={!hasTarget}
        className={`flex-1 min-w-0 text-start rounded-md ${hasTarget ? 'cursor-pointer hover:bg-secondary/40 -mx-1 px-1 py-0.5 transition-colors' : 'cursor-default'}`}
      >
        <p className="text-sm leading-snug">
          <span className="font-semibold">{item.title || 'Someone'}</span>{' '}
          <span className="text-muted-foreground">{item.body || ''}</span>
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(item.created_at)}</p>
      </button>
    </motion.div>
  );
}

// Includes both legacy "hub_*" names and actual DB names (post_like, post_reaction, etc.)
const SOCIAL_TYPES = ['post_like', 'post_reaction', 'post_comment', 'friend_follow', 'friend_post', 'hub_like', 'hub_comment', 'hub_repost', 'follow'];

export default function ActivityFeed() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['activityFeed', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      // Fetch recent social notifications. link_url drives the row's
      // tap target; previously this select omitted link_url so rows
      // were inert (audit 10 #20).
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, link_url, is_read, created_at')
        .eq('user_id', user.id)
        .or(SOCIAL_TYPES.map(t => `type.ilike.%${t}%`).join(','))
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) {
        const { data: all } = await supabase
          .from('notifications')
          .select('id, type, title, body, link_url, is_read, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);
        return (all || []).filter(n =>
          SOCIAL_TYPES.some(t => (n.type || '').toLowerCase().includes(t))
        );
      }
      return data || [];
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  // Mark every shown social notification as read on mount. Previously
  // the bell badge stayed at the same count after opening this tab —
  // users tapped Activity expecting it to clear the bell and it
  // didn't. Now we eager-mark the rows we just rendered. (Audit 10 #21.)
  useEffect(() => {
    if (!user?.id || !activities.length) return;
    const unreadIds = activities.filter(a => a.is_read === false).map(a => a.id);
    if (unreadIds.length === 0) return;
    (async () => {
      try {
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .in('id', unreadIds);
        queryClient.invalidateQueries({ queryKey: ['unreadNotificationCount', user?.email] });
        queryClient.invalidateQueries({ queryKey: ['unreadNotificationCount', user?.id] });
      } catch { /* non-fatal — the bell will refetch eventually */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, activities.length]);

  const onTapActivity = (item) => {
    if (!item?.link_url) return;
    if (/^https?:\/\//i.test(item.link_url)) {
      // External link — open in new tab so the user can come back.
      window.open(item.link_url, '_blank', 'noopener,noreferrer');
    } else {
      navigate(item.link_url);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex items-start gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-muted rounded w-3/4" />
              <div className="h-2.5 bg-muted rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <Activity className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-semibold text-muted-foreground">
          {tFallback('hub.activity.empty', 'No activity yet')}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          {tFallback('hub.activity.emptyHint', 'Likes, follows, and comments will appear here')}
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/50 px-4">
      {activities.map((item, i) => (
        <ActivityRow key={item.id} item={item} index={i} onTap={onTapActivity} />
      ))}
    </div>
  );
}
