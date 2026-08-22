// src/components/crews/CrewDiscovery.jsx
//
// The public Crews directory — every crew that has opted into is_public,
// with its member count, combined volume, level and war record.
//
// This used to read the crews table directly from the browser, which could
// never work for two of the five numbers on a row: crew_members SELECT is
// is_crew_member(crew_id) (mig 048), so a member count for a crew you are not
// in is unreachable, and nothing aggregated volume per crew at all. The row
// branched on a `_memberCount` that nothing ever set, so every result in
// production read "up to 16" and the "Full" state was dead code. Migration 308
// moves the whole read server-side.
//
// The action swaps by state rather than greying out — Join / Requested / Full
// / Your crew. Habitica's publicGuildItem.vue does the same, and a disabled
// button is a dead end where a swapped one is information.

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Globe2, Plus, Loader2, ArrowLeft, Shield } from 'lucide-react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as crewsData from '@/lib/data/crews';
import { listPublicCrews, joinStateFor } from '@/lib/data/crewDirectory';
import { getCrewTrophyCounts } from '@/lib/data/crewTrophies';
import { toast } from '@/lib/toast';
import { useNumberFormatter } from '@/lib/intl';

// The four sort pills. `key` is what listPublicCrews takes AND the catalog
// slug; the label is the English fallback the render site passes. Level stays
// English in every locale — it is a _glossary.json doNotTranslate term.
const SORTS = [
  { key: 'volume',  label: 'Volume' },
  { key: 'members', label: 'Members' },
  { key: 'level',   label: 'Level' },
  { key: 'new',     label: 'New' },
];

// Matches the crew list card and the Crew page header: crest, name, then one
// text line for identity and one for standing. No icon beside a count — see
// docs/profile-ui-premium-research.md.
function CrewResult({ crew, onJoin, joining, inACrew, requested, tFallback, fmt, trophyCount }) {
  const state    = joinStateFor(crew, { inACrew, requested });
  const count    = Number(crew.member_count ?? 0);
  const cap      = Number(crew.max_capacity ?? 16);
  const volume   = Number(crew.total_volume_lbs ?? 0);
  // The SHELF, not `crews.trophies`. That column is war renown and climbs 30
  // per win, so a crew that had never won a trophy still read "30 trophies".
  const trophies = Number(trophyCount ?? 0);

  const LABEL = {
    join:      ['crew.discover.join',      'Join'],
    apply:     ['crew.discover.apply',     'Apply'],
    requested: ['crew.discover.awaiting',  'Awaiting review'],
    full:      ['crew.discover.full',      'Full'],
    member:    ['crew.discover.yours',     'Your crew'],
  };
  // Join and Apply are the same tap — join_crew_atomic decides which it is
  // from the crew's own privacy. The label differs so the button never
  // promises a join the server will turn into a request.
  const actionable = state === 'join' || state === 'apply';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-2 p-4 rounded-2xl ${
        crew.is_member ? 'bg-primary/[0.07]' : 'bg-card'
      }`}
    >
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden"
        style={{ background: 'hsl(var(--primary) / 0.15)' }}
      >
        {crew.avatar_url
          ? <img loading="lazy" src={crew.avatar_url} alt="" className="w-full h-full object-cover" draggable={false} />
          : <Shield className="w-6 h-6" style={{ color: 'hsl(var(--primary))' }} />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-base text-foreground truncate leading-tight">
          {crew.name}
        </p>

        {/* Identity and scale. */}
        <p className="text-xs text-muted-foreground truncate">
          {crew.tag ? <>#{crew.tag} · </> : null}
          <span className="tabular-nums">{fmt(count)}</span>
          {' '}{tFallback('crew.discover.of', 'of')}{' '}
          <span className="tabular-nums">{fmt(cap)}</span>
          {Number.isFinite(Number(crew.crew_level)) && (
            <> · {tFallback('crew.discover.lvl', 'Lvl')} {crew.crew_level}</>
          )}
        </p>

        {/* Standing. Text, hierarchy from weight and colour — never tiles.
            Volume is the headline metric, so it leads; it reads as a dash
            rather than a proud zero until the crew has lifted something. */}
        <p className="text-xs text-muted-foreground truncate">
          {volume > 0
            ? <>
                <span className="font-bold text-foreground tabular-nums">
                  {fmt(volume, { notation: 'compact', maximumFractionDigits: 1 })}
                </span>
                {' '}{tFallback('crew.discover.lifted', 'lbs lifted')}
              </>
            : tFallback('crew.discover.noVolume', 'no volume logged yet')}
          {trophies > 0 && (
            <> · <span className="font-bold text-foreground tabular-nums">{fmt(trophies)}</span>
              {' '}{tFallback('crew.discover.trophies', 'trophies')}</>
          )}
          {Number(crew.wars_won ?? 0) + Number(crew.wars_lost ?? 0) > 0 && (
            <> · <span className="tabular-nums">{crew.wars_won}–{crew.wars_lost}</span></>
          )}
        </p>

        {crew.description && (
          <p className="text-xs text-muted-foreground/80 truncate">{crew.description}</p>
        )}
      </div>

      {/* The control swaps by state. `blocked` renders nothing at all — the
          sentence above the list already says you're in a crew, and a row of
          greyed buttons only repeats it once per crew. */}
      {state !== 'blocked' && (
        <motion.button
          whileTap={actionable ? { scale: 0.94 } : undefined}
          onClick={() => actionable && onJoin(crew.id)}
          disabled={state !== 'join'}
          className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-opacity ${
            actionable
              ? 'text-white'
              : 'text-muted-foreground bg-secondary'
          }`}
          style={actionable ? { background: 'hsl(var(--primary))' } : undefined}
        >
          {joining
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : actionable ? <Plus className="w-3.5 h-3.5" /> : null}
          {tFallback(...LABEL[state])}
        </motion.button>
      )}
    </motion.div>
  );
}

