// src/lib/data/useAuthors.js
//
// Resolves Hub post/comment authors against the live user list so
// avatar/username changes reflect on previously-created content.
//
// The live record is preferred over the snapshot stored on the post.
// Snapshot is used as a fallback only — for deleted accounts, RLS-stripped
// fields, or when the list query hasn't loaded yet.

import { useQuery } from '@tanstack/react-query';
import * as users from '@/lib/data/users';

export function useAuthorsByEmail() {
  const { data: list = [] } = useQuery({
    queryKey: ['hubAuthorsList'],
    queryFn: () => users.list().catch(() => []),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const byEmail = {};
  for (const u of list) {
    if (u?.email) byEmail[u.email.toLowerCase()] = u;
  }
  return byEmail;
}

/**
 * Resolve display fields for a single author.
 * @param {object} byEmail - the map from useAuthorsByEmail()
 * @param {string} authorEmail - the post/comment's author_email
 * @param {{ author_name?: string, author_avatar_url?: string }} snapshot
 * @returns {{ handle, avatarUrl, initials, username, equippedTitleId, equippedFrameId }}
 */
export function resolveAuthor(byEmail, authorEmail, snapshot = {}) {
  const live = authorEmail ? byEmail[authorEmail.toLowerCase()] : null;
  const liveUsername = live?.username || null;
  const snapUsername = (snapshot.author_name || '').replace(/^@/, '').trim() || null;
  const emailPrefix = authorEmail ? authorEmail.split('@')[0] : null;
  const username = liveUsername || snapUsername || emailPrefix || 'athlete';
  const handle = `@${username}`;
  const avatarUrl = live?.avatar_url || snapshot.author_avatar_url || null;
  const initials = (username || '?').slice(0, 2).toUpperCase();
  // Equipped loot — only available from the live record (not snapshotted).
  // Falls through to null when the user list hasn't loaded yet.
  const equippedTitleId = live?.equipped_title_id || null;
  const equippedFrameId = live?.equipped_frame_id || null;
  return { handle, avatarUrl, initials, username, equippedTitleId, equippedFrameId };
}