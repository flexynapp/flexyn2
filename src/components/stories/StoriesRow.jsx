// src/components/stories/StoriesRow.jsx
//
// Horizontal scroll strip of story avatars + status note bubbles.
//
// Strip order (left → right):
//   1. "Add Story" dashed ring — always first, unconditional
//   2. Own avatar (Your Story) — orange ring if has story
//   3. Friends WITH active stories or notes (unseen → orange, seen → gray)
//   4. Friends with NEITHER — present, just unringed
//   5. Thin vertical divider  (only when ≤1 friend)
//   6. Quick Add — friend-of-friend ONLY, capped at 5, last in the strip
//
// Every followed friend is rendered. That reverses an earlier rule which
// dropped the ones with nothing posted; ordering keeps the posters at the
// front instead, so the signal still leads without anyone disappearing from
// the home screen. See src/lib/storiesRowVisibility.js for the full reasoning.
//
// Upload flow:
//   tap Add Story / own "+" → file picker → preview sheet (with filters, text)
//   → "Post Story" → limit check → upload → insert → refetch
//
// Post limit: max 10 active stories per 25-hour window.

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Loader2, Heart, Check, Shield } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubFollows from '@/lib/data/hubFollows';
import * as storiesData from '@/lib/data/stories';
import * as statusNotesData from '@/lib/data/statusNotes';
import * as crewsData from '@/lib/data/crews';
import { isVerified } from '@/lib/verifiedUsers';
import { orderStoryGroups } from '@/lib/storiesRowVisibility';
import StoryViewer from './StoryViewer';
import StoryPreviewSheet from './StoryPreviewSheet';
import StatusNoteEditor from './StatusNoteEditor';
import { reportError } from '@/lib/reportError';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

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

// Deliberately no `faded` variant. Friends with nothing posted DO reach this
// component now, and dimming them to opacity-40 is what made the row read as
// a wall of grey the first time around — the missing ring is already the
// difference between "has something" and "doesn't".
function AvatarImage({ avatarUrl, username }) {
  const initials = (username || '?').slice(0, 2).toUpperCase();
  if (avatarUrl) {
    return (
      <img loading="lazy" src={avatarUrl}
        alt={username}
        className="w-full h-full object-cover rounded-full"
        draggable={false}
      />
    );
  }
  return (
    <div
      className="w-full h-full rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-muted-foreground select-none"
    >
      {initials}
    </div>
  );
}

// ── Status note bubble ────────────────────────────────────────────────────────

