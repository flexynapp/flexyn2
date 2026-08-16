// src/components/hub/ReferralCard.jsx
//
// Profile card that shows the user's referral code, a copy-link
// button, a Web Share button, and a count of successful referrals.
// Lives on the Hub profile page.
//
// REWARD COPY
// ───────────
// Both parties get +200 coins + 1 Elite capsule on a successful
// referral. The copy is calibrated to feel valuable without
// promising specific in-game equivalence — "Elite capsule" is the
// loot terminology already in the app.

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Gift, Copy, Share2, Check, X, ChevronRight } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { getMyReferralStats } from '@/lib/data/referrals';
import ReferralSheet from './ReferralSheet';

// Per-device dismissal, matching the `flexyn.<feature>.<userId>` convention
// (see CLAUDE.md and ProfileCompletionMeter). Per-user rather than global so
// a shared device doesn't hide one person's card because the other dismissed
// theirs.
const LS_KEY = (userId) => `flexyn.referralCardHidden.${userId || 'anon'}`;

function shareUrlForCode(code) {
  if (!code) return '';
  // Use the deployed origin so links work even when opened on
  // someone else's device. window.location.origin handles localhost,
  // Netlify previews, and prod alike.
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/?ref=${code}`;
}

export default function ReferralCard() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const [copied, setCopied] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Read once on mount — the flag only changes through this component, so
  // there's nothing to subscribe to.
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(LS_KEY(user?.id)) === '1'; }
    catch { return false; }
  });

  const setHiddenPersisted = (next) => {
    setHidden(next);
    try {
      if (next) localStorage.setItem(LS_KEY(user?.id), '1');
      else localStorage.removeItem(LS_KEY(user?.id));
    } catch { /* private mode — the in-memory state still applies this session */ }
  };

  const { data: stats } = useQuery({
    queryKey: ['referralStats', user?.id],
    queryFn: getMyReferralStats,
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const code = stats?.code || null;
  const count = stats?.total_referrals ?? 0;
  const coins = stats?.total_coins_earned ?? 0;
  // Migration 249. Absent on a client talking to a pre-249 database, in
  // which case `undefined` is falsy and the redeem field simply renders
  // enabled the way it did before — the server still rejects a second
  // claim with 'already_claimed'.
  const hasClaimed = stats?.has_claimed === true;
  const claimedCode = stats?.claimed_code || null;

  const handleCopy = async () => {
    const url = shareUrlForCode(code);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(tFallback('referral.copied', 'Link copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(tFallback('referral.copyFailed', 'Could not copy. Try the share button.'));
    }
  };

  const handleShare = async () => {
    const url = shareUrlForCode(code);
    if (!url) return;
    const shareData = {
      title: tFallback('referral.shareTitle', 'Join me on Flexyn'),
      text: tFallback(
        'referral.shareText',
        'Sign up with my code and we both get 200 coins + an Elite capsule.',
      ),
      url,
    };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
        // Fall through to clipboard
      }
    }
    await handleCopy();
  };

  if (!user?.id) return null;

  const sheet = (
    <ReferralSheet
      open={sheetOpen}
      onClose={() => setSheetOpen(false)}
      code={code}
      count={count}
      coins={coins}
      onCopy={handleCopy}
      onShare={handleShare}
      copied={copied}
      hasClaimed={hasClaimed}
      claimedCode={claimedCode}
      cardHidden={hidden}
      onRestoreCard={() => setHiddenPersisted(false)}
    />
  );

  // ── Dismissed: a pill that opens the same surface as a sheet ──
  // Everything the card offers stays one tap away, and the redeem field
  // lives in the sheet in both states — so hiding the promo costs the user
  // no capability, which is what makes it safe to offer.
  if (hidden) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-full border border-border text-sm font-semibold hover:bg-secondary active:bg-secondary transition-colors"
        >
          <Gift className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
          <span>{tFallback('referral.kicker', 'Invite friends')}</span>
          {count > 0 && (
            <span className="text-xs font-medium text-muted-foreground tabular-nums">{count}</span>
          )}
          <ChevronRight className="w-4 h-4 text-muted-foreground ms-auto shrink-0" aria-hidden="true" />
        </button>
        {sheet}
      </>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border border-border overflow-hidden bg-gradient-to-br from-primary/5 via-transparent to-destructive/5"
    >
      <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-border/40">
        <div className="flex items-center gap-2 min-w-0">
          <Gift className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-primary truncate">
            {tFallback('referral.kicker', 'Invite friends')}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {count > 0 && (
            <span className="text-xs text-muted-foreground">
              {count === 1
                ? tFallback('referral.invited.one', '1 friend joined')
                : tFallback('referral.invited.many', '{count} friends joined', { count })}
            </span>
          )}
          <button
            type="button"
            onClick={() => setHiddenPersisted(true)}
            className="p-1 rounded-md text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground transition-colors"
            aria-label={tFallback('referral.hide', 'Hide invite friends')}
            title={tFallback('referral.hide', 'Hide invite friends')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="px-4 py-3.5 space-y-3">
        <p className="text-sm leading-snug">
          {tFallback(
            'referral.pitch',
            'Share your code. When a friend signs up, you both get 200 coins + an Elite capsule.',
          )}
        </p>

        {/* Code chip + copy/share buttons */}
        <div className="flex items-stretch gap-2">
          <div className="flex-1 rounded-lg border border-border bg-background/40 px-3 py-2 flex items-center">
            <code className="font-heading font-bold tabular-nums tracking-[0.2em] text-base">
              {code || '••••••'}
            </code>
          </div>
          <button
            onClick={handleCopy}
            disabled={!code}
            className="px-3 rounded-lg border border-border bg-background hover:bg-secondary active:bg-secondary disabled:opacity-50 transition-colors flex items-center gap-1.5 text-xs font-semibold"
            aria-label={tFallback('referral.copy', 'Copy invite link')}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleShare}
            disabled={!code}
            className="px-3 rounded-lg bg-primary hover:bg-primary active:bg-primary disabled:opacity-50 text-white transition-colors flex items-center gap-1.5 text-xs font-bold"
          >
            <Share2 className="w-3.5 h-3.5" />
            {tFallback('referral.share', 'Share')}
          </button>
        </div>

        {/* Redeem entry point. The field itself lives in the sheet so there
            is exactly one implementation of the claim flow, reachable
            whether or not the card is dismissed. Hidden once the viewer has
            claimed — asking "got a code?" when they can't use one is a
            prompt that leads nowhere. */}
        {!hasClaimed && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
          >
            {tFallback('referral.redeem.label', "Got a friend's code?")}
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}

        {/* Earnings strip */}
        {count > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs text-muted-foreground">
            <span>{tFallback('referral.lifetime', 'Lifetime')}</span>
            <span className="tabular-nums font-semibold text-primary">
              {fmt(coins)} {tFallback('referral.coins', 'coins')}
              <span className="text-muted-foreground"> · </span>
              {count} {count === 1 ? tFallback('referral.capsule', 'capsule') : tFallback('referral.capsules', 'capsules')}
            </span>
          </div>
        )}
      </div>

      {sheet}
    </motion.div>
  );
}
