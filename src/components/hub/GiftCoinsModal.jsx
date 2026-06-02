// src/components/hub/GiftCoinsModal.jsx
//
// Send-coins-to-a-friend modal. Opens from HubProfile when viewing
// someone else. The transfer is atomic on the server (gift_flex_coins
// RPC, migration 124) — debit + credit + audit row + notification in
// one tx.
//
// Quick-select chips for common amounts; freeform input for anything
// up to your balance (capped server-side at 10000 per gift).

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X, Coins, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { giftCoins } from '@/lib/data/coinGifts';
import { useNumberFormatter } from '@/lib/intl';
import { useAutofocusOnOpen } from '@/hooks/useAutofocusOnOpen';
import { usePullToDismiss } from '@/hooks/usePullToDismiss';
import { useLanguage } from '@/lib/LanguageContext';

const QUICK_AMOUNTS = [25, 100, 500, 1000];
const MAX_MESSAGE_LEN = 120;

export default function GiftCoinsModal({ open, onClose, recipient }) {
  const { user, refreshUser } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const [amount, setAmount] = useState(100);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const amountRef = useAutofocusOnOpen(open);
  const pull = usePullToDismiss({ onDismiss: onClose, enabled: open });

  if (!open) return null;

  const balance  = Math.max(0, Number(user?.flex_coins) || 0);
  const recipName = recipient?.username
    ? `@${recipient.username}`
    : (recipient?.email ? `@${recipient.email.split('@')[0]}` : tFallback('gift.thisUser', 'this user'));
  const cleanAmount = Number.isFinite(amount) ? Math.floor(amount) : 0;
  const overBudget  = cleanAmount > balance;
  const overCap     = cleanAmount > 10000;
  const tooLow      = cleanAmount < 1;
  const disabled    = sending || tooLow || overBudget || overCap || !recipient?.id;

  const handleSend = async () => {
    if (disabled) return;
    setSending(true);
    const res = await giftCoins({
      recipientId: recipient.id,
      amount:      cleanAmount,
      message:     message?.trim() || null,
    });
    setSending(false);
    if (res.ok) {
      toast.success(
        tFallback('gift.successToast', 'Sent {amount} coins to {recipient}.')
          .replace('{amount}', cleanAmount.toLocaleString())
          .replace('{recipient}', recipName),
      );
      try { await refreshUser?.(); } catch { /* non-blocking */ }
      onClose?.();
    } else {
      const err = res.error || 'UNKNOWN';
      if (err === 'INSUFFICIENT_FUNDS')      toast.error(tFallback('gift.error.insufficient',   "You don't have enough coins."));
      else if (err === 'PIPELINE_MISSING')   toast.error(tFallback('gift.error.pipeline',       'Gifting not yet available on this server.'));
      else if (err === 'SELF_GIFT')          toast.error(tFallback('gift.error.self',           "You can't gift yourself coins."));
      else if (err === 'RECIPIENT_NOT_FOUND') toast.error(tFallback('gift.error.notFound',      'Recipient could not be found.'));
      else                                   toast.error(tFallback('gift.error.generic',        'Could not send gift. Try again.'));
    }
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[9999] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={pull.contentStyle}
      >
        {/* Grab-bar — visual affordance + pull-to-dismiss touch target.
            Only the bar captures the drag, so inputs below still
            scroll/focus normally on touch. */}
        <div {...pull.handleProps} className="sm:hidden flex justify-center py-2 cursor-grab active:cursor-grabbing">
          <div className="h-1 w-10 rounded-full bg-border" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-between px-4 pt-2 pb-2 sm:pt-4">
          <h2 className="font-heading font-bold text-base flex items-center gap-2">
            <Coins className="w-4 h-4 text-yellow-500" />
            {tFallback('gift.title', 'Send a gift')}
          </h2>
          <button onClick={onClose} aria-label="Close"
            className="w-7 h-7 rounded-full bg-secondary text-muted-foreground flex items-center justify-center hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 pb-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            {tFallback('gift.sendingTo', 'Sending coins to {recipient}').split('{recipient}')[0]}
            <span className="font-semibold text-foreground">{recipName}</span>
            {tFallback('gift.sendingTo', 'Sending coins to {recipient}').split('{recipient}')[1]}
          </p>

          <div className="grid grid-cols-4 gap-2">
            {QUICK_AMOUNTS.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                className={`py-2 rounded-lg text-sm font-bold transition-colors ${
                  amount === v
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/60 hover:bg-secondary text-foreground'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              {tFallback('gift.customAmount', 'Custom amount')}
            </label>
            <input
              ref={amountRef}
              type="number" inputMode="decimal"
              min={1}
              max={10000}
              value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm tabular-nums"
            />
            <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
              {tFallback('gift.balance', 'Balance: {n} coins · max 10,000 per gift').replace('{n}', fmt(balance))}
            </p>
            {overBudget && (
              <p className="text-[11px] text-destructive mt-1">{tFallback('gift.notEnough', "You don't have enough coins.")}</p>
            )}
            {overCap && !overBudget && (
              <p className="text-[11px] text-destructive mt-1">{tFallback('gift.maxPerGift', 'Max 10,000 per gift.')}</p>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              {tFallback('gift.message', 'Message (optional)')}
            </label>
            <input
              type="text"
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, MAX_MESSAGE_LEN))}
              placeholder={tFallback('gift.messagePlaceholder', 'Crushed that PR!')}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-1 tabular-nums text-end">
              {message.length}/{MAX_MESSAGE_LEN}
            </p>
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={disabled}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending
              ? tFallback('gift.sending', 'Sending…')
              : tFallback('gift.send', 'Send {n} coins').replace('{n}', cleanAmount.toLocaleString())}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
