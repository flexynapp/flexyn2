// src/components/stories/StoriesRow.jsx
//
// Horizontal scroll strip of story avatars. Appears at the top of Dashboard
// and (in the feed tab) at the top of Hub.
//
// Layout (left → right):
//   1. Own avatar — always first
//      • No story  → avatar with orange "+" badge → tap opens file picker
//      • Has story → orange gradient ring → tap opens viewer
//   2. Friends WITH active stories → colored ring (unseen: orange; seen: gray)
//   3. Friends WITHOUT active stories → faded avatar, no ring
//      (friends list stays visible at all times so you know who hasn't posted)
//
// Upload flow:
//   tap own "+" → hidden <input type="file"> fires → preview sheet →
//   "Post Story" → upload to Supabase Storage → insert stories row → refetch

import React, { useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import * as hubFollows from '@/lib/data/hubFollows';
import * as storiesData from '@/lib/data/stories';
import StoryViewer from './StoryViewer';

// ── Avatar helpers ────────────────────────────────────────────────────────────

function AvatarImage({ avatarUrl, username, faded }) {
  const initials = (username || '?').slice(0, 2).toUpperCase();
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={username}
        className={`w-full h-full object-cover rounded-full transition-opacity ${faded ? 'opacity-40' : 'opacity-100'}`}
        draggable={false}
      />
    );
  }
  return (
    <div
      className={`w-full h-full rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-muted-foreground select-none transition-opacity ${faded ? 'opacity-40' : 'opacity-100'}`}
    >
      {initials}
    </div>
  );
}

// ── Single avatar button ──────────────────────────────────────────────────────

function StoryAvatarButton({ group, onPress, isUploading }) {
  const noStory     = group.stories.length === 0;
  const faded       = !group.isOwn && noStory;
  const hasUnseen   = group.hasUnseen && !noStory;
  const hasSeenOnly = !group.hasUnseen && !noStory;

  // Ring colours:
  //   Unseen story  → gradient from primary orange to amber
  //   Seen story    → gray ring
  //   No story      → no ring (avatar shown faded)
  const ringStyle = hasUnseen
    ? { background: 'linear-gradient(135deg, #FF6600 0%, #FFAA00 100%)' }
    : hasSeenOnly
    ? { background: 'rgba(150,150,150,0.45)' }
    : {};
  const hasRing = hasUnseen || hasSeenOnly;

  return (
    <motion.button
      whileTap={{ scale: 0.90 }}
      onClick={onPress}
      className="flex flex-col items-center gap-1 shrink-0 focus:outline-none"
      style={{ minWidth: 68 }}
      aria-label={group.isOwn ? 'Your story' : group.username}
    >
      {/* Avatar + ring wrapper */}
      <div className="relative">
        <div
          className="w-[60px] h-[60px] rounded-full flex items-center justify-center"
          style={hasRing ? { ...ringStyle, padding: '2.5px' } : {}}
        >
          {/* Inner circle with a small gap so the ring is visible */}
          <div className={`rounded-full overflow-hidden bg-background ${hasRing ? 'w-full h-full p-[2px]' : 'w-[60px] h-[60px]'}`}>
            <div className="w-full h-full rounded-full overflow-hidden">
              {isUploading ? (
                <div className="w-full h-full rounded-full bg-secondary flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                </div>
              ) : (
                <AvatarImage
                  avatarUrl={group.avatarUrl}
                  username={group.username}
                  faded={faded}
                />
              )}
            </div>
          </div>
        </div>

        {/* "+" badge — only for own avatar when no story exists */}
        {group.isOwn && noStory && !isUploading && (
          <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center ring-2 ring-background pointer-events-none">
            <Plus className="w-3 h-3 text-primary-foreground stroke-[3]" />
          </div>
        )}
      </div>

      {/* Label */}
      <span
        className={`text-[10px] font-medium w-[68px] text-center truncate leading-tight ${faded ? 'text-muted-foreground/45' : 'text-muted-foreground'}`}
      >
        {group.isOwn ? 'Your Story' : group.username}
      </span>
    </motion.button>
  );
}

// ── Upload preview / confirm sheet ────────────────────────────────────────────

