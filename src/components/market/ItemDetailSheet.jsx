// src/components/market/ItemDetailSheet.jsx
//
// The listing detail, full screen, from the round 2 design. It answers what
// the row cannot (what is this, what is it worth, has it sold before, is it
// listed elsewhere, who is selling) and carries the purchase itself in three
// states on the same screen: Buy, then Confirm with the balance you will
// have after, then Bought.
//
// The purchase is still purchase_listing (mig 025) through the feed's
// handler: this screen never prices, debits or transfers anything. The
// "after this you have" line is the viewer's balance minus the asking price,
// shown before they commit; once it is bought the balance shown is the one
// the feed re-reads from the server.
//
// Dropped from the design: the "Set 01" series label, which no data carries
// (the sheet number is real and stays).

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Heart } from 'lucide-react';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import Sticker from '@/components/capsules/Sticker';
import { NotchedCorner } from '@/components/capsules/parts';
import { rarityName } from '@/components/capsules/words';
import { rarityTint } from '@/components/loot/RarityVisuals';
import * as marketplace from '@/lib/data/marketplace';
import { findCatalogItem, lootDescription } from '@/lib/lootCatalog';
import { askMultiple, catalogValue, formatSetNo, setNumber } from '@/lib/capsuleShelf';
import { displayName } from '@/lib/userDisplay';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useNumberFormatter } from '@/lib/intl';
import { useLanguage } from '@/lib/LanguageContext';

