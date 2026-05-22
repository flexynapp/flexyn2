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
import { Gift, Copy, Share2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { getMyReferralStats } from '@/lib/data/referrals';

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
  const [copied, setCopied] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['referralStats', user?.id],
    queryFn: getMyReferralStats,
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const code = stats?.code || null;
  const count = stats?.total_referrals ?? 0;
  const coins = stats?.total_coins_earned ?? 0;

  const handleCopy = async () => {
    const url = shareUrlForCode(code);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(tFallback('referral.copied', 'Link copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(tFallback('referral.copyFailed', 'Could not copy — try the share button.'));
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border border-border overflow-hidden bg-gradient-to-br from-amber-500/5 via-transparent to-rose-500/5"
    >
      <div className="px-4 py-3 flex items-center justify-between border-b border-border/40">
        <div className="flex items-center gap-2">
          <Gift className="w-4 h-4 text-amber-500" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-500">
            {tFallback('referral.kicker', 'Invite friends')}
          </span>
        </div>
        {count > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {count === 1
              ? tFallback('referral.invited.one', '1 friend joined')
              : tFallback('referral.invited.many', '{count} friends joined', { count })}
          </span>
        )}
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
            className="px-3 rounded-lg border border-border bg-background hover:bg-secondary disabled:opacity-50 transition-colors flex items-center gap-1.5 text-xs font-semibold"
            aria-label={tFallback('referral.copy', 'Copy invite link')}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleShare}
            disabled={!code}
            className="px-3 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white transition-colors flex items-center gap-1.5 text-xs font-bold"
          >
            <Share2 className="w-3.5 h-3.5" />
            {tFallback('referral.share', 'Share')}
          </button>
        </div>

        {/* Earnings strip */}
        {count > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
            <span>{tFallback('referral.lifetime', 'Lifetime')}</span>
            <span className="tabular-nums font-semibold text-amber-500">
              {coins.toLocaleString()} {tFallback('referral.coins', 'coins')}
              <span className="text-muted-foreground"> · </span>
              {count} {count === 1 ? tFallback('referral.capsule', 'capsule') : tFallback('referral.capsules', 'capsules')}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