function StoryPreviewSheet({ dataUrl, uploading, onConfirm, onCancel }) {
  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-[9999] bg-black flex flex-col"
    >
      {/* Preview image */}
      <div className="flex-1 relative overflow-hidden">
        <img
          src={dataUrl}
          alt="Story preview"
          className="absolute inset-0 w-full h-full object-contain"
          draggable={false}
        />
      </div>

      {/* Action row */}
      <div
        className="flex items-center gap-3 px-6 py-5 bg-black"
        style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={onCancel}
          disabled={uploading}
          className="flex-1 py-3 rounded-2xl border border-white/25 text-white text-sm font-semibold disabled:opacity-40"
        >
          Cancel
        </button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onConfirm}
          disabled={uploading}
          className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Posting…
            </>
          ) : (
            'Post Story'
          )}
        </motion.button>
      </div>
    </motion.div>,
    document.body
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StoriesRow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef(null);

  const [viewerOpen, setViewerOpen]         = useState(false);
  const [viewerStartIdx, setViewerStartIdx] = useState(0);
  const [preview, setPreview]               = useState(null); // { file, objectUrl }

  // 1. Who does the current user follow?
  const { data: followingEmails = [] } = useQuery({
    queryKey: ['following', user?.email],
    queryFn:  () => hubFollows.listFollowing(user.email),
    enabled:  !!user?.email,
    staleTime: 60_000,
  });

  // 2. Stories + profiles + viewed-IDs — all in one query
  const { data: feedData } = useQuery({
    queryKey: ['storiesFeed', user?.id, followingEmails.join(',')],
    queryFn:  () => storiesData.getStoriesFeedData(user, followingEmails),
    enabled:  !!user?.id,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const groups    = feedData?.groups    ?? [];
  const viewedIds = feedData?.viewedIds ?? new Set();

  // Only groups that actually have stories go to the viewer
  const storyGroups = groups.filter(g => g.stories.length > 0);

  // 3. Upload mutation
  const uploadMutation = useMutation({
    mutationFn: (file) => storiesData.createStory(user, file),
    onSuccess: (story) => {
      if (!story) { toast.error('Could not post story — try again.'); return; }
      queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
      cleanupPreview();
      toast.success('Story posted!');
    },
    onError: () => {
      toast.error('Upload failed — try again.');
    },
  });

  const cleanupPreview = useCallback(() => {
    if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl);
    setPreview(null);
  }, [preview]);

  // File input handler
  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting same file
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select a photo.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error('Photo must be under 50 MB.');
      return;
    }
    setPreview({ file, objectUrl: URL.createObjectURL(file) });
  }, []);

  // Avatar tap handler
  const handleAvatarPress = useCallback((group) => {
    if (group.isOwn && group.stories.length === 0) {
      // Own avatar, no story → open picker
      fileRef.current?.click();
      return;
    }
    if (group.stories.length === 0) return; // faded friend — nothing to view

    // Find index in storyGroups (only groups with stories)
    const idx = storyGroups.findIndex(g => g.email === group.email);
    setViewerStartIdx(Math.max(0, idx));
    setViewerOpen(true);
  }, [storyGroups]);

  if (!user) return null;

  return (
    <>
      {/* ── Horizontal strip ──────────────────────────────────────────── */}
      <div className="mb-4 -mx-4 md:-mx-6">
        <div
          className="flex gap-2 px-4 md:px-6 overflow-x-auto pb-1 scrollbar-hide"
        >
          {groups.map(group => (
            <React.Fragment key={group.email}>
              <StoryAvatarButton
                group={group}
                onPress={() => handleAvatarPress(group)}
                isUploading={uploadMutation.isPending && group.isOwn}
              />
              {/* "+" add-more button — shown right after own avatar when a story exists */}
              {group.isOwn && group.stories.length > 0 && !uploadMutation.isPending && (
                <motion.button
                  whileTap={{ scale: 0.90 }}
                  onClick={() => fileRef.current?.click()}
                  className="flex flex-col items-center gap-1 shrink-0 focus:outline-none"
                  style={{ minWidth: 68 }}
                  aria-label="Add another story"
                >
                  <div className="w-[60px] h-[60px] rounded-full border-2 border-dashed border-primary/60 flex items-center justify-center">
                    <Plus className="w-5 h-5 text-primary" />
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground w-[68px] text-center truncate">Add More</span>
                </motion.button>
              )}
            </React.Fragment>
          ))}

          {/* If no follows yet, show a placeholder hint */}
          {groups.length <= 1 && (
            <div className="flex flex-col items-center gap-1 shrink-0 opacity-40" style={{ minWidth: 68 }}>
              <div className="w-[60px] h-[60px] rounded-full border-2 border-dashed border-muted-foreground flex items-center justify-center">
                <Plus className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-[10px] text-muted-foreground w-[68px] text-center truncate">Follow friends</span>
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Upload preview confirm */}
      <AnimatePresence>
        {preview && (
          <StoryPreviewSheet
            key="preview"
            dataUrl={preview.objectUrl}
            uploading={uploadMutation.isPending}
            onConfirm={() => uploadMutation.mutate(preview.file)}
            onCancel={cleanupPreview}
          />
        )}
      </AnimatePresence>

      {/* Full-screen viewer */}
      <StoryViewer
        open={viewerOpen}
        groups={storyGroups}
        startIndex={viewerStartIdx}
        viewedIds={viewedIds}
        likedIds={feedData?.likedIds ?? new Set()}
        user={user}
        onClose={() => setViewerOpen(false)}
        onStoriesChange={() => {
          queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
          setViewerOpen(false);
        }}
        onAddStory={() => {
          setViewerOpen(false);
          setTimeout(() => fileRef.current?.click(), 120);
        }}
      />
    </>
  );
}