function NoteBubble({ note, isOwn, isLiked, onLike, onEditOwn }) {
  const { tFallback } = useLanguage();
  // A note is capped at 60 characters, and `line-clamp-2` inside a 72px cell
  // shows roughly the first 20 of them — so two thirds of every note anyone
  // wrote was unreadable, with no affordance saying so. Tapping lifts the
  // clamp and widens the bubble; tapping again puts it back.
  //
  // Only reachable for OTHER people's notes: tapping your own opens the
  // editor, which already shows the full text in a textarea.
  const [expanded, setExpanded] = useState(false);
  if (!note) return null;
  // Tailwind reads class names out of source text, so both widths have to
  // exist as literals — a computed `max-w-[${n}px]` emits no CSS at all.
  const widthCls = expanded ? 'max-w-[168px]' : 'max-w-[72px]';
  return (
    // w-max + max-w-[72px] for the same reason as the own-note pill above:
    // anchored at start-1/2, plain shrink-to-fit only sees half the cell and
    // wraps a two-word note onto two lines. Sized to the text, capped at the
    // cell width.
    <div className={`absolute bottom-full start-1/2 -translate-x-1/2 mb-1.5 flex flex-col items-center gap-0.5 w-max ${widthCls} ${expanded ? 'z-30' : 'z-10'}`}>
      {/* bg-card, not bg-white. --card IS pure white in the light theme, so
          this renders identically there — but the literal was also white in
          the DARK theme, where a friend's note was a white blob on a 9%-
          lightness background, and in the loot themes that repaint --card.
          Same tokens as the own-note bubble, so the two match everywhere. */}
      <div
        className="relative w-full bg-card border border-border rounded-lg px-2 py-1 cursor-pointer"
        onClick={e => { e.stopPropagation(); isOwn ? onEditOwn() : setExpanded(v => !v); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            isOwn ? onEditOwn() : setExpanded(v => !v);
          }
        }}
        aria-expanded={isOwn ? undefined : expanded}
        aria-label={isOwn
          ? tFallback('stories.editNote', 'Edit your note')
          : (expanded
              ? tFallback('stories.collapseNote', 'Collapse note')
              : tFallback('stories.expandNote', 'Read full note'))}
      >
        <p className={`text-micro text-card-foreground leading-tight text-center select-none ${expanded ? 'break-words' : 'line-clamp-2'}`}>
          {note.text}
        </p>
        {/* Speech bubble tail */}
        <div
          className="absolute top-full start-1/2 -translate-x-1/2 w-0 h-0 pointer-events-none"
          style={{
            borderLeft:  '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop:   '5px solid hsl(var(--card))',
          }}
        />
      </div>
      {!isOwn && (
        <button
          onClick={e => { e.stopPropagation(); onLike(); }}
          className="flex items-center gap-0.5 mt-0.5"
          aria-label={isLiked
            ? tFallback('stories.unlikeNote', 'Unlike note')
            : tFallback('stories.likeNote', 'Like note')}
        >
          <Heart
            className={`w-3 h-3 transition-colors ${isLiked ? 'fill-red-500 text-red-500' : 'text-muted-foreground/60'}`}
          />
          {note.likeCount > 0 && (
            <span className="text-micro text-muted-foreground font-medium">{note.likeCount}</span>
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
  const { tFallback } = useLanguage();
  const noStory     = group.stories.length === 0;
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

  // How much room the thing above the avatar needs. The two stacks are NOT
  // the same height: the own pill is just the bubble (or the "+ Note" pill)
  // plus a 4px margin, but a friend's carries the like button underneath —
  // bubble + 2px gap + 14px heart row + 6px margin. One shared value of 40
  // meant a friend's two-line note was clipped 14px at the top by the row's
  // own overflow, which reads as a rendering glitch rather than a long note.
  // The row bottom-aligns (items-end), so a taller reserve here only grows
  // the strip on the screens where a friend actually has a note.
  // 60, not the 57 the stack actually measures: the extra 3px is slack for
  // scripts whose glyphs sit taller in the same line-height (the app ships
  // 15 languages), and it costs nothing — the row is already this tall.
  const topReserve = group.isOwn ? 40 : 60;

  return (
    <motion.button
      whileTap={{ scale: 0.90 }}
      onClick={onPress}
      className="flex flex-col items-center gap-1 shrink-0 focus:outline-none relative"
      style={{ minWidth: 68, paddingTop: hasTopPill ? topReserve : 0 }}
      aria-label={group.isOwn ? tFallback('stories.yourStory', 'Your story') : group.username}
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
              // 4 rather than 6, with the tighter padding below: the pill
              // sits above the avatar, so its own height plus this margin is
              // what pushed its top edge up against the app header with
              // almost nothing between them. Shrinking it moves the top edge
              // down and buys that gap back without moving the avatar row.
              marginBottom: 4,
              zIndex: 10,
              opacity: noteEditorOpen ? 0 : 1,
              pointerEvents: noteEditorOpen ? 'none' : 'auto',
              transition: 'opacity 0.15s',
              // max-content, NOT shrink-to-fit. A fixed 72px column made
              // every note as tall as the longest one it could hold, so a
              // two-word note rendered as a 72×38 block. But simply dropping
              // the width is worse: this box is anchored at left:50%, so its
              // shrink-to-fit available width is only HALF the 68px cell —
              // 34px — and "gym day" collapsed onto two lines at 41×38.
              // max-content sizes to the unwrapped text and the cap makes it
              // wrap only when it genuinely must. Short notes land at 24px,
              // the same height as the empty pill.
              width: 'max-content',
              maxWidth: 72,
            }}
            role="button"
            aria-label={group.note
              ? tFallback('stories.editNote', 'Edit your note')
              : tFallback('stories.addANote', 'Add a note')}
          >
            {group.note ? (
              /* No shadow: a hairline border is the resting elevation here,
                 and it matches the empty pill beside it. Width comes from
                 the wrapper's max-content + 72px cap. */
              <div className="w-full px-2 py-1 rounded-lg cursor-pointer relative bg-card border border-border">
                <p className="text-micro leading-tight text-center line-clamp-2 select-none text-foreground">
                  {group.note.text}
                </p>
                {/* Chat bubble tail — only when note exists */}
                <div
                  className="absolute top-full start-1/2 -translate-x-1/2 w-0 h-0 pointer-events-none"
                  style={{
                    borderLeft:  '4px solid transparent',
                    borderRight: '4px solid transparent',
                    borderTop:   '5px solid hsl(var(--card))',
                  }}
                />
              </div>
            ) : (
              /* Same geometry as the "+ Add" pill in QuickAddAvatarItem, so
                 the two affordances in this strip read as one family. Kept
                 muted rather than orange: Quick Add is the CTA here, and two
                 orange pills side by side would compete. `rounded-lg` rather
                 than the neighbour's `rounded-xl` — both resolve to
                 var(--radius), and lg is the sanctioned name (tailwind.config
                 pins xl as a compatibility alias). */
              <div
                className="flex items-center justify-center gap-0.5 px-2 py-1 rounded-lg border border-dashed border-border bg-muted/70 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-2.5 h-2.5 text-muted-foreground stroke-[3]" />
                <span className="text-micro font-bold text-muted-foreground select-none">
                  {tFallback('stories.note', 'Note')}
                </span>
              </div>
            )}
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
        {/* Geometry is IDENTICAL whether or not a ring is drawn: a 60px outer
            box, 2.5px ring band, 2px background gap, and the avatar filling the
            rest. Previously the no-ring branch made the avatar the full 60px
            while a ringed one shrank to 51px, so the grey circle changed size
            between users and the ring looked mismatched. The ring band is just
            transparent when there's no story. */}
        <div
          className="w-[60px] h-[60px] rounded-full flex items-center justify-center"
          // INTEGER padding: a fractional band (2.5px) rounds to 2px on one
          // edge and 3px on the other at non-integer device pixel ratios, so
          // the ring looked thicker on one side. 3px keeps every layer on a
          // whole pixel (60 → 54 → 50).
          style={{ padding: '3px', ...(hasRing ? ringStyle : {}) }}
        >
          <div className="rounded-full overflow-hidden bg-background w-full h-full p-[2px]">
            <div className="w-full h-full rounded-full overflow-hidden">
              {isUploading ? (
                <div className="w-full h-full rounded-full bg-secondary flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                </div>
              ) : (
                <AvatarImage avatarUrl={group.avatarUrl} username={group.username} />
              )}
            </div>
          </div>
        </div>

        {/* The own-avatar "+" badge is gone: the Add Story slot at the head of
            the strip is now unconditional, so this would be the second control
            for one action — the exact duplication that got the slot removed in
            the first place. This badge was also gated on `noStory`, so it
            vanished once you had posted and left no way to add a second. */}
        {isVerified(group.username) && (
          <div
            className="absolute bottom-0 pointer-events-none w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-background"
            style={{
              background: 'hsl(var(--primary))',
              right: (group.isOwn && noStory && !isUploading) ? 'auto' : '4px',
              left:  (group.isOwn && noStory && !isUploading) ? '4px'  : 'auto',
            }}
          >
            <Check className="w-3 h-3 text-white stroke-[3]" />
          </div>
        )}
      </div>

      <span
        className="text-micro font-medium w-[68px] text-center truncate leading-tight text-muted-foreground"
      >
        {group.isOwn ? tFallback('stories.yourStory', 'Your Story') : group.username}
      </span>
    </motion.button>
  );
}

// ── Quick Add inline card (lives inside the same horizontal scroll) ───────────
//
// Same paddingTop:40 as note-bearing avatars so circles align with `items-end`.
// The "+ Add" pill occupies that top padding area, mirroring where notes appear.

function QuickAddAvatarItem({ profile, onAdd, onViewProfile }) {
  const { tFallback } = useLanguage();
  const [state, setState] = useState('idle'); // idle | adding | added

  // Add is now triggered ONLY by the "+ Add" pill. Tapping the avatar
  // or username opens the user's profile so you can vet someone before
  // following. The previous behavior — the whole cell being one big
  // add-button — auto-followed people the user only intended to look
  // at. (Screenshot feedback: "When you tap someone's profile, it
  // should bring you to their profile instead of automatically adding
  // them from quick add.")
  const handleAddClick = useCallback(async (e) => {
    e.stopPropagation();
    if (state !== 'idle') return;
    setState('adding');
    try {
      await onAdd(profile.id);
      setState('added');
    } catch {
      setState('idle');
    }
  }, [state, onAdd, profile.id]);

  const handleViewProfile = useCallback(() => {
    onViewProfile?.({
      id: profile.id,
      username: profile.username,
      avatar_url: profile.avatar_url,
    });
  }, [onViewProfile, profile.id, profile.username, profile.avatar_url]);

  return (
    <div
      className="flex flex-col items-center gap-1 shrink-0 relative"
      style={{ minWidth: 68, paddingTop: 40 }}
    >
      <div className="relative w-full flex justify-center">
        {/* "+ Add" pill — its own button now, no longer the whole cell */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.90 }}
          onClick={handleAddClick}
          disabled={state !== 'idle'}
          aria-label={state === 'added'
            ? `Added ${profile.username}`
            : `Add ${profile.username}`}
          style={{
            position:  'absolute',
            bottom:    '100%',
            left:      '50%',
            transform: 'translateX(-50%)',
            marginBottom: 6,
            zIndex: 10,
            // Content-sized, capped at the cell. It was a hard `width: 68` —
            // the width of the CELL — so the pill spanned its slot edge to
            // edge and the only thing separating two of them was the rail's
            // 8px gap. "Added" plus a tick does not fit 68px at the 11px
            // floor, so the div overflowed the button on both sides and ate
            // that gap: the confirmation visibly ran into the next person's
            // "+ Add". Every non-English label is longer than "Added"
            // (de "Hinzugefügt", pt "Adicionado"), so a fixed width was never
            // going to hold anyway.
            width: 'max-content',
            maxWidth: 68,
          }}
          className="focus:outline-none"
        >
          <div
            className={`flex items-center justify-center gap-0.5 py-1 rounded-xl border transition-colors whitespace-nowrap ${
              state === 'added' ? 'px-1.5 bg-muted border-border' : 'px-2 bg-orange-500/10 border-orange-500/40'
            }`}
          >
            {state === 'adding' && <Loader2 className="w-2.5 h-2.5 text-orange-500 animate-spin" />}
            {state === 'added'  && <Check   className="w-3 h-3 text-muted-foreground stroke-[3]" />}
            {state === 'idle'   && <Plus    className="w-2.5 h-2.5 text-orange-500 stroke-[3]" />}
            {/* No label once added. The tick is the whole message — the user
                just pressed the thing, the row is one tap wide, and a word
                here is what pushed the pill past its slot in the first
                place. The state is still announced via aria-label. */}
            {state !== 'added' && (
              <span className="text-micro font-bold select-none text-orange-500">
                {tFallback('stories.quickAdd.add', 'Add')}
              </span>
            )}
          </div>
        </motion.button>

        {/* Avatar circle — its own button: opens the user's profile */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.90 }}
          onClick={handleViewProfile}
          aria-label={`View ${profile.username}'s profile`}
          className="w-[60px] h-[60px] rounded-full overflow-hidden ring-1 ring-border/60 bg-secondary focus:outline-none"
        >
          <AvatarImage avatarUrl={profile.avatar_url} username={profile.username} />
        </motion.button>
      </div>

      <button
        type="button"
        onClick={handleViewProfile}
        aria-label={`View ${profile.username}'s profile`}
        className="text-micro font-medium w-[68px] text-center truncate leading-tight text-muted-foreground hover:text-foreground active:text-foreground transition-colors focus:outline-none"
      >
        @{profile.username}
      </button>
    </div>
  );
}

