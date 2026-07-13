// src/lib/data/useAuthors.js
//
// Resolves Hub post/comment authors against the live user list so
// avatar/username changes reflect on previously-created content.
//
// The live record is preferred over the snapshot stored on the post.
// Snapshot is used as a fallback only — for deleted accounts, RLS-stripped
// fields, or when the list query hasn't loaded yet.
//
// Keyed by user_id (not email) so it keeps working once email is removed
// from the public_profiles view. Posts/comments carry user_id, so callers
// pass the author's id.

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as users from '@/lib/data/users';

export function useAuthorsById() {
  const qc = useQueryClient();
  const { data: list = [] } = useQuery({
    queryKey: ['hubAuthorsList'],
    queryFn: () => users.list().catch(() => []),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Live-refresh the author cache when ANY user equips a cosmetic OR
  // changes a theme. Without this, an equipped Title/Frame change took up
  // to 60 s (or a window blur/focus) to propagate to other users viewing
  // the same feed — which made the showcase feature feel half-broken.
  // refetchQueries (not just invalidate) so already-rendered feed cards
  // pick up the new flair without needing a remount.
  useEffect(() => {
    const handler = () => {
      qc.refetchQueries({ queryKey: ['hubAuthorsList'] }).catch(() => {});
    };
    window.addEventListener('flexyn:loot-equipped', handler);
    window.addEventListener('flexyn:theme-changed', handler);
    return () => {
      window.removeEventListener('flexyn:loot-equipped', handler);
      window.removeEventListener('flexyn:theme-changed', handler);
    };
  }, [qc]);

  const byId = {};
  for (const u of list) {
    if (u?.id) byId[u.id] = u;
  }
  return byId;
}

/**
 * Resolve display fields for a single author.
 * @param {object} byId - the map from useAuthorsById()
 * @param {string} authorId - the post/comment's user_id
 * @param {{ author_name?: string, author_avatar_url?: string }} snapshot
 * @returns {{ handle, avatarUrl, initials, username, equippedTitleId, equippedFrameId }}
 */
export function resolveAuthor(byId, authorId, snapshot = {}) {
  const live = authorId ? byId[authorId] : null;
  const liveUsername = live?.username || null;
  const snapUsername = (snapshot.author_name || '').replace(/^@/, '').trim() || null;
  const username = liveUsername || snapUsername || 'athlete';
  const handle = `@${username}`;
  const avatarUrl = live?.avatar_url || snapshot.author_avatar_url || null;
  const initials = (username || '?').slice(0, 2).toUpperCase();
  // Equipped loot — only available from the live record (not snapshotted).
  // Falls through to null when the user list hasn't loaded yet.
  const equippedTitleId = live?.equipped_title_id || null;
  const equippedFrameId = live?.equipped_frame_id || null;
  const signatureTrophy = live?.signature_trophy || null;
  return { handle, avatarUrl, initials, username, equippedTitleId, equippedFrameId, signatureTrophy };
}