export default function ItemDetailSheet({
  listing,
  allListings = [],
  currentUser,
  flexCoins,
  isSaved,
  onToggleSave,
  onBuyConfirm,
  onOfferTrade,
  onCancel,
  onDelete,
  onSellerClick,
  onMessageSeller,
  onSelectListing,
  onClose,
}) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  useBodyScrollLock(!!listing);
  // 'idle' → 'confirm' → 'done'. Reset whenever a different listing opens.
  const [step, setStep] = useState('idle');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStep('idle'); setBusy(false); }, [listing?.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const itemId = listing?.item_id;
  const { data: priceStats } = useQuery({
    queryKey: ['itemPriceStats', itemId],
    queryFn: () => marketplace.priceStatsForItem(itemId),
    enabled: !!itemId,
    staleTime: 5 * 60_000,
  });

  // Other live listings of the same item, cheapest sale first.
  const alternatives = useMemo(() => {
    if (!listing) return [];
    return allListings
      .filter(l => l.item_id === listing.item_id && l.id !== listing.id)
      .sort((a, b) => {
        const as = a.listing_type === 'sale' ? 0 : 1;
        const bs = b.listing_type === 'sale' ? 0 : 1;
        if (as !== bs) return as - bs;
        return (a.asking_price ?? Infinity) - (b.asking_price ?? Infinity);
      });
  }, [listing, allListings]);

  if (!listing || typeof document === 'undefined') return null;

  const catalogItem = findCatalogItem(listing.item_id);
  const tint = rarityTint(listing.item_rarity);
  const isMine = !!currentUser?.id && listing.seller_user_id === currentUser.id;
  const isSale = listing.listing_type === 'sale';
  const price = listing.asking_price ?? 0;
  const canAfford = isSale && flexCoins >= price;
  const catalog = catalogValue(listing.item_id);
  const multiple = isSale ? askMultiple(price, catalog) : null;
  const set = setNumber(listing.item_id);
  const lastSale = priceStats?.recent?.[0] ?? null;

  const buy = async () => {
    if (step === 'idle') { setStep('confirm'); return; }
    if (step !== 'confirm' || busy) return;
    setBusy(true);
    const ok = await onBuyConfirm?.(listing);
    setBusy(false);
    setStep(ok ? 'done' : 'idle');
  };

  const facts = [
    { k: tFallback('itemDetail.catalogValue', 'Catalog value'), coin: catalog != null, v: catalog != null ? fmt(catalog) : tFallback('itemDetail.none', 'None') },
    {
      k: tFallback('itemDetail.lastSale', 'Last priced sale'),
      coin: lastSale != null,
      v: lastSale != null ? fmt(lastSale) : tFallback('itemDetail.noneYet', 'None yet'),
    },
    ...(priceStats && priceStats.count > 1 ? [{
      k: tFallback('itemDetail.typical', 'Typical sale'), coin: true, v: fmt(priceStats.median),
    }] : []),
    {
      k: tFallback('itemDetail.otherListings', 'Other {item} listings', { item: listing.item_name }),
      coin: false,
      v: alternatives.length > 0 ? fmt(alternatives.length) : tFallback('itemDetail.none', 'None'),
    },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-background text-foreground overflow-y-auto overscroll-contain"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="listing-detail-title"
    >
      <div className="mx-auto max-w-lg min-h-full flex flex-col">
        <div className="h-[60px] px-2.5 pt-2 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={tFallback('itemDetail.back', 'Back to market')}
            className="w-11 h-11 inline-flex items-center justify-center rounded-full"
          >
            <ChevronLeft className="w-6 h-6 rtl:scale-x-[-1]" aria-hidden="true" />
          </button>
          {!isMine && onToggleSave && (
            <button
              type="button"
              onClick={() => onToggleSave(listing.id)}
              aria-pressed={!!isSaved}
              aria-label={tFallback('itemDetail.save', 'Save for later')}
              className="w-11 h-11 inline-flex items-center justify-center rounded-full"
            >
              <Heart className={`w-6 h-6 ${isSaved ? 'fill-current' : ''}`} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="px-5 pt-1 flex items-center gap-4">
          <div className="relative w-[clamp(112px,32vw,136px)] aspect-square shrink-0 rounded-2xl bg-card border flex items-center justify-center">
            <Sticker itemId={listing.item_id} emoji={listing.item_emoji} rarity={listing.item_rarity} size="74%" shadow />
            <NotchedCorner />
          </div>
          <div className="min-w-0 flex flex-col gap-1.5">
            {set && (
              <span className="stamp">
                {tFallback('itemDetail.setNo', 'No. {no} of {total}', { no: formatSetNo(set.no), total: set.total })}
              </span>
            )}
            <h2 id="listing-detail-title" className="font-display text-display break-anywhere">{listing.item_name}</h2>
            <span className="inline-flex items-center gap-2 text-label font-semibold" style={{ color: tint.color }}>
              <span className="w-2 h-2 rounded-full" style={{ background: tint.color }} aria-hidden="true" />
              {rarityName(tFallback, listing.item_rarity)}
            </span>
            {catalogItem?.description && (
              <span className="text-label text-muted-foreground">{lootDescription(catalogItem, tFallback)}</span>
            )}
          </div>
        </div>

        <div className="px-5 pt-6 flex flex-col gap-1.5">
          <span className="eyebrow">
            {isSale ? tFallback('itemDetail.asking', 'Asking') : tFallback('itemDetail.wants', 'Wants in trade')}
          </span>
          {isSale ? (
            <span className="inline-flex items-center gap-2.5">
              <FlexCoinIcon size={32} />
              <span className="font-display text-display tabular-nums">{fmt(price)}</span>
            </span>
          ) : (
            <span className="font-display text-display">
              {listing.trade_for_rarity
                ? tFallback('itemDetail.rarityOrBetter', '{rarity} or better', { rarity: rarityName(tFallback, listing.trade_for_rarity) })
                : tFallback('itemDetail.anySticker', 'Any sticker')}
            </span>
          )}
        </div>

        <dl className="mx-5 mt-4 border-t">
          {facts.map(f => (
            <div key={f.k} className="h-12 border-b flex items-center justify-between gap-3 text-body">
              <dt className="text-muted-foreground truncate">{f.k}</dt>
              <dd className="inline-flex items-center gap-1.5 font-semibold tabular-nums shrink-0">
                {f.coin && <FlexCoinIcon size={14} />}{f.v}
              </dd>
            </div>
          ))}
        </dl>
        {multiple != null && (
          <p className="mx-5 mt-2 text-label text-muted-foreground">
            {tFallback('itemDetail.askMultiple', 'Sellers set their own prices. This one asks {n} times the catalog value.', { n: fmt(multiple) })}
          </p>
        )}

        {alternatives.length > 0 && (
          <div className="mx-5 mt-4 flex flex-col">
            <span className="eyebrow pb-1">{tFallback('itemDetailSheet.alsoListedRightNow', 'Also listed right now')}</span>
            {alternatives.slice(0, 4).map(alt => (
              <button
                key={alt.id}
                type="button"
                onClick={() => onSelectListing?.(alt)}
                className="h-12 border-t flex items-center gap-2 text-start text-body"
              >
                <span className="flex-1 min-w-0 truncate">{displayName(alt)}</span>
                <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
                  {alt.listing_type === 'sale'
                    ? <><FlexCoinIcon size={14} />{fmt(alt.asking_price ?? 0)}</>
                    : tFallback('itemDetailSheet.trade', 'Trade')}
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}

        {isMine ? (
          <p className="mx-5 mt-5 h-14 border-y flex items-center text-body text-muted-foreground">
            {tFallback('itemDetail.yourListing', 'This is your listing.')}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onSellerClick?.(listing.seller_user_id)}
            disabled={!onSellerClick}
            className="mx-5 mt-5 h-14 border-y flex items-center gap-2 text-start"
          >
            <span className="w-8 h-8 rounded-full bg-border inline-flex items-center justify-center text-label font-bold shrink-0" aria-hidden="true">
              {(displayName(listing) || '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-caption text-muted-foreground">{tFallback('itemDetail.listedBy', 'Listed by')}</span>
              <span className="text-body font-semibold truncate">{displayName(listing)}</span>
            </span>
            <span className="text-label font-semibold">{tFallback('itemDetail.profile', 'Profile')}</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
          </button>
        )}

        <div className="h-6 shrink-0" />
        {/* Pinned actions. */}
        <div className="sticky bottom-0 mt-auto px-5 pt-3 pb-4 bg-background flex flex-col gap-1">
          {isMine ? (
            <>
              <button
                type="button"
                onClick={() => onCancel?.(listing)}
                className="h-14 rounded-full border font-display text-title"
              >
                {tFallback('itemDetailSheet.cancelListing', 'Cancel listing')}
              </button>
              {onDelete && (
                <button type="button" onClick={() => onDelete(listing)} className="h-11 text-label font-semibold text-destructive">
                  {tFallback('listingCard.deleteListing', 'Delete listing')}
                </button>
              )}
            </>
          ) : isSale ? (
            <>
              <div className="flex justify-between text-label pb-1">
                <span className="text-muted-foreground">
                  {step === 'done'
                    ? tFallback('itemDetail.inYourSet', '{item} is in your bag', { item: listing.item_name })
                    : step === 'confirm'
                      ? tFallback('itemDetail.afterThis', 'After this you have')
                      : tFallback('itemDetail.balance', 'Your balance')}
                </span>
                <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${step === 'done' ? 'text-success' : ''}`}>
                  <FlexCoinIcon size={13} />
                  {step === 'confirm'
                    ? fmt(flexCoins - price)
                    : step === 'done'
                      ? tFallback('itemDetail.left', '{n} left', { n: fmt(flexCoins) })
                      : fmt(flexCoins)}
                </span>
              </div>
              {step === 'done' ? (
                <div className="h-14 rounded-full bg-card border inline-flex items-center justify-center gap-2 font-display text-title text-success" role="status">
                  <Check className="w-5 h-5" aria-hidden="true" />
                  {tFallback('itemDetail.bought', 'Bought')}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={buy}
                  disabled={!canAfford || busy}
                  aria-busy={busy}
                  className="h-14 rounded-full bg-primary text-primary-foreground font-display text-title disabled:opacity-50"
                >
                  {!canAfford
                    ? tFallback('itemDetail.needMore', 'You need {n} more', { n: fmt(price - flexCoins) })
                    : step === 'confirm'
                      ? tFallback('itemDetail.confirm', 'Confirm {price}', { price: fmt(price) })
                      : tFallback('itemDetail.buyFor', 'Buy for {price}', { price: fmt(price) })}
                </button>
              )}
              {step === 'confirm' ? (
                <button type="button" onClick={() => setStep('idle')} disabled={busy} className="h-11 text-label font-semibold">
                  {tFallback('common.cancel', 'Cancel')}
                </button>
              ) : step === 'done' ? (
                <button type="button" onClick={onClose} className="h-11 text-label font-semibold">
                  {tFallback('itemDetail.back', 'Back to market')}
                </button>
              ) : onMessageSeller && (
                <button type="button" onClick={() => onMessageSeller(listing)} className="h-11 text-label font-semibold">
                  {tFallback('itemDetail.message', 'Message the seller')}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onOfferTrade?.(listing)}
                className="h-14 rounded-full bg-primary text-primary-foreground font-display text-title"
              >
                {tFallback('itemDetailSheet.offerATrade', 'Offer a trade')}
              </button>
              {onMessageSeller && (
                <button type="button" onClick={() => onMessageSeller(listing)} className="h-11 text-label font-semibold">
                  {tFallback('itemDetail.message', 'Message the seller')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
