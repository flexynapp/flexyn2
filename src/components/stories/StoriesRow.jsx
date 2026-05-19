// src/components/stories/StoriesRow.jsx
//
// Horizontal scroll strip of story avatars.
//
// Strip order:
//   1. "Add Story" dashed circle — always first when own story exists
//   2. Own avatar (Your Story) — orange ring if has story, "+" badge if not
//   3. Friends WITH active stories (unseen → orange, seen → gray)
//   4. Friends WITHOUT active stories (faded, no ring)
//
// Upload flow:
//   tap Add Story / own "+" → file picker → preview sheet (with text overlay option)
//   → "Post Story" → upload → insert → refetch

import React, { useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import * as hubFollows from '@/lib/data/hubFollows';
import * as storiesData from '@/lib/data/stories';
import StoryViewer from './StoryViewer';
import StoryPreviewSheet from './StoryPreviewSheet';

// ── Video duration guard ──────────────────────────────────────────────────────

function checkVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      video.duration > 10
        ? reject(new Error('Video must be 10 seconds or less.'))
        : resolve();
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read video file.'));
    };
    video.src = url;
  });
}

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
      <div className="relative">
        <div
          className="w-[60px] h-[60px] rounded-full flex items-center justify-center"
          style={hasRing ? { ...ringStyle, padding: '2.5px' } : {}}
        >
          <div className={`rounded-full overflow-hidden bg-background ${hasRing ? 'w-full h-full p-[2px]' : 'w-[60px] h-[60px]'}`}>
            <div className="w-full h-full rounded-full overflow-hidden">
              {isUploading ? (
                <div className="w-full h-full rounded-full bg-secondary flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                </div>
              ) : (
                <AvatarImage avatarUrl={group.avatarUrl} username={group.username} faded={faded} />
              )}
            </div>
          </div>
        </div>

        {group.isOwn && noStory && !isUploading && (
          <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center ring-2 ring-background pointer-events-none">
            <Plus className="w-3 h-3 text-primary-foreground stroke-[3]" />
          </div>
        )}
      </div>

      <span
        className={`text-[10px] font-medium w-[68px] text-center truncate leading-tight ${faded ? 'text-muted-foreground/45' : 'text-muted-foreground'}`}
      >
        {group.isOwn ? 'Your Story' : group.username}
      </span>
    </motion.button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StoriesRow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef(null);

  const [viewerOpen, setViewerOpen]         = useState(false);
  const [viewerStartIdx, setViewerStartIdx] = useState(0);
  const [preview, setPreview]               = useState(null); // { file, objectUrl, isVideo }

  const { data: followingEmails = [] } = useQuery({
    queryKey: ['following', user?.email],
    queryFn:  () => hubFollows.listFollowing(user.email),
    enabled:  !!user?.email,
    staleTime: 60_000,
  });

  const { data: feedData } = useQuery({
    queryKey: ['storiesFeed', user?.id, followingEmails.join(',')],
    queryFn:  () => storiesData.getStoriesFeedData(user, followingEmails),
    enabled:  !!user?.id,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const groups     = feedData?.groups    ?? [];
  const viewedIds  = feedData?.viewedIds ?? new Set();
  const ownGroup   = groups.find(g => g.isOwn);
  const storyGroups = groups.filter(g => g.stories.length > 0);

  const uploadMutation = useMutation({
    mutationFn: ({ file, overlayStyle }) => storiesData.createStory(user, file, overlayStyle),
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

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      toast.error('Please select a photo or video.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      toast.error('File must be under 100 MB.');
      return;
    }
    if (isVideo) {
      try {
        await checkVideoDuration(file);
      } catch (err) {
        toast.error(err.message);
        return;
      }
    }

    setPreview({ file, objectUrl: URL.createObjectURL(file), isVideo });
  }, []);

  const handleAvatarPress = useCallback((group) => {
    if (group.isOwn && group.stories.length === 0) {
      fileRef.current?.click();
      return;
    }
    if (group.stories.length === 0) return;

    const idx = storyGroups.findIndex(g => g.email === group.email);
    setViewerStartIdx(Math.max(0, idx));
    setViewerOpen(true);
  }, [storyGroups]);

  if (!user) return null;

  const showAddButton = ownGroup?.stories.length > 0 && !uploadMutation.isPending;

  return (
    <>
      {/* ── Horizontal strip ──────────────────────────────────────────── */}
      <div className="mb-4 -mx-4 md:-mx-6">
        <div className="flex gap-2 px-4 md:px-6 overflow-x-auto pb-1 scrollbar-hide">

          {/* "Add Story" — always the leftmost item when own story exists */}
          {showAddButton && (
            <motion.button
              whileTap={{ scale: 0.90 }}
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center gap-1 shrink-0 focus:outline-none"
              style={{ minWidth: 68 }}
              aria-label="Add a story"
            >
              <div className="w-[60px] h-[60px] rounded-full border-2 border-dashed border-primary/60 flex items-center justify-center">
                <Plus className="w-5 h-5 text-primary" />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground w-[68px] text-center truncate">
                Add Story
              </span>
            </motion.button>
          )}

          {groups.map(group => (
            <StoryAvatarButton
              key={group.email}
              group={group}
              onPress={() => handleAvatarPress(group)}
              isUploading={uploadMutation.isPending && group.isOwn}
            />
          ))}

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

      {/* Hidden file input — accepts photos and videos */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Upload preview + text overlay confirm */}
      <AnimatePresence>
        {preview && (
          <StoryPreviewSheet
            key="preview"
            dataUrl={preview.objectUrl}
            isVideo={preview.isVideo}
            uploading={uploadMutation.isPending}
            onConfirm={(overlayStyle) => uploadMutation.mutate({ file: preview.file, overlayStyle })}
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
