// src/components/hub/FriendLikesFeed.jsx
//
// Hub → Activity → Friends: posts your friends liked. Every privacy rule is
// server side (get_friends_liked_posts); this only draws what came back.
//
// The setting is reciprocal, so a viewer who has sharing off gets an
// explanation and a one-tap way to turn it on, not an empty list that looks
// like nobody has liked anything.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ThumbsUp, Heart } from 'lucide-react';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { formatNotificationTime } from '@/lib/notificationTime';
import { listFriendsLikedPosts, setShareLikesWithFriends } from '@/lib/data/friendLikes';
import { reportError } from '@/lib/reportError';

// Splits a translated template on its {placeholders} so names can be bold
// without concatenating sentence fragments (word order differs per locale).
function renderTemplate(template, nodes) {
  return String(template).split(/(\{\w+\})/g).map((part, i) => {
    const m = part.match(/^\{(\w+)\}$/);
    if (m && m[1] in nodes) return <span key={i}>{nodes[m[1]]}</span>;
    return part;
  });
}

function Avatar({ person }) {
  const [failed, setFailed] = useState(false);
  const initial = (person?.username || '?').charAt(0).toUpperCase();
  return (
    <div className="relative w-10 h-10 shrink-0">
      {person?.avatar_url && !failed ? (
        <img
          src={person.avatar_url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-10 h-10 rounded-full object-cover bg-secondary"
        />
      ) : (
        <div
          aria-hidden="true"
          className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center font-heading font-bold text-body text-foreground"
        >
          {initial}
        </div>
      )}
      <span
        aria-hidden="true"
        className="absolute -bottom-1 -end-1 w-5 h-5 rounded-full bg-card ring-2 ring-card flex items-center justify-center"
      >
        <ThumbsUp className="w-3 h-3 text-primary" strokeWidth={2.5} />
      </span>
    </div>
  );
}

function FriendLikeRow({ entry, language, onOpen }) {
  const { tFallback } = useLanguage();
  const [first, second] = entry.likers;
  const others = entry.likers.length - 1;
  const bold = (u) => <span className="font-semibold text-foreground">{u?.username || tFallback('hub.friendLikes.someone', 'someone')}</span>;

  let template;
  if (others === 0) {
    template = tFallback('hub.friendLikes.one', "{name} liked {author}'s post");
  } else if (others === 1) {
    template = tFallback('hub.friendLikes.two', "{name} and {other} liked {author}'s post");
  } else {
    template = tFallback('hub.friendLikes.many', "{name} and {n} others liked {author}'s post");
  }
  const line = renderTemplate(template, {
    name: bold(first),
    other: bold(second),
    n: others,
    author: bold(entry.author),
  });

  const preview = (entry.post.content || entry.post.body || '').trim();
  const thumb = entry.post.image_url;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry.post)}
        className="w-full flex items-start gap-2 py-4 text-start transition-colors hover:bg-secondary/40 active:bg-secondary/40 rounded-lg"
      >
        <Avatar person={first} />
        <div className="flex-1 min-w-0 ms-2">
          <p className="text-body leading-tight text-muted-foreground">{line}</p>
          {preview && (
            <p className="text-label text-foreground/80 leading-snug mt-1 line-clamp-2">{preview}</p>
          )}
          <time dateTime={entry.lastLikedAt || undefined} className="block text-micro text-muted-foreground tabular-nums mt-1">
            {formatNotificationTime(entry.lastLikedAt, language)}
          </time>
        </div>
        {thumb && (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="w-12 h-12 rounded-sm object-cover bg-secondary shrink-0"
          />
        )}
      </button>
    </li>
  );
}

export default function FriendLikesFeed({ onOpenPost }) {
  const { user } = useAuth();
  const { tFallback, language } = useLanguage();
  const queryClient = useQueryClient();
  const [enabling, setEnabling] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
    staleTime: 60_000,
  });
  // Only an explicit true is "on"; unknown behaves as the default (off).
  const sharing = profile?.share_likes_with_friends === true;

  const { data: entries = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['friendLikes', user?.id],
    queryFn: () => listFriendsLikedPosts(),
    enabled: !!user?.id && sharing,
    staleTime: 60_000,
  });

  const turnOn = async () => {
    if (!user?.id || enabling) return;
    setEnabling(true);
    try {
      await setShareLikesWithFriends(user.id, true);
      db.auth.patchCache({ share_likes_with_friends: true });
      await queryClient.invalidateQueries({ queryKey: ['userProfile', user.email] });
    } catch (err) {
      reportError(err, { feature: 'hub.friend-likes.enable' });
    } finally {
      setEnabling(false);
    }
  };

  if (!sharing) {
    return (
      <div className="flex flex-col items-center text-center py-16 px-4 gap-2">
        <Heart className="w-10 h-10 text-muted-foreground/30" aria-hidden="true" />
        <p className="text-sm font-semibold">
          {tFallback('hub.friendLikes.off.title', "You're not sharing your likes")}
        </p>
        <p className="text-xs text-muted-foreground max-w-xs">
          {tFallback('hub.friendLikes.off.body', "Turn sharing on to see what your friends like. They'll see what you like too.")}
        </p>
        <button
          type="button"
          onClick={turnOn}
          disabled={enabling}
          className="mt-6 min-h-11 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60"
        >
          {tFallback('hub.friendLikes.off.cta', 'Share my likes')}
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 py-2" aria-busy="true">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex items-start gap-2 py-2 animate-pulse">
            <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
            <div className="flex-1 flex flex-col gap-2">
              <div className="h-3 bg-muted rounded-sm w-3/4" />
              <div className="h-2.5 bg-muted rounded-sm w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center text-center py-16 px-4 gap-2">
        <p className="text-sm text-muted-foreground">
          {tFallback('hub.friendLikes.error', "Could not load your friends' likes.")}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="min-h-11 px-4 rounded-lg text-sm font-semibold text-primary"
        >
          {tFallback('common.retry', 'Retry')}
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-16 px-4 gap-2">
        <ThumbsUp className="w-10 h-10 text-muted-foreground/30" aria-hidden="true" />
        <p className="text-sm font-semibold">
          {tFallback('hub.friendLikes.empty.title', 'Nothing from friends yet')}
        </p>
        <p className="text-xs text-muted-foreground max-w-xs">
          {tFallback('hub.friendLikes.empty.body', 'When friends like a post, it shows up here. Friends are people you follow who follow you back.')}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {entries.map(entry => (
        <FriendLikeRow
          key={entry.post.id}
          entry={entry}
          language={language}
          onOpen={(post) => onOpenPost?.(post)}
        />
      ))}
    </ul>
  );
}
