// src/components/market/ListItemDialog.jsx
// Two-step "list one of my stickers" flow: pick an item, then configure
// it as a sale (price) or a trade (minimum rarity wanted).
// Split out of MarketplaceFeed.jsx.

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, X, ChevronLeft, TrendingUp } from 'lucide-react';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import * as marketplace from '@/lib/data/marketplace';
import { RARITY } from '@/lib/lootCatalog';
import { displayName } from '@/lib/userDisplay';
import { RarityBadge, RarityFrame, COIN } from '@/components/loot/RarityVisuals';

export default function ListItemDialog({ open, onClose, userItems, user, onSuccess }) {
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

  const unlistedItems = (userItems ?? []).filter(i => !i.is_listed && i.item_type === 'sticker');

  const handleSubmit = async () => {
    if (!selectedItem) return;
    if (listingType === 'sale' && (!price || isNaN(parseInt(price, 10)) || parseInt(price, 10) < 1)) {
      toast.error('Enter a valid price (at least 1 coin).');
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
      toast.success('Listed. Good luck.');
      handleClose();
      onSuccess?.();
    } catch (err) {
      // Generic toast, full detail to Sentry. Raw error.message can leak
      // Postgres column / RLS hints that aid schema mapping.
      reportError(err, {
        feature: 'marketplace.list', level: 'warning',
        userEmail: user?.email, itemId: selectedItem?.id,
      });
      toast.error('Could not list item — try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

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
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            {step === 'configure' && (
              <button
                onClick={() => setStep('pick')}
                aria-label="Back to item picker"
                className="text-muted-foreground hover:text-foreground active:text-foreground me-1"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <ShoppingBag className="w-5 h-5 text-primary" />
            <h3 className="font-heading font-bold">
              {step === 'pick' ? 'Choose Item to List' : 'Configure Listing'}
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
            <div>
              {unlistedItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No stickers available to list. Open capsules to get more!
                </div>
              ) : (
                <div
                  className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: 'hsl(var(--border)) transparent' }}
                >
                  {unlistedItems.map(item => (
                    <RarityFrame
                      key={item.id}
                      rarity={item.item_rarity}
                      as="button"
                      onClick={() => { setSelected(item); setStep('configure'); }}
                      className="flex flex-col items-center p-2 transition-transform hover:scale-105"
                    >
                      <span className="text-3xl">{item.item_emoji}</span>
                      <span className="text-micro font-semibold mt-1 text-center leading-tight">
                        {item.item_name}
                      </span>
                      <RarityBadge rarity={item.item_rarity} size="sm" />
                    </RarityFrame>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'configure' && selectedItem && (
            <div className="flex flex-col gap-4">
              {/* Selected item preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 border border-border">
                <span className="text-3xl">{selectedItem.item_emoji}</span>
                <div>
                  <p className="font-semibold text-sm">{selectedItem.item_name}</p>
                  <RarityBadge rarity={selectedItem.item_rarity} size="sm" />
                </div>
              </div>

              {/* Listing type toggle */}
              <div className="flex gap-2">
                {['sale', 'trade'].map(type => (
                  <button
                    key={type}
                    onClick={() => setListingType(type)}
                    className={[
                      'flex-1 py-2 rounded-lg text-sm font-bold capitalize border transition-colors',
                      listingType === type
                        ? 'bg-primary/15 border-primary text-primary'
                        : 'bg-secondary/50 border-border text-muted-foreground hover:border-foreground/20',
                    ].join(' ')}
                  >
                    {type === 'sale' ? `${COIN} For Sale` : '⚡ For Trade'}
                  </button>
                ))}
              </div>

              {/* Sale price */}
              {listingType === 'sale' && (
                <div>
                  <label
                    htmlFor="listing-price"
                    className="text-muted-foreground text-xs font-semibold mb-1.5 block"
                  >
                    Asking Price (Flex Coins)
                  </label>
                  <div className="flex items-center gap-2 bg-secondary/50 border border-border rounded-xl px-3 py-2">
                    <span>{COIN}</span>
                    <input
                      id="listing-price"
                      type="number" inputMode="decimal"
                      min="1"
                      value={price}
                      onChange={e => setPrice(e.target.value)}
                      placeholder={priceStats ? `e.g. ${priceStats.median}` : 'e.g. 50'}
                      className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>

                  {priceStats ? (
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      <TrendingUp className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-micro text-muted-foreground">
                        Usually sells for {COIN} {priceStats.median}
                        {priceStats.low !== priceStats.high && (
                          <> ({priceStats.low}–{priceStats.high})</>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPrice(String(priceStats.median))}
                        className="text-micro font-bold text-primary hover:underline"
                      >
                        Use {priceStats.median}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-micro text-muted-foreground">
                      No sale history yet — you set the going rate.
                    </p>
                  )}
                </div>
              )}

              {/* Trade rarity minimum */}
              {listingType === 'trade' && (
                <div>
                  <label
                    htmlFor="listing-trade-rarity"
                    className="text-muted-foreground text-xs font-semibold mb-1.5 block"
                  >
                    Minimum Rarity Wanted
                  </label>
                  <select
                    id="listing-trade-rarity"
                    value={tradeRarity}
                    onChange={e => setTradeRarity(e.target.value)}
                    className="w-full bg-card border border-border rounded-xl px-3 py-2 text-sm outline-none"
                  >
                    {Object.entries(RARITY).filter(([k]) => k !== 'animated').map(([key, rc]) => (
                      <option key={key} value={key}>{rc.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={busy}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 transition-opacity hover:opacity-90"
              >
                {busy ? 'Listing…' : 'List Item'}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