// ── Quick Add localStorage cache helpers ──────────────────────────────────────
// Cache refreshes once per day at noon. Structure:
//   { refreshedAt: ISO, list: [...profiles], addedEmails: [...] }

// Per-user key (flexyn.<feature>.<userId> per CLAUDE.md). The cache
// contains another user's emails / usernames / avatars from the server
// recommender, plus the set of emails the user has already added. On a
// shared device, surfacing User A's recommendations to User B would
// expose recommendation signal that the server computed for User A
// (potentially a friend-of-A who never consented to be shown to B) and
// would let B add them with a one-tap CTA. Same class as the
// paused_workouts leak fixed in pass 4 run 8.
// One-shot migration: any data at the legacy global key is dropped
// rather than carried forward — the cache refreshes at noon anyway,
// so the user loses at most one cycle of stale suggestions.
const QA_KEY = (userId) => `flexyn.quickadd.v1.${userId || 'anon'}`;

let __quickAddLegacyEvicted = false;
function evictLegacyQuickAdd() {
  if (__quickAddLegacyEvicted) return;
  __quickAddLegacyEvicted = true;
  try { localStorage.removeItem('flexyn_quickadd_v1'); } catch { /* best-effort */ }
}

function qaLoad(userId) {
  evictLegacyQuickAdd();
  try { return JSON.parse(localStorage.getItem(QA_KEY(userId)) ?? 'null'); } catch { return null; }
}
function qaSave(userId, cache) {
  try { localStorage.setItem(QA_KEY(userId), JSON.stringify(cache)); } catch {}
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
  const { tFallback } = useLanguage();
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

  // Canonical follow-state cache key — shared with HubProfile, HubFeed,
  // QuickAddSection, and useHubUnreadDot. The list of emails the user
  // follows is a single piece of state; before this unification each
  // surface had its own key (this one was 'following', HubProfile was
  // 'hubFollowing') so a follow tap in one place didn't invalidate the
  // others, and the new friend's stories silently failed to appear in
  // this row until full page reload.
  // Id-keyed follow list for the stories feed — it resolves owner profiles
  // by user_id, so it never needs the followed users' emails.
  const { data: followingIds = [] } = useQuery({
    queryKey: ['hubFollowingIds', user?.id],
    queryFn:  () => hubFollows.listFollowingIds(user.id),
    enabled:  !!user?.id,
    staleTime: 60_000,
  });

  const { data: feedData } = useQuery({
    queryKey: ['storiesFeed', user?.id, followingIds.join(',')],
    queryFn:  () => storiesData.getStoriesFeedData(user, followingIds),
    enabled:  !!user?.id,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  // Pre-warm the browser image cache as soon as the feed lands, so opening
  // any story is instant — no first-image flicker on a cold dashboard. We
  // cap the burst at 40 URLs so a heavy social graph doesn't spawn hundreds
  // of requests in one tick; StoryViewer's own next-image preload handles
  // anything past that during playback.
  useEffect(() => {
    if (!feedData?.groups) return;
    const urls = [];
    for (const g of feedData.groups) {
      if (urls.length >= 40) break;
      for (const s of (g.stories || [])) {
        if (s?.image_url) urls.push(s.image_url);
        if (urls.length >= 40) break;
      }
    }
    urls.forEach(u => { try { const i = new Image(); i.src = u; } catch { /* ignore */ } });
  }, [feedData]);

  // react-query v5 removed `onSuccess` on useQuery — the previous
  // implementation silently never hydrated `likedNoteIds` from the
  // server, so the heart icon rendered unfilled on already-liked notes
  // until the user toggled one manually. Replace with the v5 idiom:
  // a useEffect that watches the resolved data.
  useEffect(() => {
    if (feedData?.likedNoteIds) {
      setLikedNoteIds(new Set(feedData.likedNoteIds));
    }
  }, [feedData?.likedNoteIds]);

  const [crewStoryViewerOpen, setCrewStoryViewerOpen] = useState(null); // { crew, stories, idx }
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(!!crewStoryViewerOpen);

  const { data: crewStoryGroups = [] } = useQuery({
    queryKey: ['crewStoriesFeed', user?.id],
    queryFn:  () => crewsData.getCrewStoriesFeed(user.id),
    enabled:  !!user?.id,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Load / refresh the Quick Add list.
  //
  // The previous policy refreshed only "once per noon cycle" and only
  // started new fetches when the user had ≤1 followee — so a user
  // with a populated cache never saw newly-signed-up accounts during
  // the same day, and active users with 2+ follows never refreshed
  // their suggestions at all. ("We've had like 10 new users and none
  // of them shown up.")
  //
  // New policy:
  //   1. Show the cached list IMMEDIATELY (no flash on app open).
  //   2. ALWAYS kick off a background refetch on every mount.
  //   3. When the refetch resolves, merge: keep already-added emails
  //      out, and prefer the fresh list (which surfaces new signups).
  //
  // Cache stale-check is now only a safety net for offline /
  // RPC-down cases — we no longer gate fetches on it.
  useEffect(() => {
    if (!user?.id || qaFetchedRef.current) return;
    qaFetchedRef.current = true;
    let cancelled = false;
    const cache = qaLoad(user?.id);
    const addedSet = new Set(cache?.addedIds ?? []);
    if (cache?.list?.length > 0) {
      // Paint the cached list right away so the rail doesn't blink
      // on every app open.
      const remaining = (cache.list ?? []).filter(p => !addedSet.has(p.id));
      setQaList(remaining);
      if (remaining.length > 0) setQaHadItems(true);
    }
    // Always refetch — new users joining the platform should reach
    // existing users without waiting for the noon roll. We pass a
    // larger N (12 vs 6) so newly-arrived candidates have a slot
    // even if a few "always-popular" rows would otherwise hog the
    // top 6.
    hubFollows.getRecommendations(user.id, followingIds, 5, { fofOnly: true }).then(recs => {
      if (cancelled) return;
      if (!Array.isArray(recs) || recs.length === 0) return;
      const fresh = recs.filter(p => !addedSet.has(p.id));
      qaSave(user?.id, {
        refreshedAt: new Date().toISOString(),
        list: fresh,
        addedIds: Array.from(addedSet),
      });
      setQaList(fresh);
      if (fresh.length > 0) setQaHadItems(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  // followingIds intentionally omitted — we read the snapshot once at mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const groups      = feedData?.groups    ?? [];
  const viewedIds   = feedData?.viewedIds ?? new Set();
  const ownGroup    = groups.find(g => g.isOwn);

  // Filter out anyone the user already follows (cache may predate the follow)
  const followingSet   = new Set([user?.id, ...followingIds]);
  // Hard cap of 5, applied at RENDER as well as at fetch: a cached list
  // written before the cap existed would otherwise still paint 12.
  const visibleQaList  = qaList.filter(p => !followingSet.has(p.id)).slice(0, 5);
  const storyGroups = groups.filter(g => g.stories.length > 0);

  // Avatars actually rendered: own slot + anyone with a story or a note.
  // Followed users with neither are dropped rather than dimmed. Derived
  // from `groups` (not the reverse) so `storyGroups` — which indexes the
  // story viewer — keeps its original positions; every story-haver is
  // visible, so the two lists stay in agreement.
  // Every followed friend stays in the row; ordering, not hiding, keeps the
  // posters at the front. See orderStoryGroups for why this reversed.
  const visibleGroups = orderStoryGroups(groups);

  const showQuickAdd = !qaDismissed && qaHadItems;

  const uploadMutation = useMutation({
    mutationFn: ({ file, overlayStyle, overlays }) =>
      storiesData.createStory(user, file, overlayStyle, feedData?.ownPrivacyDefault ?? 'friends', overlays),
    onSuccess: (result) => {
      if (result?.limitReached) {
        toast.error("Hey, you can only have 10 posts at a time! Delete an active story or wait until tomorrow to post more.");
        cleanupPreview();
        return;
      }
      if (!result?.ok) {
        // Surface the REAL failure (code + message) instead of a generic
        // "try again", and report it to Sentry — so a broken story post is
        // diagnosable from the toast and collected for the team.
        const e = result?.error;
        const code = e?.code || e?.statusCode || e?.status || '';
        const msg = e?.message || e?.error_description || (typeof e === 'string' ? e : '') || 'unknown error';
        reportError(e instanceof Error ? e : new Error(`story post failed: ${code} ${msg}`), {
          feature: 'story.post', userEmail: user?.email, code, raw: (() => { try { return JSON.stringify(e).slice(0, 600); } catch { return String(e); } })(),
        });
        toast.error(`Couldn't post story — ${code ? code + ': ' : ''}${msg}`.slice(0, 160), { duration: 9000 });
        cleanupPreview();
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
      cleanupPreview();
      toast.success("Story's up.");
    },
    onError: (err) => {
      // Revoke the preview's object URL before clearing — previously this
      // path left the URL dangling, so each retry on a flaky network would
      // leak another blob into memory.
      cleanupPreview();
      reportError(err, { feature: 'story.post', userEmail: user?.email });
      toast.error(`Upload failed — ${err?.message || err?.code || 'try again'}`.slice(0, 160), { duration: 9000 });
    },
  });

  // cleanupPreview must NOT depend on `preview` directly — that would
  // re-create the callback every render, and an in-flight upload that
  // captured the old reference might revoke the *new* preview's URL
  // if the user re-uploaded after a failed attempt. We resolve the
  // url from the latest state via the setter callback so the URL we
  // revoke is always the one we're discarding.
  const cleanupPreview = useCallback(() => {
    setPreview(prev => {
      if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
  }, []);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      toast.error(tFallback('stories.invalidFileType', 'Please select a photo or video.'));
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error(tFallback('stories.fileTooLarge', 'File must be under 50 MB.'));
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

  // The Add Story slot's action. Same file input the own-avatar path used,
  // so there is one upload flow rather than two.
  const openStoryPicker = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const handleAvatarPress = useCallback((group) => {
    if (group.isOwn && group.stories.length === 0) {
      fileRef.current?.click();
      return;
    }
    if (group.stories.length === 0) {
      // No story — navigate to their profile if the parent supports it
      onViewProfile?.({ id: group.user_id, username: group.username, avatar_url: group.avatarUrl });
      return;
    }

    const idx = storyGroups.findIndex(g => g.user_id === group.user_id);
    setViewerStartIdx(Math.max(0, idx));
    setViewerOpen(true);
  }, [storyGroups, onViewProfile]);

  const handleNoteLike = useCallback(async (note) => {
    if (!user) return;
    const already = likedNoteIds.has(note.id);
    // Optimistic toggle. We need an explicit rollback on failure
    // because the heart icon is the user's only feedback that the
    // tap was registered — without rollback, a network blip leaves
    // the icon in the wrong state forever (heart filled but server
    // never recorded the like, or vice versa).
    setLikedNoteIds(prev => { const n = new Set(prev); if (already) n.delete(note.id); else n.add(note.id); return n; });
    try {
      if (already) await statusNotesData.unlikeStatusNote(note.id, user.id);
      else         await statusNotesData.likeStatusNote(note.id, user);
      queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
    } catch (err) {
      // Revert to the pre-tap state so the heart matches server truth.
      setLikedNoteIds(prev => { const n = new Set(prev); if (already) n.add(note.id); else n.delete(note.id); return n; });
      reportError(err, { feature: 'stories.note-like', level: 'warning', userEmail: user?.email, noteId: note.id });
    }
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
    toast.success("Note's up.");
  }, [user, queryClient]);

  const handleNoteDelete = useCallback(async () => {
    const note = ownGroup?.note;
    if (!note) return;
    const ok = await statusNotesData.deleteStatusNote(note.id);
    if (!ok) { toast.error('Could not delete note.'); return; }
    queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
    setNoteEditorOpen(false);
    toast.success('Note pulled.');
  }, [ownGroup, queryClient]);

  const handleQuickAdd = useCallback(async (id) => {
    // Persist the addition so it survives page refresh
    const cache = qaLoad(user?.id);
    if (cache) {
      cache.addedIds = [...new Set([...(cache.addedIds ?? []), id])];
      qaSave(user?.id, cache);
    }
    await hubFollows.follow(user.id, id);
    // Defer removal so QuickAddAvatarItem has a frame to render the
    // "Added" check state — yanking the item out of the list before
    // its internal `setState('added')` runs meant the success feedback
    // was never visible.
    setTimeout(() => {
      setQaList(prev => prev.filter(p => p.id !== id));
    }, 900);
    queryClient.invalidateQueries({ queryKey: ['hubFollowing'] });
    queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
  }, [user, queryClient]);

  if (!user) return null;

  // Show the Add button whenever uploads aren't in flight — the
  // previous `ownGroup?.stories.length > 0` gate hid the only entry
  // point for a brand-new user who hadn't posted yet, leaving them
  // with no way to add their first story from this strip.

  return (
    <>
      {/* Horizontal strip — single seamless scroll */}
      <div className="mb-4 -mx-4 md:-mx-6">
        <div className="flex items-end gap-2 px-4 md:px-6 overflow-x-auto pb-1 pt-1 scrollbar-hide">

          {/* Add Story — restored on a direct instruction: "it is imperative
              that you add that back" (Sean, 12 Aug).

              It was removed for a stated reason — a permanently rotating ring
              on the home screen, duplicating the "+" badge on the own avatar
              beside it. Two things resolve that rather than reinstating it:

              1. The "+" badge it duplicated was gated on `noStory`, so it
                 disappeared the moment you posted. Once you had one story
                 there was NO entry point in this strip for a second. This
                 control is unconditional, so it replaces that badge instead
                 of sitting next to it — one control, always present.
              2. The rotation honours prefers-reduced-motion. The objection to
                 "animating forever" is real for anyone who has asked the
                 system not to; for everyone else it is what marks the slot as
                 an action rather than a person.

              24s per revolution: slow enough to read as alive rather than
              busy, which is the whole reason it is a rotating dash ring and
              not a static dotted border. */}
          <button
            type="button"
            onClick={openStoryPicker}
            className="flex flex-col items-center gap-1 shrink-0 focus:outline-none"
            style={{ minWidth: 68 }}
            aria-label={tFallback('stories.add', 'Add a story')}
          >
            <span className="relative w-[60px] h-[60px] flex items-center justify-center">
              <svg
                viewBox="0 0 60 60"
                className="absolute inset-0 w-full h-full motion-safe:animate-[spin_24s_linear_infinite]"
                aria-hidden="true"
              >
                <circle
                  cx="30" cy="30" r="28"
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray="6 7"
                />
              </svg>
              <span className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
                <Plus className="w-5 h-5 text-primary stroke-[3]" />
              </span>
            </span>
            <span className="text-micro font-semibold text-muted-foreground max-w-[64px] truncate">
              {tFallback('stories.addShort', 'Your story')}
            </span>
          </button>


          {/* Crew story circles — shown before friend stories */}
          {crewStoryGroups.map(({ crew, stories }) => {
            const latest = stories[0];
            return (
              <motion.button
                key={crew.id}
                whileTap={{ scale: 0.90 }}
                onClick={() => setCrewStoryViewerOpen({ crew, stories, idx: 0 })}
                className="flex flex-col items-center gap-1 shrink-0 focus:outline-none"
                style={{ minWidth: 68 }}
              >
                {/* INTEGER 3px band, matching StoryAvatarButton. A
                    fractional 2.5px rounds to 2px on one side and 3px on
                    the other at device pixel ratios other than 2, which
                    is the uneven-ring bug the friend avatars already fixed. */}
                <div
                  className="w-[60px] h-[60px] rounded-full flex items-center justify-center p-[3px]"
                  style={{ background: 'linear-gradient(135deg, #FF6600 0%, #FFAA00 100%)' }}
                >
                  <div className="w-full h-full rounded-full overflow-hidden bg-background p-[2px]">
                    <div className="w-full h-full rounded-full overflow-hidden">
                      {latest?.image_url ? (
                        <img loading="lazy" src={latest.image_url}
                          className="w-full h-full object-cover"
                          alt=""
                          draggable={false}
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-full h-full rounded-full bg-secondary flex items-center justify-center">
                          <Shield className="w-5 h-5 text-primary" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-micro font-medium text-muted-foreground w-[68px] text-center truncate leading-tight">
                  {crew.name}
                </span>
              </motion.button>
            );
          })}

          {/* Slots 2+: Own avatar + friends with a story or a note */}
          {visibleGroups.map(group => (
            <StoryAvatarButton
              key={group.user_id}
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

              {visibleQaList.length > 0 ? (
                <>
                  {visibleQaList.map(profile => (
                    <QuickAddAvatarItem
                      key={profile.id}
                      profile={profile}
                      onAdd={handleQuickAdd}
                      onViewProfile={onViewProfile}
                    />
                  ))}
                </>
              ) : (
                /* All 6 added — show calm placeholder until noon refresh */
                <div className="self-center shrink-0 flex flex-col items-center justify-center px-3 py-2 max-w-[140px]">
                  <p className="text-micro text-muted-foreground/70 text-center leading-snug">
                    Check back at noon for more suggestions!
                  </p>
                  <button
                    onClick={() => setQaDismissed(true)}
                    className="mt-1.5 text-micro text-muted-foreground/50 underline underline-offset-2"
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
        {/* Hairline divider below the stories strip — separates the
            scrollable row from whatever sits beneath (greeting,
            leaderboard, feed). Screenshot feedback flagged the lack
            of a visual break between sections. Uses border instead of
            full-width hr so it tucks neatly inside the bleed edge. */}
        <div className="h-px bg-border/60 mx-4 md:mx-6 mt-2" />
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
            onConfirm={(overlayStyle, overlays) => uploadMutation.mutate({ file: preview.file, overlayStyle, overlays })}
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

      {/* Crew story lightbox */}
      <AnimatePresence>
        {crewStoryViewerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black flex items-center justify-center"
            onClick={() => setCrewStoryViewerOpen(null)}
          >
            <img loading="lazy" src={crewStoryViewerOpen.stories[crewStoryViewerOpen.idx]?.image_url}
              className="max-w-full max-h-full object-contain"
              alt=""
              draggable={false}
              onClick={e => e.stopPropagation()}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <div className="absolute top-4 start-0 end-0 px-4 flex items-center justify-between">
              <span className="text-white text-sm font-bold drop-shadow">{crewStoryViewerOpen.crew.name}</span>
              <button
                onClick={() => setCrewStoryViewerOpen(null)}
                className="w-9 h-9 rounded-full bg-black/60 flex items-center justify-center"
              >
                <Check className="w-0 h-0" />
                <span className="text-white text-lg leading-none">×</span>
              </button>
            </div>
            {crewStoryViewerOpen.stories.length > 1 && (
              <div className="absolute bottom-6 start-0 end-0 flex justify-center gap-2">
                {crewStoryViewerOpen.stories.map((s, i) => (
                  <button
                    key={s?.id ?? `dot-${i}`}
                    onClick={e => { e.stopPropagation(); setCrewStoryViewerOpen(p => ({ ...p, idx: i })); }}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === crewStoryViewerOpen.idx ? 'bg-white' : 'bg-white/40'}`}
                  />
                ))}
              </div>
            )}
          </motion.div>
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
