// src/components/hub/ActivityFeed.jsx
//
// Social activity timeline — "@johndoe liked your post", "@janedoe followed you".
// Reads from the notifications table (social-category rows only).
// Separate from the notification bell (which shows ALL categories) — this
// surfaces a focused view of who is interacting with your content.

import { useQuery } from '@tanstack/react-query';
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

function ActivityRow({ item, index }) {
  const cfg = getConfig(item.type);
  if (!cfg) return null;
  const { Icon, color, bg } = cfg;

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
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">
          <span className="font-semibold">{item.title || 'Someone'}</span>{' '}
          <span className="text-muted-foreground">{item.body || ''}</span>
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(item.created_at)}</p>
      </div>
    </motion.div>
  );
}

// Includes both legacy "hub_*" names and actual DB names (post_like, post_reaction, etc.)
const SOCIAL_TYPES = ['post_like', 'post_reaction', 'post_comment', 'friend_follow', 'friend_post', 'hub_like', 'hub_comment', 'hub_repost', 'follow'];

export default function ActivityFeed() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['activityFeed', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      // Fetch recent social notifications for this user.
      // Only select columns that exist in the notifications table.
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, created_at')
        .eq('user_id', user.id)
        .or(SOCIAL_TYPES.map(t => `type.ilike.%${t}%`).join(','))
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) {
        // Fallback: return all recent notifications for this user
        // (the ilike OR chain failed — likely PostgREST version mismatch)
        const { data: all } = await supabase
          .from('notifications')
          .select('id, type, title, body, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);
        // Filter social types client-side
        return (all || []).filter(n =>
          SOCIAL_TYPES.some(t => (n.type || '').toLowerCase().includes(t))
        );
      }
      return data || [];
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

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
        <ActivityRow key={item.id} item={item} index={i} />
      ))}
    </div>
  );
}
