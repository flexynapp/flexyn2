// src/components/crews/CrewSettingsSheet.jsx
//
// The leader-only editor for the three crew columns a human is allowed to
// write: visibility, description and tag.
//
// It exists because nothing could set any of them. `updateCrewProfile` has
// accepted name/description/is_public/tag/avatar_url since migration 248 and
// the ONLY caller in the app was CrewChat's avatar upload — measured against
// production 2026-08-16: 4 crews, 0 with is_public, 0 with a description, 0
// with a tag, 1 with an avatar. So `crews.is_public` was a column the product
// could read and could not write, and migration 370 had to drop the discovery
// filter to stop the directory returning zero rows for all 56 users.
//
// Visibility copy is written from what join_crew_atomic actually DOES, read
// out of the installed function body rather than the migration:
//   is_public = TRUE            → member row inserted, capacity permitting
//   is_public not TRUE, no invite → crew_join_requests row, status 'requested'
//   a live unexpired invite      → skips the gate either way
// So "private" does NOT mean hidden — since 370 every crew is listed. It means
// applications. The copy says that, because a leader who believes private
// hides the crew has been told the wrong thing about their own privacy.
//
// The write boundary is the server's, verified by execution against production
// as three identities in rolled-back transactions:
//   leader (is_admin)      → is_public / description / tag persist;
//                            crew_xp, trophies, treasury_coins and
//                            max_capacity are silently reverted to OLD by the
//                            crews_guard_write trigger
//   member (is_admin=false) → 0 rows
//   non-member              → 0 rows
// `is_crew_admin` keys on is_admin, NOT on role, so this sheet gates on the
// same column the policy does rather than on the 'leader' string.

import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe2, Lock, Loader2, Check } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import CharCountIndicator from '@/components/ui/CharCountIndicator';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import * as crewsData from '@/lib/data/crews';
import { containsProfanity } from '@/lib/profanityFilter';
import { toast } from '@/lib/toast';

const DESC_MAX = 160;
const TAG_MAX  = 5;

// Uppercase, letters and digits only. A tag is a crest, not a sentence, and
// the directory renders it inline beside the name.
const normaliseTag = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, TAG_MAX);

function VisibilityOption({ active, icon, title, body, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={`w-full text-start flex items-start gap-2 p-3 rounded-2xl border transition-colors ${
        active ? 'border-primary bg-primary/10' : 'border-border'
      }`}
    >
      <span className={`shrink-0 mt-0.5 ${active ? 'text-primary' : 'text-muted-foreground'}`}>
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1">
          <span className="text-label font-bold">{title}</span>
          {active && <Check className="w-3.5 h-3.5 text-primary" aria-hidden="true" />}
        </span>
        <span className="block text-micro text-muted-foreground">{body}</span>
      </span>
    </button>
  );
}

