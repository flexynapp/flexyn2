// src/components/stories/StoriesRow.jsx
//
// Horizontal scroll strip of story avatars + status note bubbles.
//
// Strip order:
//   1. "Add Story" dashed circle — always first when own story exists
//   2. Own avatar (Your Story) — orange ring if has story, "+" badge if not
//   3. Friends WITH active stories or notes (unseen → orange, seen → gray)
//   4. Friends WITHOUT active stories or notes (faded, no ring)
//
// Upload flow:
//   tap Add Story / own "+" → file picker → preview sheet (with filters, text)
//   → "Post Story" → limit check → upload → insert → refetch
//
// Post limit: max 10 active stories per 25-hour window.

import React, { useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Loader2, Heart } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import * as hubFollows from '@/lib/data/hubFollows';
import * as storiesData from '@/lib/data/stories';
import * as statusNotesData from '@/lib/data/statusNotes';
import StoryViewer from './StoryViewer';
import StoryPreviewSheet from './StoryPreviewSheet';
import StatusNoteEditor from './StatusNoteEditor';

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

// ── Avatar image ──────────────────────────────────────────────────────────────

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

// ── Status note bubble ────────────────────────────────────────────────────────

function NoteBubble({ note, isOwn, isLiked, onLike, onEditOwn }) {
  if (!note) return null;
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 flex flex-col items-center gap-0.5">
      <div
        className="relative max-w-[84px] bg-white rounded-2xl px-2.5 py-1.5 shadow-sm cursor-pointer"
        onClick={e => { e.stopPropagation(); isOwn ? onEditOwn() : null; }}
      >
        <p className="text-[9px] text-black leading-tight text-center line-clamp-2 select-none">
          {note.text}
        </p>
        {/* Speech bubble tail */}
        <div
          className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 pointer-events-none"
          style={{
            borderLeft:  '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop:   '5px solid white',
          }}
        />
      </div>
      {!isOwn && (
        <button
          onClick={e => { e.stopPropagation(); onLike(); }}
          className="flex items-center gap-0.5 mt-0.5"
          aria-label={isLiked ? 'Unlike note' : 'Like note'}
        >
          <Heart
            className={`w-3 h-3 transition-colors ${isLiked ? 'fill-red-500 text-red-500' : 'text-muted-foreground/60'}`}
          />
          {note.likeCount > 0 && (
            <span className="text-[8px] text-muted-foreground font-medium">{note.likeCount}</span>
          )}
        </button>
      )}
    </div>
  );
}

// ── Single avatar button ──────────────────────────────────────────────────────

function StoryAvatarButton({ group, onPress, onNoteLike, onNoteEditOwn, isUploading, likedNoteIds }) {
  const noStory     = group.stories.length === 0;
  const faded       = !group.isOwn && noStory && !group.note;
  const hasUnseen   = group.hasUnseen && !noStory;
  const hasSeenOnly = !group.hasUnseen && !noStory;

  const ringStyle = hasUnseen
    ? { background: 'linear-gradient(135deg, #FF6600 0%, #FFAA00 100%)' }
    : hasSeenOnly
    ? { background: 'rgba(150,150,150,0.45)' }
    : {};
  const hasRing = hasUnseen || hasSeenOnly;
  const isLiked = group.note ? likedNoteIds.has(group.note.id) : false;

  return (
    <motion.button
      whileTap={{ scale: 0.90 }}
      onClick={onPress}
      className="flex flex-col items-center gap-1 shrink-0 focus:outline-none relative"
      style={{ minWidth: 68, paddingTop: group.note ? 36 : 0 }}
      aria-label={group.isOwn ? 'Your story' : group.username}
    >
      <div className="relative w-full flex justify-center">
        {/* Note bubble above avatar */}
        <NoteBubble
          note={group.note}
          isOwn={group.isOwn}
          isLiked={isLiked}
          onLike={onNoteLike}
          onEditOwn={onNoteEditOwn}
        />

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
          <div className="absolute bottom-0 right-[4px] w-5 h-5 rounded-full bg-primary flex items-center justify-center ring-2 ring-background pointer-events-none">
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

  const [viewerOpen,      setViewerOpen]      = useState(false);
  const [viewerStartIdx,  setViewerStartIdx]  = useState(0);
  const [preview,         setPreview]         = useState(null); // { file, objectUrl, isVideo }
  const [noteEditorOpen,  setNoteEditorOpen]  = useState(false);
  const [likedNoteIds,    setLikedNoteIds]    = useState(new Set());

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
    onSuccess: (data) => {
      // Sync liked note IDs from server on each refetch
      if (data?.likedNoteIds) setLikedNoteIds(new Set(data.likedNoteIds));
    },
  });

  const groups      = feedData?.groups    ?? [];
  const viewedIds   = feedData?.viewedIds ?? new Set();
  const ownGroup    = groups.find(g => g.isOwn);
  const storyGroups = groups.filter(g => g.stories.length > 0);

  const uploadMutation = useMutation({
    mutationFn: ({ file, overlayStyle }) =>
      storiesData.createStory(user, file, overlayStyle, feedData?.ownPrivacyDefault ?? 'friends'),
    onSuccess: (result) => {
      if (result?.limitReached) {
        toast.error("Hey, you can only have 10 posts at a time! Delete an active story or wait until tomorrow to post more.");
        cleanupPreview();
        return;
      }
      if (!result?.ok) { toast.error('Could not post story — try again.'); return; }
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

  const handleNoteLike = useCallback(async (note) => {
    if (!user) return;
    const already = likedNoteIds.has(note.id);
    setLikedNoteIds(prev => { const n = new Set(prev); already ? n.delete(note.id) : n.add(note.id); return n; });
    if (already) await statusNotesData.unlikeStatusNote(note.id, user.id);
    else         await statusNotesData.likeStatusNote(note.id, user);
    queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
  }, [likedNoteIds, user, queryClient]);

  const handleNotePost = useCallback(async (text) => {
    const result = await statusNotesData.postStatusNote(user, text);
    if (!result) { toast.error('Could not post note — try again.'); return; }
    queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
    setNoteEditorOpen(false);
    toast.success('Note posted!');
  }, [user, queryClient]);

  const handleNoteDelete = useCallback(async () => {
    const note = ownGroup?.note;
    if (!note) return;
    const ok = await statusNotesData.deleteStatusNote(note.id);
    if (!ok) { toast.error('Could not delete note.'); return; }
    queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
    setNoteEditorOpen(false);
    toast.success('Note removed.');
  }, [ownGroup, queryClient]);

  if (!user) return null;

  const showAddButton = ownGroup?.stories.length > 0 && !uploadMutation.isPending;

  return (
    <>
      {/* Horizontal strip */}
      <div className="mb-4 -mx-4 md:-mx-6">
        <div className="flex gap-2 px-4 md:px-6 overflow-x-auto pb-1 pt-10 scrollbar-hide">

          {/* "Add Story" — leftmost when own story exists */}
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
              onNoteLike={() => group.note && handleNoteLike(group.note)}
              onNoteEditOwn={() => setNoteEditorOpen(true)}
              isUploading={uploadMutation.isPending && group.isOwn}
              likedNoteIds={likedNoteIds}
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

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Upload preview + filter/text editor */}
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

      {/* Status note editor */}
      <AnimatePresence>
        {noteEditorOpen && (
          <StatusNoteEditor
            key="note-editor"
            existingNote={ownGroup?.note ?? null}
            onPost={handleNotePost}
            onDelete={handleNoteDelete}
            onClose={() => setNoteEditorOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Full-screen story viewer */}
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