export default function CrewDiscovery({ onBack, onJoined, inline = false }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const qc = useQueryClient();
  const [query, setQuery]       = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort]         = useState('volume');
  const [joiningId, setJoiningId] = useState(null);
  // Migration 250 queues a join on a private crew rather than seating you, so
  // the row has to remember it asked. Session-scoped on purpose: the server is
  // the authority and a refetch will show membership once a leader approves.
  const [requestedIds, setRequestedIds] = useState(() => new Set());

  // The search is an RPC now, not a table read — one round trip per keystroke
  // is not acceptable.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // One crew per user (migration 252). The server refuses either way, but a
  // Join button that always errors is worse than one that says why.
  const { data: myCrews = [] } = useQuery({
    queryKey: ['myCrews', user?.id],
    queryFn:  () => crewsData.getMyCrews(user.id),
    enabled:  !!user?.id,
    staleTime: 15_000,
  });
  const inACrew = myCrews.length > 0;

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['crewDirectory', debounced, sort],
    queryFn:  () => listPublicCrews({ query: debounced, sort, limit: 30 }),
    staleTime: 15_000,
    // Both the sort pill and the debounced search term are in the key, so
    // each was a different query with no cache: `results` fell back to []
    // and the list emptied to nothing — the empty state is suppressed while
    // fetching, so you got a blank panel — before repopulating. Keep the
    // current results up; the spinner already in the search field is the
    // signal that a new set is coming.
    placeholderData: keepPreviousData,
  });

  // One round trip for the whole page rather than one per card. Keyed on the
  // ids actually on screen, so paging or searching refetches only what
  // changed, and an unapplied migration 367 simply yields {}.
  const shownIds = results.map(c => c.id);
  const { data: trophyCounts = {} } = useQuery({
    queryKey: ['crewTrophyCounts', shownIds],
    queryFn:  () => getCrewTrophyCounts(shownIds),
    enabled:  shownIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const joinMut = useMutation({
    mutationFn: (crewId) => crewsData.joinCrew(crewId, user.id),
    onMutate:   (crewId) => setJoiningId(crewId),
    onSuccess:  (res, crewId) => {
      setJoiningId(null);
      qc.invalidateQueries({ queryKey: ['crewDirectory'] });

      // Three outcomes, three sentences. Claiming "you joined" and then
      // showing no crew would read as a bug.
      if (res?.status === 'requested') {
        setRequestedIds(prev => new Set(prev).add(crewId));
        toast.success(tFallback('crew.discover.requestSent', 'Request sent'), {
          description: tFallback('crew.discover.requestBody', 'A crew leader will approve or decline it.'),
        });
        return;
      }
      if (res?.status === 'pending') {
        setRequestedIds(prev => new Set(prev).add(crewId));
        toast.info(tFallback('crew.discover.stillPending', 'Your request is still waiting on a leader.'));
        return;
      }

      toast.success(tFallback('crew.discover.joined', 'You joined the Crew! 🎉'));
      qc.invalidateQueries({ queryKey: ['myCrews', user?.id] });
      onJoined?.();
    },
    onError: (err) => {
      toast.error(tFallback('crew.discover.joinFailed', 'Could not join crew'), { description: err.message });
      setJoiningId(null);
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Rendered as a tab inside CrewsSection there is already a tab strip
          above, so the back header would be a second one saying the same
          thing. Same `inline` idiom as CrewMemberDirectory. */}
      {!inline && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <button onClick={onBack} className="text-muted-foreground" aria-label={tFallback('crew.back', 'Back')}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1.5">
            <Globe2 className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-heading font-bold text-base">
              {tFallback('crew.discover.title', 'Discover Crews')}
            </h2>
          </div>
        </div>
      )}

      {/* Search */}
      <div className={`shrink-0 ${inline ? 'pb-2' : 'px-4 py-3'}`}>
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={tFallback('crew.discover.search', 'Search by name or #tag…')}
            className="w-full ps-9 pe-4 py-2.5 rounded-xl border border-border bg-secondary/50 text-sm focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground"
          />
          {isFetching && (
            <Loader2 className="absolute end-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Sort — one row, four short labels. */}
      <div className={`shrink-0 flex gap-1 p-1 bg-secondary rounded-xl ${inline ? 'mb-2' : 'mx-4 mb-2'}`}>
        {SORTS.map(s => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
              sort === s.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground active:text-foreground'
            }`}
            aria-pressed={sort === s.key}
          >
            {tFallback(`crew.discover.sort.${s.key}`, s.label)}
          </button>
        ))}
      </div>

      {inACrew && (
        <p className={`text-xs text-muted-foreground leading-relaxed shrink-0 pb-2 ${inline ? '' : 'px-4'}`}>
          {tFallback('crew.discover.alreadyIn', "You're already in")}{' '}
          {myCrews[0]?.name ?? tFallback('crew.discover.aCrew', 'a Crew')}
          {'. '}
          {tFallback(
            'crew.discover.leaveFirst',
            'Leave it from the Crew page to join another. One crew at a time keeps a war score honest.',
          )}
        </p>
      )}

      {/* Results */}
      <div className={`flex-1 overflow-y-auto pb-6 space-y-2 ${inline ? '' : 'px-4'}`}>
        {!isFetching && results.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-14 px-4"
          >
            <Globe2 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="font-heading font-bold text-base">
              {query
                ? tFallback('crew.discover.noMatch', 'No crews match that')
                : tFallback('crew.discover.emptyTitle', 'No crews yet')}
            </p>
            {/* "No results" is a dead end at a moment when it is always true.
                Say what a crew is and what fixes it. */}
            <p className="text-sm text-muted-foreground leading-relaxed mt-2">
              {query
                ? tFallback('crew.discover.noMatchBody', 'Try a different name or tag.')
                : tFallback('crew.discover.emptyBody', 'A Crew is up to 16 people who train together and go to war with other crews. Every crew is listed here. You join the open ones straight away, and apply to the rest. Create one to get started.',
                  )}
            </p>
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {results.map(crew => (
            <CrewResult
              key={crew.id}
              crew={crew}
              onJoin={(id) => joinMut.mutate(id)}
              joining={joiningId === crew.id && joinMut.isPending}
              inACrew={inACrew}
              requested={requestedIds.has(crew.id)}
              tFallback={tFallback}
              fmt={fmt}
              trophyCount={trophyCounts[crew.id] ?? 0}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
