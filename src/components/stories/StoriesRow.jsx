// src/components/stories/StoriesRow.jsx
//
// Horizontal scroll strip of story avatars + status note bubbles.
//
// Strip order (left → right):
//   1. "Add Story" dashed circle — always first when own story exists
//   2. Own avatar (Your Story) — orange ring if has story, "+" badge if not
//   3. Friends WITH active stories or notes (unseen → orange, seen → gray)
//   4. Friends WITHOUT active stories or notes (faded, no ring)
//   5. Thin vertical divider  (only when ≤1 friend)
//   6. Quick Add recommendations (friend-of-friend or recent profiles)
//
// Upload flow:
//   tap Add Story / own "+" → file picker → preview sheet (with filters, text)
//   → "Post Story" → limit check → upload → insert → refetch
//
// Post limit: max 10 active stories per 25-hour window.

import React, { useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Loader2, Heart, Check } from 'lucide-react';
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

function StoryAvatarButton({
  group, onPress, onNoteLike, onNoteEditOwn, isUploading, likedNoteIds,
  notePillRef, noteEditorOpen,
}) {
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

  // Own avatar always reserves space for the note pill
  const hasTopPill = group.isOwn || !!group.note;

  return (
    <motion.button
      whileTap={{ scale: 0.90 }}
      onClick={onPress}
      className="flex flex-col items-center gap-1 shrink-0 focus:outline-none relative"
      style={{ minWidth: 68, paddingTop: hasTopPill ? 40 : 0 }}
      aria-label={group.isOwn ? 'Your story' : group.username}
    >
      <div className="relative w-full flex justify-center">

        {/* ── Own note pill: always shown, triggers editor ── */}
        {group.isOwn && (
          <div
            ref={notePillRef}
            onClick={e => { e.stopPropagation(); onNoteEditOwn(); }}
            style={{
              position: 'absolute',
              bottom: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginBottom: 6,
              zIndex: 10,
              opacity: noteEditorOpen ? 0 : 1,
              pointerEvents: noteEditorOpen ? 'none' : 'auto',
              transition: 'opacity 0.15s',
              width: 80,
            }}
          >
            <div
              className={`w-full px-2 py-1.5 rounded-xl cursor-pointer relative ${
                group.note
                  ? 'bg-card border border-border shadow-sm'
                  : 'bg-muted/70 border border-dashed border-border'
              }`}
            >
              <p className={`text-[9px] leading-tight text-center line-clamp-2 select-none ${
                group.note ? 'text-foreground' : 'text-muted-foreground/70'
              }`}>
                {group.note ? group.note.text : 'Add a note...'}
              </p>
              {/* Chat bubble tail — only when note exists */}
              {group.note && (
                <div
                  className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 pointer-events-none"
                  style={{
                    borderLeft:  '4px solid transparent',
                    borderRight: '4px solid transparent',
                    borderTop:   '5px solid hsl(var(--card))',
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Others' note bubble ── */}
        {!group.isOwn && (
          <NoteBubble
            note={group.note}
            isOwn={false}
            isLiked={isLiked}
            onLike={onNoteLike}
            onEditOwn={() => {}}
          />
        )}

        {/* ── Avatar ring + image ── */}
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

// ── Quick Add inline card (lives inside the same horizontal scroll) ───────────
//
// Same paddingTop:40 as note-bearing avatars so circles align with `items-end`.
// The "+ Add" pill occupies that top padding area, mirroring where notes appear.

function QuickAddAvatarItem({ profile, onAdd }) {
  const [state, setState] = useState('idle'); // idle | adding | added

  const handleTap = useCallback(async () => {
    if (state !== 'idle') return;
    setState('adding');
    try {
      await onAdd(profile.email);
      setState('added');
    } catch {
      setState('idle');
    }
  }, [state, onAdd, profile.email]);

  return (
    <motion.button
      whileTap={{ scale: 0.90 }}
      onClick={handleTap}
      disabled={state === 'adding'}
      className="flex flex-col items-center gap-1 shrink-0 focus:outline-none relative"
      style={{ minWidth: 68, paddingTop: 40 }}
      aria-label={`Add ${profile.username}`}
    >
      <div className="relative w-full flex justify-center">

        {/* "+ Add" pill — sits in the top-padding zone above the circle */}
        <div
          style={{
            position:  'absolute',
            bottom:    '100%',
            left:      '50%',
            transform: 'translateX(-50%)',
            marginBottom: 6,
            zIndex: 10,
            width: 68,
          }}
        >
          <div
            className={`flex items-center justify-center gap-0.5 px-2 py-1 rounded-xl border transition-colors ${
              state === 'added'
                ? 'bg-muted border-border'
                : 'bg-orange-500/10 border-orange-500/40'
            }`}
          >
            {state === 'adding' && <Loader2 className="w-2.5 h-2.5 text-orange-500 animate-spin" />}
            {state === 'added'  && <Check   className="w-2.5 h-2.5 text-muted-foreground" />}
            {state === 'idle'   && <Plus    className="w-2.5 h-2.5 text-orange-500 stroke-[3]" />}
            <span className={`text-[9px] font-bold select-none ${state === 'added' ? 'text-muted-foreground' : 'text-orange-500'}`}>
              {state === 'added' ? 'Added' : 'Add'}
            </span>
          </div>
        </div>

        {/* Avatar circle — no ring, subtle border */}
        <div className="w-[60px] h-[60px] rounded-full overflow-hidden ring-1 ring-border/60 bg-secondary">
          <AvatarImage avatarUrl={profile.avatar_url} username={profile.username} />
        </div>
      </div>

      <span className="text-[10px] font-medium w-[68px] text-center truncate leading-tight text-muted-foreground">
        @{profile.username}
      </span>
    </motion.button>
  );
}

// ── Quick Add localStorage cache helpers ──────────────────────────────────────
// Cache refreshes once per day at noon. Structure:
//   { refreshedAt: ISO, list: [...profiles], addedEmails: [...] }

const QA_KEY = 'flexyn_quickadd_v1';

function qaLoad() {
  try { return JSON.parse(localStorage.getItem(QA_KEY) ?? 'null'); } catch { return null; }
}
function qaSave(cache) {
  try { localStorage.setItem(QA_KEY, JSON.stringify(cache)); } catch {}
}
function qaIsStale(cache) {
  if (!cache?.refreshedAt) return true;
  const now = new Date();
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  return new Date(cache.refreshedAt) < todayNoon;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StoriesRow({ onViewProfile } = {}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef(null);

  const [viewerOpen,      setViewerOpen]      = useState(false);
  const [viewerStartIdx,  setViewerStartIdx]  = useState(0);
  const [preview,         setPreview]         = useState(null);
  const [noteEditorOpen,  setNoteEditorOpen]  = useState(false);
  const [notePillRect,    setNotePillRect]    = useState(null);
  const [likedNoteIds,    setLikedNoteIds]    = useState(new Set());

  // Quick Add: persisted daily list, independent of followingEmails length
  const [qaList,         setQaList]         = useState([]);   // visible (not-yet-added) items
  const [qaHadItems,     setQaHadItems]     = useState(false); // list was non-empty at load
  const [qaDismissed,    setQaDismissed]    = useState(false);
  const qaFetchedRef = useRef(false); // prevent double-fetch in StrictMode

  const notePillRef = useRef(null);

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
      if (data?.likedNoteIds) setLikedNoteIds(new Set(data.likedNoteIds));
    },
  });

  // Load / refresh the Quick Add list once per noon cycle
  useEffect(() => {
    if (!user?.email || qaFetchedRef.current) return;
    const cache = qaLoad();
    if (!qaIsStale(cache) && cache.list?.length > 0) {
      // Cache is fresh — restore, filter out already-added items
      const addedSet = new Set(cache.addedEmails ?? []);
      const remaining = (cache.list ?? []).filter(p => !addedSet.has(p.email));
      setQaList(remaining);
      setQaHadItems(true);
      qaFetchedRef.current = true;
      return;
    }
    // Stale or empty — only fetch when the user has ≤1 friend (initial discovery)
    // Once cached, the section persists regardless of followingEmails.
    if ((followingEmails.length <= 1 || (cache?.list?.length > 0))) {
      qaFetchedRef.current = true;
      hubFollows.getRecommendations(user.email, followingEmails, 6).then(recs => {
        if (recs.length === 0) return;
        qaSave({ refreshedAt: new Date().toISOString(), list: recs, addedEmails: [] });
        setQaList(recs);
        setQaHadItems(true);
      }).catch(() => {});
    }
  // followingEmails intentionally omitted — we only want this to run once per mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const groups      = feedData?.groups    ?? [];
  const viewedIds   = feedData?.viewedIds ?? new Set();
  const ownGroup    = groups.find(g => g.isOwn);
  const storyGroups = groups.filter(g => g.stories.length > 0);

  const showQuickAdd = !qaDismissed && qaHadItems;

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
    if (group.stories.length === 0) {
      // No story — navigate to their profile if the parent supports it
      onViewProfile?.({ email: group.email, username: group.username, avatar_url: group.avatarUrl });
      return;
    }

    const idx = storyGroups.findIndex(g => g.email === group.email);
    setViewerStartIdx(Math.max(0, idx));
    setViewerOpen(true);
  }, [storyGroups, onViewProfile]);

  const handleNoteLike = useCallback(async (note) => {
    if (!user) return;
    const already = likedNoteIds.has(note.id);
    setLikedNoteIds(prev => { const n = new Set(prev); already ? n.delete(note.id) : n.add(note.id); return n; });
    if (already) await statusNotesData.unlikeStatusNote(note.id, user.id);
    else         await statusNotesData.likeStatusNote(note.id, user);
    queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
  }, [likedNoteIds, user, queryClient]);

  const handleOpenNoteEditor = useCallback(() => {
    const el = notePillRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setNotePillRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    setNoteEditorOpen(true);
  }, []);

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

  const handleQuickAdd = useCallback(async (email) => {
    // Remove from visible list immediately — the section stays mounted
    setQaList(prev => prev.filter(p => p.email !== email));
    // Persist the addition so it survives page refresh
    const cache = qaLoad();
    if (cache) {
      cache.addedEmails = [...new Set([...(cache.addedEmails ?? []), email])];
      qaSave(cache);
    }
    await hubFollows.follow(user.email, email);
    queryClient.invalidateQueries({ queryKey: ['following'] });
    queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
  }, [user, queryClient]);

  if (!user) return null;

  const showAddButton = ownGroup?.stories.length > 0 && !uploadMutation.isPending;

  return (
    <>
      {/* Horizontal strip — single seamless scroll */}
      <div className="mb-4 -mx-4 md:-mx-6">
        <div className="flex items-end gap-2 px-4 md:px-6 overflow-x-auto pb-1 pt-2 scrollbar-hide">

          {/* Slot 1: "Add Story" — leftmost when own story exists */}
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

          {/* Slots 2+: Own avatar + friends */}
          {groups.map(group => (
            <StoryAvatarButton
              key={group.email}
              group={group}
              onPress={() => handleAvatarPress(group)}
              onNoteLike={() => group.note && handleNoteLike(group.note)}
              onNoteEditOwn={handleOpenNoteEditor}
              isUploading={uploadMutation.isPending && group.isOwn}
              likedNoteIds={likedNoteIds}
              notePillRef={group.isOwn ? notePillRef : null}
              noteEditorOpen={noteEditorOpen}
            />
          ))}

          {/* Divider + Quick Add — inline, same scroll, persists until dismissed */}
          {showQuickAdd && (
            <>
              {/* Soft vertical separator */}
              <div className="self-center shrink-0 w-px h-[52px] rounded-full bg-border/60 mx-2" />

              {qaList.length > 0 ? (
                <>
                  {qaList.map(profile => (
                    <QuickAddAvatarItem
                      key={profile.email}
                      profile={profile}
                      onAdd={handleQuickAdd}
                    />
                  ))}
                </>
              ) : (
                /* All 6 added — show calm placeholder until noon refresh */
                <div className="self-center shrink-0 flex flex-col items-center justify-center px-3 py-2 max-w-[140px]">
                  <p className="text-[10px] text-muted-foreground/70 text-center leading-snug">
                    Check back at noon for more suggestions!
                  </p>
                  <button
                    onClick={() => setQaDismissed(true)}
                    className="mt-1.5 text-[9px] text-muted-foreground/50 underline underline-offset-2"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Trailing pad so last card isn't flush against edge */}
              <div className="shrink-0 w-2" />
            </>
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

      {/* Status note editor — expands from pill position */}
      <AnimatePresence>
        {noteEditorOpen && (
          <StatusNoteEditor
            key="note-editor"
            existingNote={ownGroup?.note ?? null}
            origin={notePillRect}
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
