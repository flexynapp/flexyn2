// src/components/crews/CrewTrophiesPanel.jsx
//
// The Trophies tab — migration 367, and the Penpot page "Crew Trophies"
// (boards A empty shelf, B a chase in progress, C shelf with trophies
// earned, D the leader's picker, E the same list for a member, F spec).
//
// Two sections, always in this order: the chase, then the shelf.
//
// THE ONE COMPOSITION RULE THAT IS NOT OBVIOUS FROM THE MARKUP: the chase
// is the dominant element while it is the only thing on the page, and
// SHRINKS to a single status line once the shelf carries weight. A crew
// with two trophies and a chase at 63% is a crew whose subject is the
// collection; a crew with no trophies has nothing to look at but the
// chase. Boards B and C are the same component at those two sizes, not
// two components.
//
// The empty shelf renders the LADDER rather than a zero. An empty state
// with nothing to look at is a dead screen, and the whole point of a
// level-gated catalog is that a crew can see what it is climbing toward.
// Same reasoning as `get_crew_challenge_catalog` returning locked rows.
//
// Built to the sibling idiom (CrewWarsMenu, CrewLeaguePanel): metrics are
// text taking hierarchy from weight and colour, separation is a hairline
// and whitespace rather than a card per row, counts go through
// useNumberFormatter, and one control is primary.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Loader2, Check, Lock } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter, useDateFormatter } from '@/lib/intl';
import { toast } from '@/lib/toast';
import {
  getCrewChallengeCatalog,
  startGenerationalChallenge,
  getChallengeContributions,
} from '@/lib/data/crewChallenges';
import { getCrewTrophies } from '@/lib/data/crewTrophies';
import { RANK } from '@/lib/crewPermissions';

/**
 * A trophy's mark is a two-letter monogram, not an icon.
 *
 * The crew avatar already uses exactly this mark, so the shelf needed no
 * new iconography invented for it — which is the difference between a
 * page that belongs to this app and one that looks generated. Derived
 * from the title so a trophy added to the catalog later needs no asset.
 */