export default function CrewSettingsSheet({ open, onClose, crew }) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [isPublic, setIsPublic] = useState(false);
  const [description, setDescription] = useState('');
  const [tag, setTag] = useState('');

  // Re-seed from the crew every time the sheet opens, so reopening after a
  // cancel shows what is stored rather than the abandoned edit.
  useEffect(() => {
    if (!open) return;
    setIsPublic(!!crew?.is_public);
    setDescription(crew?.description ?? '');
    setTag(crew?.tag ?? '');
  }, [open, crew?.is_public, crew?.description, crew?.tag]);

  // Description and tag are shown in the public directory to every signed-in
  // user, and the server profanity trigger covers `name` ONLY — read out of
  // enforce_crew_name_profanity, which returns early unless NEW.name changed.
  // Migration 372 extends it to these two columns; this check is the same
  // guard createCrew already applies to the name, kept so the refusal is a
  // sentence rather than a 23514.
  const descDirty = description !== (crew?.description ?? '');
  const tagDirty  = tag !== (crew?.tag ?? '');
  const badDesc   = descDirty && !!description.trim() && containsProfanity(description);
  const badTag    = tagDirty  && !!tag.trim()         && containsProfanity(tag);

  const dirty = descDirty || tagDirty || isPublic !== !!crew?.is_public;

  const save = useMutation({
    mutationFn: () => crewsData.updateCrewProfile(crew.id, {
      is_public:   isPublic,
      description: description.trim() || null,
      tag:         normaliseTag(tag) || null,
    }),
    onSuccess: () => {
      toast.success(tFallback('crewSettings.saved', 'Crew settings saved.'));
      qc.invalidateQueries({ queryKey: ['myCrews', user?.id] });
      qc.invalidateQueries({ queryKey: ['crewDirectory'] });
      onClose?.();
    },
    onError: (e) => {
      // 23514 is the server profanity trigger; anything else is a real failure.
      toast.error(e?.code === '23514'
        ? tFallback('crewSettings.blocked', 'That wording is not allowed. Try different words.')
        : tFallback('crewSettings.failed', 'Could not save your changes.'));
    },
  });

  const blocked = badDesc || badTag;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={tFallback('crewSettings.title', 'Crew settings')}
    >
      <div className="px-4 pb-6 flex flex-col gap-6">
        {/* ── Visibility ─────────────────────────────────────────── */}
        <div>
          <p className="text-label font-bold mb-2">
            {tFallback('crewSettings.visibility', 'Who can join')}
          </p>
          <div role="radiogroup" className="flex flex-col gap-2">
            <VisibilityOption
              active={isPublic}
              onClick={() => setIsPublic(true)}
              icon={<Globe2 className="w-4 h-4" aria-hidden="true" />}
              title={tFallback('crewSettings.public', 'Open')}
              body={tFallback('crewSettings.publicBody', 'Anyone can join straight away.')}
            />
            <VisibilityOption
              active={!isPublic}
              onClick={() => setIsPublic(false)}
              icon={<Lock className="w-4 h-4" aria-hidden="true" />}
              title={tFallback('crewSettings.private', 'By application')}
              body={tFallback('crewSettings.privateBody', 'People ask to join and you decide.')}
            />
          </div>
          {/* Said once, plainly. Since migration 370 the directory lists every
              crew, so a leader choosing "By application" must not be left
              believing it also hides them. */}
          <p className="text-micro text-muted-foreground mt-2">
            {tFallback(
              'crewSettings.listedEither',
              'Your crew is listed in the directory either way.',
            )}
          </p>
        </div>

        {/* ── Description ────────────────────────────────────────── */}
        <div>
          <label htmlFor="crew-desc" className="text-label font-bold block mb-2">
            {tFallback('crewSettings.description', 'Description')}
          </label>
          <textarea
            id="crew-desc"
            rows={3}
            value={description}
            maxLength={DESC_MAX}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tFallback('crewSettings.descriptionHint', 'What is this crew about?')}
            className={`w-full bg-secondary rounded-2xl px-4 py-3 text-label text-foreground placeholder:text-muted-foreground outline-none resize-none focus:ring-2 focus:ring-primary/30 ${
              badDesc ? 'ring-2 ring-destructive' : ''
            }`}
          />
          <div className="flex items-center justify-between mt-1">
            {badDesc
              ? <p className="text-micro text-destructive">
                  {tFallback('crewSettings.rewordDesc', 'Please reword this.')}
                </p>
              : <span />}
            <CharCountIndicator value={description} max={DESC_MAX} />
          </div>
        </div>

        {/* ── Tag ────────────────────────────────────────────────── */}
        <div>
          <label htmlFor="crew-tag" className="text-label font-bold block mb-2">
            {tFallback('crewSettings.tag', 'Tag')}
          </label>
          <input
            id="crew-tag"
            type="text"
            value={tag}
            inputMode="text"
            autoCapitalize="characters"
            onChange={(e) => setTag(normaliseTag(e.target.value))}
            placeholder={tFallback('crewSettings.tagHint', 'IRON')}
            className={`w-full bg-secondary rounded-2xl px-4 py-3 text-label font-bold tracking-widest text-foreground placeholder:text-muted-foreground placeholder:font-normal placeholder:tracking-normal outline-none focus:ring-2 focus:ring-primary/30 ${
              badTag ? 'ring-2 ring-destructive' : ''
            }`}
          />
          <p className={`text-micro mt-1 ${badTag ? 'text-destructive' : 'text-muted-foreground'}`}>
            {badTag
              ? tFallback('crewSettings.rewordTag', 'Please reword this.')
              : tFallback('crewSettings.tagRule', 'Up to 5 letters or numbers, shown beside your name.')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!dirty || blocked || save.isPending}
          className="w-full h-11 rounded-2xl bg-primary text-primary-foreground font-heading font-bold text-label flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {save.isPending
            ? tFallback('crewSettings.saving', 'Saving…')
            : tFallback('crewSettings.save', 'Save')}
        </button>
      </div>
    </BottomSheet>
  );
}
