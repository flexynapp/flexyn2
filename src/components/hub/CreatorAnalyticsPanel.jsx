// src/components/hub/CreatorAnalyticsPanel.jsx
//
// Compact analytics overlay for the post author.
// Shows: unique views, likes, comments, engagement rate.
// Rendered inline below the action bar — toggled by the BarChart2 button.

import { useQuery } from '@tanstack/react-query';
import { Eye, ThumbsUp, MessageCircle, TrendingUp, Loader2 } from 'lucide-react';
import { getAnalytics } from '@/lib/data/hubPostViews';

function StatTile({ icon: Icon, label, value, color = 'text-foreground' }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl bg-secondary/40 flex-1 min-w-0">
      <Icon className={`w-3.5 h-3.5 ${color} mb-0.5`} />
      <span className={`font-heading font-bold text-sm leading-none ${color}`}>{value}</span>
      <span className="text-micro text-muted-foreground uppercase tracking-wide mt-0.5 truncate w-full text-center">{label}</span>
    </div>
  );
}

export default function CreatorAnalyticsPanel({ postId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['postAnalytics', postId],
    queryFn: () => getAnalytics(postId),
    enabled: !!postId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { viewCount = 0, likeCount = 0, commentCount = 0, engagementRate = 0 } = data || {};

  return (
    <div className="mx-3 mb-3 p-3 rounded-xl border border-border bg-secondary/20">
      <p className="text-micro font-bold uppercase tracking-widest text-muted-foreground mb-2">
        📊 Post analytics
      </p>
      <div className="flex gap-2">
        <StatTile icon={Eye}          label="Views"    value={viewCount.toLocaleString()} />
        <StatTile icon={ThumbsUp}     label="Likes"    value={likeCount.toLocaleString()} color="text-primary" />
        <StatTile icon={MessageCircle} label="Comments" value={commentCount.toLocaleString()} color="text-info" />
        <StatTile icon={TrendingUp}   label="Eng. rate"
                  value={`${engagementRate}%`}
                  color={engagementRate > 5 ? 'text-success' : 'text-muted-foreground'} />
      </div>
    </div>
  );
}