export function monogram(title) {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * A challenge's NAME, translated.
 *
 * `title` arrives from crew_challenge_templates, so without this the four
 * challenge names are English in every locale and no translator can ever
 * see them — the orphan-key defect in a second shape, and one only
 * rendering the panel in French made visible. The DB stays the authority
 * for the NUMBERS; the client owns the WORDS. A template added later with
 * no key falls back to the server's title, which is the honest default.
 *
 * Trophy names (Millionaires, Centurions, Unbroken, Ascendant) are
 * deliberately NOT run through this. They are product names in the same
 * class as Crew, Hub, Coach and Capsule, which _glossary.json already
 * keeps in English — a trophy the crew keeps forever reads better as one
 * fixed name than as four.
 */
function challengeName(row, tFallback) {
  return tFallback(`crewChallenge.${row.template_key}`, row.title);
}

/** "1,000,000 lb" / "100 sessions" — the target in its own units. */
function targetLabel(metric, value, fmt, tFallback) {
  const n = fmt(value || 0);
  switch (metric) {
    case 'total_volume':   return tFallback('crewTrophies.unit.volume',   '{n} lb', { n });
    case 'total_sessions': return tFallback('crewTrophies.unit.sessions', '{n} sessions', { n });
    case 'days_active':    return tFallback('crewTrophies.unit.days',     '{n} training days', { n });
    case 'total_xp':       return tFallback('crewTrophies.unit.xp',       '{n} XP', { n });
    default:               return n;
  }
}

// ── A catalog row ─────────────────────────────────────────────────────
//
// One row shape for every state, because they are the same object at
// different stages. `onStart` present means the row is actionable; the
// caller decides that, so a member never renders a disabled button they
// then have to work out the meaning of.
function CatalogRow({ row, fmt, tFallback, onStart, starting, last }) {
  const dim   = row.state !== 'available';
  // FOUR HUES, and no fifth. index.css is explicit that the app gets
  // primary / success / info / destructive and that amber and gold route
  // into --primary ("the hero CTA gold IS this hue"). The Penpot board
  // drew trophies in #FFD700, which is exactly the amber that rule
  // forbids; the design was wrong and the token wins. It also reads
  // better: --success means "earned / complete", which is what a trophy
  // in hand is, and --primary means effort underway, which is what an
  // unstarted challenge is.
  const tone  = row.state === 'earned' ? 'text-success'
              : row.state === 'locked' ? 'text-muted-foreground'
              : 'text-primary';

  return (
    <div className={`flex items-center gap-2 py-2.5 ${last ? '' : 'border-b border-border/60'}`}>
      <div
        className={`w-11 h-11 rounded-2xl shrink-0 flex items-center justify-center ${
          row.state === 'earned' ? 'bg-success/15' : dim ? 'bg-muted-foreground/10' : 'bg-primary/10'
        }`}
        aria-hidden="true"
      >
        <span className={`font-heading font-bold text-caption ${tone}`}>
          {monogram(row.trophy_title)}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-label font-bold truncate ${dim ? 'text-muted-foreground' : ''}`}>
          {challengeName(row, tFallback)}
        </p>
        <p className="text-micro text-muted-foreground truncate">
          {targetLabel(row.metric, row.target_value, fmt, tFallback)}
        </p>
        <p className={`text-micro font-semibold truncate ${dim ? 'text-muted-foreground' : 'text-primary'}`}>
          {tFallback('crewTrophies.pays', 'Pays {trophy}', { trophy: row.trophy_title })}
        </p>
      </div>

      {row.state === 'earned' && (
        <span className="inline-flex items-center gap-1 text-micro font-bold text-success shrink-0">
          <Check className="w-3 h-3" aria-hidden="true" />
          {tFallback('crewTrophies.won', 'Won')}
        </span>
      )}

      {row.state === 'locked' && (
        <span className="inline-flex items-center gap-1 text-micro font-bold text-muted-foreground shrink-0">
          <Lock className="w-3 h-3" aria-hidden="true" />
          {tFallback('crewTrophies.levelN', 'Lv. {n}', { n: row.min_crew_level })}
        </span>
      )}

      {row.state === 'available' && onStart && (
        <button
          type="button"
          onClick={() => onStart(row)}
          disabled={!!starting}
          className="shrink-0 h-9 px-4 rounded-xl bg-primary text-primary-foreground font-heading font-bold text-caption disabled:opacity-50"
        >
          {starting === row.template_key
            ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            : tFallback('crewTrophies.start', 'Start')}
        </button>
      )}
    </div>
  );
}

// ── Who is carrying the chase ─────────────────────────────────────────
function Contributions({ challengeId, fmt, tFallback }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['crewChallengeContrib', challengeId],
    queryFn:  () => getChallengeContributions(challengeId),
    enabled:  !!challengeId,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 py-2 text-micro text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        {tFallback('challenge.loadingContrib', 'Loading contributions…')}
      </div>
    );
  }
  if (rows.length === 0) return null;

  // Zero-value members are KEPT. On a board about who is carrying a crew
  // goal, an absent member is information, and dropping them makes a
  // five-person crew look like a three-person one.
  const sorted = [...rows].sort((a, b) => (b.value || 0) - (a.value || 0));

  return (
    <>
      <p className="text-micro font-bold text-muted-foreground tracking-wide mt-6">
        {tFallback('crewTrophies.carrying', "WHO'S CARRYING IT")}
      </p>
      <div className="mt-2">
        {sorted.map((m, i) => (
          <div
            key={m.user_id}
            className={`flex items-center gap-2 py-1.5 ${i === sorted.length - 1 ? '' : 'border-b border-border/60'}`}
          >
            <span className="text-micro tabular-nums text-muted-foreground w-4 shrink-0">{i + 1}</span>
            <span className="flex-1 min-w-0 truncate text-label">
              {m.username || m.full_name || tFallback('crewWars.member', 'Member')}
            </span>
            <span
              className={`font-heading font-bold text-label tabular-nums shrink-0 ${
                (m.value || 0) === 0 ? 'text-muted-foreground' : ''
              }`}
            >
              {fmt(m.value || 0)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-micro text-muted-foreground mt-2 leading-relaxed">
        {tFallback(
          'crewTrophies.capNote',
          'One member can bank at most 60% of a crew goal, so a challenge cannot be soloed. Work only counts from the day you joined.',
        )}
      </p>
    </>
  );
}

export default function CrewTrophiesPanel({ crewId, myRank }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const formatDate = useDateFormatter();
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [starting, setStarting] = useState(null);

  const isLeader = myRank === RANK.LEADER;

  const { data: catalog = [], isLoading: catLoading } = useQuery({
    queryKey: ['crewChallengeCatalog', crewId],
    queryFn:  () => getCrewChallengeCatalog(crewId),
    enabled:  !!crewId,
    staleTime: 60_000,
  });

  const { data: trophies = [], isLoading: trLoading } = useQuery({
    queryKey: ['crewTrophies', crewId],
    queryFn:  () => getCrewTrophies(crewId),
    enabled:  !!crewId,
    staleTime: 5 * 60_000,
  });

  const active    = catalog.find(r => r.state === 'active') || null;
  const remaining = catalog.filter(r => r.state === 'available' || r.state === 'locked');

  const start = async (row) => {
    setStarting(row.template_key);
    const res = await startGenerationalChallenge(crewId, row.template_key);
    setStarting(null);
    if (res.ok) {
      setPickerOpen(false);
      toast.success(tFallback('crewTrophies.started', 'The crew is chasing {name}.', { name: challengeName(row, tFallback) }));
      qc.invalidateQueries({ queryKey: ['crewChallengeCatalog', crewId] });
    } else if (res.reason === 'not_allowed') {
      toast.error(tFallback('crewTrophies.notLeader', 'Only a crew leader can start a challenge.'));
    } else if (res.reason === 'already_chasing') {
      toast.error(tFallback('crewTrophies.alreadyChasing', 'This crew is already chasing a challenge.'));
      qc.invalidateQueries({ queryKey: ['crewChallengeCatalog', crewId] });
    } else {
      toast.error(tFallback('crewTrophies.startFailed', 'Could not start that challenge.'));
    }
  };

  if (catLoading || trLoading) {
    return (
      <div className="flex items-center justify-center py-14">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  // Once the shelf carries weight the chase stops being the subject of the
  // page and becomes one line of status. See the header.
  const compact = trophies.length > 0;

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      aria-label={tFallback('crewTrophies.aria', 'Crew trophies')}
    >
      {/* ── The chase ──────────────────────────────────────────────── */}
      <p className="text-micro font-bold text-muted-foreground tracking-wide">
        {tFallback('crewTrophies.chase', 'THE CHASE')}
      </p>

      {active ? (
        <>
          <div className="flex items-center gap-2 mt-2">
            <div
              className={`${compact ? 'w-9 h-9 rounded-xl' : 'w-11 h-11 rounded-2xl'} bg-primary/15 shrink-0 flex items-center justify-center`}
              aria-hidden="true"
            >
              <span className={`font-heading font-bold text-primary ${compact ? 'text-micro' : 'text-caption'}`}>
                {monogram(active.trophy_title)}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-bold truncate ${compact ? 'text-label' : 'font-heading text-title'}`}>
                {challengeName(active, tFallback)}
              </p>
              <p className="text-micro text-muted-foreground truncate">
                {tFallback('crewTrophies.pays', 'Pays {trophy}', { trophy: active.trophy_title })}
              </p>
            </div>
            <span className="font-heading font-bold text-title text-primary tabular-nums shrink-0">
              {Math.round(((active.current_value || 0) / Math.max(active.target_value, 1)) * 100)}%
            </span>
          </div>

          {/* Full size only: the number leads and the bar supports it. */}
          {!compact && (
            <p className="font-heading font-bold text-display tabular-nums leading-none mt-6">
              {fmt(active.current_value || 0)}
            </p>
          )}
          <p className="text-caption text-muted-foreground mt-1">
            {tFallback('crewTrophies.ofTarget', 'of {target}', {
              target: targetLabel(active.metric, active.target_value, fmt, tFallback),
            })}
          </p>

          <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-2">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: 0 }}
              animate={{
                width: `${Math.min(100, Math.round(((active.current_value || 0) / Math.max(active.target_value, 1)) * 100))}%`,
              }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
          <p className="text-micro text-muted-foreground mt-2">
            {tFallback('crewTrophies.noDeadline', 'No deadline. A generational goal runs until the crew finishes it.')}
          </p>

          {!compact && <Contributions challengeId={active.challenge_id} fmt={fmt} tFallback={tFallback} />}
        </>
      ) : (
        <div className="flex items-center gap-2 mt-2">
          <div className="w-11 h-11 rounded-2xl bg-muted-foreground/10 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-label font-bold">
              {tFallback('crewTrophies.nothingChased', 'Nothing being chased')}
            </p>
            <p className="text-micro text-muted-foreground leading-relaxed">
              {isLeader
                ? tFallback('crewTrophies.leaderPicks', 'Pick what the crew goes after next.')
                : tFallback('crewTrophies.memberWaits', 'Your leader picks what the crew goes after next.')}
            </p>
          </div>
        </div>
      )}

      {/* One primary control, and only the leader gets it. A member never
          sees a disabled button they then have to decode.

          Nothing mid-chase (kegan, 2026-08-16). A read-only picker was
          tried and removed: the tab already lists every remaining
          challenge inline under STILL OUT THERE, so a second route to the
          same rows is a tap that buys nothing. `remaining` is what a
          leader browses; the sheet is only ever for choosing. */}
      {isLeader && !active && remaining.length > 0 && (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full h-12 mt-6 rounded-2xl bg-primary text-primary-foreground font-heading font-bold text-body"
        >
          {tFallback('crewTrophies.choose', 'Choose a challenge')}
        </button>
      )}

      <div className="h-px bg-border mt-6" />

      {/* ── The shelf ──────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between mt-6">
        <p className="text-micro font-bold text-muted-foreground tracking-wide">
          {tFallback('crewTrophies.shelf', 'TROPHY SHELF')}
        </p>
        {trophies.length > 0 && (
          <span className="font-heading font-bold text-micro text-success tabular-nums">
            {fmt(trophies.length)}
          </span>
        )}
      </div>

      {trophies.length === 0 ? (
        <p className="text-caption text-muted-foreground mt-2 leading-relaxed">
          {tFallback(
            'crewTrophies.shelfEmpty',
            'No trophies yet. Finish a crew challenge and its trophy lands here. Each one is unique and the crew keeps it.',
          )}
        </p>
      ) : (
        <div className="mt-2">
          {trophies.map((t, i) => (
            <div
              key={t.trophy_id}
              className={`flex items-center gap-2 py-2.5 ${i === trophies.length - 1 ? '' : 'border-b border-border/60'}`}
            >
              <div
                className="w-11 h-11 rounded-2xl bg-success/15 shrink-0 flex items-center justify-center"
                aria-hidden="true"
              >
                <span className="font-heading font-bold text-caption text-success">{monogram(t.title)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-label font-bold truncate">{t.title}</p>
                {/* The challenge this came from, and ONLY if we can still
                    name it. `get_crew_challenge_catalog` filters on
                    is_active, so a template retired after somebody won it
                    is absent here — an unguarded <p> then renders an empty
                    line that still takes its height, and the row reads as
                    broken. Caught by rendering it, not by a test. */}
                {(() => {
                  const src = catalog.find(c => c.trophy_id === t.trophy_id);
                  return src
                    ? <p className="text-micro text-muted-foreground truncate">{challengeName(src, tFallback)}</p>
                    : null;
                })()}
              </div>
              {/* Intl.DateTimeFormat, never date-fns format() — that binds
                  no locale and would read English under a Spanish screen. */}
              <span className="text-micro text-muted-foreground shrink-0">
                {t.earned_at ? formatDate(new Date(t.earned_at), { day: 'numeric', month: 'short' }) : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── What is still out there ────────────────────────────────── */}
      {remaining.length > 0 && (
        <>
          <div className="h-px bg-border mt-6" />
          <p className="text-micro font-bold text-muted-foreground tracking-wide mt-6">
            {trophies.length > 0
              ? tFallback('crewTrophies.stillOut', 'STILL OUT THERE')
              : tFallback('crewTrophies.whatsOut', "WHAT'S OUT THERE")}
          </p>
          <div className="mt-2">
            {remaining.map((row, i) => (
              <CatalogRow
                key={row.template_key}
                row={row}
                fmt={fmt}
                tFallback={tFallback}
                last={i === remaining.length - 1}
              />
            ))}
          </div>
          {remaining.some(r => r.state === 'locked') && (
            <p className="text-micro text-muted-foreground mt-2">
              {tFallback('crewTrophies.moreUnlock', 'More unlock as the crew levels up.')}
            </p>
          )}
        </>
      )}

      {/* ── The picker (board D) ───────────────────────────────────── */}
      <BottomSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={tFallback('crewTrophies.pickerTitle', "Choose the crew's next challenge")}
      >
        <p className="text-caption text-muted-foreground leading-relaxed -mt-1">
          {tFallback(
            'crewTrophies.pickerSub',
            'One at a time. Each pays a trophy the crew keeps forever, and a challenge can only be won once.',
          )}
        </p>
        <div className="h-px bg-border -mx-4 mt-4" />
        <div className="mt-2">
          {catalog.filter(r => r.state !== 'active').map((row, i, arr) => (
            <CatalogRow
              key={row.template_key}
              row={row}
              fmt={fmt}
              tFallback={tFallback}
              onStart={row.state === 'available' ? start : undefined}
              starting={starting}
              last={i === arr.length - 1}
            />
          ))}
        </div>
        <p className="text-micro text-muted-foreground mt-4">
          {tFallback('crewTrophies.pickerFoot', 'Only the crew leader can start one. Everyone fights for it.')}
        </p>
      </BottomSheet>
    </motion.section>
  );
}
