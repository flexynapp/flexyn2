// src/components/market/CreateBundleDialog.jsx
//
// "Bundle some of my listings" — the seller half of bundle deals, which had
// never been built. Migration 134 shipped the table, the RPC and the buyer's
// card in 2026, and step 2 of its own documented flow ("seller links listings
// via update marketplace_listings SET bundle_id") had no UI at all, so
// production has carried zero bundle rows since. Mig 320 replaced that raw
// UPDATE with set_listing_bundle(); this is its caller.
//
// The screen has one job beyond collecting a title and a percentage: make it
// impossible to create a bundle without seeing what it costs YOU. Mig 320
// moved the discount onto the seller — purchase_bundle now credits the seller
// exactly what the buyer paid, where it used to credit every listing's full
// asking_price and mint the difference. A seller who sets 50% off and later
// finds half their coins missing was not told; the preview below is the
// telling, and it updates on every selection and every percentage tap rather
// than sitting behind a confirm step.

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Package, X, ChevronLeft, AlertTriangle } from 'lucide-react';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import { containsProfanity } from '@/lib/profanityFilter';
import {
  createBundle, quoteBundle,
  BUNDLE_MIN_LISTINGS, BUNDLE_DISCOUNT_MAX,
} from '@/lib/data/marketplaceBundles';
import { RarityBadge, RarityFrame, CoinAmount } from '@/components/loot/RarityVisuals';
import { tileRow } from '@/lib/tileRows';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// Same 3-per-row picker ListItemDialog uses — how many listings you happen to
// have running is arbitrary, so a partial last row is the normal case.
const PICKER = tileRow({ gap: 2, cols: 3 });

// Presets rather than a slider. The schema allows 1–75 and the difference
// between 22% and 23% off is not a decision anyone is making on a phone;
// four taps cover the range people actually use, and the preview carries the
// consequence. 75 is the schema ceiling, deliberately included so the
// steepest option is one the seller has to choose on purpose.
const DISCOUNTS = [10, 25, 50, BUNDLE_DISCOUNT_MAX];

const TITLE_MAX = 60;

