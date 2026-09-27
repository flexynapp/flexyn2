// src/components/settings/PrivacySection.jsx
//
// Who can see you, who can reach you, and everyone you've cut off.
//
// The four cut-off lists — story blocks, full blocks, declined message
// requests, and mutes — used to be four separate top-level sections
// scattered down the panel, each with its own uppercase heading, three of
// them rendering only when non-empty. So the page's structure changed
// depending on how many people you'd blocked, and the four were never
// visibly related despite being one mental model. They are one group here.
//
// They are still four separate LISTS, though, and that is deliberate: a
// full block, a story block, a declined request and a mute mean very
// different things, and merging them would let someone believe they had
// fully blocked a person when they hadn't. The headings say which is
// which.

import { useState, useEffect } from 'react';
import {
  Lock, Globe, MessageCircle, ShieldOff, UserX, Swords,
  Ban, MailX, VolumeX, FileText, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/lib/LanguageContext';
import { handle } from '@/lib/userDisplay';
import { useAuthorsById } from '@/lib/data/useAuthors';
import { supabase } from '@/api/supabaseClient';
import { db } from '@/api/db';
import { toast } from '@/lib/toast';
import { setGymRivalOptOut } from '@/lib/data/gymRival';
import { updateStoryDmsSettings } from '@/lib/data/stories';
import { getStoryBlocks, blockUser, unblockUser, updateDefaultStoryPrivacy } from '@/lib/data/storyPrivacy';
import { listMyReports } from '@/lib/data/hubReports';
import * as userBlocksData from '@/lib/data/userBlocks';
import * as dmRequestBlocksData from '@/lib/data/dmRequestBlocks';
import * as userMutesData from '@/lib/data/userMutes';
import { useSettingsProfile } from './useSettingsProfile';
import { Group, Row, ToggleRow, Switch, SegmentedControl } from './SettingsPrimitives';
import { ANALYTICS_CONFIGURED, isAnalyticsOptedOut, setAnalyticsOptOut } from '@/lib/analytics';

// A blocked / muted row identifies an account WITHOUT its address.
//
// The username is snapshotted at block time (migration 314) rather than
// joined live, because this list has to name someone the viewer has cut
// off, from a settings screen that loads no feed. Driving it on a device
// with a real block is what settled it: the live path resolved nothing and
// every row read "an account".
//
// The live record still wins when it is there, so a rename shows through;
// the snapshot is the floor, not the answer. Neither falls back to the
// address — a row with no name is "an account", which is the whole point.
function blockedLabel(byId, id, snapshotUsername) {
  const live = id ? byId[id] : null;
  if (live) return handle(live);
  if (snapshotUsername) return `@${snapshotUsername}`;
  return 'an account';
}

// One list shape for all four cut-off lists. They differ only in icon,
// heading, and what the undo button says.
function PeopleList({ icon: Icon, title, description, rows, keyOf, labelOf, actionLabel, onAction }) {
  if (!rows.length) return null;
  return (
    <div className="py-2">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      </div>
      {description && <p className="text-caption text-muted-foreground leading-snug mb-2">{description}</p>}
      <ul className="space-y-2">
        {rows.map(r => (
          <li key={keyOf(r)} className="flex items-center justify-between gap-2 min-h-11">
            <span className="text-body text-foreground truncate">{labelOf(r)}</span>
            <button
              type="button"
              onClick={() => onAction(keyOf(r))}
              className="min-h-11 px-3 shrink-0 rounded-lg text-micro font-bold uppercase tracking-wide border border-border hover:bg-secondary active:bg-secondary"
            >
              {actionLabel}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PrivacySection() {
  const { tFallback } = useLanguage();
  const { user, profile, queryClient, invalidateProfile } = useSettingsProfile();
  // Resolves blocked_id / muted_id to a live @username.
  const authorsById = useAuthorsById();

  const [storyDmsDisabled, setStoryDmsDisabled] = useState(false);
  const [defaultPrivacy,   setDefaultPrivacy]   = useState('friends');
  const [storyBlocksOpen,  setStoryBlocksOpen]  = useState(false);
  const [storyBlocks,      setStoryBlocks]      = useState([]);
  const [blockEmail,       setBlockEmail]       = useState('');
  const [blockSaving,      setBlockSaving]      = useState(false);
  const analyticsAvailable = ANALYTICS_CONFIGURED;
  const [analyticsOn,      setAnalyticsOn]      = useState(() => !isAnalyticsOptedOut());

  // Reporter-facing report history — closes the loop that started in
  // ReportDialog.jsx. Status updates also fire a notification (mig 104);
  // this is the persistent surface they can come back to.
  const { data: myReports = [] } = useQuery({
    queryKey: ['myReports', user?.id],
    queryFn: () => listMyReports({ limit: 10 }),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  // Full-block + mute lists.
  const { data: myBlocks = [] } = useQuery({
    queryKey: ['userBlocks', user?.id],
    queryFn: () => userBlocksData.listBlocks(user.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });
  const { data: myMutes = [] } = useQuery({
    queryKey: ['userMutes', user?.id],
    queryFn: () => userMutesData.listMutes(user.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  // The QUIET blocks (mig 234). Deleting someone's message request records
  // a pair so they can't immediately open a fresh one. Kept deliberately
  // separate from the full block_user_full list above — they mean very
  // different things and conflating them would let someone think they'd
  // fully blocked a person when they hadn't.
  const { data: myRequestBlocks = [] } = useQuery({
    queryKey: ['dmRequestBlocks', user?.id],
    queryFn: () => dmRequestBlocksData.listMyRequestBlocks(),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (profile?.story_dms_disabled !== undefined) {
      setStoryDmsDisabled(!!profile.story_dms_disabled);
    }
    if (profile?.default_story_privacy) {
      setDefaultPrivacy(profile.default_story_privacy);
    }
  }, [profile?.story_dms_disabled, profile?.default_story_privacy]);

  // ── Privacy mode (mig 117) ──────────────────────────────────────────
  // is_private hides the profile content from non-followers.
  // hide_from_search removes the account from user-search + PYMK.
  const [isPrivate, setIsPrivate] = useState(false);
  const [hideFromSearch, setHideFromSearch] = useState(false);
  useEffect(() => {
    if (profile?.is_private !== undefined) setIsPrivate(!!profile.is_private);
    if (profile?.hide_from_search !== undefined) setHideFromSearch(!!profile.hide_from_search);
  }, [profile?.is_private, profile?.hide_from_search]);

  // ── Read receipts (mig 238) ─────────────────────────────────────────
  // Opt-OUT: default true, so an absent column (pre-238 host) or a
  // still-loading profile behaves exactly as it did before. Turning it
  // off stops mark_message_read writing read_at at all — the icon isn't
  // merely hidden, the data is never recorded.
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(true);
  useEffect(() => {
    if (profile?.read_receipts_enabled !== undefined) {
      setReadReceiptsEnabled(profile.read_receipts_enabled !== false);
    }
  }, [profile?.read_receipts_enabled]);

  // ── Gym Rival opt-out ───────────────────────────────────────────────
  // The backend honors nemesis_opt_out (gym_rival_roll filters it — DB
  // column still named nemesis_opt_out pending the rename migration).
  const [gymRivalOptOut, setGymRivalOptOutLocal] = useState(false);
  useEffect(() => {
    if (profile?.nemesis_opt_out !== undefined) setGymRivalOptOutLocal(!!profile.nemesis_opt_out);
  }, [profile?.nemesis_opt_out]);

  const toggleGymRivalOptOut = async (next) => {
    setGymRivalOptOutLocal(next); // optimistic
    try {
      await setGymRivalOptOut(next);
      // Same stale-cache problem as togglePrivacy below: the invalidation
      // refetches through db.auth.me(), which returns its module-level cache
      // unchanged. Patched here rather than inside gymRival.js so that data
      // module doesn't have to import @/api/db and its auth side effect.
      db.auth.patchCache({ nemesis_opt_out: next });
      invalidateProfile();
    } catch {
      setGymRivalOptOutLocal(!next); // revert
      toast.error(tFallback('settings.gymRival.saveFailed', 'Could not save. Try again.'));
    }
  };

  const togglePrivacy = async (column, next) => {
    const slots = {
      is_private:            [setIsPrivate,           isPrivate],
      hide_from_search:      [setHideFromSearch,      hideFromSearch],
      read_receipts_enabled: [setReadReceiptsEnabled, readReceiptsEnabled],
    };
    const [setLocal, prev] = slots[column] || [];
    if (!setLocal) return;
    setLocal(next); // optimistic
    try {
      const { error } = await supabase.from('user_profiles').update({ [column]: next }).eq('id', user.id);
      if (error) throw error;
      // db.auth.me() serves a module-level cache and only re-reads the row
      // when that cache is empty, so the invalidation below refetches and is
      // handed the SAME stale object back. Without this patch the flag looked
      // like it saved — the switch flips optimistically — but the effect that
      // syncs local state from `profile` then read the old value back, so
      // closing and reopening Settings reverted the toggle. patchCache is the
      // contract for writers that use a raw update instead of db.auth.updateMe.
      db.auth.patchCache({ [column]: next });
      // Invalidate every query whose visibility is gated on this profile
      // flag — without this, other-profile views and the hub feed stay
      // stale until their staleTime expires (up to 5m). (Audit 14 #10.)
      invalidateProfile();
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      queryClient.invalidateQueries({ queryKey: ['hubProfilePosts'] });
      queryClient.invalidateQueries({ queryKey: ['profileStories'] });
      queryClient.invalidateQueries({ queryKey: ['hubProfile'] });
      queryClient.invalidateQueries({ queryKey: ['hubSearch'] });
    } catch {
      setLocal(prev);
      toast.error(tFallback('privacy.updateFailed', 'Could not update privacy. Try again.'));
    }
  };

  const loadStoryBlocks = async () => {
    if (!user?.id) return;
    const blocks = await getStoryBlocks(user.id);
    setStoryBlocks(blocks);
  };

  const handleBlockAdd = async () => {
    const email = blockEmail.trim().toLowerCase();
    if (!email || !user) return;
    // Reject malformed emails up-front so users don't see a fake
    // "Blocked asdf@asdf" toast for an entry that won't actually
    // protect them. Also reject self-blocking — blocking yourself
    // breaks story visibility queries in confusing ways. (Audit 14 #4.)
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_RE.test(email)) {
      toast.error(tFallback('settings.block.invalidEmail', 'Enter a valid email address.'));
      return;
    }
    if (email === (user?.email || '').toLowerCase()) {
      toast.error(tFallback('settings.block.selfBlock', "You can't block your own email."));
      return;
    }
    setBlockSaving(true);
    const ok = await blockUser(user, email);
    setBlockSaving(false);
    if (ok) {
      setBlockEmail('');
      await loadStoryBlocks();
      queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
      toast.success(tFallback('settings.block.addedPlain', 'Blocked.'));
    } else {
      toast.error(tFallback('settings.block.addFailed', 'Could not add block. Try again.'));
    }
  };

  const handleUnblock = async (email) => {
    if (!user?.id) return;
    const ok = await unblockUser(user.id, email);
    if (ok) {
      setStoryBlocks(prev => prev.filter(b => b.blocked_email !== email));
      queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
      toast.success(tFallback('settings.block.removedPlain', 'Unblocked.'));
    } else {
      toast.error(tFallback('settings.block.removeFailed', 'Could not remove block.'));
    }
  };

  const handleUnblockFull = async (email) => {
    try {
      await userBlocksData.unblockUserFull(email);
      queryClient.invalidateQueries({ queryKey: ['userBlocks', user.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      // No address in the toast — the list below it updates, which is the
      // confirmation that matters, and it does not put someone's email on
      // screen to say so.
      toast.success(tFallback('settings.block.removedPlain', 'Unblocked.'));
    } catch (err) {
      toast.error(`Could not unblock: ${err.message || 'try again'}`);
    }
  };

  const handleUnmute = async (email) => {
    try {
      await userMutesData.unmuteUser(user.id, email);
      queryClient.invalidateQueries({ queryKey: ['userMutes', user.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      toast.success(tFallback('settings.mute.removedPlain', 'Unmuted.'));
    } catch (err) {
      toast.error(`Could not unmute: ${err.message || 'try again'}`);
    }
  };

  const handleAllowRequestsAgain = async (email) => {
    try {
      await dmRequestBlocksData.removeRequestBlock(email);
      queryClient.invalidateQueries({ queryKey: ['dmRequestBlocks', user.id] });
      toast.success(tFallback(
        'settings.requestBlock.removed',
        'They can send you a message request again.'
      ));
    } catch (err) {
      toast.error(`Could not update: ${err.message || 'try again'}`);
    }
  };

  const hasCutOffAnyone =
    myBlocks.length > 0 || myRequestBlocks.length > 0 || myMutes.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Privacy mode toggles (mig 117). Optimistic + reverting on
          failure; both flags persist to user_profiles so the choice
          follows the user across devices. */}
      <Group title={tFallback('settings.group.visibility', 'Visibility')}>
        <ToggleRow
          label={tFallback('settings.privateProfile.title', 'Private profile')}
          hint={tFallback('settings.privateProfile.desc', 'Only followers see your level, workouts, and progress photos.')}
          checked={isPrivate}
          onChange={(next) => togglePrivacy('is_private', next)}
        />
        <ToggleRow
          label={tFallback('settings.hideFromSearch.title', 'Hide from search')}
          hint={tFallback('settings.hideFromSearch.desc', 'Your account won\'t appear in search results or "People you may know."')}
          checked={hideFromSearch}
          onChange={(next) => togglePrivacy('hide_from_search', next)}
        />
        <ToggleRow
          label={tFallback('settings.readReceipts.title', 'Read receipts')}
          hint={tFallback(
            'settings.readReceipts.desc',
            'Let people see when you’ve read their message. If you turn this off, you won’t see when others have read your messages either. Delivery ticks still work both ways.'
          )}
          checked={readReceiptsEnabled}
          onChange={(next) => togglePrivacy('read_receipts_enabled', next)}
        />
        <ToggleRow
          icon={Swords}
          label={tFallback('settings.gymRival.title', 'Opt out of Gym Rival')}
          hint={tFallback('settings.gymRival.desc', 'Stop being matched with a weekly Gym Rival to compete against.')}
          checked={gymRivalOptOut}
          onChange={toggleGymRivalOptOut}
        />
        {/* Per device, not per account: it has to work before sign-in and
            on a shared device, and it is read synchronously on every event.
            Hidden on builds with no analytics key, where it would do nothing. */}
        {analyticsAvailable && (
          <ToggleRow
            label={tFallback('settings.analytics.title', 'Share usage analytics')}
            hint={tFallback('settings.analytics.desc', 'Tells us which features you use, never your health numbers or messages, so we can improve Flexyn. Applies on this device.')}
            checked={analyticsOn}
            onChange={(next) => {
              setAnalyticsOptOut(!next);
              setAnalyticsOn(!isAnalyticsOptedOut());
            }}
          />
        )}
      </Group>

      <Group title={tFallback('settings.group.stories', 'Stories')}>
        <Row
          icon={MessageCircle}
          labelId="settings-story-dms-label"
          label={tFallback('settings.story.dmRepliesLabel', 'Allow DM replies to my stories')}
        >
          <Switch
            checked={!storyDmsDisabled}
            labelledBy="settings-story-dms-label"
            onChange={async () => {
              const next = !storyDmsDisabled;
              setStoryDmsDisabled(next);
              await updateStoryDmsSettings(user?.id, next);
              queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
            }}
          />
        </Row>

        <div className="py-2">
          <Row
            icon={defaultPrivacy === 'friends' ? Lock : Globe}
            label={tFallback('settings.story.defaultVisibility', 'Default story visibility')}
          />
          <SegmentedControl
            value={defaultPrivacy}
            ariaLabel={tFallback('settings.story.defaultVisibility', 'Default story visibility')}
            onChange={async (value) => {
              setDefaultPrivacy(value);
              await updateDefaultStoryPrivacy(user?.id, value);
              invalidateProfile();
            }}
            options={[
              { value: 'friends', label: tFallback('settings.story.friendsOnly', 'Friends'), icon: Lock },
              { value: 'public',  label: tFallback('settings.story.public',      'Public'),  icon: Globe },
            ]}
          />
        </div>

        {/* Story-only block list. Collapsed by default — it carries an
            email input, and an always-open text field in a list of
            toggles reads as the page's primary action when it isn't. */}
        <div className="py-2">
          <button
            type="button"
            onClick={() => {
              setStoryBlocksOpen(v => !v);
              if (!storyBlocksOpen) loadStoryBlocks();
            }}
            aria-expanded={storyBlocksOpen}
            className="w-full min-h-11 flex items-center gap-2 text-start rounded-lg hover:bg-secondary/50 active:bg-secondary/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ShieldOff className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="flex-1 text-body text-foreground">
              {tFallback('settings.story.blockedAccounts', 'Blocked from my stories')}
            </span>
            {storyBlocksOpen
              ? <ChevronUp   className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />}
          </button>

          {storyBlocksOpen && (
            <div className="mt-2 space-y-2">
              <div className="flex gap-2">
                <input
                  type="email"
                  value={blockEmail}
                  onChange={e => setBlockEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleBlockAdd()}
                  placeholder={tFallback('settings.block.placeholder', 'Email to block…')}
                  aria-label={tFallback('settings.block.placeholder', 'Email to block…')}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-h-11 rounded-lg border border-border bg-secondary/50 px-2 text-body text-foreground placeholder-muted-foreground/60 focus:outline-none focus:border-primary/50"
                />
                <button
                  type="button"
                  onClick={handleBlockAdd}
                  disabled={!blockEmail.trim() || blockSaving}
                  className="min-h-11 px-3 shrink-0 rounded-lg bg-primary text-primary-foreground text-body font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {blockSaving
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : tFallback('settings.block.action', 'Block')}
                </button>
              </div>

              {storyBlocks.length === 0 ? (
                <p className="text-caption text-muted-foreground">
                  {tFallback('settings.block.empty', 'No accounts blocked.')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {storyBlocks.map(b => (
                    <li key={b.blocked_email} className="flex items-center justify-between gap-2 min-h-11">
                      <span className="flex items-center gap-2 min-w-0">
                        <UserX className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        <span className="text-body text-foreground truncate">
                          {blockedLabel(authorsById, b.blocked_id, b.blocked_username)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUnblock(b.blocked_email)}
                        className="min-h-11 px-3 shrink-0 rounded-lg text-micro font-bold uppercase tracking-wide border border-border hover:bg-secondary active:bg-secondary"
                      >
                        {tFallback('settings.block.undo', 'Unblock')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Group>

      {/* The four cut-off lists, finally adjacent. Each renders only when
          non-empty, and the whole group hides when all three server-backed
          ones are — an empty "Blocked & muted" heading is worse than no
          heading, because it implies a list failed to load. */}
      {hasCutOffAnyone && (
        <Group title={tFallback('settings.group.blocked', 'Blocked & muted')}>
          <PeopleList
            icon={Ban}
            title={tFallback('settings.blockedUsers.title', 'Blocked users')}
            rows={myBlocks}
            keyOf={b => b.blocked_email}
            labelOf={b => blockedLabel(authorsById, b.blocked_id, b.blocked_username)}
            actionLabel={tFallback('settings.block.undo', 'Unblock')}
            onAction={handleUnblockFull}
          />
          <PeopleList
            icon={MailX}
            title={tFallback('settings.requestBlock.title', 'Declined message requests')}
            description={tFallback(
              'settings.requestBlock.desc',
              'You deleted a message request from these accounts, so they can’t send you a new one. They are not blocked otherwise. Following them or messaging them first clears this too.'
            )}
            rows={myRequestBlocks}
            keyOf={b => b.blocked_email}
            labelOf={b => blockedLabel(authorsById, b.blocked_id, b.blocked_username)}
            actionLabel={tFallback('settings.requestBlock.allow', 'Allow requests')}
            onAction={handleAllowRequestsAgain}
          />
          <PeopleList
            icon={VolumeX}
            title={tFallback('settings.mutedUsers.title', 'Muted users')}
            rows={myMutes}
            keyOf={m => m.muted_email}
            labelOf={m => blockedLabel(authorsById, m.muted_id, m.muted_username)}
            actionLabel={tFallback('settings.mute.undo', 'Unmute')}
            onAction={handleUnmute}
          />
        </Group>
      )}

      {myReports.length > 0 && (
        <Group title={tFallback('settings.myReports.title', 'My reports')}>
          <div className="py-2">
            <ul className="space-y-2">
              {myReports.map(r => (
                <li key={r.id} className="flex items-center justify-between gap-2 min-h-11">
                  <span className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                    <span className="text-body text-foreground capitalize truncate">
                      {r.reported_type} · {r.reason.replace('_', ' ')}
                    </span>
                  </span>
                  <span className={`text-micro font-bold uppercase tracking-wide px-2 py-1 rounded-lg shrink-0 ${
                    r.status === 'pending'    ? 'bg-amber-500/15 text-amber-500'
                    : r.status === 'actioned' ? 'bg-emerald-500/15 text-emerald-500'
                    : r.status === 'reviewed' ? 'bg-blue-500/15 text-blue-500'
                    : 'bg-secondary text-muted-foreground'
                  }`}>
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Group>
      )}
    </div>
  );
}
