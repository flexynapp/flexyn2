// src/pages/TradeHistory.jsx
//
// Consolidated trade timeline reconstructed from the user's DM stream.
// Each row shows: counterparty, both items, status pill (pending /
// accepted / declined), and the timestamp of the offer + response.
//
// No new DB; uses the existing TRADE_OFFER / TRADE_RESPONSE markers
// already embedded in hub_messages. Reads through tradeHistory.js.

import React, { useState } from 'react';
import { maskEmail } from '@/lib/userDisplay';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRightLeft, Clock, Check, X as XIcon } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import * as tradeHistory from '@/lib/data/tradeHistory';
import PageHeader from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';

const FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Declined' },
  { id: 'pending',  label: 'Pending' },
];

export default function TradeHistory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['tradeHistory', user?.email],
    queryFn:  () => tradeHistory.listMyTrades(user.email),
    enabled:  !!user?.email,
    staleTime: 60_000,
  });

  const visible = filter === 'all' ? trades : trades.filter(t => t.status === filter);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="p-4 md:p-8 max-w-2xl mx-auto"
    >
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <PageHeader
        kicker="Marketplace"
        title="Trade history"
        icon={ArrowRightLeft}
        hidePeriod
      />

      {/* Filter pills */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide transition-colors ${
              filter === f.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            {f.label}
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
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
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
          {visible.map(t => <TradeRow key={t.offerId} trade={t} />)}
        </ul>
      )}
    </motion.div>
  );
}

function TradeRow({ trade }) {
  const counterparty = trade.iAmSender ? trade.toEmail : trade.fromEmail;
  const youGive = trade.iAmSender ? trade.myItem    : trade.theirItem;
  const youGet  = trade.iAmSender ? trade.theirItem : trade.myItem;

  const statusMeta = {
    pending:  { Icon: Clock,   color: 'text-amber-500',   bg: 'bg-amber-500/15',   label: 'Pending' },
    accepted: { Icon: Check,   color: 'text-emerald-500', bg: 'bg-emerald-500/15', label: 'Accepted' },
    declined: { Icon: XIcon,   color: 'text-red-500',     bg: 'bg-red-500/15',     label: 'Declined' },
  }[trade.status] || { Icon: Clock, color: 'text-muted-foreground', bg: 'bg-secondary', label: trade.status };

  return (
    <li className="border border-border rounded-xl p-3 bg-card">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {trade.iAmSender ? 'You offered' : `${counterparty ? maskEmail(counterparty) : 'Someone'} offered`}
          </p>
          {/* Counterparty is only known by email here; mask it so no full
              address (or raw local-part) is rendered. A user_profiles lookup
              would let us show the actual @username — TODO. */}
          <p className="text-xs text-muted-foreground truncate">
            {counterparty ? maskEmail(counterparty) : 'unknown'}
          </p>
        </div>
        <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${statusMeta.bg} ${statusMeta.color}`}>
          <statusMeta.Icon className="w-3 h-3" /> {statusMeta.label}
        </span>
      </div>

      <div className="flex items-center gap-2 my-2">
        <ItemChip item={youGive} label="You give" />
        <ArrowRightLeft className="w-4 h-4 text-muted-foreground shrink-0" />
        <ItemChip item={youGet} label="You get" />
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{relTime(trade.sentAt)}</span>
        {trade.respondedAt && (
          <span>{trade.status === 'accepted' ? 'Accepted' : 'Declined'} {relTime(trade.respondedAt)}</span>
        )}
      </div>
    </li>
  );
}

function ItemChip({ item, label }) {
  if (!item) return <div className="flex-1 text-xs text-muted-foreground italic">—</div>;
  return (
    <div className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/40 border border-border">
      <span className="text-xl shrink-0">{item.emoji || '✨'}</span>
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground/80">{label}</p>
        <p className="text-xs font-semibold truncate">{item.name || item.itemId || 'Item'}</p>
      </div>
    </div>
  );
}

function relTime(iso) {
  if (!iso) return '';
  try { return formatDistanceToNowStrict(new Date(iso), { addSuffix: true }); }
  catch { return ''; }
}
