// src/components/market/ListItemDialog.jsx
// Two-step "list one of my stickers" flow: pick an item, then configure
// it as a sale (price) or a trade (minimum rarity wanted).
// Split out of MarketplaceFeed.jsx.

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, ChevronLeft } from 'lucide-react';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import * as marketplace from '@/lib/data/marketplace';
import { RARITY } from '@/lib/lootCatalog';
import { displayName } from '@/lib/userDisplay';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import Sticker from '@/components/capsules/Sticker';
import { rarityName } from '@/components/capsules/words';
import { Shelf, ShelfSticker, shelvesOf, inkStyle } from '@/components/loot/Shelf';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { haptic } from '@/lib/haptic';
import { DURATION, EASE_OUT } from '@/lib/motion';

// The pick step is the Bag's shelves (option C, Kegan 2026-10-02): one row
// per rarity, rarest first, a sticker once with ×N for copies. It replaced a
// grid of rarity-bordered boxes with an emoji and a rarity pill in each.

export default function ListItemDialog({ open, onClose, userItems, user, onSuccess }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const qc = useQueryClient();
  const [step, setStep]               = useState('pick');   // 'pick' | 'configure'
  const [selectedItem, setSelected]   = useState(null);
  const [listingType, setListingType] = useState('sale');
  const [price, setPrice]             = useState('');
  const [tradeRarity, setTradeRarity] = useState('uncommon');
  const [busy, setBusy]               = useState(false);

  // What this item has actually sold for. Sellers used to face a blank
  // number field with no reference point at all, which is how you get
  // identical stickers listed at 5 and at 5,000 on the same page.
  const { data: priceStats } = useQuery({
    queryKey: ['itemPriceStats', selectedItem?.item_id],
    queryFn:  () => marketplace.priceStatsForItem(selectedItem.item_id),
    enabled:  !!selectedItem?.item_id && step === 'configure',
    staleTime: 5 * 60_000,
  });

  const reset = () => {
    setStep('pick'); setSelected(null); setListingType('sale');
    setPrice(''); setTradeRarity('uncommon');
  };

  const handleClose = () => { reset(); onClose(); };

  const unlistedItems = useMemo(
    () => (userItems ?? []).filter(i => !i.is_listed && i.item_type === 'sticker'),
    [userItems],
  );
  const fmt = useNumberFormatter();

  // One entry per sticker, holding every unlisted copy, on rarity shelves.
  const shelves = useMemo(() => {
    const by = new Map();
    for (const row of unlistedItems) {
      if (row.item_id == null) continue;
      if (!by.has(row.item_id)) by.set(row.item_id, { id: row.item_id, name: row.item_name, emoji: row.item_emoji, rarity: row.item_rarity, rows: [] });
      by.get(row.item_id).rows.push(row);
    }
    return shelvesOf([...by.values()]);
  }, [unlistedItems]);

  const handleSubmit = async () => {
    if (!selectedItem) return;
    if (listingType === 'sale' && (!price || isNaN(parseInt(price, 10)) || parseInt(price, 10) < 1)) {
      toast.error(tFallback('listItemDialog.invalidPrice', 'Enter a valid price (at least 1 coin).'));
      return;
    }
    setBusy(true);
    try {
      await marketplace.createListing({
        seller_user_id:   user.id,
        seller_email:     user.email,
        seller_username:  displayName(user),
        inventory_id:     selectedItem.id,
        item_id:          selectedItem.item_id,
        item_name:        selectedItem.item_name,
        item_emoji:       selectedItem.item_emoji,
        item_rarity:      selectedItem.item_rarity,
        listing_type:     listingType,
        asking_price:     listingType === 'sale' ? parseInt(price, 10) : null,
        trade_for_rarity: listingType === 'trade' ? tradeRarity : null,
      });
      // NO client-side is_listed write here. create_marketplace_listing
      // (mig 025) already flipped it inside the same transaction that
      // created the listing — and the client CAN'T write it anyway, since
      // user_inventory has no UPDATE policy. The old `inventory.setListed`
      // call threw 42501 every single time, which meant a listing that had
      // genuinely succeeded fell into the catch below: the user got
      // "Could not list item — try again", the dialog stayed open, and
      // nothing refetched. Retrying then failed for real, because the item
      // was already listed.
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      await qc.invalidateQueries({ queryKey: ['userInventory', user.email] });
      toast.success(tFallback('listItemDialog.listed', 'Listed. Good luck.'));
      handleClose();
      onSuccess?.();
    } catch (err) {
      // Generic toast, full detail to Sentry. Raw error.message can leak
      // Postgres column / RLS hints that aid schema mapping.
      reportError(err, {
        feature: 'marketplace.list', level: 'warning',
        userEmail: user?.email, itemId: selectedItem?.id,
      });
      toast.error(tFallback('listItemDialog.listFailed', 'Could not list item. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const pick = (entry) => {
    haptic('light');
    // List the last-acquired copy, the same one the Bag would sell.
    setSelected(entry.rows[entry.rows.length - 1]);
    setStep('configure');
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4">
      <motion.div
        className="absolute inset-0 bg-black/55"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={handleClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        className="relative z-10 bg-card border rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-md overflow-hidden max-h-[88vh] flex flex-col"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ duration: DURATION.slow, ease: EASE_OUT }}
      >
        <div className="flex items-center gap-1 ps-5 pe-2 pt-4">
          {step === 'configure' && (
            <button
              onClick={() => setStep('pick')}
              aria-label={tFallback('listItemDialog.backToItemPicker', 'Back to item picker')}
              className="-ms-3 w-11 h-11 inline-flex items-center justify-center rounded-full text-muted-foreground"
            >
              <ChevronLeft className="w-5 h-5 rtl:scale-x-[-1]" />
            </button>
          )}
          <h3 className="flex-1 font-heading font-bold text-title">
            {step === 'pick'
              ? tFallback('listItemDialog.pickTitle', 'What are you listing?')
              : tFallback('listItemDialog.configureTitle', 'Set your price')}
          </h3>
          <button
            onClick={handleClose}
            aria-label={tFallback('common.close', 'Close')}
            className="w-11 h-11 inline-flex items-center justify-center rounded-full text-muted-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-4" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
          {step === 'pick' && (
            unlistedItems.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-label">
                {tFallback('listItemDialog.noStickers', 'No stickers available to list. Open capsules to get more!')}
              </p>
            ) : (
              <div className="flex flex-col gap-6">
                {shelves.map(s => (
                  <Shelf key={s.rarity} rarity={s.rarity}>
                    {s.items.map(entry => (
                      <ShelfSticker
                        key={entry.id}
                        id={entry.id}
                        emoji={entry.emoji}
                        rarity={entry.rarity}
                        name={entry.name}
                        count={entry.rows.length}
                        onSelect={() => pick(entry)}
                      />
                    ))}
                  </Shelf>
                ))}
              </div>
            )
          )}

          {step === 'configure' && selectedItem && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-4">
                <Sticker
                  itemId={selectedItem.item_id} emoji={selectedItem.item_emoji} rarity={selectedItem.item_rarity}
                  size={72} shadow style={{ transform: 'rotate(-6deg)' }}
                />
                <div className="min-w-0">
                  <p className="font-heading font-bold text-title truncate">{selectedItem.item_name}</p>
                  <p className="text-label font-semibold rarity-ink" style={inkStyle(selectedItem.item_rarity)}>
                    {rarityName(tFallback, selectedItem.item_rarity)}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {/* Sale or trade, as the coin shop's capsule switch. */}
                <div className="flex gap-1 p-1 rounded-full bg-background" role="tablist">
                  {['sale', 'trade'].map(type => (
                    <button
                      key={type}
                      type="button"
                      role="tab"
                      aria-selected={listingType === type}
                      onClick={() => setListingType(type)}
                      className={`flex-1 h-9 rounded-full text-label font-semibold transition-colors duration-150 ${
                        listingType === type ? 'bg-card text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {type === 'sale'
                        ? tFallback('listItemDialog.forSale', 'Sell for coins')
                        : tFallback('listItemDialog.forTrade', 'Trade for a sticker')}
                    </button>
                  ))}
                </div>

                {listingType === 'sale' && (
                  <>
                    <label htmlFor="listing-price" className="pt-2 text-label font-semibold">
                      {tFallback('listItemDialog.askingPrice', 'Asking price')}
                    </label>
                    <div className="flex items-center gap-2 bg-background border rounded-lg px-3 h-11">
                      <FlexCoinIcon size={16} />
                      <input
                        id="listing-price"
                        type="number" inputMode="numeric"
                        min="1"
                        value={price}
                        onChange={e => setPrice(e.target.value)}
                        placeholder={priceStats ? String(priceStats.median) : '50'}
                        className="flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground tabular-nums"
                      />
                    </div>
                    {/* What this sticker has actually sold for. Sellers used to
                        face a blank field with no reference point, which is
                        how the same sticker ends up at 5 and at 5,000. */}
                    {priceStats ? (
                      <p className="flex items-center gap-1.5 flex-wrap text-caption text-muted-foreground tabular-nums">
                        {priceStats.low !== priceStats.high
                          ? tFallback('listItemDialog.usuallyRange', 'Usually sells for {median}, between {low} and {high}.', {
                            median: fmt(priceStats.median), low: fmt(priceStats.low), high: fmt(priceStats.high),
                          })
                          : tFallback('listItemDialog.usually', 'Usually sells for {median}.', { median: fmt(priceStats.median) })}
                        <button
                          type="button"
                          onClick={() => setPrice(String(priceStats.median))}
                          className="min-h-11 font-semibold text-primary"
                        >
                          {tFallback('listItemDialog.useMedian', 'Use {n}', { n: fmt(priceStats.median) })}
                        </button>
                      </p>
                    ) : (
                      <p className="text-caption text-muted-foreground">
                        {tFallback('listItemDialog.noSaleHistory', 'No sale history yet. You set the going rate.')}
                      </p>
                    )}
                  </>
                )}

                {listingType === 'trade' && (
                  <>
                    <label htmlFor="listing-trade-rarity" className="pt-2 text-label font-semibold">
                      {tFallback('listItemDialog.minimumRarityWanted', 'Minimum Rarity Wanted')}
                    </label>
                    <select
                      id="listing-trade-rarity"
                      value={tradeRarity}
                      onChange={e => setTradeRarity(e.target.value)}
                      className="w-full h-11 bg-background border rounded-lg px-3 text-body outline-none"
                    >
                      {Object.keys(RARITY).filter(k => k !== 'animated').map(key => (
                        <option key={key} value={key}>{rarityName(tFallback, key)}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>

              <button
                onClick={handleSubmit}
                disabled={busy}
                className="w-full h-12 rounded-full bg-primary text-primary-foreground font-bold text-body disabled:opacity-50 active:scale-[0.98] transition-transform duration-150"
              >
                {busy
                  ? tFallback('listItemDialog.listing', 'Listing…')
                  : tFallback('listItemDialog.listIt', 'List it')}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
