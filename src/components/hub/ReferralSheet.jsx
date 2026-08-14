// src/components/hub/ReferralSheet.jsx
//
// The full "Invite friends" surface as a bottom sheet: your code with
// copy/share, a field to redeem someone else's code, and lifetime earnings.
//
// The redeem half is new capability, not a move. `claimReferral` has existed
// since migration 089 but only ever fired automatically from a `?ref=` link
// at signup (AuthContext), so a code someone read out loud, texted, or wrote
// on a whiteboard had nowhere to go. Now it does.
//
// Sheet rather than another card because this is the hidden-state home for
// the referral surface — see ReferralCard, which renders a pill once
// dismissed. Matches the bottom-sheet pattern already used by the profile's
// overflow menu, trophy picker and flag picker.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { Gift, Copy, Share2, Check, X, Loader2, TicketCheck } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { claimReferral } from '@/lib/data/referrals';
import { reportError } from '@/lib/reportError';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// Codes are 6 chars (see migration 089's generator). Normalising here means
// "abc 123" and "ABC-123" both work — people retype these from memory.
const normaliseCode = (raw) => (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

export default function ReferralSheet({
  open, onClose, code, count, coins, onCopy, onShare, copied,
  hasClaimed, claimedCode, cardHidden, onRestoreCard,
}) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const queryClient = useQueryClient();
  const [entry, setEntry] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimedOk, setClaimedOk] = useState(false);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleRedeem = async () => {
    const clean = normaliseCode(entry);
    if (clean.length !== 6) {
      toast.error(tFallback('referral.redeem.tooShort', 'Invite codes are 6 characters.'));
      return;
    }
    setClaiming(true);
    try {
      const res = await claimReferral(clean);
      // null means the RPC isn't deployed on this environment (42883/42P01).
      // Say so plainly rather than reporting a generic failure the user
      // could retry forever.
      if (res === null) {
        toast.error(tFallback('referral.redeem.unavailable', 'Invite codes aren\'t enabled on this build yet.'));
        return;
      }
      if (res?.ok) {
        setClaimedOk(true);
        setEntry('');
        toast.success(tFallback('referral.redeem.success', 'Code applied — you both got 200 coins + an Elite capsule.'));
        // The claim mints coins and a capsule for both sides, so anything
        // reading the wallet or the referral counters is now stale.
        queryClient.invalidateQueries({ queryKey: ['referralStats'] });
        queryClient.invalidateQueries({ queryKey: ['wallet'] });
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        return;
      }
      const REASONS = {
        invalid_code:    tFallback('referral.redeem.invalid', 'That code doesn\'t look right.'),
        code_not_found:  tFallback('referral.redeem.notFound', 'No one has that code.'),
        already_claimed: tFallback('referral.redeem.already', 'You\'ve already used an invite code.'),
        self_referral:   tFallback('referral.redeem.self', 'That\'s your own code.'),
      };
      toast.error(REASONS[res?.reason] || tFallback('referral.redeem.failed', 'Could not apply that code — try again.'));
      if (res?.reason === 'rpc_error' || res?.reason === 'network') {
        reportError(new Error(`claimReferral: ${res.reason}`), { feature: 'referral.redeem', level: 'warning' });
      }
    } finally {
      setClaiming(false);
    }
  };

  const title = tFallback('referral.kicker', 'Invite friends');

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="bg-card border border-border rounded-t-2xl w-full max-w-lg"
            style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
          >
            <div className="w-9 h-1 rounded-full bg-border mx-auto my-2" aria-hidden="true" />

            <div className="flex items-center justify-between px-4 pb-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <Gift className="w-4 h-4 text-primary" aria-hidden="true" />
                <h3 className="font-heading font-bold text-base">{title}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors"
                aria-label={tFallback('common.close', 'Close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-4 space-y-5">
              {/* ── Your code ── */}
              <section>
                <p className="text-sm leading-snug mb-3">
                  {tFallback(
                    'referral.pitch',
                    'Share your code. When a friend signs up, you both get 200 coins + an Elite capsule.',
                  )}
                </p>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 rounded-lg border border-border bg-background/40 px-3 py-2 flex items-center">
                    <code className="font-heading font-bold tabular-nums tracking-[0.2em] text-base">
                      {code || '••••••'}
                    </code>
                  </div>
                  <button
                    onClick={onCopy}
                    disabled={!code}
                    className="px-3 rounded-lg border border-border bg-background hover:bg-secondary active:bg-secondary disabled:opacity-50 transition-colors flex items-center"
                    aria-label={tFallback('referral.copy', 'Copy invite link')}
                  >
                    {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={onShare}
                    disabled={!code}
                    className="px-3 rounded-lg bg-primary hover:bg-primary active:bg-primary disabled:opacity-50 text-white transition-colors flex items-center gap-1.5 text-xs font-bold"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    {tFallback('referral.share', 'Share')}
                  </button>
                </div>
              </section>

              {/* ── Redeem someone else's ──
                  `hasClaimed` comes from my_referral_stats (migration 249).
                  Before it existed the field rendered enabled for everyone
                  and a user who had already redeemed learned that only by
                  submitting and being rejected. Now the state is visible
                  before they type. `claimedOk` covers the same ground for a
                  claim made in this session, where the flag is still stale
                  in the query cache. */}
              <section className="pt-4 border-t border-border/50">
                <label
                  htmlFor="referral-redeem"
                  className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2"
                >
                  {hasClaimed && !claimedOk
                    ? tFallback('referral.redeem.usedLabel', 'Invite code')
                    : tFallback('referral.redeem.label', 'Got a friend\'s code?')}
                </label>
                {hasClaimed && !claimedOk ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2.5 text-sm text-muted-foreground">
                    <TicketCheck className="w-4 h-4 shrink-0 text-success" aria-hidden="true" />
                    <span>
                      {claimedCode
                        ? tFallback('referral.redeem.usedWith', 'You joined with code {code}.').replace('{code}', claimedCode)
                        : tFallback('referral.redeem.already', 'You\'ve already used an invite code.')}
                    </span>
                  </div>
                ) : claimedOk ? (
                  <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success dark:text-success">
                    <TicketCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                    {tFallback('referral.redeem.done', 'Code applied. Rewards are on their way.')}
                  </div>
                ) : (
                  <>
                    <div className="flex items-stretch gap-2">
                      <input
                        id="referral-redeem"
                        type="text"
                        inputMode="text"
                        value={entry}
                        onChange={(e) => setEntry(normaliseCode(e.target.value))}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !claiming) handleRedeem(); }}
                        placeholder={tFallback("referralSheet.abc123", "ABC123")}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={6}
                        className="flex-1 rounded-lg border border-border bg-background/40 px-3 py-2 font-heading font-bold tracking-[0.2em] text-base uppercase placeholder:text-muted-foreground/40 placeholder:tracking-[0.2em] focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={handleRedeem}
                        disabled={claiming || entry.length !== 6}
                        className="px-4 rounded-lg bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex items-center gap-1.5"
                      >
                        {claiming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {tFallback('referral.redeem.action', 'Redeem')}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {tFallback('referral.redeem.hint', 'One code per account, and it can\'t be your own.')}
                    </p>
                  </>
                )}
              </section>

              {/* ── Lifetime ── */}
              {count > 0 && (
                <section className="pt-4 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{tFallback('referral.lifetime', 'Lifetime')}</span>
                  <span className="tabular-nums font-semibold text-primary">
                    {fmt(coins)} {tFallback('referral.coins', 'coins')}
                    <span className="text-muted-foreground"> · </span>
                    {count} {count === 1 ? tFallback('referral.capsule', 'capsule') : tFallback('referral.capsules', 'capsules')}
                  </span>
                </section>
              )}

              {/* Undo the dismissal. A hide with no way back is a trap —
                  especially one persisted to localStorage, where the user has
                  no settings screen to go looking in. */}
              {cardHidden && (
                <section className="pt-4 border-t border-border/50">
                  <button
                    type="button"
                    onClick={() => { onRestoreCard(); onClose(); }}
                    className="text-xs font-semibold text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                  >
                    {tFallback('referral.restore', 'Show the full card on my profile again')}
                  </button>
                </section>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
