// src/pages/TradeHistory.jsx
//
// Every trade you've sent or received.
//
// This page used to reconstruct its entire contents by string-parsing DM
// bodies for [TRADE_OFFER_V1] / [TRADE_RESPONSE_V1] markers — so a trade
// existed only as long as the conversation did, and the counterparty could
// only ever be shown as a masked email, because a DM carries no user_id.
//
// Real offers now come from public.trade_offers (migration 253), which
// carries user ids (→ real @usernames) and a real status. Legacy
// DM-derived trades are still merged in and clearly marked, because
// they're the only record of what happened before 253 — but they stay
// read-only and keep saying nothing was transferred automatically, which
// for them is true.

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRightLeft, Clock, Check, X as XIcon, ShieldCheck, Ban } from 'lucide-react';
import { formatRelativeTime } from '@/lib/intlFormat';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useAuthorsById, resolveAuthor } from '@/lib/data/useAuthors';
import * as tradeHistory from '@/lib/data/tradeHistory';
import * as tradeOffers from '@/lib/data/tradeOffers';
import PageHeader from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/lib/LanguageContext';

const FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'pending',   label: 'Pending' },
  { id: 'accepted',  label: 'Accepted' },
  { id: 'declined',  label: 'Declined' },
  { id: 'cancelled', label: 'Cancelled' },
];

/** Normalize a public.trade_offers row into the shared row shape. */
function fromOfferRow(row, myUserId) {
  const iAmSender = row.from_user_id === myUserId;
  return {
    key: row.id,
    offerId: row.id,
    real: true,
    iAmSender,
    counterpartyId: iAmSender ? row.to_user_id : row.from_user_id,
    counterpartyEmail: null,
    status: row.status,
    sentAt: row.created_at,
    respondedAt: row.responded_at,
    myItem:    { name: row.from_item_name, emoji: row.from_item_emoji, rarity: row.from_item_rarity },
    theirItem: { name: row.to_item_name,   emoji: row.to_item_emoji,   rarity: row.to_item_rarity },
  };
}

/** Normalize a legacy DM-derived trade into the same shape. */
function fromLegacy(t) {
  return {
    key: `legacy-${t.offerId}`,
    offerId: t.offerId,
    real: false,
    iAmSender: t.iAmSender,
    counterpartyId: null,
    counterpartyEmail: t.iAmSender ? t.toEmail : t.fromEmail,
    status: t.status,
    sentAt: t.sentAt,
    respondedAt: t.respondedAt,
    myItem: t.myItem,
    theirItem: t.theirItem,
  };
}

