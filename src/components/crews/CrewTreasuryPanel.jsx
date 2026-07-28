// src/components/crews/CrewTreasuryPanel.jsx
//
// The crew balance and its perk shop (migration 251).
//
// Built to docs/profile-ui-premium-research.md rather than repeating what it
// documents: the balance is text taking its hierarchy from size and weight,
// not a bordered tile with a coin icon over it; perks are hairline-separated
// rows rather than a grid of cards; the type scale is the four sizes that
// doc prescribes; and counts run through useNumberFormatter so a balance
// reads 2,450 per locale rather than as a raw integer.
//
// Members see the balance and what it's going toward. Only leaders see a
// buy control, because only leaders can spend — showing a disabled button to
// everyone else advertises a permission they'll never have.

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { getTreasury, purchasePerk, describeLedgerReason } from '@/lib/data/crewTreasury';

function PerkRow({ perk, isLeader, busy, onBuy, fmt, tFallback }) {
  const maxed = perk.maxed;
  const can   = perk.affordable && !maxed;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/60">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">
          {perk.name}
          {perk.max > 1 && (
            <span className="text-muted-foreground font-normal">
              {' '}{fmt(perk.owned)}/{fmt(perk.max)}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
          {perk.description}
        </p>
      </div>

      <div className="shrink-0 text-end">
        {maxed ? (
          <span className="text-xs text-muted-foreground">
            {tFallback('treasury.owned', 'Owned')}
          </span>
        ) : (
          <>
            <p className={`text-sm font-bold tabular-nums ${can ? '' : 'text-muted-foreground'}`}>
              {fmt(perk.price)}
            </p>
            {isLeader && (
              <button
                onClick={() => onBuy(perk.perk_key)}
                disabled={!can || busy}
                className="mt-1 text-xs font-bold px-2.5 py-1 rounded-lg text-white disabled:opacity-40"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {busy
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : tFallback('treasury.buy', 'Buy')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function CrewTreasuryPanel({ crewId, isLeader }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const qc  = useQueryClient();
  const [busyKey, setBusyKey] = useState(null);

  const { data: treasury } = useQuery({
    queryKey: ['crewTreasury', crewId],
    queryFn:  () => getTreasury(crewId),
    enabled:  !!crewId,
    staleTime: 60_000,
  });

  const buy = useMutation({
    mutationFn: (perkKey) => purchasePerk(crewId, perkKey),
    onMutate:   (perkKey) => setBusyKey(perkKey),
    onSettled:  () => setBusyKey(null),
    onSuccess: (res) => {
      if (!res?.ok) {
        // insufficient / maxed are normal refusals — the RPC re-checks the
        // balance under a lock, so it can legitimately disagree with what
        // this screen was showing a moment ago.
        const msg = res?.reason === 'insufficient'
          ? tFallback('treasury.tooPoor', 'Not enough in the treasury yet.')
          : res?.reason === 'maxed'
            ? tFallback('treasury.maxed', 'You already own all of those.')
            : res?.reason === 'not_leader'
              ? tFallback('treasury.notLeader', 'Only a crew leader can spend the treasury.')
              : tFallback('treasury.buyFailed', 'Could not buy that.');
        toast.error(msg);
        qc.invalidateQueries({ queryKey: ['crewTreasury', crewId] });
        return;
      }

      toast.success(tFallback('treasury.bought', 'Bought for the crew.'), {
        description: `${fmt(res.price)} ${tFallback('treasury.spent', 'coins spent')}`,
      });
      qc.invalidateQueries({ queryKey: ['crewTreasury', crewId] });
      qc.invalidateQueries({ queryKey: ['crewMembers', crewId] });
      qc.invalidateQueries({ queryKey: ['myCrews'] });
    },
    onError: () => toast.error(tFallback('treasury.buyFailed', 'Could not buy that.')),
  });

  // Nothing true to say yet — a non-member, or 251 not applied on this host.
  if (!treasury) return null;

  const { balance, maxCapacity, perks, ledger } = treasury;

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="px-4 pt-4"
      aria-label={tFallback('treasury.aria', 'Crew treasury')}
    >
      {/* Balance as text — size and weight carry it, not a tile. */}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading font-bold text-base">
          {tFallback('treasury.title', 'Treasury')}
        </h3>
        <span className="text-xl font-bold tabular-nums" style={{ color: 'hsl(var(--primary))' }}>
          {fmt(balance)}
          <span className="text-sm font-normal text-muted-foreground">
            {' '}{tFallback('treasury.coins', 'coins')}
          </span>
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">
        {tFallback('treasury.earned', 'Earned by the whole crew from wars and challenges')}
        {' · '}
        {fmt(maxCapacity)} {tFallback('treasury.seats', 'seats')}
      </p>

      <div className="mt-3">
        {perks.map(p => (
          <PerkRow
            key={p.perk_key}
            perk={p}
            isLeader={isLeader}
            busy={busyKey === p.perk_key}
            onBuy={buy.mutate}
            fmt={fmt}
            tFallback={tFallback}
          />
        ))}
      </div>

      {ledger.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold mb-1">
            {tFallback('treasury.recent', 'Recent')}
          </p>
          {ledger.slice(0, 5).map((row, i) => {
            let when = null;
            try {
              if (row.created_at) {
                when = formatDistanceToNow(new Date(row.created_at), { addSuffix: true });
              }
            } catch { when = null; }
            const positive = (row.delta || 0) > 0;

            return (
              <div key={`${row.created_at}-${i}`} className="flex items-center gap-2 py-1 text-xs">
                <span className="flex-1 min-w-0 truncate text-muted-foreground">
                  {describeLedgerReason(row.reason, tFallback)}
                  {when && <span className="text-muted-foreground/70"> · {when}</span>}
                </span>
                <span className={`font-bold tabular-nums shrink-0 ${positive ? '' : 'text-muted-foreground'}`}>
                  {positive ? '+' : ''}{fmt(row.delta || 0)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </motion.section>
  );
}