export default function CreateBundleDialog({ open, onClose, listings, user, onSuccess }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const [step, setStep]         = useState('pick');   // 'pick' | 'configure'
  const [selectedIds, setIds]   = useState(() => new Set());
  const [title, setTitle]       = useState('');
  const [discount, setDiscount] = useState(25);
  const [busy, setBusy]         = useState(false);

  const selected = useMemo(
    () => (listings ?? []).filter(l => selectedIds.has(l.id)),
    [listings, selectedIds]
  );
  const quote = useMemo(() => quoteBundle(selected, discount), [selected, discount]);

  const reset = () => {
    setStep('pick'); setIds(new Set()); setTitle(''); setDiscount(25);
  };
  const handleClose = () => { reset(); onClose(); };

  const toggle = (id) => {
    setIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Give the bundle a name.');
      return;
    }
    // The title is the one piece of free text a seller can put in front of
    // every other user on this page. Listings have none — their text is all
    // item names from the catalog — so this is the marketplace's only UGC
    // surface and it gets the same check usernames and bios get.
    if (containsProfanity(title)) {
      toast.error("Let's keep the bundle name clean.");
      return;
    }
    setBusy(true);
    try {
      await createBundle({
        title,
        discountPct:  discount,
        listingIds:   [...selectedIds],
        sellerUserId: user.id,
        sellerEmail:  user.email,
      });
      toast.success(`Bundle live — ${selected.length} items at ${discount}% off.`);
      handleClose();
      onSuccess?.();
    } catch (err) {
      reportError(err, {
        feature: 'marketplace.create-bundle', level: 'warning',
        userEmail: user?.email, count: selectedIds.size,
      });
      // Named causes get named copy; anything else stays generic, because a
      // raw Postgres message here leaks column and policy names.
      const raw = err?.message || '';
      toast.error(
          raw.includes('not_your_listing')  ? "One of those listings isn't yours any more — reopen and try again."
        : raw.includes('listing is')        ? 'One of those listings just sold or was pulled. Reopen and try again.'
        : raw.includes('bundle_needs_two')  ? `Pick at least ${BUNDLE_MIN_LISTINGS} listings.`
        : 'Could not create the bundle — try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const enough = selectedIds.size >= BUNDLE_MIN_LISTINGS;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={handleClose}
      />
      <motion.div
        className="relative z-10 bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            {step === 'configure' && (
              <button
                onClick={() => setStep('pick')}
                aria-label="Back to listing picker"
                className="text-muted-foreground hover:text-foreground active:text-foreground me-1"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <Package className="w-5 h-5 text-amber-500" />
            <h3 className="font-heading font-bold">
              {step === 'pick' ? 'Bundle Your Listings' : 'Set the Discount'}
            </h3>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground active:text-foreground p-1 rounded-lg hover:bg-secondary active:bg-secondary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {step === 'pick' && (
            <div className="flex flex-col gap-2">
              <p className="text-micro text-muted-foreground">
                Pick {BUNDLE_MIN_LISTINGS} or more of your live sale listings. Buyers get
                them as one purchase, at a discount you choose next.
              </p>

              {(listings ?? []).length < BUNDLE_MIN_LISTINGS ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  You need at least {BUNDLE_MIN_LISTINGS} live sale listings to make a
                  bundle. Trade listings and already-bundled items can&apos;t be included.
                </div>
              ) : (
                <>
                  <div className={`${PICKER.row} max-h-64 overflow-y-auto`}>
                    {listings.map(l => {
                      const on = selectedIds.has(l.id);
                      return (
                        <RarityFrame
                          key={l.id}
                          rarity={l.item_rarity}
                          as="button"
                          onClick={() => toggle(l.id)}
                          aria-pressed={on}
                          className={`flex flex-col items-center p-2 transition-transform hover:scale-105 ${PICKER.item} ${
                            on ? 'ring-2 ring-amber-400' : ''
                          }`}
                        >
                          <span className="text-3xl">{l.item_emoji}</span>
                          <span className="text-micro font-semibold mt-1 text-center leading-tight">
                            {l.item_name}
                          </span>
                          <RarityBadge rarity={l.item_rarity} size="sm" />
                          <span className="text-micro text-amber-600 dark:text-amber-300 font-bold mt-0.5">
                            <CoinAmount value={l.asking_price ?? 0} />
                          </span>
                        </RarityFrame>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    disabled={!enough}
                    onClick={() => setStep('configure')}
                    className={`w-full mt-1 py-2.5 rounded-xl font-bold text-sm transition-opacity ${
                      enough
                        ? 'bg-primary text-primary-foreground hover:opacity-90'
                        : 'bg-secondary text-muted-foreground cursor-not-allowed'
                    }`}
                  >
                    {enough
                      ? `Continue with ${selectedIds.size} items`
                      : `Pick ${BUNDLE_MIN_LISTINGS - selectedIds.size} more`}
                  </button>
                </>
              )}
            </div>
          )}

          {step === 'configure' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-1.5">
                {selected.map(l => (
                  <span key={l.id} className="text-2xl" title={l.item_name}>{l.item_emoji}</span>
                ))}
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
                  Bundle name
                </span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
                  placeholder="Starter pack"
                  maxLength={TITLE_MAX}
                  className="bg-secondary border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
                  Discount
                </span>
                <div className="flex gap-1.5">
                  {DISCOUNTS.map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDiscount(d)}
                      aria-pressed={discount === d}
                      className={`flex-1 py-2 rounded-xl text-sm font-bold transition-colors ${
                        discount === d
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-400/40'
                          : 'bg-secondary text-muted-foreground border border-transparent'
                      }`}
                    >
                      {d}%
                    </button>
                  ))}
                </div>
              </div>

              {/* The part this screen exists for. Since mig 320 the seller
                  funds the discount, so "buyer pays" and "you receive" are
                  the same number and the gap against the listed total is
                  real money. Showing only the buyer's price would repeat the
                  exact misunderstanding the old minting bug hid. */}
              <div className="rounded-xl border border-border bg-secondary/40 p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Listed separately</span>
                  <span className="line-through text-muted-foreground">
                    <CoinAmount value={quote.total} />
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Buyer pays</span>
                  <span className="font-bold text-amber-600 dark:text-amber-300">
                    <CoinAmount value={quote.price} />
                  </span>
                </div>
                <div className="h-px bg-border my-0.5" />
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold">You receive</span>
                  <span className="font-bold text-amber-600 dark:text-amber-300">
                    <CoinAmount value={quote.sellerReceives} />
                  </span>
                </div>
                <p className="text-micro text-muted-foreground flex items-start gap-1.5 mt-0.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
                  <span>
                    The discount comes out of your share — you&apos;re giving up{' '}
                    <CoinAmount value={quote.givenUp} className="font-semibold" /> to sell
                    these together. Buyers see one card and one price.
                  </span>
                </p>
              </div>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={busy || !title.trim()}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {busy ? 'Creating…' : 'Create bundle'}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