export default function TradeHistory() {
  const { tFallback, language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const authorsById = useAuthorsById();
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);

  const { data: offerRows = [], isLoading: loadingReal } = useQuery({
    queryKey: ['tradeHistory', 'offers', user?.id],
    queryFn:  () => tradeOffers.listMine(),
    enabled:  !!user?.id,
    staleTime: 30_000,
  });

  const { data: legacyRows = [], isLoading: loadingLegacy } = useQuery({
    queryKey: ['tradeHistory', 'legacy', user?.email],
    queryFn:  () => tradeHistory.listMyTrades(user.id),
    enabled:  !!user?.email && !!user?.id,
    staleTime: 60_000,
  });

  const trades = useMemo(() => {
    const real = offerRows.map(r => fromOfferRow(r, user?.id));
    // A post-253 offer appears in BOTH sources: the table AND the DM that
    // announced it. Drop the DM copy so it isn't listed twice.
    const realIds = new Set(real.map(r => r.offerId));
    const legacy = legacyRows
      .filter(t => !realIds.has(t.offerId))
      .map(fromLegacy);
    return [...real, ...legacy]
      .sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
  }, [offerRows, legacyRows, user?.id]);

  const visible = filter === 'all' ? trades : trades.filter(t => t.status === filter);
  const isLoading = loadingReal || loadingLegacy;

  const handleCancel = async (offerId) => {
    setBusyId(offerId);
    try {
      await tradeOffers.cancel(offerId);
      toast.success(tFallback('tradeHistory.offerPulled', 'Offer pulled back. Your item is free again.'));
      qc.invalidateQueries({ queryKey: ['tradeHistory'] });
      qc.invalidateQueries({ queryKey: ['userInventory', user?.email] });
    } catch (err) {
      toast.error(tradeOffers.tradeErrorMessage(err, tFallback));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="p-4 md:p-8 max-w-2xl mx-auto"
    >
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> {tFallback("achievements.vault.back", "Back")}
      </button>

      <PageHeader kicker="Marketplace" title={tFallback("marketplaceHeader.tradeHistory", "Trade history")} icon={ArrowRightLeft} hidePeriod />

      <div className="flex gap-1.5 mb-4 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-micro font-bold uppercase tracking-wide transition-colors ${
              filter === f.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
            }`}
          >
            {tFallback(`tradeHistory.filter.${f.id}`, f.label)}
            {f.id !== 'all' && (
              <span className="opacity-70 ms-1">
                ({trades.filter(t => t.status === f.id).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <ArrowRightLeft className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-heading font-bold text-base">
            {filter === 'all' ? 'No trades yet' : `No ${filter} trades`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Trade offers you send + receive will show up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map(t => (
            <TradeRow
              key={t.key}
              trade={t}
              authorsById={authorsById}
              onCancel={handleCancel}
              busy={busyId === t.offerId}
            />
          ))}
        </ul>
      )}
    </motion.div>
  );
}

function TradeRow({ trade, authorsById, onCancel, busy }) {
  const { tFallback, language } = useLanguage();
  // Real trades resolve a live @username from the user id.
  //
  // Legacy trades came from DMs, which carry an email and no user_id. Those
  // used to render maskEmail(), i.e. "keg•••@gmail.com" — which is still
  // somebody's address: it shows the domain and enough of the local part to
  // identify a person you already know, in a list about a trade they made
  // with you. public_profiles deliberately does not expose email, so there
  // is no client-side path from that address to a username, and there is no
  // version of "show it a bit less" that is safe. These rows are
  // unattributed instead.
  const counterparty = trade.real
    ? resolveAuthor(authorsById, trade.counterpartyId).handle
    : tFallback('tradeHistory.aTrader', 'a trader');

  const youGive = trade.iAmSender ? trade.myItem    : trade.theirItem;
  const youGet  = trade.iAmSender ? trade.theirItem : trade.myItem;

  const statusMeta = {
    pending:   { Icon: Clock, color: 'text-amber-500',          bg: 'bg-amber-500/15',   label: 'Pending' },
    accepted:  { Icon: Check, color: 'text-emerald-500',        bg: 'bg-emerald-500/15', label: 'Accepted' },
    declined:  { Icon: XIcon, color: 'text-red-500',            bg: 'bg-red-500/15',     label: 'Declined' },
    cancelled: { Icon: Ban,   color: 'text-muted-foreground',   bg: 'bg-secondary',      label: 'Cancelled' },
  }[trade.status] || { Icon: Clock, color: 'text-muted-foreground', bg: 'bg-secondary', label: trade.status };
  const statusLabel = trade.status
    ? tFallback(`tradeHistory.status.${trade.status}`, statusMeta.label)
    : statusMeta.label;

  const canCancel = trade.real && trade.iAmSender && trade.status === 'pending';

  return (
    <li className="border border-border rounded-xl p-3 bg-card">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">
            {trade.iAmSender ? 'You offered' : `${counterparty} offered`}
          </p>
          <p className="text-xs text-muted-foreground truncate">{counterparty}</p>
        </div>
        <span className={`flex items-center gap-1 text-micro font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${statusMeta.bg} ${statusMeta.color}`}>
          <statusMeta.Icon className="w-3 h-3" /> {statusLabel}
        </span>
      </div>

      <div className="flex items-center gap-2 my-2">
        <ItemChip item={youGive} label={tFallback('tradeHistory.youGive', 'You give')} />
        <ArrowRightLeft className="w-4 h-4 text-muted-foreground shrink-0" />
        <ItemChip item={youGet} label={tFallback('tradeHistory.youGet', 'You get')} />
      </div>

      <div className="flex items-center justify-between text-micro text-muted-foreground gap-2">
        <span>{relTime(trade.sentAt, language)}</span>
        <div className="flex items-center gap-2">
          {trade.respondedAt && (
            <span>{statusLabel} {relTime(trade.respondedAt, language)}</span>
          )}
          {trade.real ? (
            <span
              className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"
              title={tFallback("tradeHistory.itemsWereSwappedAutomatically", "Items were swapped automatically")}
            >
              <ShieldCheck className="w-3 h-3" /> escrow
            </span>
          ) : (
            <span title={tFallback("tradeHistory.sentBeforeAutomaticTradingItems", "Sent before automatic trading, items were hand-delivered")}>manual</span>
          )}
        </div>
      </div>

      {canCancel && (
        <button
          type="button"
          onClick={() => onCancel(trade.offerId)}
          disabled={busy}
          className="mt-2 w-full py-1.5 rounded-lg text-micro font-bold text-red-600 dark:text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 active:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          {busy ? 'Cancelling…' : 'Cancel offer · release my item'}
        </button>
      )}
    </li>
  );
}

function ItemChip({ item, label }) {
  if (!item) return <div className="flex-1 text-xs text-muted-foreground italic">—</div>;
  return (
    <div className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/40 border border-border">
      <span className="text-xl shrink-0">{item.emoji || '✨'}</span>
      <div className="min-w-0">
        <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground/80">{label}</p>
        <p className="text-xs font-semibold truncate">{item.name || item.itemId || 'Item'}</p>
      </div>
    </div>
  );
}

function relTime(iso, language) {
  return formatRelativeTime(iso, language);
}